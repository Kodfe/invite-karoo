/**
 * The little the REST API needs from a web server: a route table, sign-in, rate limits, request
 * bodies and one error shape. No framework. It runs inside a Firebase `onRequest` function, which
 * has already read the request (req.rawBody), and under plain node:http locally and in tests.
 *
 * Every error has the same shape:
 *   { error: { code: 'RSVP_CLOSED', message: 'Replies for this function closed ...', fields?: {...} } }
 */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import Busboy from 'busboy';
import helmet from 'helmet';
import type { ZodType, z } from 'zod';
import { env } from '../config/env';
import { AppError, notFound } from './app-error';
import { signedInUser, UserClaims } from './auth';
import { ID_RE, parse } from './zod';

export type Upload = { fieldname: string; originalname: string; mimetype: string; size: number; buffer: Buffer };
type Req = IncomingMessage & { rawBody?: Buffer };
type Handler = (c: Call) => unknown;
/**
 *   status   what a success answers: POST is 201 and everything else 200, unless set here
 *   files    multipart field names this route accepts
 *   limit    requests a minute from one address, on top of the overall limit
 */
type Options = { status?: number; files?: string[]; limit?: number };
type Route = { method: string; pattern: RegExp; keys: string[]; signedIn: boolean; handler: Handler; opts: Options };

/** what a route handler works with */
export class Call {
  files: Record<string, Upload[]> = {};
  fields: Record<string, string> = {};
  json: unknown;
  user!: UserClaims;

  constructor(
    readonly res: ServerResponse,
    readonly params: Record<string, string>,
    readonly search: URLSearchParams,
  ) {}

  get uid() {
    return this.user.sub;
  }
  /** a document id from the path */
  id(name: string) {
    const v = this.params[name];
    if (!ID_RE.test(v)) throw new AppError('HTTP_400', 'Not a valid id', 400);
    return v;
  }
  body<S extends ZodType>(schema: S): z.infer<S> {
    return parse(schema, this.json);
  }
  query<S extends ZodType>(schema: S): z.infer<S> {
    return parse(schema, Object.fromEntries(this.search));
  }
  file(field = 'file'): Upload | undefined {
    return this.files[field]?.[0];
  }
  /** answers with bytes instead of JSON */
  send(buffer: Buffer, contentType: string, disposition: string) {
    this.res.setHeader('Content-Type', contentType);
    this.res.setHeader('Content-Disposition', disposition);
    this.res.end(buffer);
  }
}

const table: Route[] = [];

/** the route table for one base path. Routes need a signed-in user unless `signedIn` is false. */
export function routes(base: string, { signedIn = true } = {}) {
  const add = (method: string) => (sub: string, handler: Handler, opts: Options = {}) => {
    const keys: string[] = [];
    const parts = `${base}/${sub}`.split('/').filter(Boolean);
    const source = parts.map((p) => (p.startsWith(':') ? (keys.push(p.slice(1)), '([^/]+)') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    table.push({ method, pattern: new RegExp(`^/${source.join('/')}/?$`, 'i'), keys, signedIn, handler, opts });
  };
  return { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

/* ───────────── rate limits ───────────── */

const hits = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 60_000;

/** The API sits behind one proxy, which adds the caller's address last. Counts are per instance. */
function callerOf(req: Req) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function checkLimit(key: string, limit: number) {
  const now = Date.now();
  if (hits.size > 10_000) for (const [k, h] of hits) if (h.until <= now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.until <= now) {
    hits.set(key, { count: 1, until: now + WINDOW_MS });
    return;
  }
  if (++h.count > limit) throw new AppError('TOO_MANY_REQUESTS', 'Too many requests. Please wait a minute and try again.', 429);
}

/** rate limits are off in the test suite, which signs in dozens of numbers a minute */
export const perMinute = (n: number) => (process.env.NODE_ENV === 'test' ? 100_000 : n);

/* ───────────── request bodies ───────────── */

async function bodyOf(req: Req) {
  if (req.rawBody) return req.rawBody;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function readMultipart(req: Req, raw: Buffer, c: Call, allowed: string[]) {
  return new Promise<void>((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({ headers: req.headers });
    } catch {
      return reject(new AppError('HTTP_400', 'The upload could not be read', 400));
    }
    parser.on('field', (name, value) => (c.fields[name] = value));
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (d: Buffer) => chunks.push(d));
      stream.on('end', () => {
        if (!allowed.includes(name)) return reject(new AppError('HTTP_400', 'Unexpected field', 400));
        const buffer = Buffer.concat(chunks);
        (c.files[name] ??= []).push({ fieldname: name, originalname: info.filename ?? '', mimetype: info.mimeType, size: buffer.length, buffer });
      });
    });
    parser.on('error', () => reject(new AppError('HTTP_400', 'The upload could not be read', 400)));
    parser.on('close', () => resolve());
    parser.end(raw);
  });
}

async function readBody(req: Req, c: Call, route: Route) {
  const raw = await bodyOf(req);
  if (route.opts.files) {
    if (/^multipart\//i.test(req.headers['content-type'] ?? '')) await readMultipart(req, raw, c, route.opts.files);
    c.json = c.fields;
    return;
  }
  if (!raw.length) return;
  if (!/json/i.test(req.headers['content-type'] ?? '')) return;
  try {
    c.json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError('HTTP_400', 'The request could not be read', 400);
  }
}

/* ───────────── answering ───────────── */

function answer(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, e: unknown) {
  if (res.headersSent) return res.end();
  if (e instanceof AppError) return answer(res, e.status, { error: { code: e.code, message: e.message, fields: e.fields } });
  console.error(e);
  answer(res, 500, { error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
}

/** STORAGE_DRIVER=local only: uploads served from disk during development */
async function localFile(pathname: string, res: ServerResponse) {
  const root = path.resolve(env().UPLOAD_DIR);
  const full = path.resolve(root, decodeURIComponent(pathname.slice('/files/'.length)));
  if (!full.startsWith(root + path.sep) || full.split(path.sep).some((p) => p.startsWith('.'))) throw notFound('File');
  res.end(await readFile(full).catch(() => Promise.reject(notFound('File'))));
}

const headers = helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } });

/** answers one request */
export async function handle(req: Req, res: ServerResponse) {
  try {
    await new Promise<void>((resolve, reject) => headers(req, res, (e?: unknown) => (e ? reject(e) : resolve())));
    const url = new URL(req.url ?? '/', 'http://api');
    const caller = callerOf(req);
    checkLimit(caller, perMinute(300));
    if (req.method === 'GET' && url.pathname.startsWith('/files/') && env().STORAGE_DRIVER === 'local') return await localFile(url.pathname, res);

    for (const route of table) {
      if (route.method !== req.method) continue;
      const m = route.pattern.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const c = new Call(res, params, url.searchParams);
      if (route.opts.limit) checkLimit(`${caller} ${route.method} ${route.pattern}`, route.opts.limit);
      if (route.signedIn) c.user = await signedInUser(req.headers.authorization);
      await readBody(req, c, route);
      const out = await route.handler(c);
      if (!res.writableEnded) answer(res, route.opts.status ?? (req.method === 'POST' ? 201 : 200), out);
      return;
    }
    throw new AppError('NOT_FOUND', `Cannot ${req.method} ${url.pathname}`, 404);
  } catch (e) {
    fail(res, e instanceof URIError ? new AppError('HTTP_400', 'Not a valid address', 400) : e);
  }
}
