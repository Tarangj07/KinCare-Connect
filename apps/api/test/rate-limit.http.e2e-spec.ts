/**
 * N-12 regression — rate-limit HTTP semantics (Phase 28).
 *
 * The rate limiter used to throw `ForbiddenException`, so exhausting the
 * budget returned HTTP 403. Every assertion here therefore has to do more
 * than read a status number: it must show that the 429 is produced by the
 * RATE LIMITER and not by something else that happens to return 429, and
 * that the 401/403 paths are untouched. A spec that only asserted
 * "status === 429" would pass against a hardcoded 429 anywhere in the
 * stack.
 *
 * How the source is pinned:
 *  - the limiter is the only thing in this repository that can throw a 429
 *    (verified by exhaustive search; the global filter merely maps one),
 *  - `error.code` is asserted to be `RATE_LIMITED`, which is produced ONLY
 *    by the filter's `case 429` branch, and
 *  - the negative controls below show an unrelated 401 and an unrelated 403
 *    are not reported as `RATE_LIMITED`.
 *
 * No database is involved. The limiter runs in a guard, before the
 * controller, and the probe route below touches nothing. The stubbed
 * `PrismaService` is not a convenience: it throws if anything reaches the
 * data layer, so "this spec proves nothing about the database" is enforced
 * by the harness rather than asserted in a comment. (An earlier draft drove
 * the limiter through `POST /auth/login` on the assumption that a login for
 * a non-existent address never queries; it does query, and the resulting
 * 500s are the stub doing its job.)
 */
import type { INestApplication } from '@nestjs/common';
import { Controller, ForbiddenException, Get, Module, Post, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AuthModule } from '../src/auth/auth.module';
import { RateLimit } from '../src/auth/decorators/rate-limit.decorator';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../src/auth/guards/auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { resolveJwtAccessSecret } from '../src/config/security-config';
import { PrismaService } from '../src/database/prisma.service';
import { createTestApp } from '../src/testing/create-test-app';

const SAVED_OPT_OUT = process.env['ECC_TEST_DISABLE_RATE_LIMIT'];

/**
 * Probe routes, declared here rather than borrowed from a production
 * controller so that this spec's results are not coupled to unrelated
 * behaviour that may change for other reasons.
 *
 * `@RateLimit()` is applied the same way the auth controller applies it —
 * the same decorator, therefore the same guard, registered the same way.
 * The route is deliberately not authenticated so the limiter is the ONLY
 * thing that can decide its status.
 */
@Controller('p28-probe')
class ProbeController {
  @Post('limited')
  @RateLimit()
  limited() {
    return { ok: true };
  }

  @Get('auth-only')
  @UseGuards(JwtAuthGuard)
  authOnly() {
    return { ok: true };
  }

  @Get('admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  adminOnly() {
    return { ok: true };
  }
}

// The controller lives in its own module that imports `AuthModule` so
// `JwtAuthGuard` can resolve `JwtService`. Attaching the guard to a
// controller declared directly in the root testing module fails DI
// resolution, which is a property of how Nest resolves class-reference
// guards, not of the behaviour under test.
@Module({ imports: [AuthModule], controllers: [ProbeController] })
class ProbeModule {}

/**
 * Stands in for the real `PrismaService`, whose `onModuleInit` would open a
 * PostgreSQL connection. Any query reaching the data layer throws, so a
 * future change that quietly made this spec depend on the database fails
 * loudly instead of silently skipping when no database is configured.
 */
class NoDbPrismaService {
  async onModuleInit(): Promise<void> {
    /* intentionally no connection */
  }
  async onModuleDestroy(): Promise<void> {
    /* intentionally no connection */
  }
  async $connect(): Promise<void> {
    throw new Error(
      'the N-12 spec must not touch the database; a query reached the service layer',
    );
  }
  async $disconnect(): Promise<void> {
    /* nothing to close */
  }
}

describe('N-12 — rate limiting returns 429, authorization stays 403', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The limiter's own test bypass is scoped to this file only. It is
    // disabled here on purpose: the whole point is to observe the real
    // production refusal path end to end. Restored in `afterAll` so the
    // deterministic HTTP suites that follow are unaffected.
    delete process.env['ECC_TEST_DISABLE_RATE_LIMIT'];

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
      .overrideProvider(PrismaService)
      .useClass(NoDbPrismaService)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (SAVED_OPT_OUT === undefined) delete process.env['ECC_TEST_DISABLE_RATE_LIMIT'];
    else process.env['ECC_TEST_DISABLE_RATE_LIMIT'] = SAVED_OPT_OUT;
  });

  const http = () => request(app.getHttpServer());
  const limited = () => http().post('/api/v1/p28-probe/limited');

  it('requests below the budget are NOT throttled (they reach the controller)', async () => {
    // 10 is the documented per-IP budget. Each of these must get past the
    // limiter and be served; a 429 here would mean the budget was spent
    // before it was.
    for (let i = 0; i < 10; i += 1) {
      const res = await limited();
      expect(res.status, `attempt ${i + 1} was throttled before the budget was spent`).toBe(201);
      expect(res.body?.error?.code).toBeUndefined();
      expect(res.headers['retry-after']).toBeUndefined();
    }
  });

  it('exhausting the budget returns 429, not 403', async () => {
    const res = await limited();
    expect(res.status).toBe(429);
    expect(res.status).not.toBe(403);
  });

  it('the 429 is identified as rate limiting by the error envelope', async () => {
    const res = await limited();
    // `RATE_LIMITED` exists only in the filter's `case 429` branch, so this
    // asserts the status travelled through the real exception filter rather
    // than being produced by some other component.
    expect(res.status).toBe(429);
    expect(res.body?.error?.code).toBe('RATE_LIMITED');
    expect(res.body?.error?.code).not.toBe('FORBIDDEN');
    expect(String(res.body?.error?.message)).toMatch(/rate limit/i);
    expect(res.body?.error?.requestId).toBeTruthy();
  });

  it('the 429 carries a syntactically valid, non-negative Retry-After', async () => {
    const res = await limited();
    expect(res.status).toBe(429);
    const raw = res.headers['retry-after'];
    expect(raw, 'a 429 must carry Retry-After (THREAT_MODEL.md §8)').toBeDefined();
    // RFC 9110 §10.2.3: Retry-After is delay-seconds (an integer) or an
    // HTTP-date. The implementation must use delay-seconds.
    expect(String(raw)).toMatch(/^\d+$/);
    const seconds = Number.parseInt(String(raw), 10);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
    // The window is 15 minutes and it slides, so the value must be a real
    // remainder inside it — never longer than the window itself.
    expect(seconds).toBeLessThanOrEqual(15 * 60);
  });

  it('the 429 body leaks no credential, token, secret or stack trace', async () => {
    const res = await limited();
    const serialised = JSON.stringify(res.body);
    expect(serialised.toLowerCase()).not.toContain('stack');
    expect(serialised.toLowerCase()).not.toContain('prisma');
    expect(serialised.toLowerCase()).not.toContain('secret');
    // The client IP is not echoed back: a throttled caller learns the fact
    // of throttling and the delay, and nothing about the server's state.
    expect(serialised).not.toContain('127.0.0.1');
    expect(serialised).not.toContain('Map');
    // The envelope has exactly the documented keys and nothing else.
    expect(Object.keys(res.body?.error ?? {}).sort()).toEqual(['code', 'message', 'requestId']);
  });

  it('a credential sent to a throttled route is not echoed back', async () => {
    const res = await http()
      .post('/api/v1/p28-probe/limited')
      .send({ password: 'P28-Not-A-Real-Secret-9f3a' });
    expect(res.status).toBe(429);
    expect(JSON.stringify(res.body)).not.toContain('P28-Not-A-Real-Secret-9f3a');
  });

  it('the budget is still enforced — refusing does not open the gate', async () => {
    // A later request from the same IP must still be refused. If the fix had
    // been implemented by "return 429 and then let the request through", or
    // by clearing the store on refusal, this would pass with 201s.
    const res = await limited();
    expect(res.status).toBe(429);
  });

  it('NEGATIVE CONTROL — an unrelated 403 is not reported as rate limiting', async () => {
    // A well-formed token for a non-SUPER_ADMIN user hitting a
    // SUPER_ADMIN-only route. This is a genuine authorization refusal and
    // must stay 403/FORBIDDEN. It runs AFTER the budget above is exhausted,
    // which is the strongest form of the check: the throttled IP still gets
    // 403 here, so 403 and 429 are demonstrably distinguishable from the
    // same client at the same moment.
    const token = new JwtService({ secret: resolveJwtAccessSecret() }).sign(
      { sub: 'p28-nonexistent-user', email: 'p28-probe@example.invalid', globalRole: 'FAMILY_ADMIN' },
      { expiresIn: '15m' },
    );
    const res = await http().get('/api/v1/p28-probe/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
    expect(res.body?.error?.code).not.toBe('RATE_LIMITED');
    // An authorization refusal must not advertise a retry delay.
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('NEGATIVE CONTROL — a missing token is still 401, not 429', async () => {
    const res = await http().get('/api/v1/p28-probe/auth-only');
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHENTICATED');
    expect(res.body?.error?.code).not.toBe('RATE_LIMITED');
  });

  it('NEGATIVE CONTROL — an invalid token is still 401, not 429', async () => {
    const res = await http()
      .get('/api/v1/p28-probe/auth-only')
      .set('Authorization', 'Bearer p28.not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHENTICATED');
  });

  it('an ordinary ForbiddenException still maps to 403 through the real filter', async () => {
    // Direct filter invocation, so the mapping is pinned independently of
    // any route. Guards against a future "make everything 429" regression
    // that would be invisible if only the rate-limit path were tested.
    const headers: Record<string, string> = {};
    let statusCode = 0;
    let payload: unknown = null;
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          setHeader: (k: string, v: string) => {
            headers[k] = v;
          },
          status: (s: number) => {
            statusCode = s;
            return {
              json: (b: unknown) => {
                payload = b;
              },
            };
          },
        }),
        getRequest: () => ({ id: 'p28-probe-request' }),
      }),
    };
    new GlobalExceptionFilter().catch(new ForbiddenException('nope'), host as never);
    expect(statusCode).toBe(403);
    expect((payload as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    expect(headers['Retry-After']).toBeUndefined();
  });

  it('the shared test-app builder is unaffected by this file', async () => {
    // `createTestApp` is imported so a compile-time break in the shared HTTP
    // pipeline is caught by this spec as well as the DB-backed ones. The
    // assertion is deliberately trivial: the import and the type check are
    // the point, not behaviour.
    expect(typeof createTestApp).toBe('function');
  });
});
