import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { col } from '../../db/paths';
import { Access, Application, ApplicationData, Blast, Family, Fn, GiftReceived, Guest, Invite, inviteId, Media, Person, Wedding } from '../../db/models';
import { Batch, byIds, db, F, getDoc, getRows, writeAll } from '../../db/store';
import { AppError, conflict, notFound } from '../../common/errors';
import { randomToken } from '../../common/crypto';
import { prettyPhone, toE164 } from '../../common/phone';
import { clock12, dayLabel, localParts, zonedDate } from '../../common/time';
import { NotificationsService } from '../infra/notifications.service';
import { StorageService, Stored } from '../infra/storage.service';
import { AuditService } from '../infra/audit.service';
import { ParsedFunction, ParsedSheet, SheetService } from '../sheets/sheet.service';
import { couple } from '../guest/guest.service';

export type WeddingInput = {
  ownerPhone: string;
  contactPhone?: string | null;
  city: string;
  timezone?: string;
  startDate: string;
  endDate: string;
  datesLocked?: boolean;
  bride: Person;
  groom: Person;
  brideFamily: Family;
  groomFamily: Family;
};
export type FunctionInput = {
  name: string;
  date: string;
  start: string;
  end?: string | null;
  venueName: string;
  venueAddress?: string | null;
  mapsUrl?: string | null;
  dressCode?: string | null;
  notes?: string | null;
  color?: string;
  icon?: string;
  giftPlan?: string | null;
  sort?: number;
};

const FN_COLORS: Record<string, [string, string]> = {
  haldi: ['#F5A623', 'flower'],
  mehendi: ['#16A34A', 'flower'],
  mehndi: ['#16A34A', 'flower'],
  sangeet: ['#7C5CBF', 'music'],
  tilak: ['#D18A08', 'diya'],
  engagement: ['#D97706', 'rings'],
  wedding: ['#A21CAF', 'rings'],
  phera: ['#A21CAF', 'rings'],
  reception: ['#1D4ED8', 'gift'],
  vidai: ['#B45309', 'diya'],
};
export function fnStyle(name: string): { color: string; icon: string } {
  const k = Object.keys(FN_COLORS).find((x) => name.toLowerCase().includes(x));
  const [color, icon] = k ? FN_COLORS[k] : ['#7C5CBF', 'rings'];
  return { color, icon };
}

/** the live functions of a wedding, in running order */
export async function liveFunctions(weddingId: string) {
  const fns = await getRows<Fn>(col.functions(weddingId).where('deletedAt', '==', null));
  return fns.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.sort - b.sort);
}

/** a new invite row (guest × function) */
export function newInvite(weddingId: string, guestId: string, functionId: string, giftOut: boolean) {
  return {
    weddingId, guestId, functionId, invited: true, notifiedAt: null,
    rsvp: 'none', pax: 0, respondedAt: null, byHost: false, remark: '',
    giftOut, giftOutGiven: false, giftOutGivenAt: null, giftOutGivenBy: null, giftOutMethod: null,
    callAttempts: 0, lastCalledAt: null, callOutcome: 'none',
    guestReminders: [], offDefaults: [],
    createdAt: F.now(), updatedAt: F.now(),
  };
}

/** a new guest-list row */
export function newGuest(weddingId: string, g: { name: string; phone: string; side: 'bride' | 'groom'; relation: string; expectedPax: number; notes: string }, via: Guest['createdVia']) {
  return { weddingId, ...g, active: true, createdVia: via, qrToken: randomToken(12), createdAt: F.now(), updatedAt: F.now() };
}

@Injectable()
export class AdminWeddingsService {
  constructor(
    private readonly sheets: SheetService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private phone(p: string, field: string) {
    const e = toE164(p);
    if (!e) throw new AppError('VALIDATION', 'Enter a valid mobile number', 422, { [field]: 'Enter a valid mobile number' });
    return e;
  }

  async list(q: { q?: string; status?: string; limit: number; offset: number }) {
    let all = await getRows<Wedding>(q.status ? col.weddings().where('status', '==', q.status) : col.weddings());
    if (q.q) {
      const s = q.q.toLowerCase();
      const digits = q.q.replace(/\D/g, '');
      all = all.filter((w) => w.bride.name.toLowerCase().includes(s) || w.groom.name.toLowerCase().includes(s) || w.city.toLowerCase().includes(s) || (!!digits && w.ownerPhone.includes(digits)));
    }
    all.sort((a, b) => b.startDate.localeCompare(a.startDate));
    const page = all.slice(q.offset, q.offset + q.limit);
    const counts = await Promise.all(
      page.map(async (w) => {
        const [g, f] = await Promise.all([
          col.guests(w.id).where('active', '==', true).count().get(),
          col.functions(w.id).where('deletedAt', '==', null).count().get(),
        ]);
        return { g: g.data().count, f: f.data().count };
      }),
    );
    return {
      total: all.length,
      items: page.map((w, i) => ({
        id: w.id,
        couple: couple(w),
        bride: w.bride.name,
        groom: w.groom.name,
        city: w.city,
        startDate: w.startDate,
        endDate: w.endDate,
        status: w.status,
        ownerPhone: prettyPhone(w.ownerPhone),
        handedOverAt: w.handedOverAt,
        guests: counts[i].g,
        functions: counts[i].f,
      })),
    };
  }

  async get(id: string) {
    const w = await this.wedding(id);
    const [fns, inv, gs, media, access, bl] = await Promise.all([
      liveFunctions(id),
      getRows<Invite>(col.invites(id).where('invited', '==', true)),
      getRows<Guest>(col.guests(id).where('active', '==', true)),
      getRows<Media>(col.media(id)),
      getRows<Access>(col.access(id).where('removedAt', '==', null)),
      getRows<Blast>(col.blasts(id)),
    ]);
    const activeGuests = new Set(gs.map((g) => g.id));
    const live = inv.filter((i) => activeGuests.has(i.guestId));
    media.sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort);
    return {
      ...w,
      ownerPhonePretty: prettyPhone(w.ownerPhone),
      couple: couple(w),
      guestCount: gs.length,
      functions: fns.map((f) => {
        const lp = localParts(f.startsAt, w.timezone);
        const c = live.filter((x) => x.functionId === f.id);
        return {
          ...f,
          date: lp.date,
          start: lp.time,
          end: f.endsAt ? localParts(f.endsAt, w.timezone).time : null,
          dayLabel: dayLabel(f.startsAt, w.timezone),
          timeLabel: clock12(f.startsAt, w.timezone),
          invited: c.length,
          going: c.filter((x) => x.rsvp === 'going').length,
          giftOut: c.filter((x) => x.giftOut).length,
          blasts: bl.filter((b) => b.functionId === f.id).map((b) => ({ kind: b.kind, state: b.state, sentAt: b.sentAt, recipientCount: b.recipientCount })),
        };
      }),
      media,
      access: access.map((a) => ({ ...a, phonePretty: prettyPhone(a.phone) })),
    };
  }

  async create(input: WeddingInput, adminId: string, applicationId?: string) {
    const ownerPhone = this.phone(input.ownerPhone, 'ownerPhone');
    const contactPhone = input.contactPhone ? this.phone(input.contactPhone, 'contactPhone') : null;
    const ref = col.weddings().doc();
    await ref.set({
      ownerPhone,
      contactPhone,
      city: input.city,
      timezone: input.timezone ?? 'Asia/Kolkata',
      startDate: input.startDate,
      endDate: input.endDate,
      datesLocked: input.datesLocked ?? true,
      status: 'draft',
      statusReason: null,
      sendingEnabled: true,
      bride: input.bride,
      groom: input.groom,
      brideFamily: input.brideFamily,
      groomFamily: input.groomFamily,
      card: null,
      voice: null,
      applicationId: applicationId ?? null,
      handedOverAt: null,
      endedAt: null,
      createdBy: adminId,
      createdAt: F.now(),
      updatedAt: F.now(),
    });
    await this.audit.log({ type: 'admin', id: adminId }, 'wedding.create', ref.id);
    return this.wedding(ref.id);
  }

  async update(id: string, patch: Partial<WeddingInput & { status: 'draft' | 'active' | 'paused' | 'ended'; statusReason: string | null; sendingEnabled: boolean }>, adminId: string) {
    const w = await this.wedding(id);
    const set: Record<string, unknown> = { updatedAt: F.now() };
    const keys = ['city', 'timezone', 'startDate', 'endDate', 'datesLocked', 'bride', 'groom', 'brideFamily', 'groomFamily', 'status', 'statusReason', 'sendingEnabled'] as const;
    for (const k of keys) if (patch[k] !== undefined) set[k] = patch[k];
    if (patch.ownerPhone) set.ownerPhone = this.phone(patch.ownerPhone, 'ownerPhone');
    if (patch.contactPhone !== undefined) set.contactPhone = patch.contactPhone ? this.phone(patch.contactPhone, 'contactPhone') : null;
    if (patch.status === 'ended' && !w.endedAt) set.endedAt = F.now();
    await col.weddings().doc(id).update(set);
    await this.audit.log({ type: 'admin', id: adminId }, 'wedding.update', id, { fields: Object.keys(set) });
    return this.get(id);
  }

  /* ───────────── functions ───────────── */

  fnValues(w: Wedding, f: FunctionInput) {
    const startsAt = zonedDate(f.date, f.start, w.timezone);
    let endsAt: Date | null = null;
    if (f.end) {
      endsAt = zonedDate(f.date, f.end, w.timezone);
      // a function that ends after midnight ("21:00 – 02:00")
      if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86400_000);
    }
    const style = fnStyle(f.name);
    return {
      name: f.name.trim(),
      startsAt,
      endsAt,
      venueName: f.venueName.trim(),
      venueAddress: f.venueAddress ?? null,
      mapsUrl: f.mapsUrl ?? null,
      dressCode: f.dressCode ?? null,
      notes: f.notes ?? null,
      color: f.color ?? style.color,
      icon: f.icon ?? style.icon,
      giftPlan: f.giftPlan ?? null,
      sort: f.sort ?? 0,
    };
  }

  private async wedding(id: string) {
    const w = await getDoc<Wedding>(col.weddings().doc(id));
    if (!w) throw notFound('Wedding');
    return w;
  }

  private async fn(weddingId: string, fnId: string) {
    const f = await getDoc<Fn>(col.functions(weddingId).doc(fnId));
    if (!f || f.deletedAt) throw notFound('Function');
    return f;
  }

  async addFunction(weddingId: string, f: FunctionInput, adminId: string) {
    const w = await this.wedding(weddingId);
    if (w.datesLocked && (f.date < w.startDate || f.date > w.endDate)) {
      throw new AppError('OUTSIDE_DATES', `This date is outside the wedding’s dates (${w.startDate} to ${w.endDate})`, 422, { date: 'Outside the wedding dates' });
    }
    const ref = col.functions(weddingId).doc();
    await ref.set({ weddingId, ...this.fnValues(w, f), createdAt: F.now(), updatedAt: F.now(), deletedAt: null });
    await this.audit.log({ type: 'admin', id: adminId }, 'function.add', weddingId, { functionId: ref.id });
    return this.fn(weddingId, ref.id);
  }

  async updateFunction(weddingId: string, fnId: string, f: Partial<FunctionInput>, adminId: string) {
    const w = await this.wedding(weddingId);
    const cur = await this.fn(weddingId, fnId);
    const lp = localParts(cur.startsAt, w.timezone);
    const merged: FunctionInput = {
      name: f.name ?? cur.name,
      date: f.date ?? lp.date,
      start: f.start ?? lp.time,
      end: f.end !== undefined ? f.end : cur.endsAt ? localParts(cur.endsAt, w.timezone).time : null,
      venueName: f.venueName ?? cur.venueName,
      venueAddress: f.venueAddress !== undefined ? f.venueAddress : cur.venueAddress,
      mapsUrl: f.mapsUrl !== undefined ? f.mapsUrl : cur.mapsUrl,
      dressCode: f.dressCode !== undefined ? f.dressCode : cur.dressCode,
      notes: f.notes !== undefined ? f.notes : cur.notes,
      color: f.color ?? cur.color,
      icon: f.icon ?? cur.icon,
      giftPlan: f.giftPlan !== undefined ? f.giftPlan : cur.giftPlan,
      sort: f.sort ?? cur.sort,
    };
    const vals = this.fnValues(w, merged);
    await col.functions(weddingId).doc(fnId).update({ ...vals, updatedAt: F.now() });
    const row = await this.fn(weddingId, fnId);
    const moved = vals.startsAt.getTime() !== cur.startsAt.getTime();
    const venueChanged = vals.venueName !== cur.venueName || vals.venueAddress !== cur.venueAddress;
    // reminder kind 5: the guest is TOLD. Their reminders moved with it (they are offsets).
    if ((moved || venueChanged) && w.status === 'active') {
      const inv = await getRows<Invite>(col.invites(weddingId).where('functionId', '==', fnId).where('invited', '==', true));
      const gs = await byIds<Guest>(col.guests(weddingId), inv.map((i) => i.guestId));
      const phones = [...gs.values()].filter((g) => g.active).map((g) => g.phone);
      const users = await this.notifications.usersByPhone(phones);
      const what = moved ? `now ${dayLabel(vals.startsAt, w.timezone)}, ${clock12(vals.startsAt, w.timezone)}` : `now at ${vals.venueName}`;
      await this.notifications.notify([...users.values()].map((u) => u.id), {
        cat: 'rem',
        title: `${row.name} has changed`,
        body: `${couple(w)} · ${what}`,
        long: moved ? 'The hosts moved this function. Your reminders moved with it — there is nothing for you to do.' : 'The hosts changed the venue for this function.',
        art: row.icon,
        action: { type: 'function', weddingId: w.id, functionId: row.id },
      });
    }
    await this.audit.log({ type: 'admin', id: adminId }, 'function.update', weddingId, { functionId: fnId, moved });
    return row;
  }

  async deleteFunction(weddingId: string, fnId: string, adminId: string) {
    await this.fn(weddingId, fnId);
    await col.functions(weddingId).doc(fnId).update({ deletedAt: F.now() });
    await this.audit.log({ type: 'admin', id: adminId }, 'function.delete', weddingId, { functionId: fnId });
    return { ok: true };
  }

  /* ───────────── guest list import ───────────── */

  /**
   * Imports a guest-list workbook into a wedding.
   *   merge    add new guests, update existing ones (matched by phone), add their functions
   *   replace  as merge, and take off the list everyone not in the sheet
   * Function columns are matched to the wedding's functions by name. When `createFunctions`
   * is on, functions on the Functions sheet that the wedding does not have yet are created first.
   * `dryRun` reports what would happen and changes nothing.
   */
  async importGuests(
    weddingId: string,
    file: { buffer: Buffer; originalname: string },
    opts: { mode: 'merge' | 'replace'; dryRun: boolean; createFunctions: boolean },
    adminId: string,
  ) {
    const w = await this.wedding(weddingId);
    const parsed = this.sheets.parse(await this.sheets.read(file.buffer, file.originalname));
    return this.applyParsed(w, parsed, opts, adminId);
  }

  async applyParsed(w: Wedding, parsed: ParsedSheet, opts: { mode: 'merge' | 'replace'; dryRun: boolean; createFunctions: boolean }, adminId: string) {
    // the parser judges the Functions sheet on its own; here what counts is whether every
    // function column maps to a function this wedding has, or one we can create from the sheet
    const sheetLevel = parsed.report.errors.filter((e) => !/Functions sheet/.test(e));
    const rep = { ...parsed.report, errors: [...sheetLevel], warnings: [...parsed.report.warnings] };
    const result = { report: rep, added: 0, updated: 0, removed: 0, invitesAdded: 0, functionsCreated: [] as string[], dryRun: opts.dryRun };
    if (rep.errors.length || !parsed.guests.length) {
      if (!rep.errors.length) rep.errors.push('No usable guest rows were found in the sheet.');
      return result;
    }
    const existingFns = await liveFunctions(w.id);
    const byName = new Map(existingFns.map((f) => [f.name.toLowerCase(), f.id]));
    const toCreate: ParsedFunction[] = [];
    for (const name of rep.functions) {
      if (byName.has(name.toLowerCase())) continue;
      const pf = parsed.functions.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (!opts.createFunctions) rep.errors.push(`"${name}" is not a function of this wedding. Add it first, or turn on “create functions from the sheet”.`);
      else if (!pf) rep.errors.push(`"${name}" is not a function of this wedding and has no row on the Functions sheet.`);
      else if (!pf.date || !pf.start) rep.errors.push(`"${name}" on the Functions sheet needs a valid date (DD-MM-YYYY) and start time.`);
      else if (w.datesLocked && (pf.date < w.startDate || pf.date > w.endDate)) rep.errors.push(`"${name}" is on ${pf.date}, outside the wedding’s dates.`);
      else toCreate.push(pf);
    }
    result.functionsCreated = toCreate.map((f) => f.name);
    if (rep.errors.length) return result;
    const existing = await getRows<Guest>(col.guests(w.id));
    const live = new Map(existing.filter((g) => g.active).map((g) => [g.phone, g]));
    const dead = new Map(existing.filter((g) => !g.active).map((g) => [g.phone, g]));
    const sheetPhones = new Set(parsed.guests.map((g) => g.phone));
    for (const g of parsed.guests) {
      if (live.has(g.phone)) result.updated++;
      else result.added++;
    }
    if (opts.mode === 'replace') result.removed = [...live.keys()].filter((p) => !sheetPhones.has(p)).length;
    if (opts.dryRun) return result;

    const ops: ((b: Batch) => void)[] = [];
    for (const pf of toCreate) {
      const ref = col.functions(w.id).doc();
      const vals = this.fnValues(w, {
        name: pf.name,
        date: pf.date!,
        start: pf.start!,
        end: pf.end,
        venueName: pf.venueName || 'Venue to be announced',
        venueAddress: pf.venueAddress || null,
        dressCode: pf.dressCode || null,
        notes: pf.notes || null,
        sort: parsed.functions.indexOf(pf),
      });
      ops.push((b) => b.set(ref, { weddingId: w.id, ...vals, createdAt: F.now(), updatedAt: F.now(), deletedAt: null }));
      byName.set(vals.name.toLowerCase(), ref.id);
    }
    const invites = new Map((await getRows<Invite>(col.invites(w.id))).map((i) => [i.id, i]));
    for (const g of parsed.guests) {
      const prev = live.get(g.phone) ?? dead.get(g.phone);
      const gRef = prev ? col.guests(w.id).doc(prev.id) : col.guests(w.id).doc();
      const fields = { name: g.name, side: g.side, relation: g.relation, expectedPax: g.expectedPax, notes: g.notes };
      if (prev) ops.push((b) => b.update(gRef, { ...fields, active: true, updatedAt: F.now() }));
      else ops.push((b) => b.set(gRef, newGuest(w.id, { ...fields, phone: g.phone }, 'xls')));
      const fnIds = new Set<string>();
      for (const f of g.fns) {
        const functionId = byName.get(f.name.toLowerCase())!;
        fnIds.add(functionId);
        const iid = inviteId(gRef.id, functionId);
        const ref = col.invites(w.id).doc(iid);
        if (invites.has(iid)) ops.push((b) => b.update(ref, { invited: true, giftOut: f.gift, updatedAt: F.now() }));
        else {
          result.invitesAdded++;
          ops.push((b) => b.set(ref, newInvite(w.id, gRef.id, functionId, f.gift)));
        }
      }
      // the sheet is the truth for this guest's functions: functions marked N are taken off
      for (const i of invites.values()) {
        if (i.guestId === gRef.id && i.invited && !fnIds.has(i.functionId)) ops.push((b) => b.update(col.invites(w.id).doc(i.id), { invited: false, updatedAt: F.now() }));
      }
    }
    if (opts.mode === 'replace') {
      for (const g of live.values()) if (!sheetPhones.has(g.phone)) ops.push((b) => b.update(col.guests(w.id).doc(g.id), { active: false, updatedAt: F.now() }));
    }
    await writeAll(ops);
    await this.audit.log({ type: 'admin', id: adminId }, 'guests.import', w.id, { added: result.added, updated: result.updated, removed: result.removed });
    return result;
  }

  async guests(weddingId: string, q: { q?: string; limit: number; offset: number; removed?: boolean }) {
    await this.wedding(weddingId);
    let all = await getRows<Guest>(col.guests(weddingId).where('active', '==', !q.removed));
    if (q.q) {
      const s = q.q.toLowerCase();
      const digits = q.q.replace(/\D/g, '');
      all = all.filter((g) => g.name.toLowerCase().includes(s) || (!!digits && g.phone.includes(digits)));
    }
    all.sort((a, b) => a.name.localeCompare(b.name));
    const page = all.slice(q.offset, q.offset + q.limit);
    const ids = new Set(page.map((g) => g.id));
    const inv = page.length ? (await getRows<Invite>(col.invites(weddingId).where('invited', '==', true))).filter((i) => ids.has(i.guestId)) : [];
    return {
      total: all.length,
      items: page.map((g) => ({
        ...g,
        phonePretty: prettyPhone(g.phone),
        functions: inv.filter((i) => i.guestId === g.id).map((i) => ({ functionId: i.functionId, rsvp: i.rsvp, pax: i.pax, giftOut: i.giftOut, giftOutGiven: i.giftOutGiven })),
      })),
    };
  }

  async upsertGuest(
    weddingId: string,
    guestId: string | null,
    b: { name: string; phone: string; side: 'bride' | 'groom'; relation: string; expectedPax: number; notes: string; functions: { functionId: string; giftOut: boolean }[] },
    adminId: string,
  ) {
    await this.wedding(weddingId);
    const phone = this.phone(b.phone, 'phone');
    const fns = await liveFunctions(weddingId);
    for (const f of b.functions) if (!fns.some((x) => x.id === f.functionId)) throw notFound('Function');
    const id = await db().runTransaction(async (tx) => {
      const dupes = await tx.get(col.guests(weddingId).where('phone', '==', phone).where('active', '==', true));
      const dupe = dupes.docs.find((d) => d.id !== guestId);
      if (dupe) throw conflict('GUEST_EXISTS', `${(dupe.data() as Guest).name} already has this number`);
      const current = await tx.get(col.invites(weddingId).where('guestId', '==', guestId ?? '-'));
      if (guestId) {
        const g = await tx.get(col.guests(weddingId).doc(guestId));
        if (!g.exists) throw notFound('Guest');
      }
      const gRef = guestId ? col.guests(weddingId).doc(guestId) : col.guests(weddingId).doc();
      const fields = { name: b.name, phone, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes };
      if (guestId) tx.update(gRef, { ...fields, updatedAt: F.now() });
      else tx.set(gRef, newGuest(weddingId, fields, 'admin'));
      const have = new Set(current.docs.map((d) => d.id));
      for (const f of b.functions) {
        const ref = col.invites(weddingId).doc(inviteId(gRef.id, f.functionId));
        if (have.has(ref.id)) tx.update(ref, { invited: true, giftOut: f.giftOut, updatedAt: F.now() });
        else tx.set(ref, newInvite(weddingId, gRef.id, f.functionId, f.giftOut));
      }
      const keep = new Set(b.functions.map((f) => f.functionId));
      for (const d of current.docs) {
        const i = d.data() as Invite;
        if (!keep.has(i.functionId) && i.invited) tx.update(d.ref, { invited: false, updatedAt: F.now() });
      }
      return gRef.id;
    });
    await this.audit.log({ type: 'admin', id: adminId }, guestId ? 'guest.update' : 'guest.add', weddingId, { guestId: id });
    return { id };
  }

  async setGuestActive(weddingId: string, guestId: string, active: boolean, adminId: string) {
    const g = await getDoc<Guest>(col.guests(weddingId).doc(guestId));
    if (!g) throw notFound('Guest');
    await col.guests(weddingId).doc(guestId).update({ active, updatedAt: F.now() });
    await this.audit.log({ type: 'admin', id: adminId }, active ? 'guest.restore' : 'guest.remove', weddingId, { guestId });
    return { ok: true };
  }

  /** the whole list back out as a workbook, in the same shape it came in */
  async exportGuests(weddingId: string) {
    const w = await this.wedding(weddingId);
    const fns = await liveFunctions(weddingId);
    const gs = (await getRows<Guest>(col.guests(weddingId).where('active', '==', true))).sort((a, b) => a.name.localeCompare(b.name));
    const inv = gs.length ? await getRows<Invite>(col.invites(weddingId).where('invited', '==', true)) : [];
    const gifts = await getRows<GiftReceived>(col.gifts(weddingId).where('deletedAt', '==', null));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Guests');
    const head = ['Guest Name', 'Mobile', 'Side', 'Relation', 'Expected Pax', 'Notes'];
    for (const f of fns) head.push(f.name, `${f.name} Gift`, `${f.name} Reply`, `${f.name} Pax`);
    ws.addRow(head);
    for (const g of gs) {
      const row: (string | number)[] = [g.name, g.phone.replace('+91', ''), g.side === 'bride' ? 'Bride' : 'Groom', g.relation, g.expectedPax, g.notes];
      for (const f of fns) {
        const i = inv.find((x) => x.guestId === g.id && x.functionId === f.id);
        row.push(i ? 'Y' : 'N', i?.giftOut ? 'Y' : 'N', i ? i.rsvp : '', i?.pax ?? '');
      }
      ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true };
    const gw = wb.addWorksheet('Gifts received');
    gw.addRow(['Function', 'From', 'Phone', 'Amount', 'Item', 'Note', 'Recorded by', 'When']);
    for (const g of gifts) {
      gw.addRow([fns.find((f) => f.id === g.functionId)?.name ?? '', g.giverName, g.giverPhone, g.amount ?? '', g.itemName ?? '', g.note, g.recordedBy, g.recordedAt.toISOString()]);
    }
    gw.getRow(1).font = { bold: true };
    return { name: `${couple(w).replace(/[^a-z0-9]+/gi, '-')}-guests.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  /* ───────────── media ───────────── */

  async addMedia(weddingId: string, kind: 'cover' | 'couple' | 'family', file: Express.Multer.File) {
    await this.wedding(weddingId);
    const isVideo = file.mimetype.startsWith('video/');
    this.storage.check(isVideo ? 'video' : 'image', file);
    if (isVideo && kind !== 'cover') throw new AppError('VIDEO_COVER_ONLY', 'Videos can only go in the cover carousel', 422);
    if (isVideo) {
      const n = (await col.media(weddingId).where('type', '==', 'video').count().get()).data().count;
      if (n >= 1) throw conflict('ONE_VIDEO', 'The cover can carry at most one video');
    }
    const s = await this.storage.put(`weddings/${weddingId}/${kind}`, file);
    const sort = (await col.media(weddingId).where('kind', '==', kind).count().get()).data().count;
    const ref = col.media(weddingId).doc();
    await ref.set({ weddingId, kind, type: isVideo ? 'video' : 'image', key: s.key, url: s.url, posterUrl: null, sort, createdAt: F.now() });
    return getDoc<Media>(ref);
  }

  async removeMedia(weddingId: string, mediaId: string) {
    const m = await getDoc<Media>(col.media(weddingId).doc(mediaId));
    if (!m) throw notFound('Photo');
    await col.media(weddingId).doc(mediaId).delete();
    await this.storage.remove(m.key);
    return { ok: true };
  }

  async reorderMedia(weddingId: string, ids: string[]) {
    const have = await byIds<Media>(col.media(weddingId), ids);
    await writeAll(ids.filter((id) => have.has(id)).map((id, i) => (b) => b.update(col.media(weddingId).doc(id), { sort: i })));
    return { ok: true };
  }

  async setCard(weddingId: string, pdf: Express.Multer.File, pages: Express.Multer.File[]) {
    const w = await this.wedding(weddingId);
    this.storage.check('pdf', pdf);
    pages.forEach((p) => this.storage.check('image', p));
    const s = await this.storage.put(`weddings/${weddingId}/card`, pdf);
    const pageUrls: string[] = [];
    for (const p of pages) pageUrls.push((await this.storage.put(`weddings/${weddingId}/card`, p)).url);
    if (w.card?.key) await this.storage.remove(w.card.key);
    await col.weddings().doc(weddingId).update({ card: { key: s.key, name: s.name, size: s.size, pages: pageUrls }, updatedAt: F.now() });
    return this.get(weddingId);
  }

  async setVoice(weddingId: string, audio: Express.Multer.File, durationSec?: number) {
    const w = await this.wedding(weddingId);
    this.storage.check('audio', audio);
    const s: Stored = await this.storage.put(`weddings/${weddingId}/voice`, audio);
    if (w.voice?.key) await this.storage.remove(w.voice.key);
    await col.weddings().doc(weddingId).update({ voice: { key: s.key, url: s.url, durationSec: durationSec ?? null }, updatedAt: F.now() });
    return this.get(weddingId);
  }

  async setPersonPhoto(weddingId: string, who: 'bride' | 'groom' | 'brideFamily' | 'groomFamily', img: Express.Multer.File) {
    const w = await this.wedding(weddingId);
    this.storage.check('image', img);
    const s = await this.storage.put(`weddings/${weddingId}/people`, img);
    await col.weddings().doc(weddingId).update({ [who]: { ...w[who], photoUrl: s.url }, updatedAt: F.now() });
    return this.get(weddingId);
  }

  /* ───────────── family access (team side) ───────────── */

  async addAccess(weddingId: string, b: { name: string; phone: string; relation: string }, adminId: string) {
    await this.wedding(weddingId);
    const phone = this.phone(b.phone, 'phone');
    const live = await getRows<Access>(col.access(weddingId).where('removedAt', '==', null));
    if (live.some((a) => a.phone === phone)) throw conflict('ALREADY_MEMBER', 'This number already has access');
    await col.access(weddingId).doc().set({ weddingId, phone, name: b.name, relation: b.relation, role: 'cohost', addedBy: `admin:${adminId}`, addedAt: F.now(), removedAt: null });
    return this.get(weddingId);
  }

  async removeAccess(weddingId: string, accessId: string) {
    const a = await getDoc<Access>(col.access(weddingId).doc(accessId));
    if (a && !a.removedAt) await col.access(weddingId).doc(accessId).update({ removedAt: F.now() });
    return this.get(weddingId);
  }

  /* ───────────── handover ───────────── */

  /** opens the console on the owner's number and makes the wedding visible to guests */
  async handover(weddingId: string, adminId: string) {
    const w = await this.wedding(weddingId);
    const fnCount = (await col.functions(weddingId).where('deletedAt', '==', null).count().get()).data().count;
    const guestCount = (await col.guests(weddingId).where('active', '==', true).count().get()).data().count;
    if (!fnCount) throw new AppError('NO_FUNCTIONS', 'Add at least one function before handing over', 409);
    if (!guestCount) throw new AppError('NO_GUESTS', 'Import the guest list before handing over', 409);
    await col.weddings().doc(weddingId).update({ status: 'active', handedOverAt: w.handedOverAt ?? F.now(), updatedAt: F.now() });
    if (w.applicationId) {
      const app = col.applications().doc(w.applicationId);
      if ((await app.get()).exists) await app.update({ status: 'live', updatedAt: F.now() });
    }
    const owner = (await this.notifications.usersByPhone([w.ownerPhone])).get(w.ownerPhone);
    if (owner) {
      await this.notifications.notify([owner.id], {
        cat: 'sys',
        title: 'Your wedding console is ready',
        body: `${couple(w)} · ${fnCount} functions and ${guestCount} guests are set up. Open it from Home.`,
        art: 'rings',
        action: { type: 'screen', screen: 'hhome' },
      });
    }
    await this.audit.log({ type: 'admin', id: adminId }, 'wedding.handover', weddingId);
    return this.get(weddingId);
  }

  /* ───────────── from an application ───────────── */

  async fromApplication(appId: string, adminId: string) {
    const app = await getDoc<Application>(col.applications().doc(appId));
    if (!app) throw notFound('Application');
    if (app.weddingId) return { weddingId: app.weddingId, import: null };
    const d: ApplicationData = app.data;
    const elders = (s?: string) => (s ? s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : []);
    const w = await this.create(
      {
        ownerPhone: app.phone,
        city: d.city,
        startDate: d.startDate,
        endDate: d.endDate,
        datesLocked: d.datesLocked ?? true,
        bride: { name: d.brideName, parents: d.brideParents, city: d.city },
        groom: { name: d.groomName, parents: d.groomParents, city: d.city },
        brideFamily: { name: d.brideFamily || `${d.brideName.split(' ').slice(-1)[0]} Family`, elders: elders(d.brideElders), city: d.city },
        groomFamily: { name: d.groomFamily || `${d.groomName.split(' ').slice(-1)[0]} Family`, elders: elders(d.groomElders), city: d.city },
      },
      adminId,
      app.id,
    );
    if (app.cardFile) await col.weddings().doc(w.id).update({ card: { ...app.cardFile, pages: [] } });
    let imported = null;
    if (app.guestFile) {
      const buf = await this.storage.read(app.guestFile.key);
      const parsed = this.sheets.parse(await this.sheets.read(buf, app.guestFile.name));
      imported = await this.applyParsed(w, parsed, { mode: 'merge', dryRun: false, createFunctions: true }, adminId);
    }
    await col.applications().doc(app.id).update({ weddingId: w.id, status: 'in_setup', assignedTo: app.assignedTo ?? adminId, updatedAt: F.now() });
    return { weddingId: w.id, import: imported };
  }
}
