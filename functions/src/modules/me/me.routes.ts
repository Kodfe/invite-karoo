import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { AppError } from '../../common/app-error';
import { zTime } from '../../common/zod';
import { col } from '../../db/paths';
import { phoneOrThrow } from '../auth/auth.routes';
import { routes } from '../../common/http';
import { svc } from '../../services';

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

async function assertFree(phone: string) {
  const taken = (await col.phones().doc(phone).get()).exists;
  if (taken) throw new AppError('PHONE_TAKEN', 'Another account already uses this number.', 409);
}

export function meRoutes() {
  const r = routes('/v1/me');

  r.get('', (c) => svc.me.me(c.uid));

  r.patch('', (c) => svc.me.updateProfile(c.uid, c.body(Profile)));

  r.post('photo', async (c) => {
    const file = c.file();
    if (!file) throw new AppError('NO_FILE', 'Choose a photo first');
    svc.storage.check('image', file);
    const s = await svc.storage.put(`users/${c.uid}`, file);
    return svc.me.updateProfile(c.uid, { photoUrl: s.url });
  }, { files: ['file'] });

  r.delete('photo', (c) => svc.me.updateProfile(c.uid, { photoUrl: null }));

  r.patch('prefs', (c) => svc.me.updatePrefs(c.uid, c.body(Prefs)));

  r.patch('privacy', (c) => svc.me.updatePrivacy(c.uid, c.body(Privacy)));

  /** the app calls this after sign-in and whenever Firebase rotates the token */
  r.post('devices', (c) => {
    const b = c.body(Device);
    return svc.me.registerDevice(c.uid, b.fcmToken, b.platform);
  }, { status: 200 });

  r.delete('devices', (c) => svc.me.removeDevice(c.uid, c.body(DeviceDel).fcmToken));

  /** change number — step 1: code to the NEW number */
  r.post('phone/request', async (c) => {
    const b = c.body(PhoneReq);
    const phone = phoneOrThrow(b.cc, b.mobile);
    await assertFree(phone);
    return svc.auth.requestOtp(phone, 'change_number');
  }, { status: 200 });

  /** change number — step 2 */
  r.post('phone/verify', async (c) => {
    const b = c.body(PhoneVerify);
    const phone = phoneOrThrow(b.cc, b.mobile);
    await assertFree(phone);
    await svc.auth.checkOtp(phone, b.code, 'change_number');
    // the new number is in the sign-in token, so the app signs in again with customToken
    const r = await svc.me.changePhone(c.uid, phone);
    return { ...r.me, customToken: r.customToken };
  }, { status: 200 });

  r.get('export', (c) => svc.me.export(c.uid));

  r.delete('', (c) => {
    c.body(Del);
    return svc.me.deleteAccount(c.uid);
  });
}
