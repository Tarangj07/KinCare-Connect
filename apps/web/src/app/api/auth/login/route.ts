/**
 * Phase 50 — BFF: login.
 *
 * POST /api/auth/login  (browser -> Next.js, same origin)
 *   -> POST /api/v1/auth/login  (Next.js -> API, server-to-server)
 *
 * The access token in the API's login response body is NOT returned to the
 * browser. It is re-emitted as an HTTP-only cookie that client JavaScript
 * cannot read. The API's own `refresh` cookie is captured server-side and
 * re-emitted under our own name for later silent renewal.
 *
 * Failure semantics are preserved end to end: a rejected login answers 401
 * and sets NO cookies.
 */
import { NextResponse } from 'next/server';

import { ApiError, apiErrorFromResponse, networkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-client';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE_OPTIONS,
  mergeBackendSetCookie,
} from '@/lib/session';
import type { ApiLoginResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Email and password are required.' },
      { status: 400 },
    );
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (email.length === 0 || password.length === 0) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Email and password are required.' },
      { status: 400 },
    );
  }

  let apiResponse: Response;
  try {
    apiResponse = await fetch(apiUrl('/api/v1/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch (cause) {
    const error = networkError(cause);
    return NextResponse.json({ error: error.kind, message: error.message }, { status: 502 });
  }

  const raw = await apiResponse.text();
  let parsed: unknown;
  try {
    parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!apiResponse.ok) {
    // Preserve the backend's status (401 on bad credentials, 429 when rate
    // limited) and its error envelope. Never converted into success.
    const error: ApiError = apiErrorFromResponse(apiResponse.status, parsed);
    return NextResponse.json(
      { error: error.kind, message: error.message, status: error.status },
      { status: apiResponse.status },
    );
  }

  const login = parsed as ApiLoginResponse | undefined;
  if (!login || typeof login.access !== 'string' || login.access.length === 0) {
    // The backend did not return a usable token. Do not invent a session.
    return NextResponse.json(
      { error: 'server', message: 'The service did not return a usable session.' },
      { status: 502 },
    );
  }

  const refreshToken = mergeBackendSetCookie(
    apiResponse.headers.get('set-cookie'),
    'refresh',
  );

  const response = NextResponse.json({
    user: {
      id: login.user.id,
      email: login.user.email,
      fullName: login.user.fullName,
      globalRole: login.user.globalRole,
    },
  });

  // HTTP-only: the browser stores it but client JavaScript cannot read it.
  response.cookies.set(ACCESS_COOKIE, login.access, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 60 * 15,
  });
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}