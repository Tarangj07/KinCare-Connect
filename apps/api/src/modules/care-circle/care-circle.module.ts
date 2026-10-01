import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../database/prisma.module';

import { CareCircleController } from './care-circle.controller';
import { MeController } from './me.controller';
import { SeniorsController } from './seniors.controller';
import { CareCircleService } from './services/care-circle.service';
import { SeniorService } from './services/senior.service';

/**
 * Phase 49 — senior access foundation.
 *
 * `AuthModule` is imported for `AuthorizationService`, which is what this
 * module reads to decide who may act on a senior. The new services never
 * substitute their own predicate for it.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SeniorsController, MeController, CareCircleController],
  providers: [SeniorService, CareCircleService],
  exports: [SeniorService, CareCircleService],
})
export class CareCircleModule {}