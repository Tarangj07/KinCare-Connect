import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class MedicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(seniorId: string, userId: string, data: { name: string; dosage: string; form?: string; instructions?: string; prescribedByName?: string; pharmacyName?: string; pharmacyPhone?: string; startDate?: string; endDate?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can create medications.');
    }

    const startDate = data.startDate ? new Date(data.startDate) : undefined;
    const endDate = data.endDate ? new Date(data.endDate) : undefined;

    const medication = await this.prisma.medication.create({
      data: {
        seniorId,
        name: data.name,
        dosage: data.dosage,
        form: data.form,
        instructions: data.instructions,
        prescribedByName: data.prescribedByName,
        pharmacyName: data.pharmacyName,
        pharmacyPhone: data.pharmacyPhone,
        startDate: startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) : null,
        endDate: endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) : null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'medication.created',
        resourceType: 'medication',
        resourceId: medication.id,
        seniorId,
        metadata: { name: data.name, dosage: data.dosage },
      },
    });

    return medication;
  }

  async findBySenior(seniorId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    return this.prisma.medication.findMany({
      where: { seniorId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(seniorId: string, medicationId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const medication = await this.prisma.medication.findFirst({
      where: { id: medicationId, seniorId, deletedAt: null },
    });
    if (!medication) throw new NotFoundException('Medication not found.');
    return medication;
  }

  async update(seniorId: string, medicationId: string, userId: string, data: { name?: string; dosage?: string; form?: string; instructions?: string; prescribedByName?: string; pharmacyName?: string; pharmacyPhone?: string; startDate?: string; endDate?: string; isActive?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can update medications.');
    }
    const startDate = data.startDate ? new Date(data.startDate) : undefined;
    const endDate = data.endDate ? new Date(data.endDate) : undefined;
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.dosage !== undefined) updateData.dosage = data.dosage;
    if (data.form !== undefined) updateData.form = data.form;
    if (data.instructions !== undefined) updateData.instructions = data.instructions;
    if (data.prescribedByName !== undefined) updateData.prescribedByName = data.prescribedByName;
    if (data.pharmacyName !== undefined) updateData.pharmacyName = data.pharmacyName;
    if (data.pharmacyPhone !== undefined) updateData.pharmacyPhone = data.pharmacyPhone;
    if (startDate) updateData.startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    if (endDate) updateData.endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    if (data.isActive !== undefined) updateData.isActive = data.isActive === 'true';

    const medication = await this.prisma.medication.update({
      where: { id: medicationId, seniorId, deletedAt: null },
      data: updateData,
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'medication.updated',
        resourceType: 'medication',
        resourceId: medication.id,
        seniorId,
        metadata: { updatedFields: Object.keys(updateData) },
      },
    });

    return medication;
  }

  async archive(seniorId: string, medicationId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN') {
      throw new ForbiddenException('Only FAMILY_ADMIN can archive medications.');
    }
    const medication = await this.prisma.medication.findFirst({ where: { id: medicationId, seniorId, deletedAt: null } });
    if (!medication) throw new NotFoundException('Medication not found.');
    const updated = await this.prisma.medication.update({
      where: { id: medicationId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'medication.archived',
        resourceType: 'medication',
        resourceId: medicationId,
        seniorId,
        metadata: {},
      },
    });
    return updated;
  }
}
