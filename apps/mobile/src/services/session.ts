/**
 * Secure session storage for mobile authentication.
 * Uses expo-secure-store for access tokens (never refresh tokens in mobile context,
 * but refresh token from cookie is handled server-side; mobile relies on access token
 * and refresh endpoint when needed).
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'ecc_access_token';
const USER_KEY = 'ecc_user';

export async function storeAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function deleteAccessToken(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
}

export async function storeUser(user: { id: string; email: string; fullName: string; globalRole: string }): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getStoredUser(): Promise<{ id: string; email: string; fullName: string; globalRole: string } | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { id: string; email: string; fullName: string; globalRole: string };
  } catch {
    return null;
  }
}

export async function deleteStoredUser(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function clearSession(): Promise<void> {
  await deleteAccessToken();
  await deleteStoredUser();
}
