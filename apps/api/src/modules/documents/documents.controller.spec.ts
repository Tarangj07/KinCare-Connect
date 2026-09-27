/**
 * Document endpoint HTTP gate tests (requires DATABASE_URL).
 *
 * Verifies the authentication gate on every document route — these paths
 * fail closed at the guard, before any DB or storage access. Full
 * behavioral security (role boundaries, grants, expiry, cross-senior,
 * content validation, PHI leak controls) is covered against a real
 * PostgreSQL in test/documents.security.e2e-spec.ts.
 *
 * Phase 17: replaced the previous smoke suite whose assertions accepted
 * any status >= 200 (a 401/403/500 all passed vacuously).
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const SENIOR = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const DOC = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describeDb('Document endpoints — authentication gate', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const base = `/api/v1/seniors/${SENIOR}/documents`;

  it('rejects unauthenticated access on every document route with 401', async () => {
    expect((await request(app.getHttpServer()).get(base)).status).toBe(401);
    expect((await request(app.getHttpServer()).post(base).send({})).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`${base}/${DOC}`)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`${base}/${DOC}/download`)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`${base}/${DOC}/access`)).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).post(`${base}/${DOC}/access`).send({ userId: DOC }))
        .status,
    ).toBe(401);
    expect((await request(app.getHttpServer()).delete(`${base}/${DOC}/access/${DOC}`)).status).toBe(
      401,
    );
    expect((await request(app.getHttpServer()).patch(`${base}/${DOC}/archive`)).status).toBe(401);
  });

  it('rejects a refresh cookie presented as the only credential (Phase 16 H5)', async () => {
    const res = await request(app.getHttpServer()).get(base).set('Cookie', 'refresh=junk-junk');
    expect(res.status).toBe(401);
  });
});
