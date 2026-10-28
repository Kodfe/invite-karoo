import { isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/** the six gift categories every wedding starts with. Idempotent. */
export const SYSTEM_GIFT_CATEGORIES = [
  { key: 'cash', label: 'Cash', isCash: true },
  { key: 'jewellery', label: 'Jewellery', isCash: false },
  { key: 'clothing', label: 'Clothing', isCash: false },
  { key: 'household', label: 'Household', isCash: false },
  { key: 'sweets', label: 'Sweets & dry fruits', isCash: false },
  { key: 'other', label: 'Other', isCash: false },
];

export async function seedSystemData(db: NodePgDatabase<typeof schema>) {
  const existing = await db
    .select({ key: schema.giftCategories.key })
    .from(schema.giftCategories)
    .where(isNull(schema.giftCategories.weddingId));
  const have = new Set(existing.map((e) => e.key));
  const missing = SYSTEM_GIFT_CATEGORIES.filter((c) => !have.has(c.key));
  if (missing.length) {
    await db.insert(schema.giftCategories).values(
      missing.map((c) => ({ ...c, isSystem: true, sort: SYSTEM_GIFT_CATEGORIES.indexOf(c) })),
    );
  }
}
