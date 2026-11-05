import 'dotenv/config';
import { createServer } from 'node:http';
import { handle } from './common/http';
import { env } from './config/env';
import { applicationRoutes } from './modules/applications/applications.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { configRoutes } from './modules/config/config.routes';
import { cronRoutes } from './modules/cron/cron.routes';
import { eventRoutes } from './modules/events/events.routes';
import { guestRoutes } from './modules/guest/guest.routes';
import { hostRoutes } from './modules/host/host.routes';
import { meRoutes } from './modules/me/me.routes';
import { notificationRoutes } from './modules/notifications/notifications.routes';
import { supportRoutes } from './modules/support/support.routes';
import { uploadRoutes } from './modules/files/files.routes';
import { teamRoutes } from './team/team.routes';

configRoutes();
authRoutes();
meRoutes();
guestRoutes();
hostRoutes();
applicationRoutes();
eventRoutes();
notificationRoutes();
supportRoutes();
uploadRoutes();
teamRoutes();
cronRoutes();

/** the API. api/index.ts hands it to Vercel; `createServer(handle)` runs it anywhere else. */
export { handle };

/** local run outside Cloud Functions: npm run dev */
if (require.main === module) {
  createServer(handle).listen(env().PORT, '0.0.0.0', () => console.log(`Invite Karoo API on :${env().PORT} (${env().NODE_ENV})`));
}
