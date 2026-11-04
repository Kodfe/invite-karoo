import { getMessaging } from 'firebase-admin/messaging';
import { col, group } from '../../db/paths';
import { getRows, whereIn, writeAll } from '../../db/store';
import { firebaseApp } from './firebase';

export type PushPayload = { title: string; body: string; data?: Record<string, string> };

export class PushService {
  readonly outbox: { userIds: string[]; payload: PushPayload }[] = [];

  async toUsers(userIds: string[], payload: PushPayload): Promise<number> {
    if (!userIds.length) return 0;
    const app = firebaseApp();
    if (!app) {
      this.outbox.push({ userIds, payload });
      if (this.outbox.length > 500) this.outbox.shift();
      return 0;
    }
    const rows = (await Promise.all([...new Set(userIds)].map((u) => getRows<{ fcmToken: string }>(col.devices(u))))).flat();
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
        if (dead.length) {
          const stale = await whereIn(group.devices(), 'fcmToken', dead);
          await writeAll(stale.map((d) => (b) => b.delete(col.devices(String((d as { userId?: string }).userId)).doc(d.id))));
        }
      } catch (e) {
        console.warn(`push failed: ${(e as Error).message}`);
      }
    }
    return sent;
  }
}
