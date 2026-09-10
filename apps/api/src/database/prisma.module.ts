import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global module so any feature module can inject `PrismaService`
 * without re-importing this module. Keep this thin — do not
 * accumulate business logic here.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
