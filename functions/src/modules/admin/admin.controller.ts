import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminClaims, AdminGuard, AdminRoles, CurrentAdmin } from '../../common/auth';
import { AppError, conflict, notFound } from '../../common/errors';
import { auth } from '../../common/firebase-auth';
import { prettyPhone } from '../../common/phone';
import { IdPipe, Zod, zDate, zTime, zUuid } from '../../common/zod';
import { col, group } from '../../db/paths';
import { Admin, Application, Guest, Invite, Ticket, TicketMessage, User, Wedding } from '../../db/models';
import { byIds, db, F, getDoc, getRows } from '../../db/store';
import { NotificationsService } from '../infra/notifications.service';
import { StorageService } from '../infra/storage.service';
import { SheetService } from '../sheets/sheet.service';
import { ticketView } from '../support/support.controller';
import { AdminWeddingsService } from './admin-weddings.service';

const NewAdmin = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(60),
  role: z.enum(['admin', 'setup', 'support']),
  password: z.string().min(10, 'At least 10 characters'),
});
const EditAdmin = z.object({ name: z.string().trim().min(2).max(60), role: z.enum(['admin', 'setup', 'support']), active: z.boolean(), password: z.string().min(10) }).partial();
const Page = z.object({ q: z.string().max(80).optional(), status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const AppPatch = z.object({ status: z.enum(['new', 'in_setup', 'live', 'rejected']), assignedTo: zUuid.nullable(), adminNotes: z.string().max(2000) }).partial();
const person = z.object({ name: z.string().trim().min(1).max(60), parents: z.string().max(80).optional(), city: z.string().max(40).optional(), photoUrl: z.string().nullable().optional() });
const family = z.object({ name: z.string().trim().min(1).max(60), elders: z.array(z.string().max(60)).max(10).default([]), city: z.string().max(40).optional(), photoUrl: z.string().nullable().optional() });
const WeddingIn = z.object({
  ownerPhone: z.string().min(6).max(20),
  contactPhone: z.string().max(20).nullable().optional(),
  city: z.string().trim().min(2).max(40),
  timezone: z.string().max(40).optional(),
  startDate: zDate,
  endDate: zDate,
  datesLocked: z.boolean().optional(),
  bride: person,
  groom: person,
  brideFamily: family,
  groomFamily: family,
});
const WeddingPatch = WeddingIn.partial().extend({
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
  statusReason: z.string().max(200).nullable().optional(),
  sendingEnabled: z.boolean().optional(),
});
const FnIn = z.object({
  name: z.string().trim().min(1).max(60),
  date: zDate,
  start: zTime,
  end: zTime.nullable().optional(),
  venueName: z.string().trim().min(1).max(100),
  venueAddress: z.string().max(200).nullable().optional(),
  mapsUrl: z.string().url().max(500).nullable().optional(),
  dressCode: z.string().max(80).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(20).optional(),
  giftPlan: z.string().max(80).nullable().optional(),
  sort: z.number().int().min(0).max(100).optional(),
});
const ImportOpts = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  dryRun: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  createFunctions: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});
const GuestIn = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().min(6).max(20),
  side: z.enum(['bride', 'groom']),
  relation: z.string().max(40).default(''),
  expectedPax: z.number().int().min(1).max(20).default(1),
  notes: z.string().max(300).default(''),
  functions: z.array(z.object({ functionId: zUuid, giftOut: z.boolean().default(false) })).min(1, 'Pick at least one function'),
});
const GuestPage = z.object({ q: z.string().max(60).optional(), removed: z.enum(['1', '0']).optional().transform((v) => v === '1'), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) });
const Active = z.object({ active: z.boolean() });
const MediaKind = z.object({ kind: z.enum(['cover', 'couple', 'family']) });
const Order = z.object({ ids: z.array(zUuid).max(50) });
const Voice = z.object({ durationSec: z.coerce.number().int().min(1).max(600).optional() });
const Access = z.object({ name: z.string().trim().min(1).max(60), phone: z.string().min(6).max(20), relation: z.string().trim().min(1).max(40) });
const TicketReply = z.object({ body: z.string().trim().min(1).max(4000) });
const TicketPatch = z.object({ status: z.enum(['open', 'answered', 'closed']) });


const page = <T>(xs: T[], q: { limit: number; offset: number }) => xs.slice(q.offset, q.offset + q.limit);
const byNewest = <T extends { createdAt: Date }>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();

/**
 * The Invite Karoo team's API. Team members sign in to Firebase Auth with email + password in the
 * dashboard; their ID token carries the custom claim `ikRole`. There is no sign-in route here.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly weddings: AdminWeddingsService,
    private readonly sheets: SheetService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────── me + team ───────── */

  @Get('me')
  async me(@CurrentAdmin() a: AdminClaims) {
    const row = await getDoc<Admin>(col.admins().doc(a.sub));
    if (!row || !row.active) throw new AppError('NOT_TEAM', 'This account is not on the Invite Karoo team', 403);
    await col.admins().doc(a.sub).update({ lastLoginAt: F.now() });
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }

  @Get('team')
  @AdminRoles('admin')
  async team() {
    return (await getRows<Admin>(col.admins())).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** creates the Firebase Auth account (email + password) and the team record */
  @Post('team')
  @AdminRoles('admin')
  async addTeam(@Body(new Zod(NewAdmin)) b: z.infer<typeof NewAdmin>) {
    if (await auth().getUserByEmail(b.email)) throw conflict('EMAIL_TAKEN', 'This email already has an account');
    const { uid } = await auth().createUser({ email: b.email, password: b.password, displayName: b.name });
    await auth().setRole(uid, b.role);
    await col.admins().doc(uid).set({ email: b.email, name: b.name, role: b.role, active: true, lastLoginAt: null, createdAt: F.now() });
    return getDoc<Admin>(col.admins().doc(uid));
  }

  @Patch('team/:id')
  @AdminRoles('admin')
  async editTeam(@CurrentAdmin() me: AdminClaims, @Param('id', IdPipe) id: string, @Body(new Zod(EditAdmin)) b: z.infer<typeof EditAdmin>) {
    const cur = await getDoc<Admin>(col.admins().doc(id));
    if (!cur) throw notFound('Admin');
    if (id === me.sub && (b.active === false || (b.role && b.role !== 'admin'))) {
      throw new AppError('SELF_LOCKOUT', 'You cannot switch off or demote your own account', 409);
    }
    const { password, ...rest } = b;
    if (password || rest.active !== undefined || rest.name) {
      await auth().updateUser(id, { password, disabled: rest.active === undefined ? undefined : !rest.active, displayName: rest.name });
    }
    const role = rest.role ?? cur.role;
    const active = rest.active ?? cur.active;
    await auth().setRole(id, active ? role : null);
    // role or access changes take effect at once: old tokens stop working
    if (rest.role !== undefined || rest.active === false || password) await auth().revoke(id);
    await col.admins().doc(id).update({ ...rest });
    return getDoc<Admin>(col.admins().doc(id));
  }

  /* ───────── dashboard ───────── */

  @Get('stats')
  async stats() {
    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const n = async (q: { count(): { get(): Promise<{ data(): { count: number } }> } }) => (await q.count().get()).data().count;
    const [u, u7, w, wl, g, apps, tk, rs] = await Promise.all([
      n(col.users().where('deletedAt', '==', null)),
      n(col.users().where('deletedAt', '==', null).where('createdAt', '>=', weekAgo)),
      n(col.weddings()),
      n(col.weddings().where('status', '==', 'active')),
      n(group.guests().where('active', '==', true)),
      n(col.applications().where('status', '==', 'new')),
      n(col.tickets().where('status', '==', 'open')),
      n(group.invites().where('respondedAt', '>=', weekAgo)),
    ]);
    return { users: u, newUsers7d: u7, weddings: w, liveWeddings: wl, guests: g, newApplications: apps, openTickets: tk, replies7d: rs };
  }

  /* ───────── host applications ───────── */

  @Get('applications')
  async applications(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    const all = (await getRows<Application>(q.status ? col.applications().where('status', '==', q.status) : col.applications())).sort(byNewest);
    const rows = page(all, q);
    const users = await byIds<User>(col.users(), rows.map((a) => a.userId ?? ''));
    const admins = await byIds<Admin>(col.admins(), rows.map((a) => a.assignedTo ?? ''));
    return {
      total: all.length,
      items: rows.map((a) => {
        const u = a.userId ? users.get(a.userId) : undefined;
        return {
          ...a,
          phonePretty: prettyPhone(a.phone),
          applicant: u ? `${u.firstName} ${u.familyName}` : null,
          assignedName: a.assignedTo ? (admins.get(a.assignedTo)?.name ?? null) : null,
        };
      }),
    };
  }

  @Get('applications/:id')
  async application(@Param('id', IdPipe) id: string) {
    const row = await getDoc<Application>(col.applications().doc(id));
    if (!row) throw notFound('Application');
    return { ...row, phonePretty: prettyPhone(row.phone) };
  }

  @Get('applications/:id/file/:which')
  async applicationFile(@Param('id', IdPipe) id: string, @Param('which') which: string, @Res() res: Response) {
    const row = await getDoc<Application>(col.applications().doc(id));
    const f = which === 'card' ? row?.cardFile : which === 'guests' ? row?.guestFile : null;
    if (!f) throw notFound('File');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/"/g, '')}"`);
    res.send(await this.storage.read(f.key));
  }

  @Patch('applications/:id')
  async patchApplication(@Param('id', IdPipe) id: string, @Body(new Zod(AppPatch)) b: z.infer<typeof AppPatch>) {
    if (!(await col.applications().doc(id).get()).exists) throw notFound('Application');
    await col.applications().doc(id).update({ ...b, updatedAt: F.now() });
    return getDoc<Application>(col.applications().doc(id));
  }

  /** turns an application into a draft wedding, importing its sheet if it came with one */
  @Post('applications/:id/create-wedding')
  @AdminRoles('setup')
  createFromApplication(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string) {
    return this.weddings.fromApplication(id, a.sub);
  }

  /* ───────── weddings ───────── */

  @Get('weddings')
  list(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    return this.weddings.list(q);
  }

  @Post('weddings')
  @AdminRoles('setup')
  create(@CurrentAdmin() a: AdminClaims, @Body(new Zod(WeddingIn)) b: z.infer<typeof WeddingIn>) {
    return this.weddings.create(b, a.sub);
  }

  @Get('weddings/:id')
  get(@Param('id', IdPipe) id: string) {
    return this.weddings.get(id);
  }

  @Patch('weddings/:id')
  @AdminRoles('setup')
  update(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Body(new Zod(WeddingPatch)) b: z.infer<typeof WeddingPatch>) {
    return this.weddings.update(id, b, a.sub);
  }

  @Post('weddings/:id/handover')
  @HttpCode(200)
  @AdminRoles('setup')
  handover(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string) {
    return this.weddings.handover(id, a.sub);
  }

  @Post('weddings/:id/functions')
  @AdminRoles('setup')
  addFn(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Body(new Zod(FnIn)) b: z.infer<typeof FnIn>) {
    return this.weddings.addFunction(id, b, a.sub);
  }

  @Patch('weddings/:id/functions/:fid')
  @AdminRoles('setup')
  editFn(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Param('fid', IdPipe) fid: string, @Body(new Zod(FnIn.partial())) b: Partial<z.infer<typeof FnIn>>) {
    return this.weddings.updateFunction(id, fid, b, a.sub);
  }

  @Delete('weddings/:id/functions/:fid')
  @AdminRoles('setup')
  deleteFn(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Param('fid', IdPipe) fid: string) {
    return this.weddings.deleteFunction(id, fid, a.sub);
  }

  @Get('guest-template')
  async template(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="invite-karoo-guest-list.xlsx"');
    res.send(await this.sheets.template());
  }

  /** multipart `file` + query mode/dryRun/createFunctions. Always run with dryRun=true first. */
  @Post('weddings/:id/guests/import')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file'))
  import(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Query(new Zod(ImportOpts)) q: z.infer<typeof ImportOpts>, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose the guest list file');
    this.storage.check('sheet', file);
    return this.weddings.importGuests(id, file, q, a.sub);
  }

  @Get('weddings/:id/guests/export')
  async export(@Param('id', IdPipe) id: string, @Res() res: Response) {
    const f = await this.weddings.exportGuests(id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.send(f.buffer);
  }

  @Get('weddings/:id/guests')
  guests(@Param('id', IdPipe) id: string, @Query(new Zod(GuestPage)) q: z.infer<typeof GuestPage>) {
    return this.weddings.guests(id, q);
  }

  @Post('weddings/:id/guests')
  @AdminRoles('setup')
  addGuest(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Body(new Zod(GuestIn)) b: z.infer<typeof GuestIn>) {
    return this.weddings.upsertGuest(id, null, b, a.sub);
  }

  @Put('weddings/:id/guests/:gid')
  @AdminRoles('setup')
  editGuest(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Param('gid', IdPipe) gid: string, @Body(new Zod(GuestIn)) b: z.infer<typeof GuestIn>) {
    return this.weddings.upsertGuest(id, gid, b, a.sub);
  }

  @Patch('weddings/:id/guests/:gid')
  @AdminRoles('setup')
  guestActive(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Param('gid', IdPipe) gid: string, @Body(new Zod(Active)) b: z.infer<typeof Active>) {
    return this.weddings.setGuestActive(id, gid, b.active, a.sub);
  }

  @Post('weddings/:id/media')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  addMedia(@Param('id', IdPipe) id: string, @Query(new Zod(MediaKind)) q: z.infer<typeof MediaKind>, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose a photo');
    return this.weddings.addMedia(id, q.kind, file);
  }

  @Put('weddings/:id/media/order')
  @AdminRoles('setup')
  orderMedia(@Param('id', IdPipe) id: string, @Body(new Zod(Order)) b: z.infer<typeof Order>) {
    return this.weddings.reorderMedia(id, b.ids);
  }

  @Delete('weddings/:id/media/:mid')
  @AdminRoles('setup')
  removeMedia(@Param('id', IdPipe) id: string, @Param('mid', IdPipe) mid: string) {
    return this.weddings.removeMedia(id, mid);
  }

  /** multipart: `pdf` (the card) + optional `pages` (an image per page, for quick viewing) */
  @Post('weddings/:id/card')
  @AdminRoles('setup')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'pdf', maxCount: 1 }, { name: 'pages', maxCount: 12 }]))
  card(@Param('id', IdPipe) id: string, @UploadedFiles() files: { pdf?: Express.Multer.File[]; pages?: Express.Multer.File[] }) {
    const pdf = files?.pdf?.[0];
    if (!pdf) throw new AppError('NO_FILE', 'Choose the card PDF');
    return this.weddings.setCard(id, pdf, files.pages ?? []);
  }

  @Post('weddings/:id/voice')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file'))
  voice(@Param('id', IdPipe) id: string, @Query(new Zod(Voice)) q: z.infer<typeof Voice>, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose the recording');
    return this.weddings.setVoice(id, file, q.durationSec);
  }

  @Post('weddings/:id/photo/:who')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file'))
  personPhoto(@Param('id', IdPipe) id: string, @Param('who') who: string, @UploadedFile() file?: Express.Multer.File) {
    if (!['bride', 'groom', 'brideFamily', 'groomFamily'].includes(who)) throw notFound('Photo slot');
    if (!file) throw new AppError('NO_FILE', 'Choose a photo');
    return this.weddings.setPersonPhoto(id, who as 'bride', file);
  }

  @Post('weddings/:id/access')
  @AdminRoles('setup')
  addAccess(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Body(new Zod(Access)) b: z.infer<typeof Access>) {
    return this.weddings.addAccess(id, b, a.sub);
  }

  @Delete('weddings/:id/access/:aid')
  @AdminRoles('setup')
  removeAccess(@Param('id', IdPipe) id: string, @Param('aid', IdPipe) aid: string) {
    return this.weddings.removeAccess(id, aid);
  }

  /* ───────── users ───────── */

  @Get('users')
  async users(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    let all = await getRows<User>(col.users().where('deletedAt', '==', null));
    if (q.q) {
      const s = q.q.toLowerCase();
      const digits = q.q.replace(/\D/g, '');
      all = all.filter((u) => u.firstName.toLowerCase().includes(s) || u.familyName.toLowerCase().includes(s) || u.city.toLowerCase().includes(s) || (!!digits && u.phone.includes(digits)));
    }
    all.sort(byNewest);
    return {
      total: all.length,
      items: page(all, q).map((u) => ({ id: u.id, name: `${u.firstName} ${u.familyName}`, city: u.city, phonePretty: prettyPhone(u.phone), email: u.email, lang: u.lang, createdAt: u.createdAt })),
    };
  }

  /* ───────── support ───────── */

  @Get('tickets')
  async tickets(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    const all = (await getRows<Ticket>(q.status ? col.tickets().where('status', '==', q.status) : col.tickets())).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const rows = page(all, q);
    const users = await byIds<User>(col.users(), rows.map((t) => t.userId));
    return {
      total: all.length,
      items: rows.map((t) => {
        const u = users.get(t.userId);
        return { ...ticketView(t), unreadForTeam: t.unreadForTeam, user: { id: t.userId, name: u ? `${u.firstName} ${u.familyName}` : 'Deleted user', phonePretty: u ? prettyPhone(u.phone) : '', city: u?.city ?? '' } };
      }),
    };
  }

  @Get('tickets/:id')
  async ticket(@Param('id', IdPipe) id: string) {
    const t = await getDoc<Ticket>(col.tickets().doc(id));
    if (!t) throw notFound('Ticket');
    const u = await getDoc<User>(col.users().doc(t.userId));
    await col.tickets().doc(id).update({ unreadForTeam: 0 });
    const msgs = (await getRows<TicketMessage>(col.ticketMessages(id))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const admins = await byIds<Admin>(col.admins(), msgs.map((m) => m.adminId ?? ''));
    return {
      ...ticketView(t),
      user: { id: t.userId, name: u ? `${u.firstName} ${u.familyName}` : 'Deleted user', phonePretty: u ? prettyPhone(u.phone) : '', city: u?.city ?? '' },
      messages: msgs.map((m) => ({ id: m.id, author: m.author, adminName: m.adminId ? (admins.get(m.adminId)?.name ?? null) : null, body: m.body, createdAt: m.createdAt })),
    };
  }

  @Post('tickets/:id/messages')
  async replyTicket(@CurrentAdmin() a: AdminClaims, @Param('id', IdPipe) id: string, @Body(new Zod(TicketReply)) b: z.infer<typeof TicketReply>) {
    const t = await getDoc<Ticket>(col.tickets().doc(id));
    if (!t) throw notFound('Ticket');
    const batch = db().batch();
    batch.set(col.ticketMessages(id).doc(), { ticketId: id, author: 'team', adminId: a.sub, body: b.body, createdAt: F.now() });
    batch.update(col.tickets().doc(id), { status: 'answered', unreadForUser: F.inc(1), updatedAt: F.now() });
    await batch.commit();
    await this.notifications.notify([t.userId], {
      cat: 'sys',
      pref: 'msgs',
      title: `Reply from Invite Karoo · IK-${String(t.number).padStart(5, '0')}`,
      body: b.body.length > 120 ? b.body.slice(0, 117) + '…' : b.body,
      action: { type: 'ticket', ticketId: t.id },
    });
    return this.ticket(id);
  }

  @Patch('tickets/:id')
  async patchTicket(@Param('id', IdPipe) id: string, @Body(new Zod(TicketPatch)) b: z.infer<typeof TicketPatch>) {
    if (!(await col.tickets().doc(id).get()).exists) throw notFound('Ticket');
    await col.tickets().doc(id).update({ status: b.status, closedAt: b.status === 'closed' ? F.now() : null, updatedAt: F.now() });
    return ticketView((await getDoc<Ticket>(col.tickets().doc(id)))!);
  }

  /** guests across all weddings by phone — "which weddings is this number on?" */
  @Get('lookup/phone/:phone')
  async lookup(@Param('phone') phone: string) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length < 6) return [];
    // numbers are stored E.164; try the usual country codes for a 10-digit number
    const candidates = [...new Set([`+91${digits}`, `+${phone.replace(/\D/g, '')}`])];
    const gs = (await Promise.all(candidates.map((p) => getRows<Guest>(group.guests().where('phone', '==', p))))).flat().slice(0, 50);
    const ws = await byIds<Wedding>(col.weddings(), gs.map((g) => g.weddingId));
    const inv = await Promise.all(gs.map((g) => getRows<Invite>(col.invites(g.weddingId).where('guestId', '==', g.id).where('invited', '==', true))));
    return gs.map((g, i) => {
      const w = ws.get(g.weddingId);
      return {
        guestId: g.id,
        name: g.name,
        active: g.active,
        weddingId: g.weddingId,
        wedding: w ? `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}` : '',
        invites: inv[i].length,
      };
    });
  }
}
