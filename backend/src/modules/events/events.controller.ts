import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { AppError, notFound } from '../../common/errors';
import { Zod, zDate, zTime } from '../../common/zod';
import { DB, InjectDb } from '../../db/db';
import { aiScans, personalEvents } from '../../db/schema';
import { StorageService } from '../infra/storage.service';
import { AiScanService } from './ai-scan.service';

const TYPES = ['Appointment', 'Personal', 'Meeting', 'Celebration', 'Wedding', 'Birthday', 'Other'] as const;
const OwnFn = z.object({
  name: z.string().trim().min(1).max(60),
  date: zDate,
  time: zTime.or(z.literal('')).default(''),
  venue: z.string().max(120).default(''),
  note: z.string().max(200).default(''),
  color: z.string().max(9).optional(),
});
const EventIn = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(80),
  type: z.enum(TYPES),
  date: zDate,
  time: zTime.nullable().default(null),
  venue: z.string().trim().max(120).default(''),
  city: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(500).default(''),
  icon: z.string().max(20).default('calendar'),
  source: z.enum(['manual', 'ai']).default('manual'),
  functions: z.array(OwnFn).max(15).optional(),
  reminders: z.array(z.number().int().min(5).max(20160)).max(4).default([120, 60, 30]),
});
const Range = z.object({ from: zDate, to: zDate });

/** the guest's own agenda: things they entered by hand or scanned. Never visible to any host. */
@ApiTags('events')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1/events')
export class EventsController {
  constructor(
    @InjectDb() private readonly db: DB,
    private readonly ai: AiScanService,
    private readonly storage: StorageService,
  ) {}

  private view(e: typeof personalEvents.$inferSelect) {
    return {
      id: e.id,
      title: e.title,
      type: e.type,
      date: e.date,
      time: e.time,
      allDay: !e.time,
      venue: e.venue,
      city: e.city,
      notes: e.notes,
      icon: e.icon,
      imageUrl: e.imageUrl,
      source: e.source,
      isWedding: !!e.ownWedding,
      functions: e.ownWedding?.functions ?? [],
      reminders: e.reminders,
      createdAt: e.createdAt,
    };
  }

  @Get()
  async list(@CurrentUser() u: UserClaims, @Query(new Zod(Range)) q: z.infer<typeof Range>) {
    const rows = await this.db
      .select()
      .from(personalEvents)
      .where(and(eq(personalEvents.userId, u.sub), isNull(personalEvents.deletedAt), gte(personalEvents.date, q.from), lt(personalEvents.date, q.to)))
      .orderBy(asc(personalEvents.date), asc(personalEvents.time));
    return rows.map((r) => this.view(r));
  }

  /** every event, newest first — the Event log screen */
  @Get('log')
  async log(@CurrentUser() u: UserClaims) {
    const rows = await this.db
      .select()
      .from(personalEvents)
      .where(and(eq(personalEvents.userId, u.sub), isNull(personalEvents.deletedAt)))
      .orderBy(asc(personalEvents.date));
    return rows.map((r) => this.view(r));
  }

  @Post()
  async create(@CurrentUser() u: UserClaims, @Body(new Zod(EventIn)) b: z.infer<typeof EventIn>) {
    const [row] = await this.db
      .insert(personalEvents)
      .values({
        userId: u.sub,
        title: b.title,
        type: b.type,
        date: b.date,
        time: b.time,
        venue: b.venue,
        city: b.city,
        notes: b.notes,
        icon: b.icon,
        source: b.source,
        reminders: b.reminders,
        ownWedding: b.type === 'Wedding' && b.functions?.length ? { functions: b.functions.map((f) => ({ ...f, time: f.time || '' })) } : null,
      })
      .returning();
    return this.view(row);
  }

  @Patch(':id')
  async update(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(EventIn.partial())) b: Partial<z.infer<typeof EventIn>>) {
    const { functions, ...rest } = b;
    const set: Partial<typeof personalEvents.$inferInsert> = { ...rest, updatedAt: new Date() };
    if (functions) set.ownWedding = functions.length ? { functions: functions.map((f) => ({ ...f, time: f.time || '' })) } : null;
    const [row] = await this.db
      .update(personalEvents)
      .set(set)
      .where(and(eq(personalEvents.id, id), eq(personalEvents.userId, u.sub), isNull(personalEvents.deletedAt)))
      .returning();
    if (!row) throw notFound('Event');
    return this.view(row);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: UserClaims, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db
      .update(personalEvents)
      .set({ deletedAt: new Date() })
      .where(and(eq(personalEvents.id, id), eq(personalEvents.userId, u.sub), isNull(personalEvents.deletedAt)))
      .returning();
    if (!row) throw notFound('Event');
    return { ok: true };
  }

  /** read an invitation card with AI. Nothing is saved until the guest checks it and POSTs /events. */
  @Post('scan')
  @UseInterceptors(FileInterceptor('file'))
  async scan(@CurrentUser() u: UserClaims, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError('NO_FILE', 'Take or choose a photo of the card first');
    if (file.size > 10 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'The photo is too large (max 10 MB)', 413);
    try {
      const result = await this.ai.scan(file);
      const s = await this.storage.put(`scans/${u.sub}`, file);
      await this.db.insert(aiScans).values({ userId: u.sub, imageKey: s.key, status: 'done', result });
      return result;
    } catch (e) {
      await this.db.insert(aiScans).values({ userId: u.sub, imageKey: '', status: 'failed', error: (e as Error).message });
      throw e;
    }
  }
}
