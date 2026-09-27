/**
 * Messaging security integration — Phase 17.
 *
 * Replaces the vacuous supertest smoke tests and the two
 * `expect(true).toBe(true)` placeholder assertions from the Phase 11/16
 * suites with behavioural verification against a real database:
 *
 *  - two independent boundaries (care circle AND conversation
 *    participation) enforced end-to-end over HTTP;
 *  - sender identity derived from the JWT, never the body;
 *  - no message-body leakage into audit rows or notification payloads;
 *  - notifications addressed to recipients, not the sender;
 *  - cross-senior/cross-circle/cross-conversation isolation;
 *  - closed-conversation and malformed-reference rejection.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCareFixture, type CareFixture } from '../src/testing/care-fixture';
import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

describeDb('Messaging security (real database, HTTP)', () => {
  let app: INestApplication;
  let fx: CareFixture;
  const BODY_TEXT = 'MEDS-RAN-LOW please call the nurse';

  let conversationId: string;

  beforeAll(async () => {
    fx = await buildCareFixture({
      a: [
        { key: 'admin', role: 'FAMILY_ADMIN' },
        { key: 'member', role: 'FAMILY_MEMBER' },
        { key: 'observer', role: 'OBSERVER' },
      ],
      b: [{ key: 'admin', role: 'FAMILY_ADMIN' }],
    });
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await fx?.cleanup();
  });

  async function auth(userId: string) {
    return fx.tokenFor(userId);
  }

  it('participant can create a conversation and send a message; server binds sender + senior', async () => {
    const adminId = fx.membersA.admin;
    const convRes = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations`)
      .set('Authorization', `Bearer ${await auth(adminId)}`)
      .send();
    conversationId = convRes.body.id;
    expect(convRes.body.seniorId).toBe(fx.seniorA);

    // Server binds sender + senior + conversation from JWT/route only.
    const msgRes = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(adminId)}`)
      .send({ body: BODY_TEXT });
    expect(msgRes.status).toBe(201);
    expect(msgRes.body.senderUserId).toBe(adminId);
    expect(msgRes.body.conversationId).toBe(conversationId);
    expect(msgRes.body.seniorId).toBe(fx.seniorA);
  });

  it('identity-spoof fields in the message body are rejected outright (strict validation)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({
        body: 'hello',
        senderUserId: fx.membersB.admin,
        userId: fx.membersB.admin,
        conversationId: 'x',
      });
    // ValidationPipe (whitelist+forbidNonWhitelisted) refuses unknown props.
    expect(res.status).toBe(400);
    // Nothing was persisted:
    const leaked = await fx.prisma.message.findMany({ where: { senderUserId: fx.membersB.admin } });
    expect(leaked).toHaveLength(0);
  });

  it('circle member without conversation participation is denied (boundary 2)', async () => {
    const memberToken = await auth(fx.membersA.member);
    const denied = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(denied.status).toBe(403);

    const deniedSend = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ body: 'inject' });
    expect(deniedSend.status).toBe(403);

    // OBSERVER (read-only circle role) likewise cannot read the thread.
    const deniedObserver = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.observer)}`);
    expect(deniedObserver.status).toBe(403);
  });

  it('outsider to the senior is denied at both boundaries', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersB.admin)}`);
    expect(res.status).toBe(403);
  });

  it('expired membership (past endsAt) cannot read the thread (Phase 16 H10 regression)', async () => {
    // Control: a valid active member reads successfully.
    const control = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`);
    expect(control.status).toBe(200);

    // A member whose engagement ended (status ACTIVE, endsAt in the past)
    // but who is still a persisted participant must be denied — the
    // membership boundary, not the participant row, governs access.
    const endedMember = await fx.prisma.user.create({
      data: {
        email: `p17-ended-${Date.now()}@example.com`,
        passwordHash: 'fixture-unusable',
        fullName: 'Ended Engagement',
        globalRole: 'USER',
      },
    });
    await fx.prisma.careCircleMember.create({
      data: {
        circleId: fx.circleA,
        userId: endedMember.id,
        role: 'FAMILY_MEMBER',
        status: 'ACTIVE',
        endsAt: new Date(Date.now() - 86_400_000),
      },
    });
    await fx.prisma.conversationParticipant.create({
      data: { conversationId, userId: endedMember.id },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${fx.signAs(endedMember.id, endedMember.email)}`);
    expect(res.status).toBe(403);

    await fx.prisma.conversationParticipant.deleteMany({ where: { userId: endedMember.id } });
    await fx.prisma.careCircleMember.deleteMany({ where: { userId: endedMember.id } });
    await fx.prisma.user.delete({ where: { id: endedMember.id } });
  });

  it('route senior substitution is denied (conversation belongs to senior A only)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorB}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`);
    // admin of A is not in B's circle → circle check denies first.
    expect(res.status).toBe(403);

    // Even an admin of B must not find A's conversation under B's route.
    const res2 = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorB}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersB.admin)}`);
    expect(res2.status).toBe(403);
  });

  it('participant addition requires circle membership of the target; self-scope honoured', async () => {
    const memberToken = await auth(fx.membersA.member);
    const addRes = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/participants`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({ targetUserId: fx.membersA.member });
    expect(addRes.status).toBe(201);

    // Now the former non-participant can read.
    const readAfter = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(readAfter.status).toBe(200);
    expect(Array.isArray(readAfter.body)).toBe(true);

    // A stranger (circle B admin) cannot be added: membership required.
    const badAdd = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/participants`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ targetUserId: fx.membersB.admin });
    expect(badAdd.status).toBe(403);
  });

  it('PHI leak control: message body appears only in the message row — never in audit metadata or notification payloads (replaces Phase 11 placeholder tests)', async () => {
    // Read back the rows we created above via a fresh participant message.
    const msg2 = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({ body: `SECOND-${BODY_TEXT}` });
    expect(msg2.status).toBe(201);

    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceType: 'message', resourceId: msg2.body.id },
    });
    expect(audit).not.toBeNull();
    const auditSerialized = JSON.stringify(audit?.metadata ?? {});
    expect(auditSerialized).not.toContain(BODY_TEXT);
    expect(auditSerialized).toContain('hasBody'); // structural marker, no content

    const notifs = await fx.prisma.notification.findMany({
      where: { kind: 'messaging.new_message', seniorId: fx.seniorA },
    });
    expect(notifs.length).toBeGreaterThan(0);
    // Notifications go to OTHER participants (Phase 16 A22) — never the sender:
    const recipients = new Set(notifs.map((n) => n.userId));
    expect(recipients.has(fx.membersA.admin)).toBe(false);
    expect(recipients.has(fx.membersA.member)).toBe(true);
    for (const n of notifs) {
      expect(JSON.stringify(n.payload)).not.toContain(BODY_TEXT);
      expect(n.payload).toMatchObject({
        conversationId: expect.any(String),
        messageId: expect.any(String),
        senderUserId: fx.membersA.admin,
      });
    }
  });

  it('closed conversation rejects new messages (real DB, boundary honoured)', async () => {
    await fx.prisma.conversation.update({
      where: { id: conversationId },
      data: { isClosed: true },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({ body: 'after close' });
    expect(res.status).toBe(403);
    await fx.prisma.conversation.update({
      where: { id: conversationId },
      data: { isClosed: false },
    });
  });

  it('cross-conversation replyTo reference is rejected', async () => {
    const other = await fx.prisma.conversation.create({ data: { seniorId: fx.seniorA } });
    await fx.prisma.conversationParticipant.create({
      data: { conversationId: other.id, userId: fx.membersA.admin },
    });
    const otherMsg = await fx.prisma.message.create({
      data: {
        conversationId: other.id,
        senderUserId: fx.membersA.admin,
        seniorId: fx.seniorA,
        body: 'other thread',
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({ body: 'reply', replyToId: otherMsg.id });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('does not belong');
  });

  it('unauthenticated requests are rejected across the messaging surface', async () => {
    const paths = [
      `/api/v1/seniors/${fx.seniorA}/conversations`,
      `/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`,
    ];
    for (const p of paths) {
      const get = await request(app.getHttpServer()).get(p);
      expect(get.status).toBe(401);
      const post = await request(app.getHttpServer()).post(p).send({});
      expect(post.status).toBe(401);
    }
  });

  it('pagination is clamped server-side (take > 100 falls back to 20)', async () => {
    // Seed 25 messages.
    for (let i = 0; i < 25; i += 1) {
      await fx.prisma.message.create({
        data: {
          conversationId,
          senderUserId: fx.membersA.admin,
          seniorId: fx.seniorA,
          body: `bulk ${i}`,
        },
      });
    }
    const res = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages?take=500`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(20);
  });

  it('message body length is bounded by the DTO (10000 chars)', async () => {
    const long = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({ body: 'a'.repeat(10_001) });
    expect(long.status).toBe(400);
    const ok = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${await auth(fx.membersA.admin)}`)
      .send({ body: 'a'.repeat(10_000) });
    expect(ok.status).toBe(201);
  });
});
