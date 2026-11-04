/**
 * What the dashboard cannot do from the browser: it needs the Admin SDK (team accounts) or does
 * heavy work (Excel). Everything else goes straight to Firestore under firestore.rules.
 * Each handler is a plain Firebase callable; see index.ts.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { FunctionsErrorCode } from 'firebase-functions/v2/https';
import { z, ZodType } from 'zod';
import { AppError, conflict, notFound } from '../common/app-error';
import { auth } from '../common/firebase-auth';
import { Admin, AdminRole } from '../db/models';
import { col } from '../db/paths';
import { F, getDoc } from '../db/store';
import { exportGuests, fromApplication, importGuests, template } from './guests';

const zId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id');
const zRole = z.enum(['admin', 'setup', 'support']);

const NewMember = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(60),
  role: zRole,
  password: z.string().min(10, 'At least 10 characters'),
});
const EditMember = z.object({ id: zId, name: z.string().trim().min(2).max(60).optional(), role: zRole.optional(), active: z.boolean().optional(), password: z.string().min(10).optional() });
const Import = z.object({
  weddingId: zId,
  fileName: z.string().min(1).max(200),
  /** the workbook, base64 */
  file: z.string().min(1).max(14_000_000, 'Files here can be at most 10 MB'),
  mode: z.enum(['merge', 'replace']).default('merge'),
  dryRun: z.boolean().default(true),
  createFunctions: z.boolean().default(true),
});
const WeddingId = z.object({ weddingId: zId });
const ApplicationId = z.object({ applicationId: zId });

type Handler<S extends ZodType> = { roles: AdminRole[]; schema: S; run: (b: z.infer<S>, me: string) => Promise<unknown> };
const handler = <S extends ZodType>(h: Handler<S>) => h;

const handlers = {
  teamMemberAdd: handler({
    roles: ['admin'],
    schema: NewMember,
    /** creates the Firebase Auth account (email + password) and the team record */
    run: async (b) => {
      if (await auth().getUserByEmail(b.email)) throw conflict('EMAIL_TAKEN', 'This email already has an account');
      const { uid } = await auth().createUser({ email: b.email, password: b.password, displayName: b.name });
      await auth().setRole(uid, b.role);
      await col.admins().doc(uid).set({ email: b.email, name: b.name, role: b.role, active: true, lastLoginAt: null, createdAt: F.now() });
      return { id: uid };
    },
  }),
  teamMemberEdit: handler({
    roles: ['admin'],
    schema: EditMember,
    run: async ({ id, password, ...rest }, me) => {
      const cur = await getDoc<Admin>(col.admins().doc(id));
      if (!cur) throw notFound('Admin');
      if (id === me && (rest.active === false || (rest.role && rest.role !== 'admin'))) {
        throw new AppError('SELF_LOCKOUT', 'You cannot switch off or demote your own account', 409);
      }
      if (password || rest.active !== undefined || rest.name) {
        await auth().updateUser(id, { password, disabled: rest.active === undefined ? undefined : !rest.active, displayName: rest.name });
      }
      const role = rest.role ?? cur.role;
      const active = rest.active ?? cur.active;
      await auth().setRole(id, active ? role : null);
      // role or access changes take effect at once: old tokens stop working
      if (rest.role !== undefined || rest.active === false || password) await auth().revoke(id);
      await col.admins().doc(id).update({ ...rest });
      return { id };
    },
  }),
  /** a base64 workbook. Always run with dryRun first. */
  guestsImport: handler({
    roles: ['setup'],
    schema: Import,
    run: ({ weddingId, file, fileName, ...opts }, me) => importGuests(weddingId, { buffer: Buffer.from(file, 'base64'), originalname: fileName }, opts, me),
  }),
  guestsExport: handler({
    roles: ['admin', 'setup', 'support'],
    schema: WeddingId,
    run: async ({ weddingId }) => {
      const f = await exportGuests(weddingId);
      return { name: f.name, file: f.buffer.toString('base64') };
    },
  }),
  guestsTemplate: handler({
    roles: ['admin', 'setup', 'support'],
    schema: z.object({}),
    run: async () => ({ name: 'invite-karoo-guest-list.xlsx', file: (await template()).toString('base64') }),
  }),
  weddingFromApplication: handler({
    roles: ['setup'],
    schema: ApplicationId,
    run: ({ applicationId }, me) => fromApplication(applicationId, me),
  }),
};
export type CallableName = keyof typeof handlers;

const CODES: Record<number, FunctionsErrorCode> = { 401: 'unauthenticated', 403: 'permission-denied', 404: 'not-found', 409: 'already-exists', 413: 'invalid-argument', 415: 'invalid-argument', 422: 'invalid-argument' };

/** who is calling: the team record decides, so switching an account off takes effect at once */
async function teamMember(uid: string | undefined, roles: AdminRole[]) {
  if (!uid) throw new AppError('UNAUTHORIZED', 'Sign in to continue', 401);
  const a = await getDoc<Admin>(col.admins().doc(uid));
  if (!a?.active) throw new AppError('NOT_TEAM', 'This account is not on the Invite Karoo team', 403);
  if (a.role !== 'admin' && !roles.includes(a.role)) throw new AppError('FORBIDDEN', 'You do not have access to this', 403);
}

function parse<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new AppError('VALIDATION', 'Some fields need attention', 422, fields);
}

/** runs one handler for a signed-in caller; errors reach the browser as { code, status, fields } */
export async function call(name: CallableName, uid: string | undefined, data: unknown): Promise<unknown> {
  const h = handlers[name] as Handler<ZodType>;
  try {
    await teamMember(uid, h.roles);
    return await h.run(parse(h.schema, data), uid!);
  } catch (e) {
    if (e instanceof AppError) throw new HttpsError(CODES[e.status] ?? 'failed-precondition', e.message, { code: e.code, status: e.status, fields: e.fields });
    throw e;
  }
}
