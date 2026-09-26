import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../database/prisma.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './services/messaging.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
