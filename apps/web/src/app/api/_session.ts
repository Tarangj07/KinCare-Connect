/**
 * Phase 50 — shared server session helpers.
 *
 * Server-only. Reads the HTTP-only access cookie, VERIFIES it against
 * `GET /auth/me`, and only then reports an authenticated session.
 *
 * The verification step is the point: the presence of a cookie is never
 * accepted as proof. A tampered, expired or revoked token fails verification
 * and the session is reported as unauthenticated/expired.
 */
import { cookies } from 'next/headers';

import { ApiError } from '@/lib/api-error';
import { fetchMe } from '@/lib/api-client';
import {
  ACCESS_COOKIE,
  SENIOR_COOKIE,
  type SessionIdentity,
  type SessionState,
  sessionStateForError,
} from '@/lib/session';

/** The verified identity, or `null`. Never trusts the cookie alone. */
export async function readIdentity(): Promise<SessionIdentity | null> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const user = await fetchMe(token);
    return { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole };
  } catch {
    // Any failure — 401, 403, 5xx, network — means we cannot assert an
    // authenticated identity right now. Never guess.
    return null;
  }
}

/**
 * Full session state, including the distinction between "not signed in" and
 * "could not determine".
 */
export async function readSession(): Promise<SessionState> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  if (!token) return { status: 'unauthenticated', user: null, errorKind: null };
  try {
    const user = await fetchMe(token);
    return {
      status: 'authenticated',
      user: { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole },
      errorKind: null,
    };
  } catch (error) {
    if (error instanceof ApiError) return sessionStateForError(error);
    return { status: 'error', user: null, errorKind: 'unknown' };
  }
}

/** The access token for server-to-server calls. Never leaves the server. */
export function readAccessToken(): string | null {
  return cookies().get(ACCESS_COOKIE)?.value ?? null;
}

/** The stored senior preference. A hint only — never an authorization source. */
export function readSeniorPreference(): string | null {
  return cookies().get(SENIOR_COOKIE)?.value ?? null;
}