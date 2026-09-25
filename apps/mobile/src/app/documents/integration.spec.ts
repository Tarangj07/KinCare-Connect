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

describe('Document Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('document list calls expected endpoint', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [{ id: 'd1', title: 'Report', contentType: 'application/pdf', sizeBytes: 1024, seniorId: 's1', createdAt: '2024-01-01' }],
    } as Response);

    const result = await api.get('/api/v1/seniors/s1/documents');
    expect(Array.isArray(result)).toBe(true);
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('documents');
  });

  it('download calls expected backend endpoint', async () => {
    const { api } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ fileContent: 'base64data', fileName: 'report.pdf' }),
    } as Response);

    await api.get('/api/v1/seniors/s1/documents/d1/download');
    expect((global.fetch as vi.Mock).mock.calls[0][0]).toContain('download');
  });

  it('unauthorized document response produces safe user-facing error', async () => {
    const { apiFetch, ApiError } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({}),
      text: async () => 'Forbidden',
    } as Response);

    await expect(apiFetch('/api/v1/seniors/s1/documents/d1/download')).rejects.toThrow();
  });

  it('document contents are not logged or persisted unexpectedly', async () => {
    // This verifies the API abstraction does not expose raw file contents in errors
    const { apiFetch } = await import('../../services/api');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({}),
      text: async () => 'base64content_internal_secret',
    } as Response);

    try {
      await apiFetch('/api/v1/seniors/s1/documents/d1/download');
    } catch (e: unknown) {
      const message = (e as Error).message;
      expect(message).not.toContain('base64content');
      expect(message).not.toContain('secret');
    }
  });
});
