import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class HealthMeasurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(seniorId: string, userId: string, data: { measurementTypeKey: string; value: Record<string, unknown>; measuredAt: string; source?: string; note?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    // Phase 16 (H9/A9): OBSERVER is a read-only circle role. Observing
    // PHI (GET routes) stays allowed; writing or removing PHI is not.
    const allowedRoles = ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR'];
    if (!allowedRoles.includes(role ?? '')) {
      throw new ForbiddenException('Insufficient privileges to record health measurements.');
    }

    // Resolve measurement type.
    const measurementType = await this.prisma.healthMeasurementType.findUnique({ where: { key: data.measurementTypeKey, isActive: true } });
    if (!measurementType) throw new NotFoundException('Measurement type not found.');

    const measurement = await this.prisma.healthMeasurement.create({
      data: {
        seniorId,
        typeId: measurementType.id,
        value: data.value as object,
        measuredAt: new Date(data.measuredAt),
        source: (data.source as 'MANUAL' | 'DEVICE' | 'IMPORT' | 'SYSTEM') ?? 'MANUAL',
        recordedByUserId: userId,
        note: data.note,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'health_measurement.created',
        resourceType: 'health_measurement',
        resourceId: measurement.id,
        seniorId,
        metadata: { measurementType: data.measurementTypeKey, source: data.source },
      },
    });
    return measurement;
  }

  async findBySenior(seniorId: string, userId: string, filters?: { measurementType?: string; from?: string; to?: string; limit?: number }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const where: Record<string, unknown> = { seniorId, deletedAt: null };
    if (filters?.measurementType) {
      where.type = { key: filters.measurementType };
    }
    if (filters?.from || filters?.to) {
      where.measuredAt = {};
      if (filters?.from) (where.measuredAt as Record<string, unknown>).gte = new Date(filters.from);
      if (filters?.to) (where.measuredAt as Record<string, unknown>).lte = new Date(filters.to);
    }
    return this.prisma.healthMeasurement.findMany({
      where,
      orderBy: { measuredAt: 'desc' },
      take: filters?.limit ?? 50,
      include: { type: true },
    });
  }

  async findOne(seniorId: string, measurementId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const measurement = await this.prisma.healthMeasurement.findFirst({
      where: { id: measurementId, seniorId, deletedAt: null },
      include: { type: true },
    });
    if (!measurement) throw new NotFoundException('Health measurement not found.');
    return measurement;
  }

  async archive(seniorId: string, measurementId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    // Phase 16 (H9/A9): OBSERVER (and any non-steward role) must not
    // delete protected PHI. Only FAMILY_ADMIN and DOCTOR may archive
    // measurements; recorders who entered a wrong value are corrected by
    // a steward rather than deleting history themselves.
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can archive health measurements.');
    }
    const measurement = await this.prisma.healthMeasurement.findFirst({ where: { id: measurementId, seniorId, deletedAt: null } });
    if (!measurement) throw new NotFoundException('Health measurement not found.');
    const updated = await this.prisma.healthMeasurement.update({
      where: { id: measurementId },
      data: { deletedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'health_measurement.archived',
        resourceType: 'health_measurement',
        resourceId: measurementId,
        seniorId,
        metadata: {},
      },
    });
    return updated;
  }
}
