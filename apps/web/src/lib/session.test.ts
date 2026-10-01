/**
 * Phase 50 — error taxonomy and session decision behaviour.
 *
 * The Phase 48 assessment found a product where authorization failures were
 * indistinguishable from empty data. These tests pin the requirement that
 * 401, 403, 404, 429, 5xx and transport failure all stay DISTINGUISHABLE.
 */
import { describe, expect, it } from 'vitest';

import {
  ApiError,
  apiErrorFromResponse,
  defaultMessageForKind,
  isApiError,
  kindForStatus,
  networkError,
} from './api-error';
import {
  isUsableAccessTokenShape,
  mergeBackendSetCookie,
  parseCookieHeader,
  sessionStateForError,
  shouldRedirectToLogin,
  isAuthenticatedStatus,
  type SessionState,
} from './session';

describe('HTTP status classification', () => {
  it('maps 401 to unauthenticated', () => {
    expect(kindForStatus(401)).toBe('unauthenticated');
  });

  it('maps 403 to forbidden and keeps it distinct from 401', () => {
    expect(kindForStatus(403)).toBe('forbidden');
    expect(kindForStatus(403)).not.toBe(kindForStatus(401));
  });

  it('maps 404, 400, 429 and 5xx to their own kinds', () => {
    expect(kindForStatus(404)).toBe('not_found');
    expect(kindForStatus(400)).toBe('validation');
    expect(kindForStatus(422)).toBe('validation');
    expect(kindForStatus(429)).toBe('rate_limited');
    expect(kindForStatus(500)).toBe('server');
    expect(kindForStatus(503)).toBe('server');
  });
});

describe('apiErrorFromResponse', () => {
  it('reads the API error envelope', () => {
    const error = apiErrorFromResponse(403, {
      error: { code: 'FORBIDDEN', message: 'Access denied', requestId: 'req-1' },
    });
    expect(error.kind).toBe('forbidden');
    expect(error.code).toBe('FORBIDDEN');
    expect(error.requestId).toBe('req-1');
    expect(error.message).toBe('Access denied');
  });

  it('produces a typed error even for an undocumented body', () => {
    const error = apiErrorFromResponse(500, '<html>gateway</html>');
    expect(error.kind).toBe('server');
    expect(error.status).toBe(500);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('never converts a failure into a success-shaped value', () => {
    for (const status of [401, 403, 404, 429, 500]) {
      const error = apiErrorFromResponse(status, undefined);
      expect(isApiError(error)).toBe(true);
      expect(error.status).toBe(status);
    }
  });

  it('exposes isUnauthenticated / isForbidden / isTransient consistently', () => {
    expect(apiErrorFromResponse(401, undefined).isUnauthenticated).toBe(true);
    expect(apiErrorFromResponse(403, undefined).isForbidden).toBe(true);
    expect(apiErrorFromResponse(401, undefined).isForbidden).toBe(false);
    expect(apiErrorFromResponse(500, undefined).isTransient).toBe(true);
    expect(networkError(new Error('ECONNREFUSED')).isTransient).toBe(true);
  });

  it('a network failure is a network error, not a server error', () => {
    const error = networkError(new Error('ECONNREFUSED'));
    expect(error.kind).toBe('network');
    // Must not disclose the internal API URL.
    expect(error.message).not.toContain('http');
  });
});

describe('renderable messages', () => {
  it('distinguishes 401 from 403 in user-facing wording', () => {
    const unauth = defaultMessageForKind('unauthenticated');
    const forbidden = defaultMessageForKind('forbidden');
    expect(unauth).not.toBe(forbidden);
    expect(unauth.toLowerCase()).toContain('not signed in');
    expect(forbidden.toLowerCase()).toContain('permission');
  });
});

describe('cookie handling', () => {
  it('extracts the API refresh cookie from Set-Cookie', () => {
    const header = 'refresh=abc.def.ghi; Path=/api/v1/auth/refresh; HttpOnly; SameSite=Strict';
    expect(mergeBackendSetCookie(header, 'refresh')).toBe('abc.def.ghi');
  });

  it('returns null when the cookie is absent', () => {
    expect(mergeBackendSetCookie(null, 'refresh')).toBeNull();
    expect(mergeBackendSetCookie('other=1; Path=/', 'refresh')).toBeNull();
  });

  it('reads a named cookie from a Cookie request header', () => {
    expect(parseCookieHeader('ecc_at=token123; ecc_rt=refresh456', 'ecc_at')).toBe('token123');
    expect(parseCookieHeader('ecc_at=token123', 'ecc_rt')).toBeNull();
    expect(parseCookieHeader(undefined, 'ecc_at')).toBeNull();
  });

  it('tolerates a malformed cookie header without throwing', () => {
    expect(() => parseCookieHeader(';;;=;;', 'ecc_at')).not.toThrow();
  });
});

describe('access token shape', () => {
  it('accepts a JWT-shaped value and rejects empties', () => {
    expect(isUsableAccessTokenShape('a.b.c')).toBe(true);
    expect(isUsableAccessTokenShape('')).toBe(false);
    expect(isUsableAccessTokenShape(null)).toBe(false);
    expect(isUsableAccessTokenShape(undefined)).toBe(false);
    expect(isUsableAccessTokenShape('not-a-jwt')).toBe(false);
  });
});

describe('session decision logic', () => {
  const authenticated: SessionState = {
    status: 'authenticated',
    user: { id: 'u1', email: 'a@example.com', fullName: 'A', globalRole: 'USER' },
    errorKind: null,
  };

  it('a verified session counts as authenticated', () => {
    expect(isAuthenticatedStatus(authenticated)).toBe(true);
    expect(shouldRedirectToLogin(authenticated)).toBe(false);
  });

  it('an anonymous visitor is redirected to login', () => {
    const anon: SessionState = { status: 'unauthenticated', user: null, errorKind: null };
    expect(isAuthenticatedStatus(anon)).toBe(false);
    expect(shouldRedirectToLogin(anon)).toBe(true);
  });

  it('an expired session is redirected to login, NOT treated as authenticated', () => {
    const expired: SessionState = { status: 'expired', user: null, errorKind: 'unauthenticated' };
    expect(isAuthenticatedStatus(expired)).toBe(false);
    expect(shouldRedirectToLogin(expired)).toBe(true);
  });

  it('a backend outage is an ERROR state and is NOT redirected to login', () => {
    // A 5xx must not masquerade as "please sign in again".
    const outage = sessionStateForError(apiErrorFromResponse(503, undefined));
    expect(outage.status).toBe('error');
    expect(shouldRedirectToLogin(outage)).toBe(false);
    expect(isAuthenticatedStatus(outage)).toBe(false);
  });

  it('a 401 from the API becomes an expired session', () => {
    const expired = sessionStateForError(apiErrorFromResponse(401, undefined));
    expect(expired.status).toBe('expired');
    expect(shouldRedirectToLogin(expired)).toBe(true);
  });

  it('a 403 on /auth/me is an error, not a fabricated session', () => {
    const forbidden = sessionStateForError(apiErrorFromResponse(403, undefined));
    expect(forbidden.status).toBe('error');
    expect(forbidden.user).toBeNull();
  });
});