import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Global error filter. Maps all thrown errors to a stable JSON shape.
 *
 *   { "error": { "code": "STRING_CODE", "message": "human readable", "requestId": "..." } }
 *
 * Stack traces are never returned to the client. They are logged
 * server-side with the request id at error level.
 *
 * Phase 1 stub. As features are added this filter is extended to
 * recognise feature-specific error classes (e.g. domain validation
 * errors, authorization failures).
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
    } else if (exception instanceof Error) {
      this.logger.error(`[${requestId}] ${exception.name}: ${exception.message}`, exception.stack);
    } else {
      this.logger.error(`[${requestId}] non-Error thrown: ${String(exception)}`);
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
      case 422:
        return 'UNPROCESSABLE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }
}
