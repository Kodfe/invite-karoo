/** Where each kind of document lives (see models.ts). */
import { db } from './store';

export const col = {
  users: () => db().collection('users'),
  devices: (uid: string) => db().collection(`users/${uid}/devices`),
  notifications: (uid: string) => db().collection(`users/${uid}/notifications`),
  events: (uid: string) => db().collection(`users/${uid}/events`),
  aiScans: (uid: string) => db().collection(`users/${uid}/aiScans`),
  phones: () => db().collection('phones'),
  otp: () => db().collection('otp'),
  signupTickets: () => db().collection('signupTickets'),
  admins: () => db().collection('admins'),
  applications: () => db().collection('applications'),
  weddings: () => db().collection('weddings'),
  media: (w: string) => db().collection(`weddings/${w}/media`),
  access: (w: string) => db().collection(`weddings/${w}/access`),
  functions: (w: string) => db().collection(`weddings/${w}/functions`),
  guests: (w: string) => db().collection(`weddings/${w}/guests`),
  invites: (w: string) => db().collection(`weddings/${w}/invites`),
  blasts: (w: string) => db().collection(`weddings/${w}/blasts`),
  nudges: (w: string) => db().collection(`weddings/${w}/nudges`),
  weddingGiftCategories: (w: string) => db().collection(`weddings/${w}/giftCategories`),
  gifts: (w: string) => db().collection(`weddings/${w}/gifts`),
  systemGiftCategories: () => db().collection('giftCategories'),
  blastKeys: () => db().collection('blastKeys'),
  reminderFires: () => db().collection('reminderFires'),
  tickets: () => db().collection('tickets'),
  ticketMessages: (t: string) => db().collection(`tickets/${t}/messages`),
  counters: () => db().collection('counters'),
  messageLog: () => db().collection('messageLog'),
  auditLog: () => db().collection('auditLog'),
};

/** collection-group queries (every wedding at once) */
export const group = {
  guests: () => db().collectionGroup('guests'),
  access: () => db().collectionGroup('access'),
  functions: () => db().collectionGroup('functions'),
  invites: () => db().collectionGroup('invites'),
  devices: () => db().collectionGroup('devices'),
};
