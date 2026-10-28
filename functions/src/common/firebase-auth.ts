/**
 * Firebase Authentication, behind a small interface.
 *
 *   app users   sign in with the WhatsApp code; the API hands back a custom token
 *               (uid = users/{uid}, claim `phone`), the app calls signInWithCustomToken.
 *   team        email + password accounts; the custom claim `ikRole` (admin | setup | support)
 *               marks them as Invite Karoo team.
 *
 * Every request carries a Firebase ID token. Tests without the Auth emulator use FakeAuth,
 * whose tokens are readable JSON (test helpers turn custom tokens into ID tokens).
 */
import { getAuth } from 'firebase-admin/auth';
import { usingFake } from '../db/store';
import { adminApp } from '../modules/infra/firebase';

export type IdClaims = { uid: string; phone?: string; ikRole?: 'admin' | 'setup' | 'support'; email?: string };
export type AuthUserIn = { email?: string; password?: string; displayName?: string; disabled?: boolean };

export interface AuthPort {
  createCustomToken(uid: string, claims?: Record<string, unknown>): Promise<string>;
  verifyIdToken(token: string, checkRevoked?: boolean): Promise<IdClaims>;
  createUser(u: AuthUserIn): Promise<{ uid: string }>;
  updateUser(uid: string, u: AuthUserIn): Promise<void>;
  setRole(uid: string, role: IdClaims['ikRole'] | null): Promise<void>;
  getUserByEmail(email: string): Promise<{ uid: string } | null>;
  revoke(uid: string): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}

class FirebaseAuthPort implements AuthPort {
  private get a() {
    return getAuth(adminApp());
  }
  createCustomToken(uid: string, claims?: Record<string, unknown>) {
    return this.a.createCustomToken(uid, claims);
  }
  async verifyIdToken(token: string, checkRevoked = false): Promise<IdClaims> {
    const t = await this.a.verifyIdToken(token, checkRevoked);
    return { uid: t.uid, phone: t.phone as string | undefined, ikRole: t.ikRole as IdClaims['ikRole'], email: t.email };
  }
  async createUser(u: AuthUserIn) {
    const r = await this.a.createUser(u);
    return { uid: r.uid };
  }
  async updateUser(uid: string, u: AuthUserIn) {
    await this.a.updateUser(uid, u);
  }
  async setRole(uid: string, role: IdClaims['ikRole'] | null) {
    await this.a.setCustomUserClaims(uid, role ? { ikRole: role } : {});
  }
  async getUserByEmail(email: string) {
    try {
      return { uid: (await this.a.getUserByEmail(email)).uid };
    } catch {
      return null;
    }
  }
  async revoke(uid: string) {
    await this.a.revokeRefreshTokens(uid);
  }
  async deleteUser(uid: string) {
    try {
      await this.a.deleteUser(uid);
    } catch {
      /* never signed in, or already gone */
    }
  }
}

/** in-memory Firebase Auth for tests */
export class FakeAuth implements AuthPort {
  readonly users = new Map<string, { uid: string; email?: string; password?: string; disabled?: boolean; claims: Record<string, unknown>; revokedAt?: number }>();
  private n = 0;
  private enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  private dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString()) as Record<string, unknown>;

  async createCustomToken(uid: string, claims: Record<string, unknown> = {}) {
    return `fakecustom.${this.enc({ uid, claims })}`;
  }
  /** what signInWithCustomToken does on the device */
  signInWithCustomToken(token: string) {
    const { uid, claims } = this.dec(token.split('.')[1]) as { uid: string; claims: Record<string, unknown> };
    const u = this.users.get(uid) ?? { uid, claims: {} };
    this.users.set(uid, u);
    return `fakeid.${this.enc({ uid, ...u.claims, ...claims, iat: Date.now() })}`;
  }
  /** what signInWithEmailAndPassword does in the dashboard */
  signInWithPassword(email: string, password: string) {
    const u = [...this.users.values()].find((x) => x.email === email.toLowerCase());
    if (!u || u.password !== password || u.disabled) throw new Error('INVALID_LOGIN_CREDENTIALS');
    return `fakeid.${this.enc({ uid: u.uid, email: u.email, ...u.claims, iat: Date.now() })}`;
  }
  async verifyIdToken(token: string): Promise<IdClaims> {
    if (!token.startsWith('fakeid.')) throw new Error('bad token');
    const c = this.dec(token.split('.')[1]) as IdClaims & { iat: number };
    const u = this.users.get(c.uid);
    if (u?.disabled || (u?.revokedAt && c.iat < u.revokedAt)) throw new Error('revoked');
    return c;
  }
  async createUser(u: AuthUserIn) {
    if (u.email && [...this.users.values()].some((x) => x.email === u.email!.toLowerCase())) throw Object.assign(new Error('email exists'), { code: 'auth/email-already-exists' });
    const uid = `fake${++this.n}`;
    this.users.set(uid, { uid, email: u.email?.toLowerCase(), password: u.password, disabled: u.disabled, claims: {} });
    return { uid };
  }
  async updateUser(uid: string, u: AuthUserIn) {
    const x = this.users.get(uid);
    if (!x) throw new Error('no user');
    if (u.email !== undefined) x.email = u.email.toLowerCase();
    if (u.password !== undefined) x.password = u.password;
    if (u.disabled !== undefined) x.disabled = u.disabled;
  }
  async setRole(uid: string, role: IdClaims['ikRole'] | null) {
    const x = this.users.get(uid);
    if (x) x.claims = role ? { ikRole: role } : {};
  }
  async getUserByEmail(email: string) {
    const u = [...this.users.values()].find((x) => x.email === email.toLowerCase());
    return u ? { uid: u.uid } : null;
  }
  async revoke(uid: string) {
    const x = this.users.get(uid);
    if (x) x.revokedAt = Date.now() + 1;
  }
  async deleteUser(uid: string) {
    this.users.delete(uid);
  }
}

let fake: FakeAuth | null = null;
let real: AuthPort | null = null;

export function auth(): AuthPort {
  if (usingFake() && !process.env.FIREBASE_AUTH_EMULATOR_HOST) return (fake ??= new FakeAuth());
  return (real ??= new FirebaseAuthPort());
}
export function fakeAuth(): FakeAuth {
  return auth() as FakeAuth;
}
export function resetAuth() {
  fake = null;
}
