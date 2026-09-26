import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class MedicationScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(seniorId: string, medicationId: string, userId: string, data: { timeOfDay: string; quantity: number; unit?: string; note?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can create schedules.');
    }
    const medication = await this.prisma.medication.findFirst({ where: { id: medicationId, seniorId, deletedAt: null } });
    if (!medication) throw new NotFoundException('Medication not found.');

    const timeOfDay = new Date(`1970-01-01T${data.timeOfDay}:00.000Z`);
    const schedule = await this.prisma.medicationSchedule.create({
      data: {
        medicationId,
        timeOfDay,
        quantity: data.quantity,
        unit: data.unit,
        note: data.note,
        isActive: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'medication.schedule.created',
        resourceType: 'medication_schedule',
        resourceId: schedule.id,
        seniorId,
        metadata: { medicationId, timeOfDay: data.timeOfDay },
      },
    });
    return schedule;
  }

  async findForMedication(seniorId: string, medicationId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    return this.prisma.medicationSchedule.findMany({
      where: { medicationId, medication: { seniorId, deletedAt: null }, isActive: true },
      orderBy: { timeOfDay: 'asc' },
    });
  }

  async update(seniorId: string, scheduleId: string, userId: string, data: { timeOfDay?: string; quantity?: number; unit?: string; note?: string; isActive?: boolean }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can modify schedules.');
    }
    const updateData: Record<string, unknown> = {};
    if (data.timeOfDay) {
      const timeOfDay = new Date(`1970-01-01T${data.timeOfDay}:00.000Z`);
      updateData.timeOfDay = timeOfDay;
    }
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.note !== undefined) updateData.note = data.note;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    const schedule = await this.prisma.medicationSchedule.update({
      where: { id: scheduleId, medication: { seniorId, deletedAt: null } },
      data: updateData,
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'medication.schedule.updated',
        resourceType: 'medication_schedule',
        resourceId: scheduleId,
        seniorId,
        metadata: { fields: Object.keys(updateData) },
      },
    });
    return schedule;
  }

  async archive(seniorId: string, scheduleId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN') throw new ForbiddenException('Only FAMILY_ADMIN can archive schedules.');
    return this.prisma.medicationSchedule.update({
      where: { id: scheduleId, medication: { seniorId, deletedAt: null } },
      data: { isActive: false },
    });
  }
}
