import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { AuthorizationService } from '../../auth/authorization.service';
import { PrismaModule } from '../../database/prisma.module';

import { MedicationController } from './medication.controller';
import { MedicationService } from './services/medication.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MedicationController],
  providers: [MedicationService, AuthorizationService],
  exports: [MedicationService],
})
export class MedicationModule {}
