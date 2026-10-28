import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Tests run against an in-memory Firestore + Auth by default (fast, no setup), or against the
 * Firebase emulators when FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are set
 * (npm run test:emulators — that is what CI runs).
 */
export function testEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DEV_OTP: '1234',
    OTP_SECRET: 'test-otp-secret',
    WHATSAPP_PROVIDER: 'console',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: '/tmp/ik-test-uploads',
    ANTHROPIC_API_KEY: '',
    FIREBASE_SERVICE_ACCOUNT_JSON: '',
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT ?? 'demo-invitekaroo',
    ADMIN_EMAIL: 'a@ik.test',
    ADMIN_PASSWORD: 'password-123',
    ADMIN_NAME: 'Admin',
  });
}

export async function boot(): Promise<INestApplication> {
  testEnv();
  const { resetEnvCache } = await import('../src/config/env');
  resetEnvCache();
  const { resetStore } = await import('../src/db/store');
  const { resetAuth } = await import('../src/common/firebase-auth');
  await resetStore();
  resetAuth();
  await resetAuthEmulator();
  const { seedAdmin } = await import('../src/db/seed-admin');
  await seedAdmin();
  const { createApp } = await import('../src/main');
  const app = await createApp();
  await app.init();
  return app;
}

const emu = () => process.env.FIREBASE_AUTH_EMULATOR_HOST;
const project = () => process.env.GCLOUD_PROJECT ?? 'demo-invitekaroo';

async function resetAuthEmulator() {
  if (!emu()) return;
  await fetch(`http://${emu()}/emulator/v1/projects/${project()}/accounts`, { method: 'DELETE' });
}

async function identity(path: string, body: object) {
  const r = await fetch(`http://${emu()}/identitytoolkit.googleapis.com/v1/${path}?key=fake-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { idToken?: string; error?: { message: string } };
  if (!r.ok || !j.idToken) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.idToken;
}

/** what the app does with the custom token the API hands back */
export async function idTokenFromCustom(customToken: string) {
  if (emu()) return identity('accounts:signInWithCustomToken', { token: customToken, returnSecureToken: true });
  const { fakeAuth } = await import('../src/common/firebase-auth');
  return fakeAuth().signInWithCustomToken(customToken);
}

/** what the dashboard does: Firebase email + password sign-in */
export async function passwordSignIn(email: string, password: string) {
  if (emu()) return identity('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  const { fakeAuth } = await import('../src/common/firebase-auth');
  return fakeAuth().signInWithPassword(email, password);
}

export async function signIn(app: INestApplication, mobile: string, profile = { firstName: 'Test', familyName: 'User', city: 'Guwahati' }) {
  const http = request(app.getHttpServer());
  await http.post('/v1/auth/otp/request').send({ cc: '+91', mobile }).expect(200);
  const r = await http.post('/v1/auth/otp/verify').send({ cc: '+91', mobile, code: '1234', profile }).expect(200);
  return { token: await idTokenFromCustom(r.body.customToken), me: r.body.me };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
