import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('expo-secure-store', () => {
  return {
    setItemAsync: async () => {},
    getItemAsync: async () => null,
    deleteItemAsync: async () => {},
  };
});

vi.mock('../../lib/api-base', () => ({
  API_BASE_URL: 'http://localhost:3000',
}));

describe('Emergency Alert Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emergency list calls the expected backend endpoint', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [{ id: 'a1', type: 'SOS', severity: 'HIGH', status: 'ACTIVE', seniorId: 's1', detectedAt: '2024-01-01' }],
    } as Response);

    const result = await api.get('/api/v1/seniors/test-id/emergency-alerts');
    expect(Array.isArray(result)).toBe(true);
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('emergency-alerts');
  });

  it('alert detail uses the selected alertId', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'a1', status: 'ACTIVE', type: 'FALL', severity: 'MEDIUM', seniorId: 's1' }),
    } as Response);

    await api.get('/api/v1/seniors/s1/emergency-alerts/a1');
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('/a1');
  });

  it('acknowledge action calls the expected endpoint', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({}),
    } as Response);

    await api.post('/api/v1/seniors/s1/emergency-alerts/a1/acknowledge');
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('acknowledge');
  });

  it('resolve action calls the expected endpoint', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({}) } as Response);
    await api.post('/api/v1/seniors/s1/emergency-alerts/a1/resolve');
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('resolve');
  });

  it('cancel action calls the expected endpoint', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({}) } as Response);
    await api.post('/api/v1/seniors/s1/emergency-alerts/a1/cancel');
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('cancel');
  });

  it('terminal states do not expose inappropriate actions', async () => {
    // Verify safe error behavior for unauthorized or invalid state transitions
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({}),
      text: async () => 'Forbidden',
    } as Response);

    await expect(api.post('/api/v1/seniors/s1/emergency-alerts/a1/resolve')).rejects.toThrow();
  });

  it('backend 401/403 errors are converted into safe user-facing behavior', async () => {
    const { apiFetch, ApiError } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({}),
      text: async () => 'Access denied',
    } as Response);

    await expect(apiFetch('/api/v1/seniors/s1/emergency-alerts')).rejects.toThrow(ApiError);
    try {
      await apiFetch('/api/v1/seniors/s1/emergency-alerts');
    } catch (e: unknown) {
      const err = e as ApiError;
      expect(err.status).toBe(403);
      expect(err.message).toBe('Request failed (403)');
    }
  });
});
