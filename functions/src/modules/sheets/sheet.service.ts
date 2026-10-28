import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import { AppError } from '../../common/errors';
import { toE164 } from '../../common/phone';

export type Grids = Record<string, string[][]>;

export type ParsedGuest = {
  row: number;
  name: string;
  phone: string;
  side: 'bride' | 'groom';
  relation: string;
  expectedPax: number;
  notes: string;
  fns: { name: string; gift: boolean }[];
};
export type ParsedFunction = {
  name: string;
  date: string | null; // YYYY-MM-DD
  start: string | null; // HH:mm
  end: string | null;
  venueName: string;
  venueAddress: string;
  dressCode: string;
  notes: string;
};
export type ParsedWedding = Partial<{
  brideName: string; brideParents: string; groomName: string; groomParents: string;
  brideFamily: string; groomFamily: string; city: string; startDate: string; endDate: string;
}>;
export type SheetReport = {
  guests: number;
  bad: number;
  gifts: number;
  functions: string[];
  errors: string[];
  warnings: string[];
  badRows: string[];
};
export type ParsedSheet = { report: SheetReport; guests: ParsedGuest[]; functions: ParsedFunction[]; wedding: ParsedWedding };

const KNOWN = ['guest name', 'mobile', 'side', 'relation', 'expected pax', 'notes'];
const yes = (v: unknown) => ['y', 'yes', '1', 'true', '✓', 'haan', 'ha'].includes(String(v ?? '').trim().toLowerCase());

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? '');
  }
  return String(v);
}

/** "23-05-2026", "23/05/2026", "2026-05-23", an ISO timestamp, or an Excel serial → YYYY-MM-DD */
export function parseDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const ms = Math.round((Number(t) - 25569) * 86400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

/** "19:30", "7:30 PM", "7 pm", an Excel fraction (0.8125) or an ISO timestamp → HH:mm */
export function parseTime(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(t);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
  }
  m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1].padStart(2, '0')}:${m[2]}`;
  m = /T(\d{2}):(\d{2})/.exec(t);
  if (m) return `${m[1]}:${m[2]}`;
  if (/^0?\.\d+$/.test(t)) {
    const mins = Math.round(Number(t) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Reads the guest-list workbook in any of the shapes hosts send back:
 * .xlsx, the SpreadsheetML .xls the app hands out, or a plain .csv (guests only).
 * Bad rows are REPORTED, never fatal — 12 broken rows out of 240 must not cost the other 228.
 */
@Injectable()
export class SheetService {
  async read(buf: Buffer, filename: string): Promise<Grids> {
    const head = buf.subarray(0, 64).toString('utf8').trimStart();
    if (/\.csv$/i.test(filename)) return { guests: this.csv(buf.toString('utf8')) };
    if (head.startsWith('<?xml') || head.startsWith('<Workbook')) return this.spreadsheetMl(buf.toString('utf8'));
    if (buf[0] === 0x50 && buf[1] === 0x4b) return this.xlsx(buf);
    if (buf[0] === 0xd0 && buf[1] === 0xcf) {
      throw new AppError('OLD_EXCEL', 'This is an old .xls file. Open it in Excel or Google Sheets and save it as .xlsx, then upload again.', 415);
    }
    throw new AppError('BAD_SHEET', 'We could not read this file. Upload the .xlsx or .csv version of the guest list.', 415);
  }

  private csv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell.trim()); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows.filter((r) => r.some((x) => x));
  }

  private spreadsheetMl(xml: string): Grids {
    const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, isArray: (n) => ['Worksheet', 'Row', 'Cell'].includes(n) });
    const doc = p.parse(xml);
    const out: Grids = {};
    for (const ws of doc?.Workbook?.Worksheet ?? []) {
      const name = String(ws['@Name'] ?? '').toLowerCase();
      const rows: string[][] = [];
      for (const r of ws?.Table?.Row ?? []) {
        const line: string[] = [];
        for (const c of r.Cell ?? []) {
          const idx = c['@Index'] ? Number(c['@Index']) - 1 : line.length;
          while (line.length < idx) line.push('');
          const d = c.Data;
          line.push(d == null ? '' : String(typeof d === 'object' ? (d['#text'] ?? '') : d).trim());
        }
        rows.push(line);
      }
      out[name] = rows;
    }
    return out;
  }

  private async xlsx(buf: Buffer): Promise<Grids> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const out: Grids = {};
    wb.eachSheet((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row) => {
        const line: string[] = [];
        for (let c = 1; c <= ws.columnCount; c++) line.push(cellText(row.getCell(c).value).trim());
        rows.push(line);
      });
      out[ws.name.toLowerCase()] = rows;
    });
    return out;
  }

  parse(grids: Grids): ParsedSheet {
    const rep: SheetReport = { guests: 0, bad: 0, gifts: 0, functions: [], errors: [], warnings: [], badRows: [] };
    const out: ParsedSheet = { report: rep, guests: [], functions: [], wedding: {} };
    const g = grids.guests ?? grids['guest list'] ?? Object.values(grids)[0];
    if (!g || g.length < 2) {
      rep.errors.push('No Guests sheet found, or it has no rows under the headings.');
      return out;
    }
    const head = g[0].map((h) => String(h ?? '').trim());
    const lower = head.map((h) => h.toLowerCase());
    const iName = lower.indexOf('guest name');
    const iMob = lower.indexOf('mobile');
    const iSide = lower.indexOf('side');
    const iRel = lower.indexOf('relation');
    const iPax = lower.indexOf('expected pax');
    const iNotes = lower.indexOf('notes');
    if (iName < 0) rep.errors.push('The Guests sheet has no "Guest Name" column.');
    if (iMob < 0) rep.errors.push('The Guests sheet has no "Mobile" column.');

    // function columns are discovered, not fixed
    const fnCols: { name: string; i: number; gift: number }[] = [];
    head.forEach((h, i) => {
      const l = h.toLowerCase();
      if (!h || KNOWN.includes(l) || / gift$/i.test(h)) return;
      fnCols.push({ name: h, i, gift: lower.indexOf(`${l} gift`) });
    });
    rep.functions = fnCols.map((f) => f.name);
    if (!fnCols.length) rep.errors.push('No function columns found. Add one column per function, and mark Y or N.');
    head.forEach((h) => {
      if (/ gift$/i.test(h) && !lower.includes(h.replace(/ gift$/i, '').toLowerCase())) {
        rep.warnings.push(`"${h}" has no matching function column, so it was ignored.`);
      }
    });
    if (rep.errors.length) return out;

    const seen = new Map<string, number>();
    for (let r = 1; r < g.length; r++) {
      const row = g[r];
      if (!row || !row.join('').trim()) continue;
      const name = String(row[iName] ?? '').trim();
      const phone = toE164(String(row[iMob] ?? ''));
      let why: string | null = null;
      if (!name) why = 'no name';
      else if (!phone) why = 'mobile number is not valid';
      else if (seen.has(phone)) why = `duplicate of row ${seen.get(phone)}`;
      else if (!fnCols.some((f) => yes(row[f.i]))) why = 'not invited to any function';
      if (why) {
        rep.bad++;
        if (rep.badRows.length < 25) rep.badRows.push(`Row ${r + 1} · ${name || 'unnamed'} — ${why}`);
        continue;
      }
      seen.set(phone!, r + 1);
      const sideRaw = String(row[iSide] ?? '').trim().toLowerCase();
      const fns = fnCols.filter((f) => yes(row[f.i])).map((f) => ({ name: f.name, gift: f.gift > -1 && yes(row[f.gift]) }));
      rep.gifts += fns.filter((f) => f.gift).length;
      rep.guests++;
      out.guests.push({
        row: r + 1,
        name,
        phone: phone!,
        side: sideRaw.startsWith('b') || sideRaw.includes('ladki') ? 'bride' : 'groom',
        relation: iRel > -1 ? String(row[iRel] ?? '').trim().slice(0, 40) : '',
        expectedPax: Math.max(1, Math.min(20, Number(String(row[iPax] ?? '').replace(/\D/g, '')) || 1)),
        notes: iNotes > -1 ? String(row[iNotes] ?? '').trim().slice(0, 300) : '',
        fns,
      });
      if (sideRaw && !/^(b|g)/.test(sideRaw) && !sideRaw.includes('ladki') && !sideRaw.includes('ladka')) {
        rep.warnings.push(`Row ${r + 1}: side "${row[iSide]}" was read as Groom. Use Bride or Groom.`);
      }
    }

    // the Functions sheet has to cover everything the Guests sheet invites people to
    const fs = grids.functions;
    if (fs && fs.length > 1) {
      for (const r of fs.slice(1)) {
        if (!r || !String(r[0] ?? '').trim()) continue;
        out.functions.push({
          name: String(r[0]).trim(),
          date: parseDate(String(r[1] ?? '')),
          start: parseTime(String(r[2] ?? '')),
          end: parseTime(String(r[3] ?? '')),
          venueName: String(r[4] ?? '').trim(),
          venueAddress: String(r[5] ?? '').trim(),
          dressCode: String(r[6] ?? '').trim(),
          notes: String(r[7] ?? '').trim(),
        });
      }
      const named = out.functions.map((f) => f.name.toLowerCase());
      for (const f of fnCols) {
        if (!named.includes(f.name.toLowerCase())) rep.errors.push(`"${f.name}" has guests but no date, time or venue on the Functions sheet.`);
      }
      for (const f of out.functions) {
        if (!f.date) rep.errors.push(`"${f.name}" on the Functions sheet has no valid date (use DD-MM-YYYY).`);
        if (!f.start) rep.errors.push(`"${f.name}" on the Functions sheet has no valid start time (use 19:30 or 7:30 PM).`);
        if (!f.venueName) rep.warnings.push(`"${f.name}" has no venue name.`);
      }
    } else if (fnCols.length) {
      rep.warnings.push('No Functions sheet found. Our team will ask you for the dates, times and venues.');
    }

    const ws = grids.wedding;
    if (ws && ws.length > 1) {
      const h = ws[0].map((x) => String(x ?? '').trim().toLowerCase());
      const v = ws[1];
      const get = (k: string) => {
        const i = h.indexOf(k);
        return i > -1 ? String(v[i] ?? '').trim() : '';
      };
      out.wedding = {
        brideName: get('bride name'),
        brideParents: get('bride parents'),
        groomName: get('groom name'),
        groomParents: get('groom parents'),
        brideFamily: get('bride family'),
        groomFamily: get('groom family'),
        city: get('city'),
        startDate: parseDate(get('start date')) ?? '',
        endDate: parseDate(get('end date')) ?? '',
      };
    }
    return out;
  }

  /** the workbook handed to hosts: Guests, Functions, Wedding, and a How-to sheet */
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Invite Karoo';
    const style = (ws: ExcelJS.Worksheet) => {
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4B2A8E' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.columns.forEach((c) => (c.width = 18));
    };
    const g = wb.addWorksheet('Guests');
    g.addRows([
      ['Guest Name', 'Mobile', 'Side', 'Relation', 'Expected Pax', 'Notes', 'Haldi Ceremony', 'Haldi Ceremony Gift', 'Sangeet Night', 'Sangeet Night Gift', 'Wedding Ceremony', 'Wedding Ceremony Gift', 'Reception', 'Reception Gift'],
      ['Sunita Bothra', '9876543211', 'Bride', 'Bua', 3, 'Comes from Jorhat', 'Y', 'N', 'Y', 'N', 'Y', 'Y', 'Y', 'Y'],
      ['Ratan Lal Jain', '9876543212', 'Groom', 'Business associate', 2, '', 'N', 'N', 'Y', 'N', 'Y', 'N', 'Y', 'N'],
      ['Meera Saikia', '9876543213', 'Bride', 'College friend', 1, '', 'N', 'N', 'Y', 'N', 'Y', 'N', 'N', 'N'],
    ]);
    style(g);
    g.getColumn(2).numFmt = '@';
    const f = wb.addWorksheet('Functions');
    f.addRows([
      ['Function Name', 'Date', 'Start Time', 'End Time', 'Venue Name', 'Venue Address', 'Dress Code', 'Notes'],
      ['Haldi Ceremony', '23-05-2026', '11:00', '14:00', 'Bride home, Lokhra', 'House 14, Lokhra Road, Guwahati', 'Yellow, traditional', 'Lunch served after'],
      ['Sangeet Night', '24-05-2026', '20:30', '00:00', 'Vivanta Banquet Hall', 'GS Road, Guwahati', 'Indo-western', 'Performances from 21:30'],
      ['Wedding Ceremony', '26-05-2026', '21:00', '02:00', 'Lokhra Community Hall', 'Lokhra Chariali, Guwahati', 'Formal traditional', 'Pheras at 23:40'],
      ['Reception', '28-05-2026', '19:30', '23:30', 'Vivanta Banquet Hall', 'GS Road, Guwahati', 'Formal', 'Dinner from 20:30'],
    ]);
    style(f);
    const w = wb.addWorksheet('Wedding');
    w.addRows([
      ['Bride Name', 'Bride Parents', 'Groom Name', 'Groom Parents', 'Bride Family', 'Groom Family', 'City', 'Start Date', 'End Date'],
      ['Luveena Sharma', 'Ramesh & Sunita Sharma', 'Mitesh Ranka', 'Mahesh & Kavita Ranka', 'Sharma Family', 'Ranka Family', 'Guwahati', '23-05-2026', '28-05-2026'],
    ]);
    style(w);
    const h = wb.addWorksheet('How to fill');
    h.getColumn(1).width = 110;
    [
      'INVITE KAROO — guest list',
      '',
      '1. Guests sheet: one row per guest. Mobile is the number they use WhatsApp on (10 digits for India).',
      '2. Side: Bride or Groom.',
      '3. Add ONE column per function, named exactly as on the Functions sheet. Put Y if this guest is invited, N if not.',
      '4. For gifts, add a column "<Function name> Gift" and put Y for guests who should receive a gift at that function.',
      '5. Functions sheet: one row per function. Date as DD-MM-YYYY, time as 19:30 or 7:30 PM.',
      '6. Delete the sample rows before sending. Rows with a missing name or a wrong number are skipped and reported back to you.',
    ].forEach((t, i) => (h.getCell(i + 1, 1).value = t));
    h.getRow(1).font = { bold: true, size: 14 };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
