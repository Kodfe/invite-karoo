import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { StorageService } from './storage.service';
import { WhatsappService } from './whatsapp.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [
    WhatsappService,
    PushService,
    // these classes are plain (the team functions use them too), so Nest is told how to build this one
    { provide: NotificationsService, useFactory: (push: PushService) => new NotificationsService(push), inject: [PushService] },
    StorageService,
    AuditService,
  ],
  exports: [WhatsappService, PushService, NotificationsService, StorageService, AuditService],
})
export class InfraModule {}
