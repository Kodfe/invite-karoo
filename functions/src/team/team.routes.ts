/**
 * What the dashboard cannot do from the browser under firestore.rules: team accounts (Admin SDK),
 * Excel work, and changes that have to tell people. Everything else it does in Firestore itself.
 */
import { z } from 'zod';
import { conflict, AppError, notFound } from '../common/app-error';
import { auth } from '../common/firebase-auth';
import { routes } from '../common/http';
import { zDate, zId, zTime } from '../common/zod';
import { Admin, AdminRole } from '../db/models';
import { col } from '../db/paths';
import { F, getDoc } from '../db/store';
import { svc } from '../services';
import { handover, replyToTicket, updateFunction } from './actions';
import { exportGuests, fromApplication, importGuests, template } from './guests';

const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ANY: AdminRole[] = ['admin', 'setup', 'support'];
const SETUP: AdminRole[] = ['setup'];
const ADMIN: AdminRole[] = ['admin'];

const zRole = z.enum(['admin', 'setup', 'support']);
const NewMember = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(60),
  role: zRole,
  password: z.string().min(10, 'At least 10 characters'),
});
const EditMember = z.object({ name: z.string().trim().min(2).max(60), role: zRole, active: z.boolean(), password: z.string().min(10) }).partial();
const Import = z.object({
  /** where the browser put the workbook in Storage: imports/{uid}/… */
  fileKey: z.string().min(1).max(300),
  fileName: z.string().min(1).max(200),
  mode: z.enum(['merge', 'replace']).default('merge'),
  dryRun: z.boolean().default(true),
  createFunctions: z.boolean().default(true),
});
const FnPatch = z
  .object({
    name: z.string().trim().min(1).max(60),
    date: zDate,
    start: zTime,
    end: zTime.nullable(),
    venueName: z.string().trim().min(1).max(100),
    venueAddress: z.string().max(200).nullable(),
    mapsUrl: z.string().url().max(500).nullable(),
    dressCode: z.string().max(80).nullable(),
    notes: z.string().max(300).nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    icon: z.string().max(20),
    giftPlan: z.string().max(80).nullable(),
    sort: z.number().int().min(0).max(100),
  })
  .partial();
const Reply = z.object({ body: z.string().trim().min(1).max(4000) });

export function teamRoutes() {
  const r = routes('/v1/team', { signedIn: false });

  /** creates the Firebase Auth account (email + password) and the team record */
  r.post('members', async (c) => {
    const b = c.body(NewMember);
    if (await auth().getUserByEmail(b.email)) throw conflict('EMAIL_TAKEN', 'This email already has an account');
    const { uid } = await auth().createUser({ email: b.email, password: b.password, displayName: b.name });
    await auth().setRole(uid, b.role);
    await col.admins().doc(uid).set({ email: b.email, name: b.name, role: b.role, active: true, lastLoginAt: null, createdAt: F.now() });
    return { id: uid };
  }, { team: ADMIN });

  r.patch('members/:id', async (c) => {
    const id = c.id('id');
    const { password, ...rest } = c.body(EditMember);
    const cur = await getDoc<Admin>(col.admins().doc(id));
    if (!cur) throw notFound('Admin');
    if (id === c.uid && (rest.active === false || (rest.role && rest.role !== 'admin'))) {
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
  }, { team: ADMIN });

  /** The workbook is in Storage: Vercel takes at most 4.5 MB in a request. Always run with dryRun first. */
  r.post('weddings/:id/guests/import', async (c) => {
    const { fileKey, fileName, ...opts } = c.body(Import);
    if (!fileKey.startsWith(`imports/${c.uid}/`)) throw new AppError('FORBIDDEN', 'You do not have access to this', 403);
    const buffer = await svc.storage.read(fileKey);
    try {
      return await importGuests(c.id('id'), { buffer, originalname: fileName }, opts, c.uid);
    } finally {
      await svc.storage.remove(fileKey);
    }
  }, { team: SETUP, status: 200 });

  r.get('weddings/:id/guests/export', async (c) => {
    const f = await exportGuests(c.id('id'));
    c.send(f.buffer, SHEET, `attachment; filename="${f.name}"`);
  }, { team: ANY });

  r.get('guest-template', async (c) => {
    c.send(await template(), SHEET, 'attachment; filename="invite-karoo-guest-list.xlsx"');
  }, { team: ANY });

  r.post('applications/:id/wedding', (c) => fromApplication(c.id('id'), c.uid), { team: SETUP, status: 200 });

  /** a live wedding's guests are told when a function moves */
  r.patch('weddings/:id/functions/:fid', (c) => updateFunction(c.id('id'), c.id('fid'), c.body(FnPatch), c.uid), { team: SETUP });

  r.post('weddings/:id/handover', (c) => handover(c.id('id'), c.uid), { team: SETUP, status: 200 });

  r.post('tickets/:id/messages', (c) => replyToTicket(c.id('id'), c.body(Reply).body, c.uid), { team: ANY });
}
