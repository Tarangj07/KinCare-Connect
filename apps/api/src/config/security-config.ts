import { createHash, randomBytes, randomUUID } from 'crypto';

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'dev-secret-change-me',
  'replace-me-with-a-64-character-random-string-aaaaaaaaaaaaaaaaaa',
  'replace-me-with-a-different-64-character-random-string-bbbbb',
]);

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
