import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { DB, InjectDb, Tx } from '../../db/db';
import {
  ApplicationData,
  blasts,
  Family,
  functions,
  giftsReceived,
  guests,
  hostApplications,
  invites,
  Person,
  weddingAccess,
  weddingMedia,
  weddings,
} from '../../db/schema';
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

@Injectable()
export class AdminWeddingsService {
  constructor(
    @InjectDb() private readonly db: DB,
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
    const conds = [];
    if (q.status) conds.push(eq(weddings.status, q.status as 'draft'));
    if (q.q) {
      const like = `%${q.q}%`;
      conds.push(or(ilike(sql`${weddings.bride}->>'name'`, like), ilike(sql`${weddings.groom}->>'name'`, like), ilike(weddings.city, like), ilike(weddings.ownerPhone, `%${q.q.replace(/\D/g, '') || 'x'}%`)));
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await this.db.select().from(weddings).where(where).orderBy(desc(weddings.startDate)).limit(q.limit).offset(q.offset);
    const [{ n }] = await this.db.select({ n: count() }).from(weddings).where(where);
    const ids = rows.map((r) => r.id);
    const gc = ids.length
      ? await this.db.select({ w: guests.weddingId, n: count() }).from(guests).where(and(inArray(guests.weddingId, ids), eq(guests.active, true))).groupBy(guests.weddingId)
      : [];
    const fc = ids.length
      ? await this.db.select({ w: functions.weddingId, n: count() }).from(functions).where(and(inArray(functions.weddingId, ids), isNull(functions.deletedAt))).groupBy(functions.weddingId)
      : [];
    return {
      total: n,
      items: rows.map((w) => ({
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
        guests: gc.find((x) => x.w === w.id)?.n ?? 0,
        functions: fc.find((x) => x.w === w.id)?.n ?? 0,
      })),
    };
  }

  async get(id: string) {
    const [w] = await this.db.select().from(weddings).where(eq(weddings.id, id)).limit(1);
    if (!w) throw notFound('Wedding');
    const fns = await this.db.select().from(functions).where(and(eq(functions.weddingId, id), isNull(functions.deletedAt))).orderBy(asc(functions.startsAt), asc(functions.sort));
    const counts = await this.db
      .select({ fn: invites.functionId, rsvp: invites.rsvp, n: count(), gifts: sql<number>`sum(case when ${invites.giftOut} then 1 else 0 end)` })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(eq(invites.weddingId, id), eq(invites.invited, true), eq(guests.active, true)))
      .groupBy(invites.functionId, invites.rsvp);
    const media = await this.db.select().from(weddingMedia).where(eq(weddingMedia.weddingId, id)).orderBy(asc(weddingMedia.kind), asc(weddingMedia.sort));
    const access = await this.db.select().from(weddingAccess).where(and(eq(weddingAccess.weddingId, id), isNull(weddingAccess.removedAt)));
    const bl = await this.db.select().from(blasts).where(eq(blasts.weddingId, id));
    const [{ n: guestCount }] = await this.db.select({ n: count() }).from(guests).where(and(eq(guests.weddingId, id), eq(guests.active, true)));
    return {
      ...w,
      ownerPhonePretty: prettyPhone(w.ownerPhone),
      couple: couple(w),
      guestCount,
      functions: fns.map((f) => {
        const lp = localParts(f.startsAt, w.timezone);
        const c = counts.filter((x) => x.fn === f.id);
        return {
          ...f,
          date: lp.date,
          start: lp.time,
          end: f.endsAt ? localParts(f.endsAt, w.timezone).time : null,
          dayLabel: dayLabel(f.startsAt, w.timezone),
          timeLabel: clock12(f.startsAt, w.timezone),
          invited: c.reduce((a, x) => a + x.n, 0),
          going: c.find((x) => x.rsvp === 'going')?.n ?? 0,
          giftOut: c.reduce((a, x) => a + Number(x.gifts ?? 0), 0),
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
    const [w] = await this.db
      .insert(weddings)
      .values({
        ownerPhone,
        contactPhone,
        city: input.city,
        timezone: input.timezone ?? 'Asia/Kolkata',
        startDate: input.startDate,
        endDate: input.endDate,
        datesLocked: input.datesLocked ?? true,
        bride: input.bride,
        groom: input.groom,
        brideFamily: input.brideFamily,
        groomFamily: input.groomFamily,
        applicationId,
        createdBy: adminId,
      })
      .returning();
    await this.audit.log({ type: 'admin', id: adminId }, 'wedding.create', w.id);
    return w;
  }

  async update(id: string, patch: Partial<WeddingInput & { status: 'draft' | 'active' | 'paused' | 'ended'; statusReason: string | null; sendingEnabled: boolean }>, adminId: string) {
    const [w] = await this.db.select().from(weddings).where(eq(weddings.id, id)).limit(1);
    if (!w) throw notFound('Wedding');
    const set: Partial<typeof weddings.$inferInsert> = { updatedAt: new Date() };
    const keys = ['city', 'timezone', 'startDate', 'endDate', 'datesLocked', 'bride', 'groom', 'brideFamily', 'groomFamily', 'status', 'statusReason', 'sendingEnabled'] as const;
    for (const k of keys) if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k];
    if (patch.ownerPhone) set.ownerPhone = this.phone(patch.ownerPhone, 'ownerPhone');
    if (patch.contactPhone !== undefined) set.contactPhone = patch.contactPhone ? this.phone(patch.contactPhone, 'contactPhone') : null;
    if (patch.status === 'ended' && !w.endedAt) set.endedAt = new Date();
    await this.db.update(weddings).set(set).where(eq(weddings.id, id));
    await this.audit.log({ type: 'admin', id: adminId }, 'wedding.update', id, { fields: Object.keys(set) });
    return this.get(id);
  }

  /* ───────────── functions ───────────── */

  private fnValues(w: typeof weddings.$inferSelect, f: FunctionInput) {
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
    const [w] = await this.db.select().from(weddings).where(eq(weddings.id, id)).limit(1);
    if (!w) throw notFound('Wedding');
    return w;
  }

  async addFunction(weddingId: string, f: FunctionInput, adminId: string) {
    const w = await this.wedding(weddingId);
    if (w.datesLocked && (f.date < w.startDate || f.date > w.endDate)) {
      throw new AppError('OUTSIDE_DATES', `This date is outside the wedding’s dates (${w.startDate} to ${w.endDate})`, 422, { date: 'Outside the wedding dates' });
    }
    const [row] = await this.db.insert(functions).values({ weddingId, ...this.fnValues(w, f) }).returning();
    await this.audit.log({ type: 'admin', id: adminId }, 'function.add', weddingId, { functionId: row.id });
    return row;
  }

  async updateFunction(weddingId: string, fnId: string, f: Partial<FunctionInput>, adminId: string) {
    const w = await this.wedding(weddingId);
    const [cur] = await this.db.select().from(functions).where(and(eq(functions.id, fnId), eq(functions.weddingId, weddingId), isNull(functions.deletedAt))).limit(1);
    if (!cur) throw notFound('Function');
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
    const [row] = await this.db.update(functions).set({ ...vals, updatedAt: new Date() }).where(eq(functions.id, fnId)).returning();
    const moved = vals.startsAt.getTime() !== cur.startsAt.getTime();
    const venueChanged = vals.venueName !== cur.venueName || vals.venueAddress !== cur.venueAddress;
    // reminder kind 5: the guest is TOLD. Their reminders moved with it (they are offsets).
    if ((moved || venueChanged) && w.status === 'active') {
      const rows = await this.db
        .select({ phone: guests.phone })
        .from(invites)
        .innerJoin(guests, eq(guests.id, invites.guestId))
        .where(and(eq(invites.functionId, fnId), eq(invites.invited, true), eq(guests.active, true)));
      const users = await this.notifications.usersByPhone(rows.map((r) => r.phone));
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
    const [row] = await this.db
      .update(functions)
      .set({ deletedAt: new Date() })
      .where(and(eq(functions.id, fnId), eq(functions.weddingId, weddingId), isNull(functions.deletedAt)))
      .returning();
    if (!row) throw notFound('Function');
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

  async applyParsed(w: typeof weddings.$inferSelect, parsed: ParsedSheet, opts: { mode: 'merge' | 'replace'; dryRun: boolean; createFunctions: boolean }, adminId: string) {
    // the parser judges the Functions sheet on its own; here what counts is whether every
    // function column maps to a function this wedding has, or one we can create from the sheet
    const sheetLevel = parsed.report.errors.filter((e) => !/Functions sheet/.test(e));
    const rep = { ...parsed.report, errors: [...sheetLevel], warnings: [...parsed.report.warnings] };
    const result = { report: rep, added: 0, updated: 0, removed: 0, invitesAdded: 0, functionsCreated: [] as string[], dryRun: opts.dryRun };
    if (rep.errors.length || !parsed.guests.length) {
      if (!rep.errors.length) rep.errors.push('No usable guest rows were found in the sheet.');
      return result;
    }
    const existingFns = await this.db.select().from(functions).where(and(eq(functions.weddingId, w.id), isNull(functions.deletedAt)));
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
    const existing = await this.db.select().from(guests).where(eq(guests.weddingId, w.id));
    const live = new Map(existing.filter((g) => g.active).map((g) => [g.phone, g]));
    const dead = new Map(existing.filter((g) => !g.active).map((g) => [g.phone, g]));
    const sheetPhones = new Set(parsed.guests.map((g) => g.phone));
    for (const g of parsed.guests) {
      if (live.has(g.phone)) result.updated++;
      else result.added++;
    }
    if (opts.mode === 'replace') result.removed = [...live.keys()].filter((p) => !sheetPhones.has(p)).length;
    if (opts.dryRun) return result;

    await this.db.transaction(async (tx: Tx) => {
      for (const pf of toCreate) {
        const [f] = await tx
          .insert(functions)
          .values({
            weddingId: w.id,
            ...this.fnValues(w, {
              name: pf.name,
              date: pf.date!,
              start: pf.start!,
              end: pf.end,
              venueName: pf.venueName || 'Venue to be announced',
              venueAddress: pf.venueAddress || null,
              dressCode: pf.dressCode || null,
              notes: pf.notes || null,
              sort: parsed.functions.indexOf(pf),
            }),
          })
          .returning();
        byName.set(f.name.toLowerCase(), f.id);
      }
      for (const g of parsed.guests) {
        const prev = live.get(g.phone) ?? dead.get(g.phone);
        let guestId: string;
        if (prev) {
          await tx
            .update(guests)
            .set({ name: g.name, side: g.side, relation: g.relation, expectedPax: g.expectedPax, notes: g.notes, active: true, updatedAt: new Date() })
            .where(eq(guests.id, prev.id));
          guestId = prev.id;
        } else {
          const [row] = await tx
            .insert(guests)
            .values({ weddingId: w.id, name: g.name, phone: g.phone, side: g.side, relation: g.relation, expectedPax: g.expectedPax, notes: g.notes, createdVia: 'xls', qrToken: randomToken(12) })
            .returning({ id: guests.id });
          guestId = row.id;
        }
        const fnIds = new Set<string>();
        for (const f of g.fns) {
          const functionId = byName.get(f.name.toLowerCase())!;
          fnIds.add(functionId);
          const r = await tx
            .insert(invites)
            .values({ weddingId: w.id, guestId, functionId, invited: true, giftOut: f.gift })
            .onConflictDoUpdate({ target: [invites.guestId, invites.functionId], set: { invited: true, giftOut: f.gift, updatedAt: new Date() } })
            .returning({ created: sql<boolean>`xmax = 0` });
          if (r[0]?.created) result.invitesAdded++;
        }
        // the sheet is the truth for this guest's functions: functions marked N are taken off
        const ownFns = [...fnIds];
        await tx
          .update(invites)
          .set({ invited: false, updatedAt: new Date() })
          .where(and(eq(invites.guestId, guestId), ownFns.length ? notInArray(invites.functionId, ownFns) : undefined));
      }
      if (opts.mode === 'replace') {
        const gone = [...live.values()].filter((g) => !sheetPhones.has(g.phone)).map((g) => g.id);
        if (gone.length) await tx.update(guests).set({ active: false, updatedAt: new Date() }).where(inArray(guests.id, gone));
      }
      await this.audit.log({ type: 'admin', id: adminId }, 'guests.import', w.id, { added: result.added, updated: result.updated, removed: result.removed }, tx);
    });
    return result;
  }

  async guests(weddingId: string, q: { q?: string; limit: number; offset: number; removed?: boolean }) {
    await this.wedding(weddingId);
    const conds = [eq(guests.weddingId, weddingId), eq(guests.active, !q.removed)];
    if (q.q) conds.push(or(ilike(guests.name, `%${q.q}%`), ilike(guests.phone, `%${q.q.replace(/\D/g, '') || 'x'}%`))!);
    const rows = await this.db.select().from(guests).where(and(...conds)).orderBy(asc(guests.name)).limit(q.limit).offset(q.offset);
    const [{ n }] = await this.db.select({ n: count() }).from(guests).where(and(...conds));
    const inv = rows.length ? await this.db.select().from(invites).where(and(inArray(invites.guestId, rows.map((r) => r.id)), eq(invites.invited, true))) : [];
    return {
      total: n,
      items: rows.map((g) => ({
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
    const fnRows = await this.db.select({ id: functions.id }).from(functions).where(and(eq(functions.weddingId, weddingId), isNull(functions.deletedAt)));
    for (const f of b.functions) if (!fnRows.some((x) => x.id === f.functionId)) throw notFound('Function');
    return this.db.transaction(async (tx) => {
      const [dupe] = await tx.select().from(guests).where(and(eq(guests.weddingId, weddingId), eq(guests.phone, phone), eq(guests.active, true))).limit(1);
      if (dupe && dupe.id !== guestId) throw conflict('GUEST_EXISTS', `${dupe.name} already has this number`);
      let id = guestId;
      if (id) {
        const [g] = await tx
          .update(guests)
          .set({ name: b.name, phone, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes, updatedAt: new Date() })
          .where(and(eq(guests.id, id), eq(guests.weddingId, weddingId)))
          .returning();
        if (!g) throw notFound('Guest');
      } else {
        const [g] = await tx
          .insert(guests)
          .values({ weddingId, name: b.name, phone, side: b.side, relation: b.relation, expectedPax: b.expectedPax, notes: b.notes, createdVia: 'admin', qrToken: randomToken(12) })
          .returning();
        id = g.id;
      }
      for (const f of b.functions) {
        await tx
          .insert(invites)
          .values({ weddingId, guestId: id, functionId: f.functionId, invited: true, giftOut: f.giftOut })
          .onConflictDoUpdate({ target: [invites.guestId, invites.functionId], set: { invited: true, giftOut: f.giftOut, updatedAt: new Date() } });
      }
      const keep = b.functions.map((f) => f.functionId);
      await tx
        .update(invites)
        .set({ invited: false, updatedAt: new Date() })
        .where(and(eq(invites.guestId, id), keep.length ? notInArray(invites.functionId, keep) : undefined));
      await this.audit.log({ type: 'admin', id: adminId }, guestId ? 'guest.update' : 'guest.add', weddingId, { guestId: id }, tx);
      return { id };
    });
  }

  async setGuestActive(weddingId: string, guestId: string, active: boolean, adminId: string) {
    const [g] = await this.db.update(guests).set({ active, updatedAt: new Date() }).where(and(eq(guests.id, guestId), eq(guests.weddingId, weddingId))).returning();
    if (!g) throw notFound('Guest');
    await this.audit.log({ type: 'admin', id: adminId }, active ? 'guest.restore' : 'guest.remove', weddingId, { guestId });
    return { ok: true };
  }

  /** the whole list back out as a workbook, in the same shape it came in */
  async exportGuests(weddingId: string) {
    const w = await this.wedding(weddingId);
    const fns = await this.db.select().from(functions).where(and(eq(functions.weddingId, weddingId), isNull(functions.deletedAt))).orderBy(asc(functions.startsAt));
    const gs = await this.db.select().from(guests).where(and(eq(guests.weddingId, weddingId), eq(guests.active, true))).orderBy(asc(guests.name));
    const inv = gs.length ? await this.db.select().from(invites).where(and(eq(invites.weddingId, weddingId), eq(invites.invited, true))) : [];
    const gifts = await this.db.select().from(giftsReceived).where(and(eq(giftsReceived.weddingId, weddingId), isNull(giftsReceived.deletedAt)));
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
      const [{ n }] = await this.db.select({ n: count() }).from(weddingMedia).where(and(eq(weddingMedia.weddingId, weddingId), eq(weddingMedia.type, 'video')));
      if (n >= 1) throw conflict('ONE_VIDEO', 'The cover can carry at most one video');
    }
    const s = await this.storage.put(`weddings/${weddingId}/${kind}`, file);
    const [{ n: sort }] = await this.db.select({ n: count() }).from(weddingMedia).where(and(eq(weddingMedia.weddingId, weddingId), eq(weddingMedia.kind, kind)));
    const [row] = await this.db.insert(weddingMedia).values({ weddingId, kind, type: isVideo ? 'video' : 'image', key: s.key, url: s.url, sort }).returning();
    return row;
  }

  async removeMedia(weddingId: string, mediaId: string) {
    const [m] = await this.db.delete(weddingMedia).where(and(eq(weddingMedia.id, mediaId), eq(weddingMedia.weddingId, weddingId))).returning();
    if (!m) throw notFound('Photo');
    await this.storage.remove(m.key);
    return { ok: true };
  }

  async reorderMedia(weddingId: string, ids: string[]) {
    await this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(weddingMedia).set({ sort: i }).where(and(eq(weddingMedia.id, id), eq(weddingMedia.weddingId, weddingId)));
    });
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
    await this.db.update(weddings).set({ card: { key: s.key, name: s.name, size: s.size, pages: pageUrls }, updatedAt: new Date() }).where(eq(weddings.id, weddingId));
    return this.get(weddingId);
  }

  async setVoice(weddingId: string, audio: Express.Multer.File, durationSec?: number) {
    const w = await this.wedding(weddingId);
    this.storage.check('audio', audio);
    const s: Stored = await this.storage.put(`weddings/${weddingId}/voice`, audio);
    if (w.voice?.key) await this.storage.remove(w.voice.key);
    await this.db.update(weddings).set({ voice: { key: s.key, url: s.url, durationSec }, updatedAt: new Date() }).where(eq(weddings.id, weddingId));
    return this.get(weddingId);
  }

  async setPersonPhoto(weddingId: string, who: 'bride' | 'groom' | 'brideFamily' | 'groomFamily', img: Express.Multer.File) {
    const w = await this.wedding(weddingId);
    this.storage.check('image', img);
    const s = await this.storage.put(`weddings/${weddingId}/people`, img);
    const cur = w[who];
    await this.db.update(weddings).set({ [who]: { ...cur, photoUrl: s.url }, updatedAt: new Date() }).where(eq(weddings.id, weddingId));
    return this.get(weddingId);
  }

  /* ───────────── family access (team side) ───────────── */

  async addAccess(weddingId: string, b: { name: string; phone: string; relation: string }, adminId: string) {
    await this.wedding(weddingId);
    const phone = this.phone(b.phone, 'phone');
    const live = await this.db.select().from(weddingAccess).where(and(eq(weddingAccess.weddingId, weddingId), isNull(weddingAccess.removedAt)));
    if (live.some((a) => a.phone === phone)) throw conflict('ALREADY_MEMBER', 'This number already has access');
    await this.db.insert(weddingAccess).values({ weddingId, phone, name: b.name, relation: b.relation, role: 'cohost', addedBy: `admin:${adminId}` });
    return this.get(weddingId);
  }

  async removeAccess(weddingId: string, accessId: string) {
    await this.db.update(weddingAccess).set({ removedAt: new Date() }).where(and(eq(weddingAccess.id, accessId), eq(weddingAccess.weddingId, weddingId)));
    return this.get(weddingId);
  }

  /* ───────────── handover ───────────── */

  /** opens the console on the owner's number and makes the wedding visible to guests */
  async handover(weddingId: string, adminId: string) {
    const w = await this.wedding(weddingId);
    const [{ n: fnCount }] = await this.db.select({ n: count() }).from(functions).where(and(eq(functions.weddingId, weddingId), isNull(functions.deletedAt)));
    const [{ n: guestCount }] = await this.db.select({ n: count() }).from(guests).where(and(eq(guests.weddingId, weddingId), eq(guests.active, true)));
    if (!fnCount) throw new AppError('NO_FUNCTIONS', 'Add at least one function before handing over', 409);
    if (!guestCount) throw new AppError('NO_GUESTS', 'Import the guest list before handing over', 409);
    await this.db.update(weddings).set({ status: 'active', handedOverAt: w.handedOverAt ?? new Date(), updatedAt: new Date() }).where(eq(weddings.id, weddingId));
    if (w.applicationId) await this.db.update(hostApplications).set({ status: 'live', updatedAt: new Date() }).where(eq(hostApplications.id, w.applicationId));
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
    const [app] = await this.db.select().from(hostApplications).where(eq(hostApplications.id, appId)).limit(1);
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
    if (app.cardFile) {
      await this.db.update(weddings).set({ card: { ...app.cardFile, pages: [] } }).where(eq(weddings.id, w.id));
    }
    let imported = null;
    if (app.guestFile) {
      const buf = await this.storage.read(app.guestFile.key);
      const parsed = this.sheets.parse(await this.sheets.read(buf, app.guestFile.name));
      imported = await this.applyParsed(w, parsed, { mode: 'merge', dryRun: false, createFunctions: true }, adminId);
    }
    await this.db.update(hostApplications).set({ weddingId: w.id, status: 'in_setup', assignedTo: app.assignedTo ?? adminId, updatedAt: new Date() }).where(eq(hostApplications.id, app.id));
    return { weddingId: w.id, import: imported };
  }
}
