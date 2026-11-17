/**
 * Records what the API answers for the demo data (seed-demo.ts), signed in as the demo host
 * Mitesh Ranka (+91 98644 55120). The app's demo build (--dart-define=DEMO=true) serves these
 * answers instead of calling the API, so every screen can be checked without signing in.
 *
 *   cd functions && npm run build && node tool/demo-fixtures.js
 *
 * Writes ../app/assets/demo/demo.json. Runs on the in-memory store: nothing touches Firebase.
 */
const fs = require('node:fs');
const { createServer } = require('node:http');
const os = require('node:os');
const path = require('node:path');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DEV_OTP: '1234',
  OTP_SECRET: 'demo-fixtures',
  WHATSAPP_PROVIDER: 'console',
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: path.join(os.tmpdir(), 'ik-demo-uploads'),
  ANTHROPIC_API_KEY: '',
  FIREBASE_SERVICE_ACCOUNT_JSON: '',
  GCLOUD_PROJECT: 'demo-invitekaroo',
});
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const request = require('supertest');
const dist = (p) => require(path.join(__dirname, '..', 'dist', p));
const { handle } = dist('main');
const { seedDemo } = dist('db/seed-demo');
const { fakeAuth } = dist('common/firebase-auth');
const { col } = dist('db/paths');
const { getRows } = dist('db/store');

const OUT = path.join(__dirname, '..', '..', 'app', 'assets', 'demo', 'demo.json');

/** the key the app looks answers up by: path, then the query sorted, without limit/q */
function key(p, query = {}) {
  const q = Object.entries(query)
    .filter(([k, v]) => v != null && `${v}` !== '' && k !== 'limit' && k !== 'q')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return q ? `${p}?${q}` : p;
}

async function main() {
  const http = request(createServer(handle));
  const { hosted, guestAt } = await seedDemo();

  const answers = {};
  const post = {};
  let token = '';
  const auth = (r) => (token ? r.set('Authorization', `Bearer ${token}`) : r);

  async function send(method, p, body) {
    const r = await auth(http[method](p)).send(body ?? {});
    if (r.status >= 300) throw new Error(`${method.toUpperCase()} ${p} â†’ ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  /** GET, recorded under the app's lookup key. `fetchQuery` adds params the API needs but the key leaves out. */
  async function get(p, query = {}, fetchQuery = {}) {
    const r = await auth(http.get(p)).query({ ...fetchQuery, ...query });
    if (r.status >= 300) throw new Error(`GET ${p} â†’ ${r.status} ${JSON.stringify(r.body)}`);
    answers[key(p, query)] = r.body;
    return r.body;
  }

  // sign in the way the app does
  post['/v1/auth/otp/request'] = await send('post', '/v1/auth/otp/request', { cc: '+91', mobile: '9864455120', purpose: 'login' });
  const verified = await send('post', '/v1/auth/otp/verify', { cc: '+91', mobile: '9864455120', code: '1234', platform: 'android' });
  post['/v1/auth/otp/verify'] = { ...verified, customToken: 'demo' };
  token = fakeAuth().signInWithCustomToken(verified.customToken);
  const uid = verified.me.id;

  // a little history so the feed, support and own-agenda screens are not empty
  const ago = (h) => new Date(Date.now() - h * 3600_000);
  const w2fns = (await getRows(col.functions(guestAt))).sort((a, b) => a.sort - b.sort);
  const notifs = [
    { cat: 'inv', title: 'You are invited: Rohit & Anika', body: 'Tilak, Sangeet and Wedding in Jorhat', art: 'invite', action: { type: 'wedding', weddingId: guestAt }, read: false, h: 30 },
    { cat: 'rem', title: `Tomorrow: ${w2fns[0].name}`, body: `${w2fns[0].venueName}, ${w2fns[0].venueAddress}`, action: { type: 'function', weddingId: guestAt, functionId: w2fns[0].id }, read: false, h: 3 },
    { cat: 'host', title: 'Rahul Ranka recorded a gift', body: 'Banarasi saree Â· Haldi Ceremony', action: { type: 'screen', screen: 'hhome' }, read: true, h: 26 },
    { cat: 'sys', title: 'Welcome to Invite Karoo', body: 'Every invitation, every function, one place.', action: { type: 'none' }, read: true, h: 24 * 9 },
  ];
  for (const n of notifs) {
    await col.notifications(uid).doc().set({ userId: uid, cat: n.cat, title: n.title, body: n.body, long: null, art: n.art ?? null, action: n.action, read: n.read, pushed: true, createdAt: ago(n.h) });
  }
  const today = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const plus = (days) => ymd(new Date(today.getTime() + days * 86400_000));
  await send('post', '/v1/events', { title: 'Dentist', type: 'Appointment', date: plus(1), time: '17:30', venue: 'Smile Dental, Zoo Road', city: 'Guwahati' });
  await send('post', '/v1/events', { title: "Papa's birthday", type: 'Birthday', date: plus(4), venue: 'Home', city: 'Guwahati', icon: 'cake' });
  await send('post', '/v1/events', { title: 'Office offsite', type: 'Meeting', date: plus(12), time: '10:00', venue: 'Radisson Blu', city: 'Guwahati' });
  const ticket = await send('post', '/v1/tickets', { subject: 'Guest list upload', category: 'hosting', body: 'Some phone numbers in my sheet were marked invalid. Can you check?', weddingId: hosted });

  /* â”€â”€ guest side â”€â”€ */
  await get('/v1/me');
  await get('/v1/config');
  await get('/v1/invitations');
  await get('/v1/invitations', { finished: '1' });
  const range = { from: plus(-60), to: plus(240) };
  await get('/v1/invitations/agenda', {}, range);
  await get('/v1/events', {}, range);
  await get('/v1/events/log');
  await get('/v1/notifications', { limit: 100 });
  await get('/v1/tickets');
  await get(`/v1/tickets/${ticket.id}`);
  await get(`/v1/weddings/${guestAt}`);
  await get(`/v1/weddings/${guestAt}/qr`);
  for (const f of w2fns) await get(`/v1/weddings/${guestAt}/functions/${f.id}`);

  /* â”€â”€ host console â”€â”€ */
  const base = `/v1/host/weddings/${hosted}`;
  await get(base);
  await get(`${base}/details`);
  const fns = await get(`${base}/functions`);
  await get(`${base}/family`);
  await get(`${base}/gift-categories`);
  await get(`${base}/gifts`);
  const guests = await get(`${base}/guests`, {}, { limit: 200 });
  for (const q of [{ side: 'bride' }, { side: 'groom' }, { app: 'no' }, { removed: '1' }]) await get(`${base}/guests`, q, { limit: 200 });
  for (const f of fns) {
    await get(`${base}/functions/${f.id}`);
    await get(`${base}/guests`, { fn: f.id }, { limit: 200 });
    await get(`${base}/guests`, { fn: f.id, status: 'pending' }, { limit: 200 });
    for (const tab of ['pending', 'going', 'maybe', 'not_going']) await get(`${base}/functions/${f.id}/rsvp`, { tab });
    for (const kind of ['rsvp_request', 'reminder']) await get(`${base}/functions/${f.id}/blasts/preview`, { kind });
    await get(`${base}/gifts`, { fn: f.id });
    await get(`${base}/gift-out`, { fn: f.id });
  }
  const more = await send('get', `${base}/guests?limit=200&offset=200`);
  for (const g of [...guests.guests, ...more.guests]) await get(`${base}/guests/${g.id}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), get: answers, post }));
  console.log(`${Object.keys(answers).length} answers â†’ ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
