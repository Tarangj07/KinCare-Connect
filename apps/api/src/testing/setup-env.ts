/**
 * Vitest setup: deterministic environment for API specs.
 *
 * - Caps the Prisma connection pool so many spec files booting AppModule
 *   (each with its own PrismaService) cannot exhaust PostgreSQL
 *   max_connections.
 * - Forces NODE_ENV=test so cookie flags and secret validation behave
 *   identically regardless of the caller's shell environment.
 * - Sets the dedicated, test-only rate-limit opt-out so the HTTP auth
 *   suites do not self-throttle (Phase 18 / L-03). This flag is ignored
 *   whenever NODE_ENV=production, so it can never weaken a production
 *   deployment even if it leaks into one.
 * - Redirects document storage to a temp directory so HTTP document specs
 *   never litter (or read) `apps/api/uploads/` inside the repo tree.
 *
 * Test-infra only; no application behaviour changes in production envs.
 */
import * as os from 'os';
import * as path from 'path';

const url = process.env['DATABASE_URL'];
if (url && !url.includes('connection_limit')) {
  process.env['DATABASE_URL'] = `${url}${url.includes('?') ? '&' : '?'}connection_limit=5`;
}
process.env['NODE_ENV'] = 'test';
process.env['ECC_TEST_DISABLE_RATE_LIMIT'] = '1';
if (!process.env['STORAGE_DIR']) {
  process.env['STORAGE_DIR'] = path.join(os.tmpdir(), 'ecc-api-test-storage');
}
