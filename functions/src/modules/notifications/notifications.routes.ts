import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { notFound } from '../../common/app-error';
import { col } from '../../db/paths';
import { Notification } from '../../db/models';
import { getDoc, getRows, writeAll } from '../../db/store';
import { routes } from '../../common/http';

const List = z.object({
  cat: z.enum(['inv', 'rem', 'host', 'sys']).optional(),
  unread: z.enum(['1', '0']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

async function mark(userId: string, id: string, read: boolean) {
  const ref = col.notifications(userId).doc(id);
  if (!(await getDoc(ref))) throw notFound('Notification');
  await ref.update({ read });
  return { ok: true };
}

export function notificationRoutes() {
  const r = routes('/v1/notifications');

  r.get('', async (c) => {
    const q = c.query(List);
    let query = col.notifications(c.uid).orderBy('createdAt', 'desc');
    if (q.cat) query = col.notifications(c.uid).where('cat', '==', q.cat).orderBy('createdAt', 'desc');
    if (q.unread === '1') query = (q.cat ? col.notifications(c.uid).where('cat', '==', q.cat) : col.notifications(c.uid)).where('read', '==', false).orderBy('createdAt', 'desc');
    const rows = await getRows<Notification>(query.offset(q.offset).limit(q.limit));
    const unread = (await col.notifications(c.uid).where('read', '==', false).count().get()).data().count;
    return {
      unread,
      items: rows.map((r) => ({ id: r.id, cat: r.cat, title: r.title, body: r.body, long: r.long, art: r.art, action: r.action, read: r.read, createdAt: r.createdAt })),
    };
  });

  r.post('read-all', async (c) => {
    const rows = await getRows(col.notifications(c.uid).where('read', '==', false));
    await writeAll(rows.map((r) => (b) => b.update(col.notifications(c.uid).doc(r.id), { read: true })));
    return { ok: true };
  }, { status: 200 });

  r.post(':id/read', (c) => mark(c.uid, c.id('id'), true), { status: 200 });

  r.post(':id/unread', (c) => mark(c.uid, c.id('id'), false), { status: 200 });
}
