import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { env } from '../../config/env';
import { RSVP_LEAD_MS } from '../../common/time';

/** public settings the app reads on launch — nothing secret here */
@ApiTags('config')
@Controller('v1/config')
export class ConfigController {
  @Get()
  get() {
    return {
      minAppVersion: '1.0.0',
      teamWhatsapp: env().TEAM_WHATSAPP,
      rsvpLeadHours: RSVP_LEAD_MS / 3600_000,
      aiScan: !!env().ANTHROPIC_API_KEY,
      languages: [
        { id: 'en', label: 'English' },
        { id: 'hi', label: 'हिन्दी' },
        { id: 'ta', label: 'தமிழ்' },
        { id: 'gu', label: 'ગુજરાતી' },
      ],
      countries: [
        { cc: '+91', flag: '🇮🇳', len: 10 },
        { cc: '+971', flag: '🇦🇪', len: 9 },
        { cc: '+44', flag: '🇬🇧', len: 10 },
        { cc: '+1', flag: '🇺🇸', len: 10 },
        { cc: '+65', flag: '🇸🇬', len: 8 },
        { cc: '+61', flag: '🇦🇺', len: 9 },
      ],
    };
  }

  @Get('health')
  health() {
    return { ok: true, time: new Date().toISOString() };
  }
}
