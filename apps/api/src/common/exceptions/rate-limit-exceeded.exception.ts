import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Phase 28 (N-12) — throttling is not an authorization failure.
 *
 * The rate limiter previously threw `ForbiddenException`, so an exhausted
 * budget was reported to clients as HTTP 403. That is wrong in a way that
 * matters operationally and for security reporting:
 *
 *   - 403 means "the server understood who you are and refuses this". A
 *     throttled caller has not been refused on any authorization ground;
 *     it has been asked to slow down. RFC 6585 §4 defines 429 for exactly
 *     this, and RFC 9110 §15.5.29 requires a server *not* to use 403 for
 *     rate limiting.
 *   - A client cannot tell the two apart. 429 is the status HTTP client
 *     libraries universally treat as retryable; 403 is not. A legitimate
 *     user tripping the budget had no way to know it should retry rather
 *     than give up, and an operator reading access logs could not
 *     distinguish an attacker's burst from a user being throttled.
 *   - The mobile client treats 403 as a credential failure and deletes the
 *     stored access token (`apps/mobile/src/services/api.ts`), so being
 *     throttled logged users out. See that file's Phase 28 note.
 *   - `GlobalExceptionFilter` already had a `case 429: return 'RATE_LIMITED'`
 *     branch that no code path could reach, because nothing threw a 429.
 *
 * The exception lives in `common/` rather than in `auth/` so the global
 * exception filter can reference it without `common/` importing from a
 * feature module.
 *
 * `Retry-After` is carried on the exception rather than set on the response
 * inside the guard, so there is exactly one place that shapes a response —
 * the global filter — and the delay is a testable property of the thrown
 * value rather than a side effect on an HTTP object.
 */
export class RateLimitExceededException extends HttpException {
  /**
   * Whole seconds the caller should wait, derived by the caller from the
   * limiter's real window. Always >= 1: see the guard for why 0 would be a
   * lie even when the arithmetic says so.
   */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    // The Phase 3 message is preserved verbatim. It names the condition and
    // nothing else — no IP, no identifier, no internal state — so it leaks
    // nothing beyond the fact that this caller is being throttled.
    super('Rate limit exceeded. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
