#!/usr/bin/env node
/**
 * Phase 18 (M-01) — production build determinism regression check.
 *
 * Reproduces the exact failure mode reported by the Phase 17 independent
 * review and asserts it can no longer occur:
 *
 *   `nest build` runs with `deleteOutDir: true`, which removes dist/
 *   before compilation. With the inherited `incremental: true`, tsc
 *   consults tsconfig.build.tsbuildinfo, decides every output file is
 *   already up to date, and emits nothing — leaving dist/ empty while
 *   still exiting 0. A developer or CI step that trusted the exit code
 *   would ship or run a build with no `dist/main.js` at all.
 *
 * This script performs three consecutive builds and asserts the expected
 * production artifacts exist after EACH of them:
 *
 *   1. clean build (no dist, no tsbuildinfo)
 *   2. warm build (unchanged sources)      <- the case that used to fail
 *   3. warm build with a deliberately stale tsbuildinfo present
 *
 * It also asserts production hygiene: no spec files and no test helper
 * modules are emitted into dist/.
 *
 * Exits non-zero on the first failed expectation so it can gate CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(appRoot, 'dist');
const tsBuildInfo = join(appRoot, 'tsconfig.build.tsbuildinfo');

/** Artifacts a successful production build must always produce. */
const REQUIRED_ARTIFACTS = ['main.js', 'main.d.ts', 'app.module.js'];

const failures = [];

function check(condition, description) {
  if (condition) {
    console.log(`  ok  ${description}`);
  } else {
    console.log(`  FAIL ${description}`);
    failures.push(description);
  }
}

function runBuild(label) {
  console.log(`\n[${label}] running nest build ...`);
  execFileSync('npx', ['nest', 'build'], { cwd: appRoot, stdio: 'inherit' });
  console.log(`[${label}] nest build exited 0`);

  for (const artifact of REQUIRED_ARTIFACTS) {
    check(
      existsSync(join(dist, artifact)) && statSync(join(dist, artifact)).size > 0,
      `${label}: dist/${artifact} exists and is non-empty`,
    );
  }
}

function assertProductionHygiene() {
  const emitted = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else emitted.push(full.slice(dist.length + 1));
    }
  };
  if (existsSync(dist)) walk(dist);

  const specFiles = emitted.filter((f) => f.includes('.spec.') || f.includes('.test.'));
  check(specFiles.length === 0, `no spec/test files in dist (found ${specFiles.length})`);

  const testingHelpers = emitted.filter((f) => f.startsWith('testing/'));
  check(testingHelpers.length === 0, `no src/testing helpers in dist (found ${testingHelpers.length})`);

  check(emitted.length > 0, `dist is not empty (${emitted.length} files)`);
}

console.log('Phase 18 (M-01) — production build determinism check');

// 1. Clean build.
rmSync(dist, { recursive: true, force: true });
rmSync(tsBuildInfo, { force: true });
runBuild('clean build');
assertProductionHygiene();

// 2. Warm build with unchanged sources — the case that previously produced
//    an empty dist while still exiting 0.
runBuild('warm build (unchanged sources)');
assertProductionHygiene();

// 3. Warm build with a deliberately stale/incompatible tsbuildinfo, which
//    is the state a long-lived developer checkout can present.
writeFileSync(tsBuildInfo, JSON.stringify({ root: ['src/main.ts'], version: 'stale-fixture' }));
runBuild('warm build (stale tsbuildinfo present)');
assertProductionHygiene();
rmSync(tsBuildInfo, { force: true });

if (failures.length > 0) {
  console.error(
    `\nBuild determinism check FAILED (${failures.length} problem(s)).` +
      '\nA production build succeeded without emitting the expected artifacts.',
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nBuild determinism check PASSED: every build emitted the production artifacts.');
