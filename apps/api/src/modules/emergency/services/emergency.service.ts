import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthorizationService } from '../../../auth/authorization.service';
import { NotificationService } from '../../notifications/services/notification.service';
import type { EmergencyAlertStatus, EmergencyAlertSeverity, EmergencyAlertType } from '@prisma/client';

/**
 * Phase 18 (L-04): Prisma error code raised when a conditional `update`
 * matches no row — i.e. the state machine already moved on.
 */
const PRISMA_RECORD_NOT_FOUND = 'P2025';

interface EmergencyTransactionClient {
  emergencyAlert: {
    update: (args: { where: any; data: any }) => Promise<any>;
    create: (args: { data: any }) => Promise<any>;
  };
  auditLog: {
    create: (args: { data: any }) => Promise<any>;
  };
}

/** True for Prisma's "record to update not found" (P2025). */
function isPrismaRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PRISMA_RECORD_NOT_FOUND
  );
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

    // Derive recipients from active, unexpired CareCircle members for
    // this senior (Phase 16 — H10/A3: ended relationships are excluded).
    const members = await this.prisma.careCircleMember.findMany({
      where: {
        circle: { seniorId, deletedAt: null, isActive: true },
        status: 'ACTIVE',
        deletedAt: null,
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
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

  /**
   * Phase 18 (L-04) — turn a lost conditional-update race into an
   * intentional, documented API response.
   *
   * Each transition performs a race-safe conditional update
   * (`where: { id, seniorId, status: <expected> }`) inside a transaction
   * that also writes the audit row. That is correct and is NOT changed here:
   * the conditional `status` predicate guarantees exactly one writer can
   * apply a transition, and because the audit insert is in the same
   * transaction, a losing writer rolls back and produces no audit row.
   *
   * The defect was purely in error mapping. Prisma raises P2025 ("record to
   * update not found") when the conditional update matches no row. P2025 is
   * not an HttpException, so the global filter turned the losing request
   * into a 500 INTERNAL_ERROR — a server fault for what is actually a
   * legitimate, expected client-visible outcome (someone else already
   * acknowledged/resolved/cancelled the alert).
   *
   * P2025 is translated into the same ForbiddenException the pre-check
   * raises for an ordinary invalid transition, and the alert's real
   * current status is re-read so the response distinguishes
   * already-ACKNOWLEDGED / already-RESOLVED / already-CANCELLED. The state
   * machine is not weakened and multiple acknowledgements remain impossible.
   */
  private async rethrowTransitionLoss(
    seniorId: string,
    alertId: string,
    verb: 'acknowledge' | 'resolve' | 'cancel',
    err: unknown,
  ): Promise<never> {
    // Only a lost conditional update is remapped; every other error
    // (including a genuine database failure) keeps its original handling.
    if (!isPrismaRecordNotFound(err)) throw err;

    let currentStatus: string | null = null;
    try {
      const row = await this.prisma.emergencyAlert.findFirst({
        where: { id: alertId, seniorId },
        select: { status: true },
      });
      currentStatus = row?.status ?? null;
    } catch {
      // Status re-read is best effort; fall back to a generic message.
      currentStatus = null;
    }

    throw new ForbiddenException(
      currentStatus
        ? `Invalid transition: cannot ${verb} from ${currentStatus}.`
        : `Invalid transition: cannot ${verb} this alert.`,
    );
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
    }).catch((err: unknown) => this.rethrowTransitionLoss(seniorId, alertId, 'acknowledge', err));

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
    }).catch((err: unknown) => this.rethrowTransitionLoss(seniorId, alertId, 'resolve', err));

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
    }).catch((err: unknown) => this.rethrowTransitionLoss(seniorId, alertId, 'cancel', err));

    return updated;
  }
}
