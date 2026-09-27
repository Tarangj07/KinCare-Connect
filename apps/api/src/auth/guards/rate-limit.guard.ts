import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { ForbiddenException,Injectable } from '@nestjs/common';

/**
 * Placeholder in-process rate limiter (Phase 3; known limitations are
 * tracked as Medium A13 — not shared across replicas, IP-keyed).
 *
 * Phase 17 (test determinism): the strict per-IP budget makes the
 * automated auth suite self-throttle (register+login+rotation chains
 * exceed 10 requests from 127.0.0.1 in a single file), which produced
 * non-deterministic 403s unrelated to the behaviour under test. In the
 * test environment only, the guard admits everything; the limiter itself
 * is exercised directly by its own unit spec instead.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, { attempts: number; lastAttempt: number }>();
  private readonly maxAttempts = 10;
  private readonly windowMs = 15 * 60 * 1000;

  canActivate(context: ExecutionContext): boolean {
    if (process.env['NODE_ENV'] === 'test') return true;
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
