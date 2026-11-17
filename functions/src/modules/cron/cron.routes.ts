import { AppError } from '../../common/app-error';
import { safeEqual } from '../../common/crypto';
import { routes } from '../../common/http';
import { env } from '../../config/env';
import { svc } from '../../services';

/** Vercel Cron calls this every minute (vercel.json), sending CRON_SECRET as a bearer token */
export function cronRoutes() {
  const r = routes('/v1/cron', { signedIn: false });

  r.get('minute', async (c) => {
    const secret = env().CRON_SECRET;
    if (!secret || !safeEqual(c.authorization ?? '', `Bearer ${secret}`)) throw new AppError('UNAUTHORIZED', 'Sign in to continue', 401);
    const reminders = await svc.reminders.tick();
    // anything queued that did not finish straight after it was sent
    await svc.blasts.processQueued();
    return { ok: true, reminders };
  });
}
