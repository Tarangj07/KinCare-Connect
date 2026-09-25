/**
 * Centralized API client for mobile.
 * Attaches Authorization header from secure storage.
 * Does NOT expose raw tokens in errors or logs.
 */
import { API_BASE_URL } from '../lib/api-base';
import { getAccessToken, deleteAccessToken } from './session';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options?.headers ? (Object.fromEntries(
      Object.entries(options.headers as Record<string, string>).filter(([, v]) => v !== undefined)
    ) as Record<string, string>) : {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 || res.status === 403) {
    // Clear session on auth failure; caller should redirect
    await deleteAccessToken();
  }

  if (!res.ok) {
    const text = await res.text();
    // Never include token, path parameters containing IDs, or sensitive payload in message
    const safeMessage = `Request failed (${res.status})`;
    throw new ApiError(safeMessage, res.status);
  }

  // Some endpoints return empty bodies (e.g., 204)
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return null as unknown as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestInit) => apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestInit) => apiFetch<T>(path, { ...opts, method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown, opts?: RequestInit) => apiFetch<T>(path, { ...opts, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown, opts?: RequestInit) => apiFetch<T>(path, { ...opts, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string, opts?: RequestInit) => apiFetch<T>(path, { ...opts, method: 'DELETE' }),
};

export { apiFetch };
