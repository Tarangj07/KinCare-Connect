import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { PrismaService } from '../../database/prisma.service';

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
}

interface ReadinessResponse extends HealthResponse {
  database: { status: 'ok' | 'error' };
}

/**
 * Deployment health surface.
 *
 * Phase 19 separates the two probes a deployment needs, which were
 * previously conflated in a single endpoint:
 *
 *  - `GET /health`      **Liveness.** Is the process itself healthy? It
 *    answers without touching any dependency, so a database outage never
 *    causes an orchestrator to restart an otherwise healthy process.
 *  - `GET /health/ready` **Readiness.** Should this instance receive
 *    traffic? It performs the cheapest possible database round-trip and
 *    returns 503 when the database is unreachable.
 *
 * Security properties preserved deliberately:
 *  - Both routes are unauthenticated by design, exactly as before. A
 *    health probe cannot authenticate, and nothing here is protected data.
 *  - Neither route is an authorization bypass: they expose no user,
 *    document, senior, or tenant information, and perform no lookup beyond
 *    `SELECT 1`.
 *  - **No internal detail is disclosed.** The previous implementation
 *    returned the raw driver error message (`database.detail`), which on a
 *    public unauthenticated endpoint can reveal the database host, port and
 *    database name. Failures now report only a status. The underlying
 *    error is still logged server-side by the global exception layer.
 *  - The stale `phase` marker has been removed; it described a project
 *    milestone, not a deployment property.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up and serving. No dependency checks. */
  @Get()
  liveness(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }

  /** Readiness: dependencies required to serve traffic are usable. */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    let database: { status: 'ok' | 'error' } = { status: 'ok' };
    try {
      // Cheapest possible round-trip, via Prisma's parameterised path.
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // Intentionally no error detail in the response (see class comment).
      database = { status: 'error' };
    }

    const ready = database.status === 'ok';
    if (!ready) {
      res.status(503);
    }
    return {
      status: ready ? 'ok' : 'degraded',
      service: 'api',
      database,
    };
  }
}
