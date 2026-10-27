/**
 * Demo data that mirrors the HTML prototype, with dates moved to "now" so every
 * screen has something real to show:
 *   +91 98644 55120  Mitesh Ranka — hosts Luveena & Mitesh, and is a guest at Rohit & Anika
 *   +91 91234 56780  Priya Shah   — a general user, invited to nothing
 * Run with: npm run seed:demo   (refuses to run in production)
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import { randomToken } from '../common/crypto';
import { localParts, zonedDate } from '../common/time';
import { createPool } from './db';
import * as s from './schema';
import { seedSystemData } from './seed-system';

function rand(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

const day = (offset: number) => localParts(new Date(Date.now() + offset * 86400_000)).date;

export async function seedDemo(url?: string) {
  const pool = createPool(url);
  const db = drizzle(pool, { schema: s });
  await seedSystemData(db);
  const OWNER = '+919864455120';
  const PRIYA = '+919123456780';

  // wipe earlier demo weddings so the script can be re-run
  const old = await db.select({ id: s.weddings.id }).from(s.weddings).where(inArray(s.weddings.ownerPhone, [OWNER, '+919876543210']));
  if (old.length) await db.delete(s.weddings).where(inArray(s.weddings.id, old.map((o) => o.id)));

  for (const [phone, firstName, familyName, city] of [
    [OWNER, 'Mitesh', 'Ranka', 'Guwahati'],
    [PRIYA, 'Priya', 'Shah', 'Chennai'],
  ] as const) {
    const [u] = await db.select().from(s.users).where(eq(s.users.phone, phone)).limit(1);
    if (!u) await db.insert(s.users).values({ phone, firstName, familyName, city });
  }

  /* ── wedding 1: the one Mitesh hosts ── */
  const [w1] = await db
    .insert(s.weddings)
    .values({
      ownerPhone: OWNER,
      contactPhone: '+919864012233',
      city: 'Guwahati',
      startDate: day(5),
      endDate: day(10),
      status: 'active',
      handedOverAt: new Date(),
      bride: { name: 'Luveena Sharma', parents: 'Ramesh & Sunita Sharma', city: 'Guwahati' },
      groom: { name: 'Mitesh Ranka', parents: 'Mahesh & Kavita Ranka', city: 'Guwahati' },
      brideFamily: { name: 'Sharma Family', elders: ['Ramesh Sharma', 'Sunita Sharma', 'Girdhari Lal Sharma'], city: 'Guwahati' },
      groomFamily: { name: 'Ranka Family', elders: ['Mahesh Ranka', 'Kavita Ranka', 'Padam Chand Ranka'], city: 'Guwahati' },
    })
    .returning();
  const created = new Date(Date.now() - 20 * 86400_000);
  const fnDefs = [
    { name: 'Haldi Ceremony', d: 5, t: '11:00', e: '14:00', venueName: 'Bride home, Lokhra', venueAddress: 'House 14, Lokhra Road, Guwahati', dressCode: 'Yellow, traditional', color: '#F5A623', icon: 'flower', notes: 'Lunch served after' },
    { name: 'Sangeet Night', d: 6, t: '20:30', e: '23:59', venueName: 'Vivanta Banquet Hall', venueAddress: 'GS Road, Guwahati', dressCode: 'Indo-western', color: '#7C5CBF', icon: 'music', notes: 'Performances from 9:30' },
    { name: 'Mehendi', d: 7, t: '16:00', e: '20:00', venueName: 'Bride home, Lokhra', venueAddress: 'House 14, Lokhra Road, Guwahati', dressCode: 'Green, light', color: '#16A34A', icon: 'flower', notes: 'Ladies only' },
    { name: 'Wedding Ceremony', d: 8, t: '21:00', e: '23:59', venueName: 'Lokhra Community Hall', venueAddress: 'Lokhra Chariali, Guwahati', dressCode: 'Formal traditional', color: '#A21CAF', icon: 'rings', notes: 'Pheras at 11:40 PM', giftPlan: 'Silver coin' },
    { name: 'Reception', d: 10, t: '19:30', e: '23:30', venueName: 'Vivanta Banquet Hall', venueAddress: 'GS Road, Guwahati', dressCode: 'Formal', color: '#1D4ED8', icon: 'gift', notes: 'Dinner from 8:30', giftPlan: 'Dry fruit box' },
  ];
  const fns = await db
    .insert(s.functions)
    .values(
      fnDefs.map((f, i) => ({
        weddingId: w1.id,
        name: f.name,
        startsAt: zonedDate(day(f.d), f.t),
        endsAt: zonedDate(day(f.d), f.e),
        venueName: f.venueName,
        venueAddress: f.venueAddress,
        dressCode: f.dressCode,
        notes: f.notes,
        color: f.color,
        icon: f.icon,
        giftPlan: f.giftPlan ?? null,
        sort: i,
        createdAt: created,
      })),
    )
    .returning();

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
  const gRows = [];
  const used = new Set<string>();
  for (let i = 0; i < 240; i++) {
    let phone: string;
    do phone = '+919' + String(400000000 + Math.floor(r() * 599999999)).slice(0, 9);
    while (used.has(phone) || phone === OWNER || phone === PRIYA);
    used.add(phone);
    gRows.push({
      weddingId: w1.id,
      name: `${first[Math.floor(r() * first.length)]} ${last[Math.floor(r() * last.length)]}`,
      phone,
      side: (r() < 0.5 ? 'bride' : 'groom') as 'bride' | 'groom',
      relation: rel[Math.floor(r() * rel.length)],
      expectedPax: 1 + Math.floor(r() * 3),
      createdVia: 'xls' as const,
      qrToken: randomToken(12),
    });
  }
  const gs = await db.insert(s.guests).values(gRows).returning();
  const invRows: (typeof s.invites.$inferInsert)[] = [];
  gs.forEach((g, gi) => {
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
      invRows.push({
        weddingId: w1.id,
        guestId: g.id,
        functionId: fns[fi].id,
        rsvp,
        pax,
        respondedAt: rsvp === 'none' ? null : new Date(Date.now() - Math.floor(r() * 5) * 86400_000),
        byHost: rsvp !== 'none' && r() < 0.2,
        notifiedAt: fi < 4 ? new Date(Date.now() - 6 * 86400_000) : null,
        giftOut: gi < 110 && (fi === 3 || fi === 4),
      });
    }
  });
  for (let i = 0; i < invRows.length; i += 500) await db.insert(s.invites).values(invRows.slice(i, i + 500));
  for (const [i, kind] of [[0, 'rsvp_request'], [1, 'rsvp_request'], [2, 'rsvp_request'], [3, 'rsvp_request'], [0, 'reminder']] as const) {
    await db.insert(s.blasts).values({ weddingId: w1.id, functionId: fns[i].id, kind, state: 'sent', idempotencyKey: `demo-${w1.id}-${i}-${kind}`, recipientCount: 0, sentAt: new Date(Date.now() - 6 * 86400_000), sentBy: OWNER });
  }
  await db.insert(s.weddingAccess).values([
    { weddingId: w1.id, phone: '+919864012233', name: 'Rahul Ranka', relation: 'Brother', addedBy: OWNER },
    { weddingId: w1.id, phone: '+919864044556', name: 'Neha Sharma', relation: 'Sister', addedBy: OWNER },
  ]);
  const cats = await db.select().from(s.giftCategories).where(eq(s.giftCategories.isSystem, true));
  const cash = cats.find((c) => c.key === 'cash')!;
  const clothing = cats.find((c) => c.key === 'clothing')!;
  await db.insert(s.giftsReceived).values([
    { weddingId: w1.id, functionId: fns[0].id, guestId: gs[3].id, giverName: gs[3].name, giverPhone: gs[3].phone, categoryId: cash.id, amount: 5100, recordedBy: 'Mitesh Ranka' },
    { weddingId: w1.id, functionId: fns[0].id, guestId: gs[9].id, giverName: gs[9].name, giverPhone: gs[9].phone, categoryId: clothing.id, itemName: 'Banarasi saree', recordedBy: 'Rahul Ranka' },
    { weddingId: w1.id, functionId: fns[1].id, guestId: null, giverName: 'Ratan Lal Bhansali', giverPhone: '+919864551200', categoryId: cash.id, amount: 5100, note: 'Neighbour, walked in', recordedBy: 'Rahul Ranka' },
  ]);

  /* ── wedding 2: Mitesh is a GUEST here ── */
  const [w2] = await db
    .insert(s.weddings)
    .values({
      ownerPhone: '+919876543210',
      contactPhone: '+919876543211',
      city: 'Jorhat',
      startDate: day(2),
      endDate: day(6),
      status: 'active',
      handedOverAt: new Date(),
      bride: { name: 'Anika Mehta', parents: 'Suresh & Rekha Mehta', city: 'Jorhat' },
      groom: { name: 'Rohit Agarwal', parents: 'Vinod & Seema Agarwal', city: 'Jorhat' },
      brideFamily: { name: 'Mehta Family', elders: ['Suresh Mehta'], city: 'Jorhat' },
      groomFamily: { name: 'Agarwal Family', elders: ['Vinod Agarwal'], city: 'Jorhat' },
    })
    .returning();
  const w2fns = await db
    .insert(s.functions)
    .values([
      { weddingId: w2.id, name: 'Tilak', startsAt: zonedDate(day(2), '18:00'), endsAt: zonedDate(day(2), '21:00'), venueName: 'Mehta House', venueAddress: 'Na-Ali, Jorhat', color: '#D18A08', icon: 'diya', createdAt: created, sort: 0 },
      { weddingId: w2.id, name: 'Sangeet', startsAt: zonedDate(day(6), '19:00'), endsAt: zonedDate(day(6), '23:00'), venueName: 'Hotel Paradise', venueAddress: 'AT Road, Jorhat', color: '#7C5CBF', icon: 'music', createdAt: created, sort: 1 },
      { weddingId: w2.id, name: 'Wedding', startsAt: zonedDate(day(6), '23:30'), endsAt: zonedDate(day(7), '03:00'), venueName: 'Jorhat Gymkhana Club', venueAddress: 'Gymkhana Road, Jorhat', color: '#A21CAF', icon: 'rings', createdAt: created, sort: 2 },
    ])
    .returning();
  const [me] = await db
    .insert(s.guests)
    .values({ weddingId: w2.id, name: 'Mitesh Ranka', phone: OWNER, side: 'groom', relation: 'College friend', qrToken: randomToken(12) })
    .returning();
  await db.insert(s.invites).values([
    { weddingId: w2.id, guestId: me.id, functionId: w2fns[0].id, rsvp: 'going', pax: 2, respondedAt: new Date() },
    { weddingId: w2.id, guestId: me.id, functionId: w2fns[1].id },
    { weddingId: w2.id, guestId: me.id, functionId: w2fns[2].id, giftOut: true },
  ]);

  await pool.end();
  return { hosted: w1.id, guestAt: w2.id };
}

if (require.main === module) {
  if (env().NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to seed demo data in production.');
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
