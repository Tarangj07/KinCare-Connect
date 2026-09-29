/**
 * Emergency alerts — state machine + authorization + fan-out integration.
 *
 * Phase 17: real-DB HTTP coverage for the Phase 13 controls the
 * mocked service spec could not prove:
 *
 *  - state transitions ACCEPT ACTIVE→ACK→RESOLVED and reject
 *    ACK-after-RESOLVED / CANCEL-after-terminal via conditional updates;
 *  - role policy per operation (OBSERVER cannot create or resolve;
 *    FAMILY_MEMBER cannot resolve/cancel);
 *  - expired membership cannot raise an alert;
 *  - cross-senior alert reads denied;
 *  - notification fan-out: unexpired circle members + senior's own
 *    account are notified; creator, expired members and outsiders are
 *    not; payloads carry ids/severity only — never the alert message;
 *  - audit rows for every transition.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCareFixture, type CareFixture } from '../src/testing/care-fixture';
import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const SECRET_MSG = 'SUSPECTED-STROKE-DO-NOT-LEAK';

describeDb('Emergency alerts (real database, HTTP)', () => {
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

  async function createAlert(userKey: string, message = SECRET_MSG) {
    return http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts`)
      .set('Authorization', auth(fx.membersA[userKey]))
      .send({ type: 'MEDICAL', severity: 'CRITICAL', message, source: 'mobile-sos' });
  }

  it('OBSERVER and expired membership cannot raise alerts; FAMILY_MEMBER can', async () => {
    const obs = await createAlert('observer');
    expect(obs.status).toBe(403);

    const expired = await createAlert('expired');
    expect(expired.status).toBe(403);

    const ok = await createAlert('member');
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('ACTIVE');
    expect(ok.body.createdByUserId).toBe(fx.membersA.member);
  });

  it('invalid enum payload is rejected with 400', async () => {
    const res = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts`)
      .set('Authorization', auth(fx.membersA.member))
      .send({ type: 'ALIEN', severity: 'CRITICAL', source: 'x' });
    expect(res.status).toBe(400);
  });

  it('full happy path ACTIVE → ACKNOWLEDGED → RESOLVED with audit trail', async () => {
    const created = await createAlert('caregiver');
    expect(created.status).toBe(201);
    const id = created.body.id;

    const ack = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/acknowledge`)
      .set('Authorization', auth(fx.membersA.doctor));
    expect(ack.status).toBe(201);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    expect(ack.body.acknowledgedByUserId).toBe(fx.membersA.doctor);

    const resolve = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/resolve`)
      .set('Authorization', auth(fx.membersA.admin));
    expect(resolve.status).toBe(201);
    expect(resolve.body.status).toBe('RESOLVED');
    expect(resolve.body.resolvedByUserId).toBe(fx.membersA.admin);

    const actions = (
      await fx.prisma.auditLog.findMany({
        where: { resourceType: 'emergency_alert', resourceId: id },
        select: { action: true, actorUserId: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'emergency_alert.created',
        'emergency_alert.acknowledged',
        'emergency_alert.resolved',
      ]),
    );
  });

  it('terminal states are protected: cannot ack/cancel/resolve a RESOLVED alert', async () => {
    const created = await createAlert('member');
    const id = created.body.id;
    await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/resolve`)
      .set('Authorization', auth(fx.membersA.admin));

    const ack = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/acknowledge`)
      .set('Authorization', auth(fx.membersA.doctor));
    expect(ack.status).toBe(403);
    const cancel = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/cancel`)
      .set('Authorization', auth(fx.membersA.doctor));
    expect(cancel.status).toBe(403);
    const resolve2 = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/resolve`)
      .set('Authorization', auth(fx.membersA.admin));
    expect(resolve2.status).toBe(403);
  });

  it('concurrent double-acknowledge: exactly one transition applies, final state consistent', async () => {
    const created = await createAlert('caregiver');
    const id = created.body.id;
    const results = await Promise.all([
      http()
        .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/acknowledge`)
        .set('Authorization', auth(fx.membersA.doctor)),
      http()
        .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/acknowledge`)
        .set('Authorization', auth(fx.membersA.admin)),
    ]);
    const winners = results.filter((r) => r.status === 201);
    // Phase 18 (L-04): the losing writer is no longer a 500. Prisma P2025
    // from the lost conditional update is translated into the same
    // ForbiddenException the ordinary invalid-transition path raises, so
    // the race loser now gets an intentional 403 naming the real status.
    expect(winners.length).toBe(1);
    const losers = results.filter((r) => r.status !== 201);
    expect(losers.length).toBe(1);
    for (const loser of losers) {
      expect(loser.status).toBe(403);
      expect(loser.body.error.message).toContain('Invalid transition');
      // The message must name the state the alert actually reached.
      expect(loser.body.error.message).toContain('ACKNOWLEDGED');
    }

    const alert = await fx.prisma.emergencyAlert.findUnique({ where: { id } });
    expect(alert?.status).toBe('ACKNOWLEDGED');
    expect(alert?.acknowledgedByUserId).not.toBeNull();

    // Exactly one acknowledge audit row (no double audit).
    const ackAudits = await fx.prisma.auditLog.count({
      where: {
        resourceType: 'emergency_alert',
        resourceId: id,
        action: 'emergency_alert.acknowledged',
      },
    });
    expect(ackAudits).toBe(1);
  });

  it('Phase 18 L-04: no 500 is produced by any racing transition (ack, resolve, cancel)', async () => {
    // Sweeps the same defect across the other two conditional updates.
    // The loser must always be a 403 with an "Invalid transition" message,
    // never a 500 INTERNAL_ERROR.
    const raceTargets = [
      {
        verb: 'acknowledge',
        auditAction: 'emergency_alert.acknowledged',
        create: () => createAlert('caregiver'),
        path: (id: string) => `/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/acknowledge`,
        actorA: fx.membersA.doctor,
        actorB: fx.membersA.admin,
        expectedState: 'ACKNOWLEDGED',
      },
      {
        verb: 'resolve',
        auditAction: 'emergency_alert.resolved',
        create: () => createAlert('caregiver'),
        path: (id: string) => `/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/resolve`,
        actorA: fx.membersA.admin,
        actorB: fx.membersA.doctor,
        expectedState: 'RESOLVED',
      },
      {
        verb: 'cancel',
        auditAction: 'emergency_alert.cancelled',
        create: () => createAlert('caregiver'),
        path: (id: string) => `/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/cancel`,
        actorA: fx.membersA.caregiver,
        actorB: fx.membersA.doctor,
        expectedState: 'CANCELLED',
      },
    ];

    for (const target of raceTargets) {
      const created = await target.create();
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const results = await Promise.all([
        http().post(target.path(id)).set('Authorization', auth(target.actorA)),
        http().post(target.path(id)).set('Authorization', auth(target.actorB)),
      ]);

      const winners = results.filter((r) => r.status === 201);
      const losers = results.filter((r) => r.status !== 201);
      expect(winners.length, `${target.verb}: exactly one winner`).toBe(1);
      expect(losers.length, `${target.verb}: exactly one loser`).toBe(1);

      for (const loser of losers) {
        // The regression this replaces: `expect(loser.status).toBeGreaterThanOrEqual(400)`
        // also accepted the 500 this fix removes.
        expect(loser.status, `${target.verb}: loser must not be a server error`).toBe(403);
        expect(loser.body.error.code).toBe('FORBIDDEN');
        expect(loser.body.error.message).toContain('Invalid transition');
        expect(loser.body.error.message).toContain(target.expectedState);
      }

      // Exactly one audit row for the winning transition.
      const audits = await fx.prisma.auditLog.count({
        where: {
          resourceType: 'emergency_alert',
          resourceId: id,
          action: target.auditAction,
        },
      });
      expect(audits, `${target.verb}: exactly one audit row`).toBe(1);

      const row = await fx.prisma.emergencyAlert.findUnique({ where: { id } });
      expect(row?.status).toBe(target.expectedState);
    }
  });

  it('Phase 18 L-04: the four failure modes stay distinguishable', async () => {
    // 1) success
    const ok = await createAlert('caregiver');
    const okId = ok.body.id as string;
    const ack = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${okId}/acknowledge`)
      .set('Authorization', auth(fx.membersA.doctor));
    expect(ack.status).toBe(201);
    expect(ack.body.status).toBe('ACKNOWLEDGED');

    // 2) already acknowledged → invalid transition naming the real state
    const again = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${okId}/acknowledge`)
      .set('Authorization', auth(fx.membersA.admin));
    expect(again.status).toBe(403);
    expect(again.body.error.message).toContain('ACKNOWLEDGED');

    // 3) unauthorized (OBSERVER may not acknowledge)
    const obs = await createAlert('caregiver');
    const obsAck = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${obs.body.id}/acknowledge`)
      .set('Authorization', auth(fx.membersA.observer));
    expect(obsAck.status).toBe(403);
    expect(obsAck.body.error.message).not.toContain('Invalid transition');

    // 4) nonexistent / cross-senior resource
    const notThere = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/00000000-0000-4000-8000-000000000999/acknowledge`)
      .set('Authorization', auth(fx.membersA.doctor));
    expect(notThere.status).toBe(403);
    expect(notThere.body.error.message).not.toContain('Invalid transition');

    const crossSenior = await http()
      .post(`/api/v1/seniors/${fx.seniorB}/emergency-alerts/${okId}/acknowledge`)
      .set('Authorization', auth(fx.membersB.admin));
    expect(crossSenior.status).toBe(403);
  });

  it('role policy: FAMILY_MEMBER cannot resolve; CAREGIVER can cancel an ACTIVE alert', async () => {
    const created = await createAlert('member');
    const id = created.body.id;

    const memberResolve = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/resolve`)
      .set('Authorization', auth(fx.membersA.member));
    expect(memberResolve.status).toBe(403);
    const memberCancel = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/cancel`)
      .set('Authorization', auth(fx.membersA.member));
    expect(memberCancel.status).toBe(403);

    const caregiverCancel = await http()
      .post(`/api/v1/seniors/${fx.seniorA}/emergency-alerts/${id}/cancel`)
      .set('Authorization', auth(fx.membersA.caregiver));
    expect(caregiverCancel.status).toBe(201);
    expect(caregiverCancel.body.status).toBe('CANCELLED');
  });

  it('cross-senior isolation: seniorB admin cannot read seniorA alerts by id or list', async () => {
    const created = await createAlert('admin');
    const byId = await http()
      .get(`/api/v1/seniors/${fx.seniorB}/emergency-alerts/${created.body.id}`)
      .set('Authorization', auth(fx.membersB.admin));
    expect(byId.status).toBe(403);

    const listAsOutsider = await http()
      .get(`/api/v1/seniors/${fx.seniorA}/emergency-alerts`)
      .set('Authorization', auth(fx.membersB.admin));
    expect(listAsOutsider.status).toBe(403);

    // Senior A's own admin listing works.
    const list = await http()
      .get(`/api/v1/seniors/${fx.seniorA}/emergency-alerts`)
      .set('Authorization', auth(fx.membersA.admin));
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
  });

  it('fan-out: notified = active unexpired members + senior account; NOT creator/expired/outsiders; message never in payload', async () => {
    const created = await createAlert('caregiver', `EMERGENCY ${SECRET_MSG}`);
    expect(created.status).toBe(201);
    const alertId = created.body.id;

    const notifs = await fx.prisma.notification.findMany({
      where: { kind: 'emergency.alert.created', seniorId: fx.seniorA },
    });
    const recipients = new Set(
      notifs
        .filter((n) => (n.payload as { alertId?: string }).alertId === alertId)
        .map((n) => n.userId),
    );

    expect(recipients.has(fx.membersA.admin)).toBe(true);
    expect(recipients.has(fx.membersA.member)).toBe(true);
    expect(recipients.has(fx.membersA.doctor)).toBe(true);
    expect(recipients.has(fx.membersA.observer)).toBe(true);
    expect(recipients.has(fx.seniorUserA)).toBe(true);
    // Creator excluded:
    expect(recipients.has(fx.membersA.caregiver)).toBe(false);
    // H10: expired engagement must not be notified.
    expect(recipients.has(fx.membersA.expired)).toBe(false);
    // Outsiders:
    expect(recipients.has(fx.membersB.admin)).toBe(false);

    for (const n of notifs.filter((x) => (x.payload as { alertId?: string }).alertId === alertId)) {
      expect(JSON.stringify(n.payload)).not.toContain(SECRET_MSG);
      expect(n.payload).toMatchObject({
        alertId,
        seniorId: fx.seniorA,
        type: 'MEDICAL',
        severity: 'CRITICAL',
      });
    }
  });
});
