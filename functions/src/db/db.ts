import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** the type a transaction callback receives — usable wherever a DB is */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

export const DB_TOKEN = Symbol('DB');
export const POOL_TOKEN = Symbol('PG_POOL');
export const InjectDb = () => Inject(DB_TOKEN);

export function createPool(url = env().DATABASE_URL) {
  const ca = env().DATABASE_CA_CERT;
  if (!ca) return new Pool({ connectionString: url, max: 10 });
  // Managed Postgres (e.g. DigitalOcean) signs with its own CA: verify against it. sslmode in the
  // URL would override this config, so it is dropped.
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return new Pool({ connectionString: u.toString(), max: 10, ssl: { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } });
}

@Global()
@Module({
  providers: [
    { provide: POOL_TOKEN, useFactory: () => createPool() },
    { provide: DB_TOKEN, inject: [POOL_TOKEN], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
  ],
  exports: [DB_TOKEN, POOL_TOKEN],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
