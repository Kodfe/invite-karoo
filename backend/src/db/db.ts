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
  return new Pool({ connectionString: url, max: 10 });
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
