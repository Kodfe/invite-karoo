import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, sum } from 'drizzle-orm';
import { DB, InjectDb } from '../../db/db';
import {
  blasts,
  functions,
  giftCategories,
  giftsReceived,
  guests,
  invites,
  nudges,
  users,
  weddingAccess,
  weddingMedia,
} from '../../db/schema';
import { AppError, conflict, notFound } from '../../common/errors';
import { randomToken } from '../../common/crypto';
import { prettyPhone, toE164 } from '../../common/phone';
import { clock12, dayLabel, fnPast, rsvpWindow } from '../../common/time';
import { NotificationsService } from '../infra/notifications.service';
import { AuditService } from '../infra/audit.service';
import { couple } from '../guest/guest.service';
import { AccessLevel, HostAccessService, HostCtx } from './host-access.service';

export const MAX_FAMILY = 5;
type Rsvp = 'none' | 'going' | 'maybe' | 'not_going';
type Counts = { invited: number; going: number; not_going: number; maybe: number; none: number; pax: number; byHost: number };
const zero = (): Counts => ({ invited: 0, going: 0, not_going: 0, maybe: 0, none: 0, pax: 0, byHost: 0 });

/**
 * The wedding console. Everything here reads the wedding the Invite Karoo team imported.
 * The host cannot create or move a function; they run what the team set up —
 * replies, reminders, gifts and family access.
 */
@Injectable()
export class HostService {
  constructor(
    @InjectDb() private readonly db: DB,
    private readonly access: HostAccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  ctx(userId: string, weddingId: string, level: AccessLevel = 'full') {
    return this.access.require(userId, weddingId, level);
  }

  /* ───────────── reads ───────────── */

  private async fns(weddingId: string) {
    return this.db
      .select()
      .from(functions)
      .where(and(eq(functions.weddingId, weddingId), isNull(functions.deletedAt)))
      .orderBy(asc(functions.startsAt), asc(functions.sort));
  }

  private async fnOf(ctx: HostCtx, functionId: string) {
    const [f] = await this.db
      .select()
      .from(functions)
      .where(and(eq(functions.id, functionId), eq(functions.weddingId, ctx.w.id), isNull(functions.deletedAt)))
      .limit(1);
    if (!f) throw notFound('Function');
    return f;
  }

  /** rsvp counts per function, active guests only */
  private async countsByFn(weddingId: string) {
    const rows = await this.db
      .select({
        fn: invites.functionId,
        rsvp: invites.rsvp,
        n: count(),
        pax: sum(invites.pax),
        byHost: sum(sql<number>`case when ${invites.byHost} then 1 else 0 end`),
      })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(eq(invites.weddingId, weddingId), eq(invites.invited, true), eq(guests.active, true)))
      .groupBy(invites.functionId, invites.rsvp);
    const out = new Map<string, Counts>();
    for (const r of rows) {
      const c = out.get(r.fn) ?? zero();
      c.invited += r.n;
      c[r.rsvp as Rsvp] += r.n;
      if (r.rsvp === 'going') c.pax += Number(r.pax ?? 0);
      c.byHost += Number(r.byHost ?? 0);
      out.set(r.fn, c);
    }
    return out;
  }

  private fnView(f: typeof functions.$inferSelect, tz: string) {
    return {
      id: f.id,
      name: f.name,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
      dayLabel: dayLabel(f.startsAt, tz),
      timeLabel: clock12(f.startsAt, tz),
      endLabel: f.endsAt ? clock12(f.endsAt, tz) : null,
      venueName: f.venueName,
      venueAddress: f.venueAddress,
      mapsUrl: f.mapsUrl,
      dressCode: f.dressCode,
      notes: f.notes,
      color: f.color,
      icon: f.icon,
      giftPlan: f.giftPlan,
      past: fnPast(f),
      window: rsvpWindow(f).state,
      closesAt: rsvpWindow(f).closesAt,
    };
  }

  async home(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const { w } = ctx;
    const fns = await this.fns(w.id);
    const counts = await this.countsByFn(w.id);
    const bl = await this.db.select().from(blasts).where(eq(blasts.weddingId, w.id));
    const giftOut = await this.db
      .select({ fn: invites.functionId, planned: count(), given: sum(sql<number>`case when ${invites.giftOutGiven} then 1 else 0 end`) })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(eq(invites.weddingId, w.id), eq(invites.giftOut, true), eq(invites.invited, true), eq(guests.active, true)))
      .groupBy(invites.functionId);
    const received = await this.db
      .select({ fn: giftsReceived.functionId, n: count(), cash: sum(giftsReceived.amount) })
      .from(giftsReceived)
      .where(and(eq(giftsReceived.weddingId, w.id), isNull(giftsReceived.deletedAt)))
      .groupBy(giftsReceived.functionId);
    const [{ n: guestCount }] = await this.db
      .select({ n: count() })
      .from(guests)
      .where(and(eq(guests.weddingId, w.id), eq(guests.active, true)));
    const [{ n: appJoined }] = await this.db
      .select({ n: count() })
      .from(guests)
      .innerJoin(users, and(eq(users.phone, guests.phone), isNull(users.deletedAt)))
      .where(and(eq(guests.weddingId, w.id), eq(guests.active, true)));
    const recent = await this.db
      .select({ inv: invites, g: guests, f: functions })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .innerJoin(functions, eq(functions.id, invites.functionId))
      .where(and(eq(invites.weddingId, w.id), isNotNull(invites.respondedAt), ne(invites.rsvp, 'none'), eq(guests.active, true)))
      .orderBy(desc(invites.respondedAt))
      .limit(6);

    // wedding-wide: a guest counts once — "going" if going to anything
    const wide = await this.db
      .select({ g: invites.guestId, rsvps: sql<string[]>`array_agg(${invites.rsvp}::text)` })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(eq(invites.weddingId, w.id), eq(invites.invited, true), eq(guests.active, true)))
      .groupBy(invites.guestId);
    const totals = { guests: guestCount, appJoined, going: 0, not_going: 0, pending: 0 };
    for (const r of wide) {
      if (r.rsvps.includes('going')) totals.going++;
      else if (r.rsvps.every((x) => x === 'not_going')) totals.not_going++;
      else totals.pending++;
    }

    const functionsOut = fns.map((f) => {
      const c = counts.get(f.id) ?? zero();
      const go = giftOut.find((x) => x.fn === f.id);
      const rc = received.find((x) => x.fn === f.id);
      const b = (k: 'rsvp_request' | 'reminder') => {
        const row = bl.find((x) => x.functionId === f.id && x.kind === k);
        return row ? { state: row.state, sentAt: row.sentAt, recipientCount: row.recipientCount } : null;
      };
      return {
        ...this.fnView(f, w.timezone),
        counts: c,
        blasts: { rsvp_request: b('rsvp_request'), reminder: b('reminder') },
        giftOut: { planned: go?.planned ?? 0, given: Number(go?.given ?? 0) },
        giftsReceived: { count: rc?.n ?? 0, cash: Number(rc?.cash ?? 0) },
      };
    });
    const alerts = functionsOut
      .filter((f) => !f.past && !f.blasts.rsvp_request && f.counts.invited > 0)
      .map((f) => ({ functionId: f.id, kind: 'not_sent', text: `${f.name}: invitations have not gone out on WhatsApp yet` }));
    if (!w.sendingEnabled) alerts.unshift({ functionId: '', kind: 'sending_off', text: 'Sending is switched off for this wedding. Contact the Invite Karoo team.' });

    return {
      wedding: {
        id: w.id,
        couple: couple(w),
        bride: w.bride.name,
        groom: w.groom.name,
        families: `${w.groomFamily.name} & ${w.brideFamily.name}`,
        city: w.city,
        startDate: w.startDate,
        endDate: w.endDate,
        status: w.status,
        sendingEnabled: w.sendingEnabled,
        contactPhone: w.contactPhone ? prettyPhone(w.contactPhone) : null,
      },
      me: { role: ctx.role, name: ctx.name },
      totals,
      functions: functionsOut,
      recent: recent.map(({ inv, g, f }) => ({
        guestId: g.id,
        name: g.name,
        phonePretty: prettyPhone(g.phone),
        functionId: f.id,
        functionName: f.name,
        color: f.color,
        rsvp: inv.rsvp,
        pax: inv.pax,
        byHost: inv.byHost,
        at: inv.respondedAt,
      })),
      alerts,
      gifts: {
        received: received.reduce((a, r) => a + r.n, 0),
        cash: received.reduce((a, r) => a + Number(r.cash ?? 0), 0),
      },
    };
  }

  /** what the guests see: cover, couple, card, voice, galleries and every function */
  async details(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const { w } = ctx;
    const fns = await this.fns(w.id);
    const media = await this.db.select().from(weddingMedia).where(eq(weddingMedia.weddingId, w.id)).orderBy(asc(weddingMedia.sort));
    const access = await this.db
      .select({ name: weddingAccess.name, relation: weddingAccess.relation })
      .from(weddingAccess)
      .where(and(eq(weddingAccess.weddingId, w.id), isNull(weddingAccess.removedAt)));
    const m = (kind: string) => media.filter((x) => x.kind === kind).map((x) => ({ id: x.id, type: x.type, url: x.url, posterUrl: x.posterUrl }));
    return {
      id: w.id,
      couple: couple(w),
      city: w.city,
      startDate: w.startDate,
      endDate: w.endDate,
      status: w.status,
      bride: { name: w.bride.name, parents: w.bride.parents ?? null, photoUrl: w.bride.photoUrl ?? null },
      groom: { name: w.groom.name, parents: w.groom.parents ?? null, photoUrl: w.groom.photoUrl ?? null },
      families: {
        brideSide: { name: w.brideFamily.name, elders: w.brideFamily.elders, photoUrl: w.brideFamily.photoUrl ?? null },
        groomSide: { name: w.groomFamily.name, elders: w.groomFamily.elders, photoUrl: w.groomFamily.photoUrl ?? null },
      },
      cover: m('cover'),
      coupleGallery: m('couple'),
      familyGallery: m('family'),
      card: w.card ? { name: w.card.name, sizeMb: Math.round((w.card.size / 1048576) * 10) / 10, pages: w.card.pages, pdfUrl: null } : null,
      voice: w.voice ? { url: w.voice.url, durationSec: w.voice.durationSec ?? null } : null,
      contact: w.contactPhone ? { phone: w.contactPhone, phonePretty: prettyPhone(w.contactPhone) } : null,
      hosts: [
        { name: w.groomFamily.name, relation: 'Groom’s family' },
        { name: w.brideFamily.name, relation: 'Bride’s family' },
        ...access,
      ],
      nameOnList: null,
      functions: fns.map((f) => ({ ...this.fnView(f, w.timezone), weddingId: w.id, mine: false })),
    };
  }

  async functionsList(userId: string, weddingId: string) {
    return (await this.home(userId, weddingId)).functions;
  }

  async functionDetail(userId: string, weddingId: string, functionId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const f = await this.fnOf(ctx, functionId);
    const home = await this.home(userId, weddingId);
    return home.functions.find((x) => x.id === f.id);
  }

  /** guest list with each guest's row on every function. Filter by function + reply, side, search. */
  async guestList(
    userId: string,
    weddingId: string,
    q: { fn?: string; status?: Rsvp | 'pending'; side?: 'bride' | 'groom'; q?: string; app?: 'yes' | 'no'; removed?: boolean; limit: number; offset: number },
  ) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const conds = [eq(guests.weddingId, ctx.w.id), eq(guests.active, !q.removed)];
    if (q.side) conds.push(eq(guests.side, q.side));
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      conds.push(or(ilike(guests.name, like), ilike(guests.phone, `%${q.q.replace(/\D/g, '') || 'x'}%`), ilike(guests.relation, like))!);
    }
    if (q.fn) {
      const sub = this.db
        .select({ g: invites.guestId })
        .from(invites)
        .where(
          and(
            eq(invites.functionId, q.fn),
            eq(invites.invited, true),
            q.status ? (q.status === 'pending' ? eq(invites.rsvp, 'none') : eq(invites.rsvp, q.status)) : undefined,
          ),
        );
      conds.push(inArray(guests.id, sub));
    }
    const base = this.db
      .select({ g: guests, uid: users.id })
      .from(guests)
      .leftJoin(users, and(eq(users.phone, guests.phone), isNull(users.deletedAt)))
      .where(and(...conds, q.app === 'yes' ? isNotNull(users.id) : q.app === 'no' ? isNull(users.id) : undefined));
    const [{ n: total }] = await this.db
      .select({ n: count() })
      .from(guests)
      .leftJoin(users, and(eq(users.phone, guests.phone), isNull(users.deletedAt)))
      .where(and(...conds, q.app === 'yes' ? isNotNull(users.id) : q.app === 'no' ? isNull(users.id) : undefined));
    // guests without the app come first: they are the ones the host has to call
    const rows = await base.orderBy(sql`${users.id} is not null`, asc(guests.name)).limit(q.limit).offset(q.offset);
    const ids = rows.map((r) => r.g.id);
    const inv = ids.length
      ? await this.db.select().from(invites).where(and(inArray(invites.guestId, ids), eq(invites.invited, true)))
      : [];
    return {
      total,
      guests: rows.map(({ g, uid }) => ({
        ...this.guestView(g, !!uid),
        functions: inv
          .filter((i) => i.guestId === g.id)
          .map((i) => ({ inviteId: i.id, functionId: i.functionId, rsvp: i.rsvp, pax: i.pax, byHost: i.byHost, giftOut: i.giftOut, giftOutGiven: i.giftOutGiven, callAttempts: i.callAttempts })),
      })),
    };
  }

  private guestView(g: typeof guests.$inferSelect, appJoined: boolean) {
    return {
      id: g.id,
      name: g.name,
      phone: g.phone,
      phonePretty: prettyPhone(g.phone),
      side: g.side,
      relation: g.relation,
      expectedPax: g.expectedPax,
      notes: g.notes,
      active: g.active,
      appJoined,
      createdVia: g.createdVia,
    };
  }

  private async guestOf(ctx: HostCtx, guestId: string) {
    const [g] = await this.db.select().from(guests).where(and(eq(guests.id, guestId), eq(guests.weddingId, ctx.w.id))).limit(1);
    if (!g) throw notFound('Guest');
    return g;
  }

  async guestDetail(userId: string, weddingId: string, guestId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const g = await this.guestOf(ctx, guestId);
    const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.phone, g.phone), isNull(users.deletedAt))).limit(1);
    const fns = await this.fns(ctx.w.id);
    const inv = await this.db.select().from(invites).where(eq(invites.guestId, g.id));
    const gifts = await this.db
      .select({ gift: giftsReceived, cat: giftCategories })
      .from(giftsReceived)
      .innerJoin(giftCategories, eq(giftCategories.id, giftsReceived.categoryId))
      .where(and(eq(giftsReceived.guestId, g.id), isNull(giftsReceived.deletedAt)));
    return {
      ...this.guestView(g, !!u),
      functions: fns.map((f) => {
        const i = inv.find((x) => x.functionId === f.id);
        return {
          functionId: f.id,
          name: f.name,
          dayLabel: dayLabel(f.startsAt, ctx.w.timezone),
          timeLabel: clock12(f.startsAt, ctx.w.timezone),
          color: f.color,
          past: fnPast(f),
          window: rsvpWindow(f).state,
          invite:
            i && i.invited
              ? {
                  id: i.id,
                  rsvp: i.rsvp,
                  pax: i.pax,
                  byHost: i.byHost,
                  respondedAt: i.respondedAt,
                  remark: i.remark,
                  notifiedAt: i.notifiedAt,
                  giftOut: i.giftOut,
                  giftOutGiven: i.giftOutGiven,
                  giftOutGivenAt: i.giftOutGivenAt,
                  giftOutGivenBy: i.giftOutGivenBy,
                  callAttempts: i.callAttempts,
                  lastCalledAt: i.lastCalledAt,
                  callOutcome: i.callOutcome,
                }
              : null,
        };
      }),
      giftsReceived: gifts.map(({ gift, cat }) => this.giftView(gift, cat)),
    };
  }

  /* ───────────── guest list writes ───────────── */

  async addGuest(
    userId: string,
    weddingId: string,
    b: { name: string; phone: string; cc?: string; side: 'bride' | 'groom'; relation: string; expectedPax: number; notes: string; functions: { functionId: string; giftOut?: boolean }[] },
  ) {
    const ctx = await this.ctx(userId, weddingId);
    const phone = toE164(b.phone, b.cc ?? '+91');
    if (!phone) throw new AppError('VALIDATION', 'Enter a valid mobile number', 422, { phone: 'Enter a valid mobile number' });
    if (!b.functions.length) throw new AppError('VALIDATION', 'Pick at least one function', 422, { functions: 'Pick at least one function' });
    const fns = await this.fns(ctx.w.id);
    for (const x of b.functions) if (!fns.some((f) => f.id === x.functionId)) throw notFound('Function');
    const [existing] = await this.db.select().from(guests).where(and(eq(guests.weddingId, ctx.w.id), eq(guests.phone, phone))).orderBy(desc(guests.active)).limit(1);
    if (existing?.active) throw conflict('GUEST_EXISTS', `${existing.name} is already on the list with this number`);
    const guestId = await this.db.transaction(async (tx) => {
      let id: string;
      if (existing) {
        await tx
          .update(guests)
          .set({ active: true, name: b.name, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes, updatedAt: new Date() })
          .where(eq(guests.id, existing.id));
        id = existing.id;
      } else {
        const [g] = await tx
          .insert(guests)
          .values({ weddingId: ctx.w.id, name: b.name, phone, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes, createdVia: 'host', qrToken: randomToken(12) })
          .returning();
        id = g.id;
      }
      for (const x of b.functions) {
        await tx
          .insert(invites)
          .values({ weddingId: ctx.w.id, guestId: id, functionId: x.functionId, invited: true, giftOut: !!x.giftOut })
          .onConflictDoUpdate({ target: [invites.guestId, invites.functionId], set: { invited: true, giftOut: !!x.giftOut, updatedAt: new Date() } });
      }
      await this.audit.log({ type: 'user', id: userId }, 'guest.add', ctx.w.id, { guestId: id }, tx);
      return id;
    });
    return this.guestDetail(userId, weddingId, guestId);
  }

  async editGuest(userId: string, weddingId: string, guestId: string, b: Partial<{ name: string; side: 'bride' | 'groom'; relation: string; expectedPax: number; notes: string }>) {
    const ctx = await this.ctx(userId, weddingId);
    await this.guestOf(ctx, guestId);
    await this.db.update(guests).set({ ...b, updatedAt: new Date() }).where(eq(guests.id, guestId));
    return this.guestDetail(userId, weddingId, guestId);
  }

  /** put a guest on, or take them off, one function */
  async setGuestFunction(userId: string, weddingId: string, guestId: string, functionId: string, invited: boolean, giftOut?: boolean) {
    const ctx = await this.ctx(userId, weddingId);
    await this.guestOf(ctx, guestId);
    await this.fnOf(ctx, functionId);
    const set: Partial<typeof invites.$inferInsert> = { invited, updatedAt: new Date() };
    if (giftOut !== undefined) set.giftOut = giftOut;
    await this.db
      .insert(invites)
      .values({ weddingId: ctx.w.id, guestId, functionId, invited, giftOut: !!giftOut })
      .onConflictDoUpdate({ target: [invites.guestId, invites.functionId], set });
    await this.audit.log({ type: 'user', id: userId }, invited ? 'guest.fn.add' : 'guest.fn.remove', ctx.w.id, { guestId, functionId });
    return this.guestDetail(userId, weddingId, guestId);
  }

  /**
   * Take a guest off the list (wrong number, added twice). Their replies are kept,
   * so restoring brings everything back. They are told by app notification ONLY —
   * never a WhatsApp message.
   */
  async removeGuest(userId: string, weddingId: string, guestId: string) {
    const ctx = await this.ctx(userId, weddingId);
    const g = await this.guestOf(ctx, guestId);
    if (!g.active) return { ok: true };
    await this.db.update(guests).set({ active: false, updatedAt: new Date() }).where(eq(guests.id, g.id));
    const u = (await this.notifications.usersByPhone([g.phone])).get(g.phone);
    if (u) {
      await this.notifications.notify([u.id], {
        cat: 'sys',
        title: 'You have been taken off a guest list',
        body: `${couple(ctx.w)} · the hosts removed your number. Nothing you replied has been lost.`,
        long: 'A host removes a number when it was entered wrongly or somebody was added twice. If this is a mistake, the family will know — there is nothing for you to do here.',
        art: 'invite',
        action: { type: 'screen', screen: 'invites' },
      });
    }
    await this.audit.log({ type: 'user', id: userId }, 'guest.remove', ctx.w.id, { guestId });
    return { ok: true };
  }

  async restoreGuest(userId: string, weddingId: string, guestId: string) {
    const ctx = await this.ctx(userId, weddingId);
    const g = await this.guestOf(ctx, guestId);
    const [clash] = await this.db
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.weddingId, ctx.w.id), eq(guests.phone, g.phone), eq(guests.active, true)))
      .limit(1);
    if (clash) throw conflict('GUEST_EXISTS', 'Someone with this number is already on the list');
    await this.db.update(guests).set({ active: true, updatedAt: new Date() }).where(eq(guests.id, g.id));
    await this.audit.log({ type: 'user', id: userId }, 'guest.restore', ctx.w.id, { guestId });
    return this.guestDetail(userId, weddingId, guestId);
  }

  private async inviteOf(ctx: HostCtx, inviteId: string) {
    const [row] = await this.db
      .select({ inv: invites, g: guests, f: functions })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .innerJoin(functions, eq(functions.id, invites.functionId))
      .where(and(eq(invites.id, inviteId), eq(invites.weddingId, ctx.w.id)))
      .limit(1);
    if (!row || !row.inv.invited || !row.g.active) throw notFound('Invitation');
    return row;
  }

  /** recording a reply for someone is always the host's doing, on either side of the 24h window */
  async recordRsvp(userId: string, weddingId: string, inviteId: string, rsvp: Rsvp, pax: number, remark?: string) {
    const ctx = await this.ctx(userId, weddingId);
    const { inv } = await this.inviteOf(ctx, inviteId);
    await this.db
      .update(invites)
      .set({
        rsvp,
        pax: rsvp === 'going' ? Math.max(1, pax) : 0,
        respondedAt: rsvp === 'none' ? null : new Date(),
        byHost: rsvp !== 'none',
        remark: remark ?? inv.remark,
        updatedAt: new Date(),
      })
      .where(eq(invites.id, inv.id));
    await this.audit.log({ type: 'user', id: userId }, 'rsvp.record', ctx.w.id, { inviteId, rsvp, pax });
    return this.guestDetail(userId, weddingId, inv.guestId);
  }

  /** tapping dial counts as an attempt even before the outcome is known */
  async logCall(userId: string, weddingId: string, inviteId: string, outcome?: 'answered' | 'no_answer' | 'wrong_number' | 'call_back') {
    const ctx = await this.ctx(userId, weddingId);
    const { inv } = await this.inviteOf(ctx, inviteId);
    await this.db
      .update(invites)
      .set(
        outcome
          ? { callOutcome: outcome, updatedAt: new Date() }
          : { callAttempts: inv.callAttempts + 1, lastCalledAt: new Date(), updatedAt: new Date() },
      )
      .where(eq(invites.id, inv.id));
    return { ok: true };
  }

  /* ───────────── RSVP board ───────────── */

  async rsvpBoard(userId: string, weddingId: string, functionId: string, tab: Rsvp | 'pending') {
    const ctx = await this.ctx(userId, weddingId);
    const f = await this.fnOf(ctx, functionId);
    const rows = await this.db
      .select({ inv: invites, g: guests, uid: users.id })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .leftJoin(users, and(eq(users.phone, guests.phone), isNull(users.deletedAt)))
      .where(and(eq(invites.functionId, f.id), eq(invites.invited, true), eq(guests.active, true), eq(invites.rsvp, tab === 'pending' ? 'none' : tab)))
      .orderBy(sql`${users.id} is not null`, asc(guests.name));
    const counts = (await this.countsByFn(ctx.w.id)).get(f.id) ?? zero();
    return {
      function: this.fnView(f, ctx.w.timezone),
      counts,
      rows: rows.map(({ inv, g, uid }) => ({
        inviteId: inv.id,
        guest: this.guestView(g, !!uid),
        rsvp: inv.rsvp,
        pax: inv.pax,
        byHost: inv.byHost,
        respondedAt: inv.respondedAt,
        remark: inv.remark,
        callAttempts: inv.callAttempts,
        lastCalledAt: inv.lastCalledAt,
        callOutcome: inv.callOutcome,
      })),
    };
  }

  /* ───────────── in-app nudges (unlimited) ───────────── */

  async audience(ctx: HostCtx, functionId: string, aud: 'all' | 'pending' | 'going' | 'maybe' | 'not_going' | 'sel' | 'one', guestIds: string[] = []) {
    const conds = [eq(invites.functionId, functionId), eq(invites.invited, true), eq(guests.active, true)];
    if (aud === 'pending') conds.push(eq(invites.rsvp, 'none'));
    if (aud === 'going' || aud === 'maybe' || aud === 'not_going') conds.push(eq(invites.rsvp, aud));
    if (aud === 'sel' || aud === 'one') conds.push(inArray(guests.id, guestIds.length ? guestIds : ['00000000-0000-0000-0000-000000000000']));
    return this.db
      .select({ inv: invites, g: guests })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(...conds, eq(invites.weddingId, ctx.w.id)));
  }

  async nudge(
    userId: string,
    weddingId: string,
    b: { functionId: string; audience: 'all' | 'pending' | 'going' | 'maybe' | 'not_going' | 'sel' | 'one'; guestIds?: string[]; message: string },
  ) {
    const ctx = await this.ctx(userId, weddingId);
    const f = await this.fnOf(ctx, b.functionId);
    const rows = await this.audience(ctx, f.id, b.audience, b.guestIds);
    const map = await this.notifications.usersByPhone(rows.map((r) => r.g.phone));
    const appUsers = rows.map((r) => map.get(r.g.phone)?.id).filter((x): x is string => !!x);
    await this.notifications.notify(appUsers, {
      cat: 'host',
      pref: 'nudge',
      title: `${f.name} · ${couple(ctx.w)}`,
      body: b.message,
      art: f.icon,
      action: { type: 'function', weddingId: ctx.w.id, functionId: f.id },
    });
    const [n] = await this.db
      .insert(nudges)
      .values({ weddingId: ctx.w.id, functionId: f.id, audience: b.audience, recipientCount: rows.length, appCount: appUsers.length, message: b.message, sentBy: ctx.phone })
      .returning();
    return { id: n.id, recipientCount: rows.length, appCount: appUsers.length, withoutApp: rows.length - appUsers.length };
  }

  async reminderLog(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId);
    const fns = await this.fns(ctx.w.id);
    const name = (id: string | null) => fns.find((f) => f.id === id)?.name ?? '';
    const bl = await this.db.select().from(blasts).where(eq(blasts.weddingId, ctx.w.id)).orderBy(desc(blasts.createdAt));
    const nu = await this.db.select().from(nudges).where(eq(nudges.weddingId, ctx.w.id)).orderBy(desc(nudges.createdAt)).limit(100);
    return [
      ...bl.map((b) => ({
        id: b.id, channel: 'whatsapp', kind: b.kind, functionId: b.functionId, functionName: name(b.functionId), state: b.state,
        count: b.recipientCount, delivered: b.deliveredCount, failed: b.failedCount, at: b.sentAt ?? b.createdAt, by: b.sentBy,
      })),
      ...nu.map((n) => ({
        id: n.id, channel: 'app', kind: 'nudge', functionId: n.functionId, functionName: name(n.functionId), state: 'sent',
        count: n.recipientCount, delivered: n.appCount, failed: 0, at: n.createdAt, by: n.sentBy, message: n.message, audience: n.audience,
      })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }

  /* ───────────── gifts received ───────────── */

  private giftView(g: typeof giftsReceived.$inferSelect, cat: typeof giftCategories.$inferSelect) {
    return {
      id: g.id,
      functionId: g.functionId,
      guestId: g.guestId,
      giverName: g.giverName,
      giverPhone: g.giverPhone ? prettyPhone(g.giverPhone) : '',
      category: { id: cat.id, key: cat.key, label: cat.label, isCash: cat.isCash },
      amount: g.amount,
      itemName: g.itemName,
      note: g.note,
      method: g.method,
      recordedBy: g.recordedBy,
      recordedAt: g.recordedAt,
    };
  }

  async categories(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    return this.db
      .select()
      .from(giftCategories)
      .where(or(isNull(giftCategories.weddingId), eq(giftCategories.weddingId, ctx.w.id)))
      .orderBy(asc(giftCategories.sort), asc(giftCategories.createdAt));
  }

  /** custom categories belong to this wedding only and can never be a second money category */
  async addCategory(userId: string, weddingId: string, label: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
    const [c] = await this.db
      .insert(giftCategories)
      .values({ weddingId: ctx.w.id, key, label, isCash: false, isSystem: false, sort: 100 })
      .returning();
    return c;
  }

  async setCategoryActive(userId: string, weddingId: string, categoryId: string, active: boolean) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const [c] = await this.db
      .update(giftCategories)
      .set({ active })
      .where(and(eq(giftCategories.id, categoryId), eq(giftCategories.weddingId, ctx.w.id), eq(giftCategories.isSystem, false)))
      .returning();
    if (!c) throw notFound('Category');
    return c;
  }

  async gifts(userId: string, weddingId: string, functionId?: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const rows = await this.db
      .select({ gift: giftsReceived, cat: giftCategories })
      .from(giftsReceived)
      .innerJoin(giftCategories, eq(giftCategories.id, giftsReceived.categoryId))
      .where(and(eq(giftsReceived.weddingId, ctx.w.id), isNull(giftsReceived.deletedAt), functionId ? eq(giftsReceived.functionId, functionId) : undefined))
      .orderBy(desc(giftsReceived.recordedAt));
    const byCat = new Map<string, { label: string; count: number; amount: number }>();
    for (const { gift, cat } of rows) {
      const c = byCat.get(cat.id) ?? { label: cat.label, count: 0, amount: 0 };
      c.count++;
      c.amount += gift.amount ?? 0;
      byCat.set(cat.id, c);
    }
    return {
      total: rows.length,
      cash: rows.reduce((a, r) => a + (r.gift.amount ?? 0), 0),
      byCategory: [...byCat.entries()].map(([id, v]) => ({ categoryId: id, ...v })),
      gifts: rows.map(({ gift, cat }) => this.giftView(gift, cat)),
    };
  }

  async recordGift(
    userId: string,
    weddingId: string,
    b: { functionId: string; guestId?: string | null; giverName?: string; giverPhone?: string; categoryId: string; amount?: number | null; itemName?: string | null; note?: string; method: 'qr' | 'manual' },
  ) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    await this.fnOf(ctx, b.functionId);
    const [cat] = await this.db
      .select()
      .from(giftCategories)
      .where(and(eq(giftCategories.id, b.categoryId), or(isNull(giftCategories.weddingId), eq(giftCategories.weddingId, ctx.w.id))))
      .limit(1);
    if (!cat || !cat.active) throw notFound('Gift category');
    if (cat.isCash && !(b.amount && b.amount > 0)) throw new AppError('VALIDATION', 'Enter the amount', 422, { amount: 'Enter the amount' });
    if (!cat.isCash && !b.itemName?.trim()) throw new AppError('VALIDATION', 'Say what the gift was', 422, { itemName: 'Say what the gift was' });
    let giverName = b.giverName?.trim() ?? '';
    let giverPhone = b.giverPhone ? toE164(b.giverPhone) ?? '' : '';
    if (b.guestId) {
      const g = await this.guestOf(ctx, b.guestId);
      giverName = g.name;
      giverPhone = g.phone;
    }
    if (!giverName) throw new AppError('VALIDATION', 'Who gave it?', 422, { giverName: 'Who gave it?' });
    const [row] = await this.db
      .insert(giftsReceived)
      .values({
        weddingId: ctx.w.id,
        functionId: b.functionId,
        guestId: b.guestId ?? null,
        giverName,
        giverPhone,
        categoryId: cat.id,
        amount: cat.isCash ? Math.round(b.amount!) : null,
        itemName: cat.isCash ? null : b.itemName!.trim(),
        note: b.note ?? '',
        method: b.method,
        recordedBy: ctx.name,
      })
      .returning();
    return this.giftView(row, cat);
  }

  /** owner only — the one place a co-host is deliberately less trusted */
  async deleteGift(userId: string, weddingId: string, giftId: string) {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    const [g] = await this.db
      .update(giftsReceived)
      .set({ deletedAt: new Date() })
      .where(and(eq(giftsReceived.id, giftId), eq(giftsReceived.weddingId, ctx.w.id), isNull(giftsReceived.deletedAt)))
      .returning();
    if (!g) throw notFound('Gift');
    await this.audit.log({ type: 'user', id: userId }, 'gift.delete', ctx.w.id, { giftId });
    return { ok: true };
  }

  /* ───────────── gifts handed out ───────────── */

  async giftOutList(userId: string, weddingId: string, functionId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const f = await this.fnOf(ctx, functionId);
    const rows = await this.db
      .select({ inv: invites, g: guests, uid: users.id })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .leftJoin(users, and(eq(users.phone, guests.phone), isNull(users.deletedAt)))
      .where(and(eq(invites.functionId, f.id), eq(invites.giftOut, true), eq(invites.invited, true), eq(guests.active, true)))
      .orderBy(invites.giftOutGiven, asc(guests.name));
    return {
      function: this.fnView(f, ctx.w.timezone),
      planned: rows.length,
      given: rows.filter((r) => r.inv.giftOutGiven).length,
      rows: rows.map(({ inv, g, uid }) => ({
        inviteId: inv.id,
        guest: this.guestView(g, !!uid),
        given: inv.giftOutGiven,
        givenAt: inv.giftOutGivenAt,
        givenBy: inv.giftOutGivenBy,
        method: inv.giftOutMethod,
        rsvp: inv.rsvp,
      })),
    };
  }

  /** only what was actually handed over is recorded — there is no reconciliation step */
  async markGiftOut(userId: string, weddingId: string, inviteId: string, given: boolean, method: 'qr' | 'manual', addToList = false) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const { inv } = await this.inviteOf(ctx, inviteId);
    if (!inv.giftOut && !addToList && given) throw new AppError('NOT_ON_GIFT_LIST', 'This guest is not on the gift list for this function', 409);
    if (given && inv.giftOutGiven) throw conflict('ALREADY_GIVEN', `Already given by ${inv.giftOutGivenBy ?? 'the family'}`);
    await this.db
      .update(invites)
      .set(
        given
          ? { giftOut: true, giftOutGiven: true, giftOutGivenAt: new Date(), giftOutGivenBy: ctx.name, giftOutMethod: method, updatedAt: new Date() }
          : { giftOutGiven: false, giftOutGivenAt: null, giftOutGivenBy: null, giftOutMethod: null, updatedAt: new Date() },
      )
      .where(eq(invites.id, inv.id));
    await this.audit.log({ type: 'user', id: userId }, given ? 'giftout.give' : 'giftout.undo', ctx.w.id, { inviteId });
    return { ok: true, given };
  }

  /* ───────────── the scanner ───────────── */

  async scan(userId: string, weddingId: string, code: string, functionId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const f = await this.fnOf(ctx, functionId);
    const token = code.trim().replace(/^IK1:/, '');
    const [g] = await this.db
      .select()
      .from(guests)
      .where(and(eq(guests.qrToken, token), eq(guests.weddingId, ctx.w.id), eq(guests.active, true)))
      .limit(1);
    if (!g) return { found: false as const, message: 'This code is not on this wedding’s guest list' };
    const [inv] = await this.db.select().from(invites).where(and(eq(invites.guestId, g.id), eq(invites.functionId, f.id))).limit(1);
    const received = await this.db
      .select({ gift: giftsReceived, cat: giftCategories })
      .from(giftsReceived)
      .innerJoin(giftCategories, eq(giftCategories.id, giftsReceived.categoryId))
      .where(and(eq(giftsReceived.guestId, g.id), eq(giftsReceived.functionId, f.id), isNull(giftsReceived.deletedAt)));
    const invited = !!inv?.invited;
    const status = !invited
      ? 'not_invited'
      : inv.giftOutGiven
        ? 'already_given'
        : inv.giftOut
          ? 'on_gift_list'
          : 'not_on_gift_list';
    return {
      found: true as const,
      guest: this.guestView(g, false),
      function: { id: f.id, name: f.name, giftPlan: f.giftPlan },
      status,
      invite: inv
        ? { id: inv.id, invited: inv.invited, rsvp: inv.rsvp, pax: inv.pax, giftOut: inv.giftOut, giftOutGiven: inv.giftOutGiven, givenAt: inv.giftOutGivenAt, givenBy: inv.giftOutGivenBy }
        : null,
      received: received.map(({ gift, cat }) => this.giftView(gift, cat)),
    };
  }

  /* ───────────── family access ───────────── */

  async family(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const list = await this.db
      .select()
      .from(weddingAccess)
      .where(and(eq(weddingAccess.weddingId, ctx.w.id), isNull(weddingAccess.removedAt)))
      .orderBy(asc(weddingAccess.addedAt));
    return {
      max: MAX_FAMILY,
      owner: { phonePretty: prettyPhone(ctx.w.ownerPhone), isMe: ctx.phone === ctx.w.ownerPhone },
      me: { role: ctx.role },
      members: list.map((a) => ({ id: a.id, name: a.name, relation: a.relation, role: a.role, phonePretty: prettyPhone(a.phone), addedAt: a.addedAt })),
    };
  }

  async addFamily(userId: string, weddingId: string, b: { name: string; phone: string; cc?: string; relation: string; role?: 'cohost' | 'giftdesk' }) {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    const phone = toE164(b.phone, b.cc ?? '+91');
    if (!phone) throw new AppError('VALIDATION', 'Enter a valid mobile number', 422, { phone: 'Enter a valid mobile number' });
    if (phone === ctx.w.ownerPhone) throw conflict('IS_OWNER', 'That is the owner’s own number');
    const live = await this.db.select().from(weddingAccess).where(and(eq(weddingAccess.weddingId, ctx.w.id), isNull(weddingAccess.removedAt)));
    if (live.some((a) => a.phone === phone)) throw conflict('ALREADY_MEMBER', 'This number already has access');
    if (live.length >= MAX_FAMILY) throw conflict('FAMILY_FULL', `At most ${MAX_FAMILY} family members can have access`);
    await this.db.insert(weddingAccess).values({ weddingId: ctx.w.id, phone, name: b.name, relation: b.relation, role: b.role ?? 'cohost', addedBy: ctx.phone });
    const u = (await this.notifications.usersByPhone([phone])).get(phone);
    if (u) {
      await this.notifications.notify([u.id], {
        cat: 'sys',
        title: `You can now help run ${couple(ctx.w)}’s wedding`,
        body: `${ctx.name} gave you access to the wedding console.`,
        art: 'family',
        action: { type: 'screen', screen: 'hhome' },
      });
    }
    await this.audit.log({ type: 'user', id: userId }, 'family.add', ctx.w.id, { phone });
    return this.family(userId, weddingId);
  }

  async setFamilyRole(userId: string, weddingId: string, accessId: string, role: 'cohost' | 'giftdesk') {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    const [a] = await this.db
      .update(weddingAccess)
      .set({ role })
      .where(and(eq(weddingAccess.id, accessId), eq(weddingAccess.weddingId, ctx.w.id), isNull(weddingAccess.removedAt)))
      .returning();
    if (!a) throw notFound('Family member');
    return this.family(userId, weddingId);
  }

  async removeFamily(userId: string, weddingId: string, accessId: string) {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    const [a] = await this.db
      .update(weddingAccess)
      .set({ removedAt: new Date() })
      .where(and(eq(weddingAccess.id, accessId), eq(weddingAccess.weddingId, ctx.w.id), isNull(weddingAccess.removedAt)))
      .returning();
    if (!a) throw notFound('Family member');
    await this.audit.log({ type: 'user', id: userId }, 'family.remove', ctx.w.id, { phone: a.phone });
    return this.family(userId, weddingId);
  }
}
