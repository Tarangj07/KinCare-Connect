import {
  Controller, Post, Get, Param, Body, Req, UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { EmergencyService } from './services/emergency.service';
import { CreateEmergencyAlertDto } from './dto/create-emergency-alert.dto';

@Controller('seniors/:seniorId/emergency-alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('USER', 'SUPER_ADMIN')
export class EmergencyController {
  constructor(private readonly service: EmergencyService) {}

  private getUserId(req: Request): string {
    const user = (req as Request & { user?: { sub?: string } }).user;
    if (!user?.sub) throw new ForbiddenException('Authentication required.');
    return user.sub;
  }

  @Post()
  async create(
    @Param('seniorId') seniorId: string,
    @Body() dto: CreateEmergencyAlertDto,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.service.createAlert(seniorId, userId, {
      type: dto.type,
      severity: dto.severity,
      message: dto.message,
      source: dto.source,
    });
  }

  @Get()
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.service.findAlerts(seniorId, userId);
  }

  @Get(':alertId')
  async get(
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.service.findAlert(seniorId, alertId, userId);
  }

  @Post(':alertId/acknowledge')
  async acknowledge(
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.service.acknowledgeAlert(seniorId, alertId, userId);
  }

  @Post(':alertId/resolve')
  async resolve(
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.service.resolveAlert(seniorId, alertId, userId);
  }

  @Post(':alertId/cancel')
  async cancel(
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.service.cancelAlert(seniorId, alertId, userId);
  }
}
