import { z } from 'zod';

/**
 * Settings. On Firebase, plain values come from `functions/.env` (deployed with the code) and
 * secrets from Secret Manager (`firebase functions:secrets:set NAME`); both arrive as process.env.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  /** only for running the API outside Cloud Functions (npm run dev) */
  PORT: z.coerce.number().catch(3000),
  PUBLIC_URL: z.string().default('https://api.invitekaroo.com'),

  /** secret: salts the OTP code hashes */
  OTP_SECRET: z.string().default('dev-otp-secret'),
  /** development only: every code is this and nothing is sent. Must be empty in production. */
  DEV_OTP: z.string().default(''),

  WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v23.0'),
  WA_TEMPLATE_OTP: z.string().default('ik_login_code'),
  WA_TEMPLATE_INVITE: z.string().default('ik_function_invite'),
  WA_TEMPLATE_REMINDER: z.string().default('ik_function_reminder'),
  WA_TEMPLATE_LANG: z.string().default('en'),

  /** only needed outside Google Cloud (local dev against a real project) */
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().default(''),
  /** optional: Firebase reserves the FIREBASE_ prefix in functions/.env, hence the name */
  STORAGE_BUCKET: z.string().default(''),

  /** firebase = Cloud Storage (production); local = ./uploads served at /files (development, tests) */
  STORAGE_DRIVER: z.enum(['local', 'firebase']).default('firebase'),
  UPLOAD_DIR: z.string().default('./uploads'),

  ANTHROPIC_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),

  /** the first dashboard account (npm run seed:admin creates it when there is no admin yet) */
  ADMIN_EMAIL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  ADMIN_NAME: z.string().default('Invite Karoo Admin'),
  TEAM_WHATSAPP: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // a secret that has to exist for deploys but is not in use yet is stored as "unset"
  const raw = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === 'unset' ? '' : v]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.DEV_OTP) throw new Error('DEV_OTP must be empty in production');
    if (parsed.data.OTP_SECRET === 'dev-otp-secret') throw new Error('Set the OTP_SECRET secret in production');
  }
  cached = parsed.data;
  return cached;
}

/** tests reset the cache after changing process.env */
export function resetEnvCache() {
  cached = null;
}
