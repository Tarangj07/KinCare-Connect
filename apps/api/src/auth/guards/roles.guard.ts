import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { ForbiddenException,Injectable } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest();
    const user = (req as { user?: { globalRole?: string; role?: string } }).user;
    const userRole = user?.globalRole ?? user?.role ?? 'USER';
    if (required.includes(userRole)) return true;
    throw new ForbiddenException('Insufficient privileges.');
  }
}
