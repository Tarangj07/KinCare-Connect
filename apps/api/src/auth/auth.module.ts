import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { PrismaModule } from '../database/prisma.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Authentication and authorization module.
 *
 * Phase 3 focus:
 * - Registration, login, refresh, logout, me endpoints.
 * - Refresh-token rotation with reuse detection (family-based).
 * - RBAC with @Roles() decorator and RolesGuard.
 * - Authentication audit events via AuditLog (database-level,
 *   enforced by the application layer in Phase 4).
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env['JWT_ACCESS_SECRET'] ?? 'dev-secret-change-me',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
