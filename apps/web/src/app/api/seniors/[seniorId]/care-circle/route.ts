/**
 * Phase 50 — BFF: care-circle roster for the active senior.
 *
 * GET /api/seniors/:seniorId/care-circle -> GET /api/v1/care-circles/:circleId/members
 *
 * The circle id is taken from the ROUTE and forwarded to a fixed upstream
 * path; the backend authorizes it. A caller cannot point this at an arbitrary
 * senior or circle.
 */
import { NextResponse } from 'next/server';

import { ApiError, apiErrorFromResponse, networkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-client';
import { looksLikeUuid } from '@/lib/seniors';
import type { ApiCircleMember } from '@/lib/types';
import { readAccessToken } from '@/app/api/_session';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { seniorId: string } },
): Promise<NextResponse> {
  if (!looksLikeUuid(params.seniorId)) {
    return NextResponse.json(
      { error: 'validation', message: 'That senior reference is not valid.' },
      { status: 400 },
    );
  }

  const accessToken = readAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'unauthenticated', message: 'Sign in required.' }, { status: 401 });
  }

  // First resolve one of the caller's AUTHORIZED circles for this senior.
  // The senior id is validated against /me/seniors by the backend itself.
  let seniorsResponse: Response;
  try {
    seniorsResponse = await fetch(apiUrl('/api/v1/me/seniors'), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (cause) {
    const error = networkError(cause);
    return NextResponse.json({ error: error.kind, message: error.message }, { status: 502 });
  }

  if (!seniorsResponse.ok) {
    const raw = await seniorsResponse.text();
    let parsed: unknown;
    try {
      parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
    } catch {
      parsed = undefined;
    }
    const error: ApiError = apiErrorFromResponse(seniorsResponse.status, parsed);
    return NextResponse.json({ error: error.kind, message: error.message }, { status: seniorsResponse.status });
  }

  const seniorsRaw = await seniorsResponse.text();
  let seniors: Array<{ senior: { id: string }; circles: Array<{ circleId: string; circleName: string; role: string }> }>;
  try {
    seniors = seniorsRaw.length > 0 ? (JSON.parse(seniorsRaw) as typeof seniors) : [];
  } catch {
    seniors = [];
  }

  const entry = seniors.find((s) => s.senior.id === params.seniorId);
  if (!entry || entry.circles.length === 0) {
    // Not an authorized senior for this caller: report as forbidden rather
    // than inventing an empty roster.
    return NextResponse.json(
      { error: 'forbidden', message: 'You do not have access to that senior.' },
      { status: 403 },
    );
  }

  const circleId = entry.circles[0]!.circleId;
  let membersResponse: Response;
  try {
    membersResponse = await fetch(apiUrl(`/api/v1/care-circles/${circleId}/members`), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch (cause) {
    const error = networkError(cause);
    return NextResponse.json({ error: error.kind, message: error.message }, { status: 502 });
  }

  const membersRaw = await membersResponse.text();
  let membersParsed: unknown;
  try {
    membersParsed = membersRaw.length > 0 ? (JSON.parse(membersRaw) as unknown) : undefined;
  } catch {
    membersParsed = undefined;
  }

  if (!membersResponse.ok) {
    const error: ApiError = apiErrorFromResponse(membersResponse.status, membersParsed);
    return NextResponse.json({ error: error.kind, message: error.message }, { status: membersResponse.status });
  }

  const body = membersParsed as { members?: ApiCircleMember[] } | undefined;
  return NextResponse.json(
    {
      circle: { id: circleId, name: entry.circles[0]!.circleName },
      members: Array.isArray(body?.members) ? body.members : [],
    },
    { status: 200 },
  );
}
