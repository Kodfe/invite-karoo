import { Injectable, Logger } from '@nestjs/common';
import { getMessaging } from 'firebase-admin/messaging';
import { inArray } from 'drizzle-orm';
import { DB, InjectDb } from '../../db/db';
import { devices } from '../../db/schema';
import { firebaseApp } from './firebase';

export type PushPayload = { title: string; body: string; data?: Record<string, string> };

@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  readonly outbox: { userIds: string[]; payload: PushPayload }[] = [];

  constructor(@InjectDb() private readonly db: DB) {}

  async toUsers(userIds: string[], payload: PushPayload): Promise<number> {
    if (!userIds.length) return 0;
    const app = firebaseApp();
    if (!app) {
      this.outbox.push({ userIds, payload });
      if (this.outbox.length > 500) this.outbox.shift();
      return 0;
    }
    const rows = await this.db.select().from(devices).where(inArray(devices.userId, userIds));
    if (!rows.length) return 0;
    const tokens = rows.map((r) => r.fcmToken);
    let sent = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      try {
        const res = await getMessaging(app).sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: { priority: 'high', notification: { channelId: 'invite_karoo' } },
          apns: { payload: { aps: { sound: 'default' } } },
        });
        sent += res.successCount;
        const dead = res.responses
          .map((r, idx) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code ?? '') ? batch[idx] : null))
          .filter((t): t is string => !!t);
        if (dead.length) await this.db.delete(devices).where(inArray(devices.fcmToken, dead));
      } catch (e) {
        this.log.warn(`push failed: ${(e as Error).message}`);
      }
    }
    return sent;
  }
}
