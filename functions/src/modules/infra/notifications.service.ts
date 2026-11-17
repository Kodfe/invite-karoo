import { col } from '../../db/paths';
import { byIds, F, getRows, writeAll } from '../../db/store';
import { NotifAction, User, UserPrefs } from '../../db/models';
import { later } from '../../common/background';
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

export class NotificationsService {
  constructor(private readonly push: PushService) {}

  /** map phone numbers to live app accounts (an invite can exist long before the account) */
  async usersByPhone(phones: string[]) {
    const out = new Map<string, { id: string; prefs: UserPrefs }>();
    if (!phones.length) return out;
    const links = [...(await byIds<{ uid: string }>(col.phones(), phones)).values()];
    const users = await byIds<User>(col.users(), links.map((l) => l.uid));
    for (const l of links) {
      const u = users.get(l.uid);
      if (u && !u.deletedAt) out.set(l.id, { id: u.id, prefs: u.prefs });
    }
    return out;
  }

  /**
   * Write the feed row for every user, then push to those whose preferences allow it.
   * Returns how many users got a feed row.
   */
  async notify(userIds: string[], n: NewNotif): Promise<number> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    await writeAll(
      ids.map((userId) => (b) =>
        b.set(col.notifications(userId).doc(), {
          userId,
          cat: n.cat,
          title: n.title,
          body: n.body,
          long: n.long ?? null,
          art: n.art ?? null,
          action: n.action ?? { type: 'none' },
          read: false,
          pushed: false,
          createdAt: F.now(),
        }),
      ),
    );
    const users = await byIds<User>(col.users(), ids);
    const now = new Date();
    const pushTo = [...users.values()]
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
      later(this.push.toUsers(pushTo, { title: n.title, body: n.body, data }));
    }
    return ids.length;
  }

  /** newest first */
  async feed(userId: string, limit = 100) {
    return getRows(col.notifications(userId).orderBy('createdAt', 'desc').limit(limit));
  }
}
