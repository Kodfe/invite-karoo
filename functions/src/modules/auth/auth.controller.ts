import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { perMinute } from '../../common/throttle';
import { z } from 'zod';
import { Zod } from '../../common/zod';
import { AppError } from '../../common/errors';
import { toE164 } from '../../common/phone';
import { AuthService } from './auth.service';

const phoneIn = z.object({
  cc: z.string().regex(/^\+\d{1,4}$/).default('+91'),
  mobile: z.string().min(6).max(20),
});
const profile = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(30),
  familyName: z.string().trim().min(1, 'Enter your family name').max(30),
  city: z.string().trim().min(2, 'Enter your city').max(40),
  lang: z.enum(['en', 'hi', 'ta', 'gu']).optional(),
});
const RequestOtp = phoneIn.extend({ purpose: z.enum(['login', 'signup']).default('login') });
const VerifyOtp = phoneIn.extend({
  code: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code'),
  profile: profile.optional(),
  platform: z.enum(['android', 'ios', 'web']).optional(),
});
const Signup = profile.extend({ signupTicket: z.string().min(10), platform: z.enum(['android', 'ios', 'web']).optional() });
const Refresh = z.object({ refreshToken: z.string().min(10) });

export function phoneOrThrow(cc: string, mobile: string) {
  const p = toE164(mobile, cc);
  if (!p) throw new AppError('VALIDATION', 'Enter a valid mobile number', 422, { mobile: 'Enter a valid mobile number' });
  return p;
}

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Step 1 — send a 4-digit code on WhatsApp */
  @Post('otp/request')
  @HttpCode(200)
  @Throttle({ default: { limit: perMinute(10), ttl: 60_000 } })
  request(@Body(new Zod(RequestOtp)) b: z.infer<typeof RequestOtp>) {
    return this.auth.requestOtp(phoneOrThrow(b.cc, b.mobile), b.purpose);
  }

  /** Step 2 — check the code. Known number → signed in. New number → signed in if `profile` sent, else a signup ticket. */
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: perMinute(20), ttl: 60_000 } })
  verify(@Body(new Zod(VerifyOtp)) b: z.infer<typeof VerifyOtp>) {
    return this.auth.verifyOtp(phoneOrThrow(b.cc, b.mobile), b.code, b.profile, b.platform);
  }

  /** Step 3 (new numbers only) — create the account with the ticket from step 2 */
  @Post('signup')
  @HttpCode(200)
  signup(@Body(new Zod(Signup)) b: z.infer<typeof Signup>) {
    const { signupTicket, platform, ...p } = b;
    return this.auth.signupWithTicket(signupTicket, p, platform);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new Zod(Refresh)) b: z.infer<typeof Refresh>) {
    return this.auth.refresh(b.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body(new Zod(Refresh)) b: z.infer<typeof Refresh>) {
    return this.auth.logout(b.refreshToken);
  }
}
