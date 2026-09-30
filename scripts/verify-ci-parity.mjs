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
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

// Every gate this project added must be wired in, or it only runs on a laptop.
// Phase 29 (F-2). The independent Phase 28 review found three gates that were
// fully implemented, green locally, and present in NEITHER `ci.yml` NOR this
// list: `mutate-rate-limit-n12.mjs`, `verify-storage-backup-restore.mjs` and
// `run-db-suites.mjs`. A gate nobody runs is a convention, so all three are
// here now, along with this script and its own mutation harness — a contract
// that is not itself enforced is how the gap happened.
//
// The match is STRUCTURED, not textual. The previous revision of this file
// asserted `workflowText.includes(gate.name)`, which is defeated by a YAML
// comment: delete the step, mention the script name in a comment, and the
// build stays green while the gate stops running. Each gate is instead
// matched against the PARSED `run` command of a real step, as a
// whitespace-delimited token, with shell comments stripped first — a second
// bypass that `includes()` also missed. Because matching is on whole tokens,
// `verify:metadata` is NOT satisfied by the `verify:metadata:mutate` step;
// the two are separate gates and either can be deleted alone.
//
// Each gate additionally declares the artefact it ultimately invokes, and this
// script asserts that artefact EXISTS. That is the "CI claims to run a gate
// but the command is broken" case, caught structurally before a runner is
// ever needed: renaming `verify-storage-backup-restore.mjs`, or deleting the
// `verify:storage:backup` entry from `apps/api/package.json`, fails here.
const REQUIRED_GATES = [
  {
    id: 'p23-w1-metadata',
    gate: 'verify:metadata',
    why: 'Phase 23 W1 — the gate that would have caught the Phase 22 defect before release',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:metadata' },
  },
  {
    id: 'p23-w3-routes',
    gate: 'verify:routes',
    why: 'Phase 23 W3 — structural authorization over the compiled route table',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:routes' },
  },
  {
    id: 'p23-w5-config',
    gate: 'verify-config-contract.mjs',
    why: 'Phase 23 W5 — environment/version/secret contract',
    target: { kind: 'file', file: 'scripts/verify-config-contract.mjs' },
  },
  {
    id: 'p23-w6-audit',
    gate: 'verify-dependency-audit.mjs',
    why: 'Phase 23 W6 — lockfile and native-module verification',
    target: { kind: 'file', file: 'scripts/verify-dependency-audit.mjs' },
  },
  {
    id: 'p23-w6-triage',
    gate: 'triage-vulnerabilities.mjs',
    why: 'Phase 23 W6 — reachable-advisory triage',
    target: { kind: 'file', file: 'scripts/triage-vulnerabilities.mjs' },
  },
  {
    id: 'p23-w2-auth-suite',
    gate: 'verify-compiled-auth-suite.mjs',
    why: 'Phase 23 W2 — the full authentication surface on the built artifact',
    target: { kind: 'file', file: 'apps/api/scripts/verify-compiled-auth-suite.mjs' },
  },
  {
    id: 'p23-w9-migrations',
    gate: 'verify-db-migrations.sh',
    why: 'Phase 23 W9 — migration safety on throwaway databases',
    target: { kind: 'file', file: 'scripts/verify-db-migrations.sh' },
  },
  {
    id: 'p23-w10-artifact',
    gate: 'verify-release-artifact.mjs',
    why: 'Phase 23 W10 — release artifact integrity',
    target: { kind: 'file', file: 'scripts/verify-release-artifact.mjs' },
  },
  {
    id: 'p23-w1-metadata-mutate',
    gate: 'verify:metadata:mutate',
    why: 'Phase 23 W1 — proof the gate detects the defect class',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:metadata:mutate' },
  },
  {
    id: 'p23-w3-routes-mutate',
    gate: 'verify:routes:mutate',
    why: 'Phase 23 W3 — proof the authorization gate detects a removed guard',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:routes:mutate' },
  },
  {
    id: 'p23-w5-config-mutate',
    gate: 'mutate-config-contract.mjs',
    why: 'Phase 23 W5 — proof the configuration audit detects drift',
    target: { kind: 'file', file: 'scripts/mutate-config-contract.mjs' },
  },
  {
    id: 'p24-d2-lifetime-mutate',
    gate: 'verify:lifetime:mutate',
    why: 'Phase 24 D-2 — proof the access-token lifetime bound is load-bearing',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:lifetime:mutate' },
  },

  // --- Phase 28 gates, wired in by Phase 29 after the independent review ---
  {
    id: 'p28-n12-mutate',
    gate: 'verify:ratelimit:n12:mutate',
    why: 'Phase 28 N-12 — proof the 429 rate-limit contract is load-bearing and the 403 authorization contract is still asserted',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:ratelimit:n12:mutate' },
    // Exact, because this command takes `--only`. A step reading
    // `verify:ratelimit:n12:mutate --only M-N12-1` would pass a token match
    // while running 1 of 8 mutants — a green build that checks almost
    // nothing. Equivalence is therefore asserted on the whole command.
    exactCommand: 'pnpm --filter @ecc/api verify:ratelimit:n12:mutate',
  },
  {
    id: 'p28-storage-backup',
    gate: 'verify:storage:backup',
    why: 'Phase 28 WS2 — STORAGE_DIR archive/destroy/restore re-verified against the real compiled StorageService',
    target: { kind: 'packageScript', pkg: 'apps/api', script: 'verify:storage:backup' },
    exactCommand: 'pnpm --filter @ecc/api verify:storage:backup',
  },
  {
    id: 'p28-db-suites',
    gate: 'run-db-suites.mjs',
    why: 'Phase 28 — the database-backed suites on a fresh throwaway PostgreSQL, in the one configuration that runs unit and integration in the same process',
    target: { kind: 'file', file: 'scripts/run-db-suites.mjs' },
    exactCommand: 'node scripts/run-db-suites.mjs',
  },

  // --- The CI contract protecting itself ----------------------------------
  {
    id: 'p29-ci-parity',
    gate: 'verify-ci-parity.mjs',
    why: 'Phase 29 — this list is worthless unless the thing that enforces it also runs in CI',
    target: { kind: 'file', file: 'scripts/verify-ci-parity.mjs' },
    // `--list` is the structural half and executes nothing. Without the flag
    // the default mode re-runs nearly every step in the workflow, which would
    // double this job's cost for no coverage.
    exactCommand: 'node scripts/verify-ci-parity.mjs --list',
  },
  {
    id: 'p29-ci-integration-mutate',
    gate: 'mutate-ci-integration.mjs',
    why: 'Phase 29 — proof that deleting a required Phase 28 gate from CI is detected rather than merely intended',
    target: { kind: 'file', file: 'scripts/mutate-ci-integration.mjs' },
    exactCommand: 'node scripts/mutate-ci-integration.mjs',
  },
];

/**
 * Strip shell comments from a `run:` body.
 *
 * YAML comments are already gone by this point — they are removed by the
 * parser — but a *shell* comment inside a `run: |` block is not, and
 * `# node scripts/run-db-suites.mjs` on its own line is the cheapest possible
 * way to satisfy a text match while executing nothing. A `#` that begins a
 * word and is not inside quotes starts a comment to end of line.
 */
function stripShellComments(run) {
  return run
    .split('\n')
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote && line[i - 1] !== '\\') quote = null;
          continue;
        }
        if (ch === "'" || ch === '"') {
          quote = ch;
          continue;
        }
        if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/** Collapse every whitespace run, so indentation and wrapping cannot matter. */
function normaliseCommand(run) {
  return stripShellComments(run).replace(/\s+/g, ' ').trim();
}

function commandTokens(run) {
  return normaliseCommand(run).split(' ').filter(Boolean);
}

/**
 * Does this step's command actually invoke `gate`?
 *
 * A token match, not a substring match, and tolerant of a path prefix
 * (`scripts/verify-db-migrations.sh` satisfies `verify-db-migrations.sh`) but
 * not of a longer identifier (`verify:metadata:mutate` does NOT satisfy
 * `verify:metadata`).
 */
function stepInvokesGate(step, gate) {
  return commandTokens(step.run).some((tok) => tok === gate || tok.endsWith(`/${gate}`));
}

/**
 * Does this package script name a file that must exist?
 *
 * The packageScript target check only proves the ENTRY POINT is declared. An
 * earlier version of this contract stopped there, and mutation C17 caught the
 * gap: renaming `verify-storage-backup-restore.mjs` and updating the package
 * script to match left the contract fully satisfied, while a gate the reviewer
 * would call "wired in" pointed at a file that had moved. The entry point is
 * therefore resolved to the script it invokes and that file is checked too.
 *
 * Only tokens that are unambiguously file paths are checked — they contain a
 * `/` and their last segment has an extension — so an unrelated token like a
 * port number or a flag cannot produce a spurious failure.
 */
function fileTokensOfScript(body) {
  return body
    .split(/\s+/)
    .map((t) => t.replace(/^['"]|['"]$/g, ''))
    .filter((t) => t.includes('/') && !t.startsWith('-') && /\.[A-Za-z0-9]+$/.test(t.split('/').pop() ?? ''));
}

function gateTargetProblem(target) {
  if (target.kind === 'file') {
    const abs = path.join(repoRoot, target.file);
    if (!existsSync(abs)) {
      return `the script it runs, \`${target.file}\`, does not exist. CI would run a command that cannot work.`;
    }
    return null;
  }
  if (target.kind === 'packageScript') {
    const pkgDir = path.join(repoRoot, target.pkg);
    const pkgPath = path.join(pkgDir, 'package.json');
    if (!existsSync(pkgPath)) return `\`${target.pkg}/package.json\` does not exist.`;
    let scripts;
    try {
      scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
    } catch (err) {
      return `\`${target.pkg}/package.json\` is not parseable JSON: ${err.message}`;
    }
    if (!Object.hasOwn(scripts, target.script)) {
      return (
        `the package script \`${target.script}\` is not defined in \`${target.pkg}/package.json\`. ` +
        'The workflow invokes it, so the step would fail on the runner.'
      );
    }
    for (const token of fileTokensOfScript(scripts[target.script])) {
      const abs = path.resolve(pkgDir, token);
      if (!existsSync(abs)) {
        return (
          `the package script \`${target.script}\` is \`${scripts[target.script]}\`, but ` +
          `\`${token}\` does not exist. The gate is wired to a command that cannot work.`
        );
      }
    }
    return null;
  }
  return `unknown target kind \`${target.kind}\` — the gate contract itself is malformed.`;
}

// ---------------------------------------------------------------------------
// Phase 32 — resolvability of every CI command
// ---------------------------------------------------------------------------

/**
 * Is `p` unambiguously a path to a file this repository owns?
 *
 * Requires BOTH a separator and an extension on the last segment, so that a
 * bare name (`pnpm-lock.yaml`), a flag, a port, or a glob cannot be mistaken for
 * a file. This is the same discriminator the Phase 29 target check uses, kept
 * deliberately conservative: a false "this must exist" on a command that never
 * needed it would make the contract untrustworthy, and an untrustworthy
 * contract gets ignored.
 */
function isRepoFilePath(p) {
  if (!p || p.startsWith('-')) return false;
  if (p.includes('*') || p.includes('$') || p.includes('`')) return false;
  if (!p.includes('/')) return false;
  const last = p.split('/').pop() ?? '';
  return /\.[A-Za-z0-9]+$/.test(last);
}

/**
 * A token naming a set of files rather than one file — an eslint argument
 * with a brace/glob pattern such as the lint script's `"{src,test}"` tree.
 *
 * `isRepoFilePath` already rejects a bare `*`, but a shell glob that has been
 * unquoted still looks like a path with an extension, and it must never be
 * required to exist. Braces are therefore excluded here as well.
 */
function isGlobToken(t) {
  return /[*?[\]{}]/.test(t);
}

/**
 * The working directory a step's command runs in: a leading `cd X &&` if any.
 */
function stepCwd(step) {
  const m = /^\s*cd\s+(\S+)\s*&&\s*/.exec(step.run ?? '');
  return m ? path.resolve(repoRoot, m[1]) : repoRoot;
}

/**
 * Split a step's command into the pieces that actually execute, each carrying
 * the directory it would run in.
 *
 * A workflow `run:` is usually a multi-line block, so `cd apps/api` is typically
 * a line of its own rather than a `cd X && …` prefix. Collapsing the block to one
 * string and looking only for a leading `cd` therefore resolves every operand
 * against the repository root and reports files that are present in the package
 * as missing. Splitting on newlines and `&&`, and treating a standalone `cd` as a
 * directory change, models the shell closely enough for a static check without
 * pretending to be a shell.
 */
function stepSegments(step) {
  // `pnpm --filter <pkg> …` runs the command with the PACKAGE as its working
  // directory, not the repository root. A step written as
  // `pnpm --filter @ecc/api exec node ../../scripts/x.mjs` therefore resolves
  // `../../scripts/x.mjs` from `apps/api`. Seeding the cwd from the filter is
  // what makes that step resolve to `scripts/x.mjs` rather than to a path above
  // the repository.
  const filtered = filterScriptOf(step.run) ?? /\bpnpm\s+(?:run\s+)?--filter\s+(\S+)/.exec(step.run ?? '');
  const filterDir = filtered ? pkgNameToDir.get(filtered[1] ?? filtered.pkg) : null;
  let cwd = filterDir ? path.join(repoRoot, filterDir) : repoRoot;
  const out = [];
  for (const raw of (step.run ?? '').split(/\r?\n|&&/)) {
    const seg = stripShellComments(raw).trim();
    if (!seg) continue;
    const cd = /^cd\s+(\S+)\s*$/.exec(seg);
    if (cd) {
      // An explicit `cd` inside a `--filter` command is still relative to that
      // command's own working directory, so resolve it against the current cwd.
      cwd = path.resolve(cwd, cd[1]);
      continue;
    }
    out.push({ cwd, text: seg });
  }
  return out;
}

/**
 * Paths a job builds for itself, judged RELATIVE to the directory the command
 * runs in (so `node dist/main.js` from `apps/api` is `dist/…`, not
 * `apps/api/dist/…`).
 */
const GENERATED_PREFIXES = ['dist/', 'build/', 'out/', 'coverage/', '.next/', 'node_modules/'];

function isGeneratedOutput(relFromCwd) {
  const norm = relFromCwd.split(path.sep).join('/');
  return GENERATED_PREFIXES.some((p) => norm.startsWith(p));
}

const pkgScriptsCache = new Map();
function packageScripts(pkgDirRel) {
  if (pkgScriptsCache.has(pkgDirRel)) return pkgScriptsCache.get(pkgDirRel);
  const pkgPath = path.join(repoRoot, pkgDirRel, 'package.json');
  let out = null;
  if (existsSync(pkgPath)) {
    try {
      out = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
    } catch {
      out = null;
    }
  }
  pkgScriptsCache.set(pkgDirRel, out);
  return out;
}

/**
 * The single script a `pnpm --filter <pkg> <script>` step invokes, or null.
 *
 * `pnpm exec` / `pnpm install` are not scripts and are deliberately not matched:
 * they resolve a binary from the workspace rather than a declared script entry.
 */
function filterScriptOf(run) {
  const m = /\bpnpm\s+(?:run\s+)?--filter\s+(\S+)\s+([A-Za-z0-9:_-]+)/.exec(run);
  if (!m) return null;
  const [, pkg, script] = m;
  if (script === 'exec' || script === 'install' || script === 'dlx') return null;
  return { pkg, script };
}

const pkgNameToDir = new Map([
  ['@ecc/api', 'apps/api'],
  ['@ecc/mobile', 'apps/mobile'],
  ['@ecc/web', 'apps/web'],
  ['@ecc/config', 'packages/config'],
  ['@ecc/ui', 'packages/ui'],
]);

/**
 * Phase 32. Resolve what a step's command actually needs, and report anything
 * that cannot be found.
 *
 * Why this exists. Hosted run 36618193752 failed with
 * `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT ... "verify:storage:backup"`: the workflow
 * referenced a Phase 28 gate whose package script and backing file were never
 * committed. The required-gate target check already knew how to report that,
 * and DID report it correctly when it was allowed to run — but the broken step
 * sat *earlier* in the job than the contract step, so the run died on the
 * symptom first and the diagnosis was never reached.
 *
 * This check closes the remaining half of the gap: it resolves EVERY step, not
 * only the declared required gates, so drift in a non-gate step is reported as
 * a contract problem rather than as an unexplained runner failure. And it
 * separately reports targets that exist on disk but are untracked, which is the
 * exact condition that made local parity green while hosted CI was red.
 */
/**
 * The files a step's `node`/`bash`/`sh` command will actually execute, as paths
 * relative to the repository root, excluding build output the job produces
 * itself.
 *
 * Only the interpreter's FIRST non-flag operand counts. Requiring every
 * path-looking token would be wrong twice over: it would treat operands such as
 * `test -f dist/main.js` as dependencies, and it would make the contract
 * sensitive to where in a compound command a path happens to appear.
 */
function executedFileTargets(step) {
  const out = [];
  for (const seg of stepSegments(step)) {
    const toks = seg.text.split(' ').filter(Boolean);
    for (const [i, tok] of toks.entries()) {
      if (tok !== 'node' && tok !== 'bash' && tok !== 'sh') continue;
      let j = i + 1;
      while (j < toks.length && toks[j].startsWith('-')) j += 1;
      const operand = toks[j];
      if (!operand || !isRepoFilePath(operand)) continue;
      const abs = path.resolve(seg.cwd, operand);
      const relCwd = path.relative(seg.cwd, abs);
      if (isGeneratedOutput(relCwd)) continue; // produced by this job, never committed
      out.push({ operand, cwd: seg.cwd, rel: path.relative(repoRoot, abs) });
    }
  }
  return out;
}

function resolvabilityProblem(step) {
  const filtered = filterScriptOf(step.run);
  if (filtered) {
    const dir = pkgNameToDir.get(filtered.pkg);
    if (!dir) return null; // an unknown filter is not this check's business
    const scripts = packageScripts(dir);
    if (scripts === null) {
      return `it invokes \`pnpm --filter ${filtered.pkg} ${filtered.script}\`, but \`${dir}/package.json\` is missing or unparseable.`;
    }
    if (!Object.hasOwn(scripts, filtered.script)) {
      return (
        `it invokes \`pnpm --filter ${filtered.pkg} ${filtered.script}\`, but that script is not defined in ` +
        `\`${dir}/package.json\`. The runner will fail with ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT.`
      );
    }
    for (const token of fileTokensOfScript(scripts[filtered.script])) {
      if (isGlobToken(token)) continue;
      if (!existsSync(path.resolve(repoRoot, dir, token))) {
        return (
          `the script \`${dir}:${filtered.script}\` is \`${scripts[filtered.script]}\`, but \`${token}\` does not exist. ` +
          'The gate is wired to a target that is not in the tree.'
        );
      }
    }
    return null;
  }

  for (const t of executedFileTargets(step)) {
    if (!existsSync(path.resolve(t.cwd, t.operand))) {
      return (
        `it runs \`${t.operand}\`, but that file does not exist relative to ` +
        `\`${path.relative(repoRoot, t.cwd) || '.'}\`. The runner will fail on a file that is not in the tree.`
      );
    }
  }
  return null;
}

/**
 * Phase 32. A target that exists on disk but is untracked is the specific
 * condition that let local parity report green while the committed tree could
 * not run: the file was present in the developer's working tree and absent from
 * the commit the runner checks out.
 *
 * Only meaningful inside a git work tree, so it is skipped when the contract is
 * run from an export or a tarball — in that situation existence is the only
 * property available, and claiming more would be false.
 */
function untrackedTargetProblem(step) {
  if (!existsSync(path.join(repoRoot, '.git'))) return null;
  let listed;
  try {
    listed = new Set(
      execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\0')
        .filter(Boolean),
    );
  } catch {
    return null; // not a git work tree, or git unavailable: do not invent a verdict
  }

  const needed = new Set();
  const filtered = filterScriptOf(step.run);
  if (filtered) {
    const dir = pkgNameToDir.get(filtered.pkg);
    const scripts = dir ? packageScripts(dir) : null;
    if (dir && scripts && Object.hasOwn(scripts, filtered.script)) {
      for (const token of fileTokensOfScript(scripts[filtered.script])) {
        if (isGlobToken(token)) continue;
        needed.add(path.relative(repoRoot, path.resolve(repoRoot, dir, token)));
      }
    }
  } else {
    for (const t of executedFileTargets(step)) needed.add(t.rel);
  }

  for (const rel of needed) {
    if (!listed.has(rel)) {
      return (
        `\`${rel}\` is required by this step but is NOT tracked by git. A clean checkout — which is what a CI ` +
        'runner sees — will not contain it, so this step cannot work there even though it works in this ' +
        'working tree. Commit the file, or remove the step.'
      );
    }
  }
  return null;
}

/**
 * Constructs that make a check un-failable no matter what the step says.
 * These are checked per required gate, because a required gate is by
 * definition a check, and a check that cannot fail is not a check.
 */
function suppressionProblem(step) {
  const cmd = normaliseCommand(step.run);
  if (step.continueOnError) {
    return 'it is `continue-on-error`, so a failure is reported and then ignored — the build stays green';
  }
  if (/^\s*set\s+\+e\s*$/m.test(step.run)) {
    return 'it uses `set +e`, so a failing command does not fail the step';
  }
  for (const construct of ['|| true', '|| :', '|| echo', '&& exit 0', '2>/dev/null || true']) {
    if (cmd.includes(construct)) {
      return `it contains \`${construct}\`, which suppresses the failure of the command it guards`;
    }
  }
  return null;
}

// --- Phase 32: every step's command must resolve in the committed tree ------
//
// Ordered deliberately BEFORE the required-gate loop's own reporting matters
// not; what matters is that this runs as part of the same contract, so the
// diagnosis is available in the same invocation that the runner performs.
let resolvableSteps = 0;
for (const s of runSteps) {
  const unresolvable = resolvabilityProblem(s);
  if (unresolvable) {
    problems.push(`step "${s.name}" (job \`${s.job}\`) cannot work on a clean checkout: ${unresolvable}`);
  } else {
    resolvableSteps += 1;
  }
  const untracked = untrackedTargetProblem(s);
  if (untracked) {
    problems.push(`step "${s.name}" (job \`${s.job}\`) depends on a file that is not committed: ${untracked}`);
  }
}

for (const gate of REQUIRED_GATES) {
  const invoking = runSteps.filter((s) => stepInvokesGate(s, gate.gate));
  if (invoking.length === 0) {
    problems.push(
      `the gate \`${gate.gate}\` (${gate.id}) is not wired into CI as a step command. ${gate.why}. ` +
        'A gate that only runs locally is a convention. Note that a comment mentioning the name does not count.',
    );
    continue;
  }
  // At least one invoking step must be a real gate. If every step that names
  // this gate is advisory, the build reports green either way.
  const realGate = invoking.filter((s) => !s.continueOnError);
  if (realGate.length === 0) {
    problems.push(
      `the gate \`${gate.gate}\` (${gate.id}) is only ever invoked by an advisory step, so a failure ` +
        'cannot fail the build.',
    );
  }
  for (const s of invoking) {
    const suppression = suppressionProblem(s);
    if (suppression) {
      problems.push(
        `step "${s.name}" runs the required gate \`${gate.gate}\` (${gate.id}) but ${suppression}. ` +
          'A required gate that cannot fail is not a gate.',
      );
    }
  }
  if (gate.exactCommand) {
    const exact = runSteps.filter((s) => normaliseCommand(s.run) === gate.exactCommand);
    if (exact.length === 0) {
      const near = invoking
        .map((s) => `"${s.name}" runs \`${normaliseCommand(s.run)}\``)
        .join('; ');
      problems.push(
        `the required gate \`${gate.gate}\` (${gate.id}) is invoked by a NON-EQUIVALENT command. ` +
          `Expected exactly \`${gate.exactCommand}\`. ` +
          (near ? `Found: ${near}. ` : '') +
          'Options, filters or flags added to a required gate can narrow it to a fraction of its coverage while still looking wired in.',
      );
    }
  }
  const targetProblem = gateTargetProblem(gate.target);
  if (targetProblem) {
    problems.push(`the required gate \`${gate.gate}\` (${gate.id}) cannot run: ${targetProblem} ${gate.why}.`);
  }
}

// The contract is only meaningful if it is non-trivial. A list accidentally
// emptied would make every check above vacuously pass, which is precisely the
// "green that means nothing" outcome this script exists to prevent.
if (REQUIRED_GATES.length < 17) {
  problems.push(
    `the required-gate contract has only ${REQUIRED_GATES.length} entries; 17 are expected. ` +
      'An emptied or truncated list makes every gate check above vacuously pass.',
  );
}
const phase28GateIds = ['p28-n12-mutate', 'p28-storage-backup', 'p28-db-suites'];
for (const id of phase28GateIds) {
  if (!REQUIRED_GATES.some((g) => g.id === id)) {
    problems.push(
      `the required-gate contract no longer contains the Phase 28 gate \`${id}\`. This is the exact ` +
        'omission the independent Phase 28 review recorded as F-2; the contract must name it explicitly.',
    );
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
