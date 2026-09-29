/**
 * Phase 23 (W4) — classification of request-caused failures.
 *
 * Some failures are caused by what the client sent, not by the server being
 * broken. Reporting those as HTTP 500 is wrong twice over: it tells the
 * client the request was unrecoverable when a corrected request would
 * succeed, and it fills the operator error log with stack traces for traffic
 * an attacker can generate at will.
 *
 * Three such classes were found in Phase 23, all reaching the HTTP boundary
 * as 500:
 *
 *   1. `PayloadTooLargeError` (body-parser) — a body over the parser limit.
 *      The correct answer is 413.
 *   2. Prisma `P2023` "Inconsistent column data" — a path segment that is not
 *      a valid UUID for the `@db.Uuid` column it is compared against. The
 *      correct answer is 400; the id is malformed, not missing.
 *   3. Prisma client-validation errors naming an invalid argument — which in
 *      this codebase means `new Date("Invalid Date")` reached a query,
 *      because the DTO's date regex accepts a syntactically well-formed but
 *      semantically impossible timestamp such as `2026-13-45T99:99:99.000Z`.
 *      The correct answer is 400.
 *
 * Every other Prisma failure — a connection that cannot be made, a
 * constraint violated by correct input, a deadlock — is deliberately NOT
 * classified here. Those are server or data conditions and must keep
 * producing 500, so an outage is never disguised as a client mistake.
 *
 * The returned `message` is always a fixed string written here. No text from
 * the underlying error is ever copied into the response, so driver messages
 * (which contain column names, argument values and, in some Prisma
 * versions, the query) cannot leak through this path.
 */
import { HttpStatus } from '@nestjs/common';

/** Prisma's code for a value that cannot be cast to the column's type. */
const PRISMA_INCONSISTENT_COLUMN_DATA = 'P2023';

export interface ClientInputClassification {
  readonly status: number;
  readonly code: string;
  /** Fixed, secret-free text. Never derived from the thrown error. */
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * body-parser raises `PayloadTooLargeError` with a `type` of
 * `entity.too.large`. Matching on the structural marker rather than the class
 * name avoids a hard dependency on body-parser's internals and keeps this
 * module importable in a unit test with a plain object.
 */
function isPayloadTooLarge(err: Record<string, unknown>): boolean {
  return err['type'] === 'entity.too.large' || err['status'] === HttpStatus.PAYLOAD_TOO_LARGE;
}

/**
 * Prisma attaches a `code` to its known request errors. `P2023` is the only
 * one classified here, and only because every `@db.Uuid` column in the
 * schema makes it mean "the caller sent a non-UUID where a UUID is required".
 */
function isInconsistentColumnData(err: Record<string, unknown>): boolean {
  return err['code'] === PRISMA_INCONSISTENT_COLUMN_DATA;
}

/**
 * `PrismaClientValidationError` is raised for arguments Prisma refuses before
 * any query runs. Every instance reaching here in this application is caused
 * by a value the request supplied, so it is a 400. The message is generic on
 * purpose: Prisma's own text names the model, the field and the offending
 * value, which is internal schema detail.
 */
function isPrismaArgumentValidation(err: Record<string, unknown>): boolean {
  return err['name'] === 'PrismaClientValidationError';
}

/**
 * Map a thrown value to a client-input response, or return undefined when it
 * is a genuine server-side failure that must stay a 500.
 */
export function classifyClientInputError(exception: unknown): ClientInputClassification | undefined {
  if (!isRecord(exception)) return undefined;
  // `status` is only trusted for the specific body-parser marker, never
  // generically: an arbitrary error carrying `status: 400` must not be able
  // to downgrade itself.
  if (isPayloadTooLarge(exception)) {
    return {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is larger than this endpoint accepts.',
    };
  }
  if (isInconsistentColumnData(exception)) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_IDENTIFIER',
      message: 'A path or body identifier is not a valid identifier for this resource.',
    };
  }
  if (isPrismaArgumentValidation(exception)) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_VALUE',
      message: 'A supplied value is not valid for this resource.',
    };
  }
  return undefined;
}
