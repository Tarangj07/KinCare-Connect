import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RateLimitGuard } from './rate-limit.guard';

function makeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

/**
 * Phase 17: the guard self-bypasses when NODE_ENV=test (so the broad
 * HTTP/e2e suites don't self-throttle), which means its real budgeting
 * logic must be proven here with NODE_ENV explicitly unset.
 */
describe('RateLimitGuard', () => {
  const savedEnv = process.env['NODE_ENV'];
  let guard: RateLimitGuard;

  beforeEach(() => {
    delete process.env['NODE_ENV'];
    guard = new RateLimitGuard();
  });

  afterEach(() => {
    if (savedEnv !== undefined) process.env['NODE_ENV'] = savedEnv;
  });

  it('allows the first request from an IP', () => {
    expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
  });

  it('blocks the 11th attempt inside the window (10 max)', () => {
    for (let i = 0; i < 10; i += 1) expect(guard.canActivate(makeContext('9.9.9.9'))).toBe(true);
    expect(() => guard.canActivate(makeContext('9.9.9.9'))).toThrow(ForbiddenException);
  });

  it('tracks IPs independently', () => {
    for (let i = 0; i < 10; i += 1) guard.canActivate(makeContext('1.1.1.1'));
    expect(() => guard.canActivate(makeContext('1.1.1.1'))).toThrow(ForbiddenException);
    expect(guard.canActivate(makeContext('2.2.2.2'))).toBe(true);
  });

  it('test environment bypasses the limiter (suite determinism)', () => {
    process.env['NODE_ENV'] = 'test';
    for (let i = 0; i < 30; i += 1) expect(guard.canActivate(makeContext('3.3.3.3'))).toBe(true);
  });
});
