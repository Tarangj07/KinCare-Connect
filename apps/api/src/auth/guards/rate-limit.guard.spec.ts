import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RateLimitGuard } from './rate-limit.guard';

const TEST_OPT_OUT = 'ECC_TEST_DISABLE_RATE_LIMIT';

function makeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

/**
 * Phase 18 (L-03) — the guard must never be bypassed in production.
 *
 * Phase 17 bypassed the limiter with `NODE_ENV === 'test'`. Because
 * NODE_ENV is a broad, production-readable variable (set to `test` by many
 * CI images, container defaults and templates — including this repo's own
 * CI job), that formulation meant any deployment running with
 * NODE_ENV=test silently lost rate limiting on every rate-limited route.
 *
 * The bypass now requires a dedicated test-only flag AND is refused
 * outright whenever NODE_ENV=production. These tests pin the real
 * budgeting behaviour and the production-immunity of the bypass.
 */
describe('RateLimitGuard', () => {
  const savedNodeEnv = process.env['NODE_ENV'];
  const savedOptOut = process.env[TEST_OPT_OUT];
  let guard: RateLimitGuard;

  beforeEach(() => {
    delete process.env['NODE_ENV'];
    delete process.env[TEST_OPT_OUT];
    guard = new RateLimitGuard();
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = savedNodeEnv;
    if (savedOptOut === undefined) delete process.env[TEST_OPT_OUT];
    else process.env[TEST_OPT_OUT] = savedOptOut;
  });

  describe('budgeting behaviour (limiter active)', () => {
    it('allows the first request from an IP', () => {
      expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
    });

    it('blocks the 11th attempt inside the window (10 max)', () => {
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('9.9.9.9'))).toBe(true);
      expect(() => guard.canActivate(makeContext('9.9.9.9'))).toThrow(ForbiddenException);
    });

    it('tracks IPs independently', () => {
      for (let i = 0; i < 10; i += 1) guard.canActivate(makeContext('1.1.1.1'));
      expect(() => guard.canActivate(makeContext('1.1.1.1'))).toThrow(ForbiddenException);
      expect(guard.canActivate(makeContext('2.2.2.2'))).toBe(true);
    });
  });

  describe('production is never bypassed (Phase 18 L-03)', () => {
    it('enforces the budget in production', () => {
      process.env['NODE_ENV'] = 'production';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('5.5.5.5'))).toBe(true);
      expect(() => guard.canActivate(makeContext('5.5.5.5'))).toThrow(ForbiddenException);
    });

    it('refuses the test opt-out flag in production even when it is set', () => {
      // This is the exact accidental-activation scenario: a leaked/copied
      // test flag must not disable rate limiting on a production process.
      process.env['NODE_ENV'] = 'production';
      process.env[TEST_OPT_OUT] = '1';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('6.6.6.6'))).toBe(true);
      expect(() => guard.canActivate(makeContext('6.6.6.6'))).toThrow(ForbiddenException);
    });

    it('a production process stays protected regardless of NODE_ENV casing', () => {
      process.env['NODE_ENV'] = 'PRODUCTION';
      process.env[TEST_OPT_OUT] = '1';
      expect(() => guard.canActivate(makeContext('6.6.6.7'))).not.toThrow();
      for (let i = 0; i < 9; i += 1) guard.canActivate(makeContext('6.6.6.7'));
      expect(() => guard.canActivate(makeContext('6.6.6.7'))).toThrow(ForbiddenException);
    });
  });

  describe('bypass requires BOTH the dedicated flag and a non-production env', () => {
    it('NODE_ENV=test alone no longer disables the limiter', () => {
      // Regression guard for the Phase 17 formulation: the generic variable
      // by itself must not switch the security control off.
      process.env['NODE_ENV'] = 'test';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('7.7.7.7'))).toBe(true);
      expect(() => guard.canActivate(makeContext('7.7.7.7'))).toThrow(ForbiddenException);
    });

    it('the opt-out flag alone in a non-production env does not disable the limiter', () => {
      process.env['NODE_ENV'] = 'development';
      process.env[TEST_OPT_OUT] = '1';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('8.8.8.8'))).toBe(true);
      expect(() => guard.canActivate(makeContext('8.8.8.8'))).toThrow(ForbiddenException);
    });

    it('an incorrect flag value does not disable the limiter', () => {
      process.env['NODE_ENV'] = 'test';
      process.env[TEST_OPT_OUT] = 'true';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('8.8.8.9'))).toBe(true);
      expect(() => guard.canActivate(makeContext('8.8.8.9'))).toThrow(ForbiddenException);
    });

    it('bypasses the limiter in the test environment (deterministic suites)', () => {
      process.env['NODE_ENV'] = 'test';
      process.env[TEST_OPT_OUT] = '1';
      for (let i = 0; i < 30; i += 1) expect(guard.canActivate(makeContext('3.3.3.3'))).toBe(true);
    });
  });
});
