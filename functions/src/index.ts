/**
 * Cloud Functions entry (region asia-south1, Mumbai).
 *   api          the REST API — Firebase Hosting serves it at https://api.invitekaroo.com
 *   reminders    every minute: the app's reminders and each guest's own
 *   blastQueued  sends a WhatsApp blast as soon as one is queued
 *   blastSweep   every 5 minutes: picks up blasts that got stuck
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import type { Request, Response } from 'express';

const REGION = 'asia-south1';
setGlobalOptions({ region: REGION, maxInstances: 20 });

/** values kept in Secret Manager (set by the deploy workflow from GitHub secrets) */
const secrets = ['OTP_SECRET', 'WHATSAPP_TOKEN', 'ANTHROPIC_API_KEY'].map((n) => defineSecret(n));

let nest: Promise<INestApplication> | null = null;
function app() {
  nest ??= (async () => {
    const { createApp } = await import('./main');
    const a = await createApp({ onFunctions: true });
    await a.init();
    return a;
  })();
  return nest;
}

export const api = onRequest({ secrets, memory: '1GiB', timeoutSeconds: 120, concurrency: 40, invoker: 'public' }, async (req: Request, res: Response) => {
  const a = await app();
  a.getHttpAdapter().getInstance()(req, res);
});

export const reminders = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Kolkata', secrets, memory: '512MiB', timeoutSeconds: 120 }, async () => {
  const { RemindersService } = await import('./modules/reminders/reminders.service');
  await (await app()).get(RemindersService).tick();
});

export const blastSweep = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Kolkata', secrets, memory: '512MiB', timeoutSeconds: 540 }, async () => {
  const { BlastService } = await import('./modules/host/blast.service');
  await (await app()).get(BlastService).processQueued();
});

export const blastQueued = onDocumentWritten({ document: 'weddings/{w}/blasts/{b}', secrets, memory: '512MiB', timeoutSeconds: 540 }, async (event) => {
  const after = event.data?.after?.data() as { state?: string } | undefined;
  if (after?.state !== 'queued') return;
  const { BlastService } = await import('./modules/host/blast.service');
  await (await app()).get(BlastService).process(event.params.w, event.params.b);
});
