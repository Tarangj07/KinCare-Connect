import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable } from '@nestjs/common';

import { RateLimitExceededException } from '../../common/exceptions/rate-limit-exceeded.exception';

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
 *
 * Phase 28 (N-12) — HTTP semantics.
 *
 * An exhausted budget was reported as `403 Forbidden` because the guard
 * threw `ForbiddenException`. It now throws `RateLimitExceededException`,
 * which is HTTP 429 with a truthful `Retry-After`. Nothing about the
 * control itself changed: same 10-attempt budget, same 15-minute sliding
 * window, same per-IP key, same refusal on the same condition, same
 * production-proof bypass. Only the status a client observes is correct
 * now. The reasoning is in
 * `common/exceptions/rate-limit-exceeded.exception.ts`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, { attempts: number; lastAttempt: number }>();
  private readonly maxAttempts = 10;
  private readonly windowMs = 15 * 60 * 1000;

  /**
   * Phase 28 (N-12) — how long this caller must actually wait.
   *
   * The window slides on `lastAttempt`, which is only advanced on an
   * ALLOWED request: the refusal path throws before reaching that update,
   * so `lastAttempt` still holds the timestamp of the last attempt that
   * counted. The budget frees up when `now - lastAttempt > windowMs`
   * becomes true, i.e. at `lastAttempt + windowMs`.
   *
   * So the honest remaining time is `lastAttempt + windowMs - now`, derived
   * from the real record rather than asserted as a constant. Two details
   * matter:
   *
   *  - The comparison in `canActivate` is strict (`>`), so at exactly
   *    `lastAttempt + windowMs` the record has NOT yet reset and the
   *    request is still refused. Rounding a zero remainder down to
   *    `Retry-After: 0` would therefore be a lie that costs the caller a
   *    second failed attempt. The floor is 1.
   *  - Rounding is UP to the next whole second, because `Retry-After` is
   *    defined in seconds and rounding down would again invite an attempt
   *    that is still refused.
   */
  private retryAfterSecondsFor(record: { lastAttempt: number }, now: number): number {
    const remainingMs = record.lastAttempt + this.windowMs - now;
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

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
      // Phase 28 (N-12): 429, not 403. Throttling is not an authorization
      // decision and must not be reported as one. The budget, the window
      // and the refusal itself are unchanged from Phase 3 — only the status
      // and the `Retry-After` contract are new.
      throw new RateLimitExceededException(this.retryAfterSecondsFor(record, now));
    }
    record.attempts += 1;
    record.lastAttempt = now;
    this.store.set(ip, record);
    return true;
  }
}
