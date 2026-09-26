import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

interface DbStatus {
  status: 'ok' | 'error';
  detail?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  phase: number;
  database: DbStatus;
}

/**
 * Phase 1 liveness was a static response. Phase 2 extends the
 * endpoint to also report database connectivity, which becomes the
 * readiness probe in Phase 18.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let db: DbStatus;
    try {
      // The cheapest round-trip we can make: SELECT 1 wrapped in a
      // tagged template so it goes through Prisma's parameterised
      // query path.
      await this.prisma.$queryRaw`SELECT 1`;
      db = { status: 'ok' };
    } catch (err) {
      db = { status: 'error', detail: err instanceof Error ? err.message : 'unknown' };
    }

    return {
      status: db.status === 'ok' ? 'ok' : 'degraded',
      service: 'api',
      phase: 2,
      database: db,
    };
  }
}
