/**
 * Phase 49 — the acceptance proof for the senior access path.
 *
 * Addresses PR-48-01 (no way to create a SeniorProfile / CareCircle /
 * CareCircleMember), PR-48-02 (no way to obtain a seniorId) and PR-48-03
 * (every senior-scoped capability returns 403 for a legitimate user).
 *
 * The journey exercised here is the one Phase 48 could not reach at all, and
 * it runs over real HTTP with real credentials — a user registers and logs in
 * through the PUBLIC auth routes, rather than being handed a row and a
 * signed token by a fixture:
 *
 *   fresh user
 *     -> POST /seniors                    (senior + circle + FAMILY_ADMIN membership)
 *     -> GET  /me/seniors                 (resolve the accessible senior)
 *     -> POST/GET on pre-existing senior-scoped domains (no longer 403)
 *
 *   unrelated user
 *     -> GET  /me/seniors                 (empty — cannot see the other senior)
 *     -> GET/POST on the same senior      (403)
 *     -> POST /care-circles/:id/members   (403 — cannot grant itself access)
 *
 *   legitimate membership
 *     -> an admin adds the second user    (201)
 *     -> the second user can now read     (200)
 *     -> duplicate add                    (409)
 *     -> removal / expired endsAt         (403 again)
 *
 * Real database (DATABASE_URL); skipped without one so the suite can never
 * pass vacuously.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const PASSWORD = 'CareCircle49pass';
const ISO = '2026-05-01T09:00:00.000Z';

interface Account {
  userId: string;
  email: string;
  token: string;
}

describeDb('Phase 49 — senior onboarding and accessible-senior resolution (real database, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: Account;
  let b: Account;

  let seniorA: string;
  let circleA: string;

  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  // Tracked precisely so teardown can remove exactly this run's rows rather
  // than pattern-matching on names that other suites also use.
  const createdSeniorIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdCircleIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (acct: Account) => `Bearer ${acct.token}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: DB_URL });
    await prisma.$connect();
    app = await createTestApp();

    // The measurement domain needs a catalogue entry; a freshly migrated
    // throwaway database has none because the seed is not applied by
    // `prisma migrate deploy`.
    await prisma.healthMeasurementType.create({
      data: { key: `p49-hr-${runId}`, displayName: 'Heart Rate', schema: { kind: 'scalar' } },
    });

    a = await register(`a-${runId}`);
    b = await register(`b-${runId}`);
  });

  async function register(label: string): Promise<Account> {
    const email = `p49-${label}@example.com`;
    const reg = await http().post('/api/v1/auth/register').send({ email, password: PASSWORD, fullName: `P49 ${label}` });
    expect(reg.status).toBe(201);

    const login = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(201);

    createdUserIds.push(login.body.user.id);
    return { userId: login.body.user.id, email, token: login.body.access };
  }

  /** Provision a senior through the API and record it for teardown. */
  async function provision(
    acct: Account,
    fullName: string,
    circleName?: string,
  ): Promise<{ seniorId: string; circleId: string; memberId: string }> {
    const res = await http()
      .post('/api/v1/seniors')
      .set('Authorization', auth(acct))
      .send(circleName ? { fullName, circleName } : { fullName });
    expect(res.status).toBe(201);
    createdSeniorIds.push(res.body.senior.id);
    createdCircleIds.push(res.body.careCircle.id);
    return {
      seniorId: res.body.senior.id,
      circleId: res.body.careCircle.id,
      memberId: res.body.membership.id,
    };
  }

  afterAll(async () => {
    await app?.close();

    const users = [...createdUserIds];
    const seniors = [...createdSeniorIds];

    // Order matters: referencing rows before the rows they point at.
    // Deleting a senior cascades its circles, memberships and care data;
    // `CareCircle.createdById` is ON DELETE RESTRICT, so circles must go first
    // (which the senior cascade achieves).
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
    if (seniors.length) await prisma.auditLog.deleteMany({ where: { seniorId: { in: seniors } } });
    if (seniors.length) await prisma.notification.deleteMany({ where: { seniorId: { in: seniors } } });
    if (seniors.length) await prisma.healthMeasurement.deleteMany({ where: { seniorId: { in: seniors } } });
    if (seniors.length) await prisma.documentAccess.deleteMany({ where: { seniorId: { in: seniors } } });
    if (seniors.length) await prisma.healthDocument.deleteMany({ where: { seniorId: { in: seniors } } });
    if (createdCircleIds.length) await prisma.careCircle.deleteMany({ where: { id: { in: createdCircleIds } } });
    if (seniors.length) await prisma.seniorProfile.deleteMany({ where: { id: { in: seniors } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: users } } });
    await prisma.healthMeasurementType.deleteMany({ where: { key: `p49-hr-${runId}` } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });

    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe('authentication is required', () => {
    it('POST /seniors is 401 without a token', async () => {
      const res = await http().post('/api/v1/seniors').send({ fullName: 'Anonymous Senior' });
      expect(res.status).toBe(401);
    });

    it('GET /me/seniors is 401 without a token', async () => {
      const res = await http().get('/api/v1/me/seniors');
      expect(res.status).toBe(401);
    });

    it('care-circle routes are 401 without a token', async () => {
      expect((await http().post('/api/v1/care-circles').send({ seniorId: seniorA, name: 'X' })).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('the blocker this phase closes (PR-48-02 / PR-48-03)', () => {
    it('a brand-new authenticated user has no accessible seniors', async () => {
      const res = await http().get('/api/v1/me/seniors').set('Authorization', auth(a));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('and therefore every senior-scoped domain is 403 before any membership exists', async () => {
      const onboarded = await provision(a, 'Margaret Chen');
      seniorA = onboarded.seniorId;
      circleA = onboarded.circleId;

      // User B is a legitimate, authenticated account with a valid token and
      // no membership anywhere. This is PR-48-03 in one assertion per domain.
      for (const path of [
        'medications',
        'appointments',
        'measurements',
        'documents',
        'emergency-alerts',
        'feed',
        'conversations',
      ]) {
        const res = await http().get(`/api/v1/seniors/${seniorA}/${path}`).set('Authorization', auth(b));
        expect(res.status, path).toBe(403);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('onboarding', () => {
    it('creates the senior, its founding circle, and an ACTIVE FAMILY_ADMIN membership', async () => {
      const res = await http()
        .post('/api/v1/seniors')
        .set('Authorization', auth(a))
        .send({ fullName: 'Doris Whitfield', preferredName: 'Doris', dateOfBirth: '1940-04-01', circleName: 'Inner family' });
      createdSeniorIds.push(res.body.senior.id);
      createdCircleIds.push(res.body.careCircle.id);

      expect(res.status).toBe(201);
      expect(res.body.senior.fullName).toBe('Doris Whitfield');
      expect(res.body.senior.preferredName).toBe('Doris');
      expect(res.body.senior.dateOfBirth).toBe('1940-04-01');
      expect(res.body.careCircle.name).toBe('Inner family');
      expect(res.body.membership).toMatchObject({ role: 'FAMILY_ADMIN', status: 'ACTIVE' });

      // The rows really are there, and they are the rows AuthorizationService reads.
      const membership = await prisma.careCircleMember.findUnique({ where: { id: res.body.membership.id } });
      expect(membership).toMatchObject({ userId: a.userId, status: 'ACTIVE', endsAt: null, role: 'FAMILY_ADMIN' });
    });

    it('writes audit events for both the senior and the circle', async () => {
      const actions = await prisma.auditLog.findMany({
        where: { seniorId: seniorA, action: { in: ['senior_profile.created', 'care_circle.created'] } },
        select: { action: true },
      });
      expect(actions.map((x) => x.action).sort()).toEqual(['care_circle.created', 'senior_profile.created']);
    });

    it('rejects an invalid payload', async () => {
      const cases: Array<[Record<string, unknown>, number]> = [
        [{}, 400],
        [{ fullName: '' }, 400],
        [{ fullName: 'X'.repeat(201) }, 400],
        [{ fullName: 'Valid', dateOfBirth: '2026-13-45' }, 400],
        [{ fullName: 'Valid', dateOfBirth: '2999-01-01' }, 400],
        [{ fullName: 'Valid', dateOfBirth: '1940-02-31' }, 400],
        [{ fullName: 'Valid', circleName: 'x'.repeat(121) }, 400],
      ];
      for (const [payload] of cases) {
        const res = await http().post('/api/v1/seniors').set('Authorization', auth(a)).send(payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
      }
    });

    it('rejects unknown fields — the whitelist is strict', async () => {
      const res = await http()
        .post('/api/v1/seniors')
        .set('Authorization', auth(a))
        .send({ fullName: 'Valid', isActive: false, deletedAt: null });
      expect(res.status).toBe(400);
    });

    it('one user may provision more than one senior; the circle-name default is per senior', async () => {
      const first = await provision(a, 'Margaret Chen');
      const second = await provision(a, 'Robert Chen');
      expect(first.seniorId).not.toBe(second.seniorId);
      // Both default to the same circle name, which is legal: the
      // @@unique([seniorId, name]) constraint is scoped per senior.
      const circles = await prisma.careCircle.findMany({
        where: { id: { in: [first.circleId, second.circleId] } },
        select: { name: true },
      });
      expect(circles.map((c) => c.name)).toEqual(['Family circle', 'Family circle']);
    });
  });

  // -------------------------------------------------------------------------
  describe('accessible senior resolution (PR-48-02)', () => {
    it('lists every senior the caller holds an ACTIVE membership for', async () => {
      const res = await http().get('/api/v1/me/seniors').set('Authorization', auth(a));
      expect(res.status).toBe(200);
      const ids = res.body.map((s: { senior: { id: string } }) => s.senior.id);
      expect(ids).toContain(seniorA);
      const entry = res.body.find((s: { senior: { id: string } }) => s.senior.id === seniorA);
      expect(entry.role).toBe('FAMILY_ADMIN');
      expect(entry.senior.fullName).toBe('Margaret Chen');
    });

    it('returns an empty list for a user with no membership', async () => {
      const res = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('does not expose another user\'s senior', async () => {
      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      const leaked = mine.body.some((s: { senior: { id: string } }) => s.senior.id === seniorA);
      expect(leaked).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('existing senior-scoped domains become reachable (PR-48-03)', () => {
    it('medications: create then read', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/medications`)
        .set('Authorization', auth(a))
        .send({ name: 'Metformin', dosage: '500 mg', startDate: '2026-01-01' });
      expect(created.status).toBe(201);

      const list = await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
      expect(list.body.some((m: { id: string }) => m.id === created.body.id)).toBe(true);
    });

    it('appointments: create then read', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/appointments`)
        .set('Authorization', auth(a))
        .send({ title: 'Cardiology', startsAt: ISO });
      expect(created.status).toBe(201);

      const list = await http().get(`/api/v1/seniors/${seniorA}/appointments`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
    });

    it('health measurements: create then read', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/measurements`)
        .set('Authorization', auth(a))
        .send({
          measurementTypeKey: `p49-hr-${runId}`,
          value: { kind: 'scalar', value: 72, unit: 'bpm' },
          measuredAt: ISO,
        });
      expect(created.status).toBe(201);

      const list = await http().get(`/api/v1/seniors/${seniorA}/measurements`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
    });

    it('emergency alerts: create then read', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/emergency-alerts`)
        .set('Authorization', auth(a))
        .send({ type: 'FALL', severity: 'HIGH', source: 'p49-e2e' });
      expect(created.status).toBe(201);

      const list = await http().get(`/api/v1/seniors/${seniorA}/emergency-alerts`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
    });

    it('family feed: create then read', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/feed`)
        .set('Authorization', auth(a))
        .send({ body: 'Appointment went well', visibility: 'CIRCLE' });
      expect(created.status).toBe(201);

      const list = await http().get(`/api/v1/seniors/${seniorA}/feed`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
    });

    it('messaging: create a conversation then post a message', async () => {
      const convo = await http().post(`/api/v1/seniors/${seniorA}/conversations`).set('Authorization', auth(a));
      expect(convo.status).toBe(201);

      const msg = await http()
        .post(`/api/v1/seniors/${seniorA}/conversations/${convo.body.id}/messages`)
        .set('Authorization', auth(a))
        .send({ body: 'Ping from the care circle' });
      expect(msg.status).toBe(201);

      const list = await http().get(`/api/v1/seniors/${seniorA}/conversations`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
    });

    it('documents: list is reachable', async () => {
      const list = await http().get(`/api/v1/seniors/${seniorA}/documents`).set('Authorization', auth(a));
      expect(list.status).toBe(200);
    });

    it('care tasks are mounted (Phase 50 remediation — P1 blocker)', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${seniorA}/tasks`)
        .set('Authorization', auth(a))
        .send({ title: 'Refill prescriptions' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
    });
  });

  // -------------------------------------------------------------------------
  describe('isolation (Phase 49 §11)', () => {
    it('an unrelated user is 403 on every senior-scoped read', async () => {
      for (const path of [
        'medications',
        'appointments',
        'measurements',
        'documents',
        'emergency-alerts',
        'feed',
        'conversations',
      ]) {
        const res = await http().get(`/api/v1/seniors/${seniorA}/${path}`).set('Authorization', auth(b));
        expect(res.status, path).toBe(403);
      }
    });

    it('an unrelated user cannot write to the other senior', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${seniorA}/medications`)
        .set('Authorization', auth(b))
        .send({ name: 'Injected', dosage: '1 mg' });
      expect(res.status).toBe(403);
    });

    it('an unrelated user cannot create a circle for the other senior', async () => {
      const res = await http()
        .post('/api/v1/care-circles')
        .set('Authorization', auth(b))
        .send({ seniorId: seniorA, name: 'Intruder circle' });
      expect(res.status).toBe(403);
    });

    it('an unrelated user cannot add itself to the other senior\'s circle', async () => {
      const res = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(b))
        .send({ userId: b.userId, role: 'FAMILY_ADMIN' });
      expect(res.status).toBe(403);
    });

    it('an unrelated user cannot list or mutate the other senior\'s roster', async () => {
      const list = await http().get(`/api/v1/care-circles/${circleA}/members`).set('Authorization', auth(b));
      expect(list.status).toBe(403);

      const membership = await prisma.careCircleMember.findFirst({
        where: { circleId: circleA, userId: a.userId },
        select: { id: true },
      });
      const del = await http()
        .delete(`/api/v1/care-circles/${circleA}/members/${membership!.id}`)
        .set('Authorization', auth(b));
      expect(del.status).toBe(403);
    });

    it('the other user can still onboard their own senior, independently', async () => {
      const own = await provision(b, 'Eunice Park');
      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].senior.id).toBe(own.seniorId);
    });
  });

  // -------------------------------------------------------------------------
  describe('care-circle and membership management', () => {
    it('the senior\'s family admin can open a second circle', async () => {
      const res = await http()
        .post('/api/v1/care-circles')
        .set('Authorization', auth(a))
        .send({ seniorId: seniorA, name: 'Clinical team', description: 'GP and specialist' });
      createdCircleIds.push(res.body.careCircle.id);
      expect(res.status).toBe(201);
      expect(res.body.membership).toMatchObject({ role: 'FAMILY_ADMIN', status: 'ACTIVE', userId: a.userId });
    });

    it('a duplicate circle name for the same senior is 409', async () => {
      const res = await http()
        .post('/api/v1/care-circles')
        .set('Authorization', auth(a))
        .send({ seniorId: seniorA, name: 'Clinical team' });
      expect(res.status).toBe(409);
    });

    it('rejects an invalid circle payload', async () => {
      const cases: Array<[Record<string, unknown>, number]> = [
        [{ name: 'No senior' }, 400],
        [{ seniorId: 'not-a-uuid', name: 'X' }, 400],
        [{ seniorId: seniorA, name: '' }, 400],
        [{ seniorId: seniorA, name: 'X', bogus: true }, 400],
      ];
      for (const [payload] of cases) {
        const res = await http().post('/api/v1/care-circles').set('Authorization', auth(a)).send(payload);
        expect(res.status, JSON.stringify(payload)).toBe(400);
      }
    });

    it('a non-admin member cannot open a circle or manage the roster', async () => {
      const added = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: b.userId, role: 'FAMILY_MEMBER' });
      expect(added.status).toBe(201);

      const circle = await http()
        .post('/api/v1/care-circles')
        .set('Authorization', auth(b))
        .send({ seniorId: seniorA, name: 'Unauthorised circle' });
      expect(circle.status).toBe(403);

      const anotherAdd = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(b))
        .send({ userId: b.userId, role: 'OBSERVER' });
      expect(anotherAdd.status).toBe(403);
    });

    it('a valid membership makes the senior reachable for the second user', async () => {
      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      const entry = mine.body.find((s: { senior: { id: string } }) => s.senior.id === seniorA);
      expect(entry).toBeDefined();
      expect(entry.role).toBe('FAMILY_MEMBER');

      const list = await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(b));
      expect(list.status).toBe(200);
    });

    it('an ended membership can be restored — removal retains the row', async () => {
      const member = await register(`restore-${runId}`);
      const added = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: member.userId, role: 'FAMILY_MEMBER' });
      expect(added.status).toBe(201);

      const row = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: circleA, userId: member.userId },
        select: { id: true },
      });
      const removed = await http()
        .delete(`/api/v1/care-circles/${circleA}/members/${row.id}`)
        .set('Authorization', auth(a));
      expect(removed.status).toBe(200);
      expect((await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(member))).status).toBe(403);

      // `@@unique([circleId, userId])` applies to the retained row, so an
      // insert can never succeed again. The membership must therefore be
      // restored in place, or removal would be irreversible.
      const restored = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: member.userId, role: 'CAREGIVER' });
      expect(restored.status).toBe(201);
      expect(restored.body.id).toBe(row.id);
      expect(restored.body.status).toBe('ACTIVE');

      const rows = await prisma.careCircleMember.count({ where: { circleId: circleA, userId: member.userId } });
      expect(rows).toBe(1);
      expect((await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(member))).status).toBe(200);
    });

    it('a duplicate membership is 409, not a second row', async () => {
      const res = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: b.userId, role: 'FAMILY_MEMBER' });
      expect(res.status).toBe(409);
      const rows = await prisma.careCircleMember.count({ where: { circleId: circleA, userId: b.userId } });
      expect(rows).toBe(1);
    });

    it('rejects an invalid membership role and a non-existent user', async () => {
      const badRole = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: b.userId, role: 'SUPER_ADMIN' });
      expect(badRole.status).toBe(400);

      const badUser = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: '99999999-9999-4999-8999-999999999999', role: 'FAMILY_MEMBER' });
      expect(badUser.status).toBe(404);
    });

    it('only the circle creator may mint another family admin', async () => {
      // `a` creates a second circle, so `a` is that circle's recorded creator.
      const created = await http()
        .post('/api/v1/care-circles')
        .set('Authorization', auth(a))
        .send({ seniorId: seniorA, name: `Clinical ${runId}` });
      expect(created.status).toBe(201);
      const circleC = created.body.careCircle.id;
      createdCircleIds.push(circleC);

      // A second admin is granted by the creator — permitted.
      const coAdmin = await register(`coadmin-${runId}`);
      const granted = await http()
        .post(`/api/v1/care-circles/${circleC}/members`)
        .set('Authorization', auth(a))
        .send({ userId: coAdmin.userId, role: 'FAMILY_ADMIN' });
      expect(granted.status).toBe(201);

      // The co-admin is a genuine FAMILY_ADMIN of the senior, so it can add
      // ordinary members even to `a`'s own circle — family-admin authority is
      // senior-scoped, which is the existing `AuthorizationService` model.
      const third = await register(`third-${runId}`);
      const asAdmin = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(coAdmin))
        .send({ userId: third.userId, role: 'FAMILY_MEMBER' });
      expect(asAdmin.status).toBe(201);
      expect((await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(third))).status).toBe(200);

      // ...but it cannot mint a family admin, because `CareCircle.createdById`
      // for both circles is `a`, not the co-admin.
      const escalate = await http()
        .post(`/api/v1/care-circles/${circleC}/members`)
        .set('Authorization', auth(coAdmin))
        .send({ userId: third.userId, role: 'FAMILY_ADMIN' });
      expect(escalate.status).toBe(403);
    });

    it('the roster is listable and carries no email addresses', async () => {
      const res = await http().get(`/api/v1/care-circles/${circleA}/members`).set('Authorization', auth(a));
      expect(res.status).toBe(200);
      expect(res.body.members.length).toBeGreaterThanOrEqual(2);
      expect(res.body.members.every((m: Record<string, unknown>) => !('email' in m))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('membership removal revokes access (endsAt semantics intact)', () => {
    it('ends the membership and the senior is 403 again', async () => {
      const membership = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: circleA, userId: b.userId },
        select: { id: true },
      });

      const removed = await http()
        .delete(`/api/v1/care-circles/${circleA}/members/${membership.id}`)
        .set('Authorization', auth(a));
      expect(removed.status).toBe(200);
      expect(removed.body.status).toBe('ENDED');
      expect(removed.body.endsAt).not.toBeNull();

      const after = await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(b));
      expect(after.status).toBe(403);

      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      const ids = mine.body.map((s: { senior: { id: string } }) => s.senior.id);
      expect(ids).not.toContain(seniorA);
    });

    it('an expired endsAt revokes access even while status is still ACTIVE', async () => {
      // Re-add, then expire the relationship in place. This is the Phase 16
      // (H10/A3) scenario, reached through the new access path: status stays
      // ACTIVE and only endsAt moves, which is exactly why AuthorizationService
      // checks both.
      await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: b.userId, role: 'FAMILY_MEMBER' });
      const membership = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: circleA, userId: b.userId },
        select: { id: true },
      });
      await prisma.careCircleMember.update({
        where: { id: membership.id },
        data: { status: 'ACTIVE', endsAt: new Date(Date.now() - 86_400_000) },
      });

      const read = await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(b));
      expect(read.status).toBe(403);

      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      const ids = mine.body.map((s: { senior: { id: string } }) => s.senior.id);
      expect(ids).not.toContain(seniorA);
    });

    it('a senior whose own profile is deactivated is not offered', async () => {
      const own = await provision(b, 'Eunice Park (deactivated)');
      await prisma.seniorProfile.update({
        where: { id: own.seniorId },
        data: { isActive: false },
      });

      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(b));
      const ids = mine.body.map((s: { senior: { id: string } }) => s.senior.id);
      expect(ids).not.toContain(own.seniorId);

      // And the deactivated senior is genuinely unreachable, not merely
      // hidden from the list.
      const read = await http().get(`/api/v1/seniors/${own.seniorId}/medications`).set('Authorization', auth(b));
      expect(read.status).toBe(403);

      await prisma.seniorProfile.update({ where: { id: own.seniorId }, data: { isActive: true } });
    });
  });

  // -------------------------------------------------------------------------
  // SEC49-08 — the `status === 'ACTIVE'` predicate must matter on its OWN.
  //
  // Every other denial assertion in this suite removes access by setting BOTH
  // `status = ENDED` AND a past `endsAt`. That makes the two predicates
  // redundant, so a mutation that deleted `status: 'ACTIVE'` from
  // `AuthorizationService.membershipWhere` passed every suite (independent
  // security review, mutation M2).
  //
  // These cases therefore falsify `status` ALONE, with `endsAt` left null, and
  // assert both that senior-scoped authorization refuses AND that
  // `GET /me/seniors` hides the senior. AuthorizationService is NOT modified to
  // satisfy them.
  describe('SEC49-08 — status predicate is decisive independently of endsAt', () => {
    const setStatus = async (userId: string, status: 'ACTIVE' | 'ENDED' | 'PENDING') => {
      await prisma.careCircleMember.updateMany({
        where: { userId, circle: { seniorId: probeSenior } },
        data: { status, endsAt: null },
      });
    };

    let probeSenior: string;
    let probeUser: Awaited<ReturnType<typeof register>>;

    beforeAll(async () => {
      probeUser = await register(`status-${runId}`);
      const own = await provision(probeUser, 'Status Predicate Senior');
      probeSenior = own.seniorId;
    });

    afterAll(async () => {
      await prisma.careCircleMember.updateMany({
        where: { userId: probeUser.userId },
        data: { status: 'ACTIVE', endsAt: null },
      });
    });

    it('baseline: ACTIVE status with endsAt null grants access', async () => {
      await setStatus(probeUser.userId, 'ACTIVE');

      const read = await http()
        .get(`/api/v1/seniors/${probeSenior}/medications`)
        .set('Authorization', auth(probeUser));
      expect(read.status).toBe(200);

      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(probeUser));
      expect(mine.body.map((s: { senior: { id: string } }) => s.senior.id)).toContain(probeSenior);
    });

    it('status = ENDED with endsAt = NULL denies authorization', async () => {
      await setStatus(probeUser.userId, 'ENDED');

      const row = await prisma.careCircleMember.findFirstOrThrow({
        where: { userId: probeUser.userId, circle: { seniorId: probeSenior } },
        select: { id: true, endsAt: true },
      });
      // The premise: `endsAt` is genuinely NULL, so only `status` can deny.
      expect(row.endsAt).toBeNull();

      const read = await http()
        .get(`/api/v1/seniors/${probeSenior}/medications`)
        .set('Authorization', auth(probeUser));
      expect(read.status).toBe(403);
    });

    it('status = ENDED with endsAt = NULL also hides the senior from /me/seniors', async () => {
      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(probeUser));
      expect(mine.status).toBe(200);
      expect(mine.body.map((s: { senior: { id: string } }) => s.senior.id)).not.toContain(probeSenior);
    });

    it('status = PENDING with endsAt = NULL denies authorization', async () => {
      await setStatus(probeUser.userId, 'PENDING');

      const row = await prisma.careCircleMember.findFirstOrThrow({
        where: { userId: probeUser.userId, circle: { seniorId: probeSenior } },
        select: { endsAt: true },
      });
      expect(row.endsAt).toBeNull();

      const read = await http()
        .get(`/api/v1/seniors/${probeSenior}/medications`)
        .set('Authorization', auth(probeUser));
      expect(read.status).toBe(403);

      const mine = await http().get('/api/v1/me/seniors').set('Authorization', auth(probeUser));
      expect(mine.body.map((s: { senior: { id: string } }) => s.senior.id)).not.toContain(probeSenior);
    });
  });

  // -------------------------------------------------------------------------
  // SEC49-01 — the last-usable-FAMILY_ADMIN invariant under CONCURRENCY.
  //
  // Before remediation the guard counted admins OUTSIDE the write transaction,
  // so two concurrent mutual removals both observed "one other admin remains"
  // and both committed, leaving zero usable administrators and the circle
  // permanently unmanageable. The independent review reproduced it as
  // `200 / 200`, zero survivors.
  //
  // These tests issue genuinely concurrent HTTP requests (Promise.all against
  // the same in-process Nest application), so the requests overlap on separate
  // database connections exactly as two real clients would.
  describe('SEC49-01 — last-admin invariant under concurrency', () => {
    const usableAdminCount = (circleId: string) =>
      prisma.careCircleMember.count({
        where: {
          circleId,
          role: 'FAMILY_ADMIN',
          status: 'ACTIVE',
          deletedAt: null,
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
      });

    /** Circle with `admins` family admins, the first of which owns it. */
    async function circleWithAdmins(tag: string, admins: number) {
      const owner = await register(`${tag}-owner-${runId}`);
      const created = await provision(owner, `Race ${tag}`);
      const members = [owner];
      for (let i = 1; i < admins; i += 1) {
        const extra = await register(`${tag}-admin${i}-${runId}`);
        const res = await http()
          .post(`/api/v1/care-circles/${created.circleId}/members`)
          .set('Authorization', auth(owner))
          .send({ userId: extra.userId, role: 'FAMILY_ADMIN' });
        expect(res.status).toBe(201);
        members.push(extra);
      }
      const rows = await prisma.careCircleMember.findMany({
        where: { circleId: created.circleId, userId: { in: members.map((m) => m.userId) } },
        select: { id: true, userId: true },
      });
      const rowOf = (id: string) => rows.find((r) => r.userId === id)!.id;
      return { owner, members, circleId: created.circleId, seniorId: created.seniorId, rowOf };
    }

    it('two admins removing each other concurrently: exactly one wins, one admin remains', async () => {
      // Repeated with fresh fixtures so the result is established as
      // deterministic rather than as a lucky interleaving.
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const f = await circleWithAdmins(`mutual${iteration}`, 2);
        const [a, b] = f.members;

        const [r1, r2] = await Promise.all([
          http().delete(`/api/v1/care-circles/${f.circleId}/members/${f.rowOf(b.userId)}`).set('Authorization', auth(a)),
          http().delete(`/api/v1/care-circles/${f.circleId}/members/${f.rowOf(a.userId)}`).set('Authorization', auth(b)),
        ]);

        // Exactly one request may succeed. The loser is always refused, but the
        // status legitimately differs by interleaving:
        //   409 — the loser still held authorization when it checked, then lost
        //         the lock race and found itself to be the last usable admin;
        //   403 — the winner had already committed, so the loser's membership
        //         was revoked before its authorization check completed.
        // 403 is the stronger answer (it discloses nothing about circle state),
        // so both are accepted; what must never happen is two successes.
        const statuses = [r1.status, r2.status];
        const successes = statuses.filter((x) => x === 200).length;
        const refusals = statuses.filter((x) => x === 409 || x === 403);
        expect(successes, `iteration ${iteration}: statuses ${statuses.join('/')}`).toBe(1);
        expect(refusals.length, `iteration ${iteration}: statuses ${statuses.join('/')}`).toBe(1);

        const survivors = await usableAdminCount(f.circleId);
        expect(survivors, `iteration ${iteration}: invariant violated`).toBeGreaterThanOrEqual(1);

        // The circle must remain manageable by whoever survived — NOT
        // necessarily the owner, since either admin may be the one removed.
        const survivor = await prisma.careCircleMember.findFirstOrThrow({
          where: { circleId: f.circleId, role: 'FAMILY_ADMIN', status: 'ACTIVE', deletedAt: null },
          select: { userId: true },
        });
        const survivorAccount = f.members.find((m) => m.userId === survivor.userId);
        expect(survivorAccount).toBeDefined();

        const roster = await http()
          .get(`/api/v1/care-circles/${f.circleId}/members`)
          .set('Authorization', auth(survivorAccount!));
        expect(roster.status).toBe(200);
      }
    });

    it('three admins, two removed concurrently: at least one admin remains', async () => {
      for (let iteration = 0; iteration < 4; iteration += 1) {
        const f = await circleWithAdmins(`triple${iteration}`, 3);
        const [, b, c] = f.members;

        const results = await Promise.all([
          http().delete(`/api/v1/care-circles/${f.circleId}/members/${f.rowOf(b.userId)}`).set('Authorization', auth(f.owner)),
          http().delete(`/api/v1/care-circles/${f.circleId}/members/${f.rowOf(c.userId)}`).set('Authorization', auth(f.owner)),
        ]);
        expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);

        const survivors = await usableAdminCount(f.circleId);
        expect(survivors, `iteration ${iteration}: invariant violated`).toBeGreaterThanOrEqual(1);
      }
    });

    it('a rejected concurrent removal writes no audit row (no state/audit mismatch)', async () => {
      const f = await circleWithAdmins('audit', 2);
      const [a, b] = f.members;
      const rowA = f.rowOf(a.userId);
      const rowB = f.rowOf(b.userId);

      const auditsBefore = await prisma.auditLog.count({
        where: { action: 'care_circle.member.ended', resourceId: { in: [rowA, rowB] } },
      });

      const [r1, r2] = await Promise.all([
        http().delete(`/api/v1/care-circles/${f.circleId}/members/${rowB}`).set('Authorization', auth(a)),
        http().delete(`/api/v1/care-circles/${f.circleId}/members/${rowA}`).set('Authorization', auth(b)),
      ]);
      const successes = [r1.status, r2.status].filter((s) => s === 200).length;

      const auditsAfter = await prisma.auditLog.count({
        where: { action: 'care_circle.member.ended', resourceId: { in: [rowA, rowB] } },
      });
      // Exactly one audit row per SUCCESSFUL removal, and none for the refusal
      // (whether it surfaced as 409 or 403).
      expect(auditsAfter - auditsBefore).toBe(successes);
      expect(successes).toBe(1);
      expect((await usableAdminCount(f.circleId))).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // SEC49-01 §9 — ordinary (non-concurrent) removal semantics must be unchanged.
  describe('SEC49-01 — ordinary removal semantics preserved', () => {
    it('with two admins, removing one succeeds and one admin remains', async () => {
      const owner = await register(`seq-owner-${runId}`);
      const other = await register(`seq-other-${runId}`);
      const own = await provision(owner, 'Sequential Senior');
      await http()
        .post(`/api/v1/care-circles/${own.circleId}/members`)
        .set('Authorization', auth(owner))
        .send({ userId: other.userId, role: 'FAMILY_ADMIN' });

      const row = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: own.circleId, userId: other.userId },
        select: { id: true },
      });
      const res = await http()
        .delete(`/api/v1/care-circles/${own.circleId}/members/${row.id}`)
        .set('Authorization', auth(owner));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ENDED');

      const admins = await prisma.careCircleMember.count({
        where: { circleId: own.circleId, role: 'FAMILY_ADMIN', status: 'ACTIVE', deletedAt: null },
      });
      expect(admins).toBe(1);
    });

    it('with one admin, removing the final admin is 409', async () => {
      const owner = await register(`last-owner-${runId}`);
      const own = await provision(owner, 'Last Admin Senior');
      const res = await http()
        .delete(`/api/v1/care-circles/${own.circleId}/members/${own.memberId}`)
        .set('Authorization', auth(owner));
      expect(res.status).toBe(409);
    });

    it('an already-ENDED member removal stays idempotent', async () => {
      const owner = await register(`idem-owner-${runId}`);
      const other = await register(`idem-other-${runId}`);
      const own = await provision(owner, 'Idempotent Senior');
      await http()
        .post(`/api/v1/care-circles/${own.circleId}/members`)
        .set('Authorization', auth(owner))
        .send({ userId: other.userId, role: 'FAMILY_MEMBER' });
      const row = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: own.circleId, userId: other.userId },
        select: { id: true },
      });

      const first = await http()
        .delete(`/api/v1/care-circles/${own.circleId}/members/${row.id}`)
        .set('Authorization', auth(owner));
      expect(first.status).toBe(200);

      const second = await http()
        .delete(`/api/v1/care-circles/${own.circleId}/members/${row.id}`)
        .set('Authorization', auth(owner));
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('ENDED');
    });

    it('a non-admin cannot remove a member (403) and a cross-circle member id is 404', async () => {
      const owner = await register(`xown-${runId}`);
      const other = await register(`xoth-${runId}`);
      const ownA = await provision(owner, 'Cross Circle A');
      const ownB = await provision(owner, 'Cross Circle B');
      await http()
        .post(`/api/v1/care-circles/${ownA.circleId}/members`)
        .set('Authorization', auth(owner))
        .send({ userId: other.userId, role: 'FAMILY_MEMBER' });
      const rowInA = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: ownA.circleId, userId: other.userId },
        select: { id: true },
      });

      // Non-admin attempt.
      const nonAdmin = await http()
        .delete(`/api/v1/care-circles/${ownA.circleId}/members/${rowInA.id}`)
        .set('Authorization', auth(other));
      expect(nonAdmin.status).toBe(403);

      // Same member id, different circle.
      const crossCircle = await http()
        .delete(`/api/v1/care-circles/${ownB.circleId}/members/${rowInA.id}`)
        .set('Authorization', auth(owner));
      expect(crossCircle.status).toBe(404);
    });

    // SEC49-04 — the actor-liveness check on mutating care-circle operations.
    it('SEC49-04: a deactivated account cannot add or remove members', async () => {
      const owner = await register(`deact-owner-${runId}`);
      const target = await register(`deact-target-${runId}`);
      const own = await provision(owner, 'Deactivated Actor Senior');

      await prisma.user.update({ where: { id: owner.userId }, data: { isActive: false } });
      try {
        const add = await http()
          .post(`/api/v1/care-circles/${own.circleId}/members`)
          .set('Authorization', auth(owner))
          .send({ userId: target.userId, role: 'FAMILY_MEMBER' });
        expect(add.status).toBe(401);

        const remove = await http()
          .delete(`/api/v1/care-circles/${own.circleId}/members/${own.memberId}`)
          .set('Authorization', auth(owner));
        expect(remove.status).toBe(401);

        const circle = await http()
          .post('/api/v1/care-circles')
          .set('Authorization', auth(owner))
          .send({ seniorId: own.seniorId, name: 'Deactivated Actor Circle' });
        expect(circle.status).toBe(401);
      } finally {
        await prisma.user.update({ where: { id: owner.userId }, data: { isActive: true } });
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('authorization is preserved, not widened (Phase 49 §10)', () => {
    it('a legitimate member is allowed where the domain requires FAMILY_ADMIN', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/medications`)
        .set('Authorization', auth(a))
        .send({ name: 'Atorvastatin', dosage: '20 mg' });
      expect(created.status).toBe(201);

      const deleted = await http()
        .delete(`/api/v1/seniors/${seniorA}/medications/${created.body.id}`)
        .set('Authorization', auth(a));
      expect(deleted.status).toBe(200);
    });

    it('an OBSERVER granted through the new path still cannot write PHI', async () => {
      const observer = await register(`obs2-${runId}`);
      const added = await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: observer.userId, role: 'OBSERVER' });
      expect(added.status).toBe(201);

      // Read is allowed.
      expect((await http().get(`/api/v1/seniors/${seniorA}/medications`).set('Authorization', auth(observer))).status).toBe(200);
      // Write is not.
      const write = await http()
        .post(`/api/v1/seniors/${seniorA}/measurements`)
        .set('Authorization', auth(observer))
        .send({
          measurementTypeKey: `p49-hr-${runId}`,
          value: { kind: 'scalar', value: 70, unit: 'bpm' },
          measuredAt: ISO,
        });
      expect(write.status).toBe(403);
    });

    it('a FAMILY_MEMBER granted through the new path still cannot perform admin acts', async () => {
      const member = await register(`mem-${runId}`);
      await http()
        .post(`/api/v1/care-circles/${circleA}/members`)
        .set('Authorization', auth(a))
        .send({ userId: member.userId, role: 'FAMILY_MEMBER' });

      const created = await http()
        .post(`/api/v1/seniors/${seniorA}/medications`)
        .set('Authorization', auth(a))
        .send({ name: 'Temporary', dosage: '1 mg' });
      expect(created.status).toBe(201);

      const archive = await http()
        .delete(`/api/v1/seniors/${seniorA}/medications/${created.body.id}`)
        .set('Authorization', auth(member));
      expect(archive.status).toBe(403);
    });

    it('the last active family admin cannot be removed', async () => {
      const adminRow = await prisma.careCircleMember.findFirstOrThrow({
        where: { circleId: circleA, userId: a.userId },
        select: { id: true },
      });
      const res = await http()
        .delete(`/api/v1/care-circles/${circleA}/members/${adminRow.id}`)
        .set('Authorization', auth(a));
      expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('the auth contract is unchanged', () => {
    it('GET /auth/me still returns exactly the four identity fields', async () => {
      const res = await http().get('/api/v1/auth/me').set('Authorization', auth(a));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['email', 'fullName', 'globalRole', 'id']);
    });
  });
});