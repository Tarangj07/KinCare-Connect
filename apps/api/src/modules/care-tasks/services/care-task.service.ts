import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../auth/authorization.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class CareTaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(seniorId: string, userId: string, data: { title: string; description?: string; priority?: string; dueAt?: string; recurrenceFrequency?: string; recurrenceRule?: string; recurrenceEndsAt?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CARETAKER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN can create care tasks.');
    }
    const dueAtValue = data.dueAt ? new Date(data.dueAt) : null;
    const recurrenceEndsValue = data.recurrenceEndsAt ? new Date(data.recurrenceEndsAt) : null;
    const task = await this.prisma.careTask.create({
      data: {
        seniorId,
        title: data.title,
        description: data.description,
        priority: (data.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') ?? 'MEDIUM',
        status: 'PENDING',
        dueAt: dueAtValue,
        recurrenceFrequency: (data.recurrenceFrequency as 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM') ?? 'NONE',
        recurrenceRule: data.recurrenceRule,
        recurrenceEndsAt: recurrenceEndsValue,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'care_task.created',
        resourceType: 'care_task',
        resourceId: task.id,
        seniorId,
        metadata: { title: data.title, priority: data.priority },
      },
    });
    return task;
  }

  async findBySenior(seniorId: string, userId: string, status?: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    return this.prisma.careTask.findMany({
      where: {
        seniorId,
        deletedAt: null,
        ...(status ? { status: status as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED' | 'OVERDUE' } : {}),
      },
      orderBy: { dueAt: 'asc' },
      include: { assignments: true },
    });
  }

  async findOne(seniorId: string, taskId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const task = await this.prisma.careTask.findFirst({
      where: { id: taskId, seniorId, deletedAt: null },
      include: { assignments: true },
    });
    if (!task) throw new NotFoundException('Care task not found.');
    return task;
  }

  async update(seniorId: string, taskId: string, userId: string, data: { title?: string; description?: string; priority?: string; status?: string; dueAt?: string; completedAt?: string; recurrenceFrequency?: string; recurrenceRule?: string; recurrenceEndsAt?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'CARETAKER') {
      throw new ForbiddenException('Only FAMILY_ADMIN or assigned CAREGIVER can modify tasks.');
    }
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.dueAt !== undefined) updateData.dueAt = data.dueAt ? new Date(data.dueAt) : null;
    if (data.completedAt !== undefined) updateData.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    if (data.recurrenceFrequency !== undefined) updateData.recurrenceFrequency = data.recurrenceFrequency;
    if (data.recurrenceRule !== undefined) updateData.recurrenceRule = data.recurrenceRule;
    if (data.recurrenceEndsAt !== undefined) updateData.recurrenceEndsAt = data.recurrenceEndsAt ? new Date(data.recurrenceEndsAt) : null;
    const task = await this.prisma.careTask.update({
      where: { id: taskId, seniorId, deletedAt: null },
      data: updateData,
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'care_task.updated',
        resourceType: 'care_task',
        resourceId: taskId,
        seniorId,
        metadata: { updatedFields: Object.keys(updateData) },
      },
    });
    return task;
  }

  async cancel(seniorId: string, taskId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'CARETAKER') {
      throw new ForbiddenException('Only FAMILY_ADMIN or assigned CAREGIVER can cancel tasks.');
    }
    const task = await this.prisma.careTask.update({
      where: { id: taskId, seniorId, deletedAt: null },
      data: { status: 'CANCELLED' },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'care_task.cancelled',
        resourceType: 'care_task',
        resourceId: taskId,
        seniorId,
        metadata: {},
      },
    });
    return task;
  }

  async complete(seniorId: string, taskId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CARETAKER') {
      throw new ForbiddenException('Only FAMILY_ADMIN, FAMILY_MEMBER, or assigned CAREGIVER can complete tasks.');
    }
    const task = await this.prisma.careTask.update({
      where: { id: taskId, seniorId, deletedAt: null },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'care_task.completed',
        resourceType: 'care_task',
        resourceId: taskId,
        seniorId,
        metadata: {},
      },
    });
    return task;
  }
}
