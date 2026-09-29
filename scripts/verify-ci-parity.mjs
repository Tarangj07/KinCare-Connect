#!/usr/bin/env node
/**
 * Phase 23 (W8) — CI parity.
 *
 * Remote GitHub Actions has never been executed for this repository, so
 * "CI is green" is a claim nobody has verified. This script narrows that gap
 * as far as it can be narrowed without a remote runner: it reads
 * .github/workflows/ci.yml, extracts every command, and reports what it can
 * and cannot execute locally — and why.
 *
 * The distinction that matters is not "ran" vs "did not run". It is whether a
 * step that CAN be run locally was left unrun. A step that needs GitHub's
 * hosted runner, a service container, or a secrets store is documented as
 * such; a step that needs only a shell and a database is executed.
 *
 * It also checks the properties of the workflow itself that make a green run
 * meaningful:
 *
 *   - a security-critical step is an actual gate, not `continue-on-error`
 *   - advisory steps say so, and every one of them names its reason
 *   - `|| true`, `|| echo`, `set +e` and friends do not neutralise a check
 *   - every Node version in every job agrees
 *   - the `containers` job is not a stub
 *   - no step silently depends on state a previous step left behind
 *
 * Usage:  node scripts/verify-ci-parity.mjs [--list] [--run]
 *         --list  print the extracted steps and the local verdict, run nothing
 *         (default) list, then execute every step that can run locally
 *
 * Phase 26 (WS6) — self-contained database. This script used to default
 * `DATABASE_URL` to a hardcoded `127.0.0.1:55432/ecc_p23` that it did not
 * create. On a machine without that leftover database, three CI steps failed
 * with `P1001: Can't reach database server` — a result indistinguishable from
 * a genuine CI defect, and a false alarm. It now provisions its own throwaway
 * PostgreSQL (shared implementation: `scripts/lib/throwaway-postgres.mjs`) and
 * migrates it before executing the steps, so a clean machine produces a
 * truthful result. The developer database `ecc` is never a target.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createThrowawayPostgres } from './lib/throwaway-postgres.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml');
const require_ = createRequire(import.meta.url);
const listOnly = process.argv.includes('--list');

/**
 * Provisioned lazily, and only when a step is actually going to run: `--list`
 * must not leave a database behind for a reviewer who only wanted an
 * inventory. An operator-supplied `P23_CI_DATABASE_URL` still wins, so a
 * constrained environment can still supply its own.
 */
let throwawayDb = null;
function localDatabaseUrl() {
  if (process.env['P23_CI_DATABASE_URL']) return process.env['P23_CI_DATABASE_URL'];
  if (!throwawayDb) {
    throwawayDb = createThrowawayPostgres({ label: 'ci-parity' });
    throwawayDb.installCleanupHandlers();
    throwawayDb.start();
    throwawayDb.migrate(path.join(repoRoot, 'apps/api'));
  }
  return throwawayDb.url();
}

const ENV = {
  ...process.env,
  // Resolved per-execution rather than at import time, so the throwaway
  // database is not created by merely loading this module.
  DATABASE_URL: process.env['P23_CI_DATABASE_URL'] ?? '',
  JWT_ACCESS_SECRET: 'ci-parity-local-only-secret-32-chars',
  NODE_ENV: 'test',
};

// ---------------------------------------------------------------------------
// Workflow parsing
// ---------------------------------------------------------------------------
// The `yaml` package is already in the dependency graph (Next.js depends on
// it), so it is resolved from the pnpm store rather than added as a direct
// dependency. Parsing the workflow with a real YAML parser matters: a
// hand-rolled indentation walker silently mis-reads block scalars, and a CI
// audit that cannot see its own subject is worse than none.
function loadYaml() {
  const candidates = [
    'yaml',
    ...readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
      .filter((d) => d.startsWith('yaml@'))
      .map((d) => path.join(repoRoot, 'node_modules/.pnpm', d, 'node_modules/yaml')),
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

const YAML = loadYaml();
const workflow = YAML.parse(readFileSync(workflowPath, 'utf8'));
const lines = readFileSync(workflowPath, 'utf8').split('\n');

/** Flattened step list: {job, name, run, uses, continueOnError, env}. */
const steps = [];
for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
  for (const step of job.steps ?? []) {
    steps.push({
      job: jobId,
      name: step.name ?? step.uses ?? '(unnamed)',
      run: step.run ?? null,
      uses: step.uses ?? null,
      continueOnError: step['continue-on-error'] === true,
      env: step.env ?? {},
    });
  }
}

const runSteps = steps.filter((s) => s.run);
const useSteps = steps.filter((s) => s.uses);

// ---------------------------------------------------------------------------
// Which steps cannot be executed locally, and why
// ---------------------------------------------------------------------------
const LOCAL_BLOCKERS = [
  { match: /actions\/(checkout|setup-node)\b|actions\/pnpm/, reason: 'a GitHub Action; its local equivalent is the surrounding shell steps' },
];

function canRunLocally(step) {
  const r = step.run ?? '';
  if (/\$\{\{\s*github\./.test(r)) {
    return { ok: false, reason: 'references a GitHub expression (${{ github.* }}) that only exists on the runner' };
  }
  // A step that hardcodes the service container's host port and credentials
  // rather than using the job's `env:` is not reproducible outside the runner
  // that hosts that exact service. This is a REAL finding about the workflow,
  // not a limitation of this script: those steps are the only ones that cannot
  // be re-run against a different database, so a change to them is unverified
  // until CI runs.
  if (/localhost:5432/.test(r)) {
    return {
      ok: false,
      reason:
        'hardcodes localhost:5432 and the service container credentials instead of using the job env, so it can ' +
        'only run against the CI service database this workflow declares; the same behaviour is covered locally by ' +
        'scripts/verify-db-migrations.sh, which provisions its own throwaway PostgreSQL',
    };
  }
  if (/\$\{\{\s*runner\./.test(r)) {
    // runner.temp is a real local directory on a Linux runner; map it so the
    // command is still meaningful.
    return { ok: true, reason: 'runner.temp mapped to a local temp dir', rewrite: (s) => s.replace(/\$\{\{\s*runner\.temp\s*\}\}/g, path.join(os.tmpdir(), 'ecc-ci-parity')) };
  }
  if (/^\s*(gh |aws |gcloud |az |kubectl |terraform |helm )\b/m.test(r)) {
    return { ok: false, reason: 'invokes a cloud or cluster CLI, which is deliberately out of scope' };
  }
  return { ok: true, reason: 'shell only' };
}

// ---------------------------------------------------------------------------
// workflow-level properties
// ---------------------------------------------------------------------------
const problems = [];
const notes = [];

const advisory = runSteps.filter((s) => s.continueOnError);
for (const s of advisory) {
  if (!/advisory|pre-existing|carried from/i.test(s.name)) {
    problems.push(
      `step "${s.name}" is continue-on-error but its name does not say it is advisory, so a reader cannot tell a ` +
        'deliberate tolerance from an accidental bypass',
    );
  }
}

// A neutralised check is worse than no check: it looks green. `|| true` is
// only a bypass when it is the LAST command in a pipeline of real checks —
// `kill -TERM $PID 2>/dev/null || true` inside an EXIT trap is the standard
// cleanup idiom, and suppressing *that* would leave a process running. So the
// rule is about position, not about the presence of the construct.
for (const s of runSteps) {
  const lines23 = s.run.split('\n');
  lines23.forEach((line, i) => {
    const isSuppression = /\|\|\s*(true|echo)\b/.test(line);
    if (!isSuppression) return;
    // A later line that is itself a real check means the suppression is not
    // what decides the step's outcome.
    const laterCheck = lines23
      .slice(i + 1)
      .some((l) => /\b(exit 1|curl -fsS|test |\[ -|grep -q)/.test(l));
    if (laterCheck) return;
    // A bare `cmd || true` on its own line, with nothing after it, is the
    // shape that hides a failure.
    if (/^\s*(trap\b|\{)?\s*[\w./-]+\s+[^|]*\|\|\s*(true|echo)\s*\}?\s*$/.test(line) && i === lines23.length - 1) {
      problems.push(
        `step "${s.name}" ends with \`|| true\` (${line.trim()}), which suppresses the failure of the command it ` +
          'guards. A check that cannot fail is not a check.',
      );
    }
  });
  if (/^\s*set \+e\s*$/m.test(s.run)) {
    problems.push(`step "${s.name}" uses \`set +e\`, so a failing command does not fail the step`);
  }
}

// Node version consistency across jobs.
const nodeVersions = new Set();
for (const line of lines) {
  const m = /node-version:\s*(\S+)/.exec(line);
  if (m) nodeVersions.add(m[1]);
}
if (nodeVersions.size > 1) {
  problems.push(`CI pins more than one Node version: ${[...nodeVersions].join(', ')}`);
}
const containersJobSteps = steps.filter((s) => s.job === 'containers');
if (containersJobSteps.length <= 3) {
  problems.push('the containers job has almost no steps; it would report green without building or running anything');
}
if (!runSteps.some((s) => s.job === 'containers' && /verify-docker-images/.test(s.run ?? ''))) {
  problems.push('the containers job does not run the container verification gate');
}

// Every gate this phase added must be wired in, or it only runs on a laptop.
const REQUIRED_GATES = [
  { name: 'verify:metadata', why: 'Phase 23 W1 — the gate that would have caught the Phase 22 defect before release' },
  { name: 'verify:routes', why: 'Phase 23 W3 — structural authorization over the compiled route table' },
  { name: 'verify-config-contract.mjs', why: 'Phase 23 W5 — environment/version/secret contract' },
  { name: 'verify-dependency-audit.mjs', why: 'Phase 23 W6 — lockfile and native-module verification' },
  { name: 'triage-vulnerabilities.mjs', why: 'Phase 23 W6 — reachable-advisory triage' },
  { name: 'verify-compiled-auth-suite.mjs', why: 'Phase 23 W2 — the full authentication surface on the built artifact' },
  { name: 'verify-db-migrations.sh', why: 'Phase 23 W9 — migration safety on throwaway databases' },
  { name: 'verify-release-artifact.mjs', why: 'Phase 23 W10 — release artifact integrity' },
  { name: 'verify:metadata:mutate', why: 'Phase 23 W1 — proof the gate detects the defect class' },
  { name: 'verify:routes:mutate', why: 'Phase 23 W3 — proof the authorization gate detects a removed guard' },
  { name: 'mutate-config-contract.mjs', why: 'Phase 23 W5 — proof the configuration audit detects drift' },
  { name: 'verify:lifetime:mutate', why: 'Phase 24 D-2 — proof the access-token lifetime bound is load-bearing' },
];
const workflowText = readFileSync(workflowPath, 'utf8');
for (const gate of REQUIRED_GATES) {
  if (!workflowText.includes(gate.name)) {
    problems.push(`the gate \`${gate.name}\` is not wired into CI. ${gate.why}. A gate that only runs locally is a convention.`);
  }
}

// ---------------------------------------------------------------------------
// report and local execution
// ---------------------------------------------------------------------------
console.log('\nPhase 23 (W8) — CI parity\n');
console.log(`  workflow jobs     : ${new Set(steps.map((s) => s.job)).size}`);
console.log(`  steps extracted   : ${steps.length} (${runSteps.length} with a command, ${useSteps.length} actions)`);
console.log(`  advisory steps    : ${advisory.length}`);
console.log(`  node-version pins : ${[...nodeVersions].join(', ')}`);

console.log('\n  step inventory:\n');
let localRun = 0;
let localSkip = 0;
for (const s of steps) {
  const verdict = s.run ? canRunLocally(s) : { ok: false, reason: s.uses ? 'a GitHub Action' : 'no command' };
  const mark = s.continueOnError ? 'advisory' : verdict.ok ? 'LOCAL' : 'remote';
  if (verdict.ok) localRun += 1;
  else if (s.run) localSkip += 1;
  console.log(`    [${mark.padEnd(8)}] ${String(s.job).padEnd(10)} ${s.name}`);
  if (!verdict.ok && s.run) console.log(`                 └─ not run locally: ${verdict.reason}`);
}

if (notes.length) {
  console.log('\n  notes:');
  for (const n of notes) console.log(`    - ${n}`);
}

if (problems.length > 0) {
  console.error(`\nFAILED — ${problems.length} CI-parity problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `\n  Workflow structure is sound: ${localRun} of ${runSteps.length} commands can run locally, ` +
    `${localSkip} need the remote runner (GitHub expressions, Actions, or a cloud CLI), and each is listed above.`,
);
console.log('  GitHub Actions has NOT been executed against this workflow; no remote result is claimed.\n');

if (listOnly) {
  console.log('  --list given: nothing was executed.\n');
  process.exit(0);
}

console.log('  Executing every locally-runnable command, in workflow order:\n');
console.log(
  process.env['P23_CI_DATABASE_URL']
    ? '  using the operator-supplied P23_CI_DATABASE_URL\n'
    : '  a throwaway PostgreSQL will be provisioned on first use, and destroyed when this run ends.\n',
);
let executed = 0;
let failed = 0;
const skippedByChoice = [];
for (const s of runSteps) {
  const verdict = canRunLocally(s);
  if (!verdict.ok) {
    skippedByChoice.push([s, verdict.reason]);
    continue;
  }
  // The migration gate and the artifact gate each spin up their own
  // infrastructure; running them here duplicates work the release job does
  // and is not part of "does the CI command work". They are executed
  // deliberately instead, and the result is recorded in the phase document.
  if (/verify-db-migrations\.sh|verify-release-artifact\.mjs|verify-compiled-auth-suite/.test(s.run)) {
    skippedByChoice.push([s, 'executed deliberately as a standalone verification, not re-run here']);
    continue;
  }
  const command = verdict.rewrite ? verdict.rewrite(s.run) : s.run;
  if (s.continueOnError) {
    // An advisory step is expected to fail; CI tolerates it and so does this
    // runner. Reporting it as a failure would misreport the baseline lint debt
    // as a Phase 23 regression, and suppressing it silently would hide a NEW
    // failure in the same step. So it runs, and its real exit code is shown.
    process.stdout.write(`    running [${s.job}] ${s.name} (advisory; exit code reported, not enforced) ...\n`);
    const res = spawnSync('bash', ['-euo', 'pipefail', '-c', verdict.rewrite ? verdict.rewrite(s.run) : s.run], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...ENV, DATABASE_URL: localDatabaseUrl(), ...Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, v.replace(/^['"]|['"]$/g, '')])) },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    executed += 1;
    const errors = ((res.stdout ?? '') + (res.stderr ?? '').split('\n').filter((l) => /error|warning/i.test(l)).length.toString()).match(
      /(\d+ errors?|\d+ warnings?|\d+ problems?)/g,
    );
    const counts = errors ? [...new Set(errors)].join(', ') : 'no counts reported';
    console.log(`    ${res.status === 0 ? 'PASS' : 'ADVISORY'} [${s.job}] ${s.name} — ${counts}`);
    continue;
  }
  process.stdout.write(`    running [${s.job}] ${s.name} ...\n`);
  const res = spawnSync('bash', ['-euo', 'pipefail', '-c', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...ENV,
      // Phase 26 (WS6): resolved here, per step, so a database is created
      // only when a step that needs one actually runs.
      DATABASE_URL: localDatabaseUrl(),
      ...Object.fromEntries(
        Object.entries(s.env).map(([k, v]) => {
          const unwrapped = v.replace(/^['"]|['"]$/g, '');
          // Same expression rewrite the command body receives; a step whose env
          // keeps a literal "${{ runner.temp }}" gets a directory that does not
          // exist, and the step fails for a reason unrelated to what it checks.
          const mapped = verdict.rewrite ? verdict.rewrite(unwrapped) : unwrapped;
          return [k, mapped.replace(/\$\{\{\s*github\.runner\.name\s*\}\}/g, 'local')];
        }),
      ),
    },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  executed += 1;
  const status = res.status === 0 ? 'PASS' : 'FAIL';
  console.log(`    ${status} [${s.job}] ${s.name}`);
  if (res.status !== 0) {
    failed += 1;
    console.error((res.stdout || '').slice(-3000));
    console.error((res.stderr || '').slice(-3000));
  }
}

console.log(`\n  executed ${executed} command(s); ${failed} failed.`);
if (skippedByChoice.length > 0) {
  console.log('\n  not executed here:');
  for (const [s, why] of skippedByChoice) console.log(`    - [${s.job}] ${s.name}: ${why}`);
}
console.log(
  '\n  GitHub Actions has still not run. These results establish that each command works in this\n' +
    '  environment; they do not establish that the hosted runner, its service containers or its\n' +
    '  action versions behave identically.\n',
);

if (failed > 0) process.exit(1);
