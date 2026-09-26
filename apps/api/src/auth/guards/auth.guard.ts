import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { resolveJwtAccessSecret } from '../../config/security-config';

/**
 * JWT authentication guard.
 *
 * Phase 16 (H5/A8): the previous implementation returned `true` whenever a
 * `refresh` cookie was present without validating anything or populating
 * `req.user`, letting requests through the guard unauthenticated. The
 * refresh flow owns its own `@Public()` route and does not need — and must
 * never implicitly receive — a bypass here. The only accepted credential is
 * a valid Bearer access token signed with the configured secret.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'];
    let token: string | undefined;

    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token) throw new UnauthorizedException('Access token missing.');

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; email: string; role: string }>(token, {
        secret: resolveJwtAccessSecret(),
        algorithms: ['HS256'],
      });
      // Identity guarantee: a passing request always has a subject.
      if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new UnauthorizedException('Access token invalid or expired.');
      }
      (req as Request & { user: { sub: string; email: string; role: string } }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Access token invalid or expired.');
    }
  }
}
