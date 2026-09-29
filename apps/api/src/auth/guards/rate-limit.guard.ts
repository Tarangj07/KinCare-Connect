import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { ForbiddenException,Injectable } from '@nestjs/common';

/**
 * Placeholder in-process rate limiter (Phase 3; known limitations are
 * tracked as Medium A13 — not shared across replicas, IP-keyed).
 *
 * Phase 17 (test determinism): the strict per-IP budget makes the
 * automated auth suite self-throttle (register+login+rotation chains
 * exceed 10 requests from 127.0.0.1 in a single file), which produced
 * non-deterministic 403s unrelated to the behaviour under test. The
 * limiter's budgeting logic is exercised directly by its own unit spec.
 *
 * Phase 18 (L-03) — how the test bypass is scoped.
 *
 * The Phase 17 implementation was:
 *
 *     if (process.env['NODE_ENV'] === 'test') return true;
 *
 * `NODE_ENV` is a broad, generic, production-readable variable: it is set
 * to `test` by countless CI images, container base images and PaaS
 * templates, and this repository's own CI sets it at job level. Any
 * deployment that happened to run with `NODE_ENV=test` would therefore have
 * silently disabled rate limiting on every rate-limited route (all of
 * `auth.controller.ts`) while still reporting healthy — the exact
 * "accidental production bypass" class the Phase 17 review flagged.
 *
 * The bypass is now BOTH narrower and production-proof. It engages only
 * when BOTH of these hold:
 *
 *  1. `NODE_ENV` is exactly `test` — an unambiguous test environment.
 *     A production, staging or development process never satisfies this.
 *  2. The dedicated, test-only variable `ECC_TEST_DISABLE_RATE_LIMIT=1` is
 *     set. It cannot be switched on by an unrelated environment setting,
 *     and it means nothing on its own.
 *
 * The resulting matrix is:
 *
 *   production / staging / development      -> limiter ALWAYS enforced
 *   NODE_ENV=test, flag absent              -> limiter enforced
 *                                              (so NODE_ENV=test alone no
 *                                               longer disables anything)
 *   NODE_ENV=test, flag=1                   -> limiter bypassed
 *                                              (deterministic test suites)
 *
 * Rate limiting is never removed from production, and no environment
 * setting short of the deliberate test-runner combination can disable it.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, { attempts: number; lastAttempt: number }>();
  private readonly maxAttempts = 10;
  private readonly windowMs = 15 * 60 * 1000;

  /**
   * Explicitly test-scoped: requires an unambiguous test environment AND
   * the dedicated opt-in flag. Never true for a production process.
   */
  private isTestBypassActive(): boolean {
    if (process.env['NODE_ENV'] !== 'test') return false;
    return process.env['ECC_TEST_DISABLE_RATE_LIMIT'] === '1';
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.isTestBypassActive()) return true;
    const req = context.switchToHttp().getRequest();
    const ip = (req.ip ?? req.connection?.remoteAddress ?? 'unknown').toString();
    const now = Date.now();
    const record = this.store.get(ip);

    if (!record || now - record.lastAttempt > this.windowMs) {
      this.store.set(ip, { attempts: 1, lastAttempt: now });
      return true;
    }
    if (record.attempts >= this.maxAttempts) {
      throw new ForbiddenException('Rate limit exceeded. Try again later.');
    }
    record.attempts += 1;
    record.lastAttempt = now;
    this.store.set(ip, record);
    return true;
  }
}
