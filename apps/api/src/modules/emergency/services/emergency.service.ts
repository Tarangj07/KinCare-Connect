import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../auth/authorization.service';
import { NotificationService } from '../../notifications/services/notification.service';
import type { EmergencyAlertStatus, EmergencyAlertSeverity, EmergencyAlertType } from '@prisma/client';

interface EmergencyTransactionClient {
  emergencyAlert: {
    update: (args: { where: any; data: any }) => Promise<any>;
    create: (args: { data: any }) => Promise<any>;
  };
  auditLog: {
    create: (args: { data: any }) => Promise<any>;
  };
}

@Injectable()
export class EmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly notificationService: NotificationService,
  ) {}

  private async assertCanAccessSenior(userId: string, seniorId: string): Promise<void> {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
  }

  private async assertRole(userId: string, seniorId: string, allowedRoles: string[]): Promise<void> {
    await this.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenException('Access denied: insufficient role for this action.');
    }
  }

  async createAlert(
    seniorId: string,
    userId: string,
    payload: { type: EmergencyAlertType; severity: EmergencyAlertSeverity; message?: string; source: string },
  ) {
    // Only active care-circle members with appropriate roles can create.
    // OBSERVER excluded from creation.
    await this.assertRole(userId, seniorId, ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR']);

    const alert = await this.prisma.$transaction(async (tx: EmergencyTransactionClient) => {
      const alert = await tx.emergencyAlert.create({
        data: {
          seniorId,
          type: payload.type,
          severity: payload.severity,
          status: 'ACTIVE',
          message: payload.message ?? null,
          source: payload.source,
          createdByUserId: userId,
          detectedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'emergency_alert.created',
          resourceType: 'emergency_alert',
          resourceId: alert.id,
          seniorId,
          metadata: { type: payload.type, severity: payload.severity, source: payload.source },
        },
      });
      return alert;
    });

    // Derive recipients from active CareCircle members for this senior.
    const members = await this.prisma.careCircleMember.findMany({
      where: {
        circle: { seniorId, deletedAt: null, isActive: true },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { userId: true },
    });

    const recipientIds = new Set<string>();
    for (const m of members) {
      if (m.userId) recipientIds.add(m.userId);
    }
    // If the senior has their own linked User account, include them if authorized.
    const seniorProfile = await this.prisma.seniorProfile.findFirst({
      where: { id: seniorId, deletedAt: null },
      select: { user: { select: { id: true } } },
    });
    if (seniorProfile?.user) {
      recipientIds.add(seniorProfile.user.id);
    }
    // Avoid notifying the creator redundantly if not needed; include all authorized recipients.
    recipientIds.delete(userId);

    for (const recipientId of recipientIds) {
      await this.notificationService.createNotification(
        recipientId,
        'emergency.alert.created',
        { alertId: alert.id, seniorId, type: payload.type, severity: payload.severity },
        seniorId,
        'IN_APP',
      );
    }

    return alert;
  }

  async findAlerts(seniorId: string, userId: string) {
    await this.assertCanAccessSenior(userId, seniorId);
    return this.prisma.emergencyAlert.findMany({
      where: { seniorId },
      orderBy: { detectedAt: 'desc' },
    });
  }

  async findAlert(seniorId: string, alertId: string, userId: string) {
    await this.assertCanAccessSenior(userId, seniorId);
    const alert = await this.prisma.emergencyAlert.findFirst({
      where: { id: alertId, seniorId },
    });
    if (!alert) throw new ForbiddenException('Alert not found for this senior.');
    return alert;
  }

  async acknowledgeAlert(seniorId: string, alertId: string, userId: string) {
    await this.assertCanAccessSenior(userId, seniorId);
    const alert = await this.prisma.emergencyAlert.findFirst({
      where: { id: alertId, seniorId },
    });
    if (!alert) throw new ForbiddenException('Alert not found.');

    if (alert.status !== 'ACTIVE') {
      throw new ForbiddenException(`Invalid transition: cannot acknowledge from ${alert.status}.`);
    }

    // Role policy: FAMILY_ADMIN, CAREGIVER, DOCTOR can acknowledge; FAMILY_MEMBER allowed as well.
    await this.assertRole(userId, seniorId, ['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR']);

    const updated = await this.prisma.$transaction(async (tx: EmergencyTransactionClient) => {
      const updated = await tx.emergencyAlert.update({
        where: { id: alertId, seniorId, status: 'ACTIVE' },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
          acknowledgedByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'emergency_alert.acknowledged',
          resourceType: 'emergency_alert',
          resourceId: alertId,
          seniorId,
          metadata: {},
        },
      });
      return updated;
    });

    return updated;
  }

  async resolveAlert(seniorId: string, alertId: string, userId: string) {
    await this.assertCanAccessSenior(userId, seniorId);
    const alert = await this.prisma.emergencyAlert.findFirst({
      where: { id: alertId, seniorId },
    });
    if (!alert) throw new ForbiddenException('Alert not found.');

    if (alert.status !== 'ACTIVE' && alert.status !== 'ACKNOWLEDGED') {
      throw new ForbiddenException(`Invalid transition: cannot resolve from ${alert.status}.`);
    }

    await this.assertRole(userId, seniorId, ['FAMILY_ADMIN', 'CAREGIVER', 'DOCTOR']);

    const updated = await this.prisma.$transaction(async (tx: EmergencyTransactionClient) => {
      const updated = await tx.emergencyAlert.update({
        where: { id: alertId, seniorId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'emergency_alert.resolved',
          resourceType: 'emergency_alert',
          resourceId: alertId,
          seniorId,
          metadata: {},
        },
      });
      return updated;
    });

    return updated;
  }

  async cancelAlert(seniorId: string, alertId: string, userId: string) {
    await this.assertCanAccessSenior(userId, seniorId);
    const alert = await this.prisma.emergencyAlert.findFirst({
      where: { id: alertId, seniorId },
    });
    if (!alert) throw new ForbiddenException('Alert not found.');

    if (alert.status !== 'ACTIVE') {
      throw new ForbiddenException(`Invalid transition: cannot cancel from ${alert.status}.`);
    }

    await this.assertRole(userId, seniorId, ['FAMILY_ADMIN', 'CAREGIVER', 'DOCTOR']);

    const updated = await this.prisma.$transaction(async (tx: EmergencyTransactionClient) => {
      const updated = await tx.emergencyAlert.update({
        where: { id: alertId, seniorId, status: 'ACTIVE' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'emergency_alert.cancelled',
          resourceType: 'emergency_alert',
          resourceId: alertId,
          seniorId,
          metadata: {},
        },
      });
      return updated;
    });

    return updated;
  }
}
