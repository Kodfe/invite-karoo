import { Injectable } from '@nestjs/common';
import { auth } from '../../common/firebase-auth';
import { notFound } from '../../common/errors';
import { sha256 } from '../../common/crypto';
import { prettyPhone, splitE164 } from '../../common/phone';
import { col, group } from '../../db/paths';
import { Access, Application, Guest, Invite, Ticket, User, UserPrefs, UserPrivacy, Wedding } from '../../db/models';
import { byIds, db, F, getDoc, getRows, rows } from '../../db/store';

export type HostingRow = {
  weddingId: string;
  couple: string;
  role: 'owner' | 'cohost' | 'giftdesk';
  status: string;
  startDate: string;
  endDate: string;
  city: string;
};

/** the active guest-list rows for a number, across every wedding */
export async function guestRowsForPhone(phone: string) {
  return getRows<Guest>(group.guests().where('phone', '==', phone).where('active', '==', true));
}

@Injectable()
export class MeService {
  async user(userId: string) {
    const u = await getDoc<User>(col.users().doc(userId));
    if (!u || u.deletedAt) throw notFound('Account');
    return u;
  }

  /** weddings this number runs the console for — owner or family access, handed over by the team */
  async hosting(phone: string): Promise<HostingRow[]> {
    const live = (w: Wedding) => !!w.handedOverAt && w.status !== 'draft';
    const owned = (await getRows<Wedding>(col.weddings().where('ownerPhone', '==', phone))).filter(live);
    const access = await getRows<Access>(group.access().where('phone', '==', phone).where('removedAt', '==', null));
    const accessWeddings = await byIds<Wedding>(col.weddings(), access.map((a) => a.weddingId));
    const out = new Map<string, HostingRow>();
    const row = (w: Wedding, role: HostingRow['role']): HostingRow => ({
      weddingId: w.id,
      couple: `${w.bride.name.split(' ')[0]} & ${w.groom.name.split(' ')[0]}`,
      role,
      status: w.status,
      startDate: w.startDate,
      endDate: w.endDate,
      city: w.city,
    });
    for (const w of owned) out.set(w.id, row(w, 'owner'));
    for (const a of access) {
      const w = accessWeddings.get(a.weddingId);
      if (w && live(w) && !out.has(w.id)) out.set(w.id, row(w, a.role));
    }
    return [...out.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  /** 'none' never applied · 'pending' applied, under review · 'granted' a console is live */
  async hostAccess(userId: string, phone: string, hosting: HostingRow[]) {
    if (hosting.length) return 'granted' as const;
    const [byUser, byPhone] = await Promise.all([
      getRows<Application>(col.applications().where('userId', '==', userId)),
      getRows<Application>(col.applications().where('phone', '==', phone)),
    ]);
    const pending = [...byUser, ...byPhone].some((a) => a.status === 'new' || a.status === 'in_setup');
    return pending ? ('pending' as const) : ('none' as const);
  }

  /** how many functions this number is invited to, across every wedding */
  async invitedCount(phone: string) {
    const gs = await guestRowsForPhone(phone);
    const counts = await Promise.all(
      gs.map(async (g) => (await col.invites(g.weddingId).where('guestId', '==', g.id).where('invited', '==', true).count().get()).data().count),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  async me(userId: string) {
    const u = await this.user(userId);
    const hosting = await this.hosting(u.phone);
    const access = await this.hostAccess(u.id, u.phone, hosting);
    const [unread, invitedTo, events] = await Promise.all([
      col.notifications(u.id).where('read', '==', false).count().get().then((r) => r.data().count),
      this.invitedCount(u.phone),
      col.events(u.id).where('deletedAt', '==', null).count().get().then((r) => r.data().count),
    ]);
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
    await col.users().doc(userId).update({ ...p, updatedAt: F.now() });
    return this.me(userId);
  }

  async updatePrefs(userId: string, patch: Partial<UserPrefs>) {
    const u = await this.user(userId);
    const prefs = { ...u.prefs, ...patch };
    await col.users().doc(userId).update({ prefs, updatedAt: F.now() });
    return prefs;
  }

  async updatePrivacy(userId: string, patch: Partial<UserPrivacy>) {
    const u = await this.user(userId);
    const privacy = { ...u.privacy, ...patch };
    await col.users().doc(userId).update({ privacy, updatedAt: F.now() });
    return privacy;
  }

  async registerDevice(userId: string, fcmToken: string, platform: string) {
    const key = sha256(fcmToken).slice(0, 40);
    // a token belongs to one account: the last one to register it
    const others = await getRows<{ userId: string }>(group.devices().where('fcmToken', '==', fcmToken));
    const b = db().batch();
    for (const o of others) if (o.userId !== userId) b.delete(col.devices(o.userId).doc(o.id));
    b.set(col.devices(userId).doc(key), { userId, fcmToken, platform, updatedAt: F.now() });
    await b.commit();
    return { ok: true };
  }

  async removeDevice(userId: string, fcmToken: string) {
    await col.devices(userId).doc(sha256(fcmToken).slice(0, 40)).delete();
    return { ok: true };
  }

  /** moves the account to a new number (the caller has checked the number is free and confirmed by code) */
  async changePhone(userId: string, phone: string) {
    const u = await this.user(userId);
    await db().runTransaction(async (tx) => {
      const taken = await tx.get(col.phones().doc(phone));
      if (taken.exists && (taken.data() as { uid: string }).uid !== userId) throw new Error('number taken');
      tx.delete(col.phones().doc(u.phone));
      tx.set(col.phones().doc(phone), { uid: userId });
      tx.update(col.users().doc(userId), { phone, updatedAt: F.now() });
    });
    // every old sign-in ends: the number is the identity
    await auth().revoke(userId);
    return { me: await this.me(userId), customToken: await auth().createCustomToken(userId, { phone }) };
  }

  /** everything we hold about this person, as one JSON document */
  async export(userId: string) {
    const u = await this.user(userId);
    const gs = await getRows<Guest>(group.guests().where('phone', '==', u.phone));
    const myInvites = (
      await Promise.all(gs.map(async (g) => (await getRows<Invite>(col.invites(g.weddingId).where('guestId', '==', g.id))).map((i) => ({ i, g }))))
    ).flat();
    const ev = await getRows(col.events(userId));
    const notifs = await getRows(col.notifications(userId).orderBy('createdAt', 'desc'));
    const tk = await getRows<Ticket>(col.tickets().where('userId', '==', userId));
    return {
      exportedAt: new Date().toISOString(),
      account: { ...u },
      invitations: myInvites.map(({ i, g }) => ({
        weddingId: i.weddingId,
        functionId: i.functionId,
        nameOnList: g.name,
        rsvp: i.rsvp,
        pax: i.pax,
        respondedAt: i.respondedAt,
        myReminders: i.guestReminders,
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
    const u = await this.user(userId);
    for (const c of [col.devices(userId), col.events(userId), col.notifications(userId), col.aiScans(userId)]) await db().recursiveDelete(c);
    const b = db().batch();
    b.delete(col.phones().doc(u.phone));
    b.update(col.users().doc(userId), {
      deletedAt: F.now(),
      firstName: 'Deleted',
      familyName: 'User',
      city: '',
      email: null,
      photoUrl: null,
      phone: `deleted:${userId}`,
    });
    await b.commit();
    await auth().deleteUser(userId);
    return { ok: true };
  }
}

/** used by a few modules: rows → map by id */
export const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
export { rows };
