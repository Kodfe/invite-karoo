import { Injectable, Logger } from '@nestjs/common';
import { APP_DEFAULT_REMINDERS, clock12, dayLabel } from '../../common/time';
import { col, group } from '../../db/paths';
import { Fn, Guest, Invite, Wedding } from '../../db/models';
import { byIds, getRows, isAlreadyExists } from '../../db/store';
import { NotificationsService } from '../infra/notifications.service';
import { couple } from '../guest/guest.service';
import { MeService } from '../me/me.service';

const LOOKAHEAD_MS = 15 * 24 * 3600_000;
/** a reminder that should have fired more than this long ago is skipped, not sent late */
const GRACE_MS = 10 * 60_000;

/**
 * Fires the app's own reminders (kind 3) and each guest's private ones (kind 4). Runs every minute.
 * Reminders are stored as OFFSETS from the function's start, never as fire times,
 * so a moved function re-arms by construction. A fire is keyed on the start it was
 * computed against, so a moved function fires again at its new time.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(
    private readonly notifications: NotificationsService,
    private readonly me: MeService,
  ) {}

  async tick(now = new Date()) {
    try {
      return await this.run(now);
    } catch (e) {
      this.log.error((e as Error).message);
      return 0;
    }
  }

  private async run(now: Date) {
    const soon = await getRows<Fn>(group.functions().where('startsAt', '>', now).where('startsAt', '<', new Date(now.getTime() + LOOKAHEAD_MS)));
    const fns = soon.filter((f) => !f.deletedAt);
    if (!fns.length) return 0;
    const weddings = await byIds<Wedding>(col.weddings(), fns.map((f) => f.weddingId));
    let fired = 0;
    for (const fn of fns) {
      const w = weddings.get(fn.weddingId);
      if (!w || w.status !== 'active') continue;
      const inv = (await getRows<Invite>(col.invites(w.id).where('functionId', '==', fn.id).where('invited', '==', true))).filter((i) => i.rsvp !== 'not_going');
      if (!inv.length) continue;
      const guests = await byIds<Guest>(col.guests(w.id), inv.map((i) => i.guestId));
      const users = await this.notifications.usersByPhone([...guests.values()].filter((g) => g.active).map((g) => g.phone));
      for (const i of inv) {
        const g = guests.get(i.guestId);
        const user = g?.active ? users.get(g.phone) : undefined;
        if (!user) continue;
        const p = user.prefs;
        const defaults = p.rem ? (p.remAt?.length ? p.remAt : APP_DEFAULT_REMINDERS) : [];
        const offsets = [...defaults.filter((o) => !i.offDefaults.includes(o)), ...i.guestReminders];
        for (const off of new Set(offsets)) {
          const at = fn.startsAt.getTime() - off * 60_000;
          if (at > now.getTime() || at < now.getTime() - GRACE_MS) continue;
          try {
            await col.reminderFires().doc(`${w.id}_${i.id}_${off}_${fn.startsAt.getTime()}`).create({ weddingId: w.id, inviteId: i.id, offsetMin: off, startsAt: fn.startsAt, firedAt: now });
          } catch (e) {
            if (isAlreadyExists(e)) continue;
            throw e;
          }
          await this.notifications.notify([user.id], {
            cat: 'rem',
            pref: 'rem',
            title: `${fn.name} ${off >= 1440 ? 'tomorrow' : `in ${off >= 60 ? `${Math.round(off / 60)} h` : `${off} min`}`}`,
            body: `${couple(w)} · ${dayLabel(fn.startsAt, w.timezone)}, ${clock12(fn.startsAt, w.timezone)} at ${fn.venueName}`,
            art: fn.icon,
            action: { type: 'function', weddingId: w.id, functionId: fn.id },
          });
          fired++;
        }
      }
    }
    return fired;
  }
}
