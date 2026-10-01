/**
 * Phase 50 — API client behaviour against a stubbed transport.
 *
 * Uses the real `fetch` seam via dependency injection so the tests exercise
 * the actual request-building, status handling and error mapping code rather
 * than a re-implementation of it.
 */
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './api-error';
import { apiBaseUrl, apiFetch, apiGet, apiPost, apiUrl } from './api-client';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('API base URL', () => {
  it('builds an absolute URL for an API path', () => {
    expect(apiUrl('/api/v1/me/seniors').startsWith('http')).toBe(true);
    expect(apiUrl('/api/v1/me/seniors')).toContain('/api/v1/me/seniors');
  });

  it('tolerates a path with or without a leading slash', () => {
    expect(apiUrl('api/v1/auth/me')).toBe(apiUrl('/api/v1/auth/me'));
  });

  it('strips trailing slashes from the configured base', () => {
    const original = process.env.API_INTERNAL_URL;
    process.env.API_INTERNAL_URL = 'http://example.test:3000/';
    expect(apiBaseUrl()).toBe('http://example.test:3000');
    if (original === undefined) delete process.env.API_INTERNAL_URL;
    else process.env.API_INTERNAL_URL = original;
  });
});

describe('apiFetch — authentication header', () => {
  it('attaches the Bearer token when one is supplied', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', spy);

    await apiFetch('/api/v1/auth/me', { accessToken: 'tok-123' });

    const init = spy.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    vi.unstubAllGlobals();
  });

  it('omits the Authorization header when no token is supplied', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', spy);

    await apiFetch('/api/v1/health');

    const init = spy.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('apiFetch — failure semantics are preserved', () => {
  it('401 throws an unauthenticated ApiError', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'no' } }));
    await expect(apiGet('/api/v1/me/seniors', 'tok')).rejects.toMatchObject({
      kind: 'unauthenticated',
      status: 401,
    });
    vi.unstubAllGlobals();
  });

  it('403 throws a forbidden ApiError and is NOT returned as an empty list', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(403, { error: { message: 'denied' } }));
    let result: unknown = 'untouched';
    try {
      result = await apiGet('/api/v1/seniors/abc/medications', 'tok');
    } catch (error) {
      result = error;
    }
    expect(result).toBeInstanceOf(ApiError);
    expect((result as ApiError).kind).toBe('forbidden');
    expect(Array.isArray(result)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('500 throws a server ApiError', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(500, { error: { message: 'boom' } }));
    await expect(apiGet('/api/v1/me/seniors', 'tok')).rejects.toMatchObject({ kind: 'server' });
    vi.unstubAllGlobals();
  });

  it('a transport failure becomes a network ApiError, never a fake success', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(apiGet('/api/v1/me/seniors', 'tok')).rejects.toMatchObject({ kind: 'network' });
    vi.unstubAllGlobals();
  });

  it('an empty seniors array is a genuine success, not an error', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(200, []));
    const result = await apiGet<unknown[]>('/api/v1/me/seniors', 'tok');
    expect(result).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('apiPost — login', () => {
  it('sends the credentials as JSON and returns the response', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(201, { user: { id: 'u1', email: 'a@b.c', fullName: 'A', globalRole: 'USER' }, access: 'jwt' }),
    );
    vi.stubGlobal('fetch', spy);

    const result = await apiPost<{ access: string }>('/api/v1/auth/login', {
      email: 'a@b.c',
      password: 'Secret123',
    });

    const init = spy.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', password: 'Secret123' });
    expect(result.access).toBe('jwt');
    vi.unstubAllGlobals();
  });

  it('a rejected login THROWS rather than returning a falsy success', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(401, { error: { message: 'Invalid credentials' } }));
    await expect(apiPost('/api/v1/auth/login', { email: 'a@b.c', password: 'wrong' })).rejects.toMatchObject({
      kind: 'unauthenticated',
      status: 401,
    });
    vi.unstubAllGlobals();
  });
});

describe('request method safety', () => {
  it('does not attach a body to GET requests', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, []));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/v1/me/seniors', { accessToken: 'tok' });
    const init = spy.mock.calls[0]![1]!;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('never caches API responses', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, []));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/api/v1/me/seniors', { accessToken: 'tok' });
    const init = spy.mock.calls[0]![1]!;
    expect(init.cache).toBe('no-store');
    vi.unstubAllGlobals();
  });
});
