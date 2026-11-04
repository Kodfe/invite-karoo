/**
 * Telling people about what the team changed. The dashboard writes to Firestore itself, so these
 * run from Firestore triggers (see index.ts) and fire however the change was made.
 */
import { clock12, dayLabel } from '../common/time';
import { Fn, Guest, Invite, Ticket, TicketMessage, Wedding } from '../db/models';
import { col } from '../db/paths';
import { couple } from '../db/rows';
import { byIds, getDoc, getRows } from '../db/store';
import { NotificationsService } from '../modules/infra/notifications.service';
import { PushService } from '../modules/infra/push.service';

const notifications = new NotificationsService(new PushService());

/** a function moved or changed venue while the wedding is live: the guest is TOLD (reminder kind 5) */
export async function functionChanged(weddingId: string, before: Fn, after: Fn) {
  if (after.deletedAt) return;
  const moved = after.startsAt.getTime() !== before.startsAt.getTime();
  const venueChanged = after.venueName !== before.venueName || after.venueAddress !== before.venueAddress;
  if (!moved && !venueChanged) return;
  const w = await getDoc<Wedding>(col.weddings().doc(weddingId));
  if (w?.status !== 'active') return;
  const inv = await getRows<Invite>(col.invites(weddingId).where('functionId', '==', after.id).where('invited', '==', true));
  const gs = await byIds<Guest>(col.guests(weddingId), inv.map((i) => i.guestId));
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
export async function weddingChanged(before: Wedding, after: Wedding) {
  if (before.handedOverAt || !after.handedOverAt) return;
  const owner = (await notifications.usersByPhone([after.ownerPhone])).get(after.ownerPhone);
  if (!owner) return;
  const fnCount = (await col.functions(after.id).where('deletedAt', '==', null).count().get()).data().count;
  const guestCount = (await col.guests(after.id).where('active', '==', true).count().get()).data().count;
  await notifications.notify([owner.id], {
    cat: 'sys',
    title: 'Your wedding console is ready',
    body: `${couple(after)} · ${fnCount} functions and ${guestCount} guests are set up. Open it from Home.`,
    art: 'rings',
    action: { type: 'screen', screen: 'hhome' },
  });
}

/** the team answered a ticket */
export async function ticketMessage(ticketId: string, m: TicketMessage) {
  if (m.author !== 'team') return;
  const t = await getDoc<Ticket>(col.tickets().doc(ticketId));
  if (!t) return;
  await notifications.notify([t.userId], {
    cat: 'sys',
    pref: 'msgs',
    title: `Reply from Invite Karoo · IK-${String(t.number).padStart(5, '0')}`,
    body: m.body.length > 120 ? m.body.slice(0, 117) + '…' : m.body,
    action: { type: 'ticket', ticketId: t.id },
  });
}
