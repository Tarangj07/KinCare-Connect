import {
  Body, Controller, Delete, ForbiddenException, Get, NotFoundException,
  Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthorizationService } from '../../auth/authorization.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/create-appointment.dto';
import { AppointmentService } from './services/appointment.service';

@Controller('seniors/:seniorId/appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentController {
  constructor(
    private readonly appointmentService: AppointmentService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private async assertAccess(req: Request, seniorId: string): Promise<void> {
    const user = (req as Request & { user?: { sub?: string } }).user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
  }

  @Post()
  @Roles('USER', 'SUPER_ADMIN')
  async create(
    @Param('seniorId') seniorId: string,
    @Body() dto: CreateAppointmentDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to create appointment.');
    }
    return this.appointmentService.create(seniorId, userId, {
      title: dto.title,
      providerName: dto.providerName,
      location: dto.location,
      isTelehealth: dto.isTelehealth,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      status: dto.status,
      notes: dto.notes,
    });
  }

  @Get()
  @Roles('USER', 'SUPER_ADMIN')
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.appointmentService.findBySenior(seniorId, userId);
  }

  @Get(':appointmentId')
  @Roles('USER', 'SUPER_ADMIN')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('appointmentId') appointmentId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const appointment = await this.appointmentService.findOne(seniorId, appointmentId, userId);
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return appointment;
  }

  @Patch(':appointmentId')
  @Roles('USER', 'SUPER_ADMIN')
  async update(
    @Param('seniorId') seniorId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: UpdateAppointmentDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to modify appointment.');
    }
    return this.appointmentService.update(seniorId, appointmentId, userId, {
      title: dto.title,
      providerName: dto.providerName,
      location: dto.location,
      isTelehealth: dto.isTelehealth,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      status: dto.status,
      notes: dto.notes,
    });
  }

  @Delete(':appointmentId')
  @Roles('USER', 'SUPER_ADMIN')
  async cancel(
    @Param('seniorId') seniorId: string,
    @Param('appointmentId') appointmentId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.appointmentService.cancel(seniorId, appointmentId, userId);
  }
}
