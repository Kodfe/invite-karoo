import { col } from './paths';
import { getRows, writeAll } from './store';

/** the six gift categories every wedding starts with. Idempotent. */
export const SYSTEM_GIFT_CATEGORIES = [
  { key: 'cash', label: 'Cash', isCash: true },
  { key: 'jewellery', label: 'Jewellery', isCash: false },
  { key: 'clothing', label: 'Clothing', isCash: false },
  { key: 'household', label: 'Household', isCash: false },
  { key: 'sweets', label: 'Sweets & dry fruits', isCash: false },
  { key: 'other', label: 'Other', isCash: false },
];

export async function seedSystemData() {
  const have = new Set((await getRows<{ key: string }>(col.systemGiftCategories())).map((c) => c.key));
  const missing = SYSTEM_GIFT_CATEGORIES.filter((c) => !have.has(c.key));
  // the key is the document id, so running this twice can never make two "cash" categories
  await writeAll(
    missing.map((c) => (b) =>
      b.set(col.systemGiftCategories().doc(c.key), { ...c, weddingId: null, isSystem: true, active: true, sort: SYSTEM_GIFT_CATEGORIES.indexOf(c), createdAt: new Date() }),
    ),
  );
  return missing.length;
}
