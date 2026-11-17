import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { zUuid } from '../../common/zod';
import { routes } from '../../common/http';
import { svc } from '../../services';

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
export function hostRoutes() {
  const r = routes('/v1/host/weddings/:wid');

  r.get('', (c) => svc.host.home(c.uid, c.id('wid')));

  r.get('details', (c) => svc.host.details(c.uid, c.id('wid')));

  r.get('functions', (c) => svc.host.functionsList(c.uid, c.id('wid')));

  r.get('functions/:fid', (c) => svc.host.functionDetail(c.uid, c.id('wid'), c.id('fid')));

  r.get('guests', (c) => svc.host.guestList(c.uid, c.id('wid'), c.query(GuestQuery)));

  r.post('guests', (c) => svc.host.addGuest(c.uid, c.id('wid'), c.body(NewGuest)));

  r.get('guests/:gid', (c) => svc.host.guestDetail(c.uid, c.id('wid'), c.id('gid')));

  r.patch('guests/:gid', (c) => svc.host.editGuest(c.uid, c.id('wid'), c.id('gid'), c.body(EditGuest)));

  r.put('guests/:gid/functions/:fid', (c) => {
    const b = c.body(GuestFn);
    return svc.host.setGuestFunction(c.uid, c.id('wid'), c.id('gid'), c.id('fid'), b.invited, b.giftOut);
  });

  r.delete('guests/:gid', (c) => svc.host.removeGuest(c.uid, c.id('wid'), c.id('gid')));

  r.post('guests/:gid/restore', (c) => svc.host.restoreGuest(c.uid, c.id('wid'), c.id('gid')), { status: 200 });

  r.get('functions/:fid/rsvp', (c) => svc.host.rsvpBoard(c.uid, c.id('wid'), c.id('fid'), c.query(Board).tab));

  r.post('invites/:iid/rsvp', (c) => {
    const b = c.body(RecordRsvp);
    return svc.host.recordRsvp(c.uid, c.id('wid'), c.id('iid'), b.rsvp, b.pax, b.remark);
  }, { status: 200 });

  r.post('invites/:iid/call', (c) => svc.host.logCall(c.uid, c.id('wid'), c.id('iid'), c.body(Call).outcome), { status: 200 });

  r.get('functions/:fid/blasts/preview', (c) => svc.blasts.preview(c.uid, c.id('wid'), c.id('fid'), c.query(BlastPreview).kind));

  r.get('functions/:fid/blasts', (c) => svc.blasts.state(c.uid, c.id('wid'), c.id('fid')));

  /** WhatsApp — once per function per kind */
  r.post('functions/:fid/blasts', (c) => {
    const b = c.body(Blast);
    return svc.blasts.send(c.uid, c.id('wid'), c.id('fid'), b.kind, b.idempotencyKey);
  });

  /** app notification — unlimited */
  r.post('nudges', (c) => svc.host.nudge(c.uid, c.id('wid'), c.body(Nudge)));

  r.get('reminders', (c) => svc.host.reminderLog(c.uid, c.id('wid')));

  r.get('gift-categories', (c) => svc.host.categories(c.uid, c.id('wid')));

  r.post('gift-categories', (c) => svc.host.addCategory(c.uid, c.id('wid'), c.body(Category).label));

  r.patch('gift-categories/:cid', (c) => svc.host.setCategoryActive(c.uid, c.id('wid'), c.id('cid'), c.body(CategoryActive).active));

  r.get('gifts', (c) => svc.host.gifts(c.uid, c.id('wid'), c.query(FnQuery).fn));

  r.post('gifts', (c) => svc.host.recordGift(c.uid, c.id('wid'), c.body(Gift)));

  r.delete('gifts/:id', (c) => svc.host.deleteGift(c.uid, c.id('wid'), c.id('id')));

  r.get('gift-out', (c) => svc.host.giftOutList(c.uid, c.id('wid'), c.query(FnRequired).fn));

  r.post('invites/:iid/gift-out', (c) => {
    const b = c.body(GiftOut);
    return svc.host.markGiftOut(c.uid, c.id('wid'), c.id('iid'), b.given, b.method, b.addToList);
  }, { status: 200 });

  /** the gift-desk scanner: resolve a guest's QR code at one function */
  r.post('scan', (c) => {
    const b = c.body(Scan);
    return svc.host.scan(c.uid, c.id('wid'), b.code, b.functionId);
  }, { status: 200 });

  r.get('family', (c) => svc.host.family(c.uid, c.id('wid')));

  r.post('family', (c) => svc.host.addFamily(c.uid, c.id('wid'), c.body(Family)));

  r.patch('family/:aid', (c) => svc.host.setFamilyRole(c.uid, c.id('wid'), c.id('aid'), c.body(FamilyRole).role));

  r.delete('family/:aid', (c) => svc.host.removeFamily(c.uid, c.id('wid'), c.id('aid')));
}
