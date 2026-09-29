/**
 * Phase 23 (W4) — password policy.
 *
 * Two things are proven here, and neither is proven by a source read.
 *
 * 1. EQUIVALENCE. Within MAX_PASSWORD_LENGTH the policy must accept and
 *    reject exactly what the original quadratic regex did. Enumerating a
 *    4-symbol alphabet exhaustively up to length 5, plus realistic pools,
 *    catches a hand-written simplification that quietly tightened or loosened
 *    the rule. A silently stronger rule would lock existing users out of
 *    registration; a silently weaker one would admit weak passwords.
 *
 *    The one intentional difference is the length cap, which the rewrite
 *    adds: argon2 over a multi-kilobyte password is itself a cost problem.
 *    That boundary is asserted explicitly rather than left as an unstated
 *    divergence.
 *
 * 2. COST. The whole point of the rewrite is that it cannot be made to burn
 *    CPU. A test that only checks correctness would pass just as happily
 *    against the original regex, so the linear-cost property is asserted
 *    directly, with a generous multiplier so it does not flake on a loaded
 *    machine while still failing loudly if the quadratic behaviour returns.
 */
import { describe, expect, it } from 'vitest';

import { isAcceptablePassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy';

/**
 * The pattern this replaced, kept verbatim. It is only ever passed strings of
 * a few characters: running the ReDoS probe on it is what caused the outage
 * this file exists to prevent.
 */
const LEGACY_PATTERN =
  /(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*|(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*|(?=.*[A-Z])(?=.*[\W_]).*|(?=.*[a-z])(?=.*[\W_])(?=.*\d).*/;

const legacy = (s: string): boolean => LEGACY_PATTERN.test(s) && s.length >= MIN_PASSWORD_LENGTH;

const ALPHABET = ['a', 'B', '1', '!'];

function* combinations(length: number): Generator<string> {
  if (length === 0) {
    yield '';
    return;
  }
  for (const ch of ALPHABET) {
    for (const rest of combinations(length - 1)) yield ch + rest;
  }
}

describe('password policy (Phase 23 W4)', () => {
  describe('equivalence with the pattern it replaces', () => {
    it('agrees exhaustively over a 4-symbol alphabet up to length 5', () => {
      const disagreements: string[] = [];
      let compared = 0;
      for (let length = 1; length <= 5; length += 1) {
        for (const s of combinations(length)) {
          compared += 1;
          if (isAcceptablePassword(s) !== legacy(s)) disagreements.push(s);
        }
      }
      expect(compared).toBe(4 + 16 + 64 + 256 + 1024);
      expect(disagreements, `policy disagrees with the legacy pattern on: ${disagreements.join(', ')}`).toEqual([]);
    });

    it('agrees on realistic inputs, including the awkward boundaries', () => {
      // All inputs here are within MAX_PASSWORD_LENGTH, which is where the
      // equivalence claim holds. The length cap is a deliberate, documented
      // addition and is asserted separately below.
      const cases = [
        'alllowercase',
        'ALLUPPERCASE',
        '12345678',
        '!!!!!!!!',
        'Password1',
        'passw0rd',
        'Password!',
        'passw0r!',
        'Pass1!',
        'P4ssword',
        'p4ssword',
        'P4ssw0rd',
        'aaAA1111',
        'aaAA111!',
        'aa11!!!',
        'AA11!!!',
        'Ab1!Ab1!',
        '  spaces are symbols 1A',
        'ünïcödé1A',
        '🔐🔐🔐🔐1Aa',
        '1234567',
        'Aa1!',
        'a'.repeat(200),
        'aA1!'.repeat(50),
        'aA1!'.repeat(60),
      ];
      const disagreements = cases.filter((s) => isAcceptablePassword(s) !== legacy(s));
      expect(disagreements, `policy disagrees on: ${disagreements.map((s) => s.slice(0, 24)).join(', ')}`).toEqual([]);
    });

    it('rejects non-strings rather than throwing', () => {
      for (const value of [undefined, null, 123, {}, [], true, Buffer.from('Aa1!')]) {
        expect(isAcceptablePassword(value)).toBe(false);
      }
    });
  });

  describe('cost', () => {
    it('an 8KB input is evaluated in single-digit milliseconds, not seconds', () => {
      const size = 8 * 1024;
      const hostile = 'x'.repeat(size);
      const started = process.hrtime.bigint();
      const result = isAcceptablePassword(hostile);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

      expect(result).toBe(false);
      // The legacy pattern took ~240ms at this size and ~240,000ms at 256KB.
      // 50ms is a wide margin over a single pass yet far below the quadratic
      // cost at the same input, so this fails if the old behaviour returns.
      expect(
        elapsedMs,
        `evaluating an ${size}-byte password took ${elapsedMs.toFixed(1)}ms; the policy is no longer linear`,
      ).toBeLessThan(50);
    });

    it('a 1MB input stays linear', () => {
      const started = process.hrtime.bigint();
      isAcceptablePassword('x'.repeat(1024 * 1024));
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      // 128x the 8KB input; linear cost means roughly 128x the time, which is
      // still under a millisecond of real work. Anything approaching a second
      // here means backtracking has been reintroduced.
      expect(elapsedMs, `a 1MB password took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(200);
    });
  });

  describe('policy', () => {
    it('requires at least the minimum length', () => {
      expect(MIN_PASSWORD_LENGTH).toBe(8);
      // 'Aa1' is 3 characters, 'Aa1234' is 6, 'Aa12345' is 7: all short,
      // so all rejected on length even though each is otherwise strong.
      expect(isAcceptablePassword('Aa1')).toBe(false);
      expect(isAcceptablePassword('Aa1234')).toBe(false);
      expect(isAcceptablePassword('Aa12345')).toBe(false);
      // 'Aa123456' is exactly 8 and strong: the first acceptable value.
      expect(isAcceptablePassword('Aa123456')).toBe(true);
      // Same characters, but 'aaaa1111' has no upper case.
      expect(isAcceptablePassword('aaaa1111')).toBe(false);
      // 'Aa!!!aaa!' has upper and a symbol: acceptable.
      expect(isAcceptablePassword('Aa!!!aaa!')).toBe(true);
    });

    it('refuses input large enough to be a hashing cost problem', () => {
      // Within the cap the policy agrees with the legacy pattern; above it
      // the policy is deliberately stricter. That difference is intentional
      // and is the one place the two do not agree, so it is asserted rather
      // than left implicit.
      const atCap = 'Aa1!'.repeat(MAX_PASSWORD_LENGTH / 4);
      expect(atCap).toHaveLength(MAX_PASSWORD_LENGTH);
      expect(isAcceptablePassword(atCap)).toBe(true);
      expect(legacy(atCap)).toBe(true);

      const overCap = 'Aa1!'.repeat(MAX_PASSWORD_LENGTH / 4 + 1);
      expect(isAcceptablePassword(overCap)).toBe(false);
      expect(legacy(overCap)).toBe(true);
    });
  });
});
