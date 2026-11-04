import {
  Auth,
  EmailAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import { firebase, firebaseConfigured } from '../firebase';
import { AuthBackend, AuthError } from './types';

let auth: Auth | null = null;

/** created on first use in the browser, never during the static build */
function a(): Auth {
  if (auth) return auth;
  if (!firebaseConfigured()) {
    throw new AuthError('NOT_CONFIGURED', 'Sign-in is not set up: the NEXT_PUBLIC_FIREBASE_* settings are missing from this build.');
  }
  auth = getAuth(firebase().app);
  void setPersistence(auth, browserLocalPersistence).catch(() => {});
  return auth;
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is not right',
  'auth/invalid-login-credentials': 'Email or password is not right',
  'auth/wrong-password': 'Email or password is not right',
  'auth/user-not-found': 'Email or password is not right',
  'auth/invalid-email': 'That email address does not look right',
  'auth/missing-email': 'Type your work email first',
  'auth/missing-password': 'Type your password',
  'auth/user-disabled': 'This account is turned off. Ask an admin on the team.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, or reset your password.',
  'auth/network-request-failed': 'Could not reach the server. Check your connection and try again.',
  'auth/weak-password': 'Choose a longer password (at least 10 characters)',
  'auth/requires-recent-login': 'Please sign out, sign in again, and then change the password.',
};

function friendly(e: unknown): AuthError {
  if (e instanceof AuthError) return e;
  const code = (e as { code?: string })?.code ?? 'auth/unknown';
  return new AuthError(code, MESSAGES[code] ?? 'Sign-in failed. Please try again.');
}

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw friendly(e);
  }
};

export const authBackend: AuthBackend = {
  onChange(cb) {
    let auth: Auth;
    try {
      auth = a();
    } catch {
      // not configured: behave as signed out, the login form explains why on submit
      cb(null);
      return () => {};
    }
    return onAuthStateChanged(auth, (u) => cb(u ? { email: u.email } : null));
  },
  signIn: (email, password) => wrap(async () => void (await signInWithEmailAndPassword(a(), email, password))),
  signOut: () => wrap(() => signOut(a())),
  resetPassword: (email) => wrap(() => sendPasswordResetEmail(a(), email)),
  changePassword: (current, next) =>
    wrap(async () => {
      const u = a().currentUser;
      if (!u?.email) throw new AuthError('auth/no-user', 'You are signed out. Sign in again.');
      try {
        await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
      } catch (e) {
        const code = (e as { code?: string })?.code ?? '';
        if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(code)) {
          throw new AuthError(code, 'Current password is not right');
        }
        throw e;
      }
      await updatePassword(u, next);
    }),
};
