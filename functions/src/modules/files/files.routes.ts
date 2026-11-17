/**
 * Vercel takes at most 4.5 MB in a request, so large files go straight to Storage: the app asks
 * here for a short-lived upload link, PUTs the file there, then hands the route that wants it the
 * key (`guestsKey`, `cardKey`, `fileKey`) instead of attaching the file.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../../common/app-error';
import { Call, routes, Upload } from '../../common/http';
import { svc } from '../../services';

const NewUpload = z.object({
  kind: z.enum(['image', 'pdf', 'sheet']),
  name: z.string().trim().min(1).max(200),
  contentType: z.string().min(3).max(120),
  size: z.number().int().positive(),
});

export function uploadRoutes() {
  const r = routes('/v1/uploads');

  r.post('', async (c) => {
    const b = c.body(NewUpload);
    svc.storage.check(b.kind, { mimetype: b.contentType, size: b.size, originalname: b.name });
    const ext = path.extname(b.name).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const key = `uploads/${c.uid}/${randomUUID()}${ext}`;
    return { key, ...(await svc.storage.uploadUrl(key, b.contentType, b.kind)) };
  });
}

/** the file a route was given: attached to a small request, or waiting in Storage under `${field}Key` */
export async function takeUpload(c: Call, field: string): Promise<Upload | undefined> {
  const attached = c.file(field);
  if (attached) return attached;
  const key = (c.json as Record<string, unknown> | undefined)?.[`${field}Key`];
  if (typeof key !== 'string' || !key) return undefined;
  if (!key.startsWith(`uploads/${c.uid}/`)) throw new AppError('FORBIDDEN', 'You do not have access to this', 403);
  const name = (c.json as Record<string, unknown>)[`${field}Name`];
  const buffer = await svc.storage.read(key).catch(() => {
    throw new AppError('NO_FILE', 'The upload did not arrive. Please try again.', 422);
  });
  await svc.storage.remove(key);
  const originalname = typeof name === 'string' && name ? name : path.basename(key);
  return { fieldname: field, originalname, mimetype: mimeOf(originalname), size: buffer.length, buffer };
}

const TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic' };
const mimeOf = (name: string) => TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
