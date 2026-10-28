import { Body, Controller, Get, Post, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { AppError, conflict } from '../../common/errors';
import { Zod, zDate } from '../../common/zod';
import { DB, InjectDb } from '../../db/db';
import { hostApplications, users } from '../../db/schema';
import { StorageService } from '../infra/storage.service';
import { SheetService } from '../sheets/sheet.service';

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

type Files = { guests?: Express.Multer.File[]; card?: Express.Multer.File[] };

/** "Host a wedding": the one-time application the Invite Karoo team turns into a console */
@ApiTags('host-application')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1/host-applications')
export class ApplicationsController {
  constructor(
    @InjectDb() private readonly db: DB,
    private readonly sheets: SheetService,
    private readonly storage: StorageService,
  ) {}

  /** the ready-made guest-list workbook */
  @Get('template')
  async template(@Res() res: Response) {
    const buf = await this.sheets.template();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="invite-karoo-guest-list.xlsx"');
    res.send(buf);
  }

  /** check a filled sheet before submitting — returns the same report the team will see */
  @Post('check-sheet')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'guests', maxCount: 1 }]))
  async check(@UploadedFiles() files: Files) {
    const f = files?.guests?.[0];
    if (!f) throw new AppError('NO_FILE', 'Choose the guest list file first');
    this.storage.check('sheet', f);
    const parsed = this.sheets.parse(await this.sheets.read(f.buffer, f.originalname));
    return { report: parsed.report, functions: parsed.functions, wedding: parsed.wedding };
  }

  @Get('mine')
  async mine(@CurrentUser() u: UserClaims) {
    return this.db
      .select({ id: hostApplications.id, status: hostApplications.status, data: hostApplications.data, createdAt: hostApplications.createdAt, guestReport: hostApplications.guestReport })
      .from(hostApplications)
      .where(or(eq(hostApplications.userId, u.sub), eq(hostApplications.phone, u.phone)))
      .orderBy(desc(hostApplications.createdAt));
  }

  /** multipart: `data` = JSON of the form, optional files `guests` (sheet) and `card` (PDF) */
  @Post()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'guests', maxCount: 1 }, { name: 'card', maxCount: 1 }]))
  async submit(@CurrentUser() u: UserClaims, @Body(new Zod(Multipart)) body: z.infer<typeof Multipart>, @UploadedFiles() files: Files) {
    let raw: unknown;
    try {
      raw = JSON.parse(body.data);
    } catch {
      throw new AppError('VALIDATION', 'The form could not be read', 422);
    }
    const data = new Zod(AppData).transform(raw);
    const [open] = await this.db
      .select({ id: hostApplications.id })
      .from(hostApplications)
      .where(and(or(eq(hostApplications.userId, u.sub), eq(hostApplications.phone, u.phone)), inArray(hostApplications.status, ['new', 'in_setup'])))
      .limit(1);
    if (open) throw conflict('APPLICATION_OPEN', 'You already have an application with our team. We will message you on WhatsApp.');
    const [me] = await this.db.select().from(users).where(eq(users.id, u.sub)).limit(1);

    let guestFile = null;
    let guestReport = null;
    const g = files?.guests?.[0];
    if (g) {
      this.storage.check('sheet', g);
      guestReport = this.sheets.parse(await this.sheets.read(g.buffer, g.originalname)).report;
      const s = await this.storage.put(`applications/${u.sub}`, g);
      guestFile = { key: s.key, name: s.name, size: s.size };
    }
    let cardFile = null;
    const c = files?.card?.[0];
    if (c) {
      this.storage.check('pdf', c);
      const s = await this.storage.put(`applications/${u.sub}`, c);
      cardFile = { key: s.key, name: s.name, size: s.size };
    }
    const [row] = await this.db
      .insert(hostApplications)
      .values({ userId: u.sub, phone: me.phone, data, guestFile, guestReport, cardFile })
      .returning();
    return { id: row.id, status: row.status, guestReport };
  }
}
