import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { DB, InjectDb } from '../../db/db';
import { blasts, functions, guests, invites, messageLog, weddings } from '../../db/schema';
import { AppError, conflict, notFound } from '../../common/errors';
import { clock12, dayLabel, fnPast } from '../../common/time';
import { WhatsappService } from '../infra/whatsapp.service';
import { NotificationsService } from '../infra/notifications.service';
import { couple } from '../guest/guest.service';
import { HostAccessService } from './host-access.service';

/**
 * WhatsApp blasts: the invitation (rsvp_request) and ONE reminder per function.
 * The double-send guard has five layers:
 *   1 UNIQUE (function, kind)
 *   2 the idempotency key returns the original result on a repeat tap
 *   3 queued → sending → sent; only 'failed' releases the row
 *   4 the app shows a sheet naming the function and the exact count
 *   5 the app never shows the button again once the row reads 'sent'
 * Sending runs in the background, resumably: each recipient is logged, so a
 * restart mid-blast skips everyone already messaged.
 */
@Injectable()
export class BlastService {
  private readonly log = new Logger('Blast');
  private running = false;

  constructor(
    @InjectDb() private readonly db: DB,
    private readonly access: HostAccessService,
    private readonly wa: WhatsappService,
    private readonly notifications: NotificationsService,
  ) {}

  private recipients(functionId: string, kind: 'rsvp_request' | 'reminder') {
    const conds = [eq(invites.functionId, functionId), eq(invites.invited, true), eq(guests.active, true)];
    if (kind === 'reminder') conds.push(ne(invites.rsvp, 'not_going'));
    return this.db
      .select({ inv: invites, g: guests })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(...conds));
  }

  /** what the confirmation sheet shows before sending */
  async preview(userId: string, weddingId: string, functionId: string, kind: 'rsvp_request' | 'reminder') {
    const ctx = await this.access.require(userId, weddingId);
    const [f] = await this.db.select().from(functions).where(and(eq(functions.id, functionId), eq(functions.weddingId, ctx.w.id))).limit(1);
    if (!f) throw notFound('Function');
    const rows = await this.recipients(f.id, kind);
    const appUsers = await this.notifications.usersByPhone(rows.map((r) => r.g.phone));
    const [existing] = await this.db.select().from(blasts).where(and(eq(blasts.functionId, f.id), eq(blasts.kind, kind))).limit(1);
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

  private params(kind: 'rsvp_request' | 'reminder', guest: string, cpl: string, f: typeof functions.$inferSelect, tz: string) {
    const when = `${dayLabel(f.startsAt, tz)}, ${clock12(f.startsAt, tz)}`;
    return kind === 'rsvp_request' ? [guest, cpl, f.name, when, f.venueName] : [guest, f.name, cpl, when, f.venueName];
  }

  private text(kind: 'rsvp_request' | 'reminder', guest: string, cpl: string, f: typeof functions.$inferSelect, tz: string) {
    const [a, b, c, d, e] = this.params(kind, guest, cpl, f, tz);
    return kind === 'rsvp_request'
      ? `Namaste ${a}! ${b} warmly invite you to the ${c} on ${d} at ${e}. Please reply in the Invite Karoo app.`
      : `Reminder: ${a}, the ${b} for ${c}'s wedding is on ${d} at ${e}. See you there!`;
  }

  async send(userId: string, weddingId: string, functionId: string, kind: 'rsvp_request' | 'reminder', idempotencyKey: string) {
    const ctx = await this.access.require(userId, weddingId);
    // layer 2: a repeat tap returns the original
    const [same] = await this.db.select().from(blasts).where(eq(blasts.idempotencyKey, idempotencyKey)).limit(1);
    if (same) {
      if (same.weddingId !== ctx.w.id) throw notFound('Blast');
      return this.view(same);
    }
    if (!ctx.w.sendingEnabled || ctx.w.status !== 'active') {
      throw new AppError('SENDING_OFF', 'Sending is switched off for this wedding. Contact the Invite Karoo team.', 409);
    }
    const [f] = await this.db.select().from(functions).where(and(eq(functions.id, functionId), eq(functions.weddingId, ctx.w.id), isNull(functions.deletedAt))).limit(1);
    if (!f) throw notFound('Function');
    if (fnPast(f)) throw new AppError('FUNCTION_PAST', 'This function is already over', 409);
    if (kind === 'reminder') {
      const [inv] = await this.db.select().from(blasts).where(and(eq(blasts.functionId, f.id), eq(blasts.kind, 'rsvp_request'), eq(blasts.state, 'sent'))).limit(1);
      if (!inv) throw new AppError('INVITE_FIRST', 'Send the invitation for this function first', 409);
    }
    const rows = await this.recipients(f.id, kind);
    if (!rows.length) throw new AppError('NO_RECIPIENTS', 'Nobody to send to on this function', 409);

    const row = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(blasts)
        .where(and(eq(blasts.functionId, f.id), eq(blasts.kind, kind)))
        .for('update')
        .limit(1);
      if (existing && existing.state !== 'failed') {
        throw conflict('ALREADY_SENT', kind === 'reminder' ? 'The WhatsApp reminder for this function has already gone out' : 'The invitation for this function has already gone out');
      }
      if (existing) {
        // layer 3: only a failed blast is released, and it resumes where it stopped
        const [r] = await tx
          .update(blasts)
          .set({ state: 'queued', idempotencyKey, recipientCount: rows.length, sentBy: ctx.phone, error: null })
          .where(eq(blasts.id, existing.id))
          .returning();
        return r;
      }
      const [r] = await tx
        .insert(blasts)
        .values({ weddingId: ctx.w.id, functionId: f.id, kind, idempotencyKey, recipientCount: rows.length, sentBy: ctx.phone })
        .returning();
      return r;
    });
    if (env().NODE_ENV === 'test') await this.processQueued();
    else void this.processQueued();
    return this.view(row);
  }

  private view(b: typeof blasts.$inferSelect) {
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

  /** picks up queued blasts (and ones stuck in 'sending' after a restart) */
  @Cron('*/20 * * * * *')
  async processQueued() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        // claim one blast atomically so two servers never send the same one
        const claimed = await this.db.execute<{ id: string }>(sql`
          update blasts set state = 'sending'
          where id = (
            select id from blasts
            where state = 'queued'
               or (state = 'sending' and created_at < now() - interval '10 minutes')
            order by created_at limit 1 for update skip locked
          )
          returning id`);
        const id = claimed.rows[0]?.id;
        if (!id) break;
        await this.run(id);
      }
    } catch (e) {
      this.log.error((e as Error).message);
    } finally {
      this.running = false;
    }
  }

  private async run(blastId: string) {
    const [b] = await this.db.select().from(blasts).where(eq(blasts.id, blastId)).limit(1);
    const [f] = await this.db.select().from(functions).where(eq(functions.id, b.functionId)).limit(1);
    const [w] = await this.db.select().from(weddings).where(eq(weddings.id, b.weddingId)).limit(1);
    const rows = await this.recipients(f.id, b.kind);
    const done = await this.db
      .select({ to: messageLog.to })
      .from(messageLog)
      .where(and(eq(messageLog.relatedType, 'blast'), eq(messageLog.relatedId, b.id), eq(messageLog.status, 'sent')));
    const already = new Set(done.map((d) => d.to));
    let delivered = already.size;
    let failed = 0;
    const cpl = couple(w);
    for (const { g } of rows) {
      if (already.has(g.phone)) continue;
      const r = await this.wa.send(g.phone, b.kind === 'rsvp_request' ? 'invite' : 'reminder', this.params(b.kind, g.name.split(' ')[0], cpl, f, w.timezone), {
        type: 'blast',
        id: b.id,
      });
      if (r.ok) delivered++;
      else failed++;
    }
    if (b.kind === 'rsvp_request') {
      await this.db
        .update(invites)
        .set({ notifiedAt: new Date() })
        .where(and(eq(invites.functionId, f.id), eq(invites.invited, true), isNull(invites.notifiedAt)));
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
    await this.db
      .update(blasts)
      .set({ state: allFailed ? 'failed' : 'sent', sentAt: new Date(), deliveredCount: delivered, failedCount: failed, error: allFailed ? 'Every message failed' : null })
      .where(eq(blasts.id, b.id));
    this.log.log(`blast ${b.kind} for ${f.name}: ${delivered} sent, ${failed} failed`);
  }

  async state(userId: string, weddingId: string, functionId: string) {
    const ctx = await this.access.require(userId, weddingId);
    const rows = await this.db.select().from(blasts).where(and(eq(blasts.weddingId, ctx.w.id), eq(blasts.functionId, functionId)));
    return rows.map((r) => this.view(r));
  }
}
