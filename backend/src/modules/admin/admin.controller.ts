import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { Throttle } from '@nestjs/throttler';
import { perMinute } from '../../common/throttle';
import type { Response } from 'express';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AdminClaims, AdminGuard, AdminRoles, CurrentAdmin, signAdmin } from '../../common/auth';
import { hashPassword, verifyPassword } from '../../common/crypto';
import { AppError, conflict, notFound } from '../../common/errors';
import { prettyPhone } from '../../common/phone';
import { Zod, zDate, zTime, zUuid } from '../../common/zod';
import { DB, InjectDb } from '../../db/db';
import {
  adminUsers,
  guests,
  hostApplications,
  invites,
  ticketMessages,
  tickets,
  users,
  weddings,
} from '../../db/schema';
import { NotificationsService } from '../infra/notifications.service';
import { StorageService } from '../infra/storage.service';
import { SheetService } from '../sheets/sheet.service';
import { ticketView } from '../support/support.controller';
import { AdminWeddingsService } from './admin-weddings.service';

const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
const NewAdmin = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(60),
  role: z.enum(['admin', 'setup', 'support']),
  password: z.string().min(10, 'At least 10 characters'),
});
const EditAdmin = z.object({ name: z.string().trim().min(2).max(60), role: z.enum(['admin', 'setup', 'support']), active: z.boolean(), password: z.string().min(10) }).partial();
const ChangePw = z.object({ current: z.string().min(1), next: z.string().min(10, 'At least 10 characters') });
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

@ApiTags('admin')
@Controller('v1/admin')
export class AdminAuthController {
  constructor(@InjectDb() private readonly db: DB) {}

  @Post('auth/login')
  @HttpCode(200)
  @Throttle({ default: { limit: perMinute(8), ttl: 60_000 } })
  async login(@Body(new Zod(Login)) b: z.infer<typeof Login>) {
    const [a] = await this.db.select().from(adminUsers).where(eq(adminUsers.email, b.email)).limit(1);
    if (!a || !a.active || !(await verifyPassword(b.password, a.passwordHash))) {
      throw new AppError('BAD_LOGIN', 'Email or password is not right', 401);
    }
    await this.db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, a.id));
    return { token: signAdmin({ sub: a.id, email: a.email, role: a.role }), admin: { id: a.id, email: a.email, name: a.name, role: a.role } };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminController {
  constructor(
    @InjectDb() private readonly db: DB,
    private readonly weddings: AdminWeddingsService,
    private readonly sheets: SheetService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────── me + team ───────── */

  @Get('me')
  async me(@CurrentAdmin() a: AdminClaims) {
    const [row] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, a.sub)).limit(1);
    if (!row) throw notFound('Admin');
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }

  @Post('me/password')
  @HttpCode(200)
  async changePassword(@CurrentAdmin() a: AdminClaims, @Body(new Zod(ChangePw)) b: z.infer<typeof ChangePw>) {
    const [row] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, a.sub)).limit(1);
    if (!row || !(await verifyPassword(b.current, row.passwordHash))) throw new AppError('BAD_LOGIN', 'Current password is not right', 400);
    await this.db.update(adminUsers).set({ passwordHash: await hashPassword(b.next) }).where(eq(adminUsers.id, a.sub));
    return { ok: true };
  }

  @Get('team')
  @AdminRoles('admin')
  async team() {
    const rows = await this.db.select().from(adminUsers).orderBy(asc(adminUsers.name));
    return rows.map(({ passwordHash: _p, ...r }) => r);
  }

  @Post('team')
  @AdminRoles('admin')
  async addTeam(@Body(new Zod(NewAdmin)) b: z.infer<typeof NewAdmin>) {
    const [dupe] = await this.db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, b.email)).limit(1);
    if (dupe) throw conflict('EMAIL_TAKEN', 'This email already has an account');
    const [row] = await this.db.insert(adminUsers).values({ email: b.email, name: b.name, role: b.role, passwordHash: await hashPassword(b.password) }).returning();
    const { passwordHash: _p, ...rest } = row;
    return rest;
  }

  @Patch('team/:id')
  @AdminRoles('admin')
  async editTeam(@Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EditAdmin)) b: z.infer<typeof EditAdmin>) {
    const { password, ...rest } = b;
    const set: Partial<typeof adminUsers.$inferInsert> = { ...rest };
    if (password) set.passwordHash = await hashPassword(password);
    const [row] = await this.db.update(adminUsers).set(set).where(eq(adminUsers.id, id)).returning();
    if (!row) throw notFound('Admin');
    const { passwordHash: _p, ...out } = row;
    return out;
  }

  /* ───────── dashboard ───────── */

  @Get('stats')
  async stats() {
    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const [[u], [u7], [w], [wl], [g], [apps], [tk], [rs]] = await Promise.all([
      this.db.select({ n: count() }).from(users).where(isNull(users.deletedAt)),
      this.db.select({ n: count() }).from(users).where(and(isNull(users.deletedAt), gte(users.createdAt, weekAgo))),
      this.db.select({ n: count() }).from(weddings),
      this.db.select({ n: count() }).from(weddings).where(eq(weddings.status, 'active')),
      this.db.select({ n: count() }).from(guests).where(eq(guests.active, true)),
      this.db.select({ n: count() }).from(hostApplications).where(eq(hostApplications.status, 'new')),
      this.db.select({ n: count() }).from(tickets).where(eq(tickets.status, 'open')),
      this.db.select({ n: count() }).from(invites).where(and(gte(invites.respondedAt, weekAgo))),
    ]);
    return { users: u.n, newUsers7d: u7.n, weddings: w.n, liveWeddings: wl.n, guests: g.n, newApplications: apps.n, openTickets: tk.n, replies7d: rs.n };
  }

  /* ───────── host applications ───────── */

  @Get('applications')
  async applications(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    const where = q.status ? eq(hostApplications.status, q.status as 'new') : undefined;
    const rows = await this.db
      .select({ a: hostApplications, u: users, admin: adminUsers.name })
      .from(hostApplications)
      .leftJoin(users, eq(users.id, hostApplications.userId))
      .leftJoin(adminUsers, eq(adminUsers.id, hostApplications.assignedTo))
      .where(where)
      .orderBy(desc(hostApplications.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const [{ n }] = await this.db.select({ n: count() }).from(hostApplications).where(where);
    return {
      total: n,
      items: rows.map(({ a, u, admin }) => ({
        ...a,
        phonePretty: prettyPhone(a.phone),
        applicant: u ? `${u.firstName} ${u.familyName}` : null,
        assignedName: admin,
      })),
    };
  }

  @Get('applications/:id')
  async application(@Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.select().from(hostApplications).where(eq(hostApplications.id, id)).limit(1);
    if (!row) throw notFound('Application');
    return { ...row, phonePretty: prettyPhone(row.phone) };
  }

  @Get('applications/:id/file/:which')
  async applicationFile(@Param('id', ParseUUIDPipe) id: string, @Param('which') which: string, @Res() res: Response) {
    const [row] = await this.db.select().from(hostApplications).where(eq(hostApplications.id, id)).limit(1);
    const f = which === 'card' ? row?.cardFile : which === 'guests' ? row?.guestFile : null;
    if (!f) throw notFound('File');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/"/g, '')}"`);
    res.send(await this.storage.read(f.key));
  }

  @Patch('applications/:id')
  async patchApplication(@Param('id', ParseUUIDPipe) id: string, @Body(new Zod(AppPatch)) b: z.infer<typeof AppPatch>) {
    const [row] = await this.db.update(hostApplications).set({ ...b, updatedAt: new Date() }).where(eq(hostApplications.id, id)).returning();
    if (!row) throw notFound('Application');
    return row;
  }

  /** turns an application into a draft wedding, importing its sheet if it came with one */
  @Post('applications/:id/create-wedding')
  @AdminRoles('setup')
  createFromApplication(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string) {
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
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.weddings.get(id);
  }

  @Patch('weddings/:id')
  @AdminRoles('setup')
  update(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(WeddingPatch)) b: z.infer<typeof WeddingPatch>) {
    return this.weddings.update(id, b, a.sub);
  }

  @Post('weddings/:id/handover')
  @HttpCode(200)
  @AdminRoles('setup')
  handover(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.weddings.handover(id, a.sub);
  }

  @Post('weddings/:id/functions')
  @AdminRoles('setup')
  addFn(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(FnIn)) b: z.infer<typeof FnIn>) {
    return this.weddings.addFunction(id, b, a.sub);
  }

  @Patch('weddings/:id/functions/:fid')
  @AdminRoles('setup')
  editFn(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Param('fid', ParseUUIDPipe) fid: string, @Body(new Zod(FnIn.partial())) b: Partial<z.infer<typeof FnIn>>) {
    return this.weddings.updateFunction(id, fid, b, a.sub);
  }

  @Delete('weddings/:id/functions/:fid')
  @AdminRoles('setup')
  deleteFn(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Param('fid', ParseUUIDPipe) fid: string) {
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
  import(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Query(new Zod(ImportOpts)) q: z.infer<typeof ImportOpts>, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose the guest list file');
    this.storage.check('sheet', file);
    return this.weddings.importGuests(id, file, q, a.sub);
  }

  @Get('weddings/:id/guests/export')
  async export(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.weddings.exportGuests(id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.send(f.buffer);
  }

  @Get('weddings/:id/guests')
  guests(@Param('id', ParseUUIDPipe) id: string, @Query(new Zod(GuestPage)) q: z.infer<typeof GuestPage>) {
    return this.weddings.guests(id, q);
  }

  @Post('weddings/:id/guests')
  @AdminRoles('setup')
  addGuest(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(GuestIn)) b: z.infer<typeof GuestIn>) {
    return this.weddings.upsertGuest(id, null, b, a.sub);
  }

  @Put('weddings/:id/guests/:gid')
  @AdminRoles('setup')
  editGuest(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string, @Body(new Zod(GuestIn)) b: z.infer<typeof GuestIn>) {
    return this.weddings.upsertGuest(id, gid, b, a.sub);
  }

  @Patch('weddings/:id/guests/:gid')
  @AdminRoles('setup')
  guestActive(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Param('gid', ParseUUIDPipe) gid: string, @Body(new Zod(Active)) b: z.infer<typeof Active>) {
    return this.weddings.setGuestActive(id, gid, b.active, a.sub);
  }

  @Post('weddings/:id/media')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 60 * 1024 * 1024 } }))
  addMedia(@Param('id', ParseUUIDPipe) id: string, @Query(new Zod(MediaKind)) q: z.infer<typeof MediaKind>, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose a photo');
    return this.weddings.addMedia(id, q.kind, file);
  }

  @Put('weddings/:id/media/order')
  @AdminRoles('setup')
  orderMedia(@Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Order)) b: z.infer<typeof Order>) {
    return this.weddings.reorderMedia(id, b.ids);
  }

  @Delete('weddings/:id/media/:mid')
  @AdminRoles('setup')
  removeMedia(@Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string) {
    return this.weddings.removeMedia(id, mid);
  }

  /** multipart: `pdf` (the card) + optional `pages` (an image per page, for quick viewing) */
  @Post('weddings/:id/card')
  @AdminRoles('setup')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'pdf', maxCount: 1 }, { name: 'pages', maxCount: 12 }]))
  card(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: { pdf?: Express.Multer.File[]; pages?: Express.Multer.File[] }) {
    const pdf = files?.pdf?.[0];
    if (!pdf) throw new AppError('NO_FILE', 'Choose the card PDF');
    return this.weddings.setCard(id, pdf, files.pages ?? []);
  }

  @Post('weddings/:id/voice')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file'))
  voice(@Param('id', ParseUUIDPipe) id: string, @Query(new Zod(Voice)) q: z.infer<typeof Voice>, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Choose the recording');
    return this.weddings.setVoice(id, file, q.durationSec);
  }

  @Post('weddings/:id/photo/:who')
  @AdminRoles('setup')
  @UseInterceptors(FileInterceptor('file'))
  personPhoto(@Param('id', ParseUUIDPipe) id: string, @Param('who') who: string, @UploadedFile() file?: Express.Multer.File) {
    if (!['bride', 'groom', 'brideFamily', 'groomFamily'].includes(who)) throw notFound('Photo slot');
    if (!file) throw new AppError('NO_FILE', 'Choose a photo');
    return this.weddings.setPersonPhoto(id, who as 'bride', file);
  }

  @Post('weddings/:id/access')
  @AdminRoles('setup')
  addAccess(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Access)) b: z.infer<typeof Access>) {
    return this.weddings.addAccess(id, b, a.sub);
  }

  @Delete('weddings/:id/access/:aid')
  @AdminRoles('setup')
  removeAccess(@Param('id', ParseUUIDPipe) id: string, @Param('aid', ParseUUIDPipe) aid: string) {
    return this.weddings.removeAccess(id, aid);
  }

  /* ───────── users ───────── */

  @Get('users')
  async users(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    const conds = [isNull(users.deletedAt)];
    if (q.q) {
      const like = `%${q.q}%`;
      conds.push(or(ilike(users.firstName, like), ilike(users.familyName, like), ilike(users.city, like), ilike(users.phone, `%${q.q.replace(/\D/g, '') || 'x'}%`))!);
    }
    const rows = await this.db.select().from(users).where(and(...conds)).orderBy(desc(users.createdAt)).limit(q.limit).offset(q.offset);
    const [{ n }] = await this.db.select({ n: count() }).from(users).where(and(...conds));
    return {
      total: n,
      items: rows.map((u) => ({ id: u.id, name: `${u.firstName} ${u.familyName}`, city: u.city, phonePretty: prettyPhone(u.phone), email: u.email, lang: u.lang, createdAt: u.createdAt })),
    };
  }

  /* ───────── support ───────── */

  @Get('tickets')
  async tickets(@Query(new Zod(Page)) q: z.infer<typeof Page>) {
    const where = q.status ? eq(tickets.status, q.status as 'open') : undefined;
    const rows = await this.db
      .select({ t: tickets, u: users })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.userId))
      .where(where)
      .orderBy(desc(tickets.updatedAt))
      .limit(q.limit)
      .offset(q.offset);
    const [{ n }] = await this.db.select({ n: count() }).from(tickets).where(where);
    return {
      total: n,
      items: rows.map(({ t, u }) => ({ ...ticketView(t), unreadForTeam: t.unreadForTeam, user: { id: u.id, name: `${u.firstName} ${u.familyName}`, phonePretty: prettyPhone(u.phone), city: u.city } })),
    };
  }

  @Get('tickets/:id')
  async ticket(@Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.select({ t: tickets, u: users }).from(tickets).innerJoin(users, eq(users.id, tickets.userId)).where(eq(tickets.id, id)).limit(1);
    if (!row) throw notFound('Ticket');
    await this.db.update(tickets).set({ unreadForTeam: 0 }).where(eq(tickets.id, id));
    const msgs = await this.db
      .select({ m: ticketMessages, admin: adminUsers.name })
      .from(ticketMessages)
      .leftJoin(adminUsers, eq(adminUsers.id, ticketMessages.adminId))
      .where(eq(ticketMessages.ticketId, id))
      .orderBy(asc(ticketMessages.createdAt));
    return {
      ...ticketView(row.t),
      user: { id: row.u.id, name: `${row.u.firstName} ${row.u.familyName}`, phonePretty: prettyPhone(row.u.phone), city: row.u.city },
      messages: msgs.map(({ m, admin }) => ({ id: m.id, author: m.author, adminName: admin, body: m.body, createdAt: m.createdAt })),
    };
  }

  @Post('tickets/:id/messages')
  async replyTicket(@CurrentAdmin() a: AdminClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(TicketReply)) b: z.infer<typeof TicketReply>) {
    const [t] = await this.db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (!t) throw notFound('Ticket');
    await this.db.insert(ticketMessages).values({ ticketId: id, author: 'team', adminId: a.sub, body: b.body });
    await this.db.update(tickets).set({ status: 'answered', unreadForUser: sql`${tickets.unreadForUser} + 1`, updatedAt: new Date() }).where(eq(tickets.id, id));
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
  async patchTicket(@Param('id', ParseUUIDPipe) id: string, @Body(new Zod(TicketPatch)) b: z.infer<typeof TicketPatch>) {
    const [t] = await this.db
      .update(tickets)
      .set({ status: b.status, closedAt: b.status === 'closed' ? new Date() : null, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    if (!t) throw notFound('Ticket');
    return ticketView(t);
  }

  /** guests across all weddings by phone — "which weddings is this number on?" */
  @Get('lookup/phone/:phone')
  async lookup(@Param('phone') phone: string) {
    const digits = phone.replace(/\D/g, '').slice(-10);
    const rows = await this.db
      .select({ g: guests, w: weddings })
      .from(guests)
      .innerJoin(weddings, eq(weddings.id, guests.weddingId))
      .where(ilike(guests.phone, `%${digits}`))
      .limit(50);
    const ids = rows.map((r) => r.g.id);
    const inv = ids.length ? await this.db.select().from(invites).where(inArray(invites.guestId, ids)) : [];
    return rows.map(({ g, w }) => ({
      guestId: g.id,
      name: g.name,
      active: g.active,
      weddingId: w.id,
      wedding: `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}`,
      invites: inv.filter((i) => i.guestId === g.id && i.invited).length,
    }));
  }
}
