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

describe('Auth Service', () => {
  beforeEach(async () => {
    mockStore.clear();
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('successful login stores the returned access token', async () => {
    const { loginUser } = await import('./auth');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: '1', email: 'test@test.com', fullName: 'Test', globalRole: 'USER' }, access: 'token_abc' }),
    } as Response);

    const result = await loginUser({ email: 'test@test.com', password: 'pass' });
    expect(result.access).toBe('token_abc');
    expect(mockStore.get('ecc_access_token')).toBe('token_abc');
  });

  it('successful login stores the user profile', async () => {
    const { loginUser } = await import('./auth');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: '2', email: 'a@b.com', fullName: 'Alice', globalRole: 'FAMILY_ADMIN' }, access: 't1' }),
    } as Response);

    const result = await loginUser({ email: 'a@b.com', password: 'pass' });
    expect(result.user.id).toBe('2');
    expect(mockStore.get('ecc_user')).toContain('Alice');
  });

  it('failed login does NOT create an authenticated session', async () => {
    const { loginUser } = await import('./auth');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Prisma error: database connection failed at /internal/path...',
    } as Response);

    await expect(loginUser({ email: 'bad', password: 'bad' })).rejects.toThrow('Login failed');
    expect(mockStore.get('ecc_access_token')).toBeUndefined();
    expect(mockStore.get('ecc_user')).toBeUndefined();
  });

  it('login response handling does not expose raw server error text', async () => {
    const { loginUser, LOGIN_ERROR_MESSAGE } = await import('./auth');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error: SQL timeout at /db/query',
    } as Response);

    await expect(loginUser({ email: 'x', password: 'y' })).rejects.toThrow(LOGIN_ERROR_MESSAGE);
  });

  it('logout/clear session removes credentials', async () => {
    const { storeAccessToken, storeUser, clearSession, getAccessToken, getStoredUser } = await import('./session');
    await storeAccessToken('token');
    await storeUser({ id: '1', email: 'a', fullName: 'A', globalRole: 'USER' });
    await clearSession();
    expect(await getAccessToken()).toBeNull();
    expect(await getStoredUser()).toBeNull();
  });

  it('malformed/failed responses are handled safely', async () => {
    const { loginUser } = await import('./auth');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: null }),
    } as Response);

    await expect(loginUser({ email: 'x', password: 'y' })).rejects.toThrow('Login failed');
  });
});
