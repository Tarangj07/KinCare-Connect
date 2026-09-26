import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationService } from '../../auth/authorization.service';
import { HealthMeasurementService } from './services/measurement.service';

import { HealthController } from './health.controller';
import { HealthMeasurementController } from './measurement.controller';

@Module({
  imports: [AuthModule],
  providers: [HealthMeasurementService, AuthorizationService],
  controllers: [HealthController, HealthMeasurementController],
})
export class HealthModule {}
