import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { NotificationService } from './services/notification.service';
import { NotificationController } from './notification.controller';
import { NotificationPreferenceController } from './preference.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationController, NotificationPreferenceController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
