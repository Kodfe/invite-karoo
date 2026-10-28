/**
 * Demo data that mirrors the HTML prototype, with dates moved to "now" so every
 * screen has something real to show:
 *   +91 98644 55120  Mitesh Ranka — hosts Luveena & Mitesh, and is a guest at Rohit & Anika
 *   +91 91234 56780  Priya Shah   — a general user, invited to nothing
 * Run with: npm run seed:demo   (refuses to run in production unless --force)
 */
import 'dotenv/config';
import { env } from '../config/env';
import { localParts, zonedDate } from '../common/time';
import { newGuest, newInvite } from '../modules/admin/admin-weddings.service';
import { DEFAULT_PREFS, DEFAULT_PRIVACY, inviteId, blastId } from './models';
import { col } from './paths';
import { Batch, db, getRows, writeAll } from './store';
import { seedSystemData } from './seed-system';

function rand(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

const day = (offset: number) => localParts(new Date(Date.now() + offset * 86400_000)).date;

async function ensureUser(phone: string, firstName: string, familyName: string, city: string) {
  const link = await col.phones().doc(phone).get();
  if (link.exists) return (link.data() as { uid: string }).uid;
  const uid = col.users().doc().id;
  const b = db().batch();
  b.set(col.phones().doc(phone), { uid });
  b.set(col.users().doc(uid), {
    phone, firstName, familyName, city, email: null, photoUrl: null, lang: 'en',
    prefs: DEFAULT_PREFS, privacy: DEFAULT_PRIVACY, lastSeenAt: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  });
  await b.commit();
  return uid;
}

function wedding(o: Record<string, unknown>) {
  return {
    timezone: 'Asia/Kolkata', datesLocked: true, statusReason: null, sendingEnabled: true, card: null, voice: null,
    applicationId: null, endedAt: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(), status: 'active', handedOverAt: new Date(),
    ...o,
  };
}

export async function seedDemo() {
  await seedSystemData();
  const OWNER = '+919864455120';
  const PRIYA = '+919123456780';

  // wipe earlier demo weddings so the script can be re-run
  for (const p of [OWNER, '+919876543210']) {
    for (const w of await getRows(col.weddings().where('ownerPhone', '==', p))) await db().recursiveDelete(col.weddings().doc(w.id));
  }
  await ensureUser(OWNER, 'Mitesh', 'Ranka', 'Guwahati');
  await ensureUser(PRIYA, 'Priya', 'Shah', 'Chennai');

  /* ── wedding 1: the one Mitesh hosts ── */
  const w1 = col.weddings().doc();
  await w1.set(wedding({
    ownerPhone: OWNER,
    contactPhone: '+919864012233',
    city: 'Guwahati',
    startDate: day(5),
    endDate: day(10),
    bride: { name: 'Luveena Sharma', parents: 'Ramesh & Sunita Sharma', city: 'Guwahati' },
    groom: { name: 'Mitesh Ranka', parents: 'Mahesh & Kavita Ranka', city: 'Guwahati' },
    brideFamily: { name: 'Sharma Family', elders: ['Ramesh Sharma', 'Sunita Sharma', 'Girdhari Lal Sharma'], city: 'Guwahati' },
    groomFamily: { name: 'Ranka Family', elders: ['Mahesh Ranka', 'Kavita Ranka', 'Padam Chand Ranka'], city: 'Guwahati' },
  }));
  const created = new Date(Date.now() - 20 * 86400_000);
  const fnDefs = [
    { name: 'Haldi Ceremony', d: 5, t: '11:00', e: '14:00', venueName: 'Bride home, Lokhra', venueAddress: 'House 14, Lokhra Road, Guwahati', dressCode: 'Yellow, traditional', color: '#F5A623', icon: 'flower', notes: 'Lunch served after' },
    { name: 'Sangeet Night', d: 6, t: '20:30', e: '23:59', venueName: 'Vivanta Banquet Hall', venueAddress: 'GS Road, Guwahati', dressCode: 'Indo-western', color: '#7C5CBF', icon: 'music', notes: 'Performances from 9:30' },
    { name: 'Mehendi', d: 7, t: '16:00', e: '20:00', venueName: 'Bride home, Lokhra', venueAddress: 'House 14, Lokhra Road, Guwahati', dressCode: 'Green, light', color: '#16A34A', icon: 'flower', notes: 'Ladies only' },
    { name: 'Wedding Ceremony', d: 8, t: '21:00', e: '23:59', venueName: 'Lokhra Community Hall', venueAddress: 'Lokhra Chariali, Guwahati', dressCode: 'Formal traditional', color: '#A21CAF', icon: 'rings', notes: 'Pheras at 11:40 PM', giftPlan: 'Silver coin' },
    { name: 'Reception', d: 10, t: '19:30', e: '23:30', venueName: 'Vivanta Banquet Hall', venueAddress: 'GS Road, Guwahati', dressCode: 'Formal', color: '#1D4ED8', icon: 'gift', notes: 'Dinner from 8:30', giftPlan: 'Dry fruit box' },
  ];
  const fns = fnDefs.map(() => col.functions(w1.id).doc());
  const ops: ((b: Batch) => void)[] = [];
  fnDefs.forEach((f, i) =>
    ops.push((b) =>
      b.set(fns[i], {
        weddingId: w1.id, name: f.name, startsAt: zonedDate(day(f.d), f.t), endsAt: zonedDate(day(f.d), f.e),
        venueName: f.venueName, venueAddress: f.venueAddress, mapsUrl: null, dressCode: f.dressCode, notes: f.notes,
        color: f.color, icon: f.icon, giftPlan: f.giftPlan ?? null, sort: i, createdAt: created, updatedAt: created, deletedAt: null,
      }),
    ),
  );

  const first = ['Ajay', 'Sneha', 'Vikram', 'Priya', 'Rohit', 'Anita', 'Suresh', 'Meera', 'Karan', 'Divya', 'Nikhil', 'Pooja', 'Arjun', 'Kavya', 'Manish', 'Ritu', 'Sanjay', 'Neha', 'Amit', 'Shreya'];
  const last = ['Bothra', 'Kothari', 'Surana', 'Lodha', 'Ranka', 'Sharma', 'Jain', 'Bhansali', 'Mehta', 'Agarwal', 'Baruah', 'Choudhury', 'Saikia', 'Das'];
  const rel = ['Uncle', 'Aunt', 'Cousin', 'Brother', 'Sister', 'Family friend', 'College friend', 'Colleague', 'Neighbour', 'Business associate'];
  const segments = [
    { upto: 60, fns: [0, 1, 2, 3, 4] },
    { upto: 110, fns: [0, 1, 3, 4] },
    { upto: 180, fns: [1, 3, 4] },
    { upto: 240, fns: [3, 4] },
  ];
  const r = rand(20260522);
  const used = new Set<string>();
  const gs: { id: string; name: string; phone: string }[] = [];
  for (let gi = 0; gi < 240; gi++) {
    let phone: string;
    do phone = '+919' + String(400000000 + Math.floor(r() * 599999999)).slice(0, 9);
    while (used.has(phone) || phone === OWNER || phone === PRIYA);
    used.add(phone);
    const ref = col.guests(w1.id).doc();
    const g = {
      name: `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`,
      phone,
      side: (r() < 0.5 ? 'bride' : 'groom') as 'bride' | 'groom',
      relation: rel[Math.floor(r() * rel.length)],
      expectedPax: 1 + Math.floor(r() * 3),
      notes: '',
    };
    gs.push({ id: ref.id, name: g.name, phone });
    ops.push((b) => b.set(ref, newGuest(w1.id, g, 'xls')));
    const seg = segments.find((x) => gi < x.upto)!;
    const p = gi < 186 ? 'yes' : gi < 208 ? 'no' : 'none';
    for (const fi of seg.fns) {
      let rsvp: 'none' | 'going' | 'maybe' | 'not_going' = 'none';
      let pax = 0;
      const roll = r();
      if (p === 'yes') {
        if (roll < 0.6) { rsvp = 'going'; pax = 1 + Math.floor(r() * 3.4); }
        else if (roll < 0.68) rsvp = 'maybe';
      } else if (p === 'no' && roll < 0.86) rsvp = 'not_going';
      const inv = {
        ...newInvite(w1.id, ref.id, fns[fi].id, gi < 110 && (fi === 3 || fi === 4)),
        rsvp,
        pax,
        respondedAt: rsvp === 'none' ? null : new Date(Date.now() - Math.floor(r() * 5) * 86400_000),
        byHost: rsvp !== 'none' && r() < 0.2,
        notifiedAt: fi < 4 ? new Date(Date.now() - 6 * 86400_000) : null,
      };
      ops.push((b) => b.set(col.invites(w1.id).doc(inviteId(ref.id, fns[fi].id)), inv));
    }
  }
  for (const [i, kind] of [[0, 'rsvp_request'], [1, 'rsvp_request'], [2, 'rsvp_request'], [3, 'rsvp_request'], [0, 'reminder']] as const) {
    ops.push((b) =>
      b.set(col.blasts(w1.id).doc(blastId(fns[i].id, kind)), {
        weddingId: w1.id, functionId: fns[i].id, kind, state: 'sent', idempotencyKey: `demo-${w1.id}-${i}-${kind}`,
        recipientCount: 0, deliveredCount: 0, failedCount: 0, sentAt: new Date(Date.now() - 6 * 86400_000), sentBy: OWNER, error: null, claimedAt: null, createdAt: new Date(),
      }),
    );
  }
  for (const a of [
    { phone: '+919864012233', name: 'Rahul Ranka', relation: 'Brother' },
    { phone: '+919864044556', name: 'Neha Sharma', relation: 'Sister' },
  ]) ops.push((b) => b.set(col.access(w1.id).doc(), { weddingId: w1.id, ...a, role: 'cohost', addedBy: OWNER, addedAt: new Date(), removedAt: null }));
  const gift = (o: Record<string, unknown>) => ({ weddingId: w1.id, guestId: null, giverPhone: '', amount: null, itemName: null, note: '', method: 'manual', recordedAt: new Date(), deletedAt: null, ...o });
  ops.push((b) => b.set(col.gifts(w1.id).doc(), gift({ functionId: fns[0].id, guestId: gs[3].id, giverName: gs[3].name, giverPhone: gs[3].phone, categoryId: 'cash', amount: 5100, recordedBy: 'Mitesh Ranka' })));
  ops.push((b) => b.set(col.gifts(w1.id).doc(), gift({ functionId: fns[0].id, guestId: gs[9].id, giverName: gs[9].name, giverPhone: gs[9].phone, categoryId: 'clothing', itemName: 'Banarasi saree', recordedBy: 'Rahul Ranka' })));
  ops.push((b) => b.set(col.gifts(w1.id).doc(), gift({ functionId: fns[1].id, giverName: 'Ratan Lal Bhansali', giverPhone: '+919864551200', categoryId: 'cash', amount: 5100, note: 'Neighbour, walked in', recordedBy: 'Rahul Ranka' })));

  /* ── wedding 2: Mitesh is a GUEST here ── */
  const w2 = col.weddings().doc();
  ops.push((b) =>
    b.set(w2, wedding({
      ownerPhone: '+919876543210',
      contactPhone: '+919876543211',
      city: 'Jorhat',
      startDate: day(2),
      endDate: day(6),
      bride: { name: 'Anika Mehta', parents: 'Suresh & Rekha Mehta', city: 'Jorhat' },
      groom: { name: 'Rohit Agarwal', parents: 'Vinod & Seema Agarwal', city: 'Jorhat' },
      brideFamily: { name: 'Mehta Family', elders: ['Suresh Mehta'], city: 'Jorhat' },
      groomFamily: { name: 'Agarwal Family', elders: ['Vinod Agarwal'], city: 'Jorhat' },
    })),
  );
  const w2fnDefs = [
    { name: 'Tilak', s: zonedDate(day(2), '18:00'), e: zonedDate(day(2), '21:00'), venueName: 'Mehta House', venueAddress: 'Na-Ali, Jorhat', color: '#D18A08', icon: 'diya' },
    { name: 'Sangeet', s: zonedDate(day(6), '19:00'), e: zonedDate(day(6), '23:00'), venueName: 'Hotel Paradise', venueAddress: 'AT Road, Jorhat', color: '#7C5CBF', icon: 'music' },
    { name: 'Wedding', s: zonedDate(day(6), '23:30'), e: zonedDate(day(7), '03:00'), venueName: 'Jorhat Gymkhana Club', venueAddress: 'Gymkhana Road, Jorhat', color: '#A21CAF', icon: 'rings' },
  ];
  const w2fns = w2fnDefs.map(() => col.functions(w2.id).doc());
  w2fnDefs.forEach((f, i) =>
    ops.push((b) =>
      b.set(w2fns[i], {
        weddingId: w2.id, name: f.name, startsAt: f.s, endsAt: f.e, venueName: f.venueName, venueAddress: f.venueAddress, mapsUrl: null,
        dressCode: null, notes: null, color: f.color, icon: f.icon, giftPlan: null, sort: i, createdAt: created, updatedAt: created, deletedAt: null,
      }),
    ),
  );
  const me = col.guests(w2.id).doc();
  ops.push((b) => b.set(me, newGuest(w2.id, { name: 'Mitesh Ranka', phone: OWNER, side: 'groom', relation: 'College friend', expectedPax: 1, notes: '' }, 'xls')));
  ops.push((b) => b.set(col.invites(w2.id).doc(inviteId(me.id, w2fns[0].id)), { ...newInvite(w2.id, me.id, w2fns[0].id, false), rsvp: 'going', pax: 2, respondedAt: new Date() }));
  ops.push((b) => b.set(col.invites(w2.id).doc(inviteId(me.id, w2fns[1].id)), newInvite(w2.id, me.id, w2fns[1].id, false)));
  ops.push((b) => b.set(col.invites(w2.id).doc(inviteId(me.id, w2fns[2].id)), newInvite(w2.id, me.id, w2fns[2].id, true)));

  await writeAll(ops);
  return { hosted: w1.id, guestAt: w2.id };
}

if (require.main === module) {
  if (env().NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to seed demo data in production (add --force for a test project).');
    process.exit(1);
  }
  seedDemo()
    .then((r) => {
      console.log('Demo data ready:', r);
      console.log('Sign in as +91 98644 55120 (host + guest) or +91 91234 56780 (guest only).');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
