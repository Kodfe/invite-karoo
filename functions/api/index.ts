/** Vercel's entry: vercel.json sends every /v1 request here. */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
let api: Promise<Handler> | null = null;

/**
 * The API is loaded on the first request, so a problem while it starts (a missing setting, a package
 * that did not load) answers as JSON and shows in the function log, instead of Vercel's bare 500.
 */
export default async function entry(req: IncomingMessage, res: ServerResponse) {
  try {
    api ??= import('../src/main').then((m) => m.handle);
    const handle = await api;
    await handle(req, res);
  } catch (e) {
    api = null;
    console.error('The API could not start:', e);
    if (res.headersSent) return void res.end();
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    res.end(JSON.stringify({ error: { code: 'STARTUP_FAILED', message: `The API could not start: ${message}` } }));
  }
}
