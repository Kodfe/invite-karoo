import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gt, inArray, isNull, lt, ne } from 'drizzle-orm';
import { DB, InjectDb } from '../../db/db';
import { functions, guests, invites, reminderFires, users, weddings } from '../../db/schema';
import { APP_DEFAULT_REMINDERS, clock12, dayLabel } from '../../common/time';
import { NotificationsService } from '../infra/notifications.service';
import { couple } from '../guest/guest.service';

const LOOKAHEAD_MS = 15 * 24 * 3600_000;
/** a reminder that should have fired more than this long ago is skipped, not sent late */
const GRACE_MS = 10 * 60_000;

/**
 * Fires the app's own reminders (kind 3) and each guest's private ones (kind 4).
 * Reminders are stored as OFFSETS from the function's start, never as fire times,
 * so a moved function re-arms by construction. `reminder_fires` is keyed on the
 * start it was computed against, so a moved function fires again at its new time.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');
  private running = false;

  constructor(
    @InjectDb() private readonly db: DB,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 * * * * *')
  async tick(now = new Date()) {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.run(now);
    } catch (e) {
      this.log.error((e as Error).message);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async run(now: Date) {
    const rows = await this.db
      .select({ inv: invites, fn: functions, w: weddings, user: users })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .innerJoin(functions, eq(functions.id, invites.functionId))
      .innerJoin(weddings, eq(weddings.id, invites.weddingId))
      .innerJoin(users, and(eq(users.phone, guests.phone), isNull(users.deletedAt)))
      .where(
        and(
          eq(invites.invited, true),
          eq(guests.active, true),
          ne(invites.rsvp, 'not_going'),
          isNull(functions.deletedAt),
          inArray(weddings.status, ['active']),
          gt(functions.startsAt, now),
          lt(functions.startsAt, new Date(now.getTime() + LOOKAHEAD_MS)),
        ),
      );
    let fired = 0;
    for (const { inv, fn, w, user } of rows) {
      const p = user.prefs;
      const defaults = p.rem ? (p.remAt?.length ? p.remAt : APP_DEFAULT_REMINDERS) : [];
      const offsets = [...defaults.filter((o) => !inv.offDefaults.includes(o)), ...inv.guestReminders];
      for (const off of new Set(offsets)) {
        const at = fn.startsAt.getTime() - off * 60_000;
        if (at > now.getTime() || at < now.getTime() - GRACE_MS) continue;
        const ins = await this.db
          .insert(reminderFires)
          .values({ inviteId: inv.id, offsetMin: off, startsAt: fn.startsAt })
          .onConflictDoNothing()
          .returning({ id: reminderFires.id });
        if (!ins.length) continue;
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
    return fired;
  }
}
