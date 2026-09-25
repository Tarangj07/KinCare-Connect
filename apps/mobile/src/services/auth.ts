import { API_BASE_URL } from '../lib/api-base';
import { getAccessToken, storeAccessToken, storeUser, clearSession } from './session';

interface LoginPayload {
  email: string;
  password: string;
}

export const LOGIN_ERROR_MESSAGE = 'Login failed. Please check your credentials and try again.';

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    globalRole: string;
  };
  access?: string;
}

function isAuthResponse(data: unknown): data is AuthResponse {
  if (!data || typeof data !== 'object') return false;
  const response = data as Partial<AuthResponse>;
  return Boolean(
    response.user &&
      typeof response.user.id === 'string' &&
      typeof response.user.email === 'string' &&
      typeof response.user.fullName === 'string' &&
      typeof response.user.globalRole === 'string'
  );
}

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(LOGIN_ERROR_MESSAGE);
  }

  let data: AuthResponse;
  try {
    data = (await res.json()) as AuthResponse;
  } catch {
    throw new Error(LOGIN_ERROR_MESSAGE);
  }
  if (!isAuthResponse(data)) {
    throw new Error(LOGIN_ERROR_MESSAGE);
  }

  if (data.access) {
    await storeAccessToken(data.access);
  }
  await storeUser(data.user);
  return data;
}

export async function refreshAccess(): Promise<string | null> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { access: string };
  await storeAccessToken(data.access);
  return data.access;
}

export async function logoutUser(): Promise<void> {
  const token = await getAccessToken();
  await clearSession();
  try {
    await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
  } catch {
    // Ignore network errors on logout
  }
}

export async function getMe(): Promise<AuthResponse['user'] | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return (await res.json()) as AuthResponse['user'];
}
