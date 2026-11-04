/*
 * The rules the dashboard now applies itself, in the browser. These match functions/src/common
 * (phone.ts, time.ts) and functions/src/db/rows.ts: change one, change the other.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/* ───────── phone numbers ───────── */

/** `+91 98644 55120`, `09864455120`, `9864455120` → `+919864455120`; null when it is not a mobile number */
export function toE164(input: string, cc = '+91'): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  const ccDigits = cc.replace(/\D/g, '');
  if (!digits.startsWith('+')) {
    digits = digits.replace(/^0+/, '');
    // a 12-digit Indian number typed without the + (919864455120)
    if (ccDigits === '91' && digits.length === 12 && digits.startsWith('91')) digits = '+' + digits;
    else digits = '+' + ccDigits + digits;
  }
  const p = parsePhoneNumberFromString(digits);
  if (!p || !p.isValid()) return null;
  return p.number;
}

/** "+91 98644 55120" */
export function prettyPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  if (!p) return e164;
  if (p.countryCallingCode === '91') {
    const n = p.nationalNumber;
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return p.formatInternational();
}

/* ───────── times ───────── */

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** a Date from a local date + time in a timezone */
export function zonedDate(dateStr: string, timeStr: string, timeZone = 'Asia/Kolkata'): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMs(new Date(asUtc), timeZone);
  let t = asUtc - offset;
  // correct across a DST edge (not needed for IST, kept for other zones)
  const offset2 = tzOffsetMs(new Date(t), timeZone);
  if (offset2 !== offset) t = asUtc - offset2;
  return new Date(t);
}

/** local "YYYY-MM-DD" and "HH:mm" of an instant in a timezone */
export function localParts(at: Date, timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** "8:30 PM" */
export function clock12(at: Date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at).toUpperCase();
}

/** "Sat, 24 May" */
export function dayLabel(at: Date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
}

/* ───────── weddings ───────── */

export const couple = (w: { bride: { name: string }; groom: { name: string } }) => `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}`;

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
function fnStyle(name: string): { color: string; icon: string } {
  const k = Object.keys(FN_COLORS).find((x) => name.toLowerCase().includes(x));
  const [color, icon] = k ? FN_COLORS[k] : ['#7C5CBF', 'rings'];
  return { color, icon };
}

/** what a function document stores */
export function fnValues(w: { timezone: string }, f: FunctionInput) {
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

/** a new invite row (guest × function) */
export function newInvite(weddingId: string, guestId: string, functionId: string, giftOut: boolean) {
  return {
    weddingId, guestId, functionId, invited: true, notifiedAt: null,
    rsvp: 'none', pax: 0, respondedAt: null, byHost: false, remark: '',
    giftOut, giftOutGiven: false, giftOutGivenAt: null, giftOutGivenBy: null, giftOutMethod: null,
    callAttempts: 0, lastCalledAt: null, callOutcome: 'none',
    guestReminders: [], offDefaults: [],
  };
}

/** 12 random bytes as base64url: the code in a guest's gift-desk QR */
export function qrToken() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
