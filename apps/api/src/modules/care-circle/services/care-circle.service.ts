/**
 * Phase 49 — care-circle creation and membership management.
 *
 * Addresses the remaining half of PR-48-01: after onboarding creates the
 * founding circle, this is the only other place a `CareCircle` or
 * `CareCircleMember` row can be created, and every path is gated on an
 * existing `AuthorizationService` membership.
 *
 * ## The bootstrap problem, and why no route bypasses RBAC
 *
 * `POST /seniors` is the ONLY way to obtain access to a senior, and it does
 * so by writing the membership row itself, inside its own transaction, for
 * the caller only. Every other method here first requires the caller to
 * already hold a legitimate membership for the target senior. There is no
 * request shape anywhere in this module in which a client names a senior it
 * cannot already reach and receives access to it.
 *
 * ## Invitations are deliberately absent
 *
 * The schema has an `Invitation` model, but the API has no route to issue,
 * deliver or accept one, and no mailer exists (Phase 48 PR-48-07). Building
 * an invitation flow is out of Phase 49's scope, so `addMember` adds an
 * EXISTING platform account by id as a privileged administrative act. That
 * is not an invitation substitute: the invitee's consent is not captured.
 * Recorded as a known limitation in the Phase 49 report.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CircleRole } from '@prisma/client';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

/** Prisma `P2002` — unique constraint violation (a uniqueness race). */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

export interface CareCircleResponse {
  id: string;
  seniorId: string;
  name: string;
  description: string | null;
  createdById: string;
  createdAt: string;
}

export interface CircleMemberResponse {
  id: string;
  circleId: string;
  userId: string | null;
  role: string;
  status: string;
  displayName: string | null;
  endsAt: string | null;
  createdAt: string;
  /**
   * The member's account name, so a manager can tell members apart.
   *
   * The member's EMAIL is deliberately absent. Listing a care circle's
   * members only needs an identifier and a name, and emails are personal
   * data that this endpoint has no need to disclose.
   */
  memberName: string | null;
}

interface MemberRow {
  id: string;
  circleId: string;
  userId: string | null;
  role: string;
  status: string;
  displayName: string | null;
  endsAt: Date | null;
  createdAt: Date;
  user?: { fullName: string } | null;
}

function mapMember(row: MemberRow): CircleMemberResponse {
  return {
    id: row.id,
    circleId: row.circleId,
    userId: row.userId,
    role: row.role,
    status: row.status,
    displayName: row.displayName,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    memberName: row.user?.fullName ?? null,
  };
}

const MEMBER_SELECT = {
  id: true,
  circleId: true,
  userId: true,
  role: true,
  status: true,
  displayName: true,
  endsAt: true,
  createdAt: true,
  user: { select: { fullName: true } },
} as const;

@Injectable()
export class CareCircleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /**
   * Resolve a circle, or 404.
   *
   * NOTE (SEC49-02): this resolves the circle's existence BEFORE any
   * authorization decision, so a caller that may not act on a circle receives
   * 403 for a circle that exists and 404 for one that does not. That difference
   * is a narrow existence oracle — it requires the caller to already hold a
   * valid circle UUID, which is not enumerable — and it is recorded and
   * accepted rather than silently mis-documented. The comment this replaces
   * claimed the two were indistinguishable; they are not.
   */
  private async loadCircle(circleId: string): Promise<{ id: string; seniorId: string; name: string; createdById: string }> {
    const circle = await this.prisma.careCircle.findFirst({
      where: { id: circleId, deletedAt: null, isActive: true },
      select: { id: true, seniorId: true, name: true, createdById: true },
    });
    if (!circle) throw new NotFoundException('Care circle not found.');
    return circle;
  }

  /**
   * Circle creation is an administrative act over a senior the caller must
   * already reach. Only a FAMILY_ADMIN may open a further circle; a
   * FAMILY_MEMBER, CAREGIVER, DOCTOR or OBSERVER may not.
   */
  private async assertFamilyAdmin(userId: string, seniorId: string): Promise<void> {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    if (!(await this.authorizationService.isFamilyAdmin(userId, seniorId))) {
      throw new ForbiddenException('Only a family admin can manage care circles for this senior.');
    }
  }

  /**
   * SEC49-04 — refuse to act for an account that is no longer usable.
   *
   * `JwtAuthGuard` verifies a signature, not account state, and access-token
   * revocation on deactivation is a long-standing deferred item (Phase 16 D-1).
   * `SeniorService.onboardSenior` already rejects such an actor with 401; the
   * mutating care-circle operations did not, which meant a deactivated or
   * soft-deleted account could still — for the remainder of its token lifetime
   * — GRANT access to other accounts. That is a materially different capability
   * from the stale-token access the pre-existing domains already allow, so the
   * same check is applied here.
   *
   * This is a Phase 49-local mitigation, not a fix for D-1: it does not revoke
   * an already-issued token, and it does not narrow what a stale token can read
   * within the bounds the pre-existing domains already permit.
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

  async createCircle(
    userId: string,
    input: { seniorId: string; name: string; description?: string },
  ): Promise<{ careCircle: CareCircleResponse; membership: CircleMemberResponse }> {
    await this.assertActorUsable(userId);
    await this.assertFamilyAdmin(userId, input.seniorId);

    const name = input.name.trim();
    const description = input.description?.trim() || null;

    const existing = await this.prisma.careCircle.findFirst({
      where: { seniorId: input.seniorId, name, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A care circle with this name already exists for this senior.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const circle = await tx.careCircle.create({
          data: { seniorId: input.seniorId, name, description, createdById: userId },
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
            action: 'care_circle.created',
            resourceType: 'care_circle',
            resourceId: circle.id,
            seniorId: circle.seniorId,
            metadata: { name, membershipId: membership.id, role: 'FAMILY_ADMIN' },
          },
        });

        return {
          careCircle: {
            id: circle.id,
            seniorId: circle.seniorId,
            name: circle.name,
            description: circle.description,
            createdById: circle.createdById,
            createdAt: circle.createdAt.toISOString(),
          },
          membership: mapMember(membership as MemberRow),
        };
      });
    } catch (err) {
      // Lost the `@@unique([seniorId, name])` race between the check above
      // and this insert. Same outcome as the check: deterministic 409.
      if (isUniqueViolation(err)) {
        throw new ConflictException('A care circle with this name already exists for this senior.');
      }
      throw err;
    }
  }

  async listMembers(userId: string, circleId: string): Promise<{ careCircle: { id: string; seniorId: string; name: string }; members: CircleMemberResponse[] }> {
    const circle = await this.loadCircle(circleId);
    // Any legitimate member of this senior may see the roster — OBSERVER
    // included, matching read access everywhere else in the API.
    await this.authorizationService.assertCanAccessSenior(userId, circle.seniorId);

    const rows = await this.prisma.careCircleMember.findMany({
      where: { circleId, deletedAt: null },
      select: MEMBER_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return {
      careCircle: { id: circle.id, seniorId: circle.seniorId, name: circle.name },
      members: rows.map((row) => mapMember(row as unknown as MemberRow)),
    };
  }

  async addMember(
    actorUserId: string,
    circleId: string,
    input: { userId: string; role: CircleRole; displayName?: string; notes?: string },
  ): Promise<CircleMemberResponse> {
    await this.assertActorUsable(actorUserId);
    const circle = await this.loadCircle(circleId);
    await this.assertFamilyAdmin(actorUserId, circle.seniorId);

    // Minting FAMILY_ADMIN is restricted to the circle's recorded creator, so
    // that the ability to grant administrative authority is attributable to one
    // actor rather than to every admin present.
    //
    // SEC49-03 — this is an ATTRIBUTION rule, not a containment boundary.
    // It is trivially sidestepped by any existing family admin of the same
    // senior: `assertFamilyAdmin` is evaluated per SENIOR, so that caller may
    // create another circle for the same senior, become its recorded
    // `createdById`, and grant `FAMILY_ADMIN` there. Because the caller is
    // already family admin for the whole senior, this grants no authority they
    // did not already hold, so it is not a privilege-escalation vector; it is a
    // weaker guarantee than "only one account may ever create admins", which
    // is how it was previously described. Making it a real boundary would
    // require scoping `FAMILY_ADMIN` to a circle, which would change the
    // existing authorization model and is deliberately NOT done here.
    if (input.role === 'FAMILY_ADMIN' && circle.createdById !== actorUserId) {
      throw new ForbiddenException(
        'Only the care-circle creator can grant the family-admin role.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!target || !target.isActive || target.deletedAt !== null) {
      throw new NotFoundException('User not found.');
    }

    const common = {
      role: input.role,
      displayName: input.displayName?.trim() || null,
      notes: input.notes?.trim() || null,
    };

    // `removeMember` RETAINS the row it ends (see below), and the schema's
    // `@@unique([circleId, userId])` applies to retained rows too. So a member
    // who was ended could never be restored by an insert — the insert would
    // raise P2002 forever. An existing non-ACTIVE row is therefore restored in
    // place rather than reported as a duplicate, which keeps the membership
    // lifecycle closed. An existing ACTIVE row is still a genuine duplicate.
    const existing = await this.prisma.careCircleMember.findUnique({
      where: { circleId_userId: { circleId, userId: input.userId } },
      select: { id: true, status: true, deletedAt: true, role: true },
    });

    if (existing && existing.status === 'ACTIVE' && existing.deletedAt === null) {
      throw new ConflictException('User is already a member of this care circle.');
    }

    try {
      const membership = await this.prisma.$transaction(async (tx) => {
        const restored = existing
          ? await tx.careCircleMember.update({
              where: { id: existing.id },
              data: { ...common, status: 'ACTIVE', endsAt: null, deletedAt: null },
            })
          : await tx.careCircleMember.create({
              data: {
                circleId,
                userId: input.userId,
                ...common,
                // ACTIVE immediately. There is no invitation or acceptance step
                // to wait for (see the module comment), so PENDING would create a
                // row that `AuthorizationService` never honours — access that
                // silently does not exist.
                status: 'ACTIVE',
                endsAt: null,
              },
            });

        await tx.auditLog.create({
          data: {
            actorUserId,
            actorType: 'USER',
            action: 'care_circle.member.added',
            resourceType: 'care_circle_member',
            resourceId: restored.id,
            seniorId: circle.seniorId,
            metadata: {
              circleId,
              memberUserId: input.userId,
              role: input.role,
              ...(existing
                ? { restored: true, previousStatus: existing.status, previousRole: existing.role }
                : {}),
            },
          },
        });

        return restored;
      });

      return mapMember(membership as MemberRow);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('User is already a member of this care circle.');
      }
      throw err;
    }
  }

  /**
   * End a membership.
   *
   * The row is retained and marked `ENDED` with `endsAt` set, rather than
   * hard-deleted: the relationship is an audit-relevant fact, and Phase 16
   * (H10/A3) established that `endsAt` alone is sufficient to revoke access.
   * Setting both means `AuthorizationService` excludes this member twice over
   * (status is not ACTIVE, and `endsAt` is in the past), so no future change
   * to one predicate can leave the access behind.
   *
   * Idempotent: ending an already-ended membership succeeds and reports its
   * current state rather than erroring. Because the row is retained, an
   * ended member can be restored by `addMember`, which reactivates the same
   * row rather than inserting a second one the unique constraint forbids.
   *
   * ## SEC49-01 — why the guard is inside a row-locked transaction
   *
   * The last-usable-admin guard was previously a `count()` performed OUTSIDE
   * the transaction that performed the update. Two concurrent requests, each
   * removing the other of a circle's final two administrators, could both
   * observe "1 remaining admin" and both commit, leaving the circle with zero
   * usable `FAMILY_ADMIN` members — permanently unmanageable, because every
   * later `assertFamilyAdmin` on that senior would then fail for everyone.
   * The independent review reproduced this (`200 / 200`, zero survivors).
   *
   * Simply moving the `count()` inside `$transaction` would NOT fix it.
   * Prisma's interactive transactions run at PostgreSQL's default isolation
   * level, READ COMMITTED, under which each statement takes a fresh snapshot.
   * Two transactions can therefore still both read a stale-but-committed
   * admin set and both proceed. `$transaction` alone provides atomicity of
   * the commit, not serialisation of the read-modify-write.
   *
   * The fix is an explicit row lock: `SELECT … FOR UPDATE` over precisely the
   * rows the decision depends on — the target member row, plus every currently
   * usable `FAMILY_ADMIN` row of the circle — taken as the FIRST statement in
   * the transaction and always in the same `ORDER BY id` sequence.
   *
   * Why this holds under PostgreSQL:
   *  - `FOR UPDATE` takes a row-level exclusive lock that is held to commit.
   *  - A concurrent transaction attempting to lock the same rows blocks.
   *  - When the first transaction commits, the blocked statement resumes and
   *    READ COMMITTED re-evaluates the row against the *newest* version
   *    (EvalPlanQual). Rows that no longer match the predicate — e.g. an admin
   *    the winner just set to `ENDED` — are skipped, not locked.
   *  - The subsequent `count` therefore observes the winner's committed
   *    state, so the loser sees zero remaining admins and raises 409.
   *
   * `ORDER BY id` is not cosmetic: it forces a single, consistent lock
   * acquisition order across all callers, which is what makes deadlock between
   * two concurrent removals impossible rather than merely unlikely.
   *
   * The lock is scoped to one circle's admin rows, so it does not serialise
   * unrelated circles. The same transaction also re-reads the target member
   * under the lock, so the idempotency check cannot act on a stale `status`.
   */
  async removeMember(actorUserId: string, circleId: string, memberId: string): Promise<CircleMemberResponse> {
    await this.assertActorUsable(actorUserId);
    const circle = await this.loadCircle(circleId);
    await this.assertFamilyAdmin(actorUserId, circle.seniorId);

    // Pre-check outside the transaction so a member id belonging to another
    // circle keeps its existing 404 rather than acquiring locks first. The
    // authoritative re-read happens under the lock below.
    const candidate = await this.prisma.careCircleMember.findFirst({
      where: { id: memberId, circleId, deletedAt: null },
      select: { id: true },
    });
    if (!candidate) throw new NotFoundException('Care-circle member not found.');

    const updated = await this.prisma.$transaction(async (tx) => {
      // Lock the target row AND every currently usable admin of this circle,
      // in a deterministic order. Parameterised via Prisma's tagged template;
      // no value is interpolated into the SQL string.
      await tx.$queryRaw`
        SELECT "id"
        FROM "care_circle_members"
        WHERE "deleted_at" IS NULL
          AND (
            "id" = ${memberId}::uuid
            OR (
              "circle_id" = ${circleId}::uuid
              AND "role" = 'FAMILY_ADMIN'
              AND "status" = 'ACTIVE'
              AND ("ends_at" IS NULL OR "ends_at" > now())
            )
          )
        ORDER BY "id"
        FOR UPDATE
      `;

      // Re-read under the lock: the row may have been ended by the winner of
      // a concurrent race while this transaction waited.
      const member = await tx.careCircleMember.findFirst({
        where: { id: memberId, circleId, deletedAt: null },
        select: MEMBER_SELECT,
      });
      if (!member) throw new NotFoundException('Care-circle member not found.');

      if (member.status === 'ENDED') return member;

      // Refuse to orphan the circle by removing its last usable admin. An
      // admin whose `endsAt` has passed is not counted as usable. This check
      // runs while holding the lock, so the count reflects every committed
      // concurrent removal.
      if (member.role === 'FAMILY_ADMIN') {
        const now = new Date();
        const remaining = await tx.careCircleMember.count({
          where: {
            circleId,
            role: 'FAMILY_ADMIN',
            status: 'ACTIVE',
            deletedAt: null,
            id: { not: member.id },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        });
        if (remaining === 0) {
          throw new ConflictException(
            'Cannot remove the last active family admin of a care circle.',
          );
        }
      }

      const ended = await tx.careCircleMember.update({
        where: { id: member.id },
        data: { status: 'ENDED', endsAt: new Date() },
      });

      // The audit row is written in the SAME transaction as the state change,
      // so a rejected removal (the 409 above) writes no audit row at all —
      // the request can never leave a state/audit mismatch, and can never
      // report a removal that did not happen.
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorType: 'USER',
          action: 'care_circle.member.ended',
          resourceType: 'care_circle_member',
          resourceId: member.id,
          seniorId: circle.seniorId,
          metadata: { circleId, memberUserId: member.userId, previousRole: member.role },
        },
      });

      return ended;
    });

    return mapMember(updated as MemberRow);
  }
}