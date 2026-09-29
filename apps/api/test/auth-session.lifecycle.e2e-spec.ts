/**
 * Auth/session lifecycle e2e — Phase 17.
 *
 * Exercises the real HTTP surface (register/login/refresh/logout/me)
 * against PostgreSQL exactly as a client would: cookie-based rotation,
 * theft simulation (replay of a rotated token), cross-user token
 * revocation attempts, and deactivated-account session teardown.
 *
 * Phase 16 unit/integration tests covered the service layer; this
 * replaces the thin 3-case src smoke suite as the end-to-end proof.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

/** Extract the refresh cookie value from a Set-Cookie header array. */
function refreshCookie(res: request.Response): string {
  const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const c = cookies.find((x) => x.startsWith('refresh='));
  if (!c) throw new Error('no refresh cookie set');
  return c.split(';')[0]!.slice('refresh='.length);
}

describeDb('Auth session lifecycle (real database, HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const PASSWORD = 'Str0ng!Passphrase-x';

  async function registerAndLogin() {
    const email = `p17session-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Session Tester' });
    expect(reg.status).toBe(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(201);
    return { email, access: login.body.access as string, refresh: refreshCookie(login) };
  }

  it('login delivers an access token usable on protected routes and a refresh cookie', async () => {
    const { access, refresh } = await registerAndLogin();
    expect(access).toBeTruthy();
    expect(refresh).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${access}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toContain('@example.com');
    expect(me.body.globalRole).toBe('USER');
  });

  it('rotation by cookie keeps the session chain alive and retires old tokens', async () => {
    const { access, refresh } = await registerAndLogin();

    const r1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${refresh}`)
      .send();
    expect(r1.status).toBe(201);
    expect(r1.body.access).toBeTruthy();
    const rotated = refreshCookie(r1);
    expect(rotated).not.toBe(refresh);

    // The new cookie keeps working; the old token is now dead.
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${rotated}`)
      .send();
    expect(r2.status).toBe(201);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${refresh}`)
      .send();
    expect(replay.status).toBe(403);
    void access;
  });

  it('theft simulation: replaying a stolen pre-rotation token revokes the live family (403 afterwards)', async () => {
    const { refresh } = await registerAndLogin();
    const victim = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${refresh}`)
      .send();
    expect(victim.status).toBe(201);
    const victimNew = refreshCookie(victim);

    // Thief replays the token they stole BEFORE the victim rotated.
    const theft = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${refresh}`)
      .send();
    expect(theft.status).toBe(403);

    // Victim's currently-live token must now be refused as well (family revoked).
    const afterFamilyRevoked = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${victimNew}`)
      .send();
    expect(afterFamilyRevoked.status).toBe(403);
  });

  it("logout revokes only the caller's session and cannot kill another user's token", async () => {
    const a = await registerAndLogin();
    const b = await registerAndLogin();

    // B (authenticated) tries to revoke A's refresh token through the body.
    const cross = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${b.access}`)
      .send({ refreshToken: a.refresh });
    expect(cross.status).toBe(201);

    // A's token must still rotate — the cross-user attempt was ignored.
    const aStill = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${a.refresh}`)
      .send();
    expect(aStill.status).toBe(201);
    const aCurrent = refreshCookie(aStill);

    // A logs out with their own current token.
    const aOut = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.access}`)
      .send({ refreshToken: aCurrent });
    expect(aOut.status).toBe(201);

    // The revoked token can no longer refresh (replay of a revoked row is
    // treated as reuse → 403, family already revoked).
    const dead = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${aCurrent}`)
      .send();
    expect(dead.status).toBe(403);

    // B's independent session is untouched.
    const bStill = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${b.refresh}`)
      .send();
    expect(bStill.status).toBe(201);
  });

  it('unauthenticated access is refused on protected endpoints', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/auth/logout')).status).toBe(401);
  });

  it('deactivating an account stops refresh (existing sessions cannot extend)', async () => {
    const { email, refresh } = await registerAndLogin();
    // Deactivate directly in the DB (administrative action surface isn't
    // implemented; the security property under test is session behavior).
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasourceUrl: DB_URL });
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    await prisma.user.update({ where: { email }, data: { isActive: false } });
    await prisma.$disconnect();

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh=${refresh}`)
      .send();
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Phase 24 (D-1). A deactivated or soft-deleted account keeps access for the
  // remaining life of its access token — the guard consults the signature and
  // nothing else, and closing that would mean a per-request database lookup
  // (an architecture change, not a fix). The window is accepted for this
  // threat model, so what is pinned here is the WINDOW ITSELF: the lifetime of
  // the token that stays usable. Without this assertion the accepted residual
  // risk is "≤ 15 minutes", and raising `expiresIn` to an hour or a day would
  // silently widen it with every test still green.
  // ---------------------------------------------------------------------------
  it('the access token issued at login is bounded, so the D-1 window cannot widen silently', async () => {
    const { access } = await registerAndLogin();
    const parts = access.split('.');
    expect(parts).toHaveLength(3);
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      sub: string;
      iat: number;
      exp: number;
    };

    expect(claims.sub, 'the access token has no subject').toBeTruthy();
    expect(claims.iat, 'the access token has no issued-at claim; a maxAge bound cannot be evaluated').toBeTypeOf('number');
    expect(claims.exp, 'the access token has no expiry').toBeTypeOf('number');
    // A literal, not ACCESS_TOKEN_TTL_SECONDS. Comparing the issued lifetime
    // against the constant the application uses would hold for any value of
    // that constant, and this test exists precisely to catch the constant
    // being changed. 15 minutes is the number quoted as the accepted residual
    // risk of D-1, so changing it is a decision about that risk.
    expect(
      claims.exp! - claims.iat!,
      `the access token lives for ${claims.exp! - claims.iat!}s. The accepted D-1 residual risk is stated as at ` +
        'most 15 minutes; a longer lifetime is a deliberate change to that documented risk, not a silent one.',
    ).toBe(15 * 60);
    expect(claims.exp! * 1000 - Date.now(), 'the access token is already expired or exp is in the distant future')
      .toBeGreaterThan(15 * 60 * 500);
  });

  it('failed logins lock the account at the threshold over HTTP', async () => {
    const email = `p17lock-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Lock Tester' });
    for (let i = 0; i < 10; i += 1) {
      const bad = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'nope-nope-1!' });
      expect(bad.status).toBe(401);
    }
    const locked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    expect(locked.status).toBe(403);
    expect(JSON.stringify(locked.body)).toContain('locked');
  });
});
