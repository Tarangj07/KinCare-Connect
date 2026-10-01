/**
 * Phase 50 — BFF: accessible seniors.
 *
 * GET /api/me/seniors -> GET /api/v1/me/seniors
 *
 * This is the ONLY source from which the web client may derive an active
 * senior. There is no generic `?url=` proxy here: the upstream path is fixed
 * in code, so a caller cannot use this route to reach an arbitrary API URL or
 * an arbitrary senior id.
 *
 * Status semantics are preserved exactly, because the UI depends on telling
 * "you have no seniors" (200 + []) apart from "you are not allowed" (403).
 */
import { NextResponse } from 'next/server';

import { ApiError, apiErrorFromResponse, networkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-client';
import type { ApiAccessibleSenior } from '@/lib/types';
import { readAccessToken } from '@/app/api/_session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const accessToken = readAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'unauthenticated', message: 'Sign in required.' }, { status: 401 });
  }

  let response: Response;
  try {
    response = await fetch(apiUrl('/api/v1/me/seniors'), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (cause) {
    const error = networkError(cause);
    return NextResponse.json({ error: error.kind, message: error.message }, { status: 502 });
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
    return NextResponse.json(
      { error: error.kind, message: error.message },
      { status: response.status },
    );
  }

  // An empty array is a genuine, successful "no accessible seniors".
  const seniors = Array.isArray(parsed) ? (parsed as ApiAccessibleSenior[]) : [];
  return NextResponse.json({ seniors }, { status: 200 });
}