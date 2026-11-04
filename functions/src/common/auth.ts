import { AppError } from './app-error';
import { auth } from './firebase-auth';

/** an app user, from their Firebase ID token (uid = users/{uid}) */
export type UserClaims = { sub: string; phone: string };

const unauthorized = (message: string) => new AppError('UNAUTHORIZED', message, 401);

/** who is calling, from the Authorization header */
export async function signedInUser(header: string | undefined): Promise<UserClaims> {
  if (!header?.startsWith('Bearer ')) throw unauthorized('Sign in to continue');
  let c;
  try {
    c = await auth().verifyIdToken(header.slice(7));
  } catch {
    throw unauthorized('Your session has expired. Sign in again.');
  }
  if (!c.phone) throw unauthorized('Sign in with your mobile number to continue');
  return { sub: c.uid, phone: c.phone };
}
