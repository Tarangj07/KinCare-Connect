/**
 * Phase 50 — senior selection.
 *
 * PURE MODULE. No React, no fetch, no I/O. Everything here is a function of
 * (authoritative list from the backend, previously-selected id).
 *
 * The single rule this module exists to enforce:
 *
 *   A senior can only be selected if the BACKEND returned it.
 *
 * A senior id from a URL, a query parameter, local storage, a constant, or
 * any other client-side source is NEVER sufficient. `resolveActiveSenior`
 * treats such a value as a *preference hint* only, and discards it when it is
 * not present in the authoritative list. This is UI correctness, not a
 * security control — `AuthorizationService` on the server remains the only
 * thing that decides whether an action is allowed.
 */
import type { ApiAccessibleSenior } from './types';

export interface SeniorOption {
  id: string;
  fullName: string;
  preferredName: string | null;
  role: ApiAccessibleSenior['role'];
  circleNames: string[];
  /** `YYYY-MM-DD` or null. */
  dateOfBirth: string | null;
}

export type SelectionReason =
  /** The stored preference was still authorized; honoured. */
  | 'preference-honoured'
  /** No usable preference; exactly one authorized senior, selected automatically. */
  | 'auto-single'
  /** A stored preference existed but is no longer authorized; discarded. */
  | 'stale-preference-rejected'
  /** No preference and several authorized seniors; nothing auto-selected. */
  | 'multiple-requires-explicit-choice'
  /** The caller has no authorized seniors at all. */
  | 'empty';

export interface SeniorResolution {
  seniors: SeniorOption[];
  selected: SeniorOption | null;
  reason: SelectionReason;
  /** True when the caller has no authorized seniors and needs onboarding. */
  isEmpty: boolean;
}

export function toSeniorOption(entry: ApiAccessibleSenior): SeniorOption {
  return {
    id: entry.senior.id,
    fullName: entry.senior.fullName,
    preferredName: entry.senior.preferredName,
    role: entry.role,
    circleNames: entry.circles.map((c) => c.circleName),
    dateOfBirth: entry.senior.dateOfBirth,
  };
}

/** True when `id` is a UUID — a shape check only, never an authorization check. */
export function looksLikeUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve the active senior from the authoritative list.
 *
 * `preferredId` may be `null`. If it is present but absent from `seniors`, it
 * is rejected — that is the stale-selection case, and it is the reason this
 * module does not simply trust the stored value.
 */
export function resolveActiveSenior(
  seniors: ApiAccessibleSenior[],
  preferredId: string | null | undefined,
): SeniorResolution {
  const options = seniors.map(toSeniorOption);

  if (options.length === 0) {
    return { seniors: options, selected: null, reason: 'empty', isEmpty: true };
  }

  if (preferredId) {
    const match = options.find((s) => s.id === preferredId);
    if (match) {
      return { seniors: options, selected: match, reason: 'preference-honoured', isEmpty: false };
    }
    // Stale: the backend no longer authorizes this senior.
    if (options.length === 1) {
      return {
        seniors: options,
        selected: options[0] ?? null,
        reason: 'stale-preference-rejected',
        isEmpty: false,
      };
    }
    return {
      seniors: options,
      selected: null,
      reason: 'multiple-requires-explicit-choice',
      isEmpty: false,
    };
  }

  if (options.length === 1) {
    return { seniors: options, selected: options[0] ?? null, reason: 'auto-single', isEmpty: false };
  }

  return {
    seniors: options,
    selected: null,
    reason: 'multiple-requires-explicit-choice',
    isEmpty: false,
  };
}

/**
 * Apply a user's explicit choice.
 *
 * Returns `null` when the chosen id is not in the authoritative list, so a
 * tampered selection cannot enter application state.
 */
export function applyExplicitSelection(
  seniors: ApiAccessibleSenior[],
  chosenId: string,
): SeniorOption | null {
  const options = seniors.map(toSeniorOption);
  return options.find((s) => s.id === chosenId) ?? null;
}

/** Best available display label for a senior. */
export function seniorLabel(senior: SeniorOption): string {
  return senior.preferredName && senior.preferredName.length > 0
    ? `${senior.preferredName} (${senior.fullName})`
    : senior.fullName;
}

/** Format `YYYY-MM-DD` for display, tolerating a missing value. */
export function formatDateOfBirth(value: string | null): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}