import {
  Body, Controller, Delete, ForbiddenException, Get, NotFoundException,
  Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AuthorizationService } from '../../auth/authorization.service';
import { CreateMedicationDto, UpdateMedicationDto } from './dto/create-medication.dto';
import { MedicationService } from './services/medication.service';

@Controller('seniors/:seniorId/medications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MedicationController {
  constructor(
    private readonly medicationService: MedicationService,
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
    @Body() dto: CreateMedicationDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can create medications.');
    }
    return this.medicationService.create(seniorId, userId, {
      name: dto.name,
      dosage: dto.dosage,
      form: dto.form,
      instructions: dto.instructions,
      prescribedByName: dto.prescribedByName,
      pharmacyName: dto.pharmacyName,
      pharmacyPhone: dto.pharmacyPhone,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
  }

  @Get()
  @Roles('USER', 'SUPER_ADMIN')
  async list(@Param('seniorId') seniorId: string, @Req() req: Request) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.medicationService.findBySenior(seniorId, userId);
  }

  @Get(':medicationId')
  @Roles('USER', 'SUPER_ADMIN')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('medicationId') medicationId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const medication = await this.medicationService.findOne(seniorId, medicationId, userId);
    if (!medication) throw new NotFoundException('Medication not found.');
    return medication;
  }

  @Patch(':medicationId')
  @Roles('USER', 'SUPER_ADMIN')
  async update(
    @Param('seniorId') seniorId: string,
    @Param('medicationId') medicationId: string,
    @Body() dto: UpdateMedicationDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to modify medication.');
    }
    return this.medicationService.update(seniorId, medicationId, userId, {
      name: dto.name,
      dosage: dto.dosage,
      form: dto.form,
      instructions: dto.instructions,
      prescribedByName: dto.prescribedByName,
      pharmacyName: dto.pharmacyName,
      pharmacyPhone: dto.pharmacyPhone,
      startDate: dto.startDate,
      endDate: dto.endDate,
      isActive: dto.isActive,
    });
  }

  @Delete(':medicationId')
  @Roles('USER', 'SUPER_ADMIN')
  async archive(
    @Param('seniorId') seniorId: string,
    @Param('medicationId') medicationId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN') {
      throw new ForbiddenException('Only FAMILY_ADMIN can archive medications.');
    }
    return this.medicationService.archive(seniorId, medicationId, userId);
  }
}
