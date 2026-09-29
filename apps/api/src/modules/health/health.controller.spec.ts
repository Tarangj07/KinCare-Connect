import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../database/prisma.service';

import { HealthController } from './health.controller';

/** Minimal stand-in for the express response used with @Res passthrough. */
function makeRes(): { status: ReturnType<typeof vi.fn>; statusCode: number | null } {
  const res = {
    statusCode: null as number | null,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
  };
  return res;
}

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = { $queryRaw: vi.fn() } as unknown as { $queryRaw: ReturnType<typeof vi.fn> };
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();
    controller = moduleRef.get(HealthController);
    // Inject the same value used as the provider token, so we are
    // not at the mercy of Nest deciding whether to use the test
    // value or construct a new PrismaService.
    (controller as unknown as { prisma: typeof prisma }).prisma = prisma;
  });

  describe('liveness (GET /health)', () => {
    it('reports ok without contacting the database', () => {
      // A database outage must not make a running process look dead.
      prisma.$queryRaw.mockRejectedValue(new Error('database is down'));
      expect(controller.liveness()).toEqual({ status: 'ok', service: 'api' });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('exposes no dependency detail and no stale phase marker', () => {
      const body = controller.liveness() as unknown as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['service', 'status']);
      expect(body).not.toHaveProperty('database');
      expect(body).not.toHaveProperty('phase');
    });
  });

  describe('readiness (GET /health/ready)', () => {
    it('is ready (no 503) when the database is reachable', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
      const res = makeRes();
      const body = await controller.readiness(res as unknown as Response);

      expect(body).toEqual({ status: 'ok', service: 'api', database: { status: 'ok' } });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 503 and degrades when the database is unreachable', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
      const res = makeRes();
      const body = await controller.readiness(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body.status).toBe('degraded');
      expect(body.database.status).toBe('error');
    });

    it('never discloses the underlying driver error (Phase 19 hardening)', async () => {
      // The previous implementation returned the raw driver message, which on
      // a public unauthenticated endpoint can leak the database host, port
      // and database name.
      const driverError = "Can't reach database server at `db.internal:5432/ecc`";
      prisma.$queryRaw.mockRejectedValueOnce(new Error(driverError));
      const res = makeRes();
      const body = await controller.readiness(res as unknown as Response);

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('db.internal');
      expect(serialized).not.toContain('5432');
      expect(serialized).not.toContain('ecc`');
      expect(serialized).not.toContain('connection refused');
      expect(body).not.toHaveProperty('detail');
      expect(body.database).not.toHaveProperty('detail');
    });
  });
});
