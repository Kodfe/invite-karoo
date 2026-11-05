/** Telling people about what the team changed. */
import { clock12, dayLabel } from '../common/time';
import { Fn, Guest, Invite, Ticket, Wedding } from '../db/models';
import { col } from '../db/paths';
import { couple } from '../db/rows';
import { byIds, getRows } from '../db/store';
import { svc } from '../services';

const { notifications } = svc;

/** a function moved or changed venue while the wedding is live: the guest is TOLD (reminder kind 5) */
export async function functionChanged(w: Wedding, before: Fn, after: Fn) {
  const moved = after.startsAt.getTime() !== before.startsAt.getTime();
  const venueChanged = after.venueName !== before.venueName || after.venueAddress !== before.venueAddress;
  if ((!moved && !venueChanged) || w.status !== 'active') return;
  const inv = await getRows<Invite>(col.invites(w.id).where('functionId', '==', after.id).where('invited', '==', true));
  const gs = await byIds<Guest>(col.guests(w.id), inv.map((i) => i.guestId));
  const phones = [...gs.values()].filter((g) => g.active).map((g) => g.phone);
  const users = await notifications.usersByPhone(phones);
  const what = moved ? `now ${dayLabel(after.startsAt, w.timezone)}, ${clock12(after.startsAt, w.timezone)}` : `now at ${after.venueName}`;
  await notifications.notify([...users.values()].map((u) => u.id), {
    cat: 'rem',
    title: `${after.name} has changed`,
    body: `${couple(w)} · ${what}`,
    long: moved ? 'The hosts moved this function. Your reminders moved with it — there is nothing for you to do.' : 'The hosts changed the venue for this function.',
    art: after.icon,
    action: { type: 'function', weddingId: w.id, functionId: after.id },
  });
}

/** the first handover: the console opened on the owner's number */
export async function handedOver(w: Wedding, fnCount: number, guestCount: number) {
  const owner = (await notifications.usersByPhone([w.ownerPhone])).get(w.ownerPhone);
  if (!owner) return;
  await notifications.notify([owner.id], {
    cat: 'sys',
    title: 'Your wedding console is ready',
    body: `${couple(w)} · ${fnCount} functions and ${guestCount} guests are set up. Open it from Home.`,
    art: 'rings',
    action: { type: 'screen', screen: 'hhome' },
  });
}

/** the team answered a ticket */
export async function ticketAnswered(t: Ticket, body: string) {
  await notifications.notify([t.userId], {
    cat: 'sys',
    pref: 'msgs',
    title: `Reply from Invite Karoo · IK-${String(t.number).padStart(5, '0')}`,
    body: body.length > 120 ? body.slice(0, 117) + '…' : body,
    action: { type: 'ticket', ticketId: t.id },
  });
}
