import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { StorageService } from './storage.service';
import { WhatsappService } from './whatsapp.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [WhatsappService, PushService, NotificationsService, StorageService, AuditService],
  exports: [WhatsappService, PushService, NotificationsService, StorageService, AuditService],
})
export class InfraModule {}
