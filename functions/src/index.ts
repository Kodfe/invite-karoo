/**
 * Cloud Functions entry (region asia-south1, Mumbai).
 *   api          the app's REST API — Firebase Hosting serves it at https://api.invitekaroo.com
 *   reminders    every minute: the app's reminders and each guest's own
 *   blastQueued  sends a WhatsApp blast as soon as one is queued
 *   blastSweep   every 5 minutes: picks up blasts that got stuck
 *
 * The Admin Dashboard talks to Firestore and Storage directly (firestore.rules, storage.rules).
 * What it cannot do there is below:
 *   teamMemberAdd, teamMemberEdit, guestsImport, guestsExport, guestsTemplate, weddingFromApplication
 *                 callables: team accounts and Excel work
 *   teamFunctionChanged, teamWeddingChanged, teamTicketMessage
 *                 Firestore triggers: tell guests, hosts and users what the team changed
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import type { Fn, TicketMessage, Wedding } from './db/models';
import { data, type Snap } from './db/store';
import type { CallableName } from './team/callables';

const REGION = 'asia-south1';
setGlobalOptions({ region: REGION, maxInstances: 20 });

/** values kept in Secret Manager (set by the deploy workflow from GitHub secrets) */
const secrets = ['OTP_SECRET', 'WHATSAPP_TOKEN', 'ANTHROPIC_API_KEY'].map((n) => defineSecret(n));

export const api = onRequest({ secrets, memory: '1GiB', timeoutSeconds: 120, concurrency: 40, invoker: 'public' }, async (req, res) => {
  const { handle } = await import('./main');
  await handle(req, res);
});

export const reminders = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Kolkata', secrets, memory: '512MiB', timeoutSeconds: 120 }, async () => {
  const { svc } = await import('./services');
  await svc.reminders.tick();
});

export const blastSweep = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Kolkata', secrets, memory: '512MiB', timeoutSeconds: 540 }, async () => {
  const { svc } = await import('./services');
  await svc.blasts.processQueued();
});

export const blastQueued = onDocumentWritten({ document: 'weddings/{w}/blasts/{b}', secrets, memory: '512MiB', timeoutSeconds: 540 }, async (event) => {
  const after = event.data?.after?.data() as { state?: string } | undefined;
  if (after?.state !== 'queued') return;
  const { svc } = await import('./services');
  await svc.blasts.process(event.params.w, event.params.b);
});

/* ───────────── for the Admin Dashboard ───────────── */

const callable = (name: CallableName) =>
  onCall({ secrets, memory: '1GiB', timeoutSeconds: 300 }, async (req) => {
    const { call } = await import('./team/callables');
    return call(name, req.auth?.uid, req.data);
  });

export const teamMemberAdd = callable('teamMemberAdd');
export const teamMemberEdit = callable('teamMemberEdit');
export const guestsImport = callable('guestsImport');
export const guestsExport = callable('guestsExport');
export const guestsTemplate = callable('guestsTemplate');
export const weddingFromApplication = callable('weddingFromApplication');

const row = <T>(s: unknown) => data<T>(s as Snap) as (T & { id: string }) | null;

export const teamFunctionChanged = onDocumentUpdated({ document: 'weddings/{w}/functions/{f}', secrets, memory: '512MiB', timeoutSeconds: 300 }, async (event) => {
  const before = row<Fn>(event.data?.before);
  const after = row<Fn>(event.data?.after);
  if (!before || !after) return;
  const { functionChanged } = await import('./team/notify');
  await functionChanged(event.params.w, before, after);
});

export const teamWeddingChanged = onDocumentUpdated({ document: 'weddings/{w}', secrets, memory: '512MiB' }, async (event) => {
  const before = row<Wedding>(event.data?.before);
  const after = row<Wedding>(event.data?.after);
  if (!before || !after) return;
  const { weddingChanged } = await import('./team/notify');
  await weddingChanged(before, after);
});

export const teamTicketMessage = onDocumentCreated({ document: 'tickets/{t}/messages/{m}', secrets, memory: '512MiB' }, async (event) => {
  const m = row<TicketMessage>(event.data);
  if (!m) return;
  const { ticketMessage } = await import('./team/notify');
  await ticketMessage(event.params.t, m);
});
