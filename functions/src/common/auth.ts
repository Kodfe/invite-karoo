import { Admin, AdminRole } from '../db/models';
import { col } from '../db/paths';
import { getDoc } from '../db/store';
import { AppError } from './app-error';
import { auth } from './firebase-auth';

/** an app user, from their Firebase ID token (uid = users/{uid}) */
export type UserClaims = { sub: string; phone: string };

const unauthorized = (message: string) => new AppError('UNAUTHORIZED', message, 401);

async function verified(header: string | undefined) {
  if (!header?.startsWith('Bearer ')) throw unauthorized('Sign in to continue');
  try {
    return await auth().verifyIdToken(header.slice(7));
  } catch {
    throw unauthorized('Your session has expired. Sign in again.');
  }
}

/** who is calling, from the Authorization header */
export async function signedInUser(header: string | undefined): Promise<UserClaims> {
  const c = await verified(header);
  if (!c.phone) throw unauthorized('Sign in with your mobile number to continue');
  return { sub: c.uid, phone: c.phone };
}

/** a team member. The admins record decides, so switching an account off takes effect at once. */
export async function teamMember(header: string | undefined, roles: AdminRole[]): Promise<UserClaims> {
  const c = await verified(header);
  const a = await getDoc<Admin>(col.admins().doc(c.uid));
  if (!a?.active) throw new AppError('NOT_TEAM', 'This account is not on the Invite Karoo team', 403);
  if (a.role !== 'admin' && !roles.includes(a.role)) throw new AppError('FORBIDDEN', 'You do not have access to this', 403);
  return { sub: c.uid, phone: '' };
}
