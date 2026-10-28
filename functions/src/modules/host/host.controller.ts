import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { Zod, zUuid, IdPipe } from '../../common/zod';
import { BlastService } from './blast.service';
import { HostService } from './host.service';

const rsvpVal = z.enum(['none', 'going', 'maybe', 'not_going']);
const GuestQuery = z.object({
  fn: zUuid.optional(),
  status: z.enum(['none', 'going', 'maybe', 'not_going', 'pending']).optional(),
  side: z.enum(['bride', 'groom']).optional(),
  q: z.string().max(60).optional(),
  app: z.enum(['yes', 'no']).optional(),
  removed: z.enum(['1', '0']).optional().transform((v) => v === '1'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const NewGuest = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  phone: z.string().min(6).max(20),
  cc: z.string().regex(/^\+\d{1,4}$/).optional(),
  side: z.enum(['bride', 'groom']),
  relation: z.string().trim().max(40).default(''),
  expectedPax: z.number().int().min(1).max(20).default(1),
  notes: z.string().max(300).default(''),
  functions: z.array(z.object({ functionId: zUuid, giftOut: z.boolean().optional() })).max(30),
});
const EditGuest = z.object({
  name: z.string().trim().min(1).max(60),
  side: z.enum(['bride', 'groom']),
  relation: z.string().trim().max(40),
  expectedPax: z.number().int().min(1).max(20),
  notes: z.string().max(300),
}).partial();
const GuestFn = z.object({ invited: z.boolean(), giftOut: z.boolean().optional() });
const RecordRsvp = z.object({ rsvp: rsvpVal, pax: z.number().int().min(0).max(20).default(1), remark: z.string().max(200).optional() });
const Call = z.object({ outcome: z.enum(['answered', 'no_answer', 'wrong_number', 'call_back']).optional() });
const Board = z.object({ tab: z.enum(['pending', 'going', 'maybe', 'not_going']).default('pending') });
const Blast = z.object({ kind: z.enum(['rsvp_request', 'reminder']), idempotencyKey: z.string().min(8).max(80) });
const BlastPreview = z.object({ kind: z.enum(['rsvp_request', 'reminder']) });
const Nudge = z.object({
  functionId: zUuid,
  audience: z.enum(['all', 'pending', 'going', 'maybe', 'not_going', 'sel', 'one']),
  guestIds: z.array(zUuid).max(500).optional(),
  message: z.string().trim().min(2).max(300),
});
const Category = z.object({ label: z.string().trim().min(2).max(30) });
const CategoryActive = z.object({ active: z.boolean() });
const Gift = z.object({
  functionId: zUuid,
  guestId: zUuid.nullable().optional(),
  giverName: z.string().trim().max(60).optional(),
  giverPhone: z.string().max(20).optional(),
  categoryId: zUuid,
  amount: z.number().int().positive().max(100_000_000).nullable().optional(),
  itemName: z.string().trim().max(80).nullable().optional(),
  note: z.string().max(200).optional(),
  method: z.enum(['qr', 'manual']).default('manual'),
});
const GiftOut = z.object({ given: z.boolean(), method: z.enum(['qr', 'manual']).default('manual'), addToList: z.boolean().default(false) });
const Scan = z.object({ code: z.string().min(4).max(200), functionId: zUuid });
const Family = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().min(6).max(20),
  cc: z.string().regex(/^\+\d{1,4}$/).optional(),
  relation: z.string().trim().min(1).max(40),
  role: z.enum(['cohost', 'giftdesk']).default('cohost'),
});
const FamilyRole = z.object({ role: z.enum(['cohost', 'giftdesk']) });
const FnQuery = z.object({ fn: zUuid.optional() });
const FnRequired = z.object({ fn: zUuid });

/** the wedding console — every route checks the caller is the owner or has family access */
@ApiTags('host')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1/host/weddings/:wid')
export class HostController {
  constructor(
    private readonly host: HostService,
    private readonly blasts: BlastService,
  ) {}

  @Get()
  home(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string) {
    return this.host.home(u.sub, wid);
  }

  @Get('details')
  details(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string) {
    return this.host.details(u.sub, wid);
  }

  @Get('functions')
  functions(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string) {
    return this.host.functionsList(u.sub, wid);
  }

  @Get('functions/:fid')
  fn(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('fid', IdPipe) fid: string) {
    return this.host.functionDetail(u.sub, wid, fid);
  }

  /* guests */

  @Get('guests')
  guests(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Query(new Zod(GuestQuery)) q: z.infer<typeof GuestQuery>) {
    return this.host.guestList(u.sub, wid, q);
  }

  @Post('guests')
  addGuest(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Body(new Zod(NewGuest)) b: z.infer<typeof NewGuest>) {
    return this.host.addGuest(u.sub, wid, b);
  }

  @Get('guests/:gid')
  guest(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('gid', IdPipe) gid: string) {
    return this.host.guestDetail(u.sub, wid, gid);
  }

  @Patch('guests/:gid')
  editGuest(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('gid', IdPipe) gid: string, @Body(new Zod(EditGuest)) b: z.infer<typeof EditGuest>) {
    return this.host.editGuest(u.sub, wid, gid, b);
  }

  @Put('guests/:gid/functions/:fid')
  guestFn(
    @CurrentUser() u: UserClaims,
    @Param('wid', IdPipe) wid: string,
    @Param('gid', IdPipe) gid: string,
    @Param('fid', IdPipe) fid: string,
    @Body(new Zod(GuestFn)) b: z.infer<typeof GuestFn>,
  ) {
    return this.host.setGuestFunction(u.sub, wid, gid, fid, b.invited, b.giftOut);
  }

  @Delete('guests/:gid')
  removeGuest(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('gid', IdPipe) gid: string) {
    return this.host.removeGuest(u.sub, wid, gid);
  }

  @Post('guests/:gid/restore')
  @HttpCode(200)
  restoreGuest(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('gid', IdPipe) gid: string) {
    return this.host.restoreGuest(u.sub, wid, gid);
  }

  /* replies */

  @Get('functions/:fid/rsvp')
  board(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('fid', IdPipe) fid: string, @Query(new Zod(Board)) q: z.infer<typeof Board>) {
    return this.host.rsvpBoard(u.sub, wid, fid, q.tab);
  }

  @Post('invites/:iid/rsvp')
  @HttpCode(200)
  record(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('iid', IdPipe) iid: string, @Body(new Zod(RecordRsvp)) b: z.infer<typeof RecordRsvp>) {
    return this.host.recordRsvp(u.sub, wid, iid, b.rsvp, b.pax, b.remark);
  }

  @Post('invites/:iid/call')
  @HttpCode(200)
  call(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('iid', IdPipe) iid: string, @Body(new Zod(Call)) b: z.infer<typeof Call>) {
    return this.host.logCall(u.sub, wid, iid, b.outcome);
  }

  /* sending */

  @Get('functions/:fid/blasts/preview')
  blastPreview(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('fid', IdPipe) fid: string, @Query(new Zod(BlastPreview)) q: z.infer<typeof BlastPreview>) {
    return this.blasts.preview(u.sub, wid, fid, q.kind);
  }

  @Get('functions/:fid/blasts')
  blastState(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('fid', IdPipe) fid: string) {
    return this.blasts.state(u.sub, wid, fid);
  }

  /** WhatsApp — once per function per kind */
  @Post('functions/:fid/blasts')
  blast(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('fid', IdPipe) fid: string, @Body(new Zod(Blast)) b: z.infer<typeof Blast>) {
    return this.blasts.send(u.sub, wid, fid, b.kind, b.idempotencyKey);
  }

  /** app notification — unlimited */
  @Post('nudges')
  nudge(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Body(new Zod(Nudge)) b: z.infer<typeof Nudge>) {
    return this.host.nudge(u.sub, wid, b);
  }

  @Get('reminders')
  reminders(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string) {
    return this.host.reminderLog(u.sub, wid);
  }

  /* gifts received */

  @Get('gift-categories')
  categories(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string) {
    return this.host.categories(u.sub, wid);
  }

  @Post('gift-categories')
  addCategory(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Body(new Zod(Category)) b: z.infer<typeof Category>) {
    return this.host.addCategory(u.sub, wid, b.label);
  }

  @Patch('gift-categories/:cid')
  categoryActive(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('cid', IdPipe) cid: string, @Body(new Zod(CategoryActive)) b: z.infer<typeof CategoryActive>) {
    return this.host.setCategoryActive(u.sub, wid, cid, b.active);
  }

  @Get('gifts')
  gifts(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Query(new Zod(FnQuery)) q: z.infer<typeof FnQuery>) {
    return this.host.gifts(u.sub, wid, q.fn);
  }

  @Post('gifts')
  recordGift(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Body(new Zod(Gift)) b: z.infer<typeof Gift>) {
    return this.host.recordGift(u.sub, wid, b);
  }

  @Delete('gifts/:id')
  deleteGift(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('id', IdPipe) id: string) {
    return this.host.deleteGift(u.sub, wid, id);
  }

  /* gifts handed out */

  @Get('gift-out')
  giftOut(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Query(new Zod(FnRequired)) q: z.infer<typeof FnRequired>) {
    return this.host.giftOutList(u.sub, wid, q.fn);
  }

  @Post('invites/:iid/gift-out')
  @HttpCode(200)
  markGiftOut(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('iid', IdPipe) iid: string, @Body(new Zod(GiftOut)) b: z.infer<typeof GiftOut>) {
    return this.host.markGiftOut(u.sub, wid, iid, b.given, b.method, b.addToList);
  }

  /** the gift-desk scanner: resolve a guest's QR code at one function */
  @Post('scan')
  @HttpCode(200)
  scan(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Body(new Zod(Scan)) b: z.infer<typeof Scan>) {
    return this.host.scan(u.sub, wid, b.code, b.functionId);
  }

  /* family access */

  @Get('family')
  family(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string) {
    return this.host.family(u.sub, wid);
  }

  @Post('family')
  addFamily(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Body(new Zod(Family)) b: z.infer<typeof Family>) {
    return this.host.addFamily(u.sub, wid, b);
  }

  @Patch('family/:aid')
  familyRole(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('aid', IdPipe) aid: string, @Body(new Zod(FamilyRole)) b: z.infer<typeof FamilyRole>) {
    return this.host.setFamilyRole(u.sub, wid, aid, b.role);
  }

  @Delete('family/:aid')
  removeFamily(@CurrentUser() u: UserClaims, @Param('wid', IdPipe) wid: string, @Param('aid', IdPipe) aid: string) {
    return this.host.removeFamily(u.sub, wid, aid);
  }
}
