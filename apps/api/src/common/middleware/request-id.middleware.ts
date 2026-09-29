import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

/**
 * Phase 18 (production hardening): an inbound correlation id is accepted
 * only if it looks like a correlation id.
 *
 * The value is echoed back on the response, written into the JSON error
 * body, and prefixed onto server-side log lines. Echoing arbitrary client
 * text into those sinks is a log-forging / response-injection vector: an
 * attacker could plant misleading or misleadingly-attributed content in
 * operator logs. Node's HTTP parser already rejects raw CR/LF in header
 * values, so newline injection is not reachable, but arbitrary text of any
 * shape is still accepted today.
 *
 * Restricting the inbound value to a conservative opaque-id charset keeps
 * genuine correlation (UUIDs, trace ids, short ticket refs) working while
 * preventing a client from injecting arbitrary content.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Stamps each request with a stable id, echoed back on the response.
 * Honors a valid inbound id when the caller supplies one; otherwise mints
 * a random UUID.
 */
export class RequestIdMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[HEADER];
    const id =
      typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader(HEADER, id);
    next();
  }
}
