import { afterEach, describe, expect, it } from 'vitest';

import { generateTokenId, generateTokenSecret, hashToken, resetEphemeralDevSecretForTests, resolveJwtAccessSecret } from './security-config';

describe('security-config — JWT secret resolution (Phase 16 C2/A2)', () => {
  afterEach(() => {
    resetEphemeralDevSecretForTests();
  });

  it('production refuses to start with no secret', () => {
    expect(() => resolveJwtAccessSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('production refuses the repository-public dev secret', () => {
    expect(() =>
      resolveJwtAccessSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-secret-change-me' } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/);
  });

  it('production refuses the .env placeholder value', () => {
    expect(() =>
      resolveJwtAccessSecret({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'replace-me-with-a-64-character-random-string-aaaaaaaaaaaaaaaaaa',
      } as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/);
  });

  it('production refuses a too-short secret', () => {
    expect(() => resolveJwtAccessSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short-secret' } as NodeJS.ProcessEnv)).toThrow(
      /at least 32/,
    );
  });

  it('production accepts a real 32+ char secret', () => {
    const good = 'a'.repeat(20) + 'b'.repeat(14);
    expect(resolveJwtAccessSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: good } as NodeJS.ProcessEnv)).toBe(good);
  });

  it('dev with a missing secret never returns a known constant', () => {
    resetEphemeralDevSecretForTests();
    const first = resolveJwtAccessSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(first).not.toBe('dev-secret-change-me');
    expect(first.length).toBeGreaterThanOrEqual(32);
    // Stable for the lifetime of the process (tokens survive requests).
    expect(resolveJwtAccessSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(first);
  });

  it('dev with a placeholder secret also generates a random ephemeral key', () => {
    const dev = resolveJwtAccessSecret({
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'dev-secret-change-me',
    } as NodeJS.ProcessEnv);
    expect(dev).not.toBe('dev-secret-change-me');
    expect(dev.length).toBeGreaterThanOrEqual(32);
  });
});

describe('security-config — CSPRNG token material (Phase 16 C1/A1)', () => {
  it('token secret has 256 bits of entropy (43-char base64url) and is unique across samples', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const s = generateTokenSecret();
      expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
      samples.add(s);
    }
    expect(samples.size).toBe(200);
  });

  it('token ids are RFC-4122 UUIDs, not Date.now+Math.random composites', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateTokenId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });

  it('jti format is not derivable from Math.random range (no timestamp prefix)', () => {
    // The old generator produced `<digits>-<digits>` which was both
    // predictable and collision-prone. A UUID v4 contains dashes only at
    // fixed positions and is 36 chars.
    const id = generateTokenId();
    expect(id.length).toBe(36);
    expect(id.split('-').length).toBe(5);
  });

  it('hashToken is deterministic, 64-hex, and does not store the secret', () => {
    const secret = generateTokenSecret();
    const h1 = hashToken(secret);
    const h2 = hashToken(secret);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain(secret);
  });
});
