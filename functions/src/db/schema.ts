/**
 * INVITE KAROO — database schema (PostgreSQL, Drizzle ORM)
 *
 * The heart of the model is `invites`: ONE row per guest × function.
 * It carries RSVP, pax, the gift-out flag and the guest's private reminders.
 * There is no wedding-level RSVP anywhere.
 *
 * Invites resolve to an app user by PHONE NUMBER, never by a stored user id:
 * the team imports a guest list long before most guests install the app.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

/* ───────────────────────── enums ───────────────────────── */

export const langEnum = pgEnum('lang', ['en', 'hi', 'ta', 'gu']);
export const sideEnum = pgEnum('side', ['bride', 'groom']);
export const rsvpEnum = pgEnum('rsvp', ['none', 'going', 'maybe', 'not_going']);
export const weddingStatusEnum = pgEnum('wedding_status', ['draft', 'active', 'paused', 'ended']);
export const accessRoleEnum = pgEnum('access_role', ['owner', 'cohost', 'giftdesk']);
export const blastKindEnum = pgEnum('blast_kind', ['rsvp_request', 'reminder']);
export const blastStateEnum = pgEnum('blast_state', ['queued', 'sending', 'sent', 'failed']);
export const applicationStatusEnum = pgEnum('application_status', ['new', 'in_setup', 'live', 'rejected']);
export const adminRoleEnum = pgEnum('admin_role', ['admin', 'setup', 'support']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'answered', 'closed']);
export const notifCatEnum = pgEnum('notif_cat', ['inv', 'rem', 'host', 'sys']);
export const eventSourceEnum = pgEnum('event_source', ['manual', 'ai']);
export const otpPurposeEnum = pgEnum('otp_purpose', ['login', 'signup', 'change_number']);
export const giftMethodEnum = pgEnum('gift_method', ['qr', 'manual']);
export const callOutcomeEnum = pgEnum('call_outcome', ['none', 'answered', 'no_answer', 'wrong_number', 'call_back']);

/* ───────────────────────── people ───────────────────────── */

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

export const users = pgTable('users', {
  id: id(),
  /** E.164, e.g. +919864455120 — the key every invite resolves through */
  phone: text('phone').notNull(),
  firstName: text('first_name').notNull(),
  familyName: text('family_name').notNull(),
  city: text('city').notNull(),
  email: text('email'),
  photoUrl: text('photo_url'),
  lang: langEnum('lang').notNull().default('en'),
  prefs: jsonb('prefs').$type<UserPrefs>().notNull().default(DEFAULT_PREFS),
  privacy: jsonb('privacy').$type<UserPrivacy>().notNull().default(DEFAULT_PRIVACY),
  lastSeenAt: ts('last_seen_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts('deleted_at'),
}, (t) => [
  uniqueIndex('users_phone_live').on(t.phone).where(sql`${t.deletedAt} is null`),
]);

export const otpCodes = pgTable('otp_codes', {
  id: id(),
  phone: text('phone').notNull(),
  purpose: otpPurposeEnum('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  channel: text('channel').notNull().default('whatsapp'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  /** a short-lived token handed back after verify, so signup can finish */
  ticket: text('ticket'),
  createdAt: createdAt(),
}, (t) => [index('otp_phone_idx').on(t.phone, t.createdAt)]);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshHash: text('refresh_hash').notNull(),
  platform: text('platform'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const devices = pgTable('devices', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fcmToken: text('fcm_token').notNull(),
  platform: text('platform').notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('devices_token_uq').on(t.fcmToken)]);

export const adminUsers = pgTable('admin_users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: adminRoleEnum('role').notNull().default('setup'),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('admin_email_uq').on(t.email)]);

/* ───────────────────────── host application ───────────────────────── */

export type ApplicationData = {
  brideName: string; brideParents?: string; groomName: string; groomParents?: string;
  brideFamily?: string; brideElders?: string; groomFamily?: string; groomElders?: string;
  city: string; startDate: string; endDate: string; datesLocked?: boolean;
};

export const hostApplications = pgTable('host_applications', {
  id: id(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  phone: text('phone').notNull(),
  status: applicationStatusEnum('status').notNull().default('new'),
  data: jsonb('data').$type<ApplicationData>().notNull(),
  guestFile: jsonb('guest_file').$type<{ key: string; name: string; size: number } | null>(),
  guestReport: jsonb('guest_report').$type<Record<string, unknown> | null>(),
  cardFile: jsonb('card_file').$type<{ key: string; name: string; size: number } | null>(),
  weddingId: uuid('wedding_id'),
  assignedTo: uuid('assigned_to').references(() => adminUsers.id, { onDelete: 'set null' }),
  adminNotes: text('admin_notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('apps_status_idx').on(t.status, t.createdAt)]);

/* ───────────────────────── wedding ───────────────────────── */

export type Person = { name: string; parents?: string; city?: string; photoUrl?: string | null };
export type Family = { name: string; elders: string[]; city?: string; photoUrl?: string | null };
export type CardFile = { key: string; name: string; size: number; pages: string[] };
export type VoiceFile = { key: string; url: string; durationSec?: number };

export const weddings = pgTable('weddings', {
  id: id(),
  /** the number that owns the console. Can exist before the account does. */
  ownerPhone: text('owner_phone').notNull(),
  /** the ONE number guests are given to call — never a host's personal mobile by default */
  contactPhone: text('contact_phone'),
  city: text('city').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  datesLocked: boolean('dates_locked').notNull().default(true),
  status: weddingStatusEnum('status').notNull().default('draft'),
  statusReason: text('status_reason'),
  sendingEnabled: boolean('sending_enabled').notNull().default(true),
  bride: jsonb('bride').$type<Person>().notNull(),
  groom: jsonb('groom').$type<Person>().notNull(),
  brideFamily: jsonb('bride_family').$type<Family>().notNull(),
  groomFamily: jsonb('groom_family').$type<Family>().notNull(),
  card: jsonb('card').$type<CardFile | null>(),
  voice: jsonb('voice').$type<VoiceFile | null>(),
  applicationId: uuid('application_id'),
  /** when the team handed the console to the host ("pushed") */
  handedOverAt: ts('handed_over_at'),
  endedAt: ts('ended_at'),
  createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('weddings_owner_idx').on(t.ownerPhone)]);

export const weddingMedia = pgTable('wedding_media', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  /** cover carousel, couple gallery or family gallery */
  kind: text('kind', { enum: ['cover', 'couple', 'family'] }).notNull(),
  type: text('type', { enum: ['image', 'video'] }).notNull().default('image'),
  key: text('key').notNull(),
  url: text('url').notNull(),
  posterUrl: text('poster_url'),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index('media_wedding_idx').on(t.weddingId, t.kind, t.sort)]);

/** family members who can run the console. The owner row is implicit (weddings.ownerPhone). */
export const weddingAccess = pgTable('wedding_access', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  name: text('name').notNull(),
  relation: text('relation').notNull(),
  role: accessRoleEnum('role').notNull().default('cohost'),
  addedBy: text('added_by'),
  addedAt: createdAt(),
  removedAt: ts('removed_at'),
}, (t) => [
  uniqueIndex('access_live_uq').on(t.weddingId, t.phone).where(sql`${t.removedAt} is null`),
]);

export const functions = pgTable('functions', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at'),
  venueName: text('venue_name').notNull(),
  venueAddress: text('venue_address'),
  mapsUrl: text('maps_url'),
  dressCode: text('dress_code'),
  notes: text('notes'),
  color: text('color').notNull().default('#7C5CBF'),
  icon: text('icon').notNull().default('rings'),
  /** what the hosts hand out at this function, e.g. "Silver coin" */
  giftPlan: text('gift_plan'),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts('deleted_at'),
}, (t) => [index('functions_wedding_idx').on(t.weddingId, t.startsAt)]);

export const guests = pgTable('guests', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  side: sideEnum('side').notNull(),
  relation: text('relation').notNull().default(''),
  expectedPax: integer('expected_pax').notNull().default(1),
  notes: text('notes').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdVia: text('created_via', { enum: ['xls', 'host', 'admin'] }).notNull().default('xls'),
  /** random, printed into the guest's QR code for the gift desk */
  qrToken: text('qr_token').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('guests_live_phone_uq').on(t.weddingId, t.phone).where(sql`${t.active}`),
  uniqueIndex('guests_qr_uq').on(t.qrToken),
  index('guests_phone_idx').on(t.phone),
]);

export const invites = pgTable('invites', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),
  functionId: uuid('function_id').notNull().references(() => functions.id, { onDelete: 'cascade' }),
  invited: boolean('invited').notNull().default(true),
  notifiedAt: ts('notified_at'),
  rsvp: rsvpEnum('rsvp').notNull().default('none'),
  pax: integer('pax').notNull().default(0),
  respondedAt: ts('responded_at'),
  /** true when the host recorded this answer (e.g. after a phone call) */
  byHost: boolean('by_host').notNull().default(false),
  remark: text('remark').notNull().default(''),
  giftOut: boolean('gift_out').notNull().default(false),
  giftOutGiven: boolean('gift_out_given').notNull().default(false),
  giftOutGivenAt: ts('gift_out_given_at'),
  giftOutGivenBy: text('gift_out_given_by'),
  giftOutMethod: giftMethodEnum('gift_out_method'),
  callAttempts: integer('call_attempts').notNull().default(0),
  lastCalledAt: ts('last_called_at'),
  callOutcome: callOutcomeEnum('call_outcome').notNull().default('none'),
  /** the guest's own reminders — minutes before start. PRIVATE: hosts never see these. */
  guestReminders: jsonb('guest_reminders').$type<number[]>().notNull().default([]),
  /** app-default reminder offsets this guest switched off (an override list, not a deletion) */
  offDefaults: jsonb('off_defaults').$type<number[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('invites_guest_fn_uq').on(t.guestId, t.functionId),
  index('invites_fn_idx').on(t.functionId),
  index('invites_wedding_idx').on(t.weddingId),
]);

/**
 * WhatsApp blasts — at most ONE per (function, kind). The unique index is
 * layer 1 of the double-send guard; idempotency key is layer 2;
 * queued → sending → sent is layer 3 (only 'failed' releases the row).
 */
export const blasts = pgTable('blasts', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  functionId: uuid('function_id').notNull().references(() => functions.id, { onDelete: 'cascade' }),
  kind: blastKindEnum('kind').notNull(),
  state: blastStateEnum('state').notNull().default('queued'),
  idempotencyKey: text('idempotency_key').notNull(),
  recipientCount: integer('recipient_count').notNull().default(0),
  deliveredCount: integer('delivered_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  sentBy: text('sent_by'),
  sentAt: ts('sent_at'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('blasts_fn_kind_uq').on(t.functionId, t.kind),
  uniqueIndex('blasts_idem_uq').on(t.idempotencyKey),
]);

/** in-app nudges from the host — unlimited, app notification only */
export const nudges = pgTable('nudges', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  functionId: uuid('function_id').references(() => functions.id, { onDelete: 'set null' }),
  audience: text('audience').notNull(),
  recipientCount: integer('recipient_count').notNull().default(0),
  appCount: integer('app_count').notNull().default(0),
  message: text('message').notNull(),
  sentBy: text('sent_by'),
  createdAt: createdAt(),
}, (t) => [index('nudges_wedding_idx').on(t.weddingId, t.createdAt)]);

/* ───────────────────────── gifts received ───────────────────────── */

export const giftCategories = pgTable('gift_categories', {
  id: id(),
  /** null = a system category shared by every wedding */
  weddingId: uuid('wedding_id').references(() => weddings.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  isCash: boolean('is_cash').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
});

export const giftsReceived = pgTable('gifts_received', {
  id: id(),
  weddingId: uuid('wedding_id').notNull().references(() => weddings.id, { onDelete: 'cascade' }),
  functionId: uuid('function_id').notNull().references(() => functions.id, { onDelete: 'cascade' }),
  /** null for a walk-in who was never on the list */
  guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'set null' }),
  giverName: text('giver_name').notNull(),
  giverPhone: text('giver_phone').notNull().default(''),
  categoryId: uuid('category_id').notNull().references(() => giftCategories.id),
  /** whole rupees, only for the cash category */
  amount: integer('amount'),
  itemName: text('item_name'),
  note: text('note').notNull().default(''),
  method: giftMethodEnum('method').notNull().default('manual'),
  recordedBy: text('recorded_by').notNull(),
  recordedAt: createdAt(),
  deletedAt: ts('deleted_at'),
}, (t) => [index('gifts_wedding_fn_idx').on(t.weddingId, t.functionId)]);

/* ───────────────────────── guest's own events ───────────────────────── */

export type OwnWeddingFn = { name: string; date: string; time: string; venue?: string; note?: string; color?: string };

export const personalEvents = pgTable('personal_events', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** Appointment, Personal, Meeting, Celebration, Wedding, Birthday, Other */
  type: text('type').notNull(),
  date: date('date').notNull(),
  /** "HH:mm" 24h, null = all day */
  time: text('time'),
  venue: text('venue').notNull().default(''),
  city: text('city').notNull().default(''),
  notes: text('notes').notNull().default(''),
  icon: text('icon').notNull().default('calendar'),
  imageUrl: text('image_url'),
  source: eventSourceEnum('source').notNull().default('manual'),
  /** a wedding the guest typed in or scanned themselves — not an Invite Karoo wedding */
  ownWedding: jsonb('own_wedding').$type<{ functions: OwnWeddingFn[] } | null>(),
  reminders: jsonb('reminders').$type<number[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: ts('deleted_at'),
}, (t) => [index('events_user_date_idx').on(t.userId, t.date)]);

export const aiScans = pgTable('ai_scans', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  imageKey: text('image_key').notNull(),
  status: text('status', { enum: ['done', 'failed'] }).notNull(),
  result: jsonb('result').$type<Record<string, unknown> | null>(),
  error: text('error'),
  createdAt: createdAt(),
});

/* ───────────────────────── notifications ───────────────────────── */

export type NotifAction =
  | { type: 'function'; weddingId: string; functionId: string }
  | { type: 'wedding'; weddingId: string }
  | { type: 'screen'; screen: string }
  | { type: 'ticket'; ticketId: string }
  | { type: 'none' };

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cat: notifCatEnum('cat').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  long: text('long'),
  art: text('art'),
  action: jsonb('action').$type<NotifAction>().notNull().default({ type: 'none' }),
  read: boolean('read').notNull().default(false),
  pushed: boolean('pushed').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index('notif_user_idx').on(t.userId, t.createdAt)]);

/** scheduled reminders that have already fired — stops a reminder firing twice */
export const reminderFires = pgTable('reminder_fires', {
  id: id(),
  inviteId: uuid('invite_id').notNull().references(() => invites.id, { onDelete: 'cascade' }),
  offsetMin: integer('offset_min').notNull(),
  /** the function start this fire was computed against — a moved function re-arms */
  startsAt: ts('starts_at').notNull(),
  firedAt: createdAt(),
}, (t) => [uniqueIndex('fires_uq').on(t.inviteId, t.offsetMin, t.startsAt)]);

/* ───────────────────────── support ───────────────────────── */

export const tickets = pgTable('tickets', {
  id: id(),
  number: serial('number').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  category: text('category').notNull().default('general'),
  weddingId: uuid('wedding_id').references(() => weddings.id, { onDelete: 'set null' }),
  status: ticketStatusEnum('status').notNull().default('open'),
  unreadForUser: integer('unread_for_user').notNull().default(0),
  unreadForTeam: integer('unread_for_team').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  closedAt: ts('closed_at'),
}, (t) => [index('tickets_user_idx').on(t.userId, t.updatedAt), uniqueIndex('tickets_number_uq').on(t.number)]);

export const ticketMessages = pgTable('ticket_messages', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  author: text('author', { enum: ['user', 'team'] }).notNull(),
  adminId: uuid('admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, (t) => [index('ticket_msgs_idx').on(t.ticketId, t.createdAt)]);

/* ───────────────────────── logs ───────────────────────── */

export const messageLog = pgTable('message_log', {
  id: id(),
  channel: text('channel', { enum: ['whatsapp', 'push', 'sms'] }).notNull(),
  to: text('to').notNull(),
  template: text('template'),
  status: text('status', { enum: ['sent', 'failed', 'skipped'] }).notNull(),
  providerId: text('provider_id'),
  error: text('error'),
  relatedType: text('related_type'),
  relatedId: uuid('related_id'),
  createdAt: createdAt(),
}, (t) => [index('msglog_related_idx').on(t.relatedType, t.relatedId)]);

export const auditLog = pgTable('audit_log', {
  id: id(),
  actorType: text('actor_type', { enum: ['user', 'admin', 'system'] }).notNull(),
  actorId: text('actor_id'),
  weddingId: uuid('wedding_id'),
  action: text('action').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index('audit_wedding_idx').on(t.weddingId, t.createdAt)]);
