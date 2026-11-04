/** The API's services, built once and shared. */
import { AuthService } from './modules/auth/auth.service';
import { AiScanService } from './modules/events/ai-scan.service';
import { GuestService } from './modules/guest/guest.service';
import { BlastService } from './modules/host/blast.service';
import { HostAccessService } from './modules/host/host-access.service';
import { HostService } from './modules/host/host.service';
import { AuditService } from './modules/infra/audit.service';
import { NotificationsService } from './modules/infra/notifications.service';
import { PushService } from './modules/infra/push.service';
import { StorageService } from './modules/infra/storage.service';
import { WhatsappService } from './modules/infra/whatsapp.service';
import { MeService } from './modules/me/me.service';
import { RemindersService } from './modules/reminders/reminders.service';
import { SheetService } from './modules/sheets/sheet.service';

const whatsapp = new WhatsappService();
const push = new PushService();
const notifications = new NotificationsService(push);
const audit = new AuditService();
const access = new HostAccessService();
const me = new MeService();

export const svc = {
  whatsapp,
  push,
  notifications,
  audit,
  access,
  me,
  storage: new StorageService(),
  sheets: new SheetService(),
  ai: new AiScanService(),
  guest: new GuestService(),
  auth: new AuthService(whatsapp, me),
  host: new HostService(access, notifications, audit),
  blasts: new BlastService(access, whatsapp, notifications),
  reminders: new RemindersService(notifications, me),
};
