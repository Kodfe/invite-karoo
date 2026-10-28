/* Runs every pending SQL migration in ./drizzle, seeds the system gift categories, and creates the
   first admin from ADMIN_EMAIL / ADMIN_PASSWORD when there is no admin yet (so a fresh Railway
   deploy can sign in to the dashboard without running a script). */
import 'dotenv/config';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { count } from 'drizzle-orm';
import { hashPassword } from '../common/crypto';
import { env } from '../config/env';
import { createPool } from './db';
import * as schema from './schema';
import { seedSystemData } from './seed-system';

export async function runMigrations(url?: string) {
  const pool = createPool(url);
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
    await seedSystemData(db);
    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, NODE_ENV } = env();
    if (NODE_ENV !== 'test' && ADMIN_EMAIL && ADMIN_PASSWORD.length >= 10 && !ADMIN_PASSWORD.startsWith('change-me')) {
      const [{ n }] = await db.select({ n: count() }).from(schema.adminUsers);
      if (n === 0) {
        await db.insert(schema.adminUsers).values({ email: ADMIN_EMAIL.toLowerCase(), name: ADMIN_NAME, role: 'admin', passwordHash: await hashPassword(ADMIN_PASSWORD) });
        console.log(`First admin ${ADMIN_EMAIL.toLowerCase()} created.`);
      }
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
