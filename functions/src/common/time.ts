/**
 * Time rules shared by the guest side and the console.
 *
 * RSVP window: closes 24h before a function starts and binds the GUEST only.
 * A function created inside that 24h never opens a window — the hosts call round.
 *   open    the guest can reply
 *   soon    the last 12h of the window
 *   closed  read-only, the last answer stays
 *   never   created too late for a window
 */
export const RSVP_LEAD_MS = 24 * 3600_000;
export const RSVP_SOON_MS = 12 * 3600_000;

export type RsvpWindow = 'open' | 'soon' | 'closed' | 'never';

export function rsvpWindow(fn: { startsAt: Date; createdAt: Date }, now = new Date()): { state: RsvpWindow; closesAt: Date } {
  const closesAt = new Date(fn.startsAt.getTime() - RSVP_LEAD_MS);
  if (fn.createdAt.getTime() > closesAt.getTime()) return { state: 'never', closesAt };
  if (now.getTime() >= closesAt.getTime()) return { state: 'closed', closesAt };
  if (closesAt.getTime() - now.getTime() <= RSVP_SOON_MS) return { state: 'soon', closesAt };
  return { state: 'open', closesAt };
}

/** a function is "past" once it has ended (or 4h after start if no end time) */
export function fnEnd(fn: { startsAt: Date; endsAt: Date | null }) {
  return fn.endsAt ?? new Date(fn.startsAt.getTime() + 4 * 3600_000);
}
export function fnPast(fn: { startsAt: Date; endsAt: Date | null }, now = new Date()) {
  return fnEnd(fn).getTime() <= now.getTime();
}
export function fnLive(fn: { startsAt: Date; endsAt: Date | null }, now = new Date()) {
  return fn.startsAt.getTime() <= now.getTime() && !fnPast(fn, now);
}

/** the app's own reminders, minutes before start, used when the user has no preference set */
export const APP_DEFAULT_REMINDERS = [1440, 180];

/**
 * Build a Date from a local date + time in a timezone (default IST).
 * Works without a tz library by measuring the zone's offset at that instant.
 */
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

export function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
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
