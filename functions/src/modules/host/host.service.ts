import { Injectable } from '@nestjs/common';
import { AppError, conflict, notFound } from '../../common/errors';
import { prettyPhone, toE164 } from '../../common/phone';
import { clock12, dayLabel, fnPast, rsvpWindow } from '../../common/time';
import { col } from '../../db/paths';
import { Access, Blast, Fn, GiftCategory, GiftReceived, Guest, Invite, inviteId as makeInviteId, Media, Nudge } from '../../db/models';
import { data, db, F, getDoc, getRows } from '../../db/store';
import { NotificationsService } from '../infra/notifications.service';
import { AuditService } from '../infra/audit.service';
import { couple } from '../guest/guest.service';
import { liveFunctions, newGuest, newInvite } from '../../db/rows';
import { AccessLevel, HostAccessService, HostCtx } from './host-access.service';

export const MAX_FAMILY = 5;
type Rsvp = 'none' | 'going' | 'maybe' | 'not_going';
type Counts = { invited: number; going: number; not_going: number; maybe: number; none: number; pax: number; byHost: number };
const zero = (): Counts => ({ invited: 0, going: 0, not_going: 0, maybe: 0, none: 0, pax: 0, byHost: 0 });
const byName = (a: Guest, b: Guest) => a.name.localeCompare(b.name);

/**
 * The wedding console. Everything here reads the wedding the Invite Karoo team imported.
 * The host cannot create or move a function; they run what the team set up —
 * replies, reminders, gifts and family access.
 */
@Injectable()
export class HostService {
  constructor(
    private readonly access: HostAccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  ctx(userId: string, weddingId: string, level: AccessLevel = 'full') {
    return this.access.require(userId, weddingId, level);
  }

  /* ───────────── reads ───────────── */

  private fns(weddingId: string) {
    return liveFunctions(weddingId);
  }

  private async fnOf(ctx: HostCtx, functionId: string) {
    const f = await getDoc<Fn>(col.functions(ctx.w.id).doc(functionId));
    if (!f || f.deletedAt) throw notFound('Function');
    return f;
  }

  /** the wedding's active guests and their live invite rows */
  private async live(weddingId: string) {
    const [gs, inv] = await Promise.all([
      getRows<Guest>(col.guests(weddingId).where('active', '==', true)),
      getRows<Invite>(col.invites(weddingId).where('invited', '==', true)),
    ]);
    const guests = new Map(gs.map((g) => [g.id, g]));
    return { guests, invites: inv.filter((i) => guests.has(i.guestId)) };
  }

  /** phone numbers on the list that have an app account */
  private async withApp(phones: string[]) {
    return new Set((await this.notifications.usersByPhone(phones)).keys());
  }

  /** rsvp counts per function, active guests only */
  private countsByFn(invites: Invite[]) {
    const out = new Map<string, Counts>();
    for (const i of invites) {
      const c = out.get(i.functionId) ?? zero();
      c.invited++;
      c[i.rsvp as Rsvp]++;
      if (i.rsvp === 'going') c.pax += i.pax;
      if (i.byHost) c.byHost++;
      out.set(i.functionId, c);
    }
    return out;
  }

  private fnView(f: Fn, tz: string) {
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
    const [fns, { guests, invites }, bl, received] = await Promise.all([
      this.fns(w.id),
      this.live(w.id),
      getRows<Blast>(col.blasts(w.id)),
      getRows<GiftReceived>(col.gifts(w.id).where('deletedAt', '==', null)),
    ]);
    const counts = this.countsByFn(invites);
    const appPhones = await this.withApp([...guests.values()].map((g) => g.phone));
    const fnById = new Map(fns.map((f) => [f.id, f]));
    const recent = invites
      .filter((i) => i.respondedAt && i.rsvp !== 'none' && fnById.has(i.functionId))
      .sort((a, b) => b.respondedAt!.getTime() - a.respondedAt!.getTime())
      .slice(0, 6);

    // wedding-wide: a guest counts once — "going" if going to anything
    const perGuest = new Map<string, string[]>();
    for (const i of invites) perGuest.set(i.guestId, [...(perGuest.get(i.guestId) ?? []), i.rsvp]);
    const totals = { guests: guests.size, appJoined: [...guests.values()].filter((g) => appPhones.has(g.phone)).length, going: 0, not_going: 0, pending: 0 };
    for (const rsvps of perGuest.values()) {
      if (rsvps.includes('going')) totals.going++;
      else if (rsvps.every((x) => x === 'not_going')) totals.not_going++;
      else totals.pending++;
    }

    const functionsOut = fns.map((f) => {
      const c = counts.get(f.id) ?? zero();
      const go = invites.filter((i) => i.functionId === f.id && i.giftOut);
      const rc = received.filter((g) => g.functionId === f.id);
      const b = (k: 'rsvp_request' | 'reminder') => {
        const row = bl.find((x) => x.functionId === f.id && x.kind === k);
        return row ? { state: row.state, sentAt: row.sentAt, recipientCount: row.recipientCount } : null;
      };
      return {
        ...this.fnView(f, w.timezone),
        counts: c,
        blasts: { rsvp_request: b('rsvp_request'), reminder: b('reminder') },
        giftOut: { planned: go.length, given: go.filter((i) => i.giftOutGiven).length },
        giftsReceived: { count: rc.length, cash: rc.reduce((a, g) => a + (g.amount ?? 0), 0) },
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
      recent: recent.map((inv) => {
        const g = guests.get(inv.guestId)!;
        const f = fnById.get(inv.functionId)!;
        return {
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
        };
      }),
      alerts,
      gifts: {
        received: received.length,
        cash: received.reduce((a, r) => a + (r.amount ?? 0), 0),
      },
    };
  }

  /** what the guests see: cover, couple, card, voice, galleries and every function */
  async details(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const { w } = ctx;
    const [fns, media, access] = await Promise.all([
      this.fns(w.id),
      getRows<Media>(col.media(w.id)),
      getRows<Access>(col.access(w.id).where('removedAt', '==', null)),
    ]);
    media.sort((a, b) => a.sort - b.sort);
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
        ...access.map((a) => ({ name: a.name, relation: a.relation })),
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
    let gs = await getRows<Guest>(col.guests(ctx.w.id).where('active', '==', !q.removed));
    if (q.side) gs = gs.filter((g) => g.side === q.side);
    if (q.q) {
      const s = q.q.trim().toLowerCase();
      const digits = q.q.replace(/\D/g, '');
      gs = gs.filter((g) => g.name.toLowerCase().includes(s) || g.relation.toLowerCase().includes(s) || (!!digits && g.phone.includes(digits)));
    }
    const inv = await getRows<Invite>(col.invites(ctx.w.id).where('invited', '==', true));
    if (q.fn) {
      const want = q.status === 'pending' ? 'none' : q.status;
      const on = new Set(inv.filter((i) => i.functionId === q.fn && (!want || i.rsvp === want)).map((i) => i.guestId));
      gs = gs.filter((g) => on.has(g.id));
    }
    const app = await this.withApp(gs.map((g) => g.phone));
    if (q.app === 'yes') gs = gs.filter((g) => app.has(g.phone));
    if (q.app === 'no') gs = gs.filter((g) => !app.has(g.phone));
    // guests without the app come first: they are the ones the host has to call
    gs.sort((a, b) => Number(app.has(a.phone)) - Number(app.has(b.phone)) || byName(a, b));
    const rows = gs.slice(q.offset, q.offset + q.limit);
    return {
      total: gs.length,
      guests: rows.map((g) => ({
        ...this.guestView(g, app.has(g.phone)),
        functions: inv
          .filter((i) => i.guestId === g.id)
          .map((i) => ({ inviteId: i.id, functionId: i.functionId, rsvp: i.rsvp, pax: i.pax, byHost: i.byHost, giftOut: i.giftOut, giftOutGiven: i.giftOutGiven, callAttempts: i.callAttempts })),
      })),
    };
  }

  private guestView(g: Guest, appJoined: boolean) {
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
    const g = await getDoc<Guest>(col.guests(ctx.w.id).doc(guestId));
    if (!g) throw notFound('Guest');
    return g;
  }

  async guestDetail(userId: string, weddingId: string, guestId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const g = await this.guestOf(ctx, guestId);
    const [app, fns, inv, gifts, cats] = await Promise.all([
      this.withApp([g.phone]),
      this.fns(ctx.w.id),
      getRows<Invite>(col.invites(ctx.w.id).where('guestId', '==', g.id)),
      getRows<GiftReceived>(col.gifts(ctx.w.id).where('guestId', '==', g.id).where('deletedAt', '==', null)),
      this.allCategories(ctx.w.id),
    ]);
    return {
      ...this.guestView(g, app.has(g.phone)),
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
      giftsReceived: gifts.filter((x) => cats.has(x.categoryId)).map((x) => this.giftView(x, cats.get(x.categoryId)!)),
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
    const guestId = await db().runTransaction(async (tx) => {
      const same = (await tx.get(col.guests(ctx.w.id).where('phone', '==', phone))).docs.map((d) => ({ ...(d.data() as Guest), id: d.id }));
      const activeOne = same.find((g) => g.active);
      if (activeOne) throw conflict('GUEST_EXISTS', `${activeOne.name} is already on the list with this number`);
      const existing = same[0];
      const ref = existing ? col.guests(ctx.w.id).doc(existing.id) : col.guests(ctx.w.id).doc();
      const have = existing ? new Set((await tx.get(col.invites(ctx.w.id).where('guestId', '==', existing.id))).docs.map((d) => d.id)) : new Set<string>();
      const fields = { name: b.name, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes };
      if (existing) tx.update(ref, { ...fields, active: true, updatedAt: F.now() });
      else tx.set(ref, newGuest(ctx.w.id, { ...fields, phone }, 'host'));
      for (const x of b.functions) {
        const iref = col.invites(ctx.w.id).doc(makeInviteId(ref.id, x.functionId));
        if (have.has(iref.id)) tx.update(iref, { invited: true, giftOut: !!x.giftOut, updatedAt: F.now() });
        else tx.set(iref, newInvite(ctx.w.id, ref.id, x.functionId, !!x.giftOut));
      }
      return ref.id;
    });
    await this.audit.log({ type: 'user', id: userId }, 'guest.add', ctx.w.id, { guestId });
    return this.guestDetail(userId, weddingId, guestId);
  }

  async editGuest(userId: string, weddingId: string, guestId: string, b: Partial<{ name: string; side: 'bride' | 'groom'; relation: string; expectedPax: number; notes: string }>) {
    const ctx = await this.ctx(userId, weddingId);
    await this.guestOf(ctx, guestId);
    await col.guests(ctx.w.id).doc(guestId).update({ ...b, updatedAt: F.now() });
    return this.guestDetail(userId, weddingId, guestId);
  }

  /** put a guest on, or take them off, one function */
  async setGuestFunction(userId: string, weddingId: string, guestId: string, functionId: string, invited: boolean, giftOut?: boolean) {
    const ctx = await this.ctx(userId, weddingId);
    await this.guestOf(ctx, guestId);
    await this.fnOf(ctx, functionId);
    const ref = col.invites(ctx.w.id).doc(makeInviteId(guestId, functionId));
    await db().runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (cur.exists) tx.update(ref, { invited, ...(giftOut !== undefined ? { giftOut } : {}), updatedAt: F.now() });
      else tx.set(ref, { ...newInvite(ctx.w.id, guestId, functionId, !!giftOut), invited });
    });
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
    await col.guests(ctx.w.id).doc(g.id).update({ active: false, updatedAt: F.now() });
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
    const clash = await getRows<Guest>(col.guests(ctx.w.id).where('phone', '==', g.phone).where('active', '==', true));
    if (clash.some((x) => x.id !== g.id)) throw conflict('GUEST_EXISTS', 'Someone with this number is already on the list');
    await col.guests(ctx.w.id).doc(g.id).update({ active: true, updatedAt: F.now() });
    await this.audit.log({ type: 'user', id: userId }, 'guest.restore', ctx.w.id, { guestId });
    return this.guestDetail(userId, weddingId, guestId);
  }

  private async inviteOf(ctx: HostCtx, inviteId: string) {
    const inv = await getDoc<Invite>(col.invites(ctx.w.id).doc(inviteId));
    if (!inv || !inv.invited) throw notFound('Invitation');
    const [g, f] = await Promise.all([getDoc<Guest>(col.guests(ctx.w.id).doc(inv.guestId)), getDoc<Fn>(col.functions(ctx.w.id).doc(inv.functionId))]);
    if (!g || !g.active || !f) throw notFound('Invitation');
    return { inv, g, f };
  }

  /** recording a reply for someone is always the host's doing, on either side of the 24h window */
  async recordRsvp(userId: string, weddingId: string, inviteId: string, rsvp: Rsvp, pax: number, remark?: string) {
    const ctx = await this.ctx(userId, weddingId);
    const { inv } = await this.inviteOf(ctx, inviteId);
    await col.invites(ctx.w.id).doc(inv.id).update({
      rsvp,
      pax: rsvp === 'going' ? Math.max(1, pax) : 0,
      respondedAt: rsvp === 'none' ? null : F.now(),
      byHost: rsvp !== 'none',
      remark: remark ?? inv.remark,
      updatedAt: F.now(),
    });
    await this.audit.log({ type: 'user', id: userId }, 'rsvp.record', ctx.w.id, { inviteId, rsvp, pax });
    return this.guestDetail(userId, weddingId, inv.guestId);
  }

  /** tapping dial counts as an attempt even before the outcome is known */
  async logCall(userId: string, weddingId: string, inviteId: string, outcome?: 'answered' | 'no_answer' | 'wrong_number' | 'call_back') {
    const ctx = await this.ctx(userId, weddingId);
    const { inv } = await this.inviteOf(ctx, inviteId);
    await col.invites(ctx.w.id).doc(inv.id).update(
      outcome ? { callOutcome: outcome, updatedAt: F.now() } : { callAttempts: F.inc(1), lastCalledAt: F.now(), updatedAt: F.now() },
    );
    return { ok: true };
  }

  /* ───────────── RSVP board ───────────── */

  async rsvpBoard(userId: string, weddingId: string, functionId: string, tab: Rsvp | 'pending') {
    const ctx = await this.ctx(userId, weddingId);
    const f = await this.fnOf(ctx, functionId);
    const { guests, invites } = await this.live(ctx.w.id);
    const want = tab === 'pending' ? 'none' : tab;
    const rows = invites.filter((i) => i.functionId === f.id && i.rsvp === want).map((inv) => ({ inv, g: guests.get(inv.guestId)! }));
    const app = await this.withApp(rows.map((r) => r.g.phone));
    rows.sort((a, b) => Number(app.has(a.g.phone)) - Number(app.has(b.g.phone)) || byName(a.g, b.g));
    const counts = this.countsByFn(invites).get(f.id) ?? zero();
    return {
      function: this.fnView(f, ctx.w.timezone),
      counts,
      rows: rows.map(({ inv, g }) => ({
        inviteId: inv.id,
        guest: this.guestView(g, app.has(g.phone)),
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
    const { guests, invites } = await this.live(ctx.w.id);
    const pick = new Set(guestIds);
    return invites
      .filter((i) => i.functionId === functionId)
      .filter((i) => {
        if (aud === 'pending') return i.rsvp === 'none';
        if (aud === 'going' || aud === 'maybe' || aud === 'not_going') return i.rsvp === aud;
        if (aud === 'sel' || aud === 'one') return pick.has(i.guestId);
        return true;
      })
      .map((inv) => ({ inv, g: guests.get(inv.guestId)! }));
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
    const ref = col.nudges(ctx.w.id).doc();
    await ref.set({ weddingId: ctx.w.id, functionId: f.id, audience: b.audience, recipientCount: rows.length, appCount: appUsers.length, message: b.message, sentBy: ctx.phone, createdAt: F.now() });
    return { id: ref.id, recipientCount: rows.length, appCount: appUsers.length, withoutApp: rows.length - appUsers.length };
  }

  async reminderLog(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId);
    const [fns, bl, nu] = await Promise.all([
      this.fns(ctx.w.id),
      getRows<Blast>(col.blasts(ctx.w.id)),
      getRows<Nudge>(col.nudges(ctx.w.id).orderBy('createdAt', 'desc').limit(100)),
    ]);
    const name = (id: string | null) => fns.find((f) => f.id === id)?.name ?? '';
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

  private giftView(g: GiftReceived, cat: GiftCategory) {
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

  /** system categories + this wedding's own, by id */
  private async allCategories(weddingId: string) {
    const [sys, own] = await Promise.all([getRows<GiftCategory>(col.systemGiftCategories()), getRows<GiftCategory>(col.weddingGiftCategories(weddingId))]);
    return new Map([...sys, ...own].map((c) => [c.id, c]));
  }

  async categories(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    return [...(await this.allCategories(ctx.w.id)).values()].sort((a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** custom categories belong to this wedding only and can never be a second money category */
  async addCategory(userId: string, weddingId: string, label: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
    const ref = col.weddingGiftCategories(ctx.w.id).doc();
    await ref.set({ weddingId: ctx.w.id, key, label, isCash: false, isSystem: false, active: true, sort: 100, createdAt: F.now() });
    return getDoc<GiftCategory>(ref);
  }

  async setCategoryActive(userId: string, weddingId: string, categoryId: string, active: boolean) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const ref = col.weddingGiftCategories(ctx.w.id).doc(categoryId);
    const c = await getDoc<GiftCategory>(ref);
    if (!c || c.isSystem) throw notFound('Category');
    await ref.update({ active });
    return { ...c, active };
  }

  async gifts(userId: string, weddingId: string, functionId?: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const cats = await this.allCategories(ctx.w.id);
    const rows = (await getRows<GiftReceived>(col.gifts(ctx.w.id).where('deletedAt', '==', null)))
      .filter((g) => (!functionId || g.functionId === functionId) && cats.has(g.categoryId))
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
    const byCat = new Map<string, { label: string; count: number; amount: number }>();
    for (const gift of rows) {
      const cat = cats.get(gift.categoryId)!;
      const c = byCat.get(cat.id) ?? { label: cat.label, count: 0, amount: 0 };
      c.count++;
      c.amount += gift.amount ?? 0;
      byCat.set(cat.id, c);
    }
    return {
      total: rows.length,
      cash: rows.reduce((a, r) => a + (r.amount ?? 0), 0),
      byCategory: [...byCat.entries()].map(([id, v]) => ({ categoryId: id, ...v })),
      gifts: rows.map((gift) => this.giftView(gift, cats.get(gift.categoryId)!)),
    };
  }

  async recordGift(
    userId: string,
    weddingId: string,
    b: { functionId: string; guestId?: string | null; giverName?: string; giverPhone?: string; categoryId: string; amount?: number | null; itemName?: string | null; note?: string; method: 'qr' | 'manual' },
  ) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    await this.fnOf(ctx, b.functionId);
    const cat = (await this.allCategories(ctx.w.id)).get(b.categoryId);
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
    const ref = col.gifts(ctx.w.id).doc();
    await ref.set({
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
      recordedAt: F.now(),
      deletedAt: null,
    });
    return this.giftView((await getDoc<GiftReceived>(ref))!, cat);
  }

  /** owner only — the one place a co-host is deliberately less trusted */
  async deleteGift(userId: string, weddingId: string, giftId: string) {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    const ref = col.gifts(ctx.w.id).doc(giftId);
    const g = await getDoc<GiftReceived>(ref);
    if (!g || g.deletedAt) throw notFound('Gift');
    await ref.update({ deletedAt: F.now() });
    await this.audit.log({ type: 'user', id: userId }, 'gift.delete', ctx.w.id, { giftId });
    return { ok: true };
  }

  /* ───────────── gifts handed out ───────────── */

  async giftOutList(userId: string, weddingId: string, functionId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const f = await this.fnOf(ctx, functionId);
    const { guests, invites } = await this.live(ctx.w.id);
    const rows = invites.filter((i) => i.functionId === f.id && i.giftOut).map((inv) => ({ inv, g: guests.get(inv.guestId)! }));
    rows.sort((a, b) => Number(a.inv.giftOutGiven) - Number(b.inv.giftOutGiven) || byName(a.g, b.g));
    const app = await this.withApp(rows.map((r) => r.g.phone));
    return {
      function: this.fnView(f, ctx.w.timezone),
      planned: rows.length,
      given: rows.filter((r) => r.inv.giftOutGiven).length,
      rows: rows.map(({ inv, g }) => ({
        inviteId: inv.id,
        guest: this.guestView(g, app.has(g.phone)),
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
    const ref = col.invites(ctx.w.id).doc(inv.id);
    // two people at the desk can scan the same guest: the transaction makes only one of them win
    await db().runTransaction(async (tx) => {
      const cur = data<Invite>(await tx.get(ref))!;
      if (!cur.giftOut && !addToList && given) throw new AppError('NOT_ON_GIFT_LIST', 'This guest is not on the gift list for this function', 409);
      if (given && cur.giftOutGiven) throw conflict('ALREADY_GIVEN', `Already given by ${cur.giftOutGivenBy ?? 'the family'}`);
      tx.update(
        ref,
        given
          ? { giftOut: true, giftOutGiven: true, giftOutGivenAt: F.now(), giftOutGivenBy: ctx.name, giftOutMethod: method, updatedAt: F.now() }
          : { giftOutGiven: false, giftOutGivenAt: null, giftOutGivenBy: null, giftOutMethod: null, updatedAt: F.now() },
      );
    });
    await this.audit.log({ type: 'user', id: userId }, given ? 'giftout.give' : 'giftout.undo', ctx.w.id, { inviteId });
    return { ok: true, given };
  }

  /* ───────────── the scanner ───────────── */

  async scan(userId: string, weddingId: string, code: string, functionId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const f = await this.fnOf(ctx, functionId);
    const token = code.trim().replace(/^IK1:/, '');
    const [g] = await getRows<Guest>(col.guests(ctx.w.id).where('qrToken', '==', token).where('active', '==', true).limit(1));
    if (!g) return { found: false as const, message: 'This code is not on this wedding’s guest list' };
    const inv = await getDoc<Invite>(col.invites(ctx.w.id).doc(makeInviteId(g.id, f.id)));
    const cats = await this.allCategories(ctx.w.id);
    const received = (await getRows<GiftReceived>(col.gifts(ctx.w.id).where('guestId', '==', g.id).where('deletedAt', '==', null))).filter(
      (x) => x.functionId === f.id && cats.has(x.categoryId),
    );
    const invited = !!inv?.invited;
    const status = !invited ? 'not_invited' : inv!.giftOutGiven ? 'already_given' : inv!.giftOut ? 'on_gift_list' : 'not_on_gift_list';
    return {
      found: true as const,
      guest: this.guestView(g, false),
      function: { id: f.id, name: f.name, giftPlan: f.giftPlan },
      status,
      invite: inv
        ? { id: inv.id, invited: inv.invited, rsvp: inv.rsvp, pax: inv.pax, giftOut: inv.giftOut, giftOutGiven: inv.giftOutGiven, givenAt: inv.giftOutGivenAt, givenBy: inv.giftOutGivenBy }
        : null,
      received: received.map((x) => this.giftView(x, cats.get(x.categoryId)!)),
    };
  }

  /* ───────────── family access ───────────── */

  async family(userId: string, weddingId: string) {
    const ctx = await this.ctx(userId, weddingId, 'desk');
    const list = (await getRows<Access>(col.access(ctx.w.id).where('removedAt', '==', null))).sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
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
    const live = await getRows<Access>(col.access(ctx.w.id).where('removedAt', '==', null));
    if (live.some((a) => a.phone === phone)) throw conflict('ALREADY_MEMBER', 'This number already has access');
    if (live.length >= MAX_FAMILY) throw conflict('FAMILY_FULL', `At most ${MAX_FAMILY} family members can have access`);
    await col.access(ctx.w.id).doc().set({ weddingId: ctx.w.id, phone, name: b.name, relation: b.relation, role: b.role ?? 'cohost', addedBy: ctx.phone, addedAt: F.now(), removedAt: null });
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

  private async liveAccess(ctx: HostCtx, accessId: string) {
    const a = await getDoc<Access>(col.access(ctx.w.id).doc(accessId));
    if (!a || a.removedAt) throw notFound('Family member');
    return a;
  }

  async setFamilyRole(userId: string, weddingId: string, accessId: string, role: 'cohost' | 'giftdesk') {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    await this.liveAccess(ctx, accessId);
    await col.access(ctx.w.id).doc(accessId).update({ role });
    return this.family(userId, weddingId);
  }

  async removeFamily(userId: string, weddingId: string, accessId: string) {
    const ctx = await this.ctx(userId, weddingId, 'owner');
    const a = await this.liveAccess(ctx, accessId);
    await col.access(ctx.w.id).doc(accessId).update({ removedAt: F.now() });
    await this.audit.log({ type: 'user', id: userId }, 'family.remove', ctx.w.id, { phone: a.phone });
    return this.family(userId, weddingId);
  }
}
