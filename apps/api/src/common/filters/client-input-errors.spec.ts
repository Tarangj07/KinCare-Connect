/**
 * Phase 23 (W4) — the error boundary.
 *
 * `classifyClientInputError` decides whether a thrown value is the client's
 * fault or the server's. Getting that wrong is expensive in both directions:
 * classify a server fault as client input and a real outage looks like user
 * error, and classify client input as a server fault and every malformed
 * request becomes an alert.
 *
 * The tests below therefore cover both classifications, and pay particular
 * attention to the cases where the answer is "still a 500". Synthetic errors
 * are used rather than a database, because the point is the decision, not the
 * driver.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { classifyClientInputError } from './client-input-errors';
import { GlobalExceptionFilter } from './global-exception.filter';

interface Captured {
  status?: number;
  body?: { error?: { code?: string; message?: string; requestId?: string; stack?: unknown } };
}

async function runFilter(exception: unknown, request: unknown = { id: 'req-1' }): Promise<Captured> {
  const captured: Captured = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body as Captured['body'];
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  new GlobalExceptionFilter().catch(exception, host as never);
  return captured;
}

describe('classifyClientInputError (Phase 23 W4)', () => {
  it('maps body-parser PayloadTooLargeError to 413', () => {
    const result = classifyClientInputError({
      name: 'PayloadTooLargeError',
      type: 'entity.too.large',
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'request entity too large',
    });
    expect(result?.status).toBe(413);
    expect(result?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps Prisma P2023 (a non-UUID where a UUID is required) to 400', () => {
    const result = classifyClientInputError({
      name: 'PrismaClientKnownRequestError',
      code: 'P2023',
      message: 'Inconsistent column data: Error creating UUID, invalid character: found `n` at 1',
    });
    expect(result?.status).toBe(400);
    expect(result?.code).toBe('INVALID_IDENTIFIER');
  });

  it('maps a Prisma argument-validation error to 400', () => {
    const result = classifyClientInputError({
      name: 'PrismaClientValidationError',
      message: 'Invalid value for argument `measuredAt`: Provided Date object is invalid.',
    });
    expect(result?.status).toBe(400);
    expect(result?.code).toBe('INVALID_VALUE');
  });

  it('never copies text from the underlying error into the response message', () => {
    const secretish =
      'Inconsistent column data: column "users"."password_hash" = $argon2id$v=19$m=65536 secret';
    const result = classifyClientInputError({ name: 'PrismaClientKnownRequestError', code: 'P2023', message: secretish });
    expect(result?.message).not.toContain('argon2');
    expect(result?.message).not.toContain('password_hash');
  });

  describe('stays a 500 when it is the server at fault', () => {
    const serverFaults: Array<[string, unknown]> = [
      ['a database that cannot be reached', { name: 'PrismaClientInitializationError', errorCode: 'P1001' }],
      ['a constraint violated by correct input', { name: 'PrismaClientKnownRequestError', code: 'P2002' }],
      ['a deadlock', { name: 'PrismaClientKnownRequestError', code: 'P2034' }],
      ['a plain Error', new Error('unexpected')],
      ['a TypeError', new TypeError('undefined is not a function')],
      ['a thrown string', 'something odd'],
      ['null', null],
      ['undefined', undefined],
    ];

    for (const [label, fault] of serverFaults) {
      it(label, () => {
        expect(classifyClientInputError(fault)).toBeUndefined();
      });
    }
  });

  it('does not let an arbitrary error downgrade itself by carrying `status: 400`', () => {
    // A bug that produced such an object must not be able to disguise a
    // server fault as a client error.
    const result = classifyClientInputError({ name: 'SomeError', status: 400, message: 'x' });
    expect(result).toBeUndefined();
  });
});

describe('GlobalExceptionFilter (Phase 23 W4)', () => {
  it('reports an oversized body as 413 in the documented envelope', async () => {
    const captured = await runFilter({
      name: 'PayloadTooLargeError',
      type: 'entity.too.large',
      status: 413,
      message: 'request entity too large',
    });
    expect(captured.status).toBe(413);
    expect(captured.body?.error?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(captured.body?.error?.requestId).toBe('req-1');
    expect(captured.body?.error?.stack).toBeUndefined();
  });

  it('reports a malformed UUID path parameter as 400, not 500', async () => {
    const captured = await runFilter({
      name: 'PrismaClientKnownRequestError',
      code: 'P2023',
      message: 'Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix',
    });
    expect(captured.status).toBe(400);
    expect(captured.body?.error?.code).toBe('INVALID_IDENTIFIER');
  });

  it('still reports a genuine server fault as 500', async () => {
    const captured = await runFilter(new Error('the database is on fire'));
    expect(captured.status).toBe(500);
    expect(captured.body?.error?.code).toBe('INTERNAL_ERROR');
    expect(captured.body?.error?.message).toBe('An unexpected error occurred.');
  });

  it('never returns a stack trace, whatever is thrown', async () => {
    for (const thrown of [
      new Error('boom'),
      new TypeError('boom'),
      { name: 'PrismaClientKnownRequestError', code: 'P2023', message: 'x' },
      { name: 'PayloadTooLargeError', type: 'entity.too.large' },
      'a string',
    ]) {
      const captured = await runFilter(thrown);
      expect(JSON.stringify(captured.body)).not.toMatch(/\bat [\w.$<>]+ \(/);
      expect(captured.body?.error?.stack).toBeUndefined();
    }
  });

  it('preserves the status and code of an HttpException unchanged', async () => {
    const notFound = await runFilter(new HttpException('nope', HttpStatus.NOT_FOUND));
    expect(notFound.status).toBe(404);
    expect(notFound.body?.error?.code).toBe('NOT_FOUND');
    expect(notFound.body?.error?.message).toBe('nope');
  });
});
