import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { AppError, notFound } from '../../common/errors';
import { Zod, zUuid } from '../../common/zod';
import { DB, InjectDb } from '../../db/db';
import { ticketMessages, tickets } from '../../db/schema';

const NewTicket = z.object({
  subject: z.string().trim().min(4, 'Say in a few words what it is about').max(100),
  category: z.enum(['invitation', 'rsvp', 'hosting', 'account', 'app', 'general']).default('general'),
  body: z.string().trim().min(5, 'Tell us a little more').max(2000),
  weddingId: zUuid.optional(),
});
const Reply = z.object({ body: z.string().trim().min(1).max(2000) });

export function ticketView(t: typeof tickets.$inferSelect) {
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

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1/tickets')
export class SupportController {
  constructor(@InjectDb() private readonly db: DB) {}

  @Get()
  async list(@CurrentUser() u: UserClaims) {
    const rows = await this.db.select().from(tickets).where(eq(tickets.userId, u.sub)).orderBy(desc(tickets.updatedAt));
    const last = rows.length
      ? await this.db.execute<{ ticket_id: string; body: string }>(sql`
          select distinct on (ticket_id) ticket_id, body from ticket_messages
          where ticket_id in (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
          order by ticket_id, created_at desc`)
      : { rows: [] };
    return rows.map((t) => ({ ...ticketView(t), lastMessage: last.rows.find((m) => m.ticket_id === t.id)?.body ?? '' }));
  }

  @Post()
  async create(@CurrentUser() u: UserClaims, @Body(new Zod(NewTicket)) b: z.infer<typeof NewTicket>) {
    const t = await this.db.transaction(async (tx) => {
      const [t] = await tx.insert(tickets).values({ userId: u.sub, subject: b.subject, category: b.category, weddingId: b.weddingId }).returning();
      await tx.insert(ticketMessages).values({ ticketId: t.id, author: 'user', body: b.body });
      return t;
    });
    return ticketView(t);
  }

  @Get(':id')
  async get(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string) {
    const [t] = await this.db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.userId, u.sub))).limit(1);
    if (!t) throw notFound('Ticket');
    if (t.unreadForUser) await this.db.update(tickets).set({ unreadForUser: 0 }).where(eq(tickets.id, t.id));
    const msgs = await this.db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id)).orderBy(asc(ticketMessages.createdAt));
    return { ...ticketView({ ...t, unreadForUser: 0 }), messages: msgs.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt })) };
  }

  @Post(':id/messages')
  async reply(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Reply)) b: z.infer<typeof Reply>) {
    const [t] = await this.db.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.userId, u.sub))).limit(1);
    if (!t) throw notFound('Ticket');
    if (t.status === 'closed') throw new AppError('TICKET_CLOSED', 'This ticket is closed. Open a new one if you still need help.', 409);
    await this.db.insert(ticketMessages).values({ ticketId: t.id, author: 'user', body: b.body });
    await this.db
      .update(tickets)
      .set({ status: 'open', unreadForTeam: t.unreadForTeam + 1, updatedAt: new Date() })
      .where(eq(tickets.id, t.id));
    return this.get(u, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  async close(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string) {
    const [t] = await this.db
      .update(tickets)
      .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tickets.id, id), eq(tickets.userId, u.sub)))
      .returning();
    if (!t) throw notFound('Ticket');
    return ticketView(t);
  }
}
