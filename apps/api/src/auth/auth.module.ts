import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { resolveJwtAccessSecret } from '../config/security-config';
import { PrismaModule } from '../database/prisma.module';

import { AuthorizationService } from './authorization.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Authentication and authorization module.
 *
 * Phase 16 focus:
 * - Fail-fast JWT secret resolution (C2/A2) — no dev-secret fallback.
 * - CSPRNG refresh tokens with O(1) jti lookup + real reuse revocation
 *   (C1/A1, H3/A5, H4/A6).
 * - JwtModule exported so feature controllers that attach JwtAuthGuard by
 *   class reference can resolve their dependencies.
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: resolveJwtAccessSecret(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthorizationService],
  exports: [AuthService, AuthorizationService, JwtModule],
})
export class AuthModule {}
