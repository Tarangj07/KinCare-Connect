/**
 * Phase 50 — BFF: persist the active-senior preference.
 *
 * POST /api/me/senior  { seniorId }
 *
 * This route performs a write to a cookie, which a Server Component cannot do
 * in Next 14 (`cookies().set()` throws outside Route Handlers / Server
 * Actions — this was observed as an HTTP 500 during runtime verification).
 *
 * It deliberately does NOT validate that the caller may access the senior.
 * Validation is not this route's job and cannot be its job: it stores a UI
 * preference only. `resolveActiveSenior` re-validates the stored value
 * against the backend's `GET /me/seniors` response on every read, and the
 * backend independently re-authorizes every senior-scoped request. A forged
 * value here changes nothing the user can reach.
 */
import { NextResponse } from 'next/server';

import { SENIOR_COOKIE, SENIOR_COOKIE_OPTIONS } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  let body: { seniorId?: unknown };
  try {
    body = (await request.json()) as { seniorId?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_request', message: 'A senior id is required.' }, { status: 400 });
  }

  const seniorId = typeof body.seniorId === 'string' ? body.seniorId : '';
  if (seniorId.length === 0) {
    return NextResponse.json({ error: 'invalid_request', message: 'A senior id is required.' }, { status: 400 });
  }

  const response = NextResponse.json({ stored: true });
  response.cookies.set(SENIOR_COOKIE, seniorId, SENIOR_COOKIE_OPTIONS);
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ cleared: true });
  response.cookies.set(SENIOR_COOKIE, '', { ...SENIOR_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}