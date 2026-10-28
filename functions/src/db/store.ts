/**
 * The Firestore surface this API uses — a small, typed subset of the Admin SDK.
 *
 * In production it is the real `firebase-admin` Firestore. Tests run against an in-memory
 * implementation of the same subset (fake-firestore.ts) unless FIRESTORE_EMULATOR_HOST is set,
 * in which case they run against the real Firebase emulator (that is what CI does).
 *
 * Rules every caller follows:
 *   - write Dates, never Timestamps; read through `data()` / `rows()` which turn Timestamps back into Dates
 *   - write FieldValues only through `F` below
 *   - documents are `{ id, ...fields }` once read
 */
import { FieldPath, FieldValue, Filter, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { adminApp } from '../modules/infra/firebase';
import { FakeFirestore, fakeSentinel } from './fake-firestore';

export type Json = Record<string, unknown>;
export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';

export interface Snap {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: DocRef;
  data(): Json | undefined;
}
export interface QSnap {
  readonly docs: Snap[];
  readonly size: number;
  readonly empty: boolean;
}
export interface Query {
  where(field: string, op: WhereOp, value: unknown): Query;
  orderBy(field: string, dir?: 'asc' | 'desc'): Query;
  limit(n: number): Query;
  offset(n: number): Query;
  get(): Promise<QSnap>;
  count(): { get(): Promise<{ data(): { count: number } }> };
}
export interface CollRef extends Query {
  readonly id: string;
  readonly path: string;
  doc(id?: string): DocRef;
}
export interface DocRef {
  readonly id: string;
  readonly path: string;
  readonly parent: CollRef;
  collection(id: string): CollRef;
  get(): Promise<Snap>;
  set(data: Json, opts?: { merge: boolean }): Promise<unknown>;
  create(data: Json): Promise<unknown>;
  update(data: Json): Promise<unknown>;
  delete(): Promise<unknown>;
}
export interface Tx {
  get(ref: DocRef): Promise<Snap>;
  get(q: Query): Promise<QSnap>;
  getAll(...refs: DocRef[]): Promise<Snap[]>;
  set(ref: DocRef, data: Json, opts?: { merge: boolean }): Tx;
  create(ref: DocRef, data: Json): Tx;
  update(ref: DocRef, data: Json): Tx;
  delete(ref: DocRef): Tx;
}
export interface Batch {
  set(ref: DocRef, data: Json, opts?: { merge: boolean }): Batch;
  create(ref: DocRef, data: Json): Batch;
  update(ref: DocRef, data: Json): Batch;
  delete(ref: DocRef): Batch;
  commit(): Promise<unknown>;
}
export interface Db {
  collection(path: string): CollRef;
  doc(path: string): DocRef;
  collectionGroup(id: string): Query;
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  batch(): Batch;
  getAll(...refs: DocRef[]): Promise<Snap[]>;
  recursiveDelete(ref: DocRef | CollRef): Promise<void>;
}

let fake: FakeFirestore | null = null;
let real: Db | null = null;

/** true when tests use the in-memory store (no emulator) */
export const usingFake = () => process.env.NODE_ENV === 'test' && !process.env.FIRESTORE_EMULATOR_HOST;

export function db(): Db {
  if (usingFake()) return (fake ??= new FakeFirestore());
  if (!real) {
    const f = getFirestore(adminApp());
    f.settings({ ignoreUndefinedProperties: true });
    real = f as unknown as Db;
  }
  return real;
}

/** tests: start from an empty database */
export async function resetStore() {
  if (usingFake()) {
    fake = new FakeFirestore();
    return;
  }
  const d = db();
  for (const c of await (d as unknown as { listCollections(): Promise<CollRef[]> }).listCollections()) await d.recursiveDelete(c);
}

/* ───────────── field values ───────────── */

export const F = {
  /** server time of the write */
  now: () => (usingFake() ? fakeSentinel('now') : FieldValue.serverTimestamp()),
  inc: (n: number) => (usingFake() ? fakeSentinel('inc', n) : FieldValue.increment(n)),
  del: () => (usingFake() ? fakeSentinel('del') : FieldValue.delete()),
  union: (...v: unknown[]) => (usingFake() ? fakeSentinel('union', v) : FieldValue.arrayUnion(...v)),
  remove: (...v: unknown[]) => (usingFake() ? fakeSentinel('remove', v) : FieldValue.arrayRemove(...v)),
};

/** `where(docId(), 'in', ids)` */
export const docId = () => (usingFake() ? '__name__' : (FieldPath.documentId() as unknown as string));
export { Filter };

/* ───────────── reading ───────────── */

function revive(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate();
  if (Object.prototype.toString.call(v) === '[object Date]') return new Date((v as Date).getTime());
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v)?.constructor?.name === 'Object') {
    const o: Json = {};
    for (const [k, x] of Object.entries(v)) o[k] = revive(x);
    return o;
  }
  return v;
}

/** a snapshot as `{ id, ...fields }` with Dates, or null when missing */
export function data<T = Json>(s: Snap): (T & { id: string }) | null {
  if (!s.exists) return null;
  return { ...(revive(s.data()) as T), id: s.id };
}
export function rows<T = Json>(q: QSnap): (T & { id: string })[] {
  return q.docs.map((s) => ({ ...(revive(s.data()) as T), id: s.id }));
}
export async function getDoc<T = Json>(ref: DocRef) {
  return data<T>(await ref.get());
}
export async function getRows<T = Json>(q: Query) {
  return rows<T>(await q.get());
}

/** a document id for a new document in this collection */
export const newId = (c: CollRef) => c.doc().id;

/** Firestore `in` takes at most 30 values: run it in chunks */
export async function whereIn<T = Json>(q: Query, field: string, values: unknown[]): Promise<(T & { id: string })[]> {
  const out: (T & { id: string })[] = [];
  const uniq = [...new Set(values)];
  for (let i = 0; i < uniq.length; i += 30) out.push(...(await getRows<T>(q.where(field, 'in', uniq.slice(i, i + 30)))));
  return out;
}

/** many documents by id (missing ones left out) */
export async function byIds<T = Json>(c: CollRef, ids: string[]): Promise<Map<string, T & { id: string }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const m = new Map<string, T & { id: string }>();
  for (let i = 0; i < uniq.length; i += 300) {
    const snaps = await db().getAll(...uniq.slice(i, i + 300).map((id) => c.doc(id)));
    for (const s of snaps) {
      const d = data<T>(s);
      if (d) m.set(d.id, d);
    }
  }
  return m;
}

/** commits any number of writes in batches of 400 */
export async function writeAll(ops: ((b: Batch) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db().batch();
    for (const op of ops.slice(i, i + 400)) op(b);
    await b.commit();
  }
}

/** Firestore error code of a failed write (6 = ALREADY_EXISTS, 5 = NOT_FOUND) */
export const isAlreadyExists = (e: unknown) => (e as { code?: unknown })?.code === 6 || (e as { code?: unknown })?.code === 'already-exists';
export const isNotFound = (e: unknown) => (e as { code?: unknown })?.code === 5 || (e as { code?: unknown })?.code === 'not-found';
