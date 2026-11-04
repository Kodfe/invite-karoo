import { z } from 'zod';
import type { UserClaims } from '../../common/auth';
import { AppError, conflict } from '../../common/app-error';
import { parse, zDate } from '../../common/zod';
import { col } from '../../db/paths';
import { Application, User } from '../../db/models';
import { F, getDoc, getRows } from '../../db/store';
import { routes } from '../../common/http';
import { svc } from '../../services';

const AppData = z
  .object({
    brideName: z.string().trim().min(2, 'Enter the bride’s name').max(60),
    brideParents: z.string().trim().max(80).default(''),
    groomName: z.string().trim().min(2, 'Enter the groom’s name').max(60),
    groomParents: z.string().trim().max(80).default(''),
    brideFamily: z.string().trim().max(60).default(''),
    brideElders: z.string().trim().max(200).default(''),
    groomFamily: z.string().trim().max(60).default(''),
    groomElders: z.string().trim().max(200).default(''),
    city: z.string().trim().min(2, 'Enter the city').max(40),
    startDate: zDate,
    endDate: zDate,
    datesLocked: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.endDate < d.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The last day is before the first day' });
    const days = (Date.parse(d.endDate) - Date.parse(d.startDate)) / 86400_000;
    if (days > 30) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'That is more than a month. Check the dates.' });
  });
const Multipart = z.object({ data: z.string().min(2) });

async function ofUser(u: UserClaims) {
  const [a, b] = await Promise.all([
    getRows<Application>(col.applications().where('userId', '==', u.sub)),
    getRows<Application>(col.applications().where('phone', '==', u.phone)),
  ]);
  const m = new Map([...a, ...b].map((x) => [x.id, x]));
  return [...m.values()].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
}

/** "Host a wedding": the one-time application the Invite Karoo team turns into a console */
export function applicationRoutes() {
  const r = routes('/v1/host-applications');

  /** the ready-made guest-list workbook */
  r.get('template', async (c) => {
    const buf = await svc.sheets.template();
    c.send(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'attachment; filename="invite-karoo-guest-list.xlsx"');
  });

  /** check a filled sheet before submitting — returns the same report the team will see */
  r.post('check-sheet', async (c) => {
    const f = c.file('guests');
    if (!f) throw new AppError('NO_FILE', 'Choose the guest list file first');
    svc.storage.check('sheet', f);
    const parsed = svc.sheets.parse(await svc.sheets.read(f.buffer, f.originalname));
    return { report: parsed.report, functions: parsed.functions, wedding: parsed.wedding };
  }, { files: ['guests'] });

  r.get('mine', async (c) => (await ofUser(c.user)).map((a) => ({ id: a.id, status: a.status, data: a.data, createdAt: a.createdAt, guestReport: a.guestReport })));

  /** multipart: `data` = JSON of the form, optional files `guests` (sheet) and `card` (PDF) */
  r.post('', async (c) => {
    const body = c.body(Multipart);
    let raw: unknown;
    try {
      raw = JSON.parse(body.data);
    } catch {
      throw new AppError('VALIDATION', 'The form could not be read', 422);
    }
    const data = parse(AppData, raw);
    const open = (await ofUser(c.user)).some((a) => a.status === 'new' || a.status === 'in_setup');
    if (open) throw conflict('APPLICATION_OPEN', 'You already have an application with our team. We will message you on WhatsApp.');
    const me = (await getDoc<User>(col.users().doc(c.uid)))!;

    let guestFile = null;
    let guestReport = null;
    const g = c.file('guests');
    if (g) {
      svc.storage.check('sheet', g);
      guestReport = svc.sheets.parse(await svc.sheets.read(g.buffer, g.originalname)).report;
      const s = await svc.storage.put(`applications/${c.uid}`, g);
      guestFile = { key: s.key, name: s.name, size: s.size };
    }
    let cardFile = null;
    const card = c.file('card');
    if (card) {
      svc.storage.check('pdf', card);
      const s = await svc.storage.put(`applications/${c.uid}`, card);
      cardFile = { key: s.key, name: s.name, size: s.size };
    }
    const ref = col.applications().doc();
    await ref.set({
      userId: c.uid, phone: me.phone, status: 'new', data, guestFile, guestReport, cardFile,
      weddingId: null, assignedTo: null, adminNotes: null, createdAt: F.now(), updatedAt: F.now(),
    });
    return { id: ref.id, status: 'new', guestReport };
  }, { files: ['guests', 'card'] });
}
