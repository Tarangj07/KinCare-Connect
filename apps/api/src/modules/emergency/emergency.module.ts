import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../database/prisma.module';
import { NotificationModule } from '../notifications/notification.module';
import { EmergencyService } from './services/emergency.service';
import { EmergencyController } from './emergency.controller';

@Module({
  imports: [PrismaModule, AuthModule, NotificationModule],
  controllers: [EmergencyController],
  providers: [EmergencyService],
})
export class EmergencyModule {}
