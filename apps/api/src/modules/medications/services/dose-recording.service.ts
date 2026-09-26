import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DoseRecordingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async recordTaken(seniorId: string, doseId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Only authorized family members or caregivers can record doses.');
    }
    const dose = await this.prisma.medicationDose.findFirst({ where: { id: doseId, seniorId } });
    if (!dose) throw new NotFoundException('Dose not found.');
    const updated = await this.prisma.medicationDose.update({
      where: { id: doseId },
      data: { status: 'TAKEN', recordedAt: new Date(), recordedByUserId: userId, note: null },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: userId, actorType: 'USER', action: 'medication.dose.taken', resourceType: 'medication_dose', resourceId: doseId, seniorId, metadata: { medicationId: dose.medicationId, scheduledAt: dose.scheduledAt } },
    });
    return updated;
  }

  async recordSkipped(seniorId: string, doseId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Only authorized family members or caregivers can skip doses.');
    }
    const dose = await this.prisma.medicationDose.findFirst({ where: { id: doseId, seniorId } });
    if (!dose) throw new NotFoundException('Dose not found.');
    const updated = await this.prisma.medicationDose.update({
      where: { id: doseId },
      data: { status: 'SKIPPED', recordedAt: new Date(), recordedByUserId: userId, note: null },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: userId, actorType: 'USER', action: 'medication.dose.skipped', resourceType: 'medication_dose', resourceId: doseId, seniorId, metadata: { medicationId: dose.medicationId, scheduledAt: dose.scheduledAt } },
    });
    return updated;
  }

  async recordSnoozed(seniorId: string, doseId: string, userId: string, snoozeMinutes: number) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Only authorized family members or caregivers can snooze doses.');
    }
    const dose = await this.prisma.medicationDose.findFirst({ where: { id: doseId, seniorId } });
    if (!dose) throw new NotFoundException('Dose not found.');
    const updated = await this.prisma.medicationDose.update({
      where: { id: doseId },
      data: { status: 'SNOOZED', recordedAt: new Date(), recordedByUserId: userId, note: `Snoozed ${snoozeMinutes} minutes.` },
    });
    await this.prisma.auditLog.create({
      data: { actorUserId: userId, actorType: 'USER', action: 'medication.dose.snoozed', resourceType: 'medication_dose', resourceId: doseId, seniorId, metadata: { snoozeMinutes, medicationId: dose.medicationId, scheduledAt: dose.scheduledAt } },
    });
    return updated;
  }
}
