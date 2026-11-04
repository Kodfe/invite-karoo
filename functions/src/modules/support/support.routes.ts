import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { AppError, notFound } from '../../common/app-error';
import { zUuid } from '../../common/zod';
import { col } from '../../db/paths';
import { Ticket, TicketMessage } from '../../db/models';
import { data, db, F, getDoc, getRows } from '../../db/store';
import { routes } from '../../common/http';

const NewTicket = z.object({
  subject: z.string().trim().min(4, 'Say in a few words what it is about').max(100),
  category: z.enum(['invitation', 'rsvp', 'hosting', 'account', 'app', 'general']).default('general'),
  body: z.string().trim().min(5, 'Tell us a little more').max(2000),
  weddingId: zUuid.optional(),
});
const Reply = z.object({ body: z.string().trim().min(1).max(2000) });

export function ticketView(t: Ticket) {
  return {
    id: t.id,
    number: `IK-${String(t.number).padStart(5, '0')}`,
    subject: t.subject,
    category: t.category,
    status: t.status,
    weddingId: t.weddingId,
    unread: t.unreadForUser,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    closedAt: t.closedAt,
  };
}

async function mine(userId: string, id: string) {
  const t = await getDoc<Ticket>(col.tickets().doc(id));
  if (!t || t.userId !== userId) throw notFound('Ticket');
  return t;
}

async function messages(id: string) {
  return (await getRows<TicketMessage>(col.ticketMessages(id))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function ticketWithMessages(userId: string, id: string) {
  const t = await mine(userId, id);
  if (t.unreadForUser) await col.tickets().doc(t.id).update({ unreadForUser: 0 });
  const msgs = await messages(t.id);
  return { ...ticketView({ ...t, unreadForUser: 0 }), messages: msgs.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })) };
}

export function supportRoutes() {
  const r = routes('/v1/tickets');

  r.get('', async (c) => {
    const rows = (await getRows<Ticket>(col.tickets().where('userId', '==', c.uid))).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const last = await Promise.all(rows.map((t) => getRows<TicketMessage>(col.ticketMessages(t.id).orderBy('createdAt', 'desc').limit(1))));
    return rows.map((t, i) => ({ ...ticketView(t), lastMessage: last[i][0]?.body ?? '' }));
  });

  r.post('', async (c) => {
    const b = c.body(NewTicket);
    const ref = col.tickets().doc();
    await db().runTransaction(async (tx) => {
      const counter = col.counters().doc('tickets');
      const last = data<{ n: number }>(await tx.get(counter));
      const number = (last?.n ?? 0) + 1;
      tx.set(counter, { n: number });
      tx.set(ref, {
        number, userId: c.uid, subject: b.subject, category: b.category, weddingId: b.weddingId ?? null,
        status: 'open', unreadForUser: 0, unreadForTeam: 1, createdAt: F.now(), updatedAt: F.now(), closedAt: null,
      });
      tx.set(col.ticketMessages(ref.id).doc(), { ticketId: ref.id, author: 'user', adminId: null, body: b.body, createdAt: F.now() });
    });
    return ticketView((await getDoc<Ticket>(ref))!);
  });

  r.get(':id', (c) => ticketWithMessages(c.uid, c.id('id')));

  r.post(':id/messages', async (c) => {
    const t = await mine(c.uid, c.id('id'));
    if (t.status === 'closed') throw new AppError('TICKET_CLOSED', 'This ticket is closed. Open a new one if you still need help.', 409);
    const batch = db().batch();
    batch.set(col.ticketMessages(t.id).doc(), { ticketId: t.id, author: 'user', adminId: null, body: c.body(Reply).body, createdAt: F.now() });
    batch.update(col.tickets().doc(t.id), { status: 'open', unreadForTeam: F.inc(1), updatedAt: F.now() });
    await batch.commit();
    return ticketWithMessages(c.uid, t.id);
  });

  r.post(':id/close', async (c) => {
    await mine(c.uid, c.id('id'));
    await col.tickets().doc(c.id('id')).update({ status: 'closed', closedAt: F.now(), updatedAt: F.now() });
    return ticketView((await getDoc<Ticket>(col.tickets().doc(c.id('id'))))!);
  }, { status: 200 });
}
