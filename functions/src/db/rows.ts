/** New rows and small helpers shared by the REST API and the team functions. */
import { randomToken } from '../common/crypto';
import { zonedDate } from '../common/time';
import { Fn, Guest, Wedding } from './models';
import { col } from './paths';
import { F, getRows } from './store';

export const couple = (w: Pick<Wedding, 'bride' | 'groom'>) => `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}`;

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

/** what a function document stores. The dashboard's copy of this is admin/src/local.ts */
export function fnValues(w: Pick<Wedding, 'timezone'>, f: FunctionInput) {
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
