/*
 * Creates the first dashboard account from ADMIN_EMAIL / ADMIN_PASSWORD (a Firebase Auth email user
 * with the custom claim ikRole=admin, plus its admins/{uid} record), and the system gift categories.
 * Safe to run on every deploy: an existing account keeps its password unless --reset-password is given.
 *   npm run seed:admin              (CI runs this after deploying, with the project's credentials)
 */
import 'dotenv/config';
import { env } from '../config/env';
import { auth } from '../common/firebase-auth';
import { col } from './paths';
import { getDoc } from './store';
import { seedSystemData } from './seed-system';

export async function seedAdmin(opts: { resetPassword?: boolean } = {}) {
  const added = await seedSystemData();
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = env();
  if (!ADMIN_EMAIL) return { categoriesAdded: added, admin: 'skipped (no ADMIN_EMAIL)' };
  const email = ADMIN_EMAIL.trim().toLowerCase();
  let user = await auth().getUserByEmail(email);
  let state = 'kept';
  if (!user) {
    if (ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters to create the first admin.');
    user = await auth().createUser({ email, password: ADMIN_PASSWORD, displayName: ADMIN_NAME });
    state = 'created';
  } else if (opts.resetPassword && ADMIN_PASSWORD.length >= 10) {
    await auth().updateUser(user.uid, { password: ADMIN_PASSWORD, disabled: false });
    state = 'password reset';
  }
  await auth().setRole(user.uid, 'admin');
  const ref = col.admins().doc(user.uid);
  const cur = await getDoc(ref);
  await ref.set({ email, name: (cur as { name?: string } | null)?.name ?? ADMIN_NAME, role: 'admin', active: true, lastLoginAt: null, createdAt: new Date() }, { merge: true });
  return { categoriesAdded: added, admin: `${email} ${state}` };
}

if (require.main === module) {
  seedAdmin({ resetPassword: process.argv.includes('--reset-password') })
    .then((r) => {
      console.log(r);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
