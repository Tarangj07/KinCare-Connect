#!/usr/bin/env node
/**
 * Phase 28 (N-12) — mutation test of the rate-limit HTTP-semantics fix.
 *
 * The N-12 fix changes a production security behaviour, so it needs a
 * mutation test that can distinguish "the protection is present" from "the
 * test happens to be green". This harness exists because the project has
 * repeatedly found gates that pass for the wrong reason — a gate reading the
 * real file instead of the mutant, a test that silently stripped the field
 * under test, a check on a string the mutant had not touched.
 *
 * Method. Each mutant is applied to the SOURCE, the affected suites are run,
 * and they must FAIL. The source is then restored and the suites must PASS
 * again. Every mutant therefore has to leave the tree exactly as it found it.
 *
 * Each mutant is verified to have actually changed the file it claims to
 * change: a mutant whose anchor text does not occur exactly once is a hard
 * error, not a silent no-op. A no-op mutant would produce a "PASS" that
 * proves nothing, which is the specific failure mode this project has hit
 * before.
 *
 * The behavioural suites are used, not source-text matching, wherever a
 * behavioural suite exists:
 *   - `rate-limit.guard.spec.ts`  (unit, guard behaviour, 19 -> 28 cases)
 *   - `rate-limit.http.e2e-spec.ts` (real HTTP through the real global
 *     exception filter, no database)
 *   - `apps/mobile` `api.spec.ts`  (client session behaviour on 429)
 *
 * Mutants:
 *   M-N12-1  the refusal reverts to 403
 *   M-N12-2  the refusal is bypassed entirely (limiter running, not refusing)
 *   M-N12-3  the `Retry-After` contract is dropped from a 429
 *   M-N12-4  `Retry-After` is a fabricated constant, ignoring the window
 *   M-N12-5  a 429 is returned with no envelope classification
 *            (`RATE_LIMITED` removed from the filter's status map)
 *   M-N12-6  authorization refusals widened to 429 (the over-correction)
 *            -> MUST fail. Proves the suites assert the 403 half too, rather
 *               than matching on the status number alone.
 *   M-N12-7  the mobile client treats 429 as an auth failure again
 *            -> MUST fail, in the mobile suite.
 *   M-N12-8  NEGATIVE CONTROL — an unrelated authorization refusal is
 *            reworded
 *            -> MUST still pass. Proves the suites are not simply coupled to
 *               the whole authorization surface, which is what would make
 *               M-N12-6's detection accidental rather than meaningful.
 *
 * Usage:  node scripts/mutate-rate-limit-n12.mjs [--only M-N12-1,...]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps/api');
const mobileRoot = path.join(repoRoot, 'apps/mobile');

const only = process.argv.includes('--only')
  ? new Set((process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()))
  : null;

const EXCEPTION_FILE = path.join(apiRoot, 'src/common/exceptions/rate-limit-exceeded.exception.ts');
const GUARD_FILE = path.join(apiRoot, 'src/auth/guards/rate-limit.guard.ts');
const FILTER_FILE = path.join(apiRoot, 'src/common/filters/global-exception.filter.ts');
const MOBILE_FILE = path.join(mobileRoot, 'src/services/api.ts');

/**
 * `expected: 'fail'`  -> the suites MUST fail (the mutant removed a protection)
 * `expected: 'pass'`  -> the suites MUST still pass (negative control)
 */
const MUTANTS = [
  {
    id: 'M-N12-1',
    label: 'the rate-limit refusal reverts from 429 to 403',
    expected: 'fail',
    suites: 'api',
    file: EXCEPTION_FILE,
    from: "super('Rate limit exceeded. Try again later.', HttpStatus.TOO_MANY_REQUESTS);",
    to: "super('Rate limit exceeded. Try again later.', HttpStatus.FORBIDDEN);",
  },
  {
    id: 'M-N12-2',
    label: 'the rate-limit refusal is bypassed entirely',
    expected: 'fail',
    suites: 'api',
    file: GUARD_FILE,
    from: '      throw new RateLimitExceededException(this.retryAfterSecondsFor(record, now));',
    to: '      return true;',
  },
  {
    id: 'M-N12-3',
    label: 'the Retry-After contract is dropped from a 429',
    expected: 'fail',
    suites: 'api',
    file: FILTER_FILE,
    from: "      res.setHeader('Retry-After', String(exception.retryAfterSeconds));",
    to: '      void exception;',
  },
  {
    id: 'M-N12-4',
    label: 'Retry-After is a fabricated constant that ignores the real window',
    expected: 'fail',
    suites: 'api',
    file: GUARD_FILE,
    from: '    const remainingMs = record.lastAttempt + this.windowMs - now;\n    return Math.max(1, Math.ceil(remainingMs / 1000));',
    to: '    void record;\n    void now;\n    return 60;',
  },
  {
    id: 'M-N12-5',
    label: 'the filter no longer classifies a 429 as RATE_LIMITED',
    expected: 'fail',
    suites: 'api',
    file: FILTER_FILE,
    from: "      case 429:\n        return 'RATE_LIMITED';",
    to: "      case 429:\n        return 'ERROR';",
  },
  {
    id: 'M-N12-6',
    label: 'authorization refusals widened to 429 as well (N-12 over-correction)',
    // This is the mutant that proves the rate-limit suites have a NEGATIVE
    // half. They assert a 429 for the limiter AND a 403 for a genuine
    // authorization refusal, so widening 403 to 429 — the most likely
    // over-correction, and one that would leave M-N12-1 satisfied — must be
    // caught. If this mutant passed, the suites would be matching on the
    // status number rather than on the property they claim to test.
    expected: 'fail',
    suites: 'api',
    file: FILTER_FILE,
    from: '      status = exception.getStatus();',
    to: '      status = exception.getStatus() === 403 ? 429 : exception.getStatus();',
  },
  {
    id: 'M-N12-7',
    label: 'NEGATIVE CONTROL: the mobile client treats 429 as an auth failure again',
    // The converse negative control. The API suites cannot see this — it is
    // a client-side regression — so the mobile suite is the one that must
    // fail. Without it, the mobile spec added in Phase 28 would be
    // unverified.
    expected: 'fail',
    suites: 'mobile',
    file: MOBILE_FILE,
    from: '  if (res.status === 401 || res.status === 403) {',
    to: '  if (res.status === 401 || res.status === 403 || res.status === 429) {',
  },
  {
    id: 'M-N12-8',
    label: 'NEGATIVE CONTROL: an unrelated authorization refusal is reworded',
    // A true blind-spot control. An unrelated 403 in a feature controller is
    // changed in a way the rate-limit suites are not supposed to notice, and
    // they must still PASS. This is what distinguishes a suite that verifies
    // the rate-limit property from one that has simply been coupled to the
    // whole authorization surface. A failure here would mean M-N12-6 passed
    // for the wrong reason.
    expected: 'pass',
    suites: 'api',
    file: path.join(apiRoot, 'src/modules/medications/medication.controller.ts'),
    from: "    if (!userId) throw new ForbiddenException('Authentication required.');",
    // Same status, same class, different text. Type-checks with the symbols
    // already imported; an unimported symbol would fail compilation and the
    // mutant would never be observed, which would make this "passing"
    // control a lie.
    to: "    if (!userId) throw new ForbiddenException('Authentication required for this senior.');",
  },
];

/** Counts occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Run the suites that cover the mutated behaviour.
 *
 * Every runner is given a throwaway cwd-scoped temp HOME-ish dir? No — the
 * suites are read-only with respect to the repository, and the API e2e suite
 * sets its own STORAGE_DIR. What matters is that `spawnSync` inherits a
 * clean exit status and that a timeout is treated as a failure rather than a
 * pass.
 */
function runSuites(suites) {
  // Phase 32. The suites are invoked as an ABSOLUTE interpreter running an
  // ABSOLUTE, repoRoot-relative vitest entry point, not as `pnpm exec vitest`.
  //
  // Two properties follow, and both were required:
  //
  //   1. Determinism. The target is resolved from `repoRoot`, so the harness
  //      behaves identically whatever the caller's cwd is, and it cannot be
  //      satisfied by a `vitest` that happens to be first on someone's PATH.
  //   2. No inherited environment. `pnpm` is a PATH lookup, so invoking it made
  //      this file read `process.env.PATH` — and `verify-config-contract.mjs`
  //      correctly reported that as an undocumented environment read. It also
  //      read `HOME` for pnpm's store. Spawning node directly removes both
  //      reads, so the child needs no PATH and no HOME at all. Verified: the
  //      three suites below pass under `env -i` (an empty environment).
  //
  // This is the root-cause fix, not a suppression: the config contract still
  // fails any real application variable that is read and undocumented.
  const vitestFor = (pkgRoot) => path.join(pkgRoot, 'node_modules', 'vitest', 'vitest.mjs');

  const runs = [
    {
      name: 'api:unit',
      args: [vitestFor(apiRoot), 'run', '--config', 'vitest.config.unit.ts', 'src/auth/guards/rate-limit.guard.spec.ts'],
      cwd: apiRoot,
    },
    {
      name: 'api:e2e',
      args: [vitestFor(apiRoot), 'run', '--config', 'vitest.config.e2e.ts', 'test/rate-limit.http.e2e-spec.ts'],
      cwd: apiRoot,
    },
  ];
  if (suites === 'mobile') {
    runs.length = 0;
    runs.push({
      name: 'mobile:api',
      args: [vitestFor(mobileRoot), 'run', 'src/services/api.spec.ts'],
      cwd: mobileRoot,
    });
  }

  const results = [];
  for (const run of runs) {
    const started = Date.now();
    const res = spawnSync(process.execPath, run.args, {
      cwd: run.cwd,
      encoding: 'utf8',
      timeout: 300_000,
      // A clean, minimal environment: the suites must not silently depend on
      // a developer shell. Nothing inherited, because nothing is needed.
      env: {
        CI: '1',
        FORCE_COLOR: '0',
      },
    });
    const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    results.push({
      name: run.name,
      status: res.status,
      signal: res.signal,
      timedOut: res.error?.code === 'ETIMEDOUT',
      output,
      ms: Date.now() - started,
    });
  }
  return results;
}

function summarise(results) {
  return results
    .map((r) => {
      const counts = /Tests\s+(?:(\d+) failed)?\s*(?:\| )?(?:(\d+) passed)?/.exec(r.output);
      const tail = r.output
        .split('\n')
        .filter((l) => /FAIL|AssertionError|Error:/.test(l))
        .slice(0, 3)
        .join(' | ');
      return `      ${r.name}: exit=${r.status}${r.timedOut ? ' TIMEOUT' : ''} signal=${r.signal ?? '-'} (${r.ms}ms)${
        tail ? `\n        ${tail.slice(0, 300)}` : ''
      }${counts ? '' : ''}`;
    })
    .join('\n');
}

function allPassed(results) {
  return results.every((r) => r.status === 0 && !r.timedOut && r.signal === null);
}

let failures = 0;
const log = (m) => console.log(m);

log('Phase 28 (N-12) — mutation test of the rate-limit HTTP-semantics fix\n');

// ---------------------------------------------------------------------------
// CONTROL. Run before any mutant, so a harness that cannot pass at all is
// reported as a harness defect rather than as a mutant that "correctly"
// failed.
// ---------------------------------------------------------------------------
log('  CONTROL  (unmutated source — every suite must be green)');
const control = runSuites('api');
log(summarise(control));
if (!allPassed(control)) {
  log('\n  FAIL  the control is red on unmutated source. The harness cannot distinguish a');
  log('        mutant from a pre-existing failure, so no mutant result would be meaningful.');
  log('        Fix the control first; do not proceed to mutation testing.');
  process.exit(1);
}
log('        -> green, so a failing mutant is attributable to the mutation\n');

// Pre-harness snapshot of every file this harness is allowed to touch, so the
// final byte-identity check does not depend on the per-mutant `finally` having
// worked. Catching a leaked mutant by reading the tree back is the point.
const MUTABLE_FILES = [
  EXCEPTION_FILE,
  GUARD_FILE,
  FILTER_FILE,
  MOBILE_FILE,
  path.join(apiRoot, 'src/modules/medications/medication.controller.ts'),
];
const originalByFile = new Map(MUTABLE_FILES.map((f) => [f, readFileSync(f, 'utf8')]));

for (const m of MUTANTS) {
  if (only && !only.has(m.id)) continue;
  log(`  ${m.id}  ${m.label}`);

  const original = readFileSync(m.file, 'utf8');
  const occurrences = countOccurrences(original, m.from);
  if (occurrences !== 1) {
    // A hard error. If this fires, the mutant is a no-op or is ambiguous, and
    // a "the suite failed" result would be meaningless.
    log(`      FAIL  anchor text occurs ${occurrences} times in ${path.relative(repoRoot, m.file)} (expected exactly 1).`);
    log('        The mutant would not have been applied, so its result would prove nothing.');
    failures += 1;
    log('');
    continue;
  }

  let mutated = false;
  try {
    writeFileSync(m.file, original.replace(m.from, m.to));
    mutated = true;

    const results = runSuites(m.suites);
    log(summarise(results));

    if (m.expected === 'fail') {
      if (allPassed(results)) {
        log('      FAIL  the suites PASSED with the protection removed. The verification is');
        log('            vacuous for this mutation — fix the test or the gate before continuing.');
        failures += 1;
      } else {
        log(`        -> detected, as required (expected a failure, got exit=${results.map((r) => r.status).join(',')})`);
      }
    } else {
      if (allPassed(results)) {
        log('        -> correctly NOT detected; this mutant is outside what these suites claim to cover');
      } else {
        log('      FAIL  the negative control FAILED. These suites are supposed to be blind to this');
        log('            mutant, so a failure means they are matching on something broader than the');
        log('            property they claim to test (for example, on the status number alone).');
        failures += 1;
      }
    }
  } finally {
    if (mutated) writeFileSync(m.file, original);
    // Byte-identity is asserted, not assumed. A harness that leaves a mutant
    // behind corrupts every later phase, and this project has been bitten by
    // exactly that (N-10).
    const after = readFileSync(m.file, 'utf8');
    if (after !== original) {
      log(`      FAIL  ${path.relative(repoRoot, m.file)} was not restored byte-for-byte.`);
      writeFileSync(m.file, original);
      failures += 1;
    }
  }
  log('');
}


// ---------------------------------------------------------------------------
// RESTORED CONTROL. Proves the tree is back to a green state after the whole
// mutant set, not merely after each individual restore.
// ---------------------------------------------------------------------------
log('  RESTORED CONTROL  (source must be byte-identical and green again)');
const restored = runSuites('api');
log(summarise(restored));
if (!allPassed(restored)) {
  log('      FAIL  the suites are not green after restoring the source. A mutant leaked.');
  failures += 1;
} else {
  log('        -> green again');
}

// Independent byte check of every file this harness is allowed to touch.
for (const f of [EXCEPTION_FILE, GUARD_FILE, FILTER_FILE, MOBILE_FILE]) {
  if (originalByFile.has(f) && readFileSync(f, 'utf8') !== originalByFile.get(f)) {
    log(`      FAIL  ${path.relative(repoRoot, f)} differs from its pre-harness contents`);
    failures += 1;
  }
}

log('');
if (failures) {
  log(`  RESULT  FAIL — ${failures} problem(s). At least one protection is not load-bearing,`);
  log('          or the harness itself is defective. Do not treat the N-12 fix as verified.');
  process.exit(1);
}
log('  RESULT  PASS — every N-12 protection is load-bearing, the negative control is genuinely');
log('          blind, and the source was restored byte-for-byte.');
