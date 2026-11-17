import { env } from '../../config/env';
import { RSVP_LEAD_MS } from '../../common/time';
import { routes } from '../../common/http';

/** public settings the app reads on launch — nothing secret here */
export function configRoutes() {
  const r = routes('/v1/config', { signedIn: false });

  r.get('', () => {
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
  });

  r.get('health', () => ({ ok: true, time: new Date().toISOString() }));
}
