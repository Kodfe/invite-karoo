/**
 * The guest-list work a browser should not do: reading a workbook and writing thousands of rows,
 * and building a workbook back out. Everything else the dashboard does itself, in Firestore.
 */
import ExcelJS from 'exceljs';
import { notFound } from '../common/app-error';
import { Application, ApplicationData, GiftReceived, Guest, Invite, inviteId, Wedding } from '../db/models';
import { col } from '../db/paths';
import { couple, fnValues, liveFunctions, newGuest, newInvite } from '../db/rows';
import { Batch, F, getDoc, getRows, writeAll } from '../db/store';
import { AuditService } from '../modules/infra/audit.service';
import { StorageService } from '../modules/infra/storage.service';
import { ParsedFunction, ParsedSheet, SheetService } from '../modules/sheets/sheet.service';

const sheets = new SheetService();
const storage = new StorageService();
const audit = new AuditService();

type ImportOpts = { mode: 'merge' | 'replace'; dryRun: boolean; createFunctions: boolean };

async function wedding(id: string) {
  const w = await getDoc<Wedding>(col.weddings().doc(id));
  if (!w) throw notFound('Wedding');
  return w;
}

export const template = () => sheets.template();

/**
 * Imports a guest-list workbook into a wedding.
 *   merge    add new guests, update existing ones (matched by phone), add their functions
 *   replace  as merge, and take off the list everyone not in the sheet
 * Function columns are matched to the wedding's functions by name. When `createFunctions`
 * is on, functions on the Functions sheet that the wedding does not have yet are created first.
 * `dryRun` reports what would happen and changes nothing.
 */
export async function importGuests(weddingId: string, file: { buffer: Buffer; originalname: string }, opts: ImportOpts, adminId: string) {
  const w = await wedding(weddingId);
  const parsed = sheets.parse(await sheets.read(file.buffer, file.originalname));
  return applyParsed(w, parsed, opts, adminId);
}

async function applyParsed(w: Wedding, parsed: ParsedSheet, opts: ImportOpts, adminId: string) {
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
    const vals = fnValues(w, {
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
  await audit.log({ type: 'admin', id: adminId }, 'guests.import', w.id, { added: result.added, updated: result.updated, removed: result.removed });
  return result;
}

/** the whole list back out as a workbook, in the same shape it came in */
export async function exportGuests(weddingId: string) {
  const w = await wedding(weddingId);
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

/** turns an application into a draft wedding, importing its sheet if it came with one */
export async function fromApplication(appId: string, adminId: string) {
  const app = await getDoc<Application>(col.applications().doc(appId));
  if (!app) throw notFound('Application');
  if (app.weddingId) return { weddingId: app.weddingId, import: null };
  const d: ApplicationData = app.data;
  const elders = (s?: string) => (s ? s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : []);
  const ref = col.weddings().doc();
  await ref.set({
    ownerPhone: app.phone,
    contactPhone: null,
    city: d.city,
    timezone: 'Asia/Kolkata',
    startDate: d.startDate,
    endDate: d.endDate,
    datesLocked: d.datesLocked ?? true,
    status: 'draft',
    statusReason: null,
    sendingEnabled: true,
    bride: { name: d.brideName, parents: d.brideParents ?? '', city: d.city },
    groom: { name: d.groomName, parents: d.groomParents ?? '', city: d.city },
    brideFamily: { name: d.brideFamily || `${d.brideName.split(' ').slice(-1)[0]} Family`, elders: elders(d.brideElders), city: d.city },
    groomFamily: { name: d.groomFamily || `${d.groomName.split(' ').slice(-1)[0]} Family`, elders: elders(d.groomElders), city: d.city },
    card: app.cardFile ? { ...app.cardFile, pages: [] } : null,
    voice: null,
    applicationId: app.id,
    handedOverAt: null,
    endedAt: null,
    createdBy: adminId,
    createdAt: F.now(),
    updatedAt: F.now(),
  });
  await audit.log({ type: 'admin', id: adminId }, 'wedding.create', ref.id);
  let imported = null;
  if (app.guestFile) {
    const buf = await storage.read(app.guestFile.key);
    const parsed = sheets.parse(await sheets.read(buf, app.guestFile.name));
    imported = await applyParsed(await wedding(ref.id), parsed, { mode: 'merge', dryRun: false, createFunctions: true }, adminId);
  }
  await col.applications().doc(app.id).update({ weddingId: ref.id, status: 'in_setup', assignedTo: app.assignedTo ?? adminId, updatedAt: F.now() });
  return { weddingId: ref.id, import: imported };
}
