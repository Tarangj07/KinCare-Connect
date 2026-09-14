import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './database/prisma.module';
import { AppointmentModule } from './modules/appointments/appointment.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { FeedModule } from './modules/feed/feed.module';
import { HealthModule } from './modules/health/health.module';
import { MedicationModule } from './modules/medications/medication.module';
import { MessagingModule } from './modules/messaging/messaging.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env['JWT_ACCESS_SECRET'] ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '15m' },
    }),
    AuthModule,
    HealthModule,
    AppointmentModule,
    NotificationModule,
    FeedModule,
    MedicationModule,
    MessagingModule,
  ],
})
export class AppModule {}
