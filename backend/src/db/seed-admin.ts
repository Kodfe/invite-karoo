/* Creates (or resets the password of) the first admin from ADMIN_EMAIL / ADMIN_PASSWORD. */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import { hashPassword } from '../common/crypto';
import { createPool } from './db';
import * as schema from './schema';

async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = env();
  if (!ADMIN_EMAIL || ADMIN_PASSWORD.length < 10) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 10 characters first.');
  }
  const pool = createPool();
  const db = drizzle(pool, { schema });
  const email = ADMIN_EMAIL.toLowerCase();
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const [existing] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, email)).limit(1);
  if (existing) {
    await db.update(schema.adminUsers).set({ passwordHash, active: true, role: 'admin' }).where(eq(schema.adminUsers.id, existing.id));
    console.log(`Admin ${email} updated.`);
  } else {
    await db.insert(schema.adminUsers).values({ email, name: ADMIN_NAME, role: 'admin', passwordHash });
    console.log(`Admin ${email} created.`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
