import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RateLimitExceededException } from '../exceptions/rate-limit-exceeded.exception';

import { classifyClientInputError } from './client-input-errors';

/**
 * Global error filter. Maps all thrown errors to a stable JSON shape.
 *
 *   { "error": { "code": "STRING_CODE", "message": "human readable", "requestId": "..." } }
 *
 * Stack traces are never returned to the client. They are logged
 * server-side with the request id at error level.
 *
 * Phase 23 (W4): three classes of error that are *caused by the request*
 * used to be reported as HTTP 500, which is both wrong and misleading:
 *
 *   1. A request body larger than the parser's limit raised body-parser's
 *      `PayloadTooLargeError`, which is a plain Error, so it fell through to
 *      the 500 branch. A client sending a large document got "an unexpected
 *      error occurred" and an operator saw an unhandled error in the log.
 *   2. A malformed identifier in a path segment (e.g.
 *      `GET /seniors/<id>/medications/not-a-uuid`) reached Prisma, which
 *      rejects it as `P2023 Inconsistent column data` — again a plain Error,
 *      again a 500.
 *   3. A syntactically well-formed but semantically impossible date (e.g.
 *      `2026-13-45T99:99:99.000Z`, which the DTO's regex accepts) became
 *      `new Date("Invalid Date")` and Prisma raised a client-validation
 *      error — again a 500.
 *
 * Each is a client-input problem and each is now reported as the 4xx it is,
 * with a message that names the problem and nothing else. The
 * classification lives in `client-input-errors.ts` so it can be unit-tested
 * against synthetic errors without a database.
 *
 * This narrows nothing: the response body is still built here, from a fixed
 * set of messages, and no driver text, SQL, path or stack is ever copied
 * from the underlying error into it.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';

    // Phase 28 (N-12). The rate limiter throws this, so this is the only
    // place `Retry-After` is set. RFC 6585 §3 makes the header optional but
    // is what makes 429 actionable: without it a client has to guess when to
    // come back, which is exactly what caused a 403-era throttled user to
    // give up. The value is computed by the guard from the real window, not
    // asserted here, and is written only for this one exception type — no
    // other status ever gains a `Retry-After`.
    if (exception instanceof RateLimitExceededException) {
      res.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const candidate = body as { message?: unknown; code?: unknown };
        if (typeof candidate.message === 'string') {
          message = candidate.message;
        }
        if (typeof candidate.code === 'string') {
          code = candidate.code;
        }
      }
      if (code === 'INTERNAL_ERROR') {
        code = this.codeForStatus(status);
      }
    } else {
      // A request-caused failure that is not an HttpException. Reported as the
      // 4xx it is; logged in full server-side.
      const clientError = classifyClientInputError(exception);
      if (clientError) {
        status = clientError.status;
        code = clientError.code;
        message = clientError.message;
        this.logger.warn(
          `[${requestId}] client input rejected (${code}): ${exception instanceof Error ? exception.name : typeof exception}`,
        );
      } else if (exception instanceof Error) {
        this.logger.error(`[${requestId}] ${exception.name}: ${exception.message}`, exception.stack);
      } else {
        this.logger.error(`[${requestId}] non-Error thrown: ${String(exception)}`);
      }
    }

    res.status(status).json({
      error: { code, message, requestId },
    });
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 413:
        return 'PAYLOAD_TOO_LARGE';
      case 422:
        return 'UNPROCESSABLE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }
}
