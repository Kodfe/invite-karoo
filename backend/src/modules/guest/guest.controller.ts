import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, UserClaims, UserGuard } from '../../common/auth';
import { Zod, zDate } from '../../common/zod';
import { StorageService } from '../infra/storage.service';
import { GuestService } from './guest.service';

const Rsvp = z.object({
  rsvp: z.enum(['going', 'not_going', 'maybe']),
  pax: z.number().int().min(0).max(20).default(1),
});
const Reminders = z.object({
  offDefaults: z.array(z.number().int()).max(6).default([]),
  mine: z.array(z.number().int()).max(6).default([]),
});
const Range = z.object({ from: zDate, to: zDate });

@ApiTags('guest')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('v1')
export class GuestController {
  constructor(
    private readonly guest: GuestService,
    private readonly storage: StorageService,
  ) {}

  /** the Invites list behind the Home card */
  @Get('invitations')
  invitations(@CurrentUser() u: UserClaims, @Query('finished') finished?: string) {
    return this.guest.invitations(u.sub, finished === '1' || finished === 'true');
  }

  /** wedding functions between two dates (inclusive from, exclusive to) — for the agenda */
  @Get('invitations/agenda')
  agenda(@CurrentUser() u: UserClaims, @Query(new Zod(Range)) q: z.infer<typeof Range>) {
    return this.guest.agenda(u.sub, new Date(q.from + 'T00:00:00+05:30'), new Date(q.to + 'T00:00:00+05:30'));
  }

  @Get('weddings/:wid')
  wedding(@CurrentUser() u: UserClaims, @Param('wid', ParseUUIDPipe) wid: string) {
    return this.guest.wedding(u.sub, wid);
  }

  @Get('weddings/:wid/card.pdf')
  async card(@CurrentUser() u: UserClaims, @Param('wid', ParseUUIDPipe) wid: string, @Res() res: Response) {
    const card = await this.guest.cardKey(u.sub, wid);
    const buf = await this.storage.read(card.key);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${card.name.replace(/"/g, '')}"`);
    res.send(buf);
  }

  @Get('weddings/:wid/qr')
  qr(@CurrentUser() u: UserClaims, @Param('wid', ParseUUIDPipe) wid: string) {
    return this.guest.qr(u.sub, wid);
  }

  @Get('weddings/:wid/functions/:fid')
  fn(@CurrentUser() u: UserClaims, @Param('wid', ParseUUIDPipe) wid: string, @Param('fid', ParseUUIDPipe) fid: string) {
    return this.guest.fn(u.sub, wid, fid);
  }

  /** send my reply — the only call that tells the hosts anything */
  @Post('weddings/:wid/functions/:fid/rsvp')
  rsvp(
    @CurrentUser() u: UserClaims,
    @Param('wid', ParseUUIDPipe) wid: string,
    @Param('fid', ParseUUIDPipe) fid: string,
    @Body(new Zod(Rsvp)) b: z.infer<typeof Rsvp>,
  ) {
    return this.guest.rsvp(u.sub, wid, fid, b.rsvp, b.pax);
  }

  /** my private reminders on this function (minutes before start) */
  @Put('weddings/:wid/functions/:fid/reminders')
  reminders(
    @CurrentUser() u: UserClaims,
    @Param('wid', ParseUUIDPipe) wid: string,
    @Param('fid', ParseUUIDPipe) fid: string,
    @Body(new Zod(Reminders)) b: z.infer<typeof Reminders>,
  ) {
    return this.guest.setReminders(u.sub, wid, fid, b.offDefaults, b.mine);
  }
}
