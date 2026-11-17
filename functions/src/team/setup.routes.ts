/**
 * The one-time "create the first admin" page, for a project where `npm run seed:admin` never ran.
 *
 *   GET  /v1/team/setup   { open }  open while there is no active admin and the server has
 *                                   ADMIN_EMAIL / ADMIN_PASSWORD set
 *   POST /v1/team/setup             { email, name, password } → creates (or takes over) that
 *                                   Firebase Auth account and its admins/{uid} record
 *
 * Knowing the page's address is not enough: the email and password typed must match ADMIN_EMAIL
 * and ADMIN_PASSWORD on the server. Once an active admin exists it answers 410 for good; further
 * accounts are added from the Team page.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { auth } from '../common/firebase-auth';
import { perMinute, routes } from '../common/http';
import { env } from '../config/env';
import { col } from '../db/paths';
import { seedSystemData } from '../db/seed-system';
import { F } from '../db/store';

const FirstAdmin = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(60),
  password: z.string().min(10, 'At least 10 characters'),
});

/** compares without leaking how much of the secret matched */
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

async function closedBecause(): Promise<'DONE' | 'NOT_CONFIGURED' | null> {
  const admins = await col.admins().where('active', '==', true).where('role', '==', 'admin').limit(1).get();
  if (!admins.empty) return 'DONE';
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = env();
  if (!ADMIN_EMAIL.trim() || ADMIN_PASSWORD.length < 10) return 'NOT_CONFIGURED';
  return null;
}

export function setupRoutes() {
  const r = routes('/v1/team/setup', { signedIn: false });

  r.get('', async () => ({ open: (await closedBecause()) === null }));

  r.post('', async (c) => {
    const why = await closedBecause();
    if (why === 'DONE') throw new AppError('SETUP_DONE', 'The first admin already exists. Sign in instead.', 410);
    if (why) throw new AppError('SETUP_NOT_CONFIGURED', 'Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters) on the API, redeploy, then try again.', 409);
    const b = c.body(FirstAdmin);
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = env();
    if (!same(b.email, ADMIN_EMAIL.trim().toLowerCase()) || !same(b.password, ADMIN_PASSWORD)) {
      throw new AppError('SETUP_MISMATCH', 'The email and password must be the ADMIN_EMAIL and ADMIN_PASSWORD set on the API.', 403);
    }
    // an account made by hand in the Firebase console is taken over, not duplicated
    const found = await auth().getUserByEmail(b.email);
    const uid = found?.uid ?? (await auth().createUser({ email: b.email, password: b.password, displayName: b.name })).uid;
    if (found) await auth().updateUser(uid, { password: b.password, displayName: b.name, disabled: false });
    await auth().setRole(uid, 'admin');
    await col.admins().doc(uid).set({ email: b.email, name: b.name, role: 'admin', active: true, lastLoginAt: null, createdAt: F.now() });
    // what `npm run seed:admin` would also have made: the gift categories every wedding starts with
    await seedSystemData();
    return { id: uid };
  }, { limit: perMinute(5) });
}
