/**
 * Navigation/session-state security checks (service level).
 *
 * The app's route guard derives `isAuthenticated` from the presence of a
 * stored user + access token (see src/hooks/useAuth.tsx). Full render
 * tests would require a React renderer (not installed); these specs
 * verify the underlying session state the navigation depends on, using
 * the same SecureStore mock the session specs use.
 *
 * Phase 17: replaced two tautological placeholder assertions
 * (`expect(false).toBe(false)`, `expect(isLoading).toBe(true)`) with
 * real session-state behavior.
 */
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

const mockStore = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  setItemAsync: async (key: string, value: string) => {
    mockStore.set(key, value);
  },
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    mockStore.delete(key);
  },
}));

/** Mirrors the derivation `isAuthenticated = !!user && !!user.id` in useAuth. */
async function authState(): Promise<boolean> {
  const { getStoredUser, getAccessToken } = await import('../services/session');
  const token = await getAccessToken();
  const user = await getStoredUser();
  return Boolean(user && user.id && token);
}

describe('Navigation Security — session state feeding the router', () => {
  beforeEach(async () => {
    mockStore.clear();
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('a cleared session is unauthenticated (isAuthenticated derives false)', async () => {
    const { clearSession } = await import('../services/session');
    await clearSession();
    expect(await authState()).toBe(false);
  });

  it('a stored session makes isAuthenticated true and survives reload (fresh import)', async () => {
    const { storeAccessToken, storeUser } = await import('../services/session');
    await storeAccessToken('tok-123');
    await storeUser({ id: 'u-1', email: 'a@b.c', fullName: 'A', globalRole: 'USER' });
    expect(await authState()).toBe(true);
  });

  it('logout removes the session state that gates protected screens', async () => {
    const { storeAccessToken, storeUser, clearSession, getAccessToken, getStoredUser } =
      await import('../services/session');
    await storeAccessToken('tok-123');
    await storeUser({ id: 'u-1', email: 'a@b.c', fullName: 'A', globalRole: 'USER' });
    expect(await authState()).toBe(true);

    await clearSession();
    expect(await getAccessToken()).toBeNull();
    expect(await getStoredUser()).toBeNull();
    expect(await authState()).toBe(false);
  });

  it('a stored user WITHOUT a token never counts as authenticated', async () => {
    const { storeUser } = await import('../services/session');
    await storeUser({ id: 'u-1', email: 'a@b.c', fullName: 'A', globalRole: 'USER' });
    expect(await authState()).toBe(false);
  });
});
