import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { AppError, notFound } from '../../common/errors';
import { Zod, zDate, zTime, IdPipe } from '../../common/zod';
import { col } from '../../db/paths';
import { PersonalEvent } from '../../db/models';
import { F, getDoc, getRows } from '../../db/store';
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
    private readonly ai: AiScanService,
    private readonly storage: StorageService,
  ) {}

  private view(e: PersonalEvent) {
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

  /** the user's events, by date and time */
  private async live(userId: string) {
    const rows = await getRows<PersonalEvent>(col.events(userId).where('deletedAt', '==', null));
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  }

  private async mine(userId: string, id: string) {
    const e = await getDoc<PersonalEvent>(col.events(userId).doc(id));
    if (!e || e.deletedAt) throw notFound('Event');
    return e;
  }

  @Get()
  async list(@CurrentUser() u: UserClaims, @Query(new Zod(Range)) q: z.infer<typeof Range>) {
    const rows = (await this.live(u.sub)).filter((e) => e.date >= q.from && e.date < q.to);
    return rows.map((r) => this.view(r));
  }

  /** every event, newest first — the Event log screen */
  @Get('log')
  async log(@CurrentUser() u: UserClaims) {
    return (await this.live(u.sub)).map((r) => this.view(r));
  }

  @Post()
  async create(@CurrentUser() u: UserClaims, @Body(new Zod(EventIn)) b: z.infer<typeof EventIn>) {
    const ref = col.events(u.sub).doc();
    await ref.set({
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
        imageUrl: null,
        ownWedding: b.type === 'Wedding' && b.functions?.length ? { functions: b.functions.map((f) => ({ ...f, time: f.time || '' })) } : null,
        createdAt: F.now(),
        updatedAt: F.now(),
        deletedAt: null,
      });
    return this.view((await getDoc<PersonalEvent>(ref))!);
  }

  @Patch(':id')
  async update(@CurrentUser() u: UserClaims, @Param('id', IdPipe) id: string, @Body(new Zod(EventIn.partial())) b: Partial<z.infer<typeof EventIn>>) {
    const { functions, ...rest } = b;
    await this.mine(u.sub, id);
    const set: Record<string, unknown> = { ...rest, updatedAt: F.now() };
    if (functions) set.ownWedding = functions.length ? { functions: functions.map((f) => ({ ...f, time: f.time || '' })) } : null;
    await col.events(u.sub).doc(id).update(set);
    return this.view(await this.mine(u.sub, id));
  }

  @Delete(':id')
  async remove(@CurrentUser() u: UserClaims, @Param('id', IdPipe) id: string) {
    await this.mine(u.sub, id);
    await col.events(u.sub).doc(id).update({ deletedAt: F.now() });
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
      await col.aiScans(u.sub).doc().set({ userId: u.sub, imageKey: s.key, status: 'done', result, error: null, createdAt: F.now() });
      return result;
    } catch (e) {
      await col.aiScans(u.sub).doc().set({ userId: u.sub, imageKey: '', status: 'failed', result: null, error: (e as Error).message, createdAt: F.now() });
      throw e;
    }
  }
}
