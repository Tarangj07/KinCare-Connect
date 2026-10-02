import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../database/prisma.module';
import { AuthorizationService } from '../../auth/authorization.service';
import { CareTaskService } from './services/care-task.service';
import { CareTaskController } from './care-tasks.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CareTaskController],
  providers: [CareTaskService, AuthorizationService],
  exports: [CareTaskService],
})
export class CareTasksModule {}
