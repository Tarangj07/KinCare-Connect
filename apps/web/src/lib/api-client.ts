/**
 * Phase 50 — server-side API client.
 *
 * IMPORTANT: this module is SERVER-ONLY by construction. It is imported only
 * by Next.js Route Handlers and Server Components, never by a `'use client'`
 * module, so the access token and the backend's internal address never enter
 * the browser bundle.
 *
 * The browser cannot call the API directly in any case: the NestJS API does
 * not enable CORS, so a cross-origin `fetch` from the web origin would be
 * rejected before any application code ran. The BFF exists because of that,
 * not to work around a broken backend.
 */
import {
  ApiError,
  apiErrorFromResponse,
  defaultMessageForKind,
  networkError,
} from './api-error';
import type {
  ApiAccessibleSenior,
  ApiAppointment,
  ApiCircleMember,
  ApiLoginResponse,
  ApiMedication,
  ApiUser,
} from './types';

/**
 * Server-side base URL for the API. Falls back to the public build-time value
 * so local development works without extra configuration.
 */
export function apiBaseUrl(): string {
  const configured = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL;
  return (configured ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/** Absolute API URL for a path beginning with `/api/v1`. */
export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Bearer access token issued by the API. Held server-side only. */
  accessToken?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Return the raw body instead of parsing JSON (used for Set-Cookie reads). */
  expect?: 'json' | 'raw';
}

export interface ApiResponse<T> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

const SAFE_METHOD_BODY = new Set(['POST', 'DELETE']);

/**
 * Perform one API call.
 *
 * Throws `ApiError` for every non-2xx status and for transport failure. It
 * never returns a successful-looking value in place of an error, so a caller
 * cannot accidentally render "no data" when the truth was "you are not
 * allowed to see this".
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined && SAFE_METHOD_BODY.has(method)) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      cache: 'no-store',
      ...(options.body !== undefined && SAFE_METHOD_BODY.has(method)
        ? { body: JSON.stringify(options.body) }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    // Transport failure: honest, typed, and never silently successful.
    throw networkError(cause);
  }

  const raw = await response.text();
  let parsed: unknown;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    throw apiErrorFromResponse(response.status, parsed);
  }

  return {
    status: response.status,
    ok: true,
    data: (options.expect === 'raw' ? raw : parsed) as T,
    headers: response.headers,
  };
}

/** GET returning parsed JSON. */
export async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await apiFetch<T>(path, { accessToken });
  return response.data;
}

/**
 * POST returning parsed JSON, preserving failure semantics.
 *
 * Used for login, where a failure MUST surface as a failure.
 */
export async function apiPost<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  const response = await apiFetch<T>(path, { method: 'POST', body, accessToken });
  return response.data;
}

/** Raw access to the response, needed when the backend sets cookies. */
export async function apiFetchRaw(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<string>> {
  const response = await apiFetch<string>(path, { ...options, expect: 'raw' });
  return response;
}

// ---------------------------------------------------------------------------
// Typed endpoints. Each one mirrors an EXISTING backend route.
// ---------------------------------------------------------------------------

/** `POST /api/v1/auth/login` */
export function login(email: string, password: string): Promise<ApiResponse<ApiLoginResponse>> {
  return apiFetch<ApiLoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

/** `GET /api/v1/auth/me` — the existing identity contract. */
export function fetchMe(accessToken: string): Promise<ApiUser> {
  return apiGet<ApiUser>('/api/v1/auth/me', accessToken);
}

/**
 * `GET /api/v1/me/seniors` — the ONLY authoritative source of which seniors
 * the caller may act on (Phase 49).
 */
export function fetchAccessibleSeniors(accessToken: string): Promise<ApiAccessibleSenior[]> {
  return apiGet<ApiAccessibleSenior[]>('/api/v1/me/seniors', accessToken);
}

/** `POST /api/v1/seniors` — onboarding a senior. */
export function createSenior(
  accessToken: string,
  payload: { fullName: string; preferredName?: string; dateOfBirth?: string },
): Promise<ApiAccessibleSenior> {
  return apiPost<ApiAccessibleSenior>('/api/v1/seniors', payload, accessToken);
}

/** `GET /api/v1/seniors/:id/medications` */
export function fetchMedications(seniorId: string, accessToken: string): Promise<ApiMedication[]> {
  return apiGet<ApiMedication[]>(`/api/v1/seniors/${seniorId}/medications`, accessToken);
}

/** `GET /api/v1/seniors/:id/appointments` */
export function fetchAppointments(seniorId: string, accessToken: string): Promise<ApiAppointment[]> {
  return apiGet<ApiAppointment[]>(`/api/v1/seniors/${seniorId}/appointments`, accessToken);
}

/** `GET /api/v1/care-circles/:id/members` */
export function fetchCircleMembers(circleId: string, accessToken: string): Promise<ApiCircleMember[]> {
  return apiGet<ApiCircleMember[]>(`/api/v1/care-circles/${circleId}/members`, accessToken);
}

/** `POST /api/v1/auth/logout` — revokes the caller's refresh token server-side. */
export function logout(accessToken: string, refreshToken?: string): Promise<ApiResponse<unknown>> {
  return apiFetch<unknown>('/api/v1/auth/logout', {
    method: 'POST',
    ...(refreshToken ? { body: { refreshToken } } : {}),
    accessToken,
  });
}

/** Normalise any thrown value into a renderable, non-leaking message. */
export function toSafeMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return defaultMessageForKind('unknown');
}