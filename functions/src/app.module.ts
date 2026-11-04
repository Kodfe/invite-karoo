import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './config/env';
import { InfraModule } from './modules/infra/infra.module';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { MeController } from './modules/me/me.controller';
import { MeService } from './modules/me/me.service';
import { GuestController } from './modules/guest/guest.controller';
import { GuestService } from './modules/guest/guest.service';
import { HostController } from './modules/host/host.controller';
import { HostService } from './modules/host/host.service';
import { HostAccessService } from './modules/host/host-access.service';
import { BlastService } from './modules/host/blast.service';
import { SheetService } from './modules/sheets/sheet.service';
import { ApplicationsController } from './modules/applications/applications.controller';
import { EventsController } from './modules/events/events.controller';
import { AiScanService } from './modules/events/ai-scan.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { SupportController } from './modules/support/support.controller';
import { RemindersService } from './modules/reminders/reminders.service';
import { ConfigController } from './modules/config/config.controller';

const isTest = env().NODE_ENV === 'test';

@Module({
  imports: [
    InfraModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: isTest ? 100_000 : 300 }]),
  ],
  controllers: [
    ConfigController,
    AuthController,
    MeController,
    GuestController,
    HostController,
    ApplicationsController,
    EventsController,
    NotificationsController,
    SupportController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AuthService,
    MeService,
    GuestService,
    HostService,
    HostAccessService,
    BlastService,
    SheetService,
    AiScanService,
    RemindersService,
  ],
})
export class AppModule {}
