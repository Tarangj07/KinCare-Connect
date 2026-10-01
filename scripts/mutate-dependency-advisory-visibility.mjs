#!/usr/bin/env node
/**
 * Phase 39 (F-39-01) — mutation test of the advisory-visibility control.
 *
 * `scripts/verify-dependency-advisory-visibility.mjs` exists because 44 of this
 * repository's 92 advisories reached no gate: `pnpm audit` is invoked with
 * `--audit-level=high` (so the JSON is already truncated) and triage then
 * filters to critical-or-high. The advisories this repository deliberately
 * remediated in Phase 33 (1240100, 1240101) are BOTH moderate, so the exact
 * vulnerabilities the security floor exists to exclude were invisible to the
 * machinery meant to notice their return.
 *
 * A control that has never been shown to fail might not work, so each mutant
 * below attacks one specific way this one could stop protecting anything.
 *
 * ## The four outcomes, kept distinct
 *
 *   `detected`  the gate reported a NAMED finding for the intended reason
 *   `pass`      a legitimate state the control must NOT flag (positive control)
 *   `setup`     the run failed for an unrelated reason -> DISCARDED, never a detection
 *   `escape`    the gate passed something it should have rejected
 *
 * Setup failures are hunted explicitly by signature. A control that reports
 * "detected" because a child process could not start is worse than no control,
 * because it converts a broken environment into a security claim.
 *
 * ## Why the harness mutates an AUDIT FIXTURE rather than the graph
 *
 * The property under test is "an advisory exists against a floored package".
 * That is a statement about two inputs — the advisory set and the floor policy
 * — and neither requires an install to vary. `pnpm audit --json` is a document;
 * `--audit-file` hands it to the gate. Mutating the document is therefore both
 * sufficient and far more reliable than regenerating a lockfile, and it means
 * the real `pnpm-lock.yaml` is never touched.
 *
 * The one mutant that MUST vary the real graph (M-GRAPH) is verified to fail
 * for the intended reason by asserting on the gate's output text, and its
 * fixture is the audit report captured from the reproduced R36-03 graph.
 *
 * ## Phase 41 (F-40-02, F-40-01) — mutating the SOURCE, and proving the report is unfiltered
 *
 * The Phase 40 review found two defects in this harness's coverage claim, and both
 * are addressed here rather than argued away.
 *
 * **F-40-02 — this harness previously mutated NOTHING in the gate's own source.**
 * Every Phase 39 mutant varied the advisory FIXTURE, the floor POLICY or the
 * WORKFLOW. The gate file was copied into each mirror and then never touched, so
 * every code path that decides the property under test — the severity handling of
 * the assertion, the package comparison, the completeness contract — was untested.
 * Worse, the gate's own docstring claimed M-LOW proved protection against
 * narrowing `BELOW_THRESHOLD_SEVERITIES`. Phase 40 showed that claim is false: the
 * assertion does not depend on that constant, so narrowing it changes nothing.
 *
 * The `M41-SRC-*` mutants below now write to `scripts/verify-dependency-advisory-visibility.mjs`
 * in the mirror. The architecture already supported it — `makeMirror()` copies
 * `scripts/`, the change-signal already watched the gate, and `isParseableJs()`
 * already existed to reject unparseable mutants. The machinery was there and
 * unused. **A mutation that does not write the target source is not evidence about
 * the target source**, and the harness now records which mutants did so.
 *
 * **F-40-01 — a partial severity filter used to pass as a "full advisory set".**
 * Phase 41 added a completeness contract: the advisory records are reconciled
 * tier-by-tier against `metadata.vulnerabilities`, the registry severity census
 * that pnpm emits alongside the records and that `--audit-level` does not touch.
 * The `M41-FILTER-*` mutants below feed the gate GENUINE reports captured from
 * real `pnpm audit --audit-level=...` invocations — not hand-written fakes — so
 * the filter detection is proved against real tool output rather than against a
 * fixture shaped to suit the assertion.
 *
 * One consequence for fixture-based mutants: a synthetic advisory injected into a
 * report makes that report INCOHERENT unless the census is raised to match, and the
 * new contract will (correctly) reject the incoherent report for the wrong reason.
 * `injectAdvisory()` therefore raises the census alongside the record, so every
 * fixture-based mutant still exercises the property it was written for rather than
 * tripping the completeness check first.
 *
 * ## Phase 43 (P42-01, P42-02) — the DEPENDENCY-SCOPE filter class
 *
 * The Phase 42 review (P42-01) reproduced a silent pass that this campaign was
 * structurally unable to catch, because every mutant above varies SEVERITY.
 *
 *     pnpm audit --json   -> 92 records; census 92; metadata.totalDependencies 1494
 *     pnpm audit --dev    -> 22 records; census 22; metadata.totalDependencies 1022
 *     pnpm audit --prod   -> 77 records; census 77; metadata.totalDependencies 1111
 *
 * A scope filter reduces the PACKAGES submitted to the registry rather than the
 * advisories reported, so the census shrinks in the same proportion and the report
 * stays internally consistent. The census reconciliation is therefore SATISFIED by
 * the bypass, and the Phase 41 argv self-check is satisfied too because no severity
 * flag is present. Phase 42 demonstrated the consequence on a real graph: with the
 * prod-only `undici` floored package reverted to a vulnerable version, `--dev`
 * returned a report in which that package did not appear at all, and this gate
 * printed that the set had been "proven UNFILTERED".
 *
 * The `M43-SCOPE-*` mutants feed GENUINE scope-filtered reports captured from the
 * real package manager. They are captured rather than written by hand because the
 * defining property of the bypass is that it is internally coherent, which is
 * exactly the property a hand-written fake would get wrong.
 *
 * The `M43-SRC-*` mutants prove the two new defences are load-bearing, and their
 * POLARITIES DIFFER, which is the point:
 *
 *   - `M43-SRC-POPULATION-OFF` is `weaken`: disabling the population check must
 *     make the gate ACCEPT the same genuine `--dev` report the real control
 *     rejects. Exit 0 is the proof that the check is load-bearing.
 *   - `M43-SRC-CANONICAL-OFF-POPULATION-CATCHES` carries the DEFAULT polarity
 *     (must REJECT): silencing the argv check must NOT let a scoped audit through,
 *     because the population check is an independent witness. Scoring this as
 *     `weaken` would report a working second layer as a defect.
 *   - `M43-SRC-BOTH-SCOPE-GUARDS-OFF` is `weaken`, and needs BOTH guards removed
 *     for the same reason `M41-SRC-CENSUS-ABSENT-OK` needed both census guards:
 *     a single removal is INEFFECTIVE, and the harness reports that honestly
 *     rather than counting it as evidence.
 *
 * ## Outcomes, kept distinct
 *
 *   `detected`  the gate reported a NAMED finding for the intended reason
 *   `pass`      a legitimate state the control must NOT flag (positive control)
 *   `setup`     the run failed for an unrelated reason -> DISCARDED, never a detection
 *   `escape`    the gate passed something it should have rejected
 *
 * The four outcomes are never merged. A mutant whose mutant SOURCE fails to parse
 * is discarded by `isParseableJs()` before it can be scored, so a syntax error can
 * never be reported as a security detection.
 *
 * Usage:  node scripts/mutate-dependency-advisory-visibility.mjs [--only M1,M2] [--keep]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The `yaml` parser, resolved from the dependency graph exactly as
 * `verify-ci-parity.mjs` resolves it — the parity contract is what proves a
 * gate is still wired in, so testing a different parse than it performs would
 * prove nothing about it.
 */
/**
 * The `yaml` parser, resolved from the dependency graph exactly as
 * `verify-ci-parity.mjs` resolves it — the parity contract is what proves a
 * gate is still wired in, so testing a different parse than it performs would
 * prove nothing about it.
 */
const YAML = createRequire(import.meta.url)(
  path.join(repoRoot, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'),
);

const gateRel = path.join('scripts', 'verify-dependency-advisory-visibility.mjs');
const policyRel = path.join('security', 'dependency-security-floor.json');
const lockRel = 'pnpm-lock.yaml';
const workflowRel = path.join('.github', 'workflows', 'ci.yml');
const parityRel = path.join('scripts', 'verify-ci-parity.mjs');

const only = process.argv.includes('--only')
  ? new Set((process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()))
  : null;
const keepMirrors = process.argv.includes('--keep');

const log = (m) => console.log(m);
const createdMirrors = [];

/**
 * The real advisory set, captured once, and then varied.
 *
 * Captured from the live `pnpm audit --json` at harness start so the CONTROL is
 * the repository's real state rather than a fixture. If the live audit fails,
 * the harness stops with SETUP FAILURE and scores nothing — an unreachable
 * advisory feed is not a detection of anything.
 */
function captureLiveAudit() {
  const res = spawnSync('pnpm', ['audit', '--json'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
  if (!res.stdout?.trim()) throw new Error(`could not capture a live audit report: exit=${res.status}`);
  const parsed = JSON.parse(res.stdout);
  if (!parsed.advisories || Object.keys(parsed.advisories).length === 0) {
    throw new Error('the live audit report carried no advisories; the control under test would be untestable');
  }
  return parsed;
}

let LIVE_AUDIT;
try {
  LIVE_AUDIT = captureLiveAudit();
} catch (err) {
  log(`  SETUP FAILURE — ${err.message}`);
  log('  No mutation was applied and no result is scored. An advisory feed that cannot be read is not a');
  log('  security finding, and a harness that cannot reach its gate proves nothing.');
  process.exit(2);
}

/**
 * Phase 41: capture a GENUINE severity-filtered report from the real package
 * manager, so filter detection is proved against real tool output.
 *
 * These are not fakes. `pnpm audit --audit-level=high --json` produces a report
 * whose `advisories` map is truncated while its `metadata.vulnerabilities` census
 * stays complete — which is exactly the shape the completeness contract exists to
 * detect, and exactly the shape a hand-written fixture would be unlikely to get
 * right.
 */
function captureFilteredAudit(level) {
  const res = spawnSync('pnpm', ['audit', `--audit-level=${level}`, '--json'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
  if (!res.stdout?.trim()) throw new Error(`could not capture a --audit-level=${level} report: exit=${res.status}`);
  const parsed = JSON.parse(res.stdout);
  const records = Object.keys(parsed.advisories ?? {}).length;
  const census = Object.values(parsed.metadata?.vulnerabilities ?? {}).reduce((a, b) => a + b, 0);
  if (records >= census) {
    throw new Error(
      `the --audit-level=${level} report carries ${records} records against a census of ${census}; a ` +
        'truncated report is required for this fixture to mean anything',
    );
  }
  return parsed;
}

/** A genuine filtered report, captured once. */
let FILTERED_AUDIT;
try {
  FILTERED_AUDIT = captureFilteredAudit('high');
} catch (err) {
  log(`  SETUP FAILURE — ${err.message}`);
  log('  The filter-detection mutants cannot be scored without a genuinely filtered report. A fabricated');
  log('  stand-in would prove only that the gate agrees with whoever wrote the fake.');
  process.exit(2);
}
const FILTERED_RECORDS = Object.keys(FILTERED_AUDIT.advisories).length;
const FILTERED_CENSUS = Object.values(FILTERED_AUDIT.metadata.vulnerabilities).reduce((a, b) => a + b, 0);
const FILTERED_FIXTURE = JSON.stringify(FILTERED_AUDIT, null, 2);

/** A second GENUINE filtered report, one tier shallower — the partial filter F-40-01 turned out to be blind to. */
let FILTERED_MODERATE_AUDIT;
try {
  FILTERED_MODERATE_AUDIT = captureFilteredAudit('moderate');
} catch (err) {
  log(`  SETUP FAILURE — ${err.message}`);
  log('  The partial-filter mutant cannot be scored without a genuinely partial report. This is the exact');
  log('  shape F-40-01 was blind to, so a fabricated stand-in would defeat the point of testing it.');
  process.exit(2);
}
const FILTERED_MODERATE_RECORDS = Object.keys(FILTERED_MODERATE_AUDIT.advisories).length;
const FILTERED_MODERATE_FIXTURE = JSON.stringify(FILTERED_MODERATE_AUDIT, null, 2);

/**
 * Phase 43 (P42-02): capture GENUINE DEPENDENCY-SCOPE-filtered reports.
 *
 * The Phase 42 review (P42-01) reproduced a silent pass that no mutant in this
 * harness could have caught, because every mutant here varied SEVERITY. These
 * reports are produced the same way the severity ones are — by running the real
 * package manager — and they are the exact shape of the bypass:
 *
 *     pnpm audit --json    -> 92 records; census 92; metadata.totalDependencies 1494
 *     pnpm audit --dev     -> 22 records; census 22; metadata.totalDependencies 1022
 *     pnpm audit --prod    -> 77 records; census 77; metadata.totalDependencies 1111
 *
 * Every one of those reports is internally CONSISTENT. The census agrees with the
 * records, so the Phase 41 census reconciliation passes it, and the Phase 41 argv
 * self-check passes it because no severity flag is present. A hand-written fake
 * would almost certainly have got that coherence wrong, which is exactly why
 * these are captured rather than constructed.
 */
function captureScopeFilteredAudit(flag) {
  const res = spawnSync('pnpm', ['audit', flag, '--json'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
  if (!res.stdout?.trim()) throw new Error(`could not capture a \`${flag}\` report: exit=${res.status}`);
  const parsed = JSON.parse(res.stdout);
  const records = Object.keys(parsed.advisories ?? {}).length;
  // The signature of a scope-reduced report: FEWER dependencies were submitted,
  // while the census stays consistent with the (smaller) record set. If this
  // fixture is not actually reduced the mutant would degenerate into a no-op, so
  // the harness refuses it.
  if (typeof parsed?.metadata?.totalDependencies !== 'number') {
    throw new Error(`the \`${flag}\` report carried no metadata.totalDependencies; nothing to test against`);
  }
  return parsed;
}

/**
 * The lockfile's own package count, read exactly as the gate reads it.
 *
 * The mutants below assert that a scope-reduced report really did submit fewer
 * packages than the resolved graph contains, so a mutant cannot quietly stop
 * testing anything if pnpm's accounting ever changes shape.
 */
const LOCKFILE_PACKAGE_COUNT = (() => {
  const lock = YAML.parse(readFileSync(path.join(repoRoot, lockRel), 'utf8'));
  const packages = lock?.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error(`${lockRel} carries no readable \`packages\` section`);
  }
  return Object.keys(packages).length;
})();

const SCOPE_REPORTS = {};
for (const flag of ['--dev', '--prod', '--no-optional', '--optional']) {
  try {
    const parsed = captureScopeFilteredAudit(flag);
    SCOPE_REPORTS[flag] = {
      doc: parsed,
      fixture: JSON.stringify(parsed, null, 2),
      records: Object.keys(parsed.advisories ?? {}).length,
      census: Object.values(parsed.metadata?.vulnerabilities ?? {}).reduce((a, b) => a + b, 0),
      totalDependencies: parsed.metadata.totalDependencies,
      reduced: parsed.metadata.totalDependencies !== LOCKFILE_PACKAGE_COUNT,
    };
  } catch (err) {
    log(`  SETUP FAILURE — ${err.message}`);
    log('  The scope-filter mutants cannot be scored without a genuinely scope-reduced report.');
    log('  A fabricated stand-in would prove only that the gate agrees with whoever wrote the fake.');
    process.exit(2);
  }
}
if (!SCOPE_REPORTS['--dev'].reduced || !SCOPE_REPORTS['--prod'].reduced) {
  log('  SETUP FAILURE — `--dev`/`--prod` did not reduce the submitted population on this repository, so the');
  log('  P42-01 mutant would prove nothing. The gate under test would be unchallenged.');
  process.exit(2);
}

/**
 * Phase 41: inject an advisory into a fixture AND raise the census to match.
 *
 * Without the census bump the fixture becomes incoherent, and the new completeness
 * contract would reject it for the wrong reason — the mutant would "pass" while
 * testing nothing it claimed to test. Keeping the report coherent is what makes a
 * fixture-based mutant still exercise the floor assertion it was written for.
 */
function injectAdvisory(audit, { id, module_name, severity, vulnerable_versions, patched_versions, title }) {
  audit.advisories[id] = {
    module_name,
    severity,
    title: title ?? `synthetic: ${module_name} ${severity} advisory`,
    vulnerable_versions: vulnerable_versions ?? '<1',
    patched_versions: patched_versions ?? '>=1',
    findings: [],
  };
  audit.metadata ??= {};
  audit.metadata.vulnerabilities ??= { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  audit.metadata.vulnerabilities[severity] = (audit.metadata.vulnerabilities[severity] ?? 0) + 1;
  return audit;
}

function makeMirror() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p39-visibility-'));
  createdMirrors.push(root);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'security'), { recursive: true });
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  cpSync(path.join(repoRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, 'security'), path.join(root, 'security'), { recursive: true });
  cpSync(path.join(repoRoot, workflowRel), path.join(root, workflowRel));
  cpSync(path.join(repoRoot, parityRel), path.join(root, parityRel));
  cpSync(path.join(repoRoot, lockRel), path.join(root, lockRel));
  // The parity contract resolves every package.json a workflow step filters on,
  // and one required gate lives under apps/api/scripts.
  for (const pkg of ['api', 'web', 'mobile']) {
    mkdirSync(path.join(root, 'apps', pkg), { recursive: true });
    cpSync(path.join(repoRoot, 'apps', pkg, 'package.json'), path.join(root, 'apps', pkg, 'package.json'));
  }
  mkdirSync(path.join(root, 'apps', 'api', 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, 'apps', 'api', 'scripts'), path.join(root, 'apps', 'api', 'scripts'), { recursive: true });
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
}

const readMirror = (root, rel) => readFileSync(path.join(root, rel), 'utf8');
const writeMirror = (root, rel, content) => writeFileSync(path.join(root, rel), content);

/**
 * Phase 41: rewrite the gate's SOURCE in the mirror.
 *
 * Every anchor must occur EXACTLY ONCE. A replacement that matched two places
 * would produce a mutant whose behaviour is not the one the label claims, and a
 * replacement that matched none would silently leave the gate unmutated — both
 * are worse than a failure, so both throw and the mutant is discarded upstream.
 */
function mutateGate(root, replacements) {
  let src = readMirror(root, gateRel);
  for (const [from, to] of replacements) {
    const occurrences = src.split(from).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `gate anchor must occur exactly once, found ${occurrences}: ${JSON.stringify(from.slice(0, 80))}`,
      );
    }
    src = src.replace(from, to);
  }
  writeMirror(root, gateRel, src);
  return src;
}

/** Write a varied audit fixture into the mirror and return its path. */
function writeAuditFixture(root, mutate) {
  const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
  mutate(audit);
  const rel = path.join(root, 'audit-fixture.json');
  writeFileSync(rel, JSON.stringify(audit, null, 2));
  return rel;
}

/** The UNMUTATED serialisation of a fixture, which is what a change is judged against. */
const PRISTINE_FIXTURE = JSON.stringify(LIVE_AUDIT, null, 2);

function editPolicy(root, fn) {
  const p = JSON.parse(readMirror(root, policyRel));
  fn(p);
  writeMirror(root, policyRel, `${JSON.stringify(p, null, 2)}\n`);
}

/**
 * Phase 41 HARNESS DEFECT (disclosed, fixed): the child environment was
 * `{ CI: '1', FORCE_COLOR: '0' }`, which REPLACES the whole environment and so
 * drops PATH. Fixture runs never noticed, because `--audit-file` spawns nothing.
 * A LIVE run spawns `pnpm`, and with no PATH it failed ENOENT — which the harness
 * correctly classified as a SETUP failure and discarded, so no false detection
 * was scored. But the mutant proved nothing. The environment now inherits
 * process.env and only overrides what it means to.
 */
const LIVE_ENV = { ...process.env, CI: '1', FORCE_COLOR: '0' };

function runGate(root, auditFixture) {
  const args = [path.join(root, gateRel)];
  // A live run exercises the gate's OWN `pnpm audit` invocation, which is the
  // only way to test the argv constant and the spawn path. A fixture run
  // bypasses both, so a mutant that only makes sense against the live path must
  // declare `live: true` rather than quietly testing nothing.
  if (!auditFixture) {
    const res = spawnSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', timeout: 600_000, env: LIVE_ENV,
    });
    return { status: res.status, text: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
  }
  args.push('--audit-file', auditFixture);
  const res = spawnSync(process.execPath, args, {
    cwd: root, encoding: 'utf8', timeout: 180_000, env: LIVE_ENV,
  });
  return { status: res.status, text: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

/** Run the parity contract — what proves a gate is still wired into CI. */
function runParity(root) {
  const res = spawnSync(process.execPath, [path.join(root, parityRel), '--list'], {
    cwd: root, encoding: 'utf8', timeout: 300_000, env: LIVE_ENV,
  });
  return { status: res.status, text: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

const SETUP_SIGNATURES = [
  'SyntaxError', 'MODULE_NOT_FOUND', 'Cannot find module', 'ERR_MODULE_NOT_FOUND',
  'ENOENT', 'is not a function', 'Cannot read propert', 'YAMLParseError', 'JSONParseError',
];
const setupSignature = (t) => SETUP_SIGNATURES.find((s) => t.includes(s)) ?? null;

function isParseableJs(file) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 60_000 });
  return res.status === 0 ? { ok: true } : { ok: false, reason: (res.stderr ?? '').split('\n').slice(0, 4).join(' | ') };
}

const realFloored = JSON.parse(readFileSync(path.join(repoRoot, policyRel), 'utf8'))
  .floors.map((f) => f.package);

const MUTANTS = [
  {
    id: 'M-MOD',
    label: 'a MODERATE advisory appears against a floored package (the R36-03 condition)',
    // The headline mutant. 1240100 is exactly this: moderate, brace-expansion,
    // and the reason the floor is 1.1.21 rather than the high-severity 1.1.19.
    // Before this gate it was invisible to every gate in the repository.
    expected: 'fail',
    mustMention: ['1240100', 'brace-expansion'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1240100',
          module_name: 'brace-expansion',
          severity: 'moderate',
          title: 'synthetic: brace-expansion moderate advisory',
          vulnerable_versions: '<1.1.21',
          patched_versions: '>=1.1.21',
        });
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'injected advisory 1240100 (moderate) against brace-expansion' };
    },
  },
  {
    id: 'M-LOW',
    label: 'a LOW advisory appears against a floored package',
    // Proves the gate is not merely "also checks moderate". A low advisory is
    // below both filters, so a gate that only widened the threshold by one
    // level would miss this.
    expected: 'fail',
    mustMention: ['undici'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1999001', module_name: 'undici', severity: 'low',
          title: 'synthetic: undici low advisory',
          vulnerable_versions: '<6.28.2', patched_versions: '>=6.28.2',
        });
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'injected advisory 1999001 (low) against undici' };
    },
  },
  {
    id: 'M-CRIT',
    label: 'a CRITICAL advisory appears against a floored package',
    // The positive-direction control on the OTHER end of the range: a gate that
    // only widened the threshold downward would still need to catch this.
    expected: 'fail',
    mustMention: ['brace-expansion'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1999002', module_name: 'brace-expansion', severity: 'critical',
          title: 'synthetic: brace-expansion critical advisory',
          vulnerable_versions: '<1.1.22', patched_versions: '>=1.1.22',
        });
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'injected advisory 1999002 (critical) against brace-expansion' };
    },
  },
  {
    id: 'M-UNDICI',
    label: 'a moderate advisory appears against the SECOND floored package (undici)',
    // Proves the gate is not keyed to whichever package happens to be first.
    expected: 'fail',
    mustMention: ['undici'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1999003', module_name: 'undici', severity: 'moderate',
          title: 'synthetic: undici moderate advisory',
          vulnerable_versions: '<6.29.0', patched_versions: '>=6.29.0',
        });
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'injected advisory 1999003 (moderate) against undici' };
    },
  },
  {
    id: 'M-EMPTY',
    label: 'the advisory report comes back EMPTY (a filter was reintroduced)',
    // The meta-mutant. If `--audit-level=high` is ever restored to this
    // gate's own audit invocation, or the feed returns nothing, the report is
    // empty. An empty report must be a FAILURE: it is indistinguishable from a
    // clean bill of health, and treating it as success is the original defect.
    //
    // Phase 43: `totalDependencies` now states the lockfile's own package count,
    // so this report is INTERNALLY COORDINATE — it claims the whole graph was
    // audited and that it carries no advisory. That is what makes it the honest
    // adversarial input for this check: without the figure the Phase 43
    // population check would reject it first and this mutant would stop testing
    // the empty-report branch at all. M41-SRC-EMPTY-TOLERATED is its paired
    // source mutant and is fed the byte-identical document.
    expected: 'fail',
    mustMention: ['not empty', 'zero advisories'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        a.advisories = {};
        a.metadata = {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
          totalDependencies: LOCKFILE_PACKAGE_COUNT,
        };
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'replaced the advisory set with an empty, internally coherent one' };
    },
  },
  {
    id: 'M-NOISSUES',
    label: 'the audit report has no `advisories` key at all',
    expected: 'fail',
    mustMention: ['advisory set'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        delete a.advisories;
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'removed the `advisories` key from the report' };
    },
  },
  {
    id: 'M-NOFLOOR',
    label: 'the floor policy is emptied, so nothing would be guarded',
    // A visibility gate with no policy reports on nothing while appearing to
    // pass. This is the vacuous-contract class the Phase 37 floor policy had
    // to be taught about, applied here.
    expected: 'fail',
    mustMention: ['at least one floor'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors = [];
      });
      return { fixture: writeAuditFixture(root, () => {}), baselineFixture: PRISTINE_FIXTURE, description: 'emptied the floor policy' };
    },
  },
  {
    id: 'M-CI',
    label: 'the CI step that runs this gate is deleted from ci.yml',
    // Proven by the parity contract, not by this gate: a gate nobody runs is a
    // convention, which is the Phase 28 F-2 defect class.
    expected: 'fail',
    detectedBy: 'verify-ci-parity',
    mustMention: ['verify-dependency-advisory-visibility'],
    apply(root) {
      const doc = YAML.parse(readMirror(root, workflowRel));
      const before = JSON.stringify(doc);
      for (const job of Object.values(doc.jobs ?? {})) {
        job.steps = (job.steps ?? []).filter(
          (s) => !String(s.run ?? '').includes('verify-dependency-advisory-visibility.mjs'),
        );
      }
      if (JSON.stringify(doc) === before) throw new Error('no CI step runs the visibility gate; is it registered?');
      writeMirror(root, workflowRel, YAML.stringify(doc));
      return { fixture: writeAuditFixture(root, () => {}), baselineFixture: PRISTINE_FIXTURE, description: 'deleted the CI step running the visibility gate' };
    },
  },
  {
    id: 'M-PASS',
    label: 'POSITIVE CONTROL: a moderate advisory against a NON-floored package is not a floor failure',
    // `next` carries 13 moderate/low advisories in the real report and carries
    // NO floor. Adjudicating those is real open work, but it is not this gate's
    // job, and a gate that failed here would be claiming a remediation this
    // phase is not authorized to make. It must PASS.
    expected: 'pass',
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1999004', module_name: 'next', severity: 'moderate',
          title: 'synthetic: next moderate advisory, no floor declared',
          vulnerable_versions: '<15.5.10', patched_versions: '>=15.5.10',
        });
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'injected a moderate advisory against `next`, which has no floor' };
    },
  },
  {
    id: 'M-PASS2',
    label: 'POSITIVE CONTROL: a minor advisory against a floored package is STILL a floor failure',
    // The control proper must be re-expressed as a mutant that can actually
    // change something, because a "positive control" which mutates nothing is
    // indistinguishable from a no-op and would be discarded. This one adds a
    // harmless-looking advisory at a severity below the pipeline threshold —
    // low — against a FLOORED package. It must be DETECTED, which proves the
    // control is not quietly severity-bounded at the triage threshold.
    expected: 'fail',
    mustMention: ['undici'],
    apply(root) {
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1999005', module_name: 'undici', severity: 'low',
          title: 'synthetic: undici low advisory, control variant',
          vulnerable_versions: '<6.28.2', patched_versions: '>=6.28.2',
        });
      });
      return { fixture: f, baselineFixture: PRISTINE_FIXTURE, description: 'injected advisory 1999005 (low) against undici' };
    },
  },

  // =======================================================================
  // Phase 41 — F-40-01: a severity-filtered report must not pass as "full"
  // =======================================================================
  //
  // These two use GENUINE reports captured from real `pnpm audit --audit-level=…`
  // invocations, not hand-written fixtures. That matters: the whole claim is that
  // the gate can tell a real filtered report from a real complete one, and a fake
  // report shaped by the same author as the assertion would prove nothing about
  // that. `captureFilteredAudit()` also REFUSES to return a report that is not
  // actually truncated, so these mutants cannot silently degenerate into a no-op.
  {
    id: 'M41-FILTER-HIGH',
    label: 'a GENUINE `pnpm audit --audit-level=high` report is not the full advisory set',
    // F-40-01's headline case: 48 of 92 records, census still says 92. Before
    // Phase 41 this exited 0 and printed "the full advisory set was observed".
    expected: 'fail',
    mustMention: ['NOT the full advisory set', 'low: 8 missing', 'moderate: 36 missing'],
    apply(root) {
      const rel = path.join(root, 'filtered-high.json');
      writeFileSync(rel, FILTERED_FIXTURE);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description:
          `supplied the genuine --audit-level=high report: ${FILTERED_RECORDS} records against a census of ` +
          `${FILTERED_CENSUS}`,
      };
    },
  },
  {
    id: 'M41-FILTER-MOD',
    label: 'a GENUINE `pnpm audit --audit-level=moderate` report is not the full advisory set',
    // The partial filter Phase 40 proved invisible: 84 of 92 records and
    // non-empty, which is why a non-emptiness check alone cannot see it.
    expected: 'fail',
    mustMention: ['NOT the full advisory set', 'low: 8 missing'],
    apply(root) {
      const rel = path.join(root, 'filtered-moderate.json');
      writeFileSync(rel, FILTERED_MODERATE_FIXTURE);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description:
          `supplied the genuine --audit-level=moderate report: ${FILTERED_MODERATE_RECORDS} records against a ` +
          `census of ${FILTERED_CENSUS}`,
      };
    },
  },

  // =======================================================================
  // Phase 41 — F-40-02: mutate the gate's SOURCE
  // =======================================================================
  //
  // Each of the following rewrites `verify-dependency-advisory-visibility.mjs` in
  // the mirror and leaves the rest of the repository valid. These are the
  // mutations Phase 40 proved were absent.
  {
    id: 'M41-SRC-SEV-NARROW',
    label: 'SOURCE: the floor assertion is narrowed back to critical/high only',
    // Exactly the original F-39-01 blind spot, moved inside the assertion.
    // Phase 40's R-SEV-ASSERT escaped and nothing noticed.
    //
    // The input is deliberately IDENTICAL to M-MOD's: M-MOD proves the real
    // control rejects a MODERATE advisory against floored brace-expansion. If
    // this mutant then accepts that same input, the narrowing is proven to be
    // the thing that caused the acceptance. The pair is the argument; neither
    // half is.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [[
        `.filter(([, a]) => typeof a?.module_name === 'string' && flooredPackages.has(a.module_name))`,
        `.filter(([, a]) => typeof a?.module_name === 'string' && flooredPackages.has(a.module_name)
        && a.severity !== 'moderate' && a.severity !== 'low')`,
      ]]);
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1240100', module_name: 'brace-expansion', severity: 'moderate',
          title: 'synthetic: the R36-03 moderate advisory',
          vulnerable_versions: '<1.1.21', patched_versions: '>=1.1.21',
        });
      });
      return {
        fixture: f,
        baselineFixture: PRISTINE_FIXTURE,
        description: 'gate source narrowed to critical/high; fed a MODERATE advisory against floored brace-expansion',
      };
    },
  },
  {
    id: 'M41-SRC-PKGMATCH',
    label: 'SOURCE: the package comparison is corrupted',
    // Phase 40's R-PKGMATCH escaped: nothing protected the package matching.
    // Same input as M-MOD, for the same pairing reason.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [[`flooredPackages.has(a.module_name))`, `flooredPackages.has(a.module_name.slice(0, 4)))`]]);
      const f = writeAuditFixture(root, (a) => {
        injectAdvisory(a, {
          id: '1240100', module_name: 'brace-expansion', severity: 'moderate',
          title: 'synthetic: the R36-03 moderate advisory',
          vulnerable_versions: '<1.1.21', patched_versions: '>=1.1.21',
        });
      });
      return {
        fixture: f,
        baselineFixture: PRISTINE_FIXTURE,
        description: 'gate source package comparison corrupted; fed a moderate advisory against floored brace-expansion',
      };
    },
  },
  {
    id: 'M41-SRC-CENSUS-OFF',
    label: 'SOURCE: the census reconciliation is disabled, so a filtered report passes again',
    // The control must be load-bearing: removing it must restore the F-40-01
    // defect exactly. The input is identical to M41-FILTER-HIGH's, which proves
    // the real control rejects it.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [[
        `  const reconciled = reconcileRecordsAgainstCensus(entries, censusResult.census);`,
        `  const reconciled = { ok: true, detail: 'reconciliation disabled' };`,
      ]]);
      const rel = path.join(root, 'filtered-high.json');
      writeFileSync(rel, FILTERED_FIXTURE);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description: 'gate source census reconciliation disabled; fed the genuine --audit-level=high report',
      };
    },
  },
  {
    id: 'M41-SRC-CENSUS-ABSENT-OK',
    label: 'SOURCE: with ALL census guards removed, a report with no census at all is accepted',
    // Phase 40 tried to weaken this with a single edit and could not: defaulting
    // a missing census to zeros still fails reconciliation, because 92 records
    // cannot be reconciled against a census of 0. That is defence in depth and it
    // is why this mutant now removes BOTH census guards. With one removed the
    // mutation is INEFFECTIVE and the harness reports that honestly rather than
    // counting it.
    //
    // Phase 43: this mutant had to be EXTENDED again, and the reason is worth
    // recording. Removing only the two census guards stopped being sufficient,
    // because a report with `metadata` deleted entirely also has no
    // `metadata.totalDependencies` — and the Phase 43 population check fails
    // closed on that. The gate got STRICTER, so the mutant that is supposed to
    // demonstrate a weakening must disable all three completeness guards. Leaving
    // the population check in place made this mutant INEFFECTIVE, which the
    // harness reported rather than silently reclassifying.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [
        [
          `  const raw = audit?.metadata?.vulnerabilities;`,
          `  const raw = audit?.metadata?.vulnerabilities ?? { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };`,
        ],
        [
          `  const reconciled = reconcileRecordsAgainstCensus(entries, censusResult.census);`,
          `  const reconciled = { ok: true, detail: 'reconciliation disabled' };`,
        ],
        [
          `  const population = checkAuditedPopulation(audit);`,
          `  const population = { ok: true, detail: 'population check disabled' };`,
        ],
      ]);
      const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
      delete audit.metadata;
      const rel = path.join(root, 'no-census.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return { fixture: rel, baselineFixture: PRISTINE_FIXTURE, description: 'gate source tolerates a census-less report; fed a report with no metadata at all' };
    },
  },
  {
    id: 'M41-SRC-LEVEL-ADDED',
    label: 'SOURCE: `--audit-level=high` is added to the gate\'s own audit invocation (LIVE run)',
    // The literal F-40-01 mechanism, reintroduced into the command line. This one
    // must run LIVE, because `--audit-file` bypasses the spawn entirely, so a
    // fixture run would test nothing it claims to test.
    //
    // Note the polarity is the DEFAULT (must REJECT), and that is correct: the
    // argv self-check fires first, so this mutation makes the control FAIL CLOSED
    // rather than silently weaker. That is the defence working. Were the argv
    // check absent, this mutant would instead be a `weaken` one.
    mutates: 'gate',
    live: true,
    expected: 'fail',
    mustMention: ['applies no severity threshold'],
    apply(root) {
      mutateGate(root, [[
        `const AUDIT_ARGV = Object.freeze(['audit', '--json']);`,
        `const AUDIT_ARGV = Object.freeze(['audit', '--audit-level=high', '--json']);`,
      ]]);
      return { description: 'gate source argv now carries --audit-level=high; ran the gate LIVE against the real graph' };
    },
  },
  {
    id: 'M41-SRC-EMPTY-TOLERATED',
    label: 'SOURCE: an empty advisory report is tolerated',
    // Paired with M-EMPTY, which proves the real control rejects an empty report.
    // The fixture is the BYTE-IDENTICAL document M-EMPTY is fed (see the note
    // there): both now carry `totalDependencies` equal to the lockfile's package
    // count, so the two mutants differ ONLY in the gate source and the pairing
    // proves what it claims. If the empty branch is tolerated while the
    // population check still runs, this report would pass every completeness
    // check and exit 0 — which is the demonstration.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [[`  if (entries.length === 0) {`, `  if (false) {`]]);
      const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
      audit.advisories = {};
      audit.metadata = {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
        totalDependencies: LOCKFILE_PACKAGE_COUNT,
      };
      const rel = path.join(root, 'empty.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return { fixture: rel, baselineFixture: PRISTINE_FIXTURE, description: 'gate source tolerates an empty advisory set; fed the identical empty, coherent report M-EMPTY uses' };
    },
  },
  {
    id: 'M41-SRC-SEVCONST',
    label: 'SOURCE (documented benign): narrowing BELOW_THRESHOLD_SEVERITIES does NOT weaken the assertion',
    // This is the mutation the Phase 39 docstring claimed was covered and was not.
    // Running it here, honestly, is what replaces the false claim with a measured
    // one: `BELOW_THRESHOLD_SEVERITIES` governs only the NARRATIVE tally, never the
    // assertion. Narrowing it cannot hide a tier, because the census check prints
    // every tier with its count and reconciles the records against them.
    mutates: 'gate',
    expected: 'pass',
    apply(root) {
      mutateGate(root, [[
        `const BELOW_THRESHOLD_SEVERITIES = ['moderate', 'low'];`,
        `const BELOW_THRESHOLD_SEVERITIES = ['moderate'];`,
      ]]);
      const f = writeAuditFixture(root, () => {});
      return {
        fixture: f,
        baselineFixture: PRISTINE_FIXTURE,
        description: 'gate source narrative threshold narrowed to [moderate]; the assertion and the census are untouched',
      };
    },
  },
  {
    id: 'M41-NO-CENSORY',
    label: 'a report carrying no census at all is rejected',
    // The half of the M41-SRC-CENSUS-ABSENT-OK pair: this proves the REAL control
    // rejects a census-less report, so when the source mutant then accepts that
    // identical input, the removal of the census guards is what caused it.
    expected: 'fail',
    mustMention: ['registry severity census'],
    apply(root) {
      const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
      delete audit.metadata;
      const rel = path.join(root, 'no-census-pair.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return { fixture: rel, baselineFixture: PRISTINE_FIXTURE, description: 'removed `metadata` entirely from a report that otherwise carries all 92 advisories' };
    },
  },
  {
    id: 'M41-CENSUS-TAMPERED',
    label: 'a report whose census is tampered to zero while 92 records remain is rejected',
    // Proves the census is genuinely compared, not merely required to exist.
    expected: 'fail',
    mustMention: ['NOT the full advisory set', 'more records than the census reports'],
    apply(root) {
      const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
      audit.metadata = { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } };
      const rel = path.join(root, 'census-tampered.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return { fixture: rel, baselineFixture: PRISTINE_FIXTURE, description: 'census zeroed while every real record was retained' };
    },
  },
  {
    id: 'M41-NO-SEVERITY-LABEL',
    label: 'an advisory record with no severity field is rejected as unreconcilable',
    expected: 'fail',
    mustMention: ['no recognised severity tier'],
    apply(root) {
      const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
      const victim = Object.keys(audit.advisories)[0];
      delete audit.advisories[victim].severity;
      const rel = path.join(root, 'unlabelled.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return { fixture: rel, baselineFixture: PRISTINE_FIXTURE, description: `removed the severity field from advisory ${victim}` };
    },
  },

  // =======================================================================
  // Phase 43 — P42-01/P42-02: the DEPENDENCY-SCOPE filter class
  // =======================================================================
  //
  // Everything above varies SEVERITY. Phase 42 (P42-01) showed that is not the
  // whole filter surface: `--dev` / `--prod` reduce the PACKAGE POPULATION pnpm
  // submits, so the registry census shrinks in the same proportion and the
  // report reconciles perfectly. Every one of the report-side mutants below is
  // fed a GENUINE report captured from the real package manager, because the
  // defining property of the bypass is precisely that it is internally coherent.
  {
    id: 'M43-SCOPE-DEV',
    label: 'a GENUINE `pnpm audit --dev` report is rejected: the whole graph was not audited',
    // The P42-01 report itself, in fixture form. 22 records, census 22 — so the
    // Phase 41 census reconciliation is SATISFIED and cannot be what catches it.
    expected: 'fail',
    mustMention: ['complete resolved graph', 'FEWER packages than the graph contains were submitted'],
    apply(root) {
      const rel = path.join(root, 'scope-dev.json');
      writeFileSync(rel, SCOPE_REPORTS['--dev'].fixture);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description:
          `supplied the genuine --dev report: ${SCOPE_REPORTS['--dev'].records} records, census ` +
          `${SCOPE_REPORTS['--dev'].census} (self-consistent), but only ` +
          `${SCOPE_REPORTS['--dev'].totalDependencies} of ${LOCKFILE_PACKAGE_COUNT} dependencies submitted`,
      };
    },
  },
  {
    id: 'M43-SCOPE-PROD',
    label: 'a GENUINE `pnpm audit --prod` report is rejected: the whole graph was not audited',
    expected: 'fail',
    mustMention: ['complete resolved graph'],
    apply(root) {
      const rel = path.join(root, 'scope-prod.json');
      writeFileSync(rel, SCOPE_REPORTS['--prod'].fixture);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description:
          `supplied the genuine --prod report: ${SCOPE_REPORTS['--prod'].records} records, census ` +
          `${SCOPE_REPORTS['--prod'].census}, ${SCOPE_REPORTS['--prod'].totalDependencies} of ` +
          `${LOCKFILE_PACKAGE_COUNT} dependencies submitted`,
      };
    },
  },
  {
    id: 'M43-SCOPE-NO-OPTIONAL',
    label: 'a GENUINE `pnpm audit --no-optional` report is rejected',
    // This is the narrowest scope filter found: it drops optionalDependencies
    // only, so its census and records still reconcile and its record count is
    // barely different. A count-based or census-based check would miss it.
    expected: 'fail',
    mustMention: ['complete resolved graph'],
    apply(root) {
      const rel = path.join(root, 'scope-noopt.json');
      writeFileSync(rel, SCOPE_REPORTS['--no-optional'].fixture);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description:
          `supplied the genuine --no-optional report: ${SCOPE_REPORTS['--no-optional'].records} records, census ` +
          `${SCOPE_REPORTS['--no-optional'].census}, ${SCOPE_REPORTS['--no-optional'].totalDependencies} of ` +
          `${LOCKFILE_PACKAGE_COUNT} dependencies submitted`,
      };
    },
  },
  {
    id: 'M43-SCOPE-METADATA-MISSING',
    label: 'a complete report with NO totalDependencies is rejected (cannot be proven -> fails closed)',
    // The fail-closed direction: an absent population figure must not be read as
    // "the population was fine". This is the check that keeps the remediation
    // from being defeatable by simply deleting the field.
    expected: 'fail',
    mustMention: ['no usable `metadata.totalDependencies`'],
    apply(root) {
      const audit = JSON.parse(JSON.stringify(LIVE_AUDIT));
      delete audit.metadata.totalDependencies;
      const rel = path.join(root, 'population-absent.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return { fixture: rel, baselineFixture: PRISTINE_FIXTURE, description: 'removed `metadata.totalDependencies` from an otherwise complete report' };
    },
  },
  {
    // Not a positive control — an ACCEPTED-BOUNDARY probe, and labelled as one.
    //
    // This is the limit of the Phase 43 remediation, pinned by a test rather than
    // left to prose. The genuine `--dev` report is internally consistent about
    // advisories and census; correcting ONLY its `totalDependencies` to the
    // lockfile's count makes it also consistent with the resolved graph, and the
    // gate accepts it. Nothing in the report can then be distinguished from a
    // complete audit.
    //
    // Phase 42 (P42-03) recorded that the boundary was disclosed too narrowly. It
    // is still a real boundary and this mutant exists so that narrowing it in
    // future requires deleting a test, not just editing a comment.
    //
    // Note this is NOT the same as the `--optional` idea this slot originally
    // held: `pnpm audit --optional`, `--lockfile-only`, `--recursive` and
    // `--workspace-root` all produce a report BYTE-IDENTICAL to the full audit on
    // this repository (verified), because none of them reduces the population. A
    // mutant fed one of those cannot be distinguished from a no-op and was
    // correctly DISCARDED as a setup failure rather than being counted as
    // evidence. The no-false-positive property is instead evidenced by the
    // CONTROL run (the real full report passes) and by M-PASS.
    id: 'M43-BOUNDARY-POPULATION-ASSERTED',
    label: 'ACCEPTED BOUNDARY: a scope-reduced report whose population figure matches the lockfile is accepted',
    expected: 'pass',
    apply(root) {
      const audit = JSON.parse(JSON.stringify(SCOPE_REPORTS['--dev'].doc));
      audit.metadata.totalDependencies = LOCKFILE_PACKAGE_COUNT;
      const rel = path.join(root, 'boundary.json');
      writeFileSync(rel, JSON.stringify(audit, null, 2));
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description:
          `took the genuine --dev report (${SCOPE_REPORTS['--dev'].records} records, census ` +
          `${SCOPE_REPORTS['--dev'].census}) and corrected ONLY totalDependencies to ` +
          `${LOCKFILE_PACKAGE_COUNT}; the gate must accept it, which is where the control's authority ends`,
      };
    },
  },

  // =======================================================================
  // Phase 43 — the SOURCE mutants that prove the scope defences load-bearing
  // =======================================================================
  {
    id: 'M43-SRC-POPULATION-OFF',
    label: 'SOURCE: the population check is disabled, so a genuine --dev report is accepted again',
    // The paired half of M43-SCOPE-DEV. Identical fixture, opposite outcome: the
    // unmutated control rejects it (proved above), so an exit 0 here proves the
    // population check is what rejected it, and that P42-01 was closed by THIS
    // line rather than by the census all along.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [[
        `  const population = checkAuditedPopulation(audit);`,
        `  const population = { ok: true, detail: 'population check disabled' };`,
      ]]);
      const rel = path.join(root, 'scope-dev.json');
      writeFileSync(rel, SCOPE_REPORTS['--dev'].fixture);
      return {
        fixture: rel,
        baselineFixture: PRISTINE_FIXTURE,
        description: 'gate source population check disabled; fed the identical genuine --dev report',
      };
    },
  },
  {
    id: 'M43-SRC-CANONICAL-OFF-POPULATION-CATCHES',
    label: 'SOURCE: with the canonical-argv check silenced, the population check STILL rejects --dev (LIVE)',
    // Defence in depth, and the polarity matters: silencing the argv check must
    // NOT let a scope-filtered audit through, because the report-side check is an
    // independent witness. So this mutant's polarity is the DEFAULT (must
    // REJECT). If it were scored as `weaken`, this campaign would report a
    // working second layer as a defect.
    mutates: 'gate',
    live: true,
    expected: 'fail',
    mustMention: ['complete resolved graph'],
    apply(root) {
      // BOTH edits are required for this mutant to mean what it says: silencing
      // the argv check is only interesting if a scope filter is actually present,
      // and the whole point is that the population check catches it anyway.
      mutateGate(root, [
        [
          `  record(
    invocationProblems.length === 0,
    'the audit invocation is the canonical complete-population form (Phase 43 P42-01)',`,
          `  record(
    true,
    'the audit invocation is the canonical complete-population form (Phase 43 P42-01)',`,
        ],
        [
          `const AUDIT_ARGV = Object.freeze(['audit', '--json']);`,
          `const AUDIT_ARGV = Object.freeze(['audit', '--json', '--dev']);`,
        ],
      ]);
      return {
        description:
          'gate source canonical-argv check silenced AND --dev added to AUDIT_ARGV; ran LIVE, expecting the ' +
          'population check to still reject the reduced population',
      };
    },
  },
  {
    id: 'M43-SRC-BOTH-SCOPE-GUARDS-OFF',
    label: 'SOURCE: with BOTH scope guards removed, a genuine --dev report is accepted (LIVE)',
    // Phase 40's single-edit weakness, avoided the way M41-SRC-CENSUS-ABSENT-OK
    // avoided it: silencing only the argv check is INEFFECTIVE (the population
    // check catches it, as M43-SRC-CANONICAL-OFF-POPULATION-CATCHES proves), so
    // proving the canonical check itself is load-bearing requires removing both.
    mutates: 'gate',
    polarity: 'weaken',
    apply(root) {
      mutateGate(root, [
        [
          `  const population = checkAuditedPopulation(audit);`,
          `  const population = { ok: true, detail: 'population check disabled' };`,
        ],
        [
          `  record(
    invocationProblems.length === 0,
    'the audit invocation is the canonical complete-population form (Phase 43 P42-01)',`,
          `  record(
    true,
    'the audit invocation is the canonical complete-population form (Phase 43 P42-01)',`,
        ],
        [
          `const AUDIT_ARGV = Object.freeze(['audit', '--json']);`,
          `const AUDIT_ARGV = Object.freeze(['audit', '--json', '--dev']);`,
        ],
      ]);
      return {
        description:
          'gate source both scope guards silenced AND --dev added to AUDIT_ARGV; ran LIVE against the real graph, ' +
          'which is the exact state Phase 42 (P42-01) demonstrated passes silently',
      };
    },
  },
];

// ---------------------------------------------------------------------------
const preRun = {
  policy: readFileSync(path.join(repoRoot, policyRel), 'utf8'),
  gate: readFileSync(path.join(repoRoot, gateRel), 'utf8'),
  lock: readFileSync(path.join(repoRoot, lockRel), 'utf8'),
  workflow: readFileSync(path.join(repoRoot, workflowRel), 'utf8'),
  parity: readFileSync(path.join(repoRoot, parityRel), 'utf8'),
};

let failures = 0;
const tally = {
  applied: 0, detected: 0, tolerated: 0, setupDiscarded: 0, escapes: 0,
  wrongReason: 0, ineffective: 0, weakened: 0, sourceMutations: 0,
};

log('Phase 39 (F-39-01) + Phase 41 (F-40-01, F-40-02) + Phase 43 (P42-01, P42-02) — mutation test of the advisory-visibility control\n');
log(`  live advisory set captured: ${Object.keys(LIVE_AUDIT.advisories).length} advisories`);
log(`  pnpm-lock.yaml resolves ${LOCKFILE_PACKAGE_COUNT} packages (the population every report must account for)`);
log(`  genuine filtered reports captured from real pnpm audit invocations:`);
log(`    --audit-level=high      -> ${FILTERED_RECORDS} records against a census of ${FILTERED_CENSUS}`);
log(`    --audit-level=moderate  -> ${FILTERED_MODERATE_RECORDS} records against a census of ${FILTERED_CENSUS}`);
log(`  genuine SCOPE-filtered reports (self-consistent census, reduced population — the P42-01 shape):`);
for (const flag of ['--dev', '--prod', '--no-optional', '--optional']) {
  const r = SCOPE_REPORTS[flag];
  log(`    ${flag.padEnd(22)} -> ${String(r.records).padStart(3)} records, census ${String(r.census).padStart(3)}, ` +
    `${String(r.totalDependencies).padStart(4)}/${LOCKFILE_PACKAGE_COUNT} deps submitted` +
    `${r.reduced ? '  REDUCED' : '  (whole graph)'}`);
}
log(`  floored packages: ${[...new Set(realFloored)].join(', ')}\n`);
log('  `detected` = named finding for the intended reason');
log('  `pass`     = legitimate state that must not be flagged');
log('  `setup`    = failed for an unrelated reason -> DISCARDED, never a detection\n');

log('  CONTROL  (unmutated mirror — the real advisory set must pass)');
{
  const root = makeMirror();
  const fixture = writeAuditFixture(root, () => {});
  const res = runGate(root, fixture);
  const sig = setupSignature(res.text);
  if (sig) {
    log(`      FAIL  the unmutated run died with a SETUP signature (${sig}); every result would be meaningless.`);
    failures += 1;
  } else if (res.status !== 0) {
    log('      FAIL  the unmutated repository FAILS its own visibility control.');
    for (const l of res.text.split('\n').filter((x) => /\bFAIL\b/.test(x)).slice(0, 5)) log(`        ${l.trim()}`);
    failures += 1;
  } else {
    log('        -> green, so a red mutant is attributable to the mutation\n');
  }
  rmSync(root, { recursive: true, force: true });
}

for (const m of MUTANTS) {
  if (only && !only.has(m.id)) continue;
  log(`  ${m.id}  ${m.label}`);

  const root = makeMirror();
  let applied;
  try {
    applied = m.apply(root);
  } catch (err) {
    log(`      SETUP  the mutant could not be applied: ${err?.message ?? String(err)}  [DISCARDED]`);
    tally.setupDiscarded += 1;
    failures += 1;
    continue;
  }
  log(`        applied: ${applied.description}`);

  // PHASE 39 HARNESS DEFECT (disclosed): this change-signal originally watched
  // only the five repository files, so the six mutants that vary the ADVISORY
  // FIXTURE were scored as no-ops and DISCARDED — 8 setup failures where the
  // control was never actually challenged. The fixture is a real input to the
  // gate (it is passed via `--audit-file`), so its content is part of what the
  // mutant changes and is now part of the signal. The discarded results were
  // never counted as detections.
  const watched = {
    policy: policyRel, gate: gateRel, lock: lockRel, workflow: workflowRel, parity: parityRel,
  };
  // Phase 41: a live mutant supplies no fixture, so the fixture is only part of
  // the change-signal when the mutant actually wrote one.
  if (applied.fixture) watched.fixture = path.relative(root, applied.fixture);
  const changed = Object.keys(watched).filter((k) => {
    const file = path.join(root, watched[k]);
    return !existsSync(file) || readMirror(root, watched[k]) !== (k === 'fixture' ? applied.baselineFixture : preRun[k]);
  });
  if (changed.length === 0) {
    log('      SETUP  the mutant changed no file it claims to change; it would prove nothing.  [DISCARDED]');
    tally.setupDiscarded += 1;
    failures += 1;
    rmSync(root, { recursive: true, force: true });
    continue;
  }
  // Phase 41: a mutant that claims to attack the gate's SOURCE must have
  // actually written it. A source mutant that only touched a fixture would be
  // scored as evidence about code it never altered.
  if (m.mutates === 'gate' && !changed.includes('gate')) {
    log(`      SETUP  the mutant declares it mutates the gate source but only changed: ${changed.join(', ')}.  [DISCARDED]`);
    tally.setupDiscarded += 1;
    failures += 1;
    rmSync(root, { recursive: true, force: true });
    continue;
  }
  tally.applied += 1;
  if (m.mutates === 'gate') {
    tally.sourceMutations += 1;
    log('        mutates the gate SOURCE (confirmed by the change-signal)');
  }

  if (changed.includes('gate')) {
    const parse = isParseableJs(path.join(root, gateRel));
    if (!parse.ok) {
      log(`      SETUP  the mutant left the gate unparseable (${parse.reason}).  [DISCARDED]`);
      tally.setupDiscarded += 1;
      failures += 1;
      rmSync(root, { recursive: true, force: true });
      continue;
    }
  }

  const isParity = m.detectedBy === 'verify-ci-parity';
  const res = isParity ? runParity(root) : runGate(root, m.live ? null : applied.fixture);
  rmSync(root, { recursive: true, force: true });

  const sig = setupSignature(res.text);
  if (sig) {
    log(`      SETUP  the run failed with \`${sig}\` — an unrelated failure, NOT a detection.  [DISCARDED]`);
    tally.setupDiscarded += 1;
    failures += 1;
    continue;
  }

  if (m.expected === 'pass') {
    if (res.status !== 0) {
      log(`      FAIL  a FALSE POSITIVE (exit=${res.status}). This state is legitimate; the control must hold.`);
      for (const l of res.text.split('\n').filter((x) => /\bFAIL\b/.test(x)).slice(0, 3)) log(`        ${l.trim()}`);
      failures += 1;
    } else {
      log('        -> correctly NOT flagged: this is not a floor failure, and the control says so');
      tally.tolerated += 1;
    }
    log('');
    continue;
  }

  // Phase 41 — the polarity of a SOURCE mutation is INVERTED relative to a
  // fixture mutation, and conflating them is a harness defect, not a finding.
  //
  // A fixture mutant asks: "does the real control REJECT this bad state?"
  //                     Answer wanted: exit 1.
  // A source mutant asks the complementary question: "does weakening this line
  // of the control actually make it ACCEPT that same bad state?"
  //                     Answer wanted: exit 0.
  //
  // For a source mutant, exit 0 is the PROOF — it demonstrates the mutated
  // region is load-bearing, because the identical input is rejected by the
  // unmutated control (proved by the paired fixture mutant, e.g. M-MOD for
  // M41-SRC-SEV-NARROW). Scoring it as an "escape" — as the harness did on its
  // first Phase 41 run — would invert the meaning of the whole campaign and
  // report a working control as unproven. Exit 1 here means the opposite and
  // worse thing: the mutation was INEFFECTIVE, so it proves nothing.
  if (m.polarity === 'weaken') {
    if (res.status === 0) {
      log('        -> WEAKENED (exit=0). The unmutated control rejects this identical input, so the mutated');
      log('           line is load-bearing: weakening it demonstrably restores the blind spot.');
      tally.weakened += 1;
    } else {
      log(`      FAIL  INEFFECTIVE MUTATION (exit=${res.status}). The source was changed but the control still`);
      log('            rejected the input, so this mutant proves nothing about that line being load-bearing.');
      for (const l of res.text.split('\n').filter((x) => /\bFAIL\b/.test(x)).slice(0, 2)) log(`          ${l.trim()}`);
      tally.ineffective += 1;
      failures += 1;
    }
    log('');
    continue;
  }

  if (res.status === 0) {
    log('      FAIL  GENUINE ESCAPE (exit=0). The control claims to enforce this and does not.');
    tally.escapes += 1;
    failures += 1;
    log('');
    continue;
  }

  const missing = (m.mustMention ?? []).filter((t) => !res.text.includes(t));
  if (missing.length > 0) {
    log(`      FAIL  detected, but NOT for the intended reason — output never mentions: ${missing.join(', ')}`);
    log(`            raw: ${res.text.trim().slice(-400)}`);
    tally.wrongReason += 1;
    failures += 1;
    log('');
    continue;
  }

  log('        -> DETECTED (exit=1) for the intended reason:');
  for (const l of res.text.split('\n').filter((x) => /\bFAIL\b/.test(x)).slice(0, 2)) log(`          ${l.trim()}`);
  tally.detected += 1;
  log('');
}

if (!keepMirrors) {
  for (const m of createdMirrors) rmSync(m, { recursive: true, force: true });
  log(`  ${createdMirrors.length} throwaway mirror(s) removed.`);
}
log('');

log('  POST-CONDITION  (the real files must be byte-identical)');
for (const [label, rel, expected] of [
  ['security/dependency-security-floor.json', policyRel, preRun.policy],
  ['scripts/verify-dependency-advisory-visibility.mjs', gateRel, preRun.gate],
  ['pnpm-lock.yaml', lockRel, preRun.lock],
  ['.github/workflows/ci.yml', workflowRel, preRun.workflow],
  ['scripts/verify-ci-parity.mjs', parityRel, preRun.parity],
]) {
  const after = readFileSync(path.join(repoRoot, rel), 'utf8');
  if (after === expected) log(`    ok    ${label} is unchanged`);
  else {
    log(`    FAIL  ${label} was modified. A leaked mutant corrupts every later phase.`);
    writeFileSync(path.join(repoRoot, rel), expected);
    failures += 1;
  }
}

log('');
log(`  TALLY  ${tally.applied} mutant(s) applied, of which ${tally.sourceMutations} mutate the gate's OWN SOURCE:`);
log(`           ${tally.detected} detected (the real control rejected the state)   [adversarial-state mutants]`);
log(`           ${tally.weakened} weakened  (the source mutation was proven consequential)  [source mutants]`);
log(`           ${tally.tolerated} correctly tolerated (legitimate positive controls)`);
log(`         failures: ${tally.escapes} genuine escapes, ${tally.wrongReason} detected for the wrong reason,`);
log(`                   ${tally.ineffective} ineffective source mutations, ${tally.setupDiscarded} discarded as setup failures.`);
log('');
if (failures) {
  log(`  RESULT  FAIL — ${failures} problem(s). The advisory-visibility control is not proven.`);
  process.exit(1);
}
log('  RESULT  PASS — the five conclusions this harness exists to support, each from a mutation that actually');
log('          changed the thing it claims to change:');
log('            1. a moderate, low and critical advisory against either floored package is DETECTED;');
log('            2. an empty, census-less, census-tampered or malformed report FAILS CLOSED, and a GENUINE');
log('               severity-filtered report (--audit-level=high AND the partial --audit-level=moderate) is');
log('               rejected by name, so "unfiltered" is reconciled against the registry census rather than');
log('               inferred from a non-empty report;');
log('            3. removing the census guards, narrowing the assertion to critical/high, corrupting the');
log('               package comparison or tolerating an empty report each DEMONSTRABLY restores the blind spot');
log('               (those source mutants WEAKEN), so those lines are load-bearing;');
log('            4. a GENUINE dependency-SCOPE-filtered report (--dev, --prod, --no-optional) is rejected,');
log('               because the packages pnpm submitted do not account for pnpm-lock.yaml — Phase 43 (P42-01).');
log('               Those reports are internally CONSISTENT, so the census check is satisfied by them and cannot');
log('               be what catches this; and disabling the population check makes the gate accept the identical');
log('               report, so that check is load-bearing rather than decorative;');
log('            5. a moderate advisory against a NON-floored package is correctly tolerated, narrowing the');
log('               narrative threshold constant is proven not to weaken the assertion, and the ACCEPTED');
log('               BOUNDARY is pinned by a mutant: a scope-reduced report whose population figure is');
log('               corrected to match the lockfile is accepted, so narrowing that boundary later requires');
log('               deleting a test rather than editing a comment.');
log('');
log('  NOT PROVEN BY THIS HARNESS: that the sub-threshold advisories are harmless. This control asserts the');
log('          FLOOR holds; the advisories outside any floor are counted and reported, and their remediation');
log('          requires dependency upgrades that were not authorized in this phase.');
log('');
log('  ACCEPTED BOUNDARY (not a gap, restated accurately in Phase 43): the census is the registry\'s account of the');
log('          package population pnpm was SUBMITTED, not of this repository, and it is not independent of the');
log('          invocation. Phase 43 cross-checks it against pnpm-lock.yaml and holds the invocation to an exact');
log('          canonical form, which removes the ACCIDENTAL filter of either class. What remains is a coherent');
log('          forgery of the whole report — advisories AND metadata agreeing with each other AND with the');
log('          lockfile — which cannot be refuted from within the report alone. That actor already holds the');
log('          ability to rewrite this control, the lockfile and the floor policy. See the gate header.');
process.exit(0);
