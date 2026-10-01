/**
 * Phase 50 — session handling.
 *
 * PURE-LOGIC PARTS FIRST. `cookieNames`, `isAuthenticatedStatus`,
 * `shouldRefresh`, `mergeBackendSetCookie` and `parseRefreshCookie` have no
 * Next.js import and are unit-tested directly in Node. Only `readSession`
 * touches `next/headers`.
 *
 * Why cookies, and why HTTP-only:
 *
 * The API issues a Bearer access token in the LOGIN RESPONSE BODY and
 * separately sets an HTTP-only `refresh` cookie scoped to
 * `/api/v1/auth/refresh` (see `auth.controller.ts`). Because the web origin
 * differs from the API origin, the browser will not send that refresh cookie
 * to us, and in any case the access token must never be readable by client
 * JavaScript.
 *
 * So the BFF takes the token out of the login response body, keeps it
 * server-side, and re-emits it to the browser as an HTTP-only cookie that
 * client JavaScript cannot read. The browser never sees, stores or sends the
 * token; it only ever receives `Set-Cookie`.
 *
 * A cookie's PRESENCE is never treated as proof of authentication. The stored
 * access token is always verified against `GET /auth/me` before the
 * application treats the session as authenticated.
 */
import type { ApiError, ApiErrorKind } from './api-error';

/** Cookie the BFF sets for the access token. HTTP-only; unreadable by JS. */
export const ACCESS_COOKIE = 'ecc_at';
/** Cookie the BFF sets for the API's refresh token. HTTP-only. */
export const REFRESH_COOKIE = 'ecc_rt';
/** Cookie remembering the selected senior. Deliberately READABLE by the client. */
export const SENIOR_COOKIE = 'ecc_senior';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;

/**
 * The senior-preference cookie is intentionally NOT httpOnly: it is a UI
 * preference that client code reads. It holds a senior id ONLY as a
 * preference hint; `resolveActiveSenior` validates it against the backend
 * response before use, and the backend re-authorizes every request.
 */
export const SENIOR_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30,
} as const;

export type SessionStatus =
  | 'authenticated'
  | 'unauthenticated'
  | 'expired'
  | 'error';

export interface SessionIdentity {
  id: string;
  email: string;
  fullName: string;
  globalRole: string;
}

export interface SessionState {
  status: SessionStatus;
  user: SessionIdentity | null;
  /** Present only when the failure is not an auth decision (5xx/network). */
  errorKind: ApiErrorKind | null;
}

/**
 * Decide whether an access token can be trusted WITHOUT a verification call.
 *
 * Used only to avoid pointless network round trips. A positive result means
 * "worth verifying", never "verified".
 */
export function isUsableAccessTokenShape(token: string | undefined | null): boolean {
  return typeof token === 'string' && token.length > 0 && token.split('.').length === 3;
}

/** True only for a definite authentication decision. */
export function isAuthenticatedStatus(state: SessionState): boolean {
  return state.status === 'authenticated' && state.user !== null;
}

/**
 * Whether the session state should send the browser to the login page.
 *
 * An `error` state is deliberately NOT treated as unauthenticated: a backend
 * outage must not silently downgrade to "please log in", which would mask an
 * infrastructure problem as an auth problem.
 */
export function shouldRedirectToLogin(state: SessionState): boolean {
  return state.status === 'unauthenticated' || state.status === 'expired';
}

/** Extract a refresh token value from the API's `Set-Cookie` header. */
export function mergeBackendSetCookie(headerValue: string | null, name: string): string | null {
  if (!headerValue) return null;
  for (const part of headerValue.split(/,(?=[^;]+=)/)) {
    const [pair = ''] = part.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return null;
}

/** Read one cookie out of a raw `Cookie` request header. */
export function parseCookieHeader(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Map a backend failure onto the session state it implies. */
export function sessionStateForError(error: ApiError): SessionState {
  if (error.isUnauthenticated) {
    return { status: 'expired', user: null, errorKind: error.kind };
  }
  // A 403 on /auth/me would mean an authenticated-but-forbidden identity,
  // which the login contract does not allow. Treat as an error, not a session.
  return { status: 'error', user: null, errorKind: error.kind };
}