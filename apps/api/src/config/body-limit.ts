/**
 * Phase 23 (W4): the maximum accepted JSON request body.
 *
 * body-parser defaults to 100kb, which is silently lower than this
 * application's own declared upload contract: `UploadDocumentDto` accepts up
 * to 20MB of base64 and `DocumentService` enforces a 10MB decoded ceiling.
 * With the default in place, any document larger than ~75KB was rejected by
 * the parser before the DTO ran, and — because the failure is a
 * `PayloadTooLargeError` rather than an `HttpException` — it surfaced as an
 * HTTP 500. The documented contract was therefore unreachable for every
 * non-trivial file, and the failure mode was wrong.
 *
 * The limit is set explicitly, above the largest payload the application
 * declares it accepts (20MB of base64 plus JSON envelope overhead), so the
 * parser and the DTO agree instead of one silently overriding the other. It
 * is a hard ceiling, not an allowance: a body above it is refused with 413
 * before any allocation proportional to its size is retained, which is what
 * keeps a large limit from becoming a denial-of-service vector.
 *
 * It lives here, not in `main.ts`, because the test application must apply
 * the identical limit. When that lived in `main.ts` the HTTP suites ran with
 * body-parser's 100kb default while production ran with this one — the tested
 * system was not the shipped system. `test/validation-boundary.security.e2e-spec.ts`
 * fails if a body above the DTO's documented ceiling is accepted, and if a
 * normal-sized upload is refused.
 */
export const MAX_JSON_BODY_BYTES = 24 * 1024 * 1024;
