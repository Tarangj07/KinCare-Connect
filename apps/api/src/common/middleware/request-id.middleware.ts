import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

/**
 * Stamps each request with a stable id, echoed back on the response.
 * Honors an inbound id if the caller supplied a valid one.
 */
export class RequestIdMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[HEADER];
    const id =
      typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 200
        ? inbound
        : randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader(HEADER, id);
    next();
  }
}
