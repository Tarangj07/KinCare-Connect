/**
 * Phase 50 — BFF: senior-scoped reads for the application shell.
 *
 * GET /api/seniors/:seniorId/medications
 * GET /api/seniors/:seniorId/appointments
 *
 * The senior id comes from the ROUTE, is shape-checked as a UUID, and is then
 * forwarded to a FIXED upstream path. The backend re-authorizes it against the
 * caller's care-circle membership on every request, so a caller cannot use
 * this route to read a senior they are not authorized for — a 403 from the API
 * is surfaced as 403, not as an empty list.
 */
import { NextResponse } from 'next/server';

import { ApiError, apiErrorFromResponse, networkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-client';
import { looksLikeUuid } from '@/lib/seniors';
import type { ApiAppointment, ApiMedication } from '@/lib/types';
import { readAccessToken } from '@/app/api/_session';

export const dynamic = 'force-dynamic';

interface SeniorParams {
  params: { seniorId: string };
}

async function proxySeniorResource<T>(
  seniorId: string,
  resource: 'medications' | 'appointments',
): Promise<NextResponse> {
  if (!looksLikeUuid(seniorId)) {
    return NextResponse.json(
      { error: 'validation', message: 'That senior reference is not valid.' },
      { status: 400 },
    );
  }

  const accessToken = readAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'unauthenticated', message: 'Sign in required.' }, { status: 401 });
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/v1/seniors/${seniorId}/${resource}`), {
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

  const items = Array.isArray(parsed) ? (parsed as T[]) : [];
  return NextResponse.json({ items }, { status: 200 });
}

export async function GET(_request: Request, { params }: SeniorParams): Promise<NextResponse> {
  return proxySeniorResource<ApiMedication>(params.seniorId, 'medications');
}