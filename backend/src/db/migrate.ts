/* Runs every pending SQL migration in ./drizzle, then seeds the system gift categories. */
import 'dotenv/config';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './db';
import * as schema from './schema';
import { seedSystemData } from './seed-system';

export async function runMigrations(url?: string) {
  const pool = createPool(url);
  try {
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
    await seedSystemData(db);
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
