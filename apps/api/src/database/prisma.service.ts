import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin NestJS wrapper around `PrismaClient`.
 *
 * Phase 2 only needs connection management. As features are added
 * we will:
 *  - inject a `DATABASE_URL` validator at startup (Phase 3+)
 *  - add request-scoped middleware that logs query latency
 *    (Phase 18)
 *  - route audit-log writes through this service so that no other
 *    module can write to `audit_logs` directly (Phase 3)
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
