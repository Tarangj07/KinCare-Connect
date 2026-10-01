/**
 * Phase 49 — unit coverage for the senior access foundation.
 *
 * These specs pin the service-level authorization and validation decisions
 * without a database. The database-backed proof that a legitimately onboarded
 * user can reach the pre-existing senior-scoped domains — and that an
 * unrelated user cannot — is `test/onboarding-access.e2e-spec.ts`.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AuthorizationService } from '../../../auth/authorization.service';
import type { PrismaService } from '../../../database/prisma.service';
import { CareCircleService } from '../services/care-circle.service';
import { DEFAULT_CIRCLE_NAME, SeniorService } from '../services/senior.service';

const SENIOR_A = '11111111-1111-4111-8111-111111111111';
const SENIOR_B = '22222222-2222-4222-8222-222222222222';
const CIRCLE_A = '33333333-3333-4333-8333-333333333333';
const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-1111-4111-8111-111111111111';
const INACTIVE_USER = 'cccccccc-1111-4111-8111-111111111111';
const DELETED_USER = 'dddddddd-1111-4111-8111-111111111111';

function seniorRow(id: string, fullName: string) {
  return {
    id,
    fullName,
    preferredName: null,
    dateOfBirth: new Date('1940-04-01T00:00:00.000Z'),
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    circleId: CIRCLE_A,
    userId: USER_B,
    role: 'FAMILY_MEMBER',
    status: 'ACTIVE',
    displayName: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    user: { fullName: 'Member B' },
    ...overrides,
  };
}

describe('SeniorService (Phase 49)', () => {
  let mockPrisma: Record<string, any>;
  let service: SeniorService;
  let txCalls: string[];

  beforeEach(() => {
    txCalls = [];
    mockPrisma = {
      user: {
        findUnique: async ({ where }: any) =>
          where.id === 'deleted-user' ? { isActive: false, deletedAt: null } : { isActive: true, deletedAt: null },
      },
      seniorProfile: {
        create: async ({ data }: any) => ({
          id: SENIOR_A,
          fullName: data.fullName,
          preferredName: data.preferredName,
          dateOfBirth: data.dateOfBirth,
          createdAt: new Date('2026-02-02T00:00:00.000Z'),
        }),
      },
      careCircle: { create: async ({ data }: any) => ({ ...data, id: CIRCLE_A }) },
      careCircleMember: { create: async ({ data }: any) => memberRow({ ...data, id: 'm-1' }) },
      auditLog: {
        create: async ({ data }: any) => {
          txCalls.push(data.action);
          return { id: 'audit-1' };
        },
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };
    service = new SeniorService(mockPrisma as unknown as PrismaService);
  });

  describe('onboardSenior', () => {
    it('creates the senior, a founding circle, and a FAMILY_ADMIN ACTIVE membership for the caller', async () => {
      const result = await service.onboardSenior(USER_A, { fullName: '  Margaret Chen  ' });

      expect(result.senior.id).toBe(SENIOR_A);
      expect(result.senior.fullName).toBe('Margaret Chen');
      expect(result.careCircle.name).toBe(DEFAULT_CIRCLE_NAME);
      expect(result.membership).toMatchObject({ role: 'FAMILY_ADMIN', status: 'ACTIVE', circleId: CIRCLE_A });
    });

    it('writes both audit events, so provisioning is attributable', async () => {
      await service.onboardSenior(USER_A, { fullName: 'Margaret Chen' });
      expect(txCalls).toEqual(['senior_profile.created', 'care_circle.created']);
    });

    it('normalises optional fields to null rather than undefined', async () => {
      const result = await service.onboardSenior(USER_A, { fullName: 'Margaret', preferredName: '  ' });
      expect(result.senior.preferredName).toBeNull();
      expect(result.senior.dateOfBirth).toBeNull();
    });

    it('honours an explicit circle name', async () => {
      const result = await service.onboardSenior(USER_A, { fullName: 'Margaret', circleName: ' Inner family ' });
      expect(result.careCircle.name).toBe('Inner family');
    });

    it('refuses to provision for a subject whose account is no longer usable', async () => {
      await expect(service.onboardSenior('deleted-user', { fullName: 'X' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(txCalls).toEqual([]);
    });
  });

  describe('findAccessibleSeniors', () => {
    it('returns seniors reachable through an ACTIVE, unexpired membership', async () => {
      mockPrisma.careCircleMember = {
        findMany: async () => [
          { role: 'FAMILY_ADMIN', circle: { id: CIRCLE_A, name: 'Family circle', senior: seniorRow(SENIOR_A, 'Margaret') } },
        ],
      };
      const result = await service.findAccessibleSeniors(USER_A);
      expect(result).toHaveLength(1);
      expect(result[0].senior.id).toBe(SENIOR_A);
      expect(result[0].role).toBe('FAMILY_ADMIN');
    });

    it('applies the same active/unexpired predicate AuthorizationService uses', async () => {
      let captured: any;
      mockPrisma.careCircleMember = {
        findMany: async (opts: any) => {
          captured = opts;
          return [];
        },
      };
      await service.findAccessibleSeniors(USER_A);
      expect(captured.where).toMatchObject({ userId: USER_A, status: 'ACTIVE', deletedAt: null });
      expect(captured.where.OR).toEqual([{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }]);
      // The circle and senior predicates mirror AuthorizationService's own
      // lookups, so this endpoint cannot surface a senior the API would refuse.
      expect(captured.where.circle).toMatchObject({ deletedAt: null, isActive: true });
      expect(captured.where.circle.senior).toMatchObject({ deletedAt: null, isActive: true });
    });

    it('collapses two circles for one senior into a single entry with the strongest role hint', async () => {
      mockPrisma.careCircleMember = {
        findMany: async () => [
          { role: 'OBSERVER', circle: { id: 'c-1', name: 'Clinical', senior: seniorRow(SENIOR_A, 'Margaret') } },
          { role: 'FAMILY_ADMIN', circle: { id: 'c-2', name: 'Family', senior: seniorRow(SENIOR_A, 'Margaret') } },
        ],
      };
      const result = await service.findAccessibleSeniors(USER_A);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('FAMILY_ADMIN');
      expect(result[0].circles.map((c) => c.circleId)).toEqual(['c-1', 'c-2']);
    });

    it('returns one entry per distinct senior', async () => {
      mockPrisma.careCircleMember = {
        findMany: async () => [
          { role: 'FAMILY_ADMIN', circle: { id: 'c-1', name: 'A', senior: seniorRow(SENIOR_A, 'Margaret') } },
          { role: 'FAMILY_ADMIN', circle: { id: 'c-2', name: 'B', senior: seniorRow(SENIOR_B, 'Robert') } },
        ],
      };
      const result = await service.findAccessibleSeniors(USER_A);
      expect(result.map((r) => r.senior.id)).toEqual([SENIOR_A, SENIOR_B]);
    });
  });
});

describe('CareCircleService (Phase 49)', () => {
  let mockPrisma: Record<string, any>;
  let mockAuth: Record<string, any>;
  let service: CareCircleService;
  let audited: string[];
  let rawSqlCalls: number[];

  beforeEach(() => {
    audited = [];
    rawSqlCalls = [];
    mockPrisma = {
      careCircle: {
        findFirst: async ({ where }: any) =>
          where.id === CIRCLE_A && where.deletedAt === null
            ? { id: CIRCLE_A, seniorId: SENIOR_A, name: 'Family circle', createdById: USER_A }
            : null,
        create: async ({ data }: any) => ({
          ...data,
          id: 'c-new',
          createdAt: new Date('2026-02-02T00:00:00.000Z'),
        }),
      },
      careCircleMember: {
        findFirst: async ({ where }: any) =>
          where.id === 'm-existing' ? memberRow({ id: 'm-existing', role: 'FAMILY_MEMBER' }) : null,
        findUnique: async () => null,
        findMany: async () => [memberRow()],
        count: async () => 0,
        create: async ({ data }: any) => memberRow({ ...data, id: 'm-new' }),
        update: async ({ where, data }: any) => memberRow({ id: where.id, ...data }),
      },
      user: {
        findUnique: async ({ where }: any) => {
          if (where.id === INACTIVE_USER) return { id: where.id, isActive: false, deletedAt: null };
          if (where.id === DELETED_USER) return { id: where.id, isActive: true, deletedAt: new Date() };
          if (where.id === 'ghost-user') return null;
          // Both USER_A (the actor) and USER_B (the add-member target) are usable.
          if (where.id === USER_A || where.id === USER_B) {
            return { id: where.id, isActive: true, deletedAt: null };
          }
          return null;
        },
      },
      // SEC49-01: removeMember takes a row lock as its first transactional
      // statement. Recorded so a test can assert the lock is issued.
      $queryRaw: async () => {
        rawSqlCalls.push(1);
        return [];
      },
      auditLog: {
        create: async ({ data }: any) => {
          audited.push(data.action);
          return { id: 'audit-1' };
        },
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };
    mockAuth = {
      assertCanAccessSenior: async () => undefined,
      isFamilyAdmin: async () => true,
    };
    service = new CareCircleService(
      mockPrisma as unknown as PrismaService,
      mockAuth as unknown as AuthorizationService,
    );
  });

  describe('createCircle', () => {
    it('gives the creator an ACTIVE FAMILY_ADMIN membership in the new circle', async () => {
      const result = await service.createCircle(USER_A, { seniorId: SENIOR_A, name: ' Clinical team ' });
      expect(result.careCircle.name).toBe('Clinical team');
      expect(result.membership).toMatchObject({ role: 'FAMILY_ADMIN', status: 'ACTIVE', userId: USER_A });
      expect(audited).toEqual(['care_circle.created']);
    });

    it('rejects a non-admin member of the same senior', async () => {
      mockAuth.isFamilyAdmin = async () => false;
      await expect(service.createCircle(USER_B, { seniorId: SENIOR_A, name: 'Clinical' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a user with no membership on the senior at all', async () => {
      mockAuth.assertCanAccessSenior = async () => {
        throw new ForbiddenException('Access denied');
      };
      await expect(service.createCircle(USER_B, { seniorId: SENIOR_A, name: 'Clinical' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('reports a duplicate circle name for the same senior as 409', async () => {
      mockPrisma.careCircle.findFirst = async () => ({ id: 'c-other' });
      await expect(service.createCircle(USER_A, { seniorId: SENIOR_A, name: 'Clinical' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('maps a lost unique-constraint race to the same 409', async () => {
      mockPrisma.$transaction = async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      };
      await expect(service.createCircle(USER_A, { seniorId: SENIOR_A, name: 'Clinical' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('addMember', () => {
    it('creates an ACTIVE membership and audits it', async () => {
      const member = await service.addMember(USER_A, CIRCLE_A, { userId: USER_B, role: 'FAMILY_MEMBER' });
      expect(member).toMatchObject({ userId: USER_B, role: 'FAMILY_MEMBER', status: 'ACTIVE', endsAt: null });
      expect(audited).toEqual(['care_circle.member.added']);
    });

    it('rejects a non-admin before touching the target account', async () => {
      mockAuth.isFamilyAdmin = async () => false;
      await expect(
        service.addMember(USER_B, CIRCLE_A, { userId: USER_B, role: 'FAMILY_MEMBER' }),
      ).rejects.toThrow(ForbiddenException);
      expect(audited).toEqual([]);
    });

    it('404s an unknown circle, so circle ids are not enumerable', async () => {
      await expect(
        service.addMember(USER_A, '99999999-9999-4999-8999-999999999999', { userId: USER_B, role: 'FAMILY_MEMBER' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s a target account that is unknown, inactive or deleted', async () => {
      await expect(
        service.addMember(USER_A, CIRCLE_A, {
          userId: 'cccccccc-1111-4111-8111-111111111111',
          role: 'FAMILY_MEMBER',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports an existing ACTIVE membership as 409 rather than creating a second row', async () => {
      mockPrisma.careCircleMember.findUnique = async () => ({
        id: 'm-existing',
        status: 'ACTIVE',
        deletedAt: null,
        role: 'FAMILY_MEMBER',
      });
      await expect(
        service.addMember(USER_A, CIRCLE_A, { userId: USER_B, role: 'FAMILY_MEMBER' }),
      ).rejects.toThrow(ConflictException);
      expect(audited).toEqual([]);
    });

    it('restores an ENDED membership in place — the unique constraint forbids a second row', async () => {
      let updated: any;
      mockPrisma.careCircleMember.findUnique = async () => ({
        id: 'm-ended',
        status: 'ENDED',
        deletedAt: null,
        role: 'FAMILY_MEMBER',
      });
      mockPrisma.careCircleMember.update = async ({ where, data }: any) => {
        updated = { where, data };
        return memberRow({ id: where.id, ...data });
      };

      const res = await service.addMember(USER_A, CIRCLE_A, { userId: USER_B, role: 'CAREGIVER' });
      expect(updated.where).toEqual({ id: 'm-ended' });
      expect(updated.data).toMatchObject({ status: 'ACTIVE', endsAt: null, role: 'CAREGIVER' });
      expect(res).toMatchObject({ id: 'm-ended', status: 'ACTIVE', role: 'CAREGIVER' });
      expect(audited).toEqual(['care_circle.member.added']);
    });

    it('lets only the circle creator mint another family admin', async () => {
      await expect(
        service.addMember(USER_A, CIRCLE_A, { userId: USER_B, role: 'FAMILY_ADMIN' }),
      ).resolves.toMatchObject({ role: 'FAMILY_ADMIN' });

      mockPrisma.careCircle.findFirst = async () => ({
        id: CIRCLE_A,
        seniorId: SENIOR_A,
        name: 'Family circle',
        createdById: 'someone-else',
      });
      await expect(
        service.addMember(USER_A, CIRCLE_A, { userId: USER_B, role: 'FAMILY_ADMIN' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listMembers', () => {
    it('returns the roster without disclosing member email addresses', async () => {
      const result = await service.listMembers(USER_B, CIRCLE_A);
      expect(result.careCircle.id).toBe(CIRCLE_A);
      expect(result.members[0].memberName).toBe('Member B');
      expect(Object.keys(result.members[0])).not.toContain('email');
    });

    it('denies a user with no membership on the circle senior', async () => {
      mockAuth.assertCanAccessSenior = async () => {
        throw new ForbiddenException('Access denied');
      };
      await expect(service.listMembers(USER_B, CIRCLE_A)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('ends the membership and sets endsAt, so access is revoked twice over', async () => {
      const ended = await service.removeMember(USER_A, CIRCLE_A, 'm-existing');
      expect(ended.status).toBe('ENDED');
      expect(ended.endsAt).not.toBeNull();
      expect(audited).toEqual(['care_circle.member.ended']);
    });

    it('refuses to remove the last usable family admin', async () => {
      mockPrisma.careCircleMember.findFirst = async () => memberRow({ role: 'FAMILY_ADMIN' });
      mockPrisma.careCircleMember.count = async () => 0;
      await expect(service.removeMember(USER_A, CIRCLE_A, 'm-existing')).rejects.toThrow(ConflictException);
      expect(audited).toEqual([]);
    });

    it('is idempotent for an already-ended membership', async () => {
      mockPrisma.careCircleMember.findFirst = async () =>
        memberRow({ status: 'ENDED', endsAt: new Date('2026-01-02T00:00:00.000Z') });
      const res = await service.removeMember(USER_A, CIRCLE_A, 'm-existing');
      expect(res.status).toBe('ENDED');
      expect(audited).toEqual([]);
    });

    it('404s a member id belonging to a different circle', async () => {
      mockPrisma.careCircleMember.findFirst = async () => null;
      await expect(service.removeMember(USER_A, CIRCLE_A, 'm-other')).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-admin', async () => {
      mockAuth.isFamilyAdmin = async () => false;
      await expect(service.removeMember(USER_B, CIRCLE_A, 'm-existing')).rejects.toThrow(ForbiddenException);
    });

    // SEC49-01
    it('takes a row lock as the first transactional statement (the anti-TOCTOU fix)', async () => {
      const order: string[] = [];
      mockPrisma.careCircleMember.findFirst = async () => memberRow({ role: 'FAMILY_ADMIN' });
      mockPrisma.$queryRaw = async () => { order.push('lock'); return []; };
      mockPrisma.careCircleMember.count = async () => { order.push('count'); return 1; };
      mockPrisma.careCircleMember.update = async ({ where, data }: any) => {
        order.push('update');
        return memberRow({ id: where.id, ...data });
      };

      await service.removeMember(USER_A, CIRCLE_A, 'm-existing');
      // Lock -> count -> update. Reading the admin count before taking the lock
      // is exactly the defect the review identified.
      expect(order).toEqual(['lock', 'count', 'update']);
    });

    it('runs the last-admin count INSIDE the transaction, not outside it', async () => {
      let insideTx = false;
      mockPrisma.careCircleMember.findFirst = async () => memberRow({ role: 'FAMILY_ADMIN' });
      mockPrisma.$transaction = async (cb: any) => {
        insideTx = true;
        return cb(mockPrisma);
      };
      let sawTx = false;
      mockPrisma.careCircleMember.count = async () => { sawTx = insideTx; return 1; };

      await service.removeMember(USER_A, CIRCLE_A, 'm-existing');
      expect(sawTx).toBe(true);
    });

    it('re-reads the target row under the lock so a concurrent end is observed', async () => {
      let reads = 0;
      mockPrisma.careCircleMember.findFirst = async () => {
        reads += 1;
        return memberRow({ id: 'm-existing', role: 'FAMILY_MEMBER' });
      };
      await service.removeMember(USER_A, CIRCLE_A, 'm-existing');
      // Once as a pre-check, once under the lock.
      expect(reads).toBe(2);
    });

    it('writes no audit row when the last-admin guard rejects the removal', async () => {
      mockPrisma.careCircleMember.findFirst = async () => memberRow({ role: 'FAMILY_ADMIN' });
      mockPrisma.careCircleMember.count = async () => 0;
      await expect(service.removeMember(USER_A, CIRCLE_A, 'm-existing')).rejects.toThrow(ConflictException);
      expect(audited).toEqual([]);
      expect(rawSqlCalls.length).toBe(1);
    });

    // SEC49-04
    it('refuses to act for a deactivated account', async () => {
      await expect(service.createCircle(INACTIVE_USER, { seniorId: SENIOR_A, name: 'X' })).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(
        service.addMember(INACTIVE_USER, CIRCLE_A, { userId: USER_B, role: 'FAMILY_MEMBER' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(service.removeMember(INACTIVE_USER, CIRCLE_A, 'm-existing')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(audited).toEqual([]);
    });

    it('refuses to act for a soft-deleted or unknown account', async () => {
      await expect(service.removeMember(DELETED_USER, CIRCLE_A, 'm-existing')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.removeMember('ghost-user', CIRCLE_A, 'm-existing')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('checks liveness BEFORE authorization, so no lock or query is attempted', async () => {
      await expect(service.removeMember(INACTIVE_USER, CIRCLE_A, 'm-existing')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(rawSqlCalls.length).toBe(0);
      expect(audited).toEqual([]);
    });
  });
});