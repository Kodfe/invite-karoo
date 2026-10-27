import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://ik:ik@localhost:5432/invitekaroo_test';

export function testEnv() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_ADMIN_SECRET: 'test-admin-secret',
    DEV_OTP: '1234',
    WHATSAPP_PROVIDER: 'console',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: '/tmp/ik-test-uploads',
    ANTHROPIC_API_KEY: '',
    FIREBASE_SERVICE_ACCOUNT_JSON: '',
  });
}

export async function resetDb() {
  const pool = new Pool({ connectionString: TEST_DB });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await pool.end();
}

export async function boot(): Promise<INestApplication> {
  testEnv();
  const { resetEnvCache } = await import('../src/config/env');
  resetEnvCache();
  await resetDb();
  const { runMigrations } = await import('../src/db/migrate');
  await runMigrations(TEST_DB);
  const { createApp } = await import('../src/main');
  const app = await createApp();
  await app.init();
  return app;
}

export async function signIn(app: INestApplication, mobile: string, profile = { firstName: 'Test', familyName: 'User', city: 'Guwahati' }) {
  const http = request(app.getHttpServer());
  await http.post('/v1/auth/otp/request').send({ cc: '+91', mobile }).expect(200);
  const r = await http.post('/v1/auth/otp/verify').send({ cc: '+91', mobile, code: '1234', profile }).expect(200);
  return { token: r.body.tokens.accessToken as string, refresh: r.body.tokens.refreshToken as string, me: r.body.me };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
