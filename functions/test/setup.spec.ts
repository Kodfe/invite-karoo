import type { Server } from 'node:http';
import request from 'supertest';
import { boot, passwordSignIn } from './setup';
import { auth } from '../src/common/firebase-auth';
import { col } from '../src/db/paths';
import { getDoc } from '../src/db/store';
import { Admin } from '../src/db/models';

/* The one-time first-admin page. boot() seeds a@ik.test, so each test starts by switching it off. */

let app: Server;
let http: ReturnType<typeof request>;
let seededUid: string;

beforeAll(async () => {
  app = await boot();
  http = request(app);
  seededUid = (await auth().getUserByEmail('a@ik.test'))!.uid;
});

const first = { email: 'a@ik.test', name: 'First Admin', password: 'password-123' };

test('closed while an active admin exists', async () => {
  expect((await http.get('/v1/team/setup').expect(200)).body).toEqual({ open: false });
  const r = await http.post('/v1/team/setup').send(first).expect(410);
  expect(r.body.error.code).toBe('SETUP_DONE');
});

test('opens with no active admin, takes only the server-set email and password, then closes for good', async () => {
  await col.admins().doc(seededUid).set({ active: false }, { merge: true });
  // a project where nothing was ever seeded
  for (const c of (await col.systemGiftCategories().get()).docs) await c.ref.delete();
  expect((await http.get('/v1/team/setup').expect(200)).body).toEqual({ open: true });

  expect((await http.post('/v1/team/setup').send({ ...first, password: 'not-the-one-1' }).expect(403)).body.error.code).toBe('SETUP_MISMATCH');
  expect((await http.post('/v1/team/setup').send({ ...first, email: 'b@ik.test' }).expect(403)).body.error.code).toBe('SETUP_MISMATCH');

  // the existing Auth account (as if made by hand in the console) is taken over, not duplicated
  const r = await http.post('/v1/team/setup').send({ ...first, email: ' A@IK.test ' }).expect(201);
  expect(r.body.id).toBe(seededUid);
  const rec = await getDoc<Admin>(col.admins().doc(seededUid));
  expect(rec).toMatchObject({ email: 'a@ik.test', name: 'First Admin', role: 'admin', active: true });
  await passwordSignIn('a@ik.test', 'password-123');
  expect((await col.systemGiftCategories().count().get()).data().count).toBe(6);

  expect((await http.get('/v1/team/setup').expect(200)).body).toEqual({ open: false });
  await http.post('/v1/team/setup').send(first).expect(410);
});
