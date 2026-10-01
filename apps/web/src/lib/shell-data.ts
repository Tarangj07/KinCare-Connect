/**
 * Phase 50 — the shared server-side data loader for the authenticated app.
 *
 * Server-only. This is the ONE place that combines session, senior discovery
 * and senior-scoped reads. Pages call these functions; no page invents its own
 * seniorId, and no page talks to the API directly.
 */
import { ApiError, isApiError } from '@/lib/api-error';
import {
  fetchAccessibleSeniors,
  fetchAppointments,
  fetchMedications,
} from '@/lib/api-client';
import { resolveActiveSenior, type SeniorResolution } from '@/lib/seniors';
import type { ApiAccessibleSenior, ApiAppointment, ApiMedication, CircleRole } from '@/lib/types';
import { readAccessToken, readIdentity, readSeniorPreference } from '@/app/api/_session';

export interface SeniorScopedResult<T> {
  data: T | null;
  /** Preserved failure classification — never collapsed into "empty". */
  error: { kind: string; message: string; status?: number } | null;
}

export interface AppShellData {
  user: { id: string; email: string; fullName: string; globalRole: string } | null;
  seniors: SeniorResolution;
  /** Non-null when seniors could not be loaded at all (distinct from empty). */
  seniorsError: { kind: string; message: string; status?: number } | null;
}

function toErrorPayload(error: unknown): { kind: string; message: string; status?: number } {
  if (isApiError(error)) {
    return { kind: error.kind, message: error.message, status: error.status };
  }
  return { kind: 'unknown', message: 'Something went wrong.' };
}

/**
 * Load everything the application shell needs.
 *
 * A failure to load seniors is reported separately from "no seniors" so the
 * UI can distinguish them. That distinction is the Phase 48 false-success
 * failure mode this phase is required not to repeat.
 */
export async function loadAppShell(preferenceOverride?: string | null): Promise<AppShellData> {
  const user = await readIdentity();
  if (!user) {
    const empty: SeniorResolution = {
      seniors: [],
      selected: null,
      reason: 'empty',
      isEmpty: true,
    };
    return { user: null, seniors: empty, seniorsError: null };
  }

  const accessToken = readAccessToken();
  if (!accessToken) {
    const empty: SeniorResolution = { seniors: [], selected: null, reason: 'empty', isEmpty: true };
    return { user: null, seniors: empty, seniorsError: null };
  }

  let accessible: ApiAccessibleSenior[];
  try {
    accessible = await fetchAccessibleSeniors(accessToken);
  } catch (error) {
    const empty: SeniorResolution = { seniors: [], selected: null, reason: 'empty', isEmpty: true };
    return { user, seniors: empty, seniorsError: toErrorPayload(error) };
  }

  // A caller-supplied preference (e.g. an explicit `?senior=`) is validated
  // against the list the BACKEND just returned; a value absent from it is
  // discarded by `resolveActiveSenior`.
  const preference =
    preferenceOverride === undefined ? readSeniorPreference() : preferenceOverride;
  const seniors = resolveActiveSenior(accessible, preference);
  return { user, seniors, seniorsError: null };
}

/** Medications for a senior the backend has already authorized us for. */
export async function loadMedications(seniorId: string): Promise<SeniorScopedResult<ApiMedication[]>> {
  const accessToken = readAccessToken();
  if (!accessToken) {
    return {
      data: null,
      error: { kind: 'unauthenticated', message: 'Sign in required.' },
    };
  }
  try {
    return { data: await fetchMedications(seniorId, accessToken), error: null };
  } catch (error) {
    return { data: null, error: toErrorPayload(error) };
  }
}

/** Appointments for a senior the backend has already authorized us for. */
export async function loadAppointments(seniorId: string): Promise<SeniorScopedResult<ApiAppointment[]>> {
  const accessToken = readAccessToken();
  if (!accessToken) {
    return { data: null, error: { kind: 'unauthenticated', message: 'Sign in required.' } };
  }
  try {
    return { data: await fetchAppointments(seniorId, accessToken), error: null };
  } catch (error) {
    return { data: null, error: toErrorPayload(error) };
  }
}

/** Human-readable summary of the caller's relationship to the active senior. */
export function describeMembership(role: CircleRole, circleNames: string[]): string {
  const circles = circleNames.length > 0 ? ` in ${circleNames.join(', ')}` : '';
  switch (role) {
    case 'FAMILY_ADMIN':
      return `Family administrator${circles}`;
    case 'FAMILY_MEMBER':
      return `Family member${circles}`;
    case 'CAREGIVER':
      return `Caregiver${circles}`;
    case 'DOCTOR':
      return `Doctor${circles}`;
    case 'OBSERVER':
      return `Observer${circles}`;
    default:
      return `Member${circles}`;
  }
}

export function isAuthorizationError(error: { kind: string } | null): boolean {
  return error?.kind === 'forbidden' || error?.kind === 'unauthenticated';
}

export { ApiError };