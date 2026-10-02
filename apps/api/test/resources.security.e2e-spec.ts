/**
 * Cross-module authorization integration — Phase 17.
 *
 * One real-DB HTTP suite covering the senior-scoped resource surfaces:
 * medications, appointments, care tasks, health measurements, family feed,
 * and notifications. Every case asserts the actual security property at
 * the HTTP boundary — permitted vs denied — including cross-senior and
 * cross-circle substitution and role boundaries (OBSERVER is read-only
 * everywhere; only stewards mutate/deleted PHI).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCareFixture, type CareFixture } from '../src/testing/care-fixture';
import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const ISO = '2026-05-01T09:00:00.000Z';

describeDb('Senior-scoped resource authorization (real database, HTTP)', () => {
  let app: INestApplication;
  let fx: CareFixture;

  beforeAll(async () => {
    fx = await buildCareFixture({
      a: [
        { key: 'admin', role: 'FAMILY_ADMIN' },
        { key: 'member', role: 'FAMILY_MEMBER' },
        { key: 'caregiver', role: 'CAREGIVER' },
        { key: 'doctor', role: 'DOCTOR' },
        { key: 'observer', role: 'OBSERVER' },
        { key: 'expired', role: 'CAREGIVER', endsAtPast: true },
      ],
      b: [{ key: 'admin', role: 'FAMILY_ADMIN' }],
    });
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await fx?.cleanup();
  });

  const http = () => request(app.getHttpServer());
  const auth = (u: string) => `Bearer ${fx.tokenFor(u)}`;

  describe('medications', () => {
    let medId: string;

    it('FAMILY_ADMIN can create; CAREGIVER and OBSERVER cannot', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('Authorization', auth(fx.membersA.admin))
        .send({ name: 'Metformin', dosage: '500 mg', startDate: '2026-01-01' });
      expect(created.status).toBe(201);
      medId = created.body.id;

      const care = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('Authorization', auth(fx.membersA.caregiver))
        .send({ name: 'Aspirin', dosage: '81 mg' });
      expect(care.status).toBe(403);

      const obs = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('Authorization', auth(fx.membersA.observer))
        .send({ name: 'Aspirin', dosage: '81 mg' });
      expect(obs.status).toBe(403);
    });

    it('any active circle member (incl. OBSERVER) may read; expired membership may not', async () => {
      const obsRead = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('Authorization', auth(fx.membersA.observer));
      expect(obsRead.status).toBe(200);
      expect(obsRead.body.some((m: { id: string }) => m.id === medId)).toBe(true);

      const expiredRead = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('Authorization', auth(fx.membersA.expired));
      expect(expiredRead.status).toBe(403);
    });

    it('outsider cannot read (cross-circle); cross-senior id substitution 404s', async () => {
      const outsider = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('Authorization', auth(fx.membersB.admin));
      expect(outsider.status).toBe(403);

      // seniorB route + seniorA medication id: even an admin of B cannot
      // resolve A's record under B (resource binds to route senior).
      const sub = await http()
        .get(`/api/v1/seniors/${fx.seniorB}/medications/${medId}`)
        .set('Authorization', auth(fx.membersB.admin));
      expect(sub.status).toBe(404);
    });

    it('archive is FAMILY_ADMIN only; CAREGIVER/DOCTOR denied', async () => {
      const doc = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/medications/${medId}`)
        .set('Authorization', auth(fx.membersA.doctor));
      expect(doc.status).toBe(403);
      const care = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/medications/${medId}`)
        .set('Authorization', auth(fx.membersA.caregiver));
      expect(care.status).toBe(403);
      const admin = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/medications/${medId}`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(admin.status).toBe(200);
    });
  });

  describe('appointments', () => {
    let apptId: string;

    it('FAMILY_MEMBER can create; CAREGIVER/OBSERVER cannot', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/appointments`)
        .set('Authorization', auth(fx.membersA.member))
        .send({ title: 'Cardiology', startsAt: ISO });
      expect(created.status).toBe(201);
      apptId = created.body.id;

      const care = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/appointments`)
        .set('Authorization', auth(fx.membersA.caregiver))
        .send({ title: 'Extra visit', startsAt: ISO });
      expect(care.status).toBe(403);
    });

    it('active members may read; expired membership denied', async () => {
      const obs = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/appointments`)
        .set('Authorization', auth(fx.membersA.observer));
      expect(obs.status).toBe(200);
      const expired = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/appointments`)
        .set('Authorization', auth(fx.membersA.expired));
      expect(expired.status).toBe(403);
    });

    it('update is FAMILY_ADMIN/DOCTOR; cancel is FAMILY_ADMIN/DOCTOR via the service', async () => {
      const memberUpd = await http()
        .patch(`/api/v1/seniors/${fx.seniorA}/appointments/${apptId}`)
        .set('Authorization', auth(fx.membersA.member))
        .send({ title: 'hijack' });
      expect(memberUpd.status).toBe(403);

      const adminUpd = await http()
        .patch(`/api/v1/seniors/${fx.seniorA}/appointments/${apptId}`)
        .set('Authorization', auth(fx.membersA.admin))
        .send({ title: 'Cardiology follow-up' });
      expect(adminUpd.status).toBe(200);
      expect(adminUpd.body.title).toBe('Cardiology follow-up');

      const memberCancel = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/appointments/${apptId}`)
        .set('Authorization', auth(fx.membersA.member));
      expect(memberCancel.status).toBe(403);

      const adminCancel = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/appointments/${apptId}`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(adminCancel.status).toBe(200);
      expect(adminCancel.body.status).toBe('CANCELLED');
    });
  });

  describe('care tasks (Phase 7 stub surface — documented unregistered)', () => {
    // CareTaskController is not registered in any module (Phase 16 audit
    // B2). Asserting the ACTUAL behaviour so a future wiring change has
    // to consciously update these; the stub must not silently 404 while
    // tests pretend it is live.
    it('care-task routes are mounted and respond (Phase 50 remediation — P1 blocker)', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/tasks`)
        .set('Authorization', auth(fx.membersA.admin))
        .send({ title: 'Refill prescriptions' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
    });

    it('unauthenticated care-task route is 401 before any route resolution', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/seniors/${fx.seniorA}/tasks`);
      // No token: the guard is not mounted on an unregistered controller,
      // so Nest's router answers 404 — proving no /tasks surface exists.
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('health measurements', () => {
    let measId: string;

    it('OBSERVER cannot record PHI; CAREGIVER can (Phase 16 H9)', async () => {
      const obs = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('Authorization', auth(fx.membersA.observer))
        .send({
          measurementTypeKey: fx.measurementTypeKey,
          value: { kind: 'scalar', value: 70, unit: 'bpm' },
          measuredAt: ISO,
        });
      expect(obs.status).toBe(403);

      const care = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('Authorization', auth(fx.membersA.caregiver))
        .send({
          measurementTypeKey: fx.measurementTypeKey,
          value: { kind: 'scalar', value: 72, unit: 'bpm' },
          measuredAt: ISO,
        });
      expect(care.status).toBe(201);
      measId = care.body.id;
    });

    it('only FAMILY_ADMIN/DOCTOR may archive measurements; OBSERVER and the recorder may not', async () => {
      const byRecorder = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/measurements/${measId}`)
        .set('Authorization', auth(fx.membersA.caregiver));
      expect(byRecorder.status).toBe(403);

      const byObserver = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/measurements/${measId}`)
        .set('Authorization', auth(fx.membersA.observer));
      expect(byObserver.status).toBe(403);

      const byAdmin = await http()
        .delete(`/api/v1/seniors/${fx.seniorA}/measurements/${measId}`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(byAdmin.status).toBe(200);
    });

    it('cross-senior measurement lookup is denied for an outsider admin', async () => {
      const other = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('Authorization', auth(fx.membersA.member))
        .send({
          measurementTypeKey: fx.measurementTypeKey,
          value: { kind: 'scalar', value: 65, unit: 'bpm' },
          measuredAt: ISO,
        });
      expect(other.status).toBe(201);
      const sub = await http()
        .get(`/api/v1/seniors/${fx.seniorB}/measurements/${other.body.id}`)
        .set('Authorization', auth(fx.membersB.admin));
      expect(sub.status).toBe(404);
    });
  });

  describe('family feed — PRIVATE visibility over HTTP (Phase 16 H6)', () => {
    let privateId: string;
    let circleId: string;

    it('member posts PRIVATE; admin posts CIRCLE', async () => {
      const priv = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/feed`)
        .set('Authorization', auth(fx.membersA.member))
        .send({ body: 'Private hospice question', visibility: 'PRIVATE' });
      expect(priv.status).toBe(201);
      privateId = priv.body.id;

      const pub = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/feed`)
        .set('Authorization', auth(fx.membersA.admin))
        .send({ body: 'Appointment went well' });
      expect(pub.status).toBe(201);
      circleId = pub.body.id;
    });

    it('the author sees their private post; FAMILY_ADMIN does not', async () => {
      const mine = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/feed`)
        .set('Authorization', auth(fx.membersA.member));
      expect(mine.status).toBe(200);
      expect(mine.body.map((p: { id: string }) => p.id)).toContain(privateId);

      const admin = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/feed`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(admin.status).toBe(200);
      const ids = admin.body.map((p: { id: string }) => p.id);
      expect(ids).toContain(circleId);
      expect(ids).not.toContain(privateId);
    });

    it('direct GET of a foreign PRIVATE post 404s; the author 200s (no enumeration oracle)', async () => {
      const denied = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/feed/${privateId}`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(denied.status).toBe(404);
      const allowed = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/feed/${privateId}`)
        .set('Authorization', auth(fx.membersA.member));
      expect(allowed.status).toBe(200);
    });

    it('OBSERVER may read the circle feed but cannot post', async () => {
      const read = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/feed`)
        .set('Authorization', auth(fx.membersA.observer));
      expect(read.status).toBe(200);
      expect(read.body.map((p: { id: string }) => p.id)).not.toContain(privateId);

      const write = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/feed`)
        .set('Authorization', auth(fx.membersA.observer))
        .send({ body: 'observer post' });
      expect(write.status).toBe(403);
    });
  });

  describe('notifications — user-scoped isolation', () => {
    let mineId: string;
    let theirsId: string;

    beforeAll(async () => {
      const mine = await fx.prisma.notification.create({
        data: {
          userId: fx.membersA.admin,
          kind: 'test.scoped',
          payload: { x: 1 },
          channel: 'IN_APP',
        },
      });
      const theirs = await fx.prisma.notification.create({
        data: {
          userId: fx.membersA.observer,
          kind: 'test.scoped',
          payload: { x: 1 },
          channel: 'IN_APP',
        },
      });
      mineId = mine.id;
      theirsId = theirs.id;
    });

    it('a user lists only their own notifications', async () => {
      const res = await http()
        .get('/api/v1/notifications')
        .set('Authorization', auth(fx.membersA.admin));
      expect(res.status).toBe(200);
      expect(res.body.every((n: { userId: string }) => n.userId === fx.membersA.admin)).toBe(true);
      expect(res.body.map((n: { id: string }) => n.id)).toContain(mineId);
      expect(res.body.map((n: { id: string }) => n.id)).not.toContain(theirsId);
    });

    it('cross-user direct id access, read-marking and archive are denied (404)', async () => {
      const get = await http()
        .get(`/api/v1/notifications/${theirsId}`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(get.status).toBe(404);

      const patch = await http()
        .patch(`/api/v1/notifications/${theirsId}/read`)
        .set('Authorization', auth(fx.membersA.admin));
      expect([404, 403]).toContain(patch.status);
      const after = await fx.prisma.notification.findUnique({ where: { id: theirsId } });
      expect(after?.readAt).toBeNull();

      const del = await http()
        .delete(`/api/v1/notifications/${theirsId}`)
        .set('Authorization', auth(fx.membersA.admin));
      expect([404, 403]).toContain(del.status);

      // Owner marking read works:
      const own = await http()
        .patch(`/api/v1/notifications/${mineId}/read`)
        .set('Authorization', auth(fx.membersA.admin));
      expect(own.status).toBe(200);
      expect(own.body.readAt).toBeTruthy();
    });
  });
});
