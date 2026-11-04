import { z } from 'zod';

import { AppError } from '../../common/app-error';
import { toE164 } from '../../common/phone';
import { perMinute, routes } from '../../common/http';
import { svc } from '../../services';

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

export function phoneOrThrow(cc: string, mobile: string) {
  const p = toE164(mobile, cc);
  if (!p) throw new AppError('VALIDATION', 'Enter a valid mobile number', 422, { mobile: 'Enter a valid mobile number' });
  return p;
}

export function authRoutes() {
  const r = routes('/v1/auth', { signedIn: false });

  /** Step 1 — send a 4-digit code on WhatsApp */
  r.post('otp/request', (c) => {
    const b = c.body(RequestOtp);
    return svc.auth.requestOtp(phoneOrThrow(b.cc, b.mobile), b.purpose);
  }, { status: 200, limit: perMinute(10) });

  /** Step 2 — check the code. Known number → signed in (a Firebase custom token). New number → signed in if `profile` sent, else a signup ticket. */
  r.post('otp/verify', (c) => {
    const b = c.body(VerifyOtp);
    return svc.auth.verifyOtp(phoneOrThrow(b.cc, b.mobile), b.code, b.profile, b.platform);
  }, { status: 200, limit: perMinute(20) });

  /** Step 3 (new numbers only) — create the account with the ticket from step 2 */
  r.post('signup', (c) => {
    const { signupTicket, platform, ...p } = c.body(Signup);
    return svc.auth.signupWithTicket(signupTicket, p, platform);
  }, { status: 200 });
}
