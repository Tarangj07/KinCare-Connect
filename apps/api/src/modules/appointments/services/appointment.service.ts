import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../auth/authorization.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(seniorId: string, userId: string, data: { title: string; providerName?: string; location?: string; isTelehealth?: string; startsAt: string; endsAt?: string; status?: string; notes?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to create appointments.');
    }
    const startsAt = new Date(data.startsAt);
    const endsAt = data.endsAt ? new Date(data.endsAt) : null;
    const appointment = await this.prisma.appointment.create({
      data: {
        seniorId,
        title: data.title,
        providerName: data.providerName,
        location: data.location,
        isTelehealth: data.isTelehealth === 'true' || data.isTelehealth === true,
        startsAt,
        endsAt,
        status: (data.status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW') ?? 'SCHEDULED',
        notes: data.notes,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'appointment.created',
        resourceType: 'appointment',
        resourceId: appointment.id,
        seniorId,
        metadata: { title: data.title, providerName: data.providerName },
      },
    });
    return appointment;
  }

  async findBySenior(seniorId: string, userId: string, from?: string, to?: string, status?: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const where: { seniorId: string; deletedAt: null; status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'; startsAt?: { gte?: Date; lte?: Date } } = { seniorId, deletedAt: null };
    if (status) where.status = status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    if (from || to) {
      where.startsAt = {};
      if (from) where.startsAt.gte = new Date(from);
      if (to) where.startsAt.lte = new Date(to);
    }
    return this.prisma.appointment.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: { participants: true, reminders: true },
    });
  }

  async findOne(seniorId: string, appointmentId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, seniorId, deletedAt: null },
      include: { participants: true, reminders: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return appointment;
  }

  async update(seniorId: string, appointmentId: string, userId: string, data: { title?: string; providerName?: string; location?: string; isTelehealth?: string; startsAt?: string; endsAt?: string; status?: string; notes?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to modify appointment.');
    }
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.providerName !== undefined) updateData.providerName = data.providerName;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.isTelehealth !== undefined) updateData.isTelehealth = data.isTelehealth === 'true';
    if (data.startsAt !== undefined) updateData.startsAt = new Date(data.startsAt);
    if (data.endsAt !== undefined) updateData.endsAt = new Date(data.endsAt);
    if (data.status !== undefined) updateData.status = data.status as 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
    if (data.notes !== undefined) updateData.notes = data.notes;
    const appointment = await this.prisma.appointment.update({
      where: { id: appointmentId, seniorId, deletedAt: null },
      data: updateData,
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'appointment.updated',
        resourceType: 'appointment',
        resourceId: appointmentId,
        seniorId,
        metadata: { updatedFields: Object.keys(updateData) },
      },
    });
    return appointment;
  }

  async cancel(seniorId: string, appointmentId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to cancel appointment.');
    }
    const appointment = await this.prisma.appointment.update({
      where: { id: appointmentId, seniorId, deletedAt: null },
      data: { status: 'CANCELLED' },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'appointment.cancelled',
        resourceType: 'appointment',
        resourceId: appointmentId,
        seniorId,
        metadata: {},
      },
    });
    return appointment;
  }
}
