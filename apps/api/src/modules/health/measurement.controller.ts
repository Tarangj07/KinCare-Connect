import {
  Body, Controller, Delete, ForbiddenException, Get, NotFoundException,
  Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthorizationService } from '../../auth/authorization.service';
import { CreateHealthMeasurementDto } from './dto/measurement.dto';
import { MeasurementService } from './services/measurement.service';

@Controller('seniors/:seniorId/measurements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HealthMeasurementController {
  constructor(
    private readonly measurementService: MeasurementService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private async assertAccess(req: Request, seniorId: string): Promise<void> {
    const user = (req as Request & { user?: { sub?: string } }).user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
  }

  @Post()
  async create(
    @Param('seniorId') seniorId: string,
    @Body() dto: CreateHealthMeasurementDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.measurementService.create(seniorId, userId, {
      measurementTypeKey: dto.measurementTypeKey,
      value: dto.value,
      measuredAt: dto.measuredAt,
      source: dto.source,
      note: dto.note,
    });
  }

  @Get()
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.measurementService.findBySenior(seniorId, userId);
  }

  @Get(':measurementId')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('measurementId') measurementId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const measurement = await this.measurementService.findOne(seniorId, measurementId, userId);
    if (!measurement) throw new NotFoundException('Health measurement not found.');
    return measurement;
  }

  @Delete(':measurementId')
  async archive(
    @Param('seniorId') seniorId: string,
    @Param('measurementId') measurementId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.measurementService.archive(seniorId, measurementId, userId);
  }
}
