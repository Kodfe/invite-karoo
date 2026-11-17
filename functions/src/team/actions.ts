/** Team changes that also have to tell someone, so they run on the server rather than in the browser. */
import { AppError, notFound } from '../common/app-error';
import { localParts } from '../common/time';
import { Fn, Ticket, Wedding } from '../db/models';
import { col } from '../db/paths';
import { FunctionInput, fnValues } from '../db/rows';
import { db, F, getDoc } from '../db/store';
import { svc } from '../services';
import { functionChanged, handedOver, ticketAnswered } from './notify';

async function wedding(id: string) {
  const w = await getDoc<Wedding>(col.weddings().doc(id));
  if (!w) throw notFound('Wedding');
  return w;
}

export async function updateFunction(weddingId: string, fnId: string, f: Partial<FunctionInput>, adminId: string) {
  const w = await wedding(weddingId);
  const ref = col.functions(weddingId).doc(fnId);
  const cur = await getDoc<Fn>(ref);
  if (!cur || cur.deletedAt) throw notFound('Function');
  const lp = localParts(cur.startsAt, w.timezone);
  const vals = fnValues(w, {
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
  });
  await ref.update({ ...vals, updatedAt: F.now() });
  await functionChanged(w, cur, (await getDoc<Fn>(ref))!);
  await svc.audit.log({ type: 'admin', id: adminId }, 'function.update', weddingId, { functionId: fnId, moved: vals.startsAt.getTime() !== cur.startsAt.getTime() });
  return { id: fnId };
}

/** opens the console on the owner's number and makes the wedding visible to guests */
export async function handover(weddingId: string, adminId: string) {
  const w = await wedding(weddingId);
  const fnCount = (await col.functions(weddingId).where('deletedAt', '==', null).count().get()).data().count;
  const guestCount = (await col.guests(weddingId).where('active', '==', true).count().get()).data().count;
  if (!fnCount) throw new AppError('NO_FUNCTIONS', 'Add at least one function before handing over', 409);
  if (!guestCount) throw new AppError('NO_GUESTS', 'Import the guest list before handing over', 409);
  await col.weddings().doc(weddingId).update({ status: 'active', handedOverAt: w.handedOverAt ?? F.now(), updatedAt: F.now() });
  if (w.applicationId) {
    const app = col.applications().doc(w.applicationId);
    if ((await app.get()).exists) await app.update({ status: 'live', updatedAt: F.now() });
  }
  if (!w.handedOverAt) await handedOver(w, fnCount, guestCount);
  await svc.audit.log({ type: 'admin', id: adminId }, 'wedding.handover', weddingId);
  return { id: weddingId };
}

export async function replyToTicket(ticketId: string, body: string, adminId: string) {
  const t = await getDoc<Ticket>(col.tickets().doc(ticketId));
  if (!t) throw notFound('Ticket');
  const batch = db().batch();
  batch.set(col.ticketMessages(ticketId).doc(), { ticketId, author: 'team', adminId, body, createdAt: F.now() });
  batch.update(col.tickets().doc(ticketId), { status: 'answered', unreadForUser: F.inc(1), updatedAt: F.now() });
  await batch.commit();
  await ticketAnswered(t, body);
  return { id: ticketId };
}
