import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'];
    let token: string | undefined;

    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.refresh) {
      // Refresh endpoint handles cookie refresh; return true
      // and let refresh endpoint manage token rotation.
      return true;
    }

    if (!token) throw new UnauthorizedException('Access token missing.');

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; email: string; role: string }>(token, {
        secret: process.env['JWT_ACCESS_SECRET'] ?? 'dev-secret-change-me',
      });
      (req as Request & { user: { sub: string; email: string; role: string } }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Access token invalid or expired.');
    }
  }
}
