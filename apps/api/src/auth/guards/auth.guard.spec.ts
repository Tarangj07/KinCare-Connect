import type { ExecutionContext} from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from './auth.guard';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

const VALID_SECRET = 'unit-test-secret-value-with-more-than-32-chars!!';
process.env['JWT_ACCESS_SECRET'] = VALID_SECRET;
process.env['NODE_ENV'] = 'test';

describe('JwtAuthGuard — authentication guarantees (Phase 16 H5/A8)', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwtService = { verifyAsync: vi.fn() };
    guard = new JwtAuthGuard(jwtService as never);
  });

  it('rejects a request that has NO Authorization header even when a refresh cookie is present', async () => {
    // This is the exact bypass shape from the Phase 16 audit: cookie-only
    // requests used to return `true` with no identity attached.
    const req: { headers: Record<string, string>; cookies?: Record<string, string>; user?: unknown } = { headers: {}, cookies: { refresh: 'jti.secret' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });

  it('rejects a request with no Authorization header and no cookie', async () => {
    const req: { headers: Record<string, string>; cookies?: Record<string, string>; user?: unknown } = { headers: {}, cookies: {} };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token missing/);
  });

  it('rejects a malformed Bearer header', async () => {
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Token abc' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unverifiable token and does not attach identity', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer forged' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('rejects a validly-signed token that lacks a subject (identity guarantee)', async () => {
    jwtService.verifyAsync.mockResolvedValue({ email: 'x@y.z', role: 'USER' });
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer no-sub' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });

  it('accepts a verified token with a subject and pins HS256', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.c', role: 'USER' });
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.user).toEqual({ sub: 'user-1', email: 'a@b.c', role: 'USER' });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('good', {
      secret: VALID_SECRET,
      algorithms: ['HS256'],
    });
  });
});
