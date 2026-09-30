import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RateLimitExceededException } from '../../common/exceptions/rate-limit-exceeded.exception';

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
      expect(() => guard.canActivate(makeContext('9.9.9.9'))).toThrow(RateLimitExceededException);
    });

    it('tracks IPs independently', () => {
      for (let i = 0; i < 10; i += 1) guard.canActivate(makeContext('1.1.1.1'));
      expect(() => guard.canActivate(makeContext('1.1.1.1'))).toThrow(RateLimitExceededException);
      expect(guard.canActivate(makeContext('2.2.2.2'))).toBe(true);
    });
  });

  describe('production is never bypassed (Phase 18 L-03)', () => {
    it('enforces the budget in production', () => {
      process.env['NODE_ENV'] = 'production';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('5.5.5.5'))).toBe(true);
      expect(() => guard.canActivate(makeContext('5.5.5.5'))).toThrow(RateLimitExceededException);
    });

    it('refuses the test opt-out flag in production even when it is set', () => {
      // This is the exact accidental-activation scenario: a leaked/copied
      // test flag must not disable rate limiting on a production process.
      process.env['NODE_ENV'] = 'production';
      process.env[TEST_OPT_OUT] = '1';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('6.6.6.6'))).toBe(true);
      expect(() => guard.canActivate(makeContext('6.6.6.6'))).toThrow(RateLimitExceededException);
    });

    it('a production process stays protected regardless of NODE_ENV casing', () => {
      process.env['NODE_ENV'] = 'PRODUCTION';
      process.env[TEST_OPT_OUT] = '1';
      expect(() => guard.canActivate(makeContext('6.6.6.7'))).not.toThrow();
      for (let i = 0; i < 9; i += 1) guard.canActivate(makeContext('6.6.6.7'));
      expect(() => guard.canActivate(makeContext('6.6.6.7'))).toThrow(RateLimitExceededException);
    });
  });

  describe('bypass requires BOTH the dedicated flag and a non-production env', () => {
    it('NODE_ENV=test alone no longer disables the limiter', () => {
      // Regression guard for the Phase 17 formulation: the generic variable
      // by itself must not switch the security control off.
      process.env['NODE_ENV'] = 'test';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('7.7.7.7'))).toBe(true);
      expect(() => guard.canActivate(makeContext('7.7.7.7'))).toThrow(RateLimitExceededException);
    });

    it('the opt-out flag alone in a non-production env does not disable the limiter', () => {
      process.env['NODE_ENV'] = 'development';
      process.env[TEST_OPT_OUT] = '1';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('8.8.8.8'))).toBe(true);
      expect(() => guard.canActivate(makeContext('8.8.8.8'))).toThrow(RateLimitExceededException);
    });

    it('an incorrect flag value does not disable the limiter', () => {
      process.env['NODE_ENV'] = 'test';
      process.env[TEST_OPT_OUT] = 'true';
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('8.8.8.9'))).toBe(true);
      expect(() => guard.canActivate(makeContext('8.8.8.9'))).toThrow(RateLimitExceededException);
    });

    it('bypasses the limiter in the test environment (deterministic suites)', () => {
      process.env['NODE_ENV'] = 'test';
      process.env[TEST_OPT_OUT] = '1';
      for (let i = 0; i < 30; i += 1) expect(guard.canActivate(makeContext('3.3.3.3'))).toBe(true);
    });
  });

  /**
   * Phase 28 (N-12) — HTTP semantics of the refusal.
   *
   * These assert the STATUS and the retry contract, not merely the
   * exception class, because "throws RateLimitExceededException" is a much
   * weaker claim than "answers 429 and tells the caller when to come back".
   * The end-to-end proof that the number actually reaches a client is in
   * `test/rate-limit.http.e2e-spec.ts`.
   */
  describe('HTTP semantics of the refusal (Phase 28 N-12)', () => {
    /** Run the budget to exhaustion and return the thrown exception. */
    function exhaust(ip: string): RateLimitExceededException {
      for (let i = 0; i < 10; i += 1) guard.canActivate(makeContext(ip));
      return refuse(ip);
    }

    /**
     * Attempt once against an ALREADY-EXHAUSTED budget and return the
     * thrown exception. Kept separate from `exhaust` because re-running the
     * budget on a spent IP throws on the first call, which would escape
     * `exhaust`'s try/catch as an unrelated failure.
     */
    function refuse(ip: string): RateLimitExceededException {
      try {
        guard.canActivate(makeContext(ip));
      } catch (e) {
        return e as RateLimitExceededException;
      }
      throw new Error('the limiter did not refuse the attempt');
    }

    it('refuses with HTTP 429, not 403', () => {
      const err = exhaust('4.4.4.4');
      expect(err).toBeInstanceOf(RateLimitExceededException);
      expect(err.getStatus()).toBe(429);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('does not throw any 403-class exception', () => {
      // Guards against the old behaviour returning under a new class name.
      const err = exhaust('4.4.4.5');
      expect(err.getStatus()).not.toBe(HttpStatus.FORBIDDEN);
      expect(err).not.toBeInstanceOf(ForbiddenException);
    });

    it('preserves the Phase 3 message verbatim', () => {
      const err = exhaust('4.4.4.6');
      expect(err.message).toBe('Rate limit exceeded. Try again later.');
    });

    it('the message names no IP, no identifier and no internal state', () => {
      const err = exhaust('4.4.4.7');
      expect(err.message).not.toContain('4.4.4.7');
      expect(err.message).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      expect(err.message.toLowerCase()).not.toContain('store');
      expect(err.message.toLowerCase()).not.toContain('map');
    });

    it('the budget is still exactly 10 per IP per window', () => {
      // A regression that quietly raised the threshold to make some other
      // test pass would be invisible without this literal.
      for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('4.4.4.8'))).toBe(true);
      expect(() => guard.canActivate(makeContext('4.4.4.8'))).toThrow(RateLimitExceededException);
    });

    it('Retry-After is a positive integer inside the 15-minute window', () => {
      const err = exhaust('4.4.4.9');
      expect(Number.isInteger(err.retryAfterSeconds)).toBe(true);
      expect(err.retryAfterSeconds).toBeGreaterThan(0);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    });

    it('Retry-After shrinks as the window elapses, rather than being a constant', () => {
      // A hardcoded value would pass the two assertions above while telling
      // every throttled caller to wait the full 15 minutes. The window
      // slides on `lastAttempt`, so the honest remainder must decrease.
      const realNow = Date.now;
      const base = realNow();
      let first: RateLimitExceededException;
      let later: RateLimitExceededException;
      try {
        Date.now = () => base;
        exhaust('4.4.4.10');
        first = refuse('4.4.4.10');
        // Advance to just under the reset point and refuse again.
        Date.now = () => base + 14 * 60 * 1000;
        later = refuse('4.4.4.10');
      } finally {
        Date.now = realNow;
      }
      expect(first.retryAfterSeconds).toBe(15 * 60);
      expect(later.retryAfterSeconds).toBe(60);
      expect(later.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
    });

    it('Retry-After is never 0 even at the exact reset instant', () => {
      // `canActivate` resets on `now - lastAttempt > windowMs` (strict). At
      // exactly the window boundary the request is still refused, so
      // `Retry-After: 0` would invite a request guaranteed to fail.
      const realNow = Date.now;
      const base = realNow();
      try {
        Date.now = () => base;
        exhaust('4.4.4.11');
        Date.now = () => base + 15 * 60 * 1000;
        const err = refuse('4.4.4.11');
        expect(err).toBeInstanceOf(RateLimitExceededException);
        expect(err.retryAfterSeconds).toBe(1);
      } finally {
        Date.now = realNow;
      }
    });

    it('the window still expires — a caller is not locked out forever', () => {
      const realNow = Date.now;
      const base = realNow();
      try {
        Date.now = () => base;
        exhaust('4.4.4.12');
        Date.now = () => base + 15 * 60 * 1000 + 1;
        expect(guard.canActivate(makeContext('4.4.4.12'))).toBe(true);
      } finally {
        Date.now = realNow;
      }
    });
  });
});
