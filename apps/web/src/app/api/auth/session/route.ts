/**
 * Phase 50 — BFF: current session.
 *
 * GET /api/auth/session -> GET /api/v1/auth/me
 *
 * Returns the EXISTING identity contract, unchanged and un-augmented: no
 * seniorId is added here. Senior discovery is a separate call to
 * /api/me/seniors.
 *
 * The access token is never included in the response body.
 */
import { NextResponse } from 'next/server';

import { ApiError, apiErrorFromResponse, networkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-client';
import type { ApiUser } from '@/lib/types';
import { readAccessToken } from '@/app/api/_session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const accessToken = readAccessToken();
  if (!accessToken) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
  }

  let response: Response;
  try {
    response = await fetch(apiUrl('/api/v1/auth/me'), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (cause) {
    const error = networkError(cause);
    return NextResponse.json({ authenticated: false, user: null, error: error.kind }, { status: 502 });
  }

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const error: ApiError = apiErrorFromResponse(response.status, parsed);
    // Preserve the status: 401 stays 401. An expired session is not success.
    return NextResponse.json({ authenticated: false, user: null, error: error.kind }, { status: response.status });
  }

  const user = parsed as ApiUser;
  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      globalRole: user.globalRole,
    },
  });
}