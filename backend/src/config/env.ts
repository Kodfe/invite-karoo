import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ADMIN_SECRET: z.string().min(8),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(60),
  DEV_OTP: z.string().default(''),

  WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),
  WA_TEMPLATE_OTP: z.string().default('ik_login_code'),
  WA_TEMPLATE_INVITE: z.string().default('ik_function_invite'),
  WA_TEMPLATE_REMINDER: z.string().default('ik_function_reminder'),
  WA_TEMPLATE_LANG: z.string().default('en'),

  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().default(''),
  FIREBASE_STORAGE_BUCKET: z.string().default(''),

  STORAGE_DRIVER: z.enum(['local', 'firebase']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** the built Admin Dashboard (admin/dist), served at /admin when the folder exists */
  ADMIN_DIR: z.string().default('./public/admin'),

  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),

  ADMIN_EMAIL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  ADMIN_NAME: z.string().default('Invite Karoo Admin'),
  TEAM_WHATSAPP: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.DEV_OTP) throw new Error('DEV_OTP must be empty in production');
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ADMIN_SECRET'] as const) {
      if (parsed.data[k].startsWith('change-me')) throw new Error(`${k} must be set to a real secret in production`);
    }
  }
  cached = parsed.data;
  return cached;
}

/** tests reset the cache after changing process.env */
export function resetEnvCache() {
  cached = null;
}
