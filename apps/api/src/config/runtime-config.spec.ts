import { describe, expect, it } from 'vitest';

import { assertRuntimeConfig,validateRuntimeConfig } from './runtime-config';

const VALID_SECRET = 'a'.repeat(48);

/** A baseline environment that passes every production rule. */
function productionEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:password@db.internal:5432/ecc',
    JWT_ACCESS_SECRET: VALID_SECRET,
    STORAGE_DIR: '/srv/ecc/uploads',
    ...overrides,
  };
}

describe('runtime configuration validation (Phase 19)', () => {
  describe('fail-closed behaviour', () => {
    it('accepts a complete production configuration', () => {
      const result = validateRuntimeConfig(productionEnv());
      expect(result.ok).toBe(true);
      expect(result.problems).toEqual([]);
    });

    it('rejects production when DATABASE_URL is missing', () => {
      const result = validateRuntimeConfig(productionEnv({ DATABASE_URL: undefined }));
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain('DATABASE_URL');
    });

    it('rejects production when DATABASE_URL is not a postgres URL', () => {
      const result = validateRuntimeConfig(productionEnv({ DATABASE_URL: 'mysql://h/db' }));
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain('postgres');
    });

    it('rejects production when the JWT secret is missing', () => {
      const result = validateRuntimeConfig(productionEnv({ JWT_ACCESS_SECRET: undefined }));
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain('JWT_ACCESS_SECRET');
    });

    it('rejects production when the JWT secret is too short (Phase 16 rule reused)', () => {
      const result = validateRuntimeConfig(productionEnv({ JWT_ACCESS_SECRET: 'too-short' }));
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain('at least 32 characters');
    });

    it('rejects production when STORAGE_DIR is missing (Phase 18 rule reused)', () => {
      const result = validateRuntimeConfig(productionEnv({ STORAGE_DIR: undefined }));
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain('STORAGE_DIR is required');
    });

    it('reports every failing rule at once rather than only the first', () => {
      const result = validateRuntimeConfig({
        NODE_ENV: 'production',
        DATABASE_URL: '',
        JWT_ACCESS_SECRET: '',
        STORAGE_DIR: '',
      });
      expect(result.ok).toBe(false);
      expect(result.checks.filter((c) => !c.ok).map((c) => c.subject).sort()).toEqual([
        'DATABASE_URL',
        'JWT_ACCESS_SECRET',
        'STORAGE_DIR',
      ]);
    });
  });

  describe('no secret disclosure', () => {
    it('never includes a secret value in the problem text', () => {
      // Too short to be accepted, and distinctive enough to search for.
      const secret = 'LEAKY-SECRET-VALUE';
      const result = validateRuntimeConfig(
        productionEnv({ JWT_ACCESS_SECRET: secret }),
      );
      expect(result.ok).toBe(false);
      expect(result.problems.join()).not.toContain(secret);
      expect(result.problems.join()).not.toContain('LEAKY');
    });

    it('never includes the database password or host in the problem text', () => {
      const result = validateRuntimeConfig(
        productionEnv({ DATABASE_URL: 'not-a-url-with-hunter2' }),
      );
      expect(result.ok).toBe(false);
      expect(result.problems.join()).not.toContain('hunter2');
    });

    it('assertRuntimeConfig throws a message free of secrets', () => {
      const dbUrl = 'postgresql://user:hunter2@db.internal:5432/ecc';
      let thrown: Error | null = null;
      try {
        assertRuntimeConfig({ NODE_ENV: 'production', DATABASE_URL: dbUrl, JWT_ACCESS_SECRET: 'x' });
      } catch (err) {
        thrown = err as Error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown?.message).toContain('refusing to start');
      expect(thrown?.message).not.toContain('hunter2');
      expect(thrown?.message).not.toContain('db.internal');
    });
  });

  describe('non-production environments are not over-constrained', () => {
    it('does not require STORAGE_DIR in development', () => {
      const result = validateRuntimeConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/ecc',
        JWT_ACCESS_SECRET: VALID_SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('does not require STORAGE_DIR when NODE_ENV is unset', () => {
      const result = validateRuntimeConfig({
        DATABASE_URL: 'postgresql://localhost:5432/ecc',
        JWT_ACCESS_SECRET: VALID_SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('still requires DATABASE_URL everywhere', () => {
      const result = validateRuntimeConfig({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: VALID_SECRET,
      });
      expect(result.ok).toBe(false);
      expect(result.problems.join()).toContain('DATABASE_URL');
    });
  });

  describe('test-environment rate-limit bypass remains unreachable in production', () => {
    it('a production process is not validated as a test run even with the bypass flag', () => {
      // Guards against Phase 19 accidentally relaxing the Phase 18 rule:
      // the flag must not make an invalid production config look valid.
      const result = validateRuntimeConfig(
        productionEnv({ ECC_TEST_DISABLE_RATE_LIMIT: '1' }),
      );
      expect(result.ok).toBe(true);
      // ...and with a broken config it is still rejected regardless of the flag.
      const broken = validateRuntimeConfig(
        productionEnv({ ECC_TEST_DISABLE_RATE_LIMIT: '1', STORAGE_DIR: undefined }),
      );
      expect(broken.ok).toBe(false);
    });
  });
});
