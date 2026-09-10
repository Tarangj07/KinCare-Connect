import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../database/prisma.service';

import { HealthController } from './health.controller';

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

  it('reports ok when the database is reachable', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      service: 'api',
      phase: 2,
      database: { status: 'ok' },
    });
  });

  it('reports degraded when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.database.status).toBe('error');
    expect(result.database.detail).toContain('connection refused');
  });
});
