/**
 * Phase 49 — senior provisioning and accessible-senior resolution.
 *
 * Addresses PR-48-01 (no way to create a SeniorProfile) and PR-48-02 (no way
 * to obtain a seniorId).
 *
 * ## Why onboarding is one operation
 *
 * `AuthorizationService` grants access to a senior only through an ACTIVE,
 * unexpired `CareCircleMember` row, and `CareCircle.createdById` is a
 * non-null `User` FK. So a senior with no circle has no members, and a circle
 * with no members can be created by nobody — every senior-scoped route is
 * already 403 for everybody. Splitting provisioning into "create senior"
 * then "create circle" would need a bootstrap authorization rule that the
 * existing RBAC does not have. Provisioning therefore writes the senior, its
 * founding care circle, and the creator's FAMILY_ADMIN membership in ONE
 * transaction, so no intermediate state is ever externally observable.
 *
 * Nothing here widens the authorization model. The rows written are exactly
 * the rows `AuthorizationService` already requires; this phase only makes
 * them obtainable through a legitimate product path.
 */
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CircleRole } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';

/** Name used when the client does not name the founding circle. */
export const DEFAULT_CIRCLE_NAME = 'Family circle';

export interface SeniorSummaryResponse {
  id: string;
  fullName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
}

export interface OnboardSeniorResponse {
  senior: SeniorSummaryResponse & { createdAt: string };
  careCircle: { id: string; name: string; description: string | null };
  membership: { id: string; circleId: string; role: string; status: string };
}

export interface AccessibleSeniorResponse {
  senior: SeniorSummaryResponse;
  /**
   * The most privileged membership the caller holds for this senior.
   *
   * This is a DISPLAY HINT ONLY. Every senior-scoped action re-derives the
   * caller's actual role through `AuthorizationService`, so a client that
   * trusts this value to render or skip a control changes nothing about what
   * the API will allow.
   */
  role: CircleRole;
  circles: Array<{ circleId: string; circleName: string; role: CircleRole }>;
}

/**
 * Precedence used only to pick the single `role` hint returned for a senior a
 * caller reaches through more than one circle. It is not an authorization
 * ordering and is not consulted by `AuthorizationService`.
 */
const ROLE_PRECEDENCE: CircleRole[] = [
  'FAMILY_ADMIN',
  'FAMILY_MEMBER',
  'DOCTOR',
  'CAREGIVER',
  'OBSERVER',
];

interface OnboardInput {
  fullName: string;
  preferredName?: string;
  dateOfBirth?: string;
  carePreferences?: string;
  circleName?: string;
}

@Injectable()
export class SeniorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A JWT alone does not prove the account still exists or is usable:
   * `JwtAuthGuard` verifies a signature, and access-token revocation on
   * deactivation is a documented open item (Phase 16 D-1). `CareCircle.createdById`
   * and `CareCircleMember.userId` are FKs, so writing them for a deleted
   * subject would raise a Prisma foreign-key error and surface as a 500 for
   * what is really an authentication problem. Checked here instead.
   */
  private async assertActorUsable(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
    if (!user || !user.isActive || user.deletedAt !== null) {
      throw new UnauthorizedException('Account not active');
    }
  }

  async onboardSenior(userId: string, input: OnboardInput): Promise<OnboardSeniorResponse> {
    await this.assertActorUsable(userId);

    const circleName = input.circleName?.trim() || DEFAULT_CIRCLE_NAME;
    const fullName = input.fullName.trim();
    const preferredName = input.preferredName?.trim() || null;
    const carePreferences = input.carePreferences?.trim() || null;
    // The DTO has already proven this is a real, non-future YYYY-MM-DD date.
    const dateOfBirth = input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null;

    return this.prisma.$transaction(async (tx) => {
      const senior = await tx.seniorProfile.create({
        data: { fullName, preferredName, dateOfBirth, carePreferences },
      });

      const circle = await tx.careCircle.create({
        data: { seniorId: senior.id, name: circleName, createdById: userId },
      });

      const membership = await tx.careCircleMember.create({
        data: {
          circleId: circle.id,
          userId,
          role: 'FAMILY_ADMIN',
          status: 'ACTIVE',
          endsAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'senior_profile.created',
          resourceType: 'senior_profile',
          resourceId: senior.id,
          seniorId: senior.id,
          metadata: { careCircleId: circle.id, careCircleName: circleName, role: 'FAMILY_ADMIN' },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'care_circle.created',
          resourceType: 'care_circle',
          resourceId: circle.id,
          seniorId: senior.id,
          metadata: { name: circleName, membershipId: membership.id, role: 'FAMILY_ADMIN' },
        },
      });

      return {
        senior: {
          id: senior.id,
          fullName: senior.fullName,
          preferredName: senior.preferredName,
          dateOfBirth: senior.dateOfBirth ? senior.dateOfBirth.toISOString().slice(0, 10) : null,
          createdAt: senior.createdAt.toISOString(),
        },
        careCircle: { id: circle.id, name: circle.name, description: circle.description },
        membership: {
          id: membership.id,
          circleId: membership.circleId,
          role: membership.role as string,
          status: membership.status as string,
        },
      };
    });
  }

  /**
   * Seniors the caller may legitimately address, derived from ACTIVE,
   * unexpired, non-deleted membership rows.
   *
   * The membership predicate below is deliberately the same one
   * `AuthorizationService.membershipWhere` uses, and the circle/senior
   * predicates are the same ones its circle lookup applies
   * (`deletedAt: null, isActive: true`). Mirroring them is what makes this
   * endpoint safe to use for senior selection: it cannot return a senior
   * that the API would then refuse. It reads memberships; it does not
   * consult or replace `AuthorizationService` for any access decision.
   */
  async findAccessibleSeniors(userId: string): Promise<AccessibleSeniorResponse[]> {
    const now = new Date();

    const memberships = await this.prisma.careCircleMember.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        deletedAt: null,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        circle: {
          deletedAt: null,
          isActive: true,
          senior: { deletedAt: null, isActive: true },
        },
      },
      select: {
        role: true,
        circle: {
          select: {
            id: true,
            name: true,
            senior: {
              select: { id: true, fullName: true, preferredName: true, dateOfBirth: true },
            },
          },
        },
      },
      orderBy: { circle: { senior: { fullName: 'asc' } } },
    });

    const bySenior = new Map<string, AccessibleSeniorResponse>();

    for (const membership of memberships) {
      const senior = membership.circle.senior;
      if (!senior) continue;

      const role = membership.role as CircleRole;
      const existing = bySenior.get(senior.id);

      if (!existing) {
        bySenior.set(senior.id, {
          senior: {
            id: senior.id,
            fullName: senior.fullName,
            preferredName: senior.preferredName,
            dateOfBirth: senior.dateOfBirth ? senior.dateOfBirth.toISOString().slice(0, 10) : null,
          },
          role,
          circles: [{ circleId: membership.circle.id, circleName: membership.circle.name, role }],
        });
        continue;
      }

      // The same senior can be reachable through more than one circle (the
      // schema permits it: `CareCircle` has no unique constraint on
      // `seniorId`, only `@@unique([seniorId, name])`). Report it once, with
      // every circle listed and the strongest role as the display hint.
      existing.circles.push({
        circleId: membership.circle.id,
        circleName: membership.circle.name,
        role,
      });
      if (ROLE_PRECEDENCE.indexOf(role) < ROLE_PRECEDENCE.indexOf(existing.role)) {
        existing.role = role;
      }
    }

    return [...bySenior.values()];
  }
}