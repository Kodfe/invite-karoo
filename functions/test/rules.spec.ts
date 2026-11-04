import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestContext, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

/*
 * firestore.rules and storage.rules guard the dashboard's direct access, so they get their own
 * tests. These need the emulators (npm run test:emulators); the in-memory run skips them.
 */
const emulated = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const suite = emulated ? describe : describe.skip;

const ROOT = path.resolve(__dirname, '..', '..');
const WEDDING = 'w1';
const fns = (n: number) => ({ weddingId: WEDDING, name: 'Sangeet', startsAt: new Date(), endsAt: null, venueName: 'Hall', venueAddress: null, mapsUrl: null, dressCode: null, notes: null, color: '#7C5CBF', icon: 'music', giftPlan: null, sort: n, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deletedAt: null });
const wedding = (o: Record<string, unknown> = {}) => ({
  ownerPhone: '+919864455120', contactPhone: null, city: 'Guwahati', timezone: 'Asia/Kolkata', startDate: '2026-12-01', endDate: '2026-12-05', datesLocked: true,
  status: 'draft', statusReason: null, sendingEnabled: true, bride: { name: 'Luveena Sharma' }, groom: { name: 'Mitesh Ranka' }, brideFamily: { name: 'Sharma', elders: [] }, groomFamily: { name: 'Ranka', elders: [] },
  card: null, voice: null, applicationId: null, handedOverAt: null, endedAt: null, createdBy: 'setup1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o,
});
const invite = (o: Record<string, unknown> = {}) => ({
  weddingId: WEDDING, guestId: 'g2', functionId: 'f1', invited: true, notifiedAt: null, rsvp: 'none', pax: 0, respondedAt: null, byHost: false, remark: '', giftOut: false, giftOutGiven: false,
  giftOutGivenAt: null, giftOutGivenBy: null, giftOutMethod: null, callAttempts: 0, lastCalledAt: null, callOutcome: 'none', guestReminders: [], offDefaults: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o,
});
const guest = (o: Record<string, unknown> = {}) => ({
  weddingId: WEDDING, name: 'Asha Das', phone: '+919810000001', side: 'bride', relation: '', expectedPax: 1, notes: '', active: true, createdVia: 'admin', qrToken: 'abcdefghijklmnop', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o,
});

suite('security rules', () => {
  let env: RulesTestEnvironment;
  const as = (uid: string, ikRole?: string) => env.authenticatedContext(uid, ikRole ? { ikRole } : { phone: '+919810000001' });
  const db = (c: RulesTestContext) => c.firestore();
  let admin: RulesTestContext, setup: RulesTestContext, support: RulesTestContext, off: RulesTestContext, appUser: RulesTestContext, nobody: RulesTestContext;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-invitekaroo',
      firestore: { rules: readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
      storage: { rules: readFileSync(path.join(ROOT, 'storage.rules'), 'utf8') },
    });
    admin = as('admin1', 'admin');
    setup = as('setup1', 'setup');
    support = as('support1', 'support');
    off = as('off1', 'admin'); // still holds a valid token that says admin
    appUser = as('user1');
    nobody = env.unauthenticatedContext();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const d = c.firestore();
      for (const [id, role, active] of [['admin1', 'admin', true], ['setup1', 'setup', true], ['support1', 'support', true], ['off1', 'admin', false]] as const) {
        await setDoc(doc(d, `admins/${id}`), { email: `${id}@ik.test`, name: id, role, active, lastLoginAt: null, createdAt: new Date() });
      }
      await setDoc(doc(d, 'users/user1'), { phone: '+919810000001', firstName: 'A', familyName: 'B', city: 'C', deletedAt: null });
      await setDoc(doc(d, 'otp/+919810000001'), { codeHash: 'secret' });
      await setDoc(doc(d, 'phones/+919810000001'), { uid: 'user1' });
      await setDoc(doc(d, 'users/user1/notifications/n1'), { title: 'x' });
      await setDoc(doc(d, 'users/user1/devices/d1'), { fcmToken: 'x' });
      await setDoc(doc(d, `weddings/${WEDDING}`), wedding({ status: 'active' }));
      await setDoc(doc(d, `weddings/${WEDDING}/functions/f1`), fns(0));
      await setDoc(doc(d, `weddings/${WEDDING}/guests/g1`), guest());
      await setDoc(doc(d, `weddings/${WEDDING}/invites/g1_f1`), invite({ guestId: 'g1' }));
      await setDoc(doc(d, `weddings/${WEDDING}/gifts/x1`), { amount: 5100 });
      await setDoc(doc(d, 'applications/a1'), { status: 'new', adminNotes: null, assignedTo: null, phone: '+919810000001', weddingId: null, updatedAt: new Date() });
      await setDoc(doc(d, 'tickets/t1'), { number: 1, userId: 'user1', status: 'open', unreadForTeam: 1, unreadForUser: 0, updatedAt: new Date(), closedAt: null });
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  describe('who gets in at all', () => {
    it('nobody signed in, and app users, can read nothing', async () => {
      for (const c of [nobody, appUser]) {
        await assertFails(getDoc(doc(db(c), `weddings/${WEDDING}`)));
        await assertFails(getDoc(doc(db(c), 'users/user1')));
        await assertFails(getDoc(doc(db(c), 'admins/admin1')));
        await assertFails(getDocs(collection(db(c), 'weddings')));
        await assertFails(getDocs(query(collectionGroup(db(c), 'guests'), where('phone', '==', '+919810000001'))));
      }
    });

    it('every role on the team reads weddings, guests and users', async () => {
      for (const c of [admin, setup, support]) {
        await assertSucceeds(getDocs(collection(db(c), 'weddings')));
        await assertSucceeds(getDocs(collection(db(c), `weddings/${WEDDING}/guests`)));
        await assertSucceeds(getDocs(collection(db(c), 'users')));
        await assertSucceeds(getDocs(query(collectionGroup(db(c), 'guests'), where('phone', '==', '+919810000001'))));
        await assertSucceeds(getCountFromServer(query(collectionGroup(db(c), 'invites'), where('invited', '==', true))));
      }
    });

    it('turning an account off works at once, whatever its token says', async () => {
      await assertFails(getDocs(collection(db(off), 'weddings')));
      await assertFails(updateDoc(doc(db(off), 'tickets/t1'), { status: 'closed' }));
    });

    it('nothing private is readable even by an admin', async () => {
      for (const p of ['otp/+919810000001', 'phones/+919810000001', 'users/user1/notifications/n1', 'users/user1/devices/d1', `weddings/${WEDDING}/gifts/x1`]) {
        await assertFails(getDoc(doc(db(admin), p)));
      }
      await assertFails(getDocs(collection(db(admin), 'auditLog')));
    });
  });

  describe('the team record', () => {
    it('cannot be changed from the browser, not even by an admin', async () => {
      await assertFails(updateDoc(doc(db(setup), 'admins/setup1'), { role: 'admin' }));
      await assertFails(updateDoc(doc(db(off), 'admins/off1'), { active: true }));
      await assertFails(updateDoc(doc(db(admin), 'admins/setup1'), { active: false }));
      await assertFails(setDoc(doc(db(appUser), 'admins/user1'), { email: 'x', name: 'x', role: 'admin', active: true }));
      await assertFails(deleteDoc(doc(db(admin), 'admins/setup1')));
    });

    it('lets a member record their own sign-in, and nothing else', async () => {
      await assertSucceeds(updateDoc(doc(db(support), 'admins/support1'), { lastLoginAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db(support), 'admins/setup1'), { lastLoginAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db(support), 'admins/support1'), { lastLoginAt: serverTimestamp(), role: 'admin' }));
    });
  });

  describe('weddings', () => {
    it('setup and admin create drafts; support cannot', async () => {
      await assertSucceeds(setDoc(doc(db(setup), 'weddings/new1'), wedding()));
      await assertSucceeds(setDoc(doc(db(admin), 'weddings/new2'), wedding({ createdBy: 'admin1' })));
      await assertFails(setDoc(doc(db(support), 'weddings/new3'), wedding({ createdBy: 'support1' })));
    });

    it('refuses a bad wedding', async () => {
      await assertFails(setDoc(doc(db(setup), 'weddings/n'), wedding({ status: 'active' })));
      await assertFails(setDoc(doc(db(setup), 'weddings/n'), wedding({ ownerPhone: '98644' })));
      await assertFails(setDoc(doc(db(setup), 'weddings/n'), wedding({ createdBy: 'someone-else' })));
      await assertFails(setDoc(doc(db(setup), 'weddings/n'), wedding({ extra: true })));
      await assertFails(updateDoc(doc(db(setup), `weddings/${WEDDING}`), { status: 'gone' }));
      await assertFails(updateDoc(doc(db(setup), `weddings/${WEDDING}`), { createdBy: 'me' }));
    });

    it('nobody deletes a wedding from the browser', async () => {
      await assertFails(deleteDoc(doc(db(admin), `weddings/${WEDDING}`)));
    });

    it('support can look but not change', async () => {
      await assertFails(updateDoc(doc(db(support), `weddings/${WEDDING}`), { city: 'Delhi' }));
      await assertFails(setDoc(doc(db(support), `weddings/${WEDDING}/functions/f9`), fns(1)));
      await assertFails(setDoc(doc(db(support), `weddings/${WEDDING}/guests/g9`), guest()));
      await assertSucceeds(updateDoc(doc(db(setup), `weddings/${WEDDING}`), { city: 'Delhi', updatedAt: serverTimestamp() }));
    });

    it('functions are soft deleted only', async () => {
      await assertSucceeds(updateDoc(doc(db(setup), `weddings/${WEDDING}/functions/f1`), { deletedAt: serverTimestamp() }));
      await assertFails(deleteDoc(doc(db(setup), `weddings/${WEDDING}/functions/f1`)));
    });
  });

  describe('guests and replies', () => {
    it('adds a guest with their invites in one batch', async () => {
      const b = writeBatch(db(setup));
      b.set(doc(db(setup), `weddings/${WEDDING}/guests/g2`), guest({ phone: '+919810000002' }));
      b.set(doc(db(setup), `weddings/${WEDDING}/invites/g2_f1`), invite());
      b.set(doc(db(setup), 'auditLog/a1'), { actorType: 'admin', actorId: 'setup1', action: 'guest.add', weddingId: WEDDING, data: null, createdAt: serverTimestamp() });
      await assertSucceeds(b.commit());
    });

    it('refuses a bad guest', async () => {
      await assertFails(setDoc(doc(db(setup), `weddings/${WEDDING}/guests/g3`), guest({ phone: 'abc' })));
      await assertFails(setDoc(doc(db(setup), `weddings/${WEDDING}/guests/g3`), guest({ expectedPax: 99 })));
      await assertFails(updateDoc(doc(db(setup), `weddings/${WEDDING}/guests/g1`), { qrToken: 'chosen-by-the-team' }));
    });

    it('the team cannot answer for a guest or see into a new invite with a reply set', async () => {
      await assertFails(setDoc(doc(db(setup), `weddings/${WEDDING}/invites/g2_f1`), invite({ rsvp: 'going', pax: 4 })));
      await assertFails(setDoc(doc(db(setup), `weddings/${WEDDING}/invites/wrong_id`), invite()));
      await assertFails(updateDoc(doc(db(setup), `weddings/${WEDDING}/invites/g1_f1`), { rsvp: 'going' }));
      await assertFails(updateDoc(doc(db(setup), `weddings/${WEDDING}/invites/g1_f1`), { guestReminders: [60] }));
      await assertSucceeds(updateDoc(doc(db(setup), `weddings/${WEDDING}/invites/g1_f1`), { giftOut: true, updatedAt: serverTimestamp() }));
    });
  });

  describe('support and applications', () => {
    it('any role replies to a ticket, in its own name', async () => {
      const m = (o = {}) => ({ ticketId: 't1', author: 'team', adminId: 'support1', body: 'Hello', createdAt: serverTimestamp(), ...o });
      await assertSucceeds(setDoc(doc(db(support), 'tickets/t1/messages/m1'), m()));
      await assertFails(setDoc(doc(db(support), 'tickets/t1/messages/m2'), m({ adminId: 'admin1' })));
      await assertFails(setDoc(doc(db(support), 'tickets/t1/messages/m3'), m({ author: 'user' })));
      await assertFails(setDoc(doc(db(appUser), 'tickets/t1/messages/m4'), m({ adminId: 'user1' })));
      await assertSucceeds(updateDoc(doc(db(support), 'tickets/t1'), { status: 'closed', closedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db(support), 'tickets/t1'), { userId: 'someone-else' }));
    });

    it('an application changes only in the team fields', async () => {
      await assertSucceeds(updateDoc(doc(db(support), 'applications/a1'), { adminNotes: 'Called them', updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db(support), 'applications/a1'), { phone: '+919810000002' }));
      await assertFails(updateDoc(doc(db(support), 'applications/a1'), { status: 'nonsense' }));
    });

    it('the audit log is add-only and cannot name someone else', async () => {
      const a = (o = {}) => ({ actorType: 'admin', actorId: 'setup1', action: 'x', weddingId: null, data: null, createdAt: serverTimestamp(), ...o });
      await assertSucceeds(setDoc(doc(db(setup), 'auditLog/l1'), a()));
      await assertFails(setDoc(doc(db(setup), 'auditLog/l2'), a({ actorId: 'admin1' })));
      await assertFails(updateDoc(doc(db(setup), 'auditLog/l1'), { action: 'y' }));
      await assertFails(deleteDoc(doc(db(admin), 'auditLog/l1')));
    });
  });

  describe('files', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const st = (c: RulesTestContext) => c.storage();

    it('setup uploads wedding files of the right type; support cannot', async () => {
      await assertSucceeds(uploadBytes(ref(st(setup), `weddings/${WEDDING}/cover/a.jpg`), bytes, { contentType: 'image/jpeg' }));
      await assertSucceeds(uploadBytes(ref(st(setup), `weddings/${WEDDING}/card/a.pdf`), bytes, { contentType: 'application/pdf' }));
      await assertFails(uploadBytes(ref(st(support), `weddings/${WEDDING}/cover/b.jpg`), bytes, { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(st(appUser), `weddings/${WEDDING}/cover/c.jpg`), bytes, { contentType: 'image/jpeg' }));
    });

    it('refuses the wrong kind of file, a file too large, and any other folder', async () => {
      await assertFails(uploadBytes(ref(st(setup), `weddings/${WEDDING}/cover/x.html`), bytes, { contentType: 'text/html' }));
      await assertFails(uploadBytes(ref(st(setup), `weddings/${WEDDING}/voice/x.jpg`), bytes, { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(st(setup), `weddings/${WEDDING}/couple/big.jpg`), new Uint8Array(10 * 1024 * 1024 + 1), { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(st(setup), 'applications/user1/x.jpg'), bytes, { contentType: 'image/jpeg' }));
    });

    it('only the team reads files directly', async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await uploadBytes(ref(c.storage(), 'applications/user1/card.pdf'), bytes, { contentType: 'application/pdf' });
      });
      await assertSucceeds(getBytes(ref(st(support), 'applications/user1/card.pdf')));
      await assertFails(getBytes(ref(st(appUser), 'applications/user1/card.pdf')));
      await assertFails(getBytes(ref(st(nobody), 'applications/user1/card.pdf')));
    });
  });
});
