/**
 * Phase 50 — senior selection behaviour.
 *
 * These tests pin the single most important client-side security property:
 * the active senior can only ever be one the BACKEND returned. A stale or
 * fabricated id from a URL, cookie or constant must be discarded.
 */
import { describe, expect, it } from 'vitest';

import {
  applyExplicitSelection,
  formatDateOfBirth,
  looksLikeUuid,
  resolveActiveSenior,
  seniorLabel,
  type SelectionReason,
} from './seniors';
import type { ApiAccessibleSenior } from './types';

const SR_A = '11111111-1111-4111-8111-111111111111';
const SR_B = '22222222-2222-4222-8222-222222222222';
const SR_C = '33333333-3333-4333-8333-333333333333';
const NOT_A_SENIOR = '99999999-9999-4999-8999-999999999999';

function entry(
  id: string,
  fullName: string,
  role: ApiAccessibleSenior['role'] = 'FAMILY_MEMBER',
  preferredName: string | null = null,
): ApiAccessibleSenior {
  return {
    senior: { id, fullName, preferredName, dateOfBirth: '1940-04-01' },
    role,
    circles: [{ circleId: '44444444-4444-4444-8444-444444444444', circleName: 'Family circle', role }],
  };
}

function expectReason(result: ReturnType<typeof resolveActiveSenior>, reason: SelectionReason): void {
  expect(result.reason).toBe(reason);
}

describe('resolveActiveSenior — the backend list is authoritative', () => {
  it('ZERO seniors produces an explicit empty state, not an error', () => {
    const result = resolveActiveSenior([], null);
    expect(result.isEmpty).toBe(true);
    expect(result.selected).toBeNull();
    expectReason(result, 'empty');
  });

  it('ONE senior is selected automatically', () => {
    const result = resolveActiveSenior([entry(SR_A, 'Margaret Chen', 'FAMILY_ADMIN')], null);
    expect(result.selected?.id).toBe(SR_A);
    expect(result.isEmpty).toBe(false);
    expectReason(result, 'auto-single');
  });

  it('MULTIPLE seniors require an explicit choice and auto-select nothing', () => {
    const result = resolveActiveSenior(
      [entry(SR_A, 'Margaret Chen'), entry(SR_B, 'Robert Chen')],
      null,
    );
    expect(result.seniors).toHaveLength(2);
    expect(result.selected).toBeNull();
    expect(result.isEmpty).toBe(false);
    expectReason(result, 'multiple-requires-explicit-choice');
  });

  it('an authorized stored preference is honoured', () => {
    const result = resolveActiveSenior(
      [entry(SR_A, 'Margaret Chen'), entry(SR_B, 'Robert Chen')],
      SR_B,
    );
    expect(result.selected?.id).toBe(SR_B);
    expectReason(result, 'preference-honoured');
  });

  it('a STALE stored preference is rejected, never selected', () => {
    const result = resolveActiveSenior(
      [entry(SR_A, 'Margaret Chen'), entry(SR_B, 'Robert Chen')],
      NOT_A_SENIOR,
    );
    expect(result.selected?.id).not.toBe(NOT_A_SENIOR);
    expect(result.seniors.map((s) => s.id)).not.toContain(NOT_A_SENIOR);
    expectReason(result, 'multiple-requires-explicit-choice');
  });

  it('a stale preference with exactly one remaining senior falls back to that senior', () => {
    const result = resolveActiveSenior([entry(SR_A, 'Margaret Chen')], NOT_A_SENIOR);
    expect(result.selected?.id).toBe(SR_A);
    expectReason(result, 'stale-preference-rejected');
  });

  it('a senior the backend no longer returns cannot be selected even with a well-formed id', () => {
    const accessible = [entry(SR_A, 'Margaret Chen')];
    // Simulates revoking user B's membership: B is no longer in the list.
    const result = resolveActiveSenior(accessible, SR_B);
    expect(result.selected?.id).not.toBe(SR_B);
  });

  it('an empty-string preference behaves like no preference', () => {
    const result = resolveActiveSenior([entry(SR_A, 'Margaret Chen')], '');
    expect(result.selected?.id).toBe(SR_A);
    expectReason(result, 'auto-single');
  });

  it('exposes role and circle names from the backend response', () => {
    const result = resolveActiveSenior(
      [entry(SR_A, 'Margaret Chen', 'FAMILY_ADMIN', 'Maggie')],
      null,
    );
    const selected = result.selected!;
    expect(selected.role).toBe('FAMILY_ADMIN');
    expect(selected.circleNames).toEqual(['Family circle']);
    expect(selected.dateOfBirth).toBe('1940-04-01');
  });

  it('does not consult any client-side constant for a senior id', () => {
    // Every assertion above derives ids solely from the backend payload.
    // Guard: resolution must be a pure function of (list, preference).
    const list = [entry(SR_C, 'Eunice Park')];
    const first = resolveActiveSenior(list, null);
    const second = resolveActiveSenior(list, null);
    expect(first.selected?.id).toBe(second.selected?.id);
    expect(first.selected?.id).toBe(SR_C);
  });
});

describe('applyExplicitSelection', () => {
  const list = [entry(SR_A, 'Margaret Chen'), entry(SR_B, 'Robert Chen')];

  it('accepts a senior present in the backend list', () => {
    expect(applyExplicitSelection(list, SR_B)?.id).toBe(SR_B);
  });

  it('REFUSES an id that is not in the backend list', () => {
    expect(applyExplicitSelection(list, SR_C)).toBeNull();
    expect(applyExplicitSelection(list, NOT_A_SENIOR)).toBeNull();
  });

  it('refuses a non-UUID id outright', () => {
    expect(applyExplicitSelection(list, 'not-a-uuid')).toBeNull();
  });

  it('supports switching between multiple seniors', () => {
    const a = applyExplicitSelection(list, SR_A);
    const b = applyExplicitSelection(list, SR_B);
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('looksLikeUuid', () => {
  it('accepts a v4 UUID', () => {
    expect(looksLikeUuid(SR_A)).toBe(true);
  });

  it('rejects non-UUIDs and non-strings', () => {
    expect(looksLikeUuid('DEFAULT_SENIOR_ID')).toBe(false);
    expect(looksLikeUuid('00000000-0000-0000-0000-000000000001')).toBe(false); // not v4
    expect(looksLikeUuid('')).toBe(false);
    expect(looksLikeUuid(null)).toBe(false);
    expect(looksLikeUuid(42)).toBe(false);
  });
});

describe('presentation helpers', () => {
  it('prefers the preferred name when present', () => {
    const result = resolveActiveSenior([entry(SR_A, 'Margaret Chen', 'FAMILY_MEMBER', 'Maggie')], null);
    expect(seniorLabel(result.selected!)).toBe('Maggie (Margaret Chen)');
  });

  it('falls back to the full name', () => {
    const result = resolveActiveSenior([entry(SR_A, 'Margaret Chen')], null);
    expect(seniorLabel(result.selected!)).toBe('Margaret Chen');
  });

  it('formats a real date and says so when absent', () => {
    expect(formatDateOfBirth('1940-04-01')).toContain('1940');
    expect(formatDateOfBirth(null)).toBe('Not recorded');
  });
});