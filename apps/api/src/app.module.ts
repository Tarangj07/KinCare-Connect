import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ACCESS_TOKEN_TTL_SECONDS, resolveJwtAccessSecret } from './config/security-config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './database/prisma.module';
import { AppointmentModule } from './modules/appointments/appointment.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { FeedModule } from './modules/feed/feed.module';
import { HealthModule } from './modules/health/health.module';
import { MedicationModule } from './modules/medications/medication.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmergencyModule } from './modules/emergency/emergency.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: resolveJwtAccessSecret(),
      // Phase 24 (D-2): the same constant `JwtAuthGuard` verifies against, so
      // issuance and verification cannot drift apart.
      signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    }),
    AuthModule,
    HealthModule,
    AppointmentModule,
    NotificationModule,
    FeedModule,
    MedicationModule,
    MessagingModule,
    StorageModule,
    DocumentsModule,
    EmergencyModule,
  ],
})
export class AppModule {}
