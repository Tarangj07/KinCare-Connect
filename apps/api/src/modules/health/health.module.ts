import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationService } from '../auth/authorization.service';
import { MeasurementService } from './services/measurement.service';

import { HealthController } from './health.controller';
import { HealthMeasurementController } from './measurement.controller';

@Module({
  imports: [AuthModule],
  providers: [MeasurementService, AuthorizationService],
  controllers: [HealthController, HealthMeasurementController],
})
export class HealthModule {}
