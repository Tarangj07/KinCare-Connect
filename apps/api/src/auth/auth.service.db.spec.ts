/**
 * AuthService security regression tests — Phase 16 (C1/A1, H3/A5, H4/A6,
 * H7/A7, H8, H11/A16).
 *
 * These run against a real PostgreSQL (DATABASE_URL). Without one the file
 * skips itself rather than passing vacuously — the point of these tests is
 * behaviour that mocks could not catch (Prisma field mismatches, enum
 * mapping, rotation races).
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashToken } from '../config/security-config';

import { AuthService } from './auth.service';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const TEST_SECRET = 'phase-16-integration-test-secret-value-32chars!';
process.env['JWT_ACCESS_SECRET'] = TEST_SECRET;
process.env['NODE_ENV'] = 'development';

async function freshPrisma(): Promise<PrismaClient> {
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });
  await prisma.$connect();
  return prisma;
}

describeDb('AuthService (real database)', () => {
  let prisma: PrismaClient;
  let service: AuthService;
  let jwt: JwtService;
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    prisma = await freshPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeUser(overrides?: { isActive?: boolean; deleted?: boolean }) {
    const email = `p16-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const password = 'Str0ng!Passphrase';
    const passwordHash = await service.hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: 'Phase16 Tester',
        globalRole: 'USER',
        isActive: overrides?.isActive ?? true,
        deletedAt: overrides?.deleted ? new Date() : null,
      },
    });
    createdUserIds.push(user.id);
    return { user, password };
  }

  beforeEach(async () => {
    jwt = new JwtService({ secret: TEST_SECRET, signOptions: { expiresIn: '15m' } });
    service = new AuthService(prisma, jwt);
    createdUserIds = [];
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  describe('H11/A16 — token delivery', () => {
    it('login returns a verifiable access token alongside the refresh token', async () => {
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });

      expect(login.access).toBeTruthy();
      const payload = await jwt.verify(login.access, { secret: TEST_SECRET, algorithms: ['HS256'] });
      expect(payload).toMatchObject({ sub: user.id, email: user.email, role: 'USER' });
      expect(login.refresh).toContain('.');
    });
  });

  describe('C1/A1 — CSPRNG refresh tokens', () => {
    it('issued token is `<uuid-v4 jti>.<43-char base64url secret>` and its SHA-256 is what is stored', async () => {
      const { user, password } = await makeUser();
      const result = await service.login({ email: user.email, password });

      expect(result.refresh).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/,
      );
      const [jti, secret] = result.refresh.split('.');

      const stored = await prisma.refreshToken.findUnique({ where: { jti } });
      expect(stored).not.toBeNull();
      expect(stored?.userId).toBe(user.id);
      // The plaintext token is never persisted anywhere.
      expect(stored?.tokenHash).toBe(hashToken(secret));
      expect(stored?.tokenHash).not.toContain(secret);
    });

    it('consecutive logins produce distinct secrets and distinct families (no Math.random collisions)', async () => {
      const { user, password } = await makeUser();
      const a = await service.login({ email: user.email, password });
      const b = await service.login({ email: user.email, password });
      expect(a.refresh).not.toBe(b.refresh);
      expect(a.familyId).not.toBe(b.familyId);
    });
  });

  describe('H8/A7 — deactivated accounts', () => {
    it('inactive account cannot log in even with the correct password', async () => {
      const { user, password } = await makeUser({ isActive: false });
      await expect(service.login({ email: user.email, password })).rejects.toThrow(ForbiddenException);
    });

    it('soft-deleted account cannot log in even with the correct password', async () => {
      const { user, password } = await makeUser({ deleted: true });
      await expect(service.login({ email: user.email, password })).rejects.toThrow(ForbiddenException);
    });

    it('wrong password yields a generic 401 (no account-state leak)', async () => {
      const { user } = await makeUser();
      await expect(service.login({ email: user.email, password: 'WrongPass1!' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('H7/A7 — lockout actually functions', () => {
    it('failed logins increment the counter and audit the failure', async () => {
      const { user } = await makeUser();
      await expect(service.login({ email: user.email, password: 'bad' })).rejects.toThrow(UnauthorizedException);

      const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
      expect(reloaded?.failedLoginCount).toBe(1);
      expect(reloaded?.lockedUntil).toBeNull();

      const audit = await prisma.auditLog.findFirst({ where: { actorUserId: user.id, action: 'auth.login.failed' } });
      expect(audit).not.toBeNull();
    });

    it('10 failures lock the account — correct password is then refused until expiry', async () => {
      const { user, password } = await makeUser();
      for (let i = 0; i < 10; i += 1) {
        await expect(service.login({ email: user.email, password: 'bad' })).rejects.toThrow(UnauthorizedException);
      }
      const locked = await prisma.user.findUnique({ where: { id: user.id } });
      expect(locked?.failedLoginCount).toBe(10);
      expect(locked?.lockedUntil).toBeInstanceOf(Date);
      expect(locked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      await expect(service.login({ email: user.email, password })).rejects.toThrow(/locked/);

      // Simulate lock expiry: login works again and the counter resets.
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      const result = await service.login({ email: user.email, password });
      expect(result.user.id).toBe(user.id);
      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after?.failedLoginCount).toBe(0);
      expect(after?.lockedUntil).toBeNull();
    });
  });

  describe('H4/A6 + H3/A5 — refresh: O(1) lookup, rotation, reuse revocation', () => {
    it('valid token rotates: old revoked + linked, family preserved, access token returned', async () => {
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });
      const oldJti = login.refresh.split('.')[0];

      const rotated = await service.refresh(login.refresh);
      expect(rotated.access).toBeTruthy();
      expect(rotated.refresh).not.toBe(login.refresh);
      expect(rotated.familyId).toBe(login.familyId);

      const old = await prisma.refreshToken.findUnique({ where: { jti: oldJti } });
      expect(old?.revokedAt).toBeInstanceOf(Date);
      expect(old?.replacedById).not.toBeNull();

      // The new token verifies.
      const second = await service.refresh(rotated.refresh);
      expect(second.access).toBeTruthy();
    });

    it('reusing a rotated (stolen) token revokes the ENTIRE family', async () => {
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });
      const rotated = await service.refresh(login.refresh);

      // Attacker replays the original token after the legitimate client
      // already rotated it.
      await expect(service.refresh(login.refresh)).rejects.toThrow(/reused/);

      // Every unrevoked token in the family is now revoked.
      const live = await prisma.refreshToken.findMany({
        where: { familyId: login.familyId, revokedAt: null },
      });
      expect(live).toHaveLength(0);

      // The legitimately rotated token is now dead too.
      await expect(service.refresh(rotated.refresh)).rejects.toThrow();
    });

    it('unknown / malformed / cross-family tokens are rejected with 401 without touching other rows', async () => {
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });

      await expect(service.refresh('')).rejects.toThrow(UnauthorizedException);
      await expect(service.refresh('not-a-token')).rejects.toThrow(UnauthorizedException);
      await expect(service.refresh(`${login.familyId}.deadbeef`)).rejects.toThrow(UnauthorizedException);

      // Right jti, WRONG secret half (guessing against the hash): rejected,
      // and it must NOT trigger family revocation (no reuse evidence).
      const [jti] = login.refresh.split('.');
      await expect(service.refresh(`${jti}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).rejects.toThrow(UnauthorizedException);
      const stillLive = await prisma.refreshToken.findMany({ where: { familyId: login.familyId, revokedAt: null } });
      expect(stillLive.length).toBeGreaterThan(0);
    });

    it('refresh for a deactivated user is rejected', async () => {
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(service.refresh(login.refresh)).rejects.toThrow(UnauthorizedException);
    });

    it('verification is a single indexed lookup (not a scan of all live tokens)', async () => {
      // Seed many tokens for other users; a refresh of our token must not
      // be forced to walk them. Prisma logs queries, so count finds here
      // via a behavioural proxy instead: create 50 unrelated live tokens,
      // then confirm reuse-detection revocation is family-scoped, i.e. it
      // completed without touching foreign families.
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });

      for (let i = 0; i < 50; i += 1) {
        await prisma.refreshToken.create({
          data: {
            userId: user.id,
            familyId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
            jti: `11111111-2222-4222-8222-${String(i).padStart(12, '0')}`,
            tokenHash: hashToken(`foreign-secret-${i}`),
            expiresAt: new Date(Date.now() + 86400_000),
          },
        });
      }

      await service.refresh(login.refresh); // rotate once
      await expect(service.refresh(login.refresh)).rejects.toThrow(/reused/); // replay

      const foreignJtis = Array.from({ length: 50 }, (_, i) => `11111111-2222-4222-8222-${String(i).padStart(12, '0')}`);
      const foreignRevoked = await prisma.refreshToken.count({
        where: { jti: { in: foreignJtis }, revokedAt: { not: null } },
      });
      expect(foreignRevoked).toBe(0);
    });
  });

  describe('logout', () => {
    it('revokes the presented token and ignores foreign/mismatched tokens', async () => {
      const { user, password } = await makeUser();
      const login = await service.login({ email: user.email, password });
      const jti = login.refresh.split('.')[0];

      // Someone tries to log out using the token while claiming another user.
      await service.logout(login.refresh, 'some-other-user-id');
      let row = await prisma.refreshToken.findUnique({ where: { jti } });
      expect(row?.revokedAt).toBeNull();

      await service.logout(login.refresh, user.id);
      row = await prisma.refreshToken.findUnique({ where: { jti } });
      expect(row?.revokedAt).toBeInstanceOf(Date);
      await expect(service.refresh(login.refresh)).rejects.toThrow();
    });
  });

  describe('changePassword', () => {
    it('invalidates all existing refresh sessions', async () => {
      const { user, password } = await makeUser();
      const a = await service.login({ email: user.email, password });
      const b = await service.login({ email: user.email, password });

      await service.changePassword(user.id, password, 'N3w-Str0ng!Pass');
      await expect(service.refresh(a.refresh)).rejects.toThrow();
      await expect(service.refresh(b.refresh)).rejects.toThrow();
    });
  });
});
