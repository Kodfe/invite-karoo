/**
 * INVITE KAROO — Firestore data model
 *
 *   users/{uid}                     an app account (uid = Firebase Auth uid)
 *     devices/{tokenHash}           FCM tokens
 *     notifications/{id}            the in-app feed
 *     events/{id}                   the user's own events (typed or scanned)
 *     aiScans/{id}
 *   phones/{e164}                   { uid } — one live account per number
 *   otp/{e164}                      the current WhatsApp code for a number + send history
 *   signupTickets/{sha256(ticket)}  number confirmed, profile still to come
 *   admins/{uid}                    the team (Firebase Auth email accounts, claim ikRole)
 *   applications/{id}               "Host a wedding" applications
 *   weddings/{wid}
 *     media/{id}  access/{id}  functions/{fid}  guests/{gid}
 *     invites/{gid}_{fid}           ONE per guest × function: RSVP, pax, gift-out, private reminders
 *     blasts/{fid}_{kind}           WhatsApp blast — the id itself makes it once per function
 *     nudges/{id}  giftCategories/{id}  gifts/{id}
 *   giftCategories/{id}             system categories shared by every wedding
 *   blastKeys/{idempotencyKey}      a blast request seen before
 *   reminderFires/{inviteId}_{offset}_{startsMs}   a reminder that already fired
 *   tickets/{id} → messages/{id}    support
 *   counters/tickets                ticket numbers
 *   messageLog/{id}  auditLog/{id}
 *
 * Invites resolve to an app user by PHONE NUMBER (guests.phone), never by uid: the team imports a
 * guest list long before most guests install the app. Dates are stored as Timestamps and read back
 * as Dates (see store.ts). "Date only" values (YYYY-MM-DD) stay strings.
 */

export type Lang = 'en' | 'hi' | 'ta' | 'gu';
export type Side = 'bride' | 'groom';
export type Rsvp = 'none' | 'going' | 'maybe' | 'not_going';
export type WeddingStatus = 'draft' | 'active' | 'paused' | 'ended';
export type AccessRole = 'owner' | 'cohost' | 'giftdesk';
export type BlastKind = 'rsvp_request' | 'reminder';
export type BlastState = 'queued' | 'sending' | 'sent' | 'failed';
export type ApplicationStatus = 'new' | 'in_setup' | 'live' | 'rejected';
export type AdminRole = 'admin' | 'setup' | 'support';
export type TicketStatus = 'open' | 'answered' | 'closed';
export type NotifCat = 'inv' | 'rem' | 'host' | 'sys';
export type GiftMethod = 'qr' | 'manual';
export type CallOutcome = 'none' | 'answered' | 'no_answer' | 'wrong_number' | 'call_back';

export type UserPrefs = {
  wa: boolean; push: boolean; sms: boolean;
  inv: boolean; rem: boolean; remAt: number[]; nudge: boolean; msgs: boolean;
  quiet: boolean; qFrom: string; qTo: string; pause: boolean;
};
export type UserPrivacy = { city: boolean; seen: boolean };

export const DEFAULT_PREFS: UserPrefs = {
  wa: true, push: true, sms: false, inv: true, rem: true, remAt: [1440, 180],
  nudge: true, msgs: true, quiet: false, qFrom: '22:00', qTo: '07:00', pause: false,
};
export const DEFAULT_PRIVACY: UserPrivacy = { city: true, seen: true };

type WithId = { id: string };

export type User = WithId & {
  phone: string; firstName: string; familyName: string; city: string;
  email: string | null; photoUrl: string | null; lang: Lang;
  prefs: UserPrefs; privacy: UserPrivacy;
  lastSeenAt: Date | null; createdAt: Date; updatedAt: Date; deletedAt: Date | null;
};

export type Otp = WithId & {
  phone: string; purpose: 'login' | 'signup' | 'change_number';
  codeHash: string; attempts: number; expiresAt: Date; consumedAt: Date | null; createdAt: Date;
  /** send times in the last hour (rate limit) */
  sends: Date[];
};

export type Device = WithId & { fcmToken: string; platform: string; userId: string; updatedAt: Date };

export type Admin = WithId & { email: string; name: string; role: AdminRole; active: boolean; lastLoginAt: Date | null; createdAt: Date };

export type ApplicationData = {
  brideName: string; brideParents?: string; groomName: string; groomParents?: string;
  brideFamily?: string; brideElders?: string; groomFamily?: string; groomElders?: string;
  city: string; startDate: string; endDate: string; datesLocked?: boolean;
};
export type FileRef = { key: string; name: string; size: number };

export type Application = WithId & {
  userId: string | null; phone: string; status: ApplicationStatus; data: ApplicationData;
  guestFile: FileRef | null; guestReport: Record<string, unknown> | null; cardFile: FileRef | null;
  weddingId: string | null; assignedTo: string | null; adminNotes: string | null;
  createdAt: Date; updatedAt: Date;
};

export type Person = { name: string; parents?: string; city?: string; photoUrl?: string | null };
export type Family = { name: string; elders: string[]; city?: string; photoUrl?: string | null };
export type CardFile = { key: string; name: string; size: number; pages: string[] };
export type VoiceFile = { key: string; url: string; durationSec?: number };

export type Wedding = WithId & {
  ownerPhone: string; contactPhone: string | null; city: string; timezone: string;
  startDate: string; endDate: string; datesLocked: boolean;
  status: WeddingStatus; statusReason: string | null; sendingEnabled: boolean;
  bride: Person; groom: Person; brideFamily: Family; groomFamily: Family;
  card: CardFile | null; voice: VoiceFile | null;
  applicationId: string | null; handedOverAt: Date | null; endedAt: Date | null;
  createdBy: string | null; createdAt: Date; updatedAt: Date;
};

export type Media = WithId & { weddingId: string; kind: 'cover' | 'couple' | 'family'; type: 'image' | 'video'; key: string; url: string; posterUrl: string | null; sort: number; createdAt: Date };

export type Access = WithId & { weddingId: string; phone: string; name: string; relation: string; role: AccessRole; addedBy: string | null; addedAt: Date; removedAt: Date | null };

export type Fn = WithId & {
  weddingId: string; name: string; startsAt: Date; endsAt: Date | null;
  venueName: string; venueAddress: string | null; mapsUrl: string | null; dressCode: string | null; notes: string | null;
  color: string; icon: string; giftPlan: string | null; sort: number;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
};

export type Guest = WithId & {
  weddingId: string; name: string; phone: string; side: Side; relation: string; expectedPax: number; notes: string;
  active: boolean; createdVia: 'xls' | 'host' | 'admin'; qrToken: string; createdAt: Date; updatedAt: Date;
};

export type Invite = WithId & {
  weddingId: string; guestId: string; functionId: string;
  invited: boolean; notifiedAt: Date | null;
  rsvp: Rsvp; pax: number; respondedAt: Date | null; byHost: boolean; remark: string;
  giftOut: boolean; giftOutGiven: boolean; giftOutGivenAt: Date | null; giftOutGivenBy: string | null; giftOutMethod: GiftMethod | null;
  callAttempts: number; lastCalledAt: Date | null; callOutcome: CallOutcome;
  /** the guest's own reminders — minutes before start. PRIVATE: hosts never see these. */
  guestReminders: number[];
  /** app-default reminder offsets this guest switched off */
  offDefaults: number[];
  createdAt: Date; updatedAt: Date;
};
export const inviteId = (guestId: string, functionId: string) => `${guestId}_${functionId}`;

export type Blast = WithId & {
  weddingId: string; functionId: string; kind: BlastKind; state: BlastState; idempotencyKey: string;
  recipientCount: number; deliveredCount: number; failedCount: number;
  sentBy: string | null; sentAt: Date | null; error: string | null; createdAt: Date;
};
export const blastId = (functionId: string, kind: BlastKind) => `${functionId}_${kind}`;

export type Nudge = WithId & { weddingId: string; functionId: string | null; audience: string; recipientCount: number; appCount: number; message: string; sentBy: string | null; createdAt: Date };

export type GiftCategory = WithId & { weddingId: string | null; key: string; label: string; isCash: boolean; isSystem: boolean; active: boolean; sort: number; createdAt: Date };

export type GiftReceived = WithId & {
  weddingId: string; functionId: string; guestId: string | null; giverName: string; giverPhone: string;
  categoryId: string; amount: number | null; itemName: string | null; note: string; method: GiftMethod;
  recordedBy: string; recordedAt: Date; deletedAt: Date | null;
};

export type OwnWeddingFn = { name: string; date: string; time: string; venue?: string; note?: string; color?: string };

export type PersonalEvent = WithId & {
  userId: string; title: string; type: string; date: string; time: string | null;
  venue: string; city: string; notes: string; icon: string; imageUrl: string | null;
  source: 'manual' | 'ai'; ownWedding: { functions: OwnWeddingFn[] } | null; reminders: number[];
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
};

export type AiScan = WithId & { userId: string; imageKey: string; status: 'done' | 'failed'; result: Record<string, unknown> | null; error: string | null; createdAt: Date };

export type NotifAction =
  | { type: 'function'; weddingId: string; functionId: string }
  | { type: 'wedding'; weddingId: string }
  | { type: 'screen'; screen: string }
  | { type: 'ticket'; ticketId: string }
  | { type: 'none' };

export type Notification = WithId & {
  userId: string; cat: NotifCat; title: string; body: string; long: string | null; art: string | null;
  action: NotifAction; read: boolean; pushed: boolean; createdAt: Date;
};

export type Ticket = WithId & {
  number: number; userId: string; subject: string; category: string; weddingId: string | null;
  status: TicketStatus; unreadForUser: number; unreadForTeam: number;
  createdAt: Date; updatedAt: Date; closedAt: Date | null;
};
export type TicketMessage = WithId & { ticketId: string; author: 'user' | 'team'; adminId: string | null; body: string; createdAt: Date };
