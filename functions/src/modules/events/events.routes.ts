import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { AppError, notFound } from '../../common/app-error';
import { zDate, zTime } from '../../common/zod';
import { col } from '../../db/paths';
import { PersonalEvent } from '../../db/models';
import { F, getDoc, getRows } from '../../db/store';
import { routes } from '../../common/http';
import { svc } from '../../services';
import { takeUpload } from '../files/files.routes';

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

function view(e: PersonalEvent) {
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
async function live(userId: string) {
  const rows = await getRows<PersonalEvent>(col.events(userId).where('deletedAt', '==', null));
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

async function mine(userId: string, id: string) {
  const e = await getDoc<PersonalEvent>(col.events(userId).doc(id));
  if (!e || e.deletedAt) throw notFound('Event');
  return e;
}

/** the guest's own agenda: things they entered by hand or scanned. Never visible to any host. */
export function eventRoutes() {
  const r = routes('/v1/events');

  r.get('', async (c) => {
    const q = c.query(Range);
    const rows = (await live(c.uid)).filter((e) => e.date >= q.from && e.date < q.to);
    return rows.map((r) => view(r));
  });

  /** every event, newest first — the Event log screen */
  r.get('log', async (c) => (await live(c.uid)).map((r) => view(r)));

  r.post('', async (c) => {
    const b = c.body(EventIn);
    const ref = col.events(c.uid).doc();
    await ref.set({
        userId: c.uid,
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
    return view((await getDoc<PersonalEvent>(ref))!);
  });

  r.patch(':id', async (c) => {
    const { functions, ...rest } = c.body(EventIn.partial());
    await mine(c.uid, c.id('id'));
    const set: Record<string, unknown> = { ...rest, updatedAt: F.now() };
    if (functions) set.ownWedding = functions.length ? { functions: functions.map((f) => ({ ...f, time: f.time || '' })) } : null;
    await col.events(c.uid).doc(c.id('id')).update(set);
    return view(await mine(c.uid, c.id('id')));
  });

  r.delete(':id', async (c) => {
    await mine(c.uid, c.id('id'));
    await col.events(c.uid).doc(c.id('id')).update({ deletedAt: F.now() });
    return { ok: true };
  });

  /** read an invitation card with AI. Nothing is saved until the guest checks it and POSTs /events. */
  r.post('scan', async (c) => {
    const file = await takeUpload(c, 'file');
    if (!file) throw new AppError('NO_FILE', 'Take or choose a photo of the card first');
    if (file.size > 10 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'The photo is too large (max 10 MB)', 413);
    try {
      const result = await svc.ai.scan(file);
      const s = await svc.storage.put(`scans/${c.uid}`, file);
      await col.aiScans(c.uid).doc().set({ userId: c.uid, imageKey: s.key, status: 'done', result, error: null, createdAt: F.now() });
      return result;
    } catch (e) {
      await col.aiScans(c.uid).doc().set({ userId: c.uid, imageKey: '', status: 'failed', result: null, error: (e as Error).message, createdAt: F.now() });
      throw e;
    }
  }, { files: ['file'] });
}
