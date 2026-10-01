/**
 * Phase 50 — API error taxonomy.
 *
 * The single most important property of this module is that it REFUSES to
 * collapse distinct failure modes. The Phase 48 assessment found a product
 * where 403s looked like empty data and unperformed operations reported
 * success. This client therefore keeps `401`, `403`, `404`, `429` and `5xx`
 * distinguishable all the way to the UI, and never converts any of them into
 * a successful-looking result.
 */

/**
 * `unauthenticated` — 401. The session is absent, expired or invalid.
 * `forbidden` — 403. Authenticated, but the backend refused the action.
 * `not_found` — 404. The resource does not exist (or is not visible).
 * `validation` — 400/422. The request was malformed.
 * `rate_limited` — 429. Too many requests.
 * `server` — 5xx. The backend failed.
 * `network` — the request never completed (DNS, connection, timeout).
 */
export type ApiErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'unknown';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
  cause?: unknown;
}

/** A failed API call. Never thrown for a successful response. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    if (init.cause !== undefined) this.cause = init.cause;
  }

  /** True when the caller's session is no longer valid. */
  get isUnauthenticated(): boolean {
    return this.kind === 'unauthenticated';
  }

  /** True when the caller IS authenticated but not permitted. */
  get isForbidden(): boolean {
    return this.kind === 'forbidden';
  }

  /** True for anything that is not an authentication/authorization decision. */
  get isTransient(): boolean {
    return this.kind === 'server' || this.kind === 'network';
  }
}

/** Map an HTTP status onto the taxonomy above. */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'unknown';
  return 'unknown';
}

/** The API's stable error envelope: `{ error: { code, message, requestId } }`. */
interface ApiErrorEnvelope {
  error?: { code?: string; message?: string; requestId?: string };
}

function readEnvelope(body: unknown): ApiErrorEnvelope['error'] {
  if (typeof body !== 'object' || body === null) return undefined;
  const envelope = (body as ApiErrorEnvelope).error;
  if (typeof envelope !== 'object' || envelope === null) return undefined;
  return envelope;
}

/**
 * Build an `ApiError` from a non-2xx response.
 *
 * Falls back to a status-derived message when the body is not the documented
 * envelope, so an unexpected body still produces a typed, honest failure
 * rather than being swallowed.
 */
export function apiErrorFromResponse(status: number, body: unknown): ApiError {
  const kind = kindForStatus(status);
  const envelope = readEnvelope(body);
  const fallback = defaultMessageForKind(kind, status);
  return new ApiError({
    kind,
    status,
    code: envelope?.code,
    requestId: envelope?.requestId,
    message: envelope?.message && envelope.message.length > 0 ? envelope.message : fallback,
  });
}

/** A message that is safe to render: never leaks an internal URL or a token. */
export function defaultMessageForKind(kind: ApiErrorKind, status?: number): string {
  switch (kind) {
    case 'unauthenticated':
      return 'You are not signed in, or your session has expired. Please sign in again.';
    case 'forbidden':
      return 'You are signed in, but you do not have permission to do that.';
    case 'not_found':
      return 'That resource could not be found.';
    case 'validation':
      return 'Some of the details provided were not accepted.';
    case 'rate_limited':
      return 'Too many requests. Please wait a moment and try again.';
    case 'server':
      return status ? `The service is currently unavailable (HTTP ${status}).` : 'The service is currently unavailable.';
    case 'network':
      return 'The service could not be reached. Please check your connection.';
    default:
      return 'Something went wrong.';
  }
}

/** Wrap a thrown transport-level failure. Never returns a success value. */
export function networkError(cause: unknown): ApiError {
  return new ApiError({
    kind: 'network',
    message: defaultMessageForKind('network'),
    cause,
  });
}

/** Narrow an unknown thrown value to `ApiError`. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}