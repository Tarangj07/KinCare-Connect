import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { RequestIdMiddleware } from './request-id.middleware';

type HeaderCarrier = { [k: string]: string | string[] | undefined };

function run(inboundValue: string | string[] | undefined): { id: string; echoed: string } {
  const req = { headers: { 'x-request-id': inboundValue } as HeaderCarrier };
  let echoed = '';
  const res = {
    setHeader: (name: string, value: string) => {
      if (name === 'x-request-id') echoed = value;
    },
  } as unknown as Response;

  new RequestIdMiddleware().use(
    req as unknown as Request,
    res,
    (() => {
      /* next() */
    }) as NextFunction,
  );

  return { id: (req as unknown as { id: string }).id, echoed };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phase 18 production hardening — the inbound correlation id is echoed into
 * the response, the JSON error body and server-side log lines, so it must
 * not carry arbitrary client-supplied content into those sinks.
 */
describe('RequestIdMiddleware (Phase 18 hardening)', () => {
  it('generates a UUID when no id is supplied', () => {
    const { id, echoed } = run(undefined);
    expect(id).toMatch(UUID);
    expect(echoed).toBe(id);
  });

  it('honours a well-formed inbound correlation id', () => {
    const { id, echoed } = run('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(echoed).toBe(id);
  });

  it('honours trace-style ids with the allowed separators', () => {
    const { id } = run('trace-01HZY.abc_def:123');
    expect(id).toBe('trace-01HZY.abc_def:123');
  });

  it.each([
    ['injection attempt with spaces and quotes', 'evil id" injected="yes'],
    ['log-forging style text', 'GET /admin 200 OK'],
    ['angle-bracket markup', '<script>alert(1)</script>'],
    ['value over the length limit', 'a'.repeat(65)],
  ])('replaces %s with a fresh UUID instead of echoing it', (_label, inbound) => {
    const { id, echoed } = run(inbound);
    expect(id).toMatch(UUID);
    expect(echoed).toBe(id);
    expect(id).not.toBe(inbound);
  });

  it('ignores a non-string header (array) form', () => {
    const { id } = run(['first', 'second']);
    expect(id).toMatch(UUID);
  });

  it('accepts a 64-character id at the boundary', () => {
    const boundary = 'b'.repeat(64);
    expect(run(boundary).id).toBe(boundary);
  });
});
