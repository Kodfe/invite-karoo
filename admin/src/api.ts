// Talks to the Invite Karoo API. Same origin by default (the API serves this page at /admin);
// set VITE_API_URL to point a local dev build at another server.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'ik_admin_token';

export type Json = Record<string, any>;
export type Role = 'admin' | 'setup' | 'support';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public fields?: Record<string, string>) {
    super(message);
  }
}

export const token = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return memo;
    }
  },
  set(v: string | null) {
    memo = v;
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private window: keep it in memory */
    }
  },
};
let memo: string | null = null;

/** called when the server says the session is over */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function raw(method: string, path: string, body?: unknown, query?: Json): Promise<Response> {
  const url = new URL(BASE + '/v1/admin' + path, window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), { method, headers, body: payload });
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection and try again.', 0);
  }
  if (!res.ok) {
    let err: Json = {};
    try {
      err = (await res.json())?.error ?? {};
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(err.code ?? 'HTTP_' + res.status, err.message ?? `Request failed (${res.status})`, res.status, err.fields);
  }
  return res;
}

async function json<T = any>(method: string, path: string, body?: unknown, query?: Json): Promise<T> {
  const res = await raw(method, path, body, query);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T = any>(path: string, query?: Json) => json<T>('GET', path, undefined, query),
  post: <T = any>(path: string, body?: unknown, query?: Json) => json<T>('POST', path, body ?? {}, query),
  patch: <T = any>(path: string, body: unknown) => json<T>('PATCH', path, body),
  put: <T = any>(path: string, body: unknown) => json<T>('PUT', path, body),
  delete: <T = any>(path: string) => json<T>('DELETE', path),
  upload: <T = any>(path: string, form: FormData, query?: Json) => json<T>('POST', path, form, query),
  /** fetches a protected file and hands it to the browser as a download */
  async download(path: string, fallbackName: string) {
    const res = await raw('GET', path);
    const cd = res.headers.get('Content-Disposition') ?? '';
    const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};

export function can(role: Role | undefined, need: 'setup' | 'admin' | 'any'): boolean {
  if (!role) return false;
  if (role === 'admin' || need === 'any') return true;
  return role === need;
}
