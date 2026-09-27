/**
 * Messaging endpoint HTTP gate tests (requires DATABASE_URL).
 *
 * These boot the real AppModule (DB required for Prisma $connect) and exercise
 * the request pipeline up to the point of first DB access:
 * authentication (401) and DTO validation (400). They are intentionally
 * narrow: every security property that depends on care-circle state
 * (participant boundaries, cross-senior isolation, PHI leak controls,
 * notifications) is verified end-to-end against a real PostgreSQL in
 * test/messaging.security.e2e-spec.ts.
 *
 * Phase 17: replaced the previous 22-case smoke suite whose status-set
 * assertions (e.g. `expect([200,401,403]).toContain(...)`) could not fail
 * when authorization was broken, and which contained two
 * `expect(true).toBe(true)` placeholders.
 */
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveJwtAccessSecret } from '../../config/security-config';
import { createTestApp } from '../../testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const SENIOR = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CONV = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const USER = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

/** Sign a structurally valid access token (same secret the app verifies with). */
function bearer(userId: string): string {
  // Mirrors auth.service.ts claims; HS256 via the configured secret.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      email: 'gate@example.com',
      role: 'USER',
      iat: Math.floor(Date.now() / 1000),
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', resolveJwtAccessSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describeDb('Messaging endpoints — auth & validation gates', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const base = `/api/v1/seniors/${SENIOR}/conversations`;

  it('rejects unauthenticated requests on every messaging route', async () => {
    for (const p of [base, `${base}/${CONV}`, `${base}/${CONV}/messages`]) {
      expect((await request(app.getHttpServer()).get(p)).status).toBe(401);
    }
    expect((await request(app.getHttpServer()).post(base).send({})).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).post(`${base}/${CONV}/messages`).send({ body: 'x' }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base}/${CONV}/participants`)
          .send({ targetUserId: SENIOR })
      ).status,
    ).toBe(401);
  });

  it('rejects forged/unsigned bearer tokens', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/${CONV}/messages`)
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(res.status).toBe(401);
  });

  it('a refresh cookie alone is NOT an authentication path (Phase 16 H5 regression)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/${CONV}/messages`)
      .set('Cookie', 'refresh=junk-junk');
    expect(res.status).toBe(401);
  });

  it('valid signature + oversized message body is rejected by the DTO (400, before any handler)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/${CONV}/messages`)
      .set('Authorization', `Bearer ${bearer(USER)}`)
      .send({ body: 'a'.repeat(10_001) });
    expect(res.status).toBe(400);
  });

  it('valid signature + malformed replyToId is rejected by the DTO (400)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/${CONV}/messages`)
      .set('Authorization', `Bearer ${bearer(USER)}`)
      .send({ body: 'fine', replyToId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('unknown fields are rejected outright (strict whitelist)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/${CONV}/messages`)
      .set('Authorization', `Bearer ${bearer(USER)}`)
      .send({ body: 'fine', senderUserId: USER });
    expect(res.status).toBe(400);
  });
});
