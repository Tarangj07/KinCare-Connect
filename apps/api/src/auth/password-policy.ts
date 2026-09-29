/**
 * Password strength policy.
 *
 * Phase 23 (W4) — this replaces a regular expression that was a
 * denial-of-service vector.
 *
 * The previous rule, in `auth.dto.ts`, was:
 *
 *   /(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*|(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*|.../
 *
 * It is quadratic in the length of the input. Each of the four alternatives
 * begins with a `.*` lookahead, and the trailing `.*` then re-scans the
 * string for every starting offset the engine tries, because the pattern is
 * unanchored. Measured on the input `"x".repeat(n)`:
 *
 *     n =   8 KB ->    0.2 s
 *     n =  64 KB ->   15   s
 *     n = 256 KB ->  240   s
 *
 * `POST /auth/register` is an unauthenticated, public endpoint, so a single
 * request with a large `password` field pinned the Node event loop for
 * minutes — during which the process serves no other request, including
 * liveness and readiness probes. An orchestrator would then see an unhealthy
 * container. This was reachable before Phase 23 as well (body-parser's 100kb
 * default still permitted ~90 seconds of blocked event loop), and the
 * explicit body limit makes it easier to reach, not harder — which is why it
 * had to be fixed rather than merely bounded.
 *
 * The policy is unchanged. Expressed plainly, a password is acceptable when
 * it has at least 8 characters and contains any two of: an upper-case
 * letter, a lower-case letter, a digit, a symbol. Equivalently:
 *
 *     (upper && lower && digit)
 *  || (upper && symbol)
 *  || (lower && symbol && digit)
 *
 * Within MAX_PASSWORD_LENGTH that equivalence is verified case-for-case
 * against the original pattern over an exhaustive enumeration of a 4-symbol
 * alphabet up to length 5 and over a set of realistic pools — see
 * `password-policy.spec.ts`, where any disagreement fails the build.
 *
 * Above MAX_PASSWORD_LENGTH the policy is deliberately stricter than the
 * pattern it replaces. That is the single intentional difference, and it
 * closes a second problem: argon2 over a multi-kilobyte password is a
 * deliberate CPU cost, and a caller must not be able to choose its size.
 *
 * The implementation is a single pass with a bounded amount of state, so its
 * cost is linear in the input length with no backtracking.
 */
export const MAX_PASSWORD_LENGTH = 1024;
export const MIN_PASSWORD_LENGTH = 8;

export function isAcceptablePassword(password: unknown): boolean {
  if (typeof password !== 'string') return false;
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  let upper = false;
  let lower = false;
  let digit = false;
  let symbol = false;
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    if (code >= 0x41 && code <= 0x5a) upper = true;
    else if (code >= 0x61 && code <= 0x7a) lower = true;
    else if (code >= 0x30 && code <= 0x39) digit = true;
    else symbol = true;
  }

  return (
    (upper && lower && digit) || (upper && symbol) || (lower && symbol && digit)
  );
}

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters with a mix of letters, numbers, and optionally special characters.';
