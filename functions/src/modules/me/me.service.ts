import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { DB, InjectDb } from '../../db/db';
import {
  devices,
  guests,
  hostApplications,
  invites,
  notifications,
  personalEvents,
  sessions,
  tickets,
  UserPrefs,
  UserPrivacy,
  users,
  weddingAccess,
  weddings,
} from '../../db/schema';
import { notFound } from '../../common/errors';
import { prettyPhone, splitE164 } from '../../common/phone';

export type HostingRow = {
  weddingId: string;
  couple: string;
  role: 'owner' | 'cohost' | 'giftdesk';
  status: string;
  startDate: string;
  endDate: string;
  city: string;
};

@Injectable()
export class MeService {
  constructor(@InjectDb() private readonly db: DB) {}

  async user(userId: string) {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
    if (!u) throw notFound('Account');
    return u;
  }

  /** weddings this number runs the console for — owner or family access, handed over by the team */
  async hosting(phone: string): Promise<HostingRow[]> {
    const owned = await this.db
      .select()
      .from(weddings)
      .where(and(eq(weddings.ownerPhone, phone), isNotNull(weddings.handedOverAt), ne(weddings.status, 'draft')));
    const access = await this.db
      .select({ w: weddings, role: weddingAccess.role })
      .from(weddingAccess)
      .innerJoin(weddings, eq(weddings.id, weddingAccess.weddingId))
      .where(
        and(eq(weddingAccess.phone, phone), isNull(weddingAccess.removedAt), isNotNull(weddings.handedOverAt), ne(weddings.status, 'draft')),
      );
    const out = new Map<string, HostingRow>();
    const row = (w: typeof weddings.$inferSelect, role: HostingRow['role']): HostingRow => ({
      weddingId: w.id,
      couple: `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}`,
      role,
      status: w.status,
      startDate: w.startDate,
      endDate: w.endDate,
      city: w.city,
    });
    for (const w of owned) out.set(w.id, row(w, 'owner'));
    for (const { w, role } of access) if (!out.has(w.id)) out.set(w.id, row(w, role));
    return [...out.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  /** 'none' never applied · 'pending' applied, under review · 'granted' a console is live */
  async hostAccess(userId: string, phone: string, hosting: HostingRow[]) {
    if (hosting.length) return 'granted' as const;
    const [app] = await this.db
      .select({ id: hostApplications.id })
      .from(hostApplications)
      .where(
        and(
          or(eq(hostApplications.userId, userId), eq(hostApplications.phone, phone)),
          inArray(hostApplications.status, ['new', 'in_setup']),
        ),
      )
      .limit(1);
    return app ? ('pending' as const) : ('none' as const);
  }

  async me(userId: string) {
    const u = await this.user(userId);
    const hosting = await this.hosting(u.phone);
    const access = await this.hostAccess(u.id, u.phone, hosting);
    const [{ n: unread }] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, u.id), eq(notifications.read, false)));
    const [{ n: invitedTo }] = await this.db
      .select({ n: count() })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(and(eq(guests.phone, u.phone), eq(guests.active, true), eq(invites.invited, true)));
    const [{ n: events }] = await this.db
      .select({ n: count() })
      .from(personalEvents)
      .where(and(eq(personalEvents.userId, u.id), isNull(personalEvents.deletedAt)));
    const { cc, mobile } = splitE164(u.phone);
    return {
      id: u.id,
      firstName: u.firstName,
      familyName: u.familyName,
      city: u.city,
      email: u.email,
      photoUrl: u.photoUrl,
      lang: u.lang,
      phone: u.phone,
      phonePretty: prettyPhone(u.phone),
      cc,
      mobile,
      prefs: u.prefs,
      privacy: u.privacy,
      createdAt: u.createdAt,
      host: { access, weddings: hosting },
      counts: { unreadNotifications: unread, functionsInvited: invitedTo, ownEvents: events },
    };
  }

  async updateProfile(userId: string, p: Partial<{ firstName: string; familyName: string; city: string; email: string | null; lang: 'en' | 'hi' | 'ta' | 'gu'; photoUrl: string | null }>) {
    await this.db.update(users).set({ ...p, updatedAt: new Date() }).where(eq(users.id, userId));
    return this.me(userId);
  }

  async updatePrefs(userId: string, patch: Partial<UserPrefs>) {
    const u = await this.user(userId);
    const prefs = { ...u.prefs, ...patch };
    await this.db.update(users).set({ prefs, updatedAt: new Date() }).where(eq(users.id, userId));
    return prefs;
  }

  async updatePrivacy(userId: string, patch: Partial<UserPrivacy>) {
    const u = await this.user(userId);
    const privacy = { ...u.privacy, ...patch };
    await this.db.update(users).set({ privacy, updatedAt: new Date() }).where(eq(users.id, userId));
    return privacy;
  }

  async registerDevice(userId: string, fcmToken: string, platform: string) {
    await this.db
      .insert(devices)
      .values({ userId, fcmToken, platform })
      .onConflictDoUpdate({ target: devices.fcmToken, set: { userId, platform, updatedAt: new Date() } });
    return { ok: true };
  }

  async removeDevice(userId: string, fcmToken: string) {
    await this.db.delete(devices).where(and(eq(devices.userId, userId), eq(devices.fcmToken, fcmToken)));
    return { ok: true };
  }

  async changePhone(userId: string, phone: string) {
    await this.db.update(users).set({ phone, updatedAt: new Date() }).where(eq(users.id, userId));
    // every old session ends: the number is the identity
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    return this.me(userId);
  }

  /** everything we hold about this person, as one JSON document */
  async export(userId: string) {
    const u = await this.user(userId);
    const myInvites = await this.db
      .select({ invite: invites, guest: guests })
      .from(invites)
      .innerJoin(guests, eq(guests.id, invites.guestId))
      .where(eq(guests.phone, u.phone));
    const ev = await this.db.select().from(personalEvents).where(eq(personalEvents.userId, userId));
    const notifs = await this.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt));
    const tk = await this.db.select().from(tickets).where(eq(tickets.userId, userId));
    return {
      exportedAt: new Date().toISOString(),
      account: { ...u },
      invitations: myInvites.map(({ invite, guest }) => ({
        weddingId: invite.weddingId,
        functionId: invite.functionId,
        nameOnList: guest.name,
        rsvp: invite.rsvp,
        pax: invite.pax,
        respondedAt: invite.respondedAt,
        myReminders: invite.guestReminders,
      })),
      ownEvents: ev,
      notifications: notifs,
      supportTickets: tk,
    };
  }

  /**
   * Deletes the account. Guest-list rows belong to the hosts' weddings and stay,
   * but nothing links them to this person any more once the account is gone.
   */
  async deleteAccount(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(devices).where(eq(devices.userId, userId));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
      await tx.delete(personalEvents).where(eq(personalEvents.userId, userId));
      await tx.delete(notifications).where(eq(notifications.userId, userId));
      await tx
        .update(users)
        .set({
          deletedAt: new Date(),
          firstName: 'Deleted',
          familyName: 'User',
          city: '',
          email: null,
          photoUrl: null,
          phone: `deleted:${userId}`,
        })
        .where(eq(users.id, userId));
    });
    return { ok: true };
  }
}
