/**
 * Phase 50 — typed contract mirroring the existing backend responses.
 *
 * These types describe what the API ALREADY returns. They are not a new
 * contract and the backend was not modified to suit them.
 *
 * `GET /api/v1/auth/me` returns exactly four fields — deliberately no
 * seniorId. Senior discovery is a SEPARATE call to `GET /api/v1/me/seniors`,
 * which is the Phase 49 authoritative source of which seniors the caller may
 * act on.
 */

/** `GET /api/v1/auth/me` — the existing identity contract, unchanged. */
export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  globalRole: string;
}

/** `GET /api/v1/auth/login` response body. */
export interface ApiLoginResponse {
  user: ApiUser;
  access: string;
}

/** Mirrors the Prisma `CircleRole` enum. */
export const CIRCLE_ROLES = [
  'FAMILY_ADMIN',
  'FAMILY_MEMBER',
  'CAREGIVER',
  'DOCTOR',
  'OBSERVER',
] as const;

export type CircleRole = (typeof CIRCLE_ROLES)[number];

/** One senior as returned inside `GET /api/v1/me/seniors`. */
export interface ApiSenior {
  id: string;
  fullName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
}

/**
 * One entry of `GET /api/v1/me/seniors`.
 *
 * `role` is a DISPLAY HINT emitted by the backend. It is not an authorization
 * decision: every senior-scoped API re-derives the caller's real role through
 * `AuthorizationService`. The UI may use it to describe context, never to
 * decide what the server will allow.
 */
export interface ApiAccessibleSenior {
  senior: ApiSenior;
  role: CircleRole;
  circles: Array<{ circleId: string; circleName: string; role: CircleRole }>;
}

export interface ApiMedication {
  id: string;
  name: string;
  dosage: string;
  form: string | null;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface ApiAppointment {
  id: string;
  title: string;
  providerName: string | null;
  startsAt: string;
  status: string;
}

export interface ApiCircleMember {
  id: string;
  userId: string | null;
  role: string;
  status: string;
  displayName: string | null;
  endsAt: string | null;
  memberName: string | null;
}

export function isCircleRole(value: unknown): value is CircleRole {
  return typeof value === 'string' && (CIRCLE_ROLES as readonly string[]).includes(value);
}