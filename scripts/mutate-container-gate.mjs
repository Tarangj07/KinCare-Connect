#!/usr/bin/env node
/**
 * Phase 23 (W7) — mutation test of the container gate.
 *
 * The container gate is the only check that runs against the artefact a
 * deployment would actually run, so a false pass in it is the most expensive
 * kind. Phase 22 already mutation-tested the argon2 assertion; this extends
 * the same discipline to the highest-value security checks added in Phase 23
 * and to the ones most likely to rot silently.
 *
 * Method. Each mutant is applied to the SOURCE, the API image is rebuilt with
 * --no-cache from that source, and the gate is run. The gate must FAIL. The
 * source is then restored and the images are rebuilt, and the gate must PASS
 * again — so a mutant cannot leave the tree or the images in a bad state.
 *
 * Rebuilding the API image is ~60s, so the mutant set is chosen for coverage
 * rather than exhaustiveness: one per distinct mechanism.
 *
 * Mutants:
 *   M1  body-parser's limit reverted to the 100kb default
 *       -> the request-size check must fail. This is the check most likely to
 *          look green while the product is broken, because a 400 is still a
 *          400.
 *   M2  the password policy reverted to the quadratic regex
 *       -> the ReDoS check must fail, or time out.
 *   M3  the error boundary no longer classifies a request-caused failure
 *       -> the malformed-identifier check must fail.
 *   M4  the rate limiter's production arming removed
 *       -> the rate-limit check must fail.
 *   M5  a storage permission regressed to the process umask default
 *       -> the 0600/0700 check must fail.
 *   M6  the runtime user becomes root
 *       -> the non-root check must fail.
 *   M7  the `maxAge` bound removed from `JwtAuthGuard` (Phase 24 D-2)
 *       -> the token-lifetime check must fail. The same control is also
 *          mutation-tested at source level by `verify:lifetime:mutate`; this
 *          mutant proves the IMAGE, which is the only place the two can
 *          differ from `dist`.
 *   M8  the rate-limit refusal reverted to 403 (Phase 28 N-12)
 *       -> the rate-limit check must fail.
 *   M9  the rate-limit refusal bypassed entirely
 *       -> the rate-limit check must fail. Distinct from M4 (disarmed) and
 *          M8 (wrong status): this is the limiter running but not refusing.
 *   M10 the `Retry-After` contract dropped from a 429
 *       -> the rate-limit check must fail. M8 and M10 both leave 429 in
 *          place, so neither alone can show the header is load-bearing.
 *   M11 authorization refusals widened to 429 (N-12 over-correction)
 *       -> the authorization check must fail. The converse of M8..M10.
 *
 * Phase 24 (D-9): free space is reported after every mutant and a low-space
 * warning names the mitigation. `--prune-cache` enables reclaiming the build cache
 * between mutants; it reduces the disk peak and makes the run network-dependent, so
 * it is off by default. See the D-9 block in the body for the measurement.
 *
 * Phase 24: an interrupted run now restores the mutated source instead of leaving a
 * mutant in the tree.
 *
 * Usage:  node scripts/mutate-container-gate.mjs [--only M1,M2] [--prune-cache] [--min-free-gb N]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps/api');
const gate = path.join(repoRoot, 'scripts/verify-docker-images.mjs');

const only = process.argv.includes('--only')
  ? new Set((process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()))
  : null;

/** file -> [[from, to], ...] */
const MUTANTS = {
  M1: {
    label: 'body-parser limit reverted to the 100kb default',
    expected: /a body well above body-parser default is parsed, not refused/,
    edits: [
      [
        'src/config/body-limit.ts',
        'export const MAX_JSON_BODY_BYTES = 24 * 1024 * 1024;',
        'export const MAX_JSON_BODY_BYTES = 100 * 1024;',
      ],
    ],
  },
  M2: {
    label: 'the password policy reverted to the Phase-16 quadratic regex with no length cap',
    expected: /password policy is enforced in the image and is not a ReDoS/,
    // The whole function is replaced, not just the final expression. The
    // Phase-23 fix has TWO independent barriers — a MAX_PASSWORD_LENGTH cap
    // that rejects an over-long password before any pattern runs, and a
    // linear-time check — and restoring only the quadratic pattern leaves the
    // cap in place, which short-circuits before the regex is ever evaluated.
    // The gate would then pass, for a reason that has nothing to do with
    // whether it can detect the ReDoS. The real regression is both removed.
    //
    // The pattern is written verbatim from the Phase-16 auth.dto.ts, including
    // the `.*` inside each digit/symbol lookahead. Dropping that `.*` anchors
    // the lookahead to the current position, the pattern stops matching any
    // ordinary password, and the gate fails at registration instead of on the
    // ReDoS check — a pass for the wrong reason.
    edits: [
      [
        'src/auth/password-policy.ts',
        `export function isAcceptablePassword(password: unknown): boolean {
  if (typeof password !== 'string') return false;
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  let upper = false;
  let lower = false;
  let digit = false;
  let symbol = false;
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    if (code >= 0x41 && code <= 0x5a) upper = true;
    else if (code >= 0x61 && code <= 0x7a) lower = true;
    else if (code >= 0x30 && code <= 0x39) digit = true;
    else symbol = true;
  }

  return (
    (upper && lower && digit) || (upper && symbol) || (lower && symbol && digit)
  );
}`,
        [
          'export function isAcceptablePassword(password: unknown): boolean {',
          "  if (typeof password !== 'string') return false;",
          '  if (password.length < MIN_PASSWORD_LENGTH) return false;',
          // A regex LITERAL cannot span lines, so the pattern is emitted on one
          // line. An earlier revision joined the four alternatives with '\n',
          // which produced a source file that does not compile — the mutant
          // then never reached the gate.
          '  return /(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).*' +
            '|(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).*' +
            '|(?=.*[A-Z])(?=.*[\\W_]).*' +
            '|(?=.*[a-z])(?=.*[\\W_])(?=.*\\d).*/.test(password);',
          '}',
        ].join('\n'),
      ],
    ],
  },
  M3: {
    label: 'the error boundary no longer classifies request-caused failures',
    expected: /a malformed identifier in a path is 400, not a 500/,
    edits: [
      // The Prisma error code is changed rather than the branch being
      // disabled: `if (false && ...)` defeats TypeScript's narrowing and fails
      // to compile, so the mutant would never reach the gate. Mutating the
      // compared constant is the type-safe way to disarm the same branch.
      [
        'src/common/filters/client-input-errors.ts',
        "const PRISMA_INCONSISTENT_COLUMN_DATA = 'P2023';",
        "const PRISMA_INCONSISTENT_COLUMN_DATA = 'P2023-mutant-disabled';",
      ],
    ],
  },
  M4: {
    label: 'the rate limiter is disarmed outside the test bypass',
    expected: /the rate limiter is enforced in the image/,
    // The budget is raised rather than the branch short-circuited: an
    // `if (true) return true` breaks TypeScript's control-flow narrowing for
    // the rest of the method, so the mutant would fail to compile and the
    // gate would never see it. Raising the budget is also the more realistic
    // regression — a limit "temporarily increased" for debugging.
    edits: [
      ['src/auth/guards/rate-limit.guard.ts', 'private readonly maxAttempts = 10;', 'private readonly maxAttempts = 1000000;'],
    ],
  },
  M5: {
    label: 'the storage file mode regressed to the umask default',
    expected: /Phase 18 0600\/0700 storage modes are still enforced in the image/,
    edits: [
      ['src/storage/storage.service.ts', 'const STORAGE_FILE_MODE = 0o600;', 'const STORAGE_FILE_MODE = 0o644;'],
    ],
  },
  M6: {
    label: 'the API image runs as root',
    expected: /runs as a non-root user/,
    edits: [['Dockerfile', 'USER 1000:1000', 'USER 0:0']],
  },
  M7: {
    label: 'the access-token lifetime bound removed from the guard (Phase 24 D-2)',
    expected: /the access token lifetime is bounded in the image/,
    edits: [
      [
        'src/auth/guards/auth.guard.ts',
        "        algorithms: ['HS256'],\n        maxAge: ACCESS_TOKEN_TTL_SECONDS,\n",
        "        algorithms: ['HS256'],\n",
      ],
    ],
  },
  // Phase 28 (N-12). M4 proves the limiter is ARMED in the image. These
  // three prove the three separate properties the N-12 fix introduced, each
  // of which can regress on its own while the limiter keeps working:
  //   M8  the refusal reverts to 403
  //   M9  the limiter stops refusing at all (refusal path bypassed)
  //   M10 the Retry-After contract is dropped
  M8: {
    label: 'the rate-limit refusal reverts from 429 to 403 (N-12)',
    expected: /the rate limiter is enforced in the image/,
    edits: [
      [
        'src/common/exceptions/rate-limit-exceeded.exception.ts',
        "super('Rate limit exceeded. Try again later.', HttpStatus.TOO_MANY_REQUESTS);",
        "super('Rate limit exceeded. Try again later.', HttpStatus.FORBIDDEN);",
      ],
    ],
  },
  M9: {
    label: 'the rate-limit refusal is bypassed entirely (N-12)',
    expected: /the rate limiter is enforced in the image/,
    edits: [
      [
        'src/auth/guards/rate-limit.guard.ts',
        '      throw new RateLimitExceededException(this.retryAfterSecondsFor(record, now));',
        '      return true;',
      ],
    ],
  },
  M10: {
    label: 'the Retry-After contract is dropped from a 429 (N-12)',
    expected: /the rate limiter is enforced in the image/,
    edits: [
      [
        'src/common/filters/global-exception.filter.ts',
        "      res.setHeader('Retry-After', String(exception.retryAfterSeconds));",
        "      void exception;",
      ],
    ],
  },
  // The converse of M8..M10, and the mutant that a "fix N-12 by widening
  // everything" patch would produce. Without it, a build in which every 4xx
  // became 429 would satisfy M8's check while silently breaking the entire
  // authorization surface.
  //
  // The edit is in the global filter, not in a controller: it is the only
  // place a status is decided for every exception at once, so it is also the
  // only place a plausible over-correction could be introduced.
  M11: {
    label: 'authorization refusals were widened to 429 as well (N-12 over-correction)',
    expected: /authorization refusals in the image are 403, not 429/,
    edits: [
      [
        'src/common/filters/global-exception.filter.ts',
        '      status = exception.getStatus();',
        '      status = exception.getStatus() === 403 ? 429 : exception.getStatus();',
      ],
    ],
  },
};

let failures = 0;
const log = (m) => console.log(m);

// ---------------------------------------------------------------------------
// Phase 24 (D-9) — keep the run inside the disk, without making it fragile.
//
// Phase 23 recorded that this harness filled /var/lib/docker to 100%. The
// cause is structural: every mutant is built with --no-cache, so each build
// writes a complete new layer set and they accumulate.
//
// The obvious fix — prune the build cache between mutants — was implemented
// here and then REMOVED, because it is not free. A --no-cache build reuses no
// *layers* from the previous mutant, but the build cache also holds pnpm's
// package store: pruning it forces every following mutant to re-download
// roughly 660 packages from the registry, which is slow, depends on the
// network, and fails outright when the network is slow or absent. Measured on
// this machine: the mutant build after a prune spent its whole run in
// "resolved 665, downloaded 660" and then failed. Trading a disk-full failure
// for a network-dependent verification harness is a bad trade, and a silent
// one, because the harness would look identical while getting slower and
// flakier.
//
// So the disk floor is advisory and the prune is opt-in:
//   - free space is reported after every mutant, always;
//   - if space is below the floor, the run says so and names the flag;
//   - `--prune-cache` enables the prune for an operator who wants the disk
//     back more than they want the dependency store.
// The peak is not reduced by default. That is a recorded trade-off rather than
// an oversight: the remaining remedies are a larger volume or a smaller
// mutant set, both the operator's call.
// ---------------------------------------------------------------------------
const minFreeArgIndex = process.argv.indexOf('--min-free-gb');
const MIN_FREE_BYTES =
  (minFreeArgIndex >= 0 ? Number(process.argv[minFreeArgIndex + 1]) : 20) * 1024 * 1024 * 1024;
const PRUNE_CACHE = process.argv.includes('--prune-cache');

function freeBytes() {
  const res = spawnSync('df', ['-B1', '--output=avail', '/var/lib/docker'], { encoding: 'utf8' });
  const value = Number((res.stdout ?? '').trim().split('\n').pop());
  return Number.isFinite(value) ? value : null;
}

function gb(bytes) {
  return bytes === null ? 'unknown' : `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

let warnedAboutDisk = false;

/** Report free space, and reclaim the build cache only when explicitly asked. */
function checkDisk(context) {
  const free = freeBytes();
  if (free === null) return null;
  const low = free < MIN_FREE_BYTES;
  if (low && !PRUNE_CACHE && !warnedAboutDisk) {
    warnedAboutDisk = true;
    log(
      `\n  WARNING: free space on /var/lib/docker is ${gb(free)}, below the ${gb(MIN_FREE_BYTES)} floor, and ` +
        '`--prune-cache` was not given. Every --no-cache mutant adds a full layer set, so this run may fill the\n' +
        '           disk. Re-run with --prune-cache to reclaim it — and note that this is NOT free: pruning also\n' +
        "           drops pnpm's package store, so each following mutant re-downloads its dependencies from the\n" +
        '           registry and the run becomes network-dependent.',
    );
  }
  if (low && PRUNE_CACHE) {
    const res = spawnSync('docker', ['builder', 'prune', '-f'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (res.status !== 0) {
      log(`        (${context}: could not prune the build cache: ${(res.stderr || '').trim().split('\n')[0]})`);
    } else {
      const reclaimed = (res.stdout ?? '').match(/Total:?\s*(\S+)/)?.[1] ?? 'an unknown amount';
      log(`        ${context}: free space was ${gb(free)}, below the ${gb(MIN_FREE_BYTES)} floor — pruned the ` +
        `build cache (${reclaimed}). The next mutant will re-download its dependencies.`);
    }
    return freeBytes();
  }
  return free;
}

/**
 * Files currently mutated, so an interrupted run can put them back.
 *
 * Phase 24: the `finally` block restores the tree when the harness exits
 * normally or throws, but not when it is killed — a `finally` does not run on
 * SIGINT/SIGTERM, and each mutant's build is a `spawnSync` that blocks the
 * event loop so no handler would fire mid-build anyway. A killed run was
 * therefore able to leave `USER 0:0` in the Dockerfile, and a later
 * conclusion drawn from that tree would have been about a different codebase.
 * This is the same reason the harness re-runs the gate on the restored tree
 * at the end, applied to interruption.
 */
let activeRestore = null;
function restoreNow(reason) {
  if (!activeRestore) return;
  const pending = activeRestore;
  activeRestore = null;
  log(`\n  restoring the mutated source (${reason}) — leaving a mutant in the tree would invalidate every later result`);
  for (const o of pending) writeFileSync(o.full, o.before);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreNow(signal);
    process.exit(130);
  });
}

async function withMutant(id, spec) {
  const originals = spec.edits.map(([file, from, to]) => {
    const full = path.join(apiRoot, file);
    const before = readFileSync(full, 'utf8');
    if (!before.includes(from)) {
      throw new Error(`could not apply ${id}: the anchor text is not present in ${file}:\n${from.slice(0, 160)}`);
    }
    writeFileSync(full, before.replace(from, to));
    return { full, before };
  });

  const env = { ...process.env, P20_API_IMAGE: `ecc-api:p24-mutant-${id.toLowerCase()}` };
  activeRestore = originals;
  checkDisk(`before ${id}`);
  try {
    // --no-cache: a cached layer from the unmutated source would make the
    // whole exercise meaningless.
    // maxBuffer is load-bearing, not decoration. A cold pnpm store makes the
    // build print per-package download progress, and Node's spawnSync default
    // buffer is 1MB: past that it KILLS the child. The symptom is a buildkit
    // "CANCELED: context canceled" on a perfectly good Dockerfile, which reads
    // exactly like a failed mutant. Observed on this machine once the build
    // cache had been pruned, and not while the store was warm — so it is a
    // function of cache state, which is the worst possible moment for a
    // verification harness to start lying. `build.error` is now reported, so
    // this failure mode is diagnosable instead of looking like a defect in the
    // code under test.
    const build = spawnSync(
      'docker',
      ['build', '--no-cache', '-f', 'apps/api/Dockerfile', '-t', env.P20_API_IMAGE, '.'],
      { cwd: repoRoot, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 },
    );
    if (build.status !== 0) {
      const why = build.error ? ` (spawn error: ${build.error.message})` : '';
      throw new Error(
        `the mutant image failed to build${why}:\n${(build.stderr || build.stdout || '').slice(-2000)}`,
      );
    }

    const run = spawnSync('node', [gate, '--skip-build'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout}${run.stderr}`;
    return { status: run.status, output, freeAfter: freeBytes() };
  } finally {
    for (const o of originals) writeFileSync(o.full, o.before);
    activeRestore = null;
    spawnSync('docker', ['image', 'rm', '-f', env.P20_API_IMAGE], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    // The mutant image is gone; its layers become dangling build cache. They
    // are not reused by the next --no-cache build, so reclaiming them here
    // (subject to the floor) is what keeps the peak to one build's worth.
    checkDisk(`after ${id}`);
  }
}

async function main() {
  log('\nPhase 23 (W7) / Phase 24 (D-9) — mutation test of the container gate\n');
  log('  Each mutant rebuilds the API image with --no-cache and requires the gate to FAIL.\n');
  log(`  Free space is reported per mutant; the floor is ${gb(MIN_FREE_BYTES)} and --prune-cache is ${PRUNE_CACHE ? 'on' : 'off'}.\n`);

  const ids = Object.keys(MUTANTS).filter((id) => !only || only.has(id));
  if (ids.length === 0) {
    log('  no mutants selected');
    return;
  }

  for (const id of ids) {
    const spec = MUTANTS[id];
    try {
      const { status, output, freeAfter } = await withMutant(id, spec);
      if (status === 0) {
        failures += 1;
        log(`  FAIL  ${id}: ${spec.label}`);
        log('        the gate PASSED a build carrying this defect. The check is decorative.');
      } else {
        const detected = spec.expected.test(output);
        const failedChecks = [...output.matchAll(/^  FAIL {2}(.+)$/gm)].map((m) => m[1].trim());
        log(`  PASS  ${id}: ${spec.label}`);
        log(
          detected
            ? `        gate failed, and the expected check is among the failures: ${failedChecks.join('; ') || '(see output)'}`
            : `        gate failed, but not on the check this mutant targets (${spec.expected.source}). ` +
                `Failures were: ${failedChecks.join('; ')}`,
        );
        if (!detected) {
          failures += 1;
          // The gate's own output is printed when a failure cannot be
          // attributed. Without it, "the gate failed" and "the gate failed for
          // a reason that has nothing to do with this mutant" look identical
          // from the outside — which is how a mutant can be reported as
          // inconclusive (or, worse, as a pass) with no way to find out why.
          // An earlier version of this harness swallowed the output and
          // produced exactly that ambiguity.
          log('        --- gate output (tail) ---');
          log(
            output
              .split('\n')
              .slice(-25)
              .map((l) => `        | ${l}`)
              .join('\n'),
          );
        }
      }
      log(`        free space after this mutant: ${gb(freeAfter)}`);
    } catch (err) {
      failures += 1;
      log(`  FAIL  ${id}: ${spec.label}`);
      log(`        ${String(err.message ?? err).split('\n').join('\n        ')}`);
    }
  }

  // The repository must be exactly as we found it, and the gate must pass on
  // it again. Without this, a mutant could leave the tree broken and every
  // later conclusion would be about a different codebase.
  const restored = spawnSync('node', [gate, '--skip-build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (restored.status !== 0) {
    failures += 1;
    log('  FAIL  the gate does not pass on the restored repository');
    log(
      [...`${restored.stdout}${restored.stderr}`.matchAll(/^  FAIL {2}(.+)$/gm)]
        .map((m) => `          ${m[1].trim()}`)
        .join('\n'),
    );
  } else {
    log('  PASS  the gate passes again on the restored repository');
  }

  if (failures > 0) {
    log(`\nFAILED — ${failures} container-gate mutation check(s) did not hold.\n`);
    process.exit(1);
  }
  log('\nThe container gate detects every defect these mutants represent.\n');
}

void main();
