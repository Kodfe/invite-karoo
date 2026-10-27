import { Injectable } from '@nestjs/common';
import { and, inArray, isNull } from 'drizzle-orm';
import { DB, DbOrTx, InjectDb } from '../../db/db';
import { NotifAction, notifications, UserPrefs, users } from '../../db/schema';
import { localParts } from '../../common/time';
import { PushService } from './push.service';

export type NewNotif = {
  cat: 'inv' | 'rem' | 'host' | 'sys';
  title: string;
  body: string;
  long?: string;
  art?: string;
  action?: NotifAction;
  /** which preference switch governs the push: inv | rem | nudge | msgs. sys always pushes. */
  pref?: 'inv' | 'rem' | 'nudge' | 'msgs';
};

function inQuietHours(p: UserPrefs, now: Date) {
  if (!p.quiet) return false;
  const t = localParts(now).time;
  const { qFrom, qTo } = p;
  return qFrom <= qTo ? t >= qFrom && t < qTo : t >= qFrom || t < qTo;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectDb() private readonly db: DB,
    private readonly push: PushService,
  ) {}

  /** map phone numbers to app accounts (an invite can exist long before the account) */
  async usersByPhone(phones: string[], db: DbOrTx = this.db) {
    if (!phones.length) return new Map<string, { id: string; prefs: UserPrefs }>();
    const rows = await db
      .select({ id: users.id, phone: users.phone, prefs: users.prefs })
      .from(users)
      .where(and(inArray(users.phone, [...new Set(phones)]), isNull(users.deletedAt)));
    return new Map(rows.map((r) => [r.phone, { id: r.id, prefs: r.prefs }]));
  }

  /**
   * Write the feed row for every user, then push to those whose preferences allow it.
   * Returns how many users got a feed row.
   */
  async notify(userIds: string[], n: NewNotif, db: DbOrTx = this.db): Promise<number> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    await db.insert(notifications).values(
      ids.map((userId) => ({
        userId,
        cat: n.cat,
        title: n.title,
        body: n.body,
        long: n.long,
        art: n.art,
        action: n.action ?? { type: 'none' as const },
      })),
    );
    const prefs = await db.select({ id: users.id, prefs: users.prefs }).from(users).where(inArray(users.id, ids));
    const now = new Date();
    const pushTo = prefs
      .filter(({ prefs: p }) => {
        if (!p.push || p.pause) return false;
        if (n.pref && p[n.pref] === false) return false;
        return n.cat === 'sys' || !inQuietHours(p, now);
      })
      .map((p) => p.id);
    if (pushTo.length) {
      const data: Record<string, string> = { cat: n.cat };
      if (n.action) data.action = JSON.stringify(n.action);
      // push is best effort and must never hold up the request that caused it
      void this.push.toUsers(pushTo, { title: n.title, body: n.body, data }).catch(() => undefined);
    }
    return ids.length;
  }
}
