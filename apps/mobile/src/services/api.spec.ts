import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStore = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  setItemAsync: async (key: string, value: string) => { mockStore.set(key, value); },
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));

vi.mock('../lib/api-base', () => ({
  API_BASE_URL: 'http://localhost:3000',
}));

describe('API Client Security', () => {
  beforeEach(async () => {
    mockStore.clear();
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('access token is retrieved from SecureStore/session layer', async () => {
    const { getAccessToken } = await import('./session');
    await getAccessToken(); // verifies it reads from mocked store without error
  });

  it('authenticated requests receive the Authorization header', async () => {
    const { apiFetch } = await import('./api');
    await import('./session').then(async (s) => {
      await s.storeAccessToken('token_123');
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    } as Response);

    await apiFetch('/test');
    const fetchCall = (global.fetch as vi.Mock).mock.results[0]?.value as Promise<Response>;
    // We verify fetch was called with Authorization header by inspecting arguments
    const lastCall = (global.fetch as vi.Mock).mock.calls.pop();
    const init = lastCall?.[1] as RequestInit | undefined;
    expect(init?.headers).toBeDefined();
    const headersObj = init?.headers as Record<string, string> | Headers;
    const authHeader = headersObj instanceof Headers ? headersObj.get('Authorization') : (headersObj as Record<string, string>)['Authorization'];
    expect(authHeader).toBe('Bearer token_123');
  });

  it('request without token does not send a Bearer token', async () => {
    const { apiFetch } = await import('./api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    } as Response);

    await apiFetch('/test');
    const lastCall = (global.fetch as vi.Mock).mock.calls.pop();
    const init = lastCall?.[1] as RequestInit | undefined;
    const headersObj = init?.headers as Record<string, string> | Headers;
    const authHeader = headersObj instanceof Headers ? headersObj.get('Authorization') : (headersObj as Record<string, string>)['Authorization'];
    expect(authHeader).toBeUndefined();
  });

  it('HTTP 401 causes expected session/token cleanup', async () => {
    const { apiFetch, ApiError } = await import('./api');
    const { deleteAccessToken } = await import('./session');
    await import('./session').then(async (s) => {
      await s.storeAccessToken('token_401');
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({}),
      text: async () => 'Unauthorized',
    } as Response);

    await expect(apiFetch('/protected')).rejects.toThrow();
    expect(mockStore.get('ecc_access_token')).toBeUndefined();
  });

  it('HTTP 403 causes expected session/token cleanup', async () => {
    const { apiFetch } = await import('./api');
    await import('./session').then(async (s) => {
      await s.storeAccessToken('token_403');
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({}),
      text: async () => 'Forbidden',
    } as Response);

    await expect(apiFetch('/protected')).rejects.toThrow();
    expect(mockStore.get('ecc_access_token')).toBeUndefined();
  });

  it('safe ApiError behavior is preserved', async () => {
    const { apiFetch, ApiError } = await import('./api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({}),
      text: async () => 'Internal database failure',
    } as Response);

    try {
      await apiFetch('/fail');
      expect.fail('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(500);
      expect(err.message).toBe('Request failed (500)');
      expect(err.message).not.toContain('database');
      expect(err.message).not.toContain('Prisma');
    }
  });

  it('raw backend response bodies are not exposed as user-facing errors', async () => {
    const { apiFetch } = await import('./api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({}),
      text: async () => 'Prisma error: database connection failed at /internal/path/sql/query',
    } as Response);

    try {
      await apiFetch('/data');
      expect.fail('Should have thrown');
    } catch (e: unknown) {
      const message = (e as Error).message;
      expect(message).not.toContain('Prisma');
      expect(message).not.toContain('/internal/path');
      expect(message).toBe('Request failed (500)');
    }
  });
});
