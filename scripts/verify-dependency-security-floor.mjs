#!/usr/bin/env node
/**
 * Phase 36 (P34-1) — the dependency security floor.
 *
 * The problem this exists to make impossible.
 *
 * Phase 33 remediated nine advisories across three transitive packages by
 * adding range-keyed `pnpm.overrides`:
 *
 *     brace-expansion@>=1.0.0 <1.1.21  -> 1.1.21
 *     brace-expansion@>=2.0.0 <2.1.7   -> 2.1.7
 *     undici@<6.28.1                   -> 6.28.1
 *
 * Each target is the highest patch floor across EVERY advisory open against
 * that package, not the floor of the highest-severity one. For `brace-expansion`
 * 1.x the two HIGH advisories are fixed at 1.1.19 and 1.1.20, but a MODERATE
 * advisory is only fixed at 1.1.21; the same holds for the 2.x line.
 *
 * The independent Phase 35 review then demonstrated that the choice of 1.1.21
 * and 2.1.7 — the substantive correction Phase 33 made over Phase 32's
 * quoted 1.1.19/2.1.5 — was protected by NOTHING. In a disposable mirror with
 * the overrides lowered to the high-severity floors:
 *
 *     pnpm audit -> moderate 36 -> 38, high 44 unchanged, critical 4 unchanged
 *     triage-vulnerabilities.mjs     EXIT 0
 *     verify-dependency-audit.mjs    EXIT 0
 *     verify-dependency-triage.mjs   EXIT 0
 *     verify-ci-parity.mjs --list    EXIT 0
 *     verify-config-contract.mjs     EXIT 0
 *
 * The reason is one line, `triage-vulnerabilities.mjs:748`:
 *
 *     .filter((a) => a.severity === 'critical' || a.severity === 'high')
 *
 * Every dependency gate filters to critical and high BEFORE deciding anything,
 * so below that line two known advisories are invisible. The floors existed
 * only as a YAML comment in `pnpm-workspace.yaml`:
 *
 *     $ grep -rn '1\.1\.21|2\.1\.7|6\.28\.1' scripts/ .github/
 *     (no matches)
 *
 * A maintainer who reads the high-severity floors — or Phase 32's 1.1.19/2.1.5 —
 * and "simplifies" the override obtains green CI with the advisories Phase 33
 * deliberately fixed back in the graph, and nothing objects.
 *
 * What this control asserts, and why it is a floor rather than a pin.
 *
 * The invariant is:
 *
 *   CI must not become green merely because the security remediation was
 *   silently lowered to a version that reintroduces a known advisory.
 *
 * For every floor below, EVERY resolved instance of the package in the lockfile
 * must be at or above the floor. That deliberately admits:
 *
 *   - a legitimate upgrade   — 1.1.21 -> 1.1.22 passes, forever, with no
 *     edit to this file. The floor is a MINIMUM, not an expected version.
 *   - a major-version change  — each floor declares the major(s) it governs, so
 *     `brace-expansion@3.x` is not measured against the 1.x floor. A new major
 *     is a separate decision and is reported as REVIEW, not as pass or fail.
 *   - a package removed      — if no instance of the package exists in the
 *     resolved graph at all, the advisory it carried is gone with it. Reported
 *     as REMOVED, which is a legitimate end state and must not read as a pass
 *     by omission.
 *
 * The authoritative source is the RESOLVED GRAPH in `pnpm-lock.yaml`, not
 * `pnpm-workspace.yaml`. Reading the override declaration would be reading the
 * intention; the lockfile records what will actually be installed, and it is
 * the lockfile that a frozen-lockfile CI install consumes. A `pnpm-workspace.yaml`
 * that declares the right override while the lockfile still resolves the
 * vulnerable version — a stale lockfile, a hand edit, a partially applied
 * install — is exactly the drift this must catch, and it is invisible to a
 * check that reads the declaration.
 *
 * `pnpm-lock.yaml` is parsed with the `yaml` package already in the dependency
 * graph, from the same resolution strategy `verify-ci-parity.mjs` uses, rather
 * than by a text match. The graph is walked through `snapshots:`, which is
 * where pnpm records each resolved package's resolved dependencies — so
 * "is this package actually installed and reachable" is answered from the
 * graph, not from the presence of a key.
 *
 * This control does NOT suppress an advisory, add an audit ignore, downgrade a
 * severity, add `continue-on-error`, weaken triage, classify a reachable
 * vulnerability as unreachable, or pin any package outside the floors below.
 * It adds a check. When a floor is breached it fails CI.
 *
 * Usage:  node scripts/verify-dependency-security-floor.mjs [--json]
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockfilePath = path.join(repoRoot, 'pnpm-lock.yaml');
const asJson = process.argv.includes('--json');

/**
 * The floors. Each entry names the majors it governs and the minimum version
 * within them.
 *
 * A floor is recorded here, in prose that states the advisory it came from,
 * rather than as a bare number. `minimum: '1.1.21'` with no explanation is a
 * version pin that the next reader cannot evaluate; the `why` is what makes
 * lowering it a decision someone has to argue for rather than a typo someone
 * can make.
 *
 * `majors` is what makes a major bump a REVIEW rather than a failure. Guessing
 * at a floor for an unfamiliar major would either produce a false failure (a
 * new major legitimately below the old floor's number) or, worse, a false pass
 * (a new major that is itself vulnerable). Reporting REVIEW forces a human to
 * look, which is the honest answer for something this script cannot know.
 */
const FLOORS = [
  {
    package: 'brace-expansion',
    majors: ['1'],
    minimum: '1.1.21',
    why:
      'advisories 1240108 (high, <1.1.19), 1240104 (high, <1.1.20) and 1240100 (MODERATE, <1.1.21). ' +
      'Phase 33 set this to 1.1.21 rather than the high-severity floor of 1.1.19/1.1.20 precisely because ' +
      '1240100 is only fixed at 1.1.21 — and Phase 35 demonstrated that every gate passes with 1240100 present.',
    reachedVia: 'minimatch@3 (requests ^1.1.7) — via eslint, @nestjs/cli, @expo/cli',
  },
  {
    package: 'brace-expansion',
    majors: ['2'],
    minimum: '2.1.7',
    why:
      'advisories 1240109 (high, <2.1.5), 1240105 (high, <2.1.6) and 1240101 (MODERATE, >=2.0.0 <2.1.7). ' +
      'Same structure as the 1.x line: the moderate advisory sets the binding floor.',
    reachedVia: 'minimatch@9 (requests ^2.0.2) — via glob',
  },
  {
    package: 'undici',
    majors: ['6'],
    minimum: '6.28.1',
    why:
      'advisories 1240042 (high, >=6.7.0 <6.28.1), 1239934 (moderate) and 1240039 (low). ' +
      'This floor is already enforced by the critical/high triage gate, so it is a defence in depth against ' +
      'that gate being narrowed rather than a gap it closes today.',
    reachedVia: '@remix-run/node (requests ^6.21.2) — via @expo/server -> expo-router -> @ecc/mobile',
  },
];

// ---------------------------------------------------------------------------
// Parse the lockfile with the `yaml` package already in the graph
// ---------------------------------------------------------------------------
function loadYaml() {
  const require_ = createRequire(import.meta.url);
  const candidates = [
    'yaml',
    ...(existsSync(path.join(repoRoot, 'node_modules/.pnpm'))
      ? readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
          .filter((d) => d.startsWith('yaml@'))
          .map((d) => path.join(repoRoot, 'node_modules/.pnpm', d, 'node_modules/yaml'))
      : []),
  ];
  for (const c of candidates) {
    try {
      return require_(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('could not load the `yaml` parser from the dependency graph');
}

const results = [];
let failures = 0;
function record(entry) {
  results.push(entry);
  if (entry.verdict === 'BREACH') failures += 1;
}

/**
 * Compare two dotted versions. Returns <0, 0, >0. Deliberately small and
 * deliberately total: an unparseable version must compare as "unknown" so the
 * caller reports it rather than silently treating it as compliant.
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10));
  const pb = String(b).split('.').map((x) => parseInt(x, 10));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Every `name@version` the resolved graph actually contains. */
function resolvedInstances(snapshots, pkgName) {
  const found = [];
  for (const key of Object.keys(snapshots ?? {})) {
    // pnpm keys are `name@version`, with the last `@` separating the two —
    // `@scope/name@1.2.3` included, which is why a naive split on the first
    // `@` would drop every scoped package.
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    if (key.slice(0, at) !== pkgName) continue;
    found.push({ key, version: key.slice(at + 1) });
  }
  return found;
}

function run() {
  if (!existsSync(lockfilePath)) {
    console.error(
      'FAILED — no pnpm-lock.yaml. This control reads the resolved dependency graph, which is the only ' +
        'authoritative statement of what a frozen-lockfile install will actually produce.\n',
    );
    process.exit(1);
  }

  const YAML = loadYaml();
  const lock = YAML.parse(readFileSync(lockfilePath, 'utf8'));
  const snapshots = lock.snapshots ?? lock.packages ?? {};

  if (Object.keys(snapshots).length === 0) {
    console.error(
      'FAILED — pnpm-lock.yaml has no `snapshots:` or `packages:` section. This control asserts against the ' +
        'RESOLVED GRAPH; an unreadable graph cannot be asserted compliant.\n',
    );
    process.exit(1);
  }

  for (const floor of FLOORS) {
    const instances = resolvedInstances(snapshots, floor.package);

    // --- legitimately gone
    if (instances.length === 0) {
      record({
        floor: `${floor.package}@${floor.minimum}`,
        verdict: 'REMOVED',
        detail:
          `\`${floor.package}\` does not appear in the resolved graph at all. The advisories it carried are gone ` +
          'with it. This is a legitimate end state and is NOT counted as a pass by omission — it is recorded ' +
          'here so a reviewer can see the dependency disappeared rather than assume it was always absent.',
      });
      continue;
    }

    // Only instances whose major THIS floor governs are measured against it.
    // The other line of the same package (brace-expansion 1.x vs 2.x) is
    // governed by its own floor, so reporting it here as "needing review" would
    // be noise that trains a reader to ignore this line.
    //
    // What is deliberately NOT skipped: a major that NO floor for this package
    // governs. That one reaches `ungovernedMajor` below.
    const mine = instances.filter((inst) => floor.majors.includes(inst.version.split('.')[0]));
    if (mine.length === 0) continue;

    for (const inst of mine) {
      // --- the case this control exists for
      const cmp = compareVersions(inst.version, floor.minimum);
      if (cmp === null) {
        record({
          floor: `${floor.package}@${floor.minimum}`,
          verdict: 'BREACH',
          detail:
            `the graph resolves \`${inst.key}\`, whose version could not be compared with the floor ` +
            `(${floor.minimum}). An unparseable version is not a compliant one.`,
        });
        continue;
      }
      if (cmp < 0) {
        record({
          floor: `${floor.package}@${floor.minimum}`,
          verdict: 'BREACH',
          detail:
            `the graph resolves \`${inst.key}\`, which is BELOW the floor ${floor.package}@${floor.minimum}. ` +
            `${floor.why}\n` +
            `  Reached via: ${floor.reachedVia}.\n` +
            '  The override that should prevent this is in pnpm-workspace.yaml, but this control reads the ' +
            'RESOLVED GRAPH: if the override is right and the lockfile is wrong, the fix is to reinstall so ' +
            'the lockfile is regenerated — not to relax the floor. Lowering the floor reintroduces a known ' +
            'advisory and is exactly the silent regression this gate is here to stop.',
        });
        continue;
      }

      record({
        floor: `${floor.package}@${floor.minimum}`,
        verdict: 'OK',
        detail: `the graph resolves \`${inst.key}\`, at or above the floor ${floor.package}@${floor.minimum}.`,
      });
    }
  }

  // --- majors no floor governs, checked once per package
  for (const pkg of [...new Set(FLOORS.map((f) => f.package))]) {
    const governed = FLOORS.filter((f) => f.package === pkg).flatMap((f) => f.majors);
    for (const inst of resolvedInstances(snapshots, pkg)) {
      const major = inst.version.split('.')[0];
      if (governed.includes(major)) continue;
      record({
        floor: `${pkg} (no floor for major ${major})`,
        verdict: 'REVIEW',
        detail:
          `the graph resolves \`${inst.key}\`, whose major (${major}) is not governed by any recorded floor for ` +
          `\`${pkg}\` (floors exist for: ${governed.join(', ')}). A new major cannot be measured against a floor ` +
          'written for another one: guessing would either fail a legitimate upgrade or, worse, pass a vulnerable ' +
          'one. Re-derive the floor for this major from the advisory database and add it to FLOORS in this file.',
      });
    }
  }

  report(lock);
}

function report(lock) {
  if (asJson) {
    console.log(JSON.stringify({ results, failures }, null, 2));
    process.exit(failures > 0 ? 1 : 0);
  }

  console.log('\nPhase 36 (P34-1) — dependency security floor\n');
  console.log('  source            : pnpm-lock.yaml (resolved graph, not the override declaration)');
  console.log('  lockfileVersion   :', lock.lockfileVersion ?? '(unrecorded)');
  console.log('  overrides declared:', Object.keys(lock.overrides ?? {}).length);
  console.log(`  floors asserted   : ${FLOORS.length}\n`);

  for (const r of results) {
    const mark = r.verdict === 'BREACH' ? 'BREACH' : r.verdict;
    console.log(`    [${mark.padEnd(7)}] ${r.floor}`);
    console.log(`               ${r.detail.replace(/\n/g, '\n               ')}`);
  }

  const counts = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  console.log(
    `\n  ${results.length} instance(s) checked: ${counts.OK ?? 0} at or above floor, ${counts.BREACH ?? 0} below, ` +
      `${counts.REVIEW ?? 0} needing review, ${counts.REMOVED ?? 0} no longer present.\n`,
  );

  if (failures > 0) {
    console.error(
      `FAILED — ${failures} resolved dependency instance(s) are below the recorded security floor.\n` +
        'CI must not become green because the remediation was lowered to a version that reintroduces a known\n' +
        'advisory. Fix the override and reinstall, or re-derive the floor from the advisory database and\n' +
        'justify it in this file.\n',
    );
    process.exit(1);
  }

  console.log(
    'PASSED — no resolved dependency instance is below its recorded security floor. Higher versions and new\n' +
      'majors are admitted; only a version below the floor is a failure.\n',
  );
  process.exit(0);
}

run();
