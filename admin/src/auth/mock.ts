/*
 * Fake sign-in for screenshots and UI tests only. It is bundled ONLY when the build sets
 * NEXT_PUBLIC_AUTH_MOCK=1 (see select.ts); normal builds do not contain this file.
 * Any email signs in; the password "wrong" fails.
 */
import { AuthBackend, AuthError, AuthUser } from './types';

const KEY = 'ik_mock_user';
const listeners = new Set<(u: AuthUser | null) => void>();

function read(): AuthUser | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? { email: v } : null;
  } catch {
    return null;
  }
}
function write(email: string | null) {
  try {
    if (email) sessionStorage.setItem(KEY, email);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(email ? { email } : null));
}

export const authBackend: AuthBackend = {
  onChange(cb) {
    listeners.add(cb);
    setTimeout(() => cb(read()), 0);
    return () => listeners.delete(cb);
  },
  async signIn(email, password) {
    if (password === 'wrong') throw new AuthError('auth/invalid-credential', 'Email or password is not right');
    write(email);
  },
  async signOut() {
    write(null);
  },
  async idToken() {
    const u = read();
    return u ? `mock-token:${u.email}` : null;
  },
  async resetPassword() {},
  async changePassword(current) {
    if (current === 'wrong') throw new AuthError('auth/invalid-credential', 'Current password is not right');
  },
};
