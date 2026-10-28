import { Injectable } from '@nestjs/common';
import { col, group } from '../../db/paths';
import { Access, Fn as FnDoc, Guest, Invite, Media, User, Wedding } from '../../db/models';
import { byIds, F, getDoc, getRows } from '../../db/store';
import { AppError, notFound } from '../../common/errors';
import { prettyPhone } from '../../common/phone';
import { APP_DEFAULT_REMINDERS, clock12, dayLabel, fnLive, fnPast, localParts, rsvpWindow } from '../../common/time';

type Fn = FnDoc;
type Inv = Invite;
type Wed = Wedding;
type Row = { inv: Inv; fn: Fn; w: Wed; g: Guest };

const VISIBLE = ['active', 'paused', 'ended'] as const;

export const couple = (w: Pick<Wed, 'bride' | 'groom'>) => `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}`;

/**
 * The guest side. Every read goes through two projections:
 *   mine     a function this guest is invited to — full details and controls
 *   context  a function they are NOT on — name, date, time, venue NAME, nothing else
 * A context function is built without ever touching an invite row, so it cannot leak one.
 * No number on the guest side is ever about another guest.
 */
@Injectable()
export class GuestService {
  private async phoneOf(userId: string) {
    const u = await getDoc<User>(col.users().doc(userId));
    if (!u || u.deletedAt) throw notFound('Account');
    return { phone: u.phone, prefs: u.prefs };
  }

  /** every live invite row for this number, across all visible weddings, by start time */
  private async myRows(phone: string, weddingId?: string): Promise<Row[]> {
    let gs = await getRows<Guest>(group.guests().where('phone', '==', phone).where('active', '==', true));
    if (weddingId) gs = gs.filter((g) => g.weddingId === weddingId);
    if (!gs.length) return [];
    const ws = await byIds<Wedding>(col.weddings(), gs.map((g) => g.weddingId));
    const out: Row[] = [];
    await Promise.all(
      gs.map(async (g) => {
        const w = ws.get(g.weddingId);
        if (!w || !(VISIBLE as readonly string[]).includes(w.status)) return;
        const inv = await getRows<Inv>(col.invites(w.id).where('guestId', '==', g.id).where('invited', '==', true));
        if (!inv.length) return;
        const fns = await byIds<Fn>(col.functions(w.id), inv.map((i) => i.functionId));
        for (const i of inv) {
          const fn = fns.get(i.functionId);
          if (fn && !fn.deletedAt) out.push({ inv: i, fn, w, g });
        }
      }),
    );
    return out.sort((a, b) => a.fn.startsAt.getTime() - b.fn.startsAt.getTime() || a.fn.sort - b.fn.sort);
  }

  private reminders(fn: Fn, inv: Inv, defaults: number[], now = new Date()) {
    const at = (off: number) => new Date(fn.startsAt.getTime() - off * 60_000);
    return {
      defaults: defaults.map((offset) => ({
        offset,
        on: !inv.offDefaults.includes(offset),
        fireAt: at(offset),
        possible: at(offset).getTime() > now.getTime(),
      })),
      mine: inv.guestReminders
        .slice()
        .sort((a, b) => b - a)
        .map((offset) => ({ offset, fireAt: at(offset), possible: at(offset).getTime() > now.getTime() })),
    };
  }

  private when(fn: Fn, tz: string) {
    return {
      startsAt: fn.startsAt,
      endsAt: fn.endsAt,
      date: localParts(fn.startsAt, tz).date,
      dayLabel: dayLabel(fn.startsAt, tz),
      timeLabel: clock12(fn.startsAt, tz),
      endLabel: fn.endsAt ? clock12(fn.endsAt, tz) : null,
    };
  }

  private mine(fn: Fn, inv: Inv, w: Wed, defaults: number[], clash: string | null, now = new Date()) {
    const win = rsvpWindow(fn, now);
    return {
      mine: true as const,
      id: fn.id,
      weddingId: w.id,
      name: fn.name,
      ...this.when(fn, w.timezone),
      venueName: fn.venueName,
      venueAddress: fn.venueAddress,
      mapsUrl: fn.mapsUrl ?? (fn.venueAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${fn.venueName}, ${fn.venueAddress}`)}` : null),
      dressCode: fn.dressCode,
      notes: fn.notes,
      color: fn.color,
      icon: fn.icon,
      past: fnPast(fn, now),
      live: fnLive(fn, now),
      inviteId: inv.id,
      rsvp: inv.rsvp,
      pax: inv.pax,
      respondedAt: inv.respondedAt,
      byHost: inv.byHost,
      window: { state: win.state, closesAt: win.closesAt },
      gift: inv.giftOut ? { onList: true, given: inv.giftOutGiven } : null,
      reminders: this.reminders(fn, inv, defaults, now),
      clash,
    };
  }

  private context(fn: Fn, w: Wed, now = new Date()) {
    return {
      mine: false as const,
      id: fn.id,
      weddingId: w.id,
      name: fn.name,
      ...this.when(fn, w.timezone),
      venueName: fn.venueName,
      color: fn.color,
      icon: fn.icon,
      past: fnPast(fn, now),
      reason: 'Part of the wedding. You are not on the list for this one.',
    };
  }

  /** clash notes: the guest's own functions overlapping across DIFFERENT weddings. Display strings only. */
  private clashes(rows: { fn: Fn; w: Wed }[]) {
    const out = new Map<string, string>();
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows.length; j++) {
        if (i === j || rows[i].w.id === rows[j].w.id) continue;
        const a = rows[i].fn;
        const b = rows[j].fn;
        const aEnd = a.endsAt ?? new Date(a.startsAt.getTime() + 4 * 3600_000);
        const bEnd = b.endsAt ?? new Date(b.startsAt.getTime() + 4 * 3600_000);
        if (a.startsAt < bEnd && b.startsAt < aEnd && !out.has(a.id)) {
          out.set(a.id, `Same time as the ${b.name} at ${couple(rows[j].w)}'s wedding`);
        }
      }
    }
    return out;
  }

  private defaultsFor(prefs: { rem: boolean; remAt: number[] }) {
    return prefs.rem ? (prefs.remAt?.length ? prefs.remAt : APP_DEFAULT_REMINDERS) : [];
  }

  /** the Invites list: one card per live wedding, sorted by the guest's OWN next function */
  async invitations(userId: string, includeFinished = false) {
    const me = await this.phoneOf(userId);
    const rows = await this.myRows(me.phone);
    const now = new Date();
    const byWedding = new Map<string, Row[]>();
    for (const r of rows) byWedding.set(r.w.id, [...(byWedding.get(r.w.id) ?? []), r]);
    const covers = (await Promise.all([...byWedding.keys()].map((wid) => getRows<Media>(col.media(wid).where('kind', '==', 'cover'))))).flat().sort((a, b) => a.sort - b.sort);
    const cards = [...byWedding.values()].map((list) => {
      const w = list[0].w;
      const upcoming = list.filter((r) => !fnPast(r.fn, now));
      const next = upcoming[0];
      const live = upcoming.length > 0 && w.status !== 'ended';
      return {
        weddingId: w.id,
        couple: couple(w),
        bride: w.bride.name,
        groom: w.groom.name,
        families: `${w.brideFamily.name} · ${w.groomFamily.name}`,
        city: w.city,
        startDate: w.startDate,
        endDate: w.endDate,
        cover: covers.find((c) => c.weddingId === w.id && c.type === 'image')?.url ?? w.bride.photoUrl ?? null,
        myFunctions: list.length,
        needsReply: list.filter((r) => r.inv.rsvp === 'none' && ['open', 'soon'].includes(rsvpWindow(r.fn, now).state)).length,
        going: list.filter((r) => r.inv.rsvp === 'going').length,
        live,
        next: next
          ? {
              functionId: next.fn.id,
              name: next.fn.name,
              ...this.when(next.fn, w.timezone),
              rsvp: next.inv.rsvp,
              window: rsvpWindow(next.fn, now).state,
            }
          : null,
      };
    });
    const live = cards.filter((c) => c.live).sort((a, b) => +new Date(a.next!.startsAt) - +new Date(b.next!.startsAt));
    const finished = cards.filter((c) => !c.live);
    return {
      weddings: live,
      finished: includeFinished ? finished : [],
      state: live.length ? 'has_invites' : finished.length ? 'all_finished' : 'never_invited',
    };
  }

  /** functions of every wedding this guest is on, between two dates — for the agenda and date rail */
  async agenda(userId: string, from: Date, to: Date) {
    const me = await this.phoneOf(userId);
    const rows = await this.myRows(me.phone);
    const clash = this.clashes(rows);
    const defaults = this.defaultsFor(me.prefs);
    return rows
      .filter((r) => r.fn.startsAt >= from && r.fn.startsAt < to)
      .map((r) => ({ ...this.mine(r.fn, r.inv, r.w, defaults, clash.get(r.fn.id) ?? null), couple: couple(r.w), city: r.w.city }));
  }

  /** the wedding page: cover, couple, families, card, voice, galleries, and the function thread */
  async wedding(userId: string, weddingId: string) {
    const me = await this.phoneOf(userId);
    const all = await this.myRows(me.phone);
    const rows = all.filter((r) => r.w.id === weddingId);
    if (!rows.length) throw notFound('Wedding');
    const w = rows[0].w;
    const clash = this.clashes(all);
    const defaults = this.defaultsFor(me.prefs);
    const fns = (await getRows<Fn>(col.functions(w.id).where('deletedAt', '==', null))).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.sort - b.sort);
    const mineById = new Map(rows.map((r) => [r.fn.id, r.inv]));
    const media = (await getRows<Media>(col.media(w.id))).sort((a, b) => a.sort - b.sort);
    const hosts = (await getRows<Access>(col.access(w.id).where('removedAt', '==', null))).map((a) => ({ name: a.name, relation: a.relation }));
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
      card: w.card ? { name: w.card.name, sizeMb: Math.round((w.card.size / 1048576) * 10) / 10, pages: w.card.pages, pdfUrl: w.card.key ? `/v1/weddings/${w.id}/card.pdf` : null } : null,
      voice: w.voice ? { url: w.voice.url, durationSec: w.voice.durationSec ?? null } : null,
      // the ONE number guests are given. Host phones are never projected to the guest side.
      contact: w.contactPhone ? { phone: w.contactPhone, phonePretty: prettyPhone(w.contactPhone) } : null,
      hosts: [
        { name: w.groomFamily.name, relation: 'Groom’s family' },
        { name: w.brideFamily.name, relation: 'Bride’s family' },
        ...hosts,
      ],
      nameOnList: rows[0].g.name,
      functions: fns.map((f) => {
        const inv = mineById.get(f.id);
        return inv ? this.mine(f, inv, w, defaults, clash.get(f.id) ?? null) : this.context(f, w);
      }),
    };
  }

  private async myInvite(userId: string, weddingId: string, functionId: string) {
    const me = await this.phoneOf(userId);
    const rows = await this.myRows(me.phone);
    const row = rows.find((r) => r.w.id === weddingId && r.fn.id === functionId);
    if (!row) throw notFound('Invitation');
    return { ...row, me, all: rows };
  }

  async fn(userId: string, weddingId: string, functionId: string) {
    const { inv, fn, w, me, all } = await this.myInvite(userId, weddingId, functionId);
    const clash = this.clashes(all);
    return { ...this.mine(fn, inv, w, this.defaultsFor(me.prefs), clash.get(fn.id) ?? null), couple: couple(w) };
  }

  /**
   * The ONE write the guest side makes to an invite's reply. Only inside the window.
   * A guest answering overwrites a host-recorded answer and clears byHost.
   */
  async rsvp(userId: string, weddingId: string, functionId: string, rsvp: 'going' | 'not_going' | 'maybe', pax: number) {
    const { inv, fn, w } = await this.myInvite(userId, weddingId, functionId);
    if (w.status !== 'active') throw new AppError('WEDDING_PAUSED', 'Replies are paused for this wedding right now.', 409);
    const win = rsvpWindow(fn);
    if (win.state === 'closed') throw new AppError('RSVP_CLOSED', 'Replies for this function closed 24 hours before it starts. The hosts will call you.', 409);
    if (win.state === 'never') throw new AppError('RSVP_NEVER', 'This function was added too close to the day for replies. The hosts will call you.', 409);
    const people = rsvp === 'going' ? Math.max(1, Math.min(pax || 1, 20)) : 0;
    await col.invites(w.id).doc(inv.id).update({ rsvp, pax: people, respondedAt: F.now(), byHost: false, updatedAt: F.now() });
    return this.fn(userId, weddingId, functionId);
  }

  /** private reminders on the guest's own invite row — the host never sees these */
  async setReminders(userId: string, weddingId: string, functionId: string, offDefaults: number[], mine: number[]) {
    const { inv, w } = await this.myInvite(userId, weddingId, functionId);
    const clean = (a: number[]) => [...new Set(a.map((n) => Math.round(n)).filter((n) => n >= 5 && n <= 20160))].slice(0, 6);
    await col.invites(w.id).doc(inv.id).update({ offDefaults: clean(offDefaults), guestReminders: clean(mine), updatedAt: F.now() });
    return this.fn(userId, weddingId, functionId);
  }

  /** the code the gift desk scans. Only for a guest who is on this wedding's list. */
  async qr(userId: string, weddingId: string) {
    const me = await this.phoneOf(userId);
    const rows = await this.myRows(me.phone, weddingId);
    if (!rows.length) throw notFound('Invitation');
    const g = rows[0].g;
    return { code: `IK1:${g.qrToken}`, name: g.name, weddingId };
  }

  /** card PDF bytes, only for a guest on this wedding */
  async cardKey(userId: string, weddingId: string) {
    const me = await this.phoneOf(userId);
    const rows = await this.myRows(me.phone, weddingId);
    if (!rows.length || !rows[0].w.card) throw notFound('Card');
    return rows[0].w.card;
  }
}
