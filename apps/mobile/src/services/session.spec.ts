/**
 * Actual behavior tests for mobile session/auth services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock expo-secure-store
const mockStore = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  setItemAsync: async (key: string, value: string) => { mockStore.set(key, value); },
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  deleteItemAsync: async (key: string) => { mockStore.delete(key); },
}));

describe('Session Service', () => {
  beforeEach(async () => {
    mockStore.clear();
    // Dynamic import to get fresh module after mock
    const { storeAccessToken, getAccessToken, deleteAccessToken, clearSession, storeUser, getStoredUser, deleteStoredUser } = await import('./session');
    await deleteAccessToken();
    await deleteStoredUser();
  });

  afterEach(() => {
    mockStore.clear();
  });

  it('stores and retrieves access token', async () => {
    const { storeAccessToken, getAccessToken } = await import('./session');
    await storeAccessToken('test_token_123');
    const token = await getAccessToken();
    expect(token).toBe('test_token_123');
  });

  it('deletes access token', async () => {
    const { storeAccessToken, deleteAccessToken, getAccessToken } = await import('./session');
    await storeAccessToken('test_token_123');
    await deleteAccessToken();
    const token = await getAccessToken();
    expect(token).toBeNull();
  });

  it('stores and retrieves user data', async () => {
    const { storeUser, getStoredUser } = await import('./session');
    await storeUser({ id: '1', email: 'a@b.com', fullName: 'Alice', globalRole: 'FAMILY_ADMIN' });
    const user = await getStoredUser();
    expect(user?.email).toBe('a@b.com');
  });

  it('clearSession removes both token and user', async () => {
    const { storeAccessToken, storeUser, clearSession, getAccessToken, getStoredUser } = await import('./session');
    await storeAccessToken('t');
    await storeUser({ id: '1', email: 'a@b.com', fullName: 'A', globalRole: 'USER' });
    await clearSession();
    expect(await getAccessToken()).toBeNull();
    expect(await getStoredUser()).toBeNull();
  });
});
