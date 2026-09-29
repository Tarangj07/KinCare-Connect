import { createHash, randomBytes, randomUUID } from 'crypto';

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'dev-secret-change-me',
  'replace-me-with-a-64-character-random-string-aaaaaaaaaaaaaaaaaa',
  'replace-me-with-a-different-64-character-random-string-bbbbb',
]);

/**
 * Access-token lifetime, in seconds.
 *
 * Phase 24 (D-2). This was previously the literal `'15m'`, written twice —
 * once in `AppModule`'s `JwtModule` sign options and once in
 * `AuthService.generateAccessToken` — and nothing constrained how long the
 * *verifier* was willing to honour a token. The value lives here so that
 * issuance and verification cannot drift apart, which is the failure mode
 * that would silently widen the deactivated-token window (deferred D-1).
 *
 * It is a constant, not an environment variable: token lifetime is a
 * security policy of the product, not a deployment knob, and a
 * configurable lifetime is how "unbounded" arrives in the first place.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * How far into the future an access token's `iat` may be and still be accepted.
 *
 * Phase 25 (F-1). `maxAge` bounds a token by `iat + ACCESS_TOKEN_TTL_SECONDS`,
 * which is only an UPPER bound on validity when `iat` is not itself in the
 * future. `jsonwebtoken` has no option for this: it computes
 * `clockTimestamp >= iat + maxAge` and, for a future-dated `iat`, that
 * inequality is false for a long time, so a token stamped ten years ahead
 * satisfies every check the verifier performs. The documented guarantee
 * "effective validity is min(exp, iat + 15m)" was therefore false for
 * maliciously future-dated `iat` values, and the claim had to be corrected by
 * refusing those tokens rather than by restating it.
 *
 * The window is 5 seconds: enough for ordinary clock jitter between the
 * instances that mint and the instances that verify, and small enough that
 * the extra life an `iat` inside it buys is negligible next to the 15-minute
 * lifetime itself. It is a constant, for the same reason the lifetime is.
 */
export const ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS = 5;

/**
 * The single rule every access-token verifier must apply to `iat`.
 *
 * Returns true only for a finite numeric `iat` that is not more than
 * ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS ahead of the verifier's clock. A
 * missing, non-numeric, non-finite or future-dated `iat` is refused; a token
 * without one cannot be age-bounded at all, and this service issues one on
 * every access token.
 *
 * `nowSeconds` is injectable so the rule is testable without mocking time, and
 * so issuance and verification cannot drift apart.
 */
export function isAccessTokenIssuedInThePast(
  iat: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false;
  return iat <= nowSeconds + ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS;
}

function looksPlaceholder(secret: string): boolean {
  return (
    KNOWN_PLACEHOLDER_SECRETS.has(secret) ||
    secret.includes('replace-me') ||
    secret.includes('change-me')
  );
}

// Ephemeral per-process dev key, generated once. Replacing the old
// repository-public 'dev-secret-change-me' constant (Phase 16 — C2/A2):
// even in development the signing key is no longer a known secret.
let devSecretCache: string | null = null;

/**
 * Resolve and validate the JWT access secret (Phase 16 — C2/A2).
 *
 * - Production: JWT_ACCESS_SECRET must be present, ≥32 chars, and not a
 *   placeholder — otherwise the process refuses to start. There is no
 *   silent fallback to any known dev secret at any tier.
 * - Development/test: a missing or placeholder secret generates a random
 *   ephemeral key for the lifetime of the process and logs a warning
 *   (tokens die on restart, which is the correct dev experience).
 */
export function resolveJwtAccessSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env['JWT_ACCESS_SECRET'];
  const isProduction = env['NODE_ENV'] === 'production';

  if (secret && !looksPlaceholder(secret)) {
    if (secret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
    }
    return secret;
  }

  if (isProduction) {
    throw new Error(
      'JWT_ACCESS_SECRET is missing or set to a placeholder value. ' +
        'Refusing to start production with an unsafe signing secret.',
    );
  }

  if (!devSecretCache) {
    devSecretCache = randomBytes(32).toString('base64url');
    // eslint-disable-next-line no-console
    console.warn(
      '[security] JWT_ACCESS_SECRET missing/placeholder — using an ephemeral random dev key. ' +
        'Tokens will not survive a restart. Set a real secret before deploying.',
    );
  }
  return devSecretCache;
}

/** Test helper: clears the ephemeral dev key between suites. */
export function resetEphemeralDevSecretForTests(): void {
  devSecretCache = null;
}

/** 256-bit CSPRNG secret in URL-safe base64 (Phase 16 — C1/A1). */
export function generateTokenSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Collision-safe opaque token id from the CSPRNG (Phase 16 — C1/A1). */
export function generateTokenId(): string {
  return randomUUID();
}

/**
 * SHA-256 of a token whose secret half has 256 bits of CSPRNG entropy.
 * Argon2 is reserved for low-entropy inputs (passwords); hashing a 256-bit
 * random secret with SHA-256 is the design documented in the Prisma schema
 * and keeps refresh verification O(1) (Phase 16 — H4/A6).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
