import { Controller, Get } from '@nestjs/common';

/**
 * Liveness/readiness surface. Phase 1 only confirms the process is up.
 * Readiness (Postgres + Redis reachable) is added in Phase 18.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; service: string; phase: number } {
    return { status: 'ok', service: 'api', phase: 1 };
  }
}
