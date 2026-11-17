import { later } from '../../common/background';
import { env } from '../../config/env';
import { AppError, conflict, notFound } from '../../common/app-error';
import { clock12, dayLabel, fnPast } from '../../common/time';
import { col } from '../../db/paths';
import { Blast, blastId, Fn, Guest, Invite, Wedding } from '../../db/models';
import { byIds, data, db, F, getDoc, getRows, writeAll } from '../../db/store';
import { WhatsappService } from '../infra/whatsapp.service';
import { NotificationsService } from '../infra/notifications.service';
import { couple } from '../guest/guest.service';
import { HostAccessService } from './host-access.service';

type Kind = 'rsvp_request' | 'reminder';

/**
 * WhatsApp blasts: the invitation (rsvp_request) and ONE reminder per function.
 * The double-send guard has five layers:
 *   1 the document id is (function, kind) — there can only be one
 *   2 the idempotency key returns the original result on a repeat tap
 *   3 queued → sending → sent; only 'failed' releases it
 *   4 the app shows a sheet naming the function and the exact count
 *   5 the app never shows the button again once it reads 'sent'
 * Sending runs in the background (a Firestore trigger on the blast, plus a sweep for stuck ones),
 * resumably: each recipient is logged, so a restart mid-blast skips everyone already messaged.
 */
export class BlastService {
  private readonly log = console;

  constructor(
    private readonly access: HostAccessService,
    private readonly wa: WhatsappService,
    private readonly notifications: NotificationsService,
  ) {}

  private async recipients(weddingId: string, functionId: string, kind: Kind) {
    let inv = await getRows<Invite>(col.invites(weddingId).where('functionId', '==', functionId).where('invited', '==', true));
    if (kind === 'reminder') inv = inv.filter((i) => i.rsvp !== 'not_going');
    const gs = await byIds<Guest>(col.guests(weddingId), inv.map((i) => i.guestId));
    return inv.map((i) => ({ inv: i, g: gs.get(i.guestId)! })).filter((r) => r.g?.active);
  }

  private async liveFn(weddingId: string, functionId: string) {
    const f = await getDoc<Fn>(col.functions(weddingId).doc(functionId));
    if (!f || f.deletedAt) throw notFound('Function');
    return f;
  }

  /** what the confirmation sheet shows before sending */
  async preview(userId: string, weddingId: string, functionId: string, kind: Kind) {
    const ctx = await this.access.require(userId, weddingId);
    const f = await this.liveFn(ctx.w.id, functionId);
    const rows = await this.recipients(ctx.w.id, f.id, kind);
    const appUsers = await this.notifications.usersByPhone(rows.map((r) => r.g.phone));
    const existing = await getDoc<Blast>(col.blasts(ctx.w.id).doc(blastId(f.id, kind)));
    const sample = rows[0]?.g.name.split(' ')[0] ?? 'Guest';
    return {
      functionId: f.id,
      kind,
      recipientCount: rows.length,
      withApp: rows.filter((r) => appUsers.has(r.g.phone)).length,
      alreadySent: existing && existing.state !== 'failed' ? { state: existing.state, sentAt: existing.sentAt, recipientCount: existing.recipientCount } : null,
      canSend: ctx.w.sendingEnabled && ctx.w.status === 'active' && !fnPast(f) && rows.length > 0 && !(existing && existing.state !== 'failed'),
      sampleText: this.text(kind, sample, couple(ctx.w), f, ctx.w.timezone),
    };
  }

  private params(kind: Kind, guest: string, cpl: string, f: Fn, tz: string) {
    const when = `${dayLabel(f.startsAt, tz)}, ${clock12(f.startsAt, tz)}`;
    return kind === 'rsvp_request' ? [guest, cpl, f.name, when, f.venueName] : [guest, f.name, cpl, when, f.venueName];
  }

  private text(kind: Kind, guest: string, cpl: string, f: Fn, tz: string) {
    const [a, b, c, d, e] = this.params(kind, guest, cpl, f, tz);
    return kind === 'rsvp_request'
      ? `Namaste ${a}! ${b} warmly invite you to the ${c} on ${d} at ${e}. Please reply in the Invite Karoo app.`
      : `Reminder: ${a}, the ${b} for ${c}'s wedding is on ${d} at ${e}. See you there!`;
  }

  async send(userId: string, weddingId: string, functionId: string, kind: Kind, idempotencyKey: string) {
    const ctx = await this.access.require(userId, weddingId);
    // layer 2: a repeat tap returns the original
    const seen = await getDoc<{ weddingId: string; blastId: string }>(col.blastKeys().doc(idempotencyKey));
    if (seen) {
      if (seen.weddingId !== ctx.w.id) throw notFound('Blast');
      const b = await getDoc<Blast>(col.blasts(ctx.w.id).doc(seen.blastId));
      if (b) return this.view(b);
    }
    if (!ctx.w.sendingEnabled || ctx.w.status !== 'active') {
      throw new AppError('SENDING_OFF', 'Sending is switched off for this wedding. Contact the Invite Karoo team.', 409);
    }
    const f = await this.liveFn(ctx.w.id, functionId);
    if (fnPast(f)) throw new AppError('FUNCTION_PAST', 'This function is already over', 409);
    if (kind === 'reminder') {
      const inv = await getDoc<Blast>(col.blasts(ctx.w.id).doc(blastId(f.id, 'rsvp_request')));
      if (inv?.state !== 'sent') throw new AppError('INVITE_FIRST', 'Send the invitation for this function first', 409);
    }
    const rows = await this.recipients(ctx.w.id, f.id, kind);
    if (!rows.length) throw new AppError('NO_RECIPIENTS', 'Nobody to send to on this function', 409);

    const ref = col.blasts(ctx.w.id).doc(blastId(f.id, kind));
    await db().runTransaction(async (tx) => {
      const existing = data<Blast>(await tx.get(ref));
      if (existing && existing.state !== 'failed') {
        throw conflict('ALREADY_SENT', kind === 'reminder' ? 'The WhatsApp reminder for this function has already gone out' : 'The invitation for this function has already gone out');
      }
      tx.set(col.blastKeys().doc(idempotencyKey), { weddingId: ctx.w.id, blastId: ref.id, createdAt: F.now() });
      if (existing) {
        // layer 3: only a failed blast is released, and it resumes where it stopped
        tx.update(ref, { state: 'queued', idempotencyKey, recipientCount: rows.length, sentBy: ctx.phone, error: null, claimedAt: null });
      } else {
        tx.set(ref, {
          weddingId: ctx.w.id, functionId: f.id, kind, state: 'queued', idempotencyKey,
          recipientCount: rows.length, deliveredCount: 0, failedCount: 0,
          sentBy: ctx.phone, sentAt: null, error: null, claimedAt: null, createdAt: F.now(),
        });
      }
    });
    // sent after answering; the cron sweep picks up one that stops partway. Tests send right away.
    if (env().NODE_ENV === 'test') await this.process(ctx.w.id, ref.id);
    else later(this.process(ctx.w.id, ref.id));
    return this.view((await getDoc<Blast>(ref))!);
  }

  private view(b: Blast) {
    return {
      id: b.id,
      functionId: b.functionId,
      kind: b.kind,
      state: b.state,
      recipientCount: b.recipientCount,
      deliveredCount: b.deliveredCount,
      failedCount: b.failedCount,
      sentAt: b.sentAt,
    };
  }

  /** claims a queued blast (or one stuck in 'sending' for 10 minutes) and sends it; no-op otherwise */
  async process(weddingId: string, id: string) {
    const ref = col.blasts(weddingId).doc(id);
    const claimed = await db().runTransaction(async (tx) => {
      const b = data<Blast & { claimedAt: Date | null }>(await tx.get(ref));
      if (!b) return false;
      const stuck = b.state === 'sending' && (!b.claimedAt || Date.now() - b.claimedAt.getTime() > 10 * 60_000);
      if (b.state !== 'queued' && !stuck) return false;
      tx.update(ref, { state: 'sending', claimedAt: F.now() });
      return true;
    });
    if (!claimed) return;
    try {
      await this.run(weddingId, id);
    } catch (e) {
      this.log.error(`blast ${id}: ${(e as Error).message}`);
      await ref.update({ state: 'failed', error: (e as Error).message.slice(0, 300) });
    }
  }

  /** the sweep: every queued or stuck blast, across weddings */
  async processQueued() {
    const qs = await Promise.all([
      getRows<Blast>(db().collectionGroup('blasts').where('state', '==', 'queued')),
      getRows<Blast>(db().collectionGroup('blasts').where('state', '==', 'sending')),
    ]);
    for (const b of qs.flat()) await this.process(b.weddingId, b.id);
  }

  private async run(weddingId: string, id: string) {
    const b = (await getDoc<Blast>(col.blasts(weddingId).doc(id)))!;
    const f = (await getDoc<Fn>(col.functions(weddingId).doc(b.functionId)))!;
    const w = (await getDoc<Wedding>(col.weddings().doc(weddingId)))!;
    const rows = await this.recipients(weddingId, f.id, b.kind);
    const done = await getRows<{ to: string }>(col.messageLog().where('relatedType', '==', 'blast').where('relatedId', '==', `${weddingId}/${b.id}`).where('status', '==', 'sent'));
    const already = new Set(done.map((d) => d.to));
    let delivered = already.size;
    let failed = 0;
    const cpl = couple(w);
    for (const { g } of rows) {
      if (already.has(g.phone)) continue;
      const r = await this.wa.send(g.phone, b.kind === 'rsvp_request' ? 'invite' : 'reminder', this.params(b.kind, g.name.split(' ')[0], cpl, f, w.timezone), {
        type: 'blast',
        id: `${weddingId}/${b.id}`,
      });
      if (r.ok) delivered++;
      else failed++;
    }
    if (b.kind === 'rsvp_request') {
      const unnotified = rows.filter((r) => !r.inv.notifiedAt);
      await writeAll(unnotified.map((r) => (bt) => bt.update(col.invites(weddingId).doc(r.inv.id), { notifiedAt: F.now() })));
    }
    // the same message lands in the app feed of every guest who has the app
    const users = await this.notifications.usersByPhone(rows.map((r) => r.g.phone));
    await this.notifications.notify([...users.values()].map((u) => u.id), {
      cat: b.kind === 'rsvp_request' ? 'inv' : 'rem',
      pref: b.kind === 'rsvp_request' ? 'inv' : 'rem',
      title: b.kind === 'rsvp_request' ? `You are invited · ${f.name}` : `Reminder · ${f.name}`,
      body: b.kind === 'rsvp_request' ? `${cpl} · ${dayLabel(f.startsAt, w.timezone)}, ${clock12(f.startsAt, w.timezone)} · tap to reply` : `${cpl} · ${dayLabel(f.startsAt, w.timezone)}, ${clock12(f.startsAt, w.timezone)} at ${f.venueName}`,
      art: f.icon,
      action: { type: 'function', weddingId: w.id, functionId: f.id },
    });
    const allFailed = delivered === 0 && failed > 0;
    await col.blasts(weddingId).doc(id).update({
      state: allFailed ? 'failed' : 'sent', sentAt: F.now(), deliveredCount: delivered, failedCount: failed, error: allFailed ? 'Every message failed' : null,
    });
    this.log.log(`blast ${b.kind} for ${f.name}: ${delivered} sent, ${failed} failed`);
  }

  async state(userId: string, weddingId: string, functionId: string) {
    const ctx = await this.access.require(userId, weddingId);
    const rows = await getRows<Blast>(col.blasts(ctx.w.id).where('functionId', '==', functionId));
    return rows.map((r) => this.view(r));
  }
}
