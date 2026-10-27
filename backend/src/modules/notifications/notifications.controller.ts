import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { notFound } from '../../common/errors';
import { Zod } from '../../common/zod';
import { DB, InjectDb } from '../../db/db';
import { notifications } from '../../db/schema';

const List = z.object({
  cat: z.enum(['inv', 'rem', 'host', 'sys']).optional(),
  unread: z.enum(['1', '0']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1/notifications')
export class NotificationsController {
  constructor(@InjectDb() private readonly db: DB) {}

  @Get()
  async list(@CurrentUser() u: UserClaims, @Query(new Zod(List)) q: z.infer<typeof List>) {
    const where = and(
      eq(notifications.userId, u.sub),
      q.cat ? eq(notifications.cat, q.cat) : undefined,
      q.unread === '1' ? eq(notifications.read, false) : undefined,
    );
    const rows = await this.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.limit).offset(q.offset);
    const [{ n: unread }] = await this.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, u.sub), eq(notifications.read, false)));
    return {
      unread,
      items: rows.map((r) => ({ id: r.id, cat: r.cat, title: r.title, body: r.body, long: r.long, art: r.art, action: r.action, read: r.read, createdAt: r.createdAt })),
    };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: UserClaims) {
    await this.db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, u.sub), eq(notifications.read, false)));
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.mark(u.sub, id, true);
  }

  @Post(':id/unread')
  @HttpCode(200)
  unread(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.mark(u.sub, id, false);
  }

  private async mark(userId: string, id: string, read: boolean) {
    const [r] = await this.db.update(notifications).set({ read }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id });
    if (!r) throw notFound('Notification');
    return { ok: true };
  }
}
