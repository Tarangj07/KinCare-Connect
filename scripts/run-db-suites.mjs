#!/usr/bin/env node
/**
 * Phase 28 — run the API's database-backed suites against a THROWAWAY
 * PostgreSQL, never the developer `ecc` database.
 *
 * This is a test driver, not a gate. It exists because the e2e/security
 * suites need a real database, and the only database that is always present
 * on a developer machine is the one that must not be touched. It composes
 * `scripts/lib/throwaway-postgres.mjs` (the same self-provisioning module
 * Phase 26 added, whose database names are always prefixed so a developer
 * database cannot be reached even by a bug) with the existing test scripts.
 *
 * Properties this driver guarantees, because each is a way a run could
 * silently produce a WRONG answer rather than an error:
 *  - the developer `ecc` database is never named: the throwaway name is
 *    generated per run and prefixed;
 *  - the container is destroyed in a `finally`, and again on SIGINT/SIGTERM,
 *    so an interrupted run does not leave a database behind;
 *  - a suite that exits non-zero fails this driver — an interrupted or
 *    crashed suite is never reported as a pass;
 *  - suites run SEQUENTIALLY. The `dist`-mutating gates must not be run
 *    concurrently (N-10), and the real-DB suites share one database.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createThrowawayPostgres } from './lib/throwaway-postgres.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps/api');

const pg = createThrowawayPostgres({ label: 'p28' });

let failed = 0;

try {
  await pg.start();
  pg.installCleanupHandlers();
  console.log(`throwaway PostgreSQL: ${pg.container} (database ${pg.database})`);
  console.log('the developer `ecc` database is not involved in this run\n');

  const url = pg.url();
  pg.migrate(apiRoot);
  console.log('migrations applied to the throwaway database\n');

  const suites = [
    { name: 'api:integration (e2e + security)', args: ['exec', 'vitest', 'run', '--config', 'vitest.config.e2e.ts'] },
    { name: 'api:all (unit + integration)', args: ['exec', 'vitest', 'run'] },
  ];

  for (const suite of suites) {
    console.log(`  ${suite.name}`);
    const res = spawnSync('pnpm', suite.args, {
      cwd: apiRoot,
      encoding: 'utf8',
      timeout: 1_800_000,
      env: { ...process.env, DATABASE_URL: url },
    });
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    const summary = out
      .split('\n')
      .filter((l) => /Test Files|Tests |Duration/.test(l))
      .map((l) => l.trim())
      .join(' | ');
    if (res.status === 0) {
      console.log(`    PASS  ${summary}\n`);
    } else {
      failed += 1;
      console.log(`    FAIL  exit=${res.status}${res.signal ? ` signal=${res.signal}` : ''}`);
      console.log(`          ${summary}`);
      for (const line of out.split('\n').filter((l) => /FAIL|AssertionError/.test(l)).slice(0, 10)) {
        console.log(`          ${line.slice(0, 220)}`);
      }
      console.log('');
    }
  }
} catch (err) {
  failed += 1;
  console.error(`  ERROR  ${err?.message ?? String(err)}`);
} finally {
  // Idempotent, and safe to call twice, so this `finally` and the signal
  // handlers installed above cannot conflict.
  pg.destroy();
  console.log('throwaway PostgreSQL destroyed');
}

process.exit(failed ? 1 : 0);
