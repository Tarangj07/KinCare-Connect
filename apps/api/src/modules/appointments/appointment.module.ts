import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { AuthorizationService } from '../auth/authorization.service';
import { AppointmentService } from './services/appointment.service';
import { AppointmentController } from './appointment.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AppointmentController],
  providers: [AppointmentService, AuthorizationService],
  exports: [AppointmentService],
})
export class AppointmentModule {}
