/**
 * Authorization / feed / measurement security regression tests — Phase 16
 * (H6/A4 PRIVATE feed leak, H9/A9 OBSERVER PHI writes, H10/A3 endsAt).
 *
 * Real database (DATABASE_URL); skipped without one so the suite never
 * passes vacuously.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FeedService } from '../modules/feed/services/feed.service';
import { HealthMeasurementService } from '../modules/health/services/measurement.service';

import type { PrismaService } from '../database/prisma.service';
import { AuthorizationService } from './authorization.service';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

describeDb('care-circle authorization + feed + health PHI (real database)', () => {
  let prisma: PrismaClient;
  let authz: AuthorizationService;
  let seniorA: string;
  let seniorB: string;
  let adminA: string; // FAMILY_ADMIN of seniorA
  let memberA: string; // FAMILY_MEMBER of seniorA
  let caregiverA: string; // CAREGIVER of seniorA, ended engagement
  let observerA: string; // OBSERVER of seniorA
  let outsiderB: string; // FAMILY_ADMIN of seniorB only

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: DB_URL });
    await prisma.$connect();
    authz = new AuthorizationService(prisma as unknown as PrismaService);

    const stamp = Date.now();
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: {
          email: `p16z-${tag}-${stamp}@example.com`,
          passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$x$y',
          fullName: `P16 ${tag}`,
          globalRole: 'USER',
        },
      });

    [adminA, memberA, caregiverA, observerA, outsiderB] = (
      await Promise.all(['admin', 'member', 'caregiver', 'observer', 'outsider'].map(mkUser))
    ).map((u) => u.id);

    const creator = adminA;
    const seniors = await Promise.all(
      ['Senior A', 'Senior B'].map((name) => prisma.seniorProfile.create({ data: { fullName: `${name} ${stamp}` } })),
    );
    seniorA = seniors[0].id;
    seniorB = seniors[1].id;

    const circles = await Promise.all(
      [
        { seniorId: seniorA, name: `circle-a-${stamp}` },
        { seniorId: seniorB, name: `circle-b-${stamp}` },
      ].map((c) => prisma.careCircle.create({ data: { ...c, createdById: creator } })),
    );

    await prisma.careCircleMember.createMany({
      data: [
        { circleId: circles[0].id, userId: adminA, role: 'FAMILY_ADMIN' },
        { circleId: circles[0].id, userId: memberA, role: 'FAMILY_MEMBER' },
        // caregiverA's engagement ENDED yesterday — status left ACTIVE on
        // purpose: this is exactly the A3 scenario.
        { circleId: circles[0].id, userId: caregiverA, role: 'CAREGIVER', endsAt: new Date(Date.now() - 86_400_000) },
        { circleId: circles[0].id, userId: observerA, role: 'OBSERVER' },
        { circleId: circles[1].id, userId: outsiderB, role: 'FAMILY_ADMIN' },
      ],
    });

    await prisma.healthMeasurementType.create({
      data: { key: `hr-${stamp}`, displayName: 'Heart Rate', schema: { kind: 'scalar' } },
    }).catch(() => undefined);
    // Idempotent: reuse whatever exists.
    const t = await prisma.healthMeasurementType.findFirst({ orderBy: { createdAt: 'asc' } });
    if (t) (globalThis as Record<string, unknown>).__mtKey = t.key;
  });

  afterAll(async () => {
    // Best-effort cleanup of this run's rows (ids are unique per run).
    await prisma.$disconnect();
  });

  describe('H10/A3 — membership endsAt enforcement', () => {
    it('active membership grants access', async () => {
      await expect(authz.assertCanAccessSenior(adminA, seniorA)).resolves.toBeUndefined();
      expect(await authz.getMemberRole(memberA, seniorA)).toBe('FAMILY_MEMBER');
    });

    it('membership with a past endsAt is denied access even while status=ACTIVE', async () => {
      expect(await authz.canAccessSenior(caregiverA, seniorA)).toBe(false);
      expect(await authz.getMemberRole(caregiverA, seniorA)).toBeNull();
      await expect(authz.assertCanAccessSenior(caregiverA, seniorA)).rejects.toThrow(ForbiddenException);
    });

    it('cross-senior access is denied (circle isolation)', async () => {
      expect(await authz.canAccessSenior(adminA, seniorB)).toBe(false);
      expect(await authz.canAccessSenior(outsiderB, seniorA)).toBe(false);
    });
  });

  describe('H6/A4 — PRIVATE feed visibility', () => {
    const feed = () => new FeedService(prisma as unknown as PrismaService, authz);
    let privateId: string;
    let circleId: string;

    it('seed posts: PRIVATE by memberA, CIRCLE by adminA', async () => {
      const f = feed();
      const priv = await f.createUpdate(seniorA, memberA, { body: 'Private hospice question', visibility: 'PRIVATE' });
      const circ = await f.createUpdate(seniorA, adminA, { body: 'Appointment went well', visibility: 'CIRCLE' });
      privateId = priv.id;
      circleId = circ.id;
    });

    it('the author sees their own PRIVATE post', async () => {
      const f = feed();
      const list = await f.findBySenior(seniorA, memberA);
      expect(list.map((p) => p.id)).toContain(privateId);
    });

    it('a FAMILY_ADMIN cannot see another user\'s PRIVATE post', async () => {
      const f = feed();
      const list = await f.findBySenior(seniorA, adminA);
      const ids = list.map((p) => p.id);
      expect(ids).toContain(circleId);
      expect(ids).not.toContain(privateId);
    });

    it('an OBSERVER cannot see the PRIVATE post', async () => {
      const f = feed();
      const list = await f.findBySenior(seniorA, observerA);
      expect(list.map((p) => p.id)).not.toContain(privateId);
    });

    it('findOne by direct id still hides a foreign PRIVATE post (enumeration attempt)', async () => {
      const f = feed();
      await expect(f.findOne(seniorA, privateId, adminA)).rejects.toThrow(NotFoundException);
      await expect(f.findOne(seniorA, privateId, memberA)).resolves.toMatchObject({ id: privateId });
    });

    it('explicit ?visibility=PRIVATE request never returns another author\'s posts', async () => {
      const f = feed();
      const asAdmin = await f.findBySenior(seniorA, adminA, 'PRIVATE');
      expect(asAdmin).toHaveLength(0);
    });
  });

  describe('H9/A9 — OBSERVER must not write or delete PHI', () => {
    const health = () => new HealthMeasurementService(prisma as unknown as PrismaService, authz);

    it('OBSERVER cannot record a measurement', async () => {
      await expect(
        health().create(seniorA, observerA, {
          measurementTypeKey: String((globalThis as Record<string, unknown>).__mtKey ?? 'blood_pressure'),
          value: { kind: 'scalar', value: 72, unit: 'bpm' },
          measuredAt: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('CAREGIVER (allowed role) can record, and OBSERVER cannot archive it', async () => {
      const h = health();
      // caregiverA's engagement ended (H10) — use memberA who is allowed to write.
      const m = await h.create(seniorA, memberA, {
        measurementTypeKey: String((globalThis as Record<string, unknown>).__mtKey ?? 'blood_pressure'),
        value: { kind: 'scalar', value: 70, unit: 'bpm' },
        measuredAt: '2026-01-01T00:00:00.000Z',
      });
      await expect(h.archive(seniorA, m.id, observerA)).rejects.toThrow(ForbiddenException);
      await expect(h.archive(seniorA, m.id, memberA)).rejects.toThrow(ForbiddenException);
      await expect(h.archive(seniorA, m.id, adminA)).resolves.toMatchObject({ id: m.id });
    });

    it('outsider cannot even list seniorA measurements (cross-circle)', async () => {
      await expect(health().findBySenior(seniorA, outsiderB)).rejects.toThrow(ForbiddenException);
    });
  });
});
