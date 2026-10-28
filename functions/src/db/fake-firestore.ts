/**
 * An in-memory Firestore for tests — the subset in store.ts, with the semantics that matter:
 *   - `create` fails on an existing document (code 6), `update` on a missing one (code 5)
 *   - a filter or orderBy on a field leaves out documents that don't have the field
 *   - `where(x, '==', null)` matches null values only, not missing fields
 *   - `in` takes at most 30 values; a transaction reads everything before it writes
 *   - default order is by document path
 * It also records the shape of every query, so the composite indexes Firestore will need can be
 * listed (FIRESTORE_INDEX_LOG=<file> writes them when the test run ends).
 */
import { appendFileSync } from 'node:fs';
import type { Batch, CollRef, Db, DocRef, Json, QSnap, Query, Snap, Tx, WhereOp } from './store';

type Sentinel = { __fake: 'now' | 'inc' | 'del' | 'union' | 'remove'; v?: unknown };
export const fakeSentinel = (k: Sentinel['__fake'], v?: unknown): Sentinel => ({ __fake: k, v });
const isSentinel = (v: unknown): v is Sentinel => !!v && typeof v === 'object' && '__fake' in (v as object);
const tag = (v: unknown) => Object.prototype.toString.call(v);
const isDate = (v: unknown): v is Date => tag(v) === '[object Date]';
/** a plain object (realm-safe: Jest runs tests in a separate VM context) */
const isPlain = (v: unknown): v is Json => {
  if (!v || typeof v !== 'object' || isSentinel(v) || Array.isArray(v) || isDate(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto.constructor?.name === 'Object';
};

class FsError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

function clone<T>(v: T): T {
  if (isDate(v)) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isPlain(v)) {
    const o: Json = {};
    for (const [k, x] of Object.entries(v)) o[k] = clone(x);
    return o as T;
  }
  return v;
}

function getField(d: Json, field: string): { has: boolean; v: unknown } {
  let cur: unknown = d;
  for (const k of field.split('.')) {
    if (!isPlain(cur) || !(k in cur)) return { has: false, v: undefined };
    cur = cur[k];
  }
  return { has: true, v: cur };
}

function rank(v: unknown) {
  if (v === null) return 0;
  if (typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 2;
  if (isDate(v)) return 3;
  if (typeof v === 'string') return 4;
  if (Array.isArray(v)) return 6;
  return 7;
}
function cmp(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (isDate(a) && isDate(b)) return a.getTime() - b.getTime();
  if (typeof a === 'number' || typeof a === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'string') return a < (b as string) ? -1 : a > (b as string) ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = cmp(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
}
const eq = (a: unknown, b: unknown) => rank(a) === rank(b) && cmp(a, b) === 0;

function applyWrite(base: Json, patch: Json, mode: 'set' | 'merge' | 'update') {
  const out: Json = mode === 'set' ? {} : clone(base);
  const put = (target: Json, path: string[], value: unknown) => {
    let t = target;
    for (const k of path.slice(0, -1)) {
      if (!isPlain(t[k])) t[k] = {};
      t = t[k] as Json;
    }
    const last = path[path.length - 1];
    const prev = t[last];
    if (value === undefined) return;
    if (isSentinel(value)) {
      if (value.__fake === 'del') delete t[last];
      else if (value.__fake === 'now') t[last] = new Date();
      else if (value.__fake === 'inc') t[last] = (typeof prev === 'number' ? prev : 0) + (value.v as number);
      else if (value.__fake === 'union') {
        const arr = Array.isArray(prev) ? [...prev] : [];
        for (const x of value.v as unknown[]) if (!arr.some((y) => eq(x, y))) arr.push(clone(x));
        t[last] = arr;
      } else if (value.__fake === 'remove') {
        t[last] = (Array.isArray(prev) ? prev : []).filter((y) => !(value.v as unknown[]).some((x) => eq(x, y)));
      }
      return;
    }
    if (mode === 'merge' && isPlain(value)) {
      if (!isPlain(t[last])) t[last] = {};
      for (const [k, v] of Object.entries(value)) put(t[last] as Json, [k], v);
      return;
    }
    t[last] = resolveNested(value);
  };
  for (const [k, v] of Object.entries(patch)) put(out, mode === 'update' ? k.split('.') : [k], v);
  return out;
}
/** sentinels inside a nested value (only `now` is meaningful there) */
function resolveNested(v: unknown): unknown {
  if (isSentinel(v)) return v.__fake === 'now' ? new Date() : undefined;
  if (Array.isArray(v)) return v.map(resolveNested);
  if (isPlain(v)) {
    const o: Json = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = resolveNested(x);
    return o;
  }
  return clone(v);
}

/* ───────────── index log ───────────── */

const indexLog = new Map<string, Json>();
function logIndex(scope: 'COLLECTION' | 'COLLECTION_GROUP', collectionGroup: string, filters: Filt[], orders: [string, 'asc' | 'desc'][]) {
  const file = process.env.FIRESTORE_INDEX_LOG;
  if (!file) return;
  const eqFields = [...new Set(filters.filter((f) => ['==', 'in', 'array-contains', 'array-contains-any'].includes(f.op) && f.field !== '__name__').map((f) => f.field))];
  const rangeFields = filters.filter((f) => !['==', 'in', 'array-contains', 'array-contains-any'].includes(f.op) && f.field !== '__name__').map((f) => f.field);
  const fields: { fieldPath: string; order?: string; arrayConfig?: string }[] = [];
  for (const f of eqFields) {
    const isArr = filters.some((x) => x.field === f && x.op.startsWith('array-contains'));
    fields.push(isArr ? { fieldPath: f, arrayConfig: 'CONTAINS' } : { fieldPath: f, order: 'ASCENDING' });
  }
  const ordered = [...orders];
  for (const r of rangeFields) if (!ordered.some(([f]) => f === r)) ordered.unshift([r, 'asc']);
  for (const [f, d] of ordered) if (!fields.some((x) => x.fieldPath === f)) fields.push({ fieldPath: f, order: d === 'desc' ? 'DESCENDING' : 'ASCENDING' });
  // a single field needs no composite index (but collection-group queries need it enabled)
  if (fields.length < 2 && scope === 'COLLECTION') return;
  const key = `${scope}|${collectionGroup}|${JSON.stringify(fields)}`;
  if (indexLog.has(key)) return;
  indexLog.set(key, { collectionGroup, queryScope: scope, fields });
  appendFileSync(file, JSON.stringify({ collectionGroup, queryScope: scope, fields }) + '\n');
}

/* ───────────── store ───────────── */

type Filt = { field: string; op: WhereOp; value: unknown };

class FSnap implements Snap {
  constructor(readonly ref: FDoc, private readonly d: Json | undefined) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.d !== undefined;
  }
  data() {
    return this.d === undefined ? undefined : clone(this.d);
  }
}

class FQuery implements Query {
  constructor(
    protected readonly fs: FakeFirestore,
    readonly scopePath: string,
    readonly group: boolean,
    readonly filters: Filt[] = [],
    readonly orders: [string, 'asc' | 'desc'][] = [],
    readonly lim?: number,
    readonly off?: number,
  ) {}
  private with(p: Partial<{ filters: Filt[]; orders: [string, 'asc' | 'desc'][]; lim: number; off: number }>) {
    return new FQuery(this.fs, this.scopePath, this.group, p.filters ?? this.filters, p.orders ?? this.orders, p.lim ?? this.lim, p.off ?? this.off);
  }
  where(field: string, op: WhereOp, value: unknown): Query {
    if ((op === 'in' || op === 'not-in' || op === 'array-contains-any') && (!Array.isArray(value) || value.length === 0 || value.length > 30)) {
      throw new Error(`Firestore '${op}' needs 1–30 values, got ${Array.isArray(value) ? value.length : typeof value}`);
    }
    if (value === undefined) throw new Error(`Firestore: undefined value in where('${field}')`);
    return this.with({ filters: [...this.filters, { field, op, value: clone(value) }] });
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Query {
    return this.with({ orders: [...this.orders, [field, dir]] });
  }
  limit(n: number): Query {
    return this.with({ lim: n });
  }
  offset(n: number): Query {
    return this.with({ off: n });
  }
  run(): FSnap[] {
    const collId = this.scopePath.split('/').pop()!;
    logIndex(this.group ? 'COLLECTION_GROUP' : 'COLLECTION', collId, this.filters, this.orders);
    let docs: { path: string; id: string; d: Json }[] = [];
    for (const [path, d] of this.fs.docs) {
      const parts = path.split('/');
      const parent = parts.slice(0, -1).join('/');
      if (this.group ? parts[parts.length - 2] !== collId : parent !== this.scopePath) continue;
      docs.push({ path, id: parts[parts.length - 1], d });
    }
    for (const f of this.filters) {
      docs = docs.filter(({ id, d }) => {
        const { has, v } = f.field === '__name__' ? { has: true, v: id } : getField(d, f.field);
        if (!has) return false;
        switch (f.op) {
          case '==': return eq(v, f.value);
          case '!=': return v !== null && !eq(v, f.value);
          case '<': return rank(v) === rank(f.value) && cmp(v, f.value) < 0;
          case '<=': return rank(v) === rank(f.value) && cmp(v, f.value) <= 0;
          case '>': return rank(v) === rank(f.value) && cmp(v, f.value) > 0;
          case '>=': return rank(v) === rank(f.value) && cmp(v, f.value) >= 0;
          case 'in': return (f.value as unknown[]).some((x) => eq(v, x));
          case 'not-in': return v !== null && !(f.value as unknown[]).some((x) => eq(v, x));
          case 'array-contains': return Array.isArray(v) && v.some((x) => eq(x, f.value));
          case 'array-contains-any': return Array.isArray(v) && v.some((x) => (f.value as unknown[]).some((y) => eq(x, y)));
        }
      });
    }
    for (const [field] of this.orders) docs = docs.filter(({ d }) => getField(d, field).has);
    docs.sort((a, b) => {
      for (const [field, dir] of this.orders) {
        const c = cmp(getField(a.d, field).v, getField(b.d, field).v);
        if (c) return dir === 'desc' ? -c : c;
      }
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    if (this.off) docs = docs.slice(this.off);
    if (this.lim !== undefined) docs = docs.slice(0, this.lim);
    return docs.map(({ path, d }) => new FSnap(this.fs.docRef(path), clone(d)));
  }
  async get(): Promise<QSnap> {
    const docs = this.run();
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  count() {
    return { get: async () => { const n = this.run().length; return { data: () => ({ count: n }) }; } };
  }
}

class FColl extends FQuery implements CollRef {
  constructor(fs: FakeFirestore, readonly path: string) {
    super(fs, path, false);
  }
  get id() {
    return this.path.split('/').pop()!;
  }
  doc(id?: string): DocRef {
    return this.fs.docRef(`${this.path}/${id ?? this.fs.autoId()}`);
  }
}

class FDoc implements DocRef {
  constructor(private readonly fs: FakeFirestore, readonly path: string) {
    if (path.split('/').length % 2 !== 0) throw new Error(`Not a document path: ${path}`);
  }
  get id() {
    return this.path.split('/').pop()!;
  }
  get parent(): CollRef {
    return new FColl(this.fs, this.path.split('/').slice(0, -1).join('/'));
  }
  collection(id: string): CollRef {
    return new FColl(this.fs, `${this.path}/${id}`);
  }
  async get(): Promise<Snap> {
    return new FSnap(this, this.fs.docs.has(this.path) ? clone(this.fs.docs.get(this.path)!) : undefined);
  }
  async set(data: Json, opts?: { merge: boolean }) {
    this.fs.apply([{ kind: opts?.merge ? 'merge' : 'set', path: this.path, data }]);
  }
  async create(data: Json) {
    this.fs.apply([{ kind: 'create', path: this.path, data }]);
  }
  async update(data: Json) {
    this.fs.apply([{ kind: 'update', path: this.path, data }]);
  }
  async delete() {
    this.fs.apply([{ kind: 'delete', path: this.path }]);
  }
}

type Op = { kind: 'set' | 'merge' | 'create' | 'update' | 'delete'; path: string; data?: Json };

class FBatch implements Batch {
  private ops: Op[] = [];
  constructor(private readonly fs: FakeFirestore) {}
  private add(op: Op) {
    if (this.ops.length >= 500) throw new Error('A batch can hold at most 500 writes');
    this.ops.push(op);
    return this;
  }
  set(ref: DocRef, data: Json, opts?: { merge: boolean }) {
    return this.add({ kind: opts?.merge ? 'merge' : 'set', path: ref.path, data });
  }
  create(ref: DocRef, data: Json) {
    return this.add({ kind: 'create', path: ref.path, data });
  }
  update(ref: DocRef, data: Json) {
    return this.add({ kind: 'update', path: ref.path, data });
  }
  delete(ref: DocRef) {
    return this.add({ kind: 'delete', path: ref.path });
  }
  async commit() {
    this.fs.apply(this.ops);
  }
}

class FTx implements Tx {
  ops: Op[] = [];
  constructor(private readonly fs: FakeFirestore) {}
  private noWritesYet() {
    if (this.ops.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
  }
  get(ref: DocRef): Promise<Snap>;
  get(q: Query): Promise<QSnap>;
  async get(x: DocRef | Query): Promise<Snap | QSnap> {
    this.noWritesYet();
    return x instanceof FDoc ? x.get() : (x as Query).get();
  }
  async getAll(...refs: DocRef[]) {
    this.noWritesYet();
    return Promise.all(refs.map((r) => r.get()));
  }
  set(ref: DocRef, data: Json, opts?: { merge: boolean }) {
    this.ops.push({ kind: opts?.merge ? 'merge' : 'set', path: ref.path, data });
    return this;
  }
  create(ref: DocRef, data: Json) {
    this.ops.push({ kind: 'create', path: ref.path, data });
    return this;
  }
  update(ref: DocRef, data: Json) {
    this.ops.push({ kind: 'update', path: ref.path, data });
    return this;
  }
  delete(ref: DocRef) {
    this.ops.push({ kind: 'delete', path: ref.path });
    return this;
  }
}

export class FakeFirestore implements Db {
  readonly docs = new Map<string, Json>();
  private seq = 0;
  private txChain: Promise<unknown> = Promise.resolve();

  autoId() {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 16; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s + (this.seq++).toString(36).padStart(4, '0');
  }
  docRef(path: string) {
    return new FDoc(this, path);
  }
  collection(path: string): CollRef {
    if (path.split('/').length % 2 !== 1) throw new Error(`Not a collection path: ${path}`);
    return new FColl(this, path);
  }
  doc(path: string): DocRef {
    return new FDoc(this, path);
  }
  collectionGroup(id: string): Query {
    return new FQuery(this, id, true);
  }
  batch(): Batch {
    return new FBatch(this);
  }
  async getAll(...refs: DocRef[]) {
    return Promise.all(refs.map((r) => r.get()));
  }
  async recursiveDelete(ref: DocRef | CollRef) {
    for (const p of [...this.docs.keys()]) if (p === ref.path || p.startsWith(ref.path + '/')) this.docs.delete(p);
  }
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async () => {
      const tx = new FTx(this);
      const out = await fn(tx);
      this.apply(tx.ops);
      return out;
    };
    const p = this.txChain.then(run, run);
    this.txChain = p.catch(() => undefined);
    return p;
  }

  /** applies writes all-or-nothing */
  apply(ops: Op[]) {
    const next = new Map(this.docs);
    for (const op of ops) {
      const cur = next.get(op.path);
      switch (op.kind) {
        case 'create':
          if (cur) throw new FsError(6, `ALREADY_EXISTS: ${op.path}`);
          next.set(op.path, applyWrite({}, op.data!, 'set'));
          break;
        case 'update':
          if (!cur) throw new FsError(5, `NOT_FOUND: no document to update: ${op.path}`);
          next.set(op.path, applyWrite(cur, op.data!, 'update'));
          break;
        case 'set':
          next.set(op.path, applyWrite({}, op.data!, 'set'));
          break;
        case 'merge':
          next.set(op.path, applyWrite(cur ?? {}, op.data!, 'merge'));
          break;
        case 'delete':
          next.delete(op.path);
          break;
      }
    }
    this.docs.clear();
    for (const [k, v] of next) this.docs.set(k, v);
  }
}
