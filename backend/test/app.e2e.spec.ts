import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { bearer, boot, signIn, TEST_DB } from './setup';

/* One wedding, built the way the team will build it, then run from both sides. */

let app: INestApplication;
let http: ReturnType<typeof request>;
let pool: Pool;
let adminToken: string;

const OWNER = '9864455120';
const COHOST = '9864012233';
const GUEST = '9810000001';
const STRANGER = '9810000099';

let owner: { token: string; me?: { host?: { access: string } } };
let cohost: { token: string };
let guest: { token: string; refresh: string };
let stranger: { token: string };
let weddingId: string;
const fn: Record<string, string> = {};

const day = (offset: number) => {
  const d = new Date(Date.now() + 5.5 * 3600_000 + offset * 86400_000);
  return d.toISOString().slice(0, 10);
};

async function sheet(rows: (string | number)[][], functions?: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Guests').addRows(rows);
  if (functions) wb.addWorksheet('Functions').addRows(functions);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  app = await boot();
  http = request(app.getHttpServer());
  pool = new Pool({ connectionString: TEST_DB });
  const { hashPassword } = await import('../src/common/crypto');
  await pool.query(`insert into admin_users (email, name, role, password_hash) values ('a@ik.test', 'Admin', 'admin', $1)`, [await hashPassword('password-123')]);
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('auth', () => {
  it('signs a new number up through the ticket flow', async () => {
    await http.post('/v1/auth/otp/request').send({ cc: '+91', mobile: '98100 00500' }).expect(200);
    const v = await http.post('/v1/auth/otp/verify').send({ cc: '+91', mobile: '9810000500', code: '1234' }).expect(200);
    expect(v.body.status).toBe('needs_profile');
    const s = await http.post('/v1/auth/signup').send({ signupTicket: v.body.signupTicket, firstName: 'Asha', familyName: 'Das', city: 'Tezpur' }).expect(200);
    expect(s.body.status).toBe('signed_in');
    expect(s.body.me.host.access).toBe('none');
    // the ticket is single use
    await http.post('/v1/auth/signup').send({ signupTicket: v.body.signupTicket, firstName: 'A', familyName: 'B', city: 'Tezpur' }).expect(400);
  });

  it('rejects a wrong code, counts down, and refuses a fast resend', async () => {
    await http.post('/v1/auth/otp/request').send({ cc: '+91', mobile: '9810000501' }).expect(200);
    const bad = await http.post('/v1/auth/otp/verify').send({ cc: '+91', mobile: '9810000501', code: '9999' }).expect(400);
    expect(bad.body.error.code).toBe('OTP_INVALID');
    expect(bad.body.error.message).toMatch(/4 tries left/);
    const again = await http.post('/v1/auth/otp/request').send({ cc: '+91', mobile: '9810000501' }).expect(429);
    expect(again.body.error.code).toBe('OTP_WAIT');
  });

  it('rejects an invalid number', async () => {
    const r = await http.post('/v1/auth/otp/request').send({ cc: '+91', mobile: '12345' }).expect(422);
    expect(r.body.error.fields.mobile).toBeDefined();
  });

  it('rotates refresh tokens', async () => {
    guest = await signIn(app, GUEST, { firstName: 'Mitesh', familyName: 'Taleda', city: 'Guwahati' });
    const r = await http.post('/v1/auth/refresh').send({ refreshToken: guest.refresh }).expect(200);
    expect(r.body.accessToken).toBeTruthy();
    await http.post('/v1/auth/refresh').send({ refreshToken: guest.refresh }).expect(401);
    guest.refresh = r.body.refreshToken;
  });

  it('needs a token for private routes', async () => {
    await http.get('/v1/me').expect(401);
    await http.get('/v1/me').set(bearer('nonsense')).expect(401);
  });
});

describe('admin builds the wedding', () => {
  it('logs in', async () => {
    await http.post('/v1/admin/auth/login').send({ email: 'a@ik.test', password: 'wrong' }).expect(401);
    const r = await http.post('/v1/admin/auth/login').send({ email: 'a@ik.test', password: 'password-123' }).expect(200);
    adminToken = r.body.token;
    // a user token is not an admin token
    await http.get('/v1/admin/stats').set(bearer(guest.token)).expect(401);
  });

  it('creates the wedding and its functions', async () => {
    const w = await http
      .post('/v1/admin/weddings')
      .set(bearer(adminToken))
      .send({
        ownerPhone: OWNER,
        contactPhone: COHOST,
        city: 'Guwahati',
        startDate: day(0),
        endDate: day(12),
        bride: { name: 'Luveena Sharma', parents: 'Ramesh & Sunita Sharma' },
        groom: { name: 'Mitesh Ranka', parents: 'Mahesh & Kavita Ranka' },
        brideFamily: { name: 'Sharma Family', elders: ['Ramesh Sharma'] },
        groomFamily: { name: 'Ranka Family', elders: ['Mahesh Ranka'] },
      })
      .expect(201);
    weddingId = w.body.id;
    const add = async (name: string, d: number, t: string, giftPlan?: string) =>
      (await http.post(`/v1/admin/weddings/${weddingId}/functions`).set(bearer(adminToken)).send({ name, date: day(d), start: t, end: '23:00', venueName: `${name} Hall`, venueAddress: 'GS Road, Guwahati', giftPlan }).expect(201)).body.id;
    fn.sangeet = await add('Sangeet Night', 5, '20:00');
    fn.wedding = await add('Wedding Ceremony', 8, '21:00', 'Silver coin');
    // a date outside the wedding is refused
    await http.post(`/v1/admin/weddings/${weddingId}/functions`).set(bearer(adminToken)).send({ name: 'Late', date: day(40), start: '10:00', venueName: 'X' }).expect(422);
  });

  it('dry-runs, then imports the guest list, creating functions from the sheet', async () => {
    const buf = await sheet(
      [
        ['Guest Name', 'Mobile', 'Side', 'Relation', 'Expected Pax', 'Notes', 'Sangeet Night', 'Wedding Ceremony', 'Wedding Ceremony Gift', 'Reception', 'Reception Gift'],
        ['Mitesh Taleda', GUEST, 'Groom', 'College friend', 2, '', 'Y', 'Y', 'Y', 'Y', 'N'],
        ['Rahul Ranka', COHOST, 'Groom', 'Brother', 1, '', 'Y', 'Y', 'N', 'Y', 'N'],
        ['No Phone', '', 'Bride', 'Aunt', 1, '', 'Y', 'N', 'N', 'N', 'N'],
        ['Twice', GUEST, 'Bride', 'Aunt', 1, '', 'Y', 'N', 'N', 'N', 'N'],
        ['Nowhere', '9810000077', 'Bride', 'Aunt', 1, '', 'N', 'N', 'N', 'N', 'N'],
        ...Array.from({ length: 20 }, (_, i) => [`Guest ${i}`, `98200000${String(i).padStart(2, '0')}`, i % 2 ? 'Bride' : 'Groom', 'Friend', 1, '', 'N', 'Y', i < 5 ? 'Y' : 'N', 'Y', 'N']),
      ],
      [
        ['Function Name', 'Date', 'Start Time', 'End Time', 'Venue Name', 'Venue Address', 'Dress Code', 'Notes'],
        ['Reception', day(10).split('-').reverse().join('-'), '7:30 PM', '23:30', 'Vivanta Hall', 'GS Road', 'Formal', 'Dinner from 8:30'],
      ],
    );
    const dry = await http.post(`/v1/admin/weddings/${weddingId}/guests/import?dryRun=true`).set(bearer(adminToken)).attach('file', buf, 'guests.xlsx').expect(201);
    expect(dry.body.report.guests).toBe(22);
    expect(dry.body.report.bad).toBe(3);
    expect(dry.body.report.badRows.join(' ')).toMatch(/duplicate of row 2/);
    expect(dry.body.functionsCreated).toEqual(['Reception']);
    expect(dry.body.added).toBe(22);
    const before = await pool.query('select count(*)::int n from guests');
    expect(before.rows[0].n).toBe(0);

    const real = await http.post(`/v1/admin/weddings/${weddingId}/guests/import?dryRun=false`).set(bearer(adminToken)).attach('file', buf, 'guests.xlsx').expect(201);
    expect(real.body.added).toBe(22);
    const w = await http.get(`/v1/admin/weddings/${weddingId}`).set(bearer(adminToken)).expect(200);
    fn.reception = w.body.functions.find((f: { name: string }) => f.name === 'Reception').id;
    expect(w.body.functions.find((f: { name: string }) => f.name === 'Reception').start).toBe('19:30');
    expect(w.body.functions.find((f: { name: string }) => f.name === 'Wedding Ceremony').giftOut).toBe(6);
    expect(w.body.guestCount).toBe(22);

    // re-importing is safe: nothing is added twice
    const again = await http.post(`/v1/admin/weddings/${weddingId}/guests/import?dryRun=false`).set(bearer(adminToken)).attach('file', buf, 'guests.xlsx').expect(201);
    expect(again.body.added).toBe(0);
    expect(again.body.updated).toBe(22);
  });

  it('keeps the wedding hidden from guests until handover', async () => {
    const r = await http.get('/v1/invitations').set(bearer(guest.token)).expect(200);
    expect(r.body.state).toBe('never_invited');
  });

  it('hands over to the owner', async () => {
    owner = await signIn(app, OWNER, { firstName: 'Mitesh', familyName: 'Ranka', city: 'Guwahati' });
    expect(owner.me?.host?.access ?? 'none').toBe('none');
    await http.post(`/v1/admin/weddings/${weddingId}/handover`).set(bearer(adminToken)).expect(200);
    const me = await http.get('/v1/me').set(bearer(owner.token)).expect(200);
    expect(me.body.host.access).toBe('granted');
    expect(me.body.host.weddings[0]).toMatchObject({ weddingId, role: 'owner', couple: 'Luveena & Mitesh' });
    const n = await http.get('/v1/notifications').set(bearer(owner.token)).expect(200);
    expect(n.body.items[0].title).toMatch(/console is ready/);
  });
});

describe('guest side', () => {
  it('lists the wedding by the guest’s own next function', async () => {
    const r = await http.get('/v1/invitations').set(bearer(guest.token)).expect(200);
    expect(r.body.state).toBe('has_invites');
    expect(r.body.weddings[0]).toMatchObject({ weddingId, couple: 'Luveena & Mitesh', myFunctions: 3, needsReply: 3 });
    expect(r.body.weddings[0].next.name).toBe('Sangeet Night');
  });

  it('shows the wedding page without leaking hosts or other guests', async () => {
    const r = await http.get(`/v1/weddings/${weddingId}`).set(bearer(guest.token)).expect(200);
    expect(r.body.contact.phone).toBe('+91' + COHOST);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain('9820000001');
    expect(r.body.functions).toHaveLength(3);
    expect(r.body.functions.every((f: { mine: boolean }) => f.mine)).toBe(true);
  });

  it('a guest who is not on a function sees it as context only', async () => {
    const other = await signIn(app, '9820000001'); // invited to Wedding + Reception, not Sangeet
    const r = await http.get(`/v1/weddings/${weddingId}`).set(bearer(other.token)).expect(200);
    const sangeet = r.body.functions.find((f: { id: string }) => f.id === fn.sangeet);
    expect(sangeet.mine).toBe(false);
    expect(sangeet.venueAddress).toBeUndefined();
    expect(sangeet.rsvp).toBeUndefined();
    await http.post(`/v1/weddings/${weddingId}/functions/${fn.sangeet}/rsvp`).set(bearer(other.token)).send({ rsvp: 'going', pax: 1 }).expect(404);
  });

  it('replies, and a guest reply clears a host-recorded one', async () => {
    const r = await http.post(`/v1/weddings/${weddingId}/functions/${fn.sangeet}/rsvp`).set(bearer(guest.token)).send({ rsvp: 'going', pax: 3 }).expect(201);
    expect(r.body).toMatchObject({ rsvp: 'going', pax: 3, byHost: false, window: { state: 'open' } });
    const nope = await http.post(`/v1/weddings/${weddingId}/functions/${fn.wedding}/rsvp`).set(bearer(guest.token)).send({ rsvp: 'not_going' }).expect(201);
    expect(nope.body.pax).toBe(0);
  });

  it('closes replies 24h before start, and never opens them for a late function', async () => {
    await pool.query(`update functions set starts_at = now() + interval '20 hours', created_at = now() - interval '10 days' where id = $1`, [fn.sangeet]);
    const closed = await http.post(`/v1/weddings/${weddingId}/functions/${fn.sangeet}/rsvp`).set(bearer(guest.token)).send({ rsvp: 'not_going' }).expect(409);
    expect(closed.body.error.code).toBe('RSVP_CLOSED');
    const f = await http.get(`/v1/weddings/${weddingId}/functions/${fn.sangeet}`).set(bearer(guest.token)).expect(200);
    expect(f.body.window.state).toBe('closed');
    expect(f.body.rsvp).toBe('going'); // the last answer stays
    await pool.query(`update functions set created_at = now() where id = $1`, [fn.sangeet]);
    const never = await http.post(`/v1/weddings/${weddingId}/functions/${fn.sangeet}/rsvp`).set(bearer(guest.token)).send({ rsvp: 'going', pax: 1 }).expect(409);
    expect(never.body.error.code).toBe('RSVP_NEVER');
    await pool.query(`update functions set starts_at = now() + interval '5 days', created_at = now() - interval '10 days' where id = $1`, [fn.sangeet]);
  });

  it('keeps private reminders on the invite row', async () => {
    const r = await http.put(`/v1/weddings/${weddingId}/functions/${fn.reception}/reminders`).set(bearer(guest.token)).send({ offDefaults: [180], mine: [45, 45, 2] }).expect(200);
    expect(r.body.reminders.mine.map((m: { offset: number }) => m.offset)).toEqual([45]);
    expect(r.body.reminders.defaults.find((d: { offset: number }) => d.offset === 180).on).toBe(false);
  });

  it('gives the guest a QR code for the gift desk', async () => {
    const r = await http.get(`/v1/weddings/${weddingId}/qr`).set(bearer(guest.token)).expect(200);
    expect(r.body.code).toMatch(/^IK1:/);
  });

  it('shows functions on the agenda between two dates', async () => {
    const r = await http.get(`/v1/invitations/agenda?from=${day(0)}&to=${day(30)}`).set(bearer(guest.token)).expect(200);
    expect(r.body.map((f: { name: string }) => f.name)).toEqual(['Sangeet Night', 'Wedding Ceremony', 'Reception']);
  });
});

describe('host console', () => {
  it('lets only the owner and family in', async () => {
    stranger = await signIn(app, STRANGER);
    await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(stranger.token)).expect(403);
    await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(guest.token)).expect(403);
    const r = await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(owner.token)).expect(200);
    expect(r.body.totals.guests).toBe(22);
    expect(r.body.functions).toHaveLength(3);
    expect(r.body.alerts.length).toBe(3); // nothing sent yet
    const d = await http.get(`/v1/host/weddings/${weddingId}/details`).set(bearer(owner.token)).expect(200);
    expect(d.body.functions).toHaveLength(3);
    expect(d.body.couple).toBe('Luveena & Mitesh');
  });

  it('owner adds family; family can run the console but not manage family', async () => {
    await http.post(`/v1/host/weddings/${weddingId}/family`).set(bearer(owner.token)).send({ name: 'Rahul Ranka', phone: COHOST, relation: 'Brother' }).expect(201);
    cohost = await signIn(app, COHOST);
    await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(cohost.token)).expect(200);
    const f = await http.post(`/v1/host/weddings/${weddingId}/family`).set(bearer(cohost.token)).send({ name: 'X', phone: '9810000111', relation: 'Cousin' }).expect(403);
    expect(f.body.error.code).toBe('FORBIDDEN');
    await http.post(`/v1/host/weddings/${weddingId}/family`).set(bearer(owner.token)).send({ name: 'Again', phone: COHOST, relation: 'Brother' }).expect(409);
  });

  it('caps family access at five', async () => {
    for (let i = 0; i < 4; i++) {
      await http.post(`/v1/host/weddings/${weddingId}/family`).set(bearer(owner.token)).send({ name: `F${i}`, phone: `981000020${i}`, relation: 'Cousin', role: i === 0 ? 'giftdesk' : 'cohost' }).expect(201);
    }
    // "gift desk only": the scanner and gift lists, nothing else
    const desk = await signIn(app, '9810000200');
    await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(desk.token)).expect(200);
    await http.get(`/v1/host/weddings/${weddingId}/gift-out?fn=${fn.wedding}`).set(bearer(desk.token)).expect(200);
    const no = await http.get(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/rsvp`).set(bearer(desk.token)).expect(403);
    expect(no.body.error.message).toMatch(/gift desk/);
    const me = await http.get('/v1/me').set(bearer(desk.token)).expect(200);
    expect(me.body.host.weddings[0].role).toBe('giftdesk');
    const full = await http.post(`/v1/host/weddings/${weddingId}/family`).set(bearer(owner.token)).send({ name: 'F9', phone: '9810000209', relation: 'Cousin' }).expect(409);
    expect(full.body.error.code).toBe('FAMILY_FULL');
  });

  it('filters the guest list and puts guests without the app first', async () => {
    const r = await http.get(`/v1/host/weddings/${weddingId}/guests?fn=${fn.sangeet}`).set(bearer(owner.token)).expect(200);
    expect(r.body.total).toBe(2);
    const rec = await http.get(`/v1/host/weddings/${weddingId}/guests?fn=${fn.reception}&limit=200`).set(bearer(owner.token)).expect(200);
    const joined = rec.body.guests.map((g: { appJoined: boolean }) => g.appJoined);
    expect(joined[0]).toBe(false);
    expect(joined.indexOf(true)).toBeGreaterThan(joined.lastIndexOf(false));
    const going = await http.get(`/v1/host/weddings/${weddingId}/guests?fn=${fn.sangeet}&status=going`).set(bearer(owner.token)).expect(200);
    expect(going.body.guests.map((g: { name: string }) => g.name)).toEqual(['Mitesh Taleda']);
    const q = await http.get(`/v1/host/weddings/${weddingId}/guests?q=guest 1`).set(bearer(owner.token)).expect(200);
    expect(q.body.total).toBeGreaterThan(0);
  });

  it('records a reply for a guest, marked as by the host', async () => {
    const board = await http.get(`/v1/host/weddings/${weddingId}/functions/${fn.reception}/rsvp?tab=pending`).set(bearer(owner.token)).expect(200);
    const row = board.body.rows[0];
    await http.post(`/v1/host/weddings/${weddingId}/invites/${row.inviteId}/call`).set(bearer(owner.token)).send({}).expect(200);
    const g = await http.post(`/v1/host/weddings/${weddingId}/invites/${row.inviteId}/rsvp`).set(bearer(owner.token)).send({ rsvp: 'going', pax: 2, remark: 'Phoned' }).expect(200);
    const inv = g.body.functions.find((f: { functionId: string }) => f.functionId === fn.reception).invite;
    expect(inv).toMatchObject({ rsvp: 'going', pax: 2, byHost: true, callAttempts: 1 });
  });

  it('adds a guest, refuses a duplicate number', async () => {
    const r = await http
      .post(`/v1/host/weddings/${weddingId}/guests`)
      .set(bearer(owner.token))
      .send({ name: 'Walk In', phone: '98300 00001', side: 'bride', relation: 'Neighbour', functions: [{ functionId: fn.reception }] })
      .expect(201);
    expect(r.body.createdVia).toBe('host');
    await http.post(`/v1/host/weddings/${weddingId}/guests`).set(bearer(owner.token)).send({ name: 'Dup', phone: GUEST, side: 'bride', functions: [{ functionId: fn.reception }] }).expect(409);
  });

  it('takes a guest off the list, tells them in the app only, and restores', async () => {
    const other = await signIn(app, '9820000002');
    const list = await http.get(`/v1/host/weddings/${weddingId}/guests?q=9820000002`).set(bearer(owner.token)).expect(200);
    const gid = list.body.guests[0].id;
    await http.delete(`/v1/host/weddings/${weddingId}/guests/${gid}`).set(bearer(owner.token)).expect(200);
    const inv = await http.get('/v1/invitations').set(bearer(other.token)).expect(200);
    expect(inv.body.weddings).toHaveLength(0);
    const n = await http.get('/v1/notifications').set(bearer(other.token)).expect(200);
    expect(n.body.items[0].title).toMatch(/taken off a guest list/);
    const wa = await pool.query(`select count(*)::int n from message_log where "to" = '+919820000002'`);
    expect(wa.rows[0].n).toBe(0);
    await http.post(`/v1/host/weddings/${weddingId}/guests/${gid}/restore`).set(bearer(owner.token)).expect(200);
    const back = await http.get('/v1/invitations').set(bearer(other.token)).expect(200);
    expect(back.body.weddings).toHaveLength(1);
  });

  it('sends the WhatsApp invitation once, idempotently', async () => {
    const pre = await http.get(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/blasts/preview?kind=rsvp_request`).set(bearer(owner.token)).expect(200);
    expect(pre.body).toMatchObject({ recipientCount: 22, canSend: true });
    const early = await http.post(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/blasts`).set(bearer(owner.token)).send({ kind: 'reminder', idempotencyKey: 'rem-wedding-1' }).expect(409);
    expect(early.body.error.code).toBe('INVITE_FIRST');
    const a = await http.post(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/blasts`).set(bearer(owner.token)).send({ kind: 'rsvp_request', idempotencyKey: 'inv-wedding-1' }).expect(201);
    const b = await http.post(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/blasts`).set(bearer(cohost.token)).send({ kind: 'rsvp_request', idempotencyKey: 'inv-wedding-1' }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const c = await http.post(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/blasts`).set(bearer(cohost.token)).send({ kind: 'rsvp_request', idempotencyKey: 'inv-wedding-2' }).expect(409);
    expect(c.body.error.code).toBe('ALREADY_SENT');
    const sent = await pool.query(`select count(*)::int n from message_log where related_type = 'blast' and status = 'sent'`);
    expect(sent.rows[0].n).toBe(22);
    const n = await http.get('/v1/notifications?cat=inv').set(bearer(guest.token)).expect(200);
    expect(n.body.items[0].action).toMatchObject({ type: 'function', functionId: fn.wedding });
    const home = await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(owner.token)).expect(200);
    expect(home.body.functions.find((f: { id: string }) => f.id === fn.wedding).blasts.rsvp_request.state).toBe('sent');
    // the reminder skips those who said no
    const rem = await http.post(`/v1/host/weddings/${weddingId}/functions/${fn.wedding}/blasts`).set(bearer(owner.token)).send({ kind: 'reminder', idempotencyKey: 'rem-wedding-2' }).expect(201);
    expect(rem.body.recipientCount).toBe(21);
  });

  it('sends unlimited in-app nudges, only to guests with the app', async () => {
    const r = await http.post(`/v1/host/weddings/${weddingId}/nudges`).set(bearer(owner.token)).send({ functionId: fn.reception, audience: 'all', message: 'Dinner starts at 8:30 sharp!' }).expect(201);
    expect(r.body.recipientCount).toBe(23);
    expect(r.body.appCount).toBe(4); // Mitesh, Rahul and the two guests who signed in
    const log = await http.get(`/v1/host/weddings/${weddingId}/reminders`).set(bearer(owner.token)).expect(200);
    expect(log.body.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['nudge', 'rsvp_request', 'reminder']));
  });

  it('runs the gift desk: scan, give, refuse twice, undo', async () => {
    const qr = await http.get(`/v1/weddings/${weddingId}/qr`).set(bearer(guest.token)).expect(200);
    const s = await http.post(`/v1/host/weddings/${weddingId}/scan`).set(bearer(cohost.token)).send({ code: qr.body.code, functionId: fn.wedding }).expect(200);
    expect(s.body).toMatchObject({ found: true, status: 'on_gift_list', function: { giftPlan: 'Silver coin' } });
    await http.post(`/v1/host/weddings/${weddingId}/invites/${s.body.invite.id}/gift-out`).set(bearer(cohost.token)).send({ given: true, method: 'qr' }).expect(200);
    const twice = await http.post(`/v1/host/weddings/${weddingId}/invites/${s.body.invite.id}/gift-out`).set(bearer(owner.token)).send({ given: true, method: 'qr' }).expect(409);
    expect(twice.body.error.code).toBe('ALREADY_GIVEN');
    const s2 = await http.post(`/v1/host/weddings/${weddingId}/scan`).set(bearer(owner.token)).send({ code: qr.body.code, functionId: fn.wedding }).expect(200);
    expect(s2.body.status).toBe('already_given');
    const notOn = await http.post(`/v1/host/weddings/${weddingId}/scan`).set(bearer(owner.token)).send({ code: qr.body.code, functionId: fn.reception }).expect(200);
    expect(notOn.body.status).toBe('not_on_gift_list');
    const bad = await http.post(`/v1/host/weddings/${weddingId}/scan`).set(bearer(owner.token)).send({ code: 'IK1:nonsense', functionId: fn.reception }).expect(200);
    expect(bad.body.found).toBe(false);
    await http.post(`/v1/host/weddings/${weddingId}/invites/${s.body.invite.id}/gift-out`).set(bearer(owner.token)).send({ given: false }).expect(200);
    const list = await http.get(`/v1/host/weddings/${weddingId}/gift-out?fn=${fn.wedding}`).set(bearer(owner.token)).expect(200);
    expect(list.body).toMatchObject({ planned: 6, given: 0 });
  });

  it('records gifts received; only the owner can delete one', async () => {
    const cats = await http.get(`/v1/host/weddings/${weddingId}/gift-categories`).set(bearer(owner.token)).expect(200);
    const cash = cats.body.find((c: { key: string }) => c.key === 'cash');
    const noAmount = await http.post(`/v1/host/weddings/${weddingId}/gifts`).set(bearer(cohost.token)).send({ functionId: fn.wedding, giverName: 'Walk-in', categoryId: cash.id }).expect(422);
    expect(noAmount.body.error.fields.amount).toBeDefined();
    const g = await http.post(`/v1/host/weddings/${weddingId}/gifts`).set(bearer(cohost.token)).send({ functionId: fn.wedding, giverName: 'Ratan Lal', giverPhone: '9864551200', categoryId: cash.id, amount: 5100 }).expect(201);
    const custom = await http.post(`/v1/host/weddings/${weddingId}/gift-categories`).set(bearer(owner.token)).send({ label: 'Silverware' }).expect(201);
    expect(custom.body.isCash).toBe(false);
    const sum = await http.get(`/v1/host/weddings/${weddingId}/gifts`).set(bearer(owner.token)).expect(200);
    expect(sum.body).toMatchObject({ total: 1, cash: 5100 });
    await http.delete(`/v1/host/weddings/${weddingId}/gifts/${g.body.id}`).set(bearer(cohost.token)).expect(403);
    await http.delete(`/v1/host/weddings/${weddingId}/gifts/${g.body.id}`).set(bearer(owner.token)).expect(200);
  });

  it('a removed family member loses access at once', async () => {
    const fam = await http.get(`/v1/host/weddings/${weddingId}/family`).set(bearer(owner.token)).expect(200);
    const rahul = fam.body.members.find((m: { name: string }) => m.name === 'Rahul Ranka');
    await http.delete(`/v1/host/weddings/${weddingId}/family/${rahul.id}`).set(bearer(owner.token)).expect(200);
    await http.get(`/v1/host/weddings/${weddingId}`).set(bearer(cohost.token)).expect(403);
  });
});

describe('changes, reminders and the rest', () => {
  it('tells guests when a function moves', async () => {
    await http.patch(`/v1/admin/weddings/${weddingId}/functions/${fn.reception}`).set(bearer(adminToken)).send({ start: '20:00' }).expect(200);
    const n = await http.get('/v1/notifications').set(bearer(guest.token)).expect(200);
    expect(n.body.items[0].title).toBe('Reception has changed');
  });

  it('fires each reminder once, and again after the function moves', async () => {
    const { RemindersService } = await import('../src/modules/reminders/reminders.service');
    const svc = app.get(RemindersService);
    const { rows } = await pool.query(`select starts_at from functions where id = $1`, [fn.reception]);
    const start = new Date(rows[0].starts_at);
    const at = new Date(start.getTime() - 45 * 60_000 + 30_000); // the guest's own 45-minute reminder
    expect(await svc.tick(at)).toBeGreaterThanOrEqual(1);
    expect(await svc.tick(at)).toBe(0);
    await pool.query(`update functions set starts_at = starts_at + interval '1 hour' where id = $1`, [fn.reception]);
    expect(await svc.tick(new Date(at.getTime() + 3600_000))).toBeGreaterThanOrEqual(1);
  });

  it('pausing a wedding stops replies and sending', async () => {
    await http.patch(`/v1/admin/weddings/${weddingId}`).set(bearer(adminToken)).send({ status: 'paused' }).expect(200);
    const r = await http.post(`/v1/weddings/${weddingId}/functions/${fn.reception}/rsvp`).set(bearer(guest.token)).send({ rsvp: 'going', pax: 1 }).expect(409);
    expect(r.body.error.code).toBe('WEDDING_PAUSED');
    await http.patch(`/v1/admin/weddings/${weddingId}`).set(bearer(adminToken)).send({ status: 'active' }).expect(200);
  });

  it('host application: template, check, submit once', async () => {
    const t = await http.get('/v1/host-applications/template').set(bearer(stranger.token)).expect(200);
    expect(t.headers['content-type']).toMatch(/spreadsheetml/);
    const buf = await sheet([
      ['Guest Name', 'Mobile', 'Side', 'Relation', 'Expected Pax', 'Notes', 'Haldi'],
      ['A', '9876543211', 'Bride', 'Bua', 1, '', 'Y'],
    ]);
    const chk = await http.post('/v1/host-applications/check-sheet').set(bearer(stranger.token)).attach('guests', buf, 'g.xlsx').expect(201);
    expect(chk.body.report.guests).toBe(1);
    const data = JSON.stringify({ brideName: 'Riya Das', groomName: 'Aman Jain', city: 'Shillong', startDate: day(30), endDate: day(33) });
    const a = await http.post('/v1/host-applications').set(bearer(stranger.token)).field('data', data).attach('guests', buf, 'g.xlsx').expect(201);
    expect(a.body.status).toBe('new');
    await http.post('/v1/host-applications').set(bearer(stranger.token)).field('data', data).expect(409);
    const me = await http.get('/v1/me').set(bearer(stranger.token)).expect(200);
    expect(me.body.host.access).toBe('pending');
    const bad = await http.post('/v1/host-applications').set(bearer(guest.token)).field('data', JSON.stringify({ brideName: 'R', groomName: 'A', city: 'S', startDate: day(30), endDate: day(1) })).expect(422);
    expect(bad.body.error.fields.endDate).toBeDefined();

    const list = await http.get('/v1/admin/applications?status=new').set(bearer(adminToken)).expect(200);
    const made = await http.post(`/v1/admin/applications/${list.body.items[0].id}/create-wedding`).set(bearer(adminToken)).expect(201);
    expect(made.body.weddingId).toBeTruthy();
    // no Functions sheet → nothing to create Haldi from; the team adds it, then re-imports
    expect(made.body.import.added).toBe(0);
    expect(made.body.import.report.errors.join(' ')).toMatch(/Haldi/);
  });

  it('personal events', async () => {
    const e = await http.post('/v1/events').set(bearer(guest.token)).send({ title: 'Dentist', type: 'Appointment', date: day(2), time: '17:30', venue: 'Apollo Clinic' }).expect(201);
    const w = await http
      .post('/v1/events')
      .set(bearer(guest.token))
      .send({ title: 'Vikram & Aditi Wedding', type: 'Wedding', date: day(3), functions: [{ name: 'Mehendi', date: day(3), time: '17:00' }], source: 'ai' })
      .expect(201);
    expect(w.body.isWedding).toBe(true);
    await http.patch(`/v1/events/${e.body.id}`).set(bearer(guest.token)).send({ time: '18:00' }).expect(200);
    const list = await http.get(`/v1/events?from=${day(0)}&to=${day(10)}`).set(bearer(guest.token)).expect(200);
    expect(list.body).toHaveLength(2);
    await http.delete(`/v1/events/${e.body.id}`).set(bearer(stranger.token)).expect(404);
    await http.delete(`/v1/events/${e.body.id}`).set(bearer(guest.token)).expect(200);
    const scan = await http.post('/v1/events/scan').set(bearer(guest.token)).attach('file', Buffer.from('x'), { filename: 'c.jpg', contentType: 'image/jpeg' }).expect(503);
    expect(scan.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('support tickets round trip', async () => {
    const t = await http.post('/v1/tickets').set(bearer(guest.token)).send({ subject: 'Cannot see my card', body: 'The card page is empty for me', category: 'invitation' }).expect(201);
    expect(t.body.number).toMatch(/^IK-\d{5}$/);
    await http.post(`/v1/admin/tickets/${t.body.id}/messages`).set(bearer(adminToken)).send({ body: 'We have uploaded it again, please check.' }).expect(201);
    const mine = await http.get('/v1/tickets').set(bearer(guest.token)).expect(200);
    expect(mine.body[0]).toMatchObject({ status: 'answered', unread: 1 });
    const one = await http.get(`/v1/tickets/${t.body.id}`).set(bearer(guest.token)).expect(200);
    expect(one.body.messages).toHaveLength(2);
    await http.get(`/v1/tickets/${t.body.id}`).set(bearer(stranger.token)).expect(404);
    await http.post(`/v1/tickets/${t.body.id}/close`).set(bearer(guest.token)).expect(200);
    await http.post(`/v1/tickets/${t.body.id}/messages`).set(bearer(guest.token)).send({ body: 'one more' }).expect(409);
  });

  it('profile, prefs, export, number change and delete', async () => {
    await http.patch('/v1/me').set(bearer(guest.token)).send({ city: 'Shillong', email: '' }).expect(200);
    const p = await http.patch('/v1/me/prefs').set(bearer(guest.token)).send({ quiet: true, qFrom: '22:00', qTo: '07:00' }).expect(200);
    expect(p.body.quiet).toBe(true);
    await http.patch('/v1/me/prefs').set(bearer(guest.token)).send({ qFrom: '25:00' }).expect(422);
    const ex = await http.get('/v1/me/export').set(bearer(guest.token)).expect(200);
    expect(ex.body.invitations.length).toBe(3);
    await http.post('/v1/me/phone/request').set(bearer(guest.token)).send({ mobile: OWNER }).expect(409);
    await http.post('/v1/me/phone/request').set(bearer(guest.token)).send({ mobile: '9810000444' }).expect(200);
    const ch = await http.post('/v1/me/phone/verify').set(bearer(guest.token)).send({ mobile: '9810000444', code: '1234' }).expect(200);
    expect(ch.body.phone).toBe('+919810000444');
    await http.delete('/v1/me').set(bearer(stranger.token)).send({}).expect(422);
    await http.delete('/v1/me').set(bearer(stranger.token)).send({ confirm: 'DELETE' }).expect(200);
    await http.get('/v1/me').set(bearer(stranger.token)).expect(404);
  });

  it('exports the list back out', async () => {
    const r = await http.get(`/v1/admin/weddings/${weddingId}/guests/export`).set(bearer(adminToken)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    expect(wb.getWorksheet('Guests')!.rowCount).toBe(24);
  });

  it('admin stats', async () => {
    const r = await http.get('/v1/admin/stats').set(bearer(adminToken)).expect(200);
    expect(r.body.liveWeddings).toBe(1);
  });
});
