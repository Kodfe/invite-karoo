import { col } from '../src/db/paths';
import { Fn, TicketMessage, Wedding } from '../src/db/models';
import { FunctionInput, fnValues, liveFunctions } from '../src/db/rows';
import { F, getDoc, getRows } from '../src/db/store';
import { auth } from '../src/common/firebase-auth';
import { localParts } from '../src/common/time';
import type { CallableName } from '../src/team/callables';

/* What the dashboard does from the browser, for tests that need a wedding to work on. */

let adminUid = '';

/** a team function, called as the first admin unless a uid (or undefined) is passed */
export async function teamCall<T = unknown>(name: CallableName, data: unknown, ...as: [string?]): Promise<T> {
  const { call } = await import('../src/team/callables');
  adminUid ||= (await auth().getUserByEmail('a@ik.test'))!.uid;
  return (await call(name, as.length ? as[0] : adminUid, data)) as T;
}

export async function createWedding(w: Pick<Wedding, 'ownerPhone' | 'contactPhone' | 'city' | 'startDate' | 'endDate' | 'bride' | 'groom' | 'brideFamily' | 'groomFamily'>) {
  const ref = col.weddings().doc();
  await ref.set({
    ...w, timezone: 'Asia/Kolkata', datesLocked: true, status: 'draft', statusReason: null, sendingEnabled: true, card: null, voice: null,
    applicationId: null, handedOverAt: null, endedAt: null, createdBy: null, createdAt: F.now(), updatedAt: F.now(),
  });
  return ref.id;
}

export async function addFunction(weddingId: string, f: FunctionInput) {
  const ref = col.functions(weddingId).doc();
  await ref.set({ weddingId, ...fnValues({ timezone: 'Asia/Kolkata' }, f), createdAt: F.now(), updatedAt: F.now(), deletedAt: null });
  return ref.id;
}

export async function weddingSummary(weddingId: string) {
  const fns = await liveFunctions(weddingId);
  const invites = await getRows<{ functionId: string; giftOut: boolean }>(col.invites(weddingId).where('invited', '==', true));
  const guestCount = (await col.guests(weddingId).where('active', '==', true).count().get()).data().count;
  return {
    guestCount,
    functions: fns.map((f) => ({ id: f.id, name: f.name, start: localParts(f.startsAt).time, giftOut: invites.filter((i) => i.functionId === f.id && i.giftOut).length })),
  };
}

/** the write, then what the Firestore trigger does with it */
export async function handover(weddingId: string) {
  const { weddingChanged } = await import('../src/team/notify');
  const ref = col.weddings().doc(weddingId);
  const before = (await getDoc<Wedding>(ref))!;
  await ref.update({ status: 'active', handedOverAt: F.now(), updatedAt: F.now() });
  await weddingChanged(before, (await getDoc<Wedding>(ref))!);
}

export async function moveFunction(weddingId: string, fnId: string, minutes: number) {
  const { functionChanged } = await import('../src/team/notify');
  const ref = col.functions(weddingId).doc(fnId);
  const before = (await getDoc<Fn>(ref))!;
  await ref.update({ startsAt: new Date(before.startsAt.getTime() + minutes * 60_000), updatedAt: F.now() });
  await functionChanged(weddingId, before, (await getDoc<Fn>(ref))!);
}

export async function replyToTicket(ticketId: string, body: string) {
  const { ticketMessage } = await import('../src/team/notify');
  const ref = col.ticketMessages(ticketId).doc();
  await ref.set({ ticketId, author: 'team', adminId: 'team', body, createdAt: F.now() });
  await col.tickets().doc(ticketId).update({ status: 'answered', unreadForUser: F.inc(1), updatedAt: F.now() });
  await ticketMessage(ticketId, (await getDoc<TicketMessage>(ref))!);
}
