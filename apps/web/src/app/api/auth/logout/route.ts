/**
 * Phase 50 — BFF: logout.
 *
 * Revokes the caller's refresh token server-side using the API's existing
 * logout contract (`POST /api/v1/auth/logout`), then clears every cookie the
 * BFF owns. Client JavaScript is not required to do anything: the session is
 * gone once the response lands, so protected pages stop working immediately.
 *
 * The API's logout is idempotent from the client's perspective — an already
 * invalid token is not an error the user needs to see — but the LOCAL session
 * is always cleared, whatever the API answers.
 */
import { NextResponse } from 'next/server';

import { apiFetchRaw } from '@/lib/api-client';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SENIOR_COOKIE,
  SENIOR_COOKIE_OPTIONS,
  SESSION_COOKIE_OPTIONS,
} from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }

  const accessToken = cookies.get(ACCESS_COOKIE);
  const refreshToken = cookies.get(REFRESH_COOKIE);

  // Best-effort server-side revocation. A failure here must not prevent the
  // local session from being destroyed.
  if (accessToken || refreshToken) {
    try {
      await apiFetchRaw('/api/v1/auth/logout', {
        method: 'POST',
        ...(accessToken ? { accessToken } : {}),
        ...(refreshToken ? { body: { refreshToken: decodeURIComponent(refreshToken) } } : {}),
      });
    } catch {
      // Intentionally swallowed: the cookies below are cleared regardless, so
      // the user is logged out locally even if revocation failed.
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set(SENIOR_COOKIE, '', { ...SENIOR_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}