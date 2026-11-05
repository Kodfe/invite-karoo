import { waitUntil } from '@vercel/functions';

/** work that carries on after the answer is sent: Vercel freezes a function once it has answered, unless told to wait */
export function later(work: Promise<unknown>) {
  waitUntil(work.catch((e) => console.error(e)));
}
