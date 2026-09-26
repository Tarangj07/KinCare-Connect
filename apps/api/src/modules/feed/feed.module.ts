import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../database/prisma.module';
import { AuthorizationService } from '../../auth/authorization.service';
import { FeedService } from './services/feed.service';
import { FeedController } from './feed.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FeedController],
  providers: [FeedService, AuthorizationService],
  exports: [FeedService],
})
export class FeedModule {}
