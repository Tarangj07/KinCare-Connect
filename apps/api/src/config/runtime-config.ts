/**
 * Phase 19 — production startup configuration validation.
 *
 * Phase 16 established fail-fast behaviour for the JWT secret and Phase 18
 * for `STORAGE_DIR`. This module adds a single, explicit pre-flight check so
 * that an invalid production configuration fails *before* the HTTP server
 * starts listening, rather than surfacing as a confusing runtime error on
 * the first request.
 *
 * Design constraints (deliberate):
 *  - **Fail closed.** An invalid production configuration aborts startup.
 *    It never silently falls back to a development default.
 *  - **No secret disclosure.** Error messages name the *variable* and the
 *    requirement, never its value, and never include a connection string.
 *  - **No behaviour change in development/test.** The extra checks are
 *    development-friendly: the existing Phase 16/18 fail-fast rules are
 *    re-used rather than re-implemented, and non-production environments are
 *    not subjected to production-only requirements.
 *  - **No new configuration.** This validates variables the code already
 *    consumes. It does not make any hardcoded security-sensitive value
 *    configurable.
 */

import { resolveJwtAccessSecret } from './security-config';

/** Result of a single validation rule. */
export interface ConfigCheck {
  /** Variable or condition the rule concerns (safe to log). */
  readonly subject: string;
  readonly ok: boolean;
  /** Present only when `ok` is false. Contains no secret material. */
  readonly detail?: string;
}

export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly checks: readonly ConfigCheck[];
  /** Newline-separated, secret-free messages. Empty when `ok` is true. */
  readonly problems: readonly string[];
}

/** A Postgres URL we can reason about without logging it. */
function classifyDatabaseUrl(value: string): { schemeOk: boolean; hasCredentials: boolean } {
  const schemeOk = /^postgres(ql)?:\/\//i.test(value);
  // Credentials are not required (trusted local socket / IAM auth), but a
  // URL with an "@" and no userinfo indicates a malformed value.
  const authority = value.replace(/^postgres(ql)?:\/\//i, '').split('?')[0] ?? '';
  const atIndex = authority.lastIndexOf('@');
  const hasCredentials = atIndex > 0;
  return { schemeOk, hasCredentials };
}

/**
 * Validate the configuration required to run the API.
 *
 * @param env process environment (injectable for tests)
 */
export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ConfigValidationResult {
  const checks: ConfigCheck[] = [];
  const isProduction = env['NODE_ENV'] === 'production';

  // --- Database ---------------------------------------------------------
  const databaseUrl = env['DATABASE_URL']?.trim() ?? '';
  if (databaseUrl.length === 0) {
    checks.push({
      subject: 'DATABASE_URL',
      ok: false,
      detail: 'DATABASE_URL is not set. The API cannot reach PostgreSQL.',
    });
  } else {
    const { schemeOk } = classifyDatabaseUrl(databaseUrl);
    checks.push({
      subject: 'DATABASE_URL',
      ok: schemeOk,
      detail: schemeOk ? undefined : 'DATABASE_URL must be a postgres:// or postgresql:// connection string.',
    });
  }

  // --- JWT signing secret ----------------------------------------------
  // The authoritative validation (length, placeholder rejection, fail-fast
  // in production) already lives in security-config.resolveJwtAccessSecret.
  // Invoke it rather than re-implementing the rules, so the two can never
  // drift. The secret itself is never included in the error.
  let jwtError: string | null = null;
  try {
    resolveJwtAccessSecret(env);
  } catch (err) {
    jwtError = err instanceof Error ? err.message : 'JWT access secret is not usable.';
  }
  checks.push({
    subject: 'JWT_ACCESS_SECRET',
    ok: jwtError === null,
    detail: jwtError ?? undefined,
  });

  // --- Document storage -------------------------------------------------
  // Phase 18 made STORAGE_DIR mandatory in production inside
  // StorageService's constructor. Re-check here so the failure is reported
  // as a configuration problem *before* anything else initialises, and keep
  // the same rule rather than introducing a second policy.
  const storageDir = env['STORAGE_DIR']?.trim() ?? '';
  if (storageDir.length === 0) {
    checks.push({
      subject: 'STORAGE_DIR',
      ok: !isProduction,
      detail: isProduction
        ? 'STORAGE_DIR is required when NODE_ENV=production. Document contents are protected health information and must not default to the application directory.'
        : undefined,
    });
  } else {
    checks.push({ subject: 'STORAGE_DIR', ok: true });
  }

  const problems = checks.filter((c) => !c.ok).map((c) => `${c.subject}: ${c.detail ?? 'invalid'}`);
  return { ok: problems.length === 0, checks, problems };
}

/**
 * Throw when the configuration is unusable.
 *
 * @throws Error whose message lists the failing subjects and requirements.
 *   The message never contains a value, secret, or connection string.
 */
export function assertRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const result = validateRuntimeConfig(env);
  if (result.ok) return;
  throw new Error(
    'Invalid runtime configuration — refusing to start:\n  - ' +
      result.problems.join('\n  - '),
  );
}
