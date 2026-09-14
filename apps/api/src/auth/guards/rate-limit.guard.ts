import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { ForbiddenException,Injectable } from '@nestjs/common';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, { attempts: number; lastAttempt: number }>();
  private readonly maxAttempts = 10;
  private readonly windowMs = 15 * 60 * 1000;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const ip = (req.ip ?? req.connection?.remoteAddress ?? 'unknown').toString();
    const now = Date.now();
    const record = this.store.get(ip);

    if (!record || now - record.lastAttempt > this.windowMs) {
      this.store.set(ip, { attempts: 1, lastAttempt: now });
      return true;
    }
    if (record.attempts >= this.maxAttempts) {
      throw new ForbiddenException('Rate limit exceeded. Try again later.');
    }
    record.attempts += 1;
    record.lastAttempt = now;
    this.store.set(ip, record);
    return true;
  }
}
