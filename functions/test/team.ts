import type request from 'supertest';
import { col } from '../src/db/paths';
import { Wedding } from '../src/db/models';
import { FunctionInput, fnValues, liveFunctions } from '../src/db/rows';
import { F, getRows } from '../src/db/store';
import { auth } from '../src/common/firebase-auth';
import { localParts } from '../src/common/time';
import { svc } from '../src/services';
import { bearer } from './setup';

/* What the dashboard does from the browser, for tests that need a wedding to work on. */

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

/** the dashboard puts the workbook in Storage, then names it to the API */
export async function importSheet(http: ReturnType<typeof request>, token: string, weddingId: string, buffer: Buffer, dryRun: boolean) {
  const { uid } = (await auth().getUserByEmail('a@ik.test'))!;
  const s = await svc.storage.put(`imports/${uid}`, { buffer, mimetype: 'application/octet-stream', originalname: 'guests.xlsx', size: buffer.length });
  const r = await http.post(`/v1/team/weddings/${weddingId}/guests/import`).set(bearer(token)).send({ fileKey: s.key, fileName: 'guests.xlsx', dryRun }).expect(200);
  return r.body;
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
