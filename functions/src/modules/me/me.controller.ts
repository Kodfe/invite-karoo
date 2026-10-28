import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { AppError } from '../../common/errors';
import { Zod, zTime } from '../../common/zod';
import { col } from '../../db/paths';
import { StorageService } from '../infra/storage.service';
import { AuthService } from '../auth/auth.service';
import { phoneOrThrow } from '../auth/auth.controller';
import { MeService } from './me.service';

const Profile = z.object({
  firstName: z.string().trim().min(1).max(30).optional(),
  familyName: z.string().trim().min(1).max(30).optional(),
  city: z.string().trim().min(2).max(40).optional(),
  email: z.string().trim().email('Enter a valid email').max(80).nullable().optional().or(z.literal('').transform(() => null)),
  lang: z.enum(['en', 'hi', 'ta', 'gu']).optional(),
});
const Prefs = z
  .object({
    wa: z.boolean(), push: z.boolean(), sms: z.boolean(), inv: z.boolean(), rem: z.boolean(),
    remAt: z.array(z.number().int().min(5).max(10080)).max(4),
    nudge: z.boolean(), msgs: z.boolean(), quiet: z.boolean(), qFrom: zTime, qTo: zTime, pause: z.boolean(),
  })
  .partial();
const Privacy = z.object({ city: z.boolean(), seen: z.boolean() }).partial();
const Device = z.object({ fcmToken: z.string().min(10).max(4096), platform: z.enum(['android', 'ios', 'web']) });
const DeviceDel = z.object({ fcmToken: z.string().min(10).max(4096) });
const PhoneReq = z.object({ cc: z.string().regex(/^\+\d{1,4}$/).default('+91'), mobile: z.string().min(6).max(20) });
const PhoneVerify = PhoneReq.extend({ code: z.string().regex(/^\d{4}$/) });
const Del = z.object({ confirm: z.literal('DELETE') });

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1/me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly storage: StorageService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  get(@CurrentUser() u: UserClaims) {
    return this.me.me(u.sub);
  }

  @Patch()
  update(@CurrentUser() u: UserClaims, @Body(new Zod(Profile)) b: z.infer<typeof Profile>) {
    return this.me.updateProfile(u.sub, b);
  }

  @Post('photo')
  @UseInterceptors(FileInterceptor('file'))
  async photo(@CurrentUser() u: UserClaims, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose a photo first');
    this.storage.check('image', file);
    const s = await this.storage.put(`users/${u.sub}`, file);
    return this.me.updateProfile(u.sub, { photoUrl: s.url });
  }

  @Delete('photo')
  removePhoto(@CurrentUser() u: UserClaims) {
    return this.me.updateProfile(u.sub, { photoUrl: null });
  }

  @Patch('prefs')
  prefs(@CurrentUser() u: UserClaims, @Body(new Zod(Prefs)) b: z.infer<typeof Prefs>) {
    return this.me.updatePrefs(u.sub, b);
  }

  @Patch('privacy')
  privacy(@CurrentUser() u: UserClaims, @Body(new Zod(Privacy)) b: z.infer<typeof Privacy>) {
    return this.me.updatePrivacy(u.sub, b);
  }

  /** the app calls this after sign-in and whenever Firebase rotates the token */
  @Post('devices')
  @HttpCode(200)
  device(@CurrentUser() u: UserClaims, @Body(new Zod(Device)) b: z.infer<typeof Device>) {
    return this.me.registerDevice(u.sub, b.fcmToken, b.platform);
  }

  @Delete('devices')
  removeDevice(@CurrentUser() u: UserClaims, @Body(new Zod(DeviceDel)) b: z.infer<typeof DeviceDel>) {
    return this.me.removeDevice(u.sub, b.fcmToken);
  }

  /** change number — step 1: code to the NEW number */
  @Post('phone/request')
  @HttpCode(200)
  async phoneRequest(@Body(new Zod(PhoneReq)) b: z.infer<typeof PhoneReq>) {
    const phone = phoneOrThrow(b.cc, b.mobile);
    await this.assertFree(phone);
    return this.auth.requestOtp(phone, 'change_number');
  }

  /** change number — step 2 */
  @Post('phone/verify')
  @HttpCode(200)
  async phoneVerify(@CurrentUser() u: UserClaims, @Body(new Zod(PhoneVerify)) b: z.infer<typeof PhoneVerify>) {
    const phone = phoneOrThrow(b.cc, b.mobile);
    await this.assertFree(phone);
    await this.auth.checkOtp(phone, b.code, 'change_number');
    // the new number is in the sign-in token, so the app signs in again with customToken
    const r = await this.me.changePhone(u.sub, phone);
    return { ...r.me, customToken: r.customToken };
  }

  @Get('export')
  export(@CurrentUser() u: UserClaims) {
    return this.me.export(u.sub);
  }

  @Delete()
  remove(@CurrentUser() u: UserClaims, @Body(new Zod(Del)) _b: z.infer<typeof Del>) {
    return this.me.deleteAccount(u.sub);
  }

  private async assertFree(phone: string) {
    const taken = (await col.phones().doc(phone).get()).exists;
    if (taken) throw new AppError('PHONE_TAKEN', 'Another account already uses this number.', 409);
  }
}
