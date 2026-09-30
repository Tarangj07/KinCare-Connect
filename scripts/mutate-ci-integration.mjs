#!/usr/bin/env node
/**
 * Phase 29 (F-2) — mutation test of the CI-integration control.
 *
 * The Phase 28 independent review found that three fully-implemented,
 * locally-green gates were wired into neither `.github/workflows/ci.yml` nor
 * the `REQUIRED_GATES` contract in `scripts/verify-ci-parity.mjs`. Phase 29
 * wires them in. This harness proves the wiring is load-bearing.
 *
 * A check that has never been shown to fail is a check that might not work.
 * Every assertion in the CI contract is therefore attacked here, and each
 * mutant must be DETECTED. The mutants cover the four ways the protection
 * could quietly stop protecting anything:
 *
 *   1. the gate is deleted from the workflow;
 *   2. the gate is renamed in the workflow, or the contract entry is deleted,
 *      so the two stop describing the same thing;
 *   3. the step is left in place but made unable to fail (`continue-on-error`,
 *      `|| true`), or narrowed to a fraction of its coverage (extra flags,
 *      a dropped `--list`);
 *   4. the gate is "kept" only as a comment — the exact bypass the previous
 *      text-based `workflowText.includes(...)` check was defeated by, kept as
 *      a regression test so that check is never reintroduced.
 *
 * Two further mutants attack the target-existence check (a renamed script, a
 * deleted package script) and two attack the contract's own integrity (an
 * emptied list, a dropped Phase 28 entry), because a contract that can be
 * silently truncated makes every check above vacuously pass.
 *
 * ## Why this mutates a COPY and not the working tree
 *
 * The obvious implementation rewrites `.github/workflows/ci.yml` in place and
 * restores it. On a developer machine that risks corrupting the file if the
 * harness dies mid-run — the exact failure (N-10) that has bitten this project
 * before. In CI it is worse: the workflow being mutated IS the workflow
 * deciding whether later steps run, so a leaked mutant would change the
 * meaning of the remaining steps of the job.
 *
 * So every mutant is applied to a throwaway mirror under a temp directory, and
 * `node <mirror>/scripts/verify-ci-parity.mjs --list` is executed against it.
 * The real files are never opened for writing. The mirror contains only what
 * the parity script reads in `--list` mode — the workflow, `scripts/`, the two
 * `package.json` files the contract names, and a symlink to the real
 * `node_modules` for the `yaml` parser. The byte-identity of the real files is
 * asserted at the end regardless of how the run ended.
 *
 * ## Method
 *
 * Mutations are applied STRUCTURALLY, through the same YAML parser the parity
 * script uses, or through a brace-aware scanner for the JS contract. Nothing
 * here depends on the workflow's indentation, comment style, or line wrapping,
 * so a reformat cannot turn a mutant into a silent no-op — which is the defect
 * class that produces a "PASS" proving nothing.
 *
 * A mutant whose edit does not actually change the file is a hard error, not a
 * pass.
 *
 * Usage:  node scripts/mutate-ci-integration.mjs [--only C1,C2] [--keep]
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireCjs = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowRel = path.join('.github', 'workflows', 'ci.yml');
const parityRel = path.join('scripts', 'verify-ci-parity.mjs');
const apiPkgRel = path.join('apps', 'api', 'package.json');

const only = process.argv.includes('--only')
  ? new Set((process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()))
  : null;
const keepMirrors = process.argv.includes('--keep');

const log = (m) => console.log(m);
const rel = (p) => path.relative(repoRoot, p) || path.basename(p);

// ---------------------------------------------------------------------------
// The `yaml` parser, resolved exactly as verify-ci-parity.mjs resolves it.
// Resolving it differently here would mean the harness tests a different parse
// than the gate performs, which is the whole point of copying that resolution.
// ---------------------------------------------------------------------------
function loadYaml() {
  const fsMod = requireCjs('node:fs');
  const candidates = [
    'yaml',
    ...fsMod
      .readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
      .filter((d) => d.startsWith('yaml@'))
      .map((d) => path.join(repoRoot, 'node_modules/.pnpm', d, 'node_modules/yaml')),
  ];
  for (const c of candidates) {
    try {
      return requireCjs(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('could not load the `yaml` parser from the dependency graph');
}
const YAML = loadYaml();

// ---------------------------------------------------------------------------
// Brace-aware scanning, for editing the REQUIRED_GATES array in JS source.
// ---------------------------------------------------------------------------
/**
 * Blank out `//` line comments and block comments, preserving STRING CONTENT
 * and — critically — the LENGTH and character positions of everything else.
 *
 * The length guarantee is the whole point. Callers compute brace offsets on
 * the mask and then slice the ORIGINAL source with them, so a mask that
 * collapsed comments instead of blanking them shifted every offset after the
 * first `//`. The result was mutants that deleted an unrelated region of the
 * file, producing a JavaScript SyntaxError: node exited 1, and the harness
 * scored that as "the mutant was DETECTED". Five of the twenty-one mutants
 * were passing for that reason — a vacuous green of exactly the kind this
 * project has been bitten by repeatedly. Comment characters become spaces, so
 * index i means the same thing in both strings.
 */
function maskComments(src) {
  const out = src.split('');
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      out[i] = ' ';
      if (i + 1 < src.length) out[i + 1] = ' ';
      i += 2;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Reject a mutant that is not syntactically valid JavaScript before scoring it. */
function isParseableJs(file) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 60_000 });
  return res.status === 0 ? { ok: true } : { ok: false, reason: (res.stderr ?? '').split('\n')[4] ?? 'syntax error' };
}

/** The span of the object literal containing `needle`, as [start, end). */
function objectSpanAround(src, needle) {
  const masked = maskComments(src);
  const at = masked.indexOf(needle);
  if (at === -1) throw new Error(`anchor not found: ${needle}`);
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    if (masked[i] === '{') {
      start = i;
      break;
    }
  }
  if (start === -1) throw new Error(`no enclosing object literal for: ${needle}`);
  let depth = 0;
  let quote = null;
  for (let i = start; i < masked.length; i += 1) {
    const ch = masked[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return [start, i + 1];
    }
  }
  throw new Error(`unbalanced object literal for: ${needle}`);
}

/** Remove the whole object literal identified by `needle`, and its trailing comma. */
function removeObjectEntry(src, needle) {
  const [start, end] = objectSpanAround(src, needle);
  // Skip a trailing `,`, the indentation before the next entry, and the
  // newline. The cursor must advance unconditionally on every character that
  // is consumed: an earlier version advanced only on `,` and `\n`, so a space
  // between them re-tested an unchanged cursor forever and C19 hung.
  let stop = end;
  if (src[stop] === ',') stop += 1;
  while (stop < src.length && (src[stop] === ' ' || src[stop] === '\t' || src[stop] === '\r')) stop += 1;
  if (src[stop] === '\n') stop += 1;
  return src.slice(0, start) + src.slice(stop);
}

// ---------------------------------------------------------------------------
// The mirror
// ---------------------------------------------------------------------------
let createdMirrors = [];

function makeMirror() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p29-ci-mutate-'));
  createdMirrors.push(root);
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  cpSync(path.join(repoRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  // The parity script reads `<pkg>/package.json` for the packageScript targets,
  // and one required gate (verify-compiled-auth-suite.mjs) lives under
  // `apps/api/scripts/`. An earlier version of this harness copied only
  // `scripts/`, and the unmutated CONTROL then failed on that missing target —
  // a false positive that would have made every mutant result meaningless.
  // Mirrors now contain every file the contract names.
  mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
  cpSync(path.join(repoRoot, 'apps', 'api', 'scripts'), path.join(root, 'apps', 'api', 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, 'apps', 'api', 'package.json'), path.join(root, 'apps', 'api', 'package.json'));
  // Phase 32. The contract now resolves EVERY step's command, not only the
  // declared required gates, so it reads the `package.json` of every package a
  // step filters on — including the `mobile` and `web` jobs. The same reasoning
  // as above applies: a mirror that omits a file the contract names makes the
  // unmutated CONTROL fail for a reason that has nothing to do with the mutant
  // under test, which would render every result meaningless.
  for (const pkg of ['mobile', 'web']) {
    mkdirSync(path.join(root, 'apps', pkg), { recursive: true });
    cpSync(path.join(repoRoot, 'apps', pkg, 'package.json'), path.join(root, 'apps', pkg, 'package.json'));
  }
  // `yaml` must resolve from the mirror; the store is shared, not copied.
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  cpSync(path.join(repoRoot, workflowRel), path.join(root, workflowRel));
  return root;
}

/**
 * Phase 36 (P35-2). Make the mirror a real git work tree with every file
 * COMMITTED, so the contract's untracked-target assertion has something to be
 * right or wrong about.
 *
 * `untrackedTargetProblem()` in `verify-ci-parity.mjs` opens with
 *
 *     if (!existsSync(path.join(repoRoot, '.git'))) return null;
 *
 * and returns null — inventing no verdict — outside a work tree. Every mirror
 * this harness built before Phase 36 was a `mkdtemp` directory with no `.git`,
 * so that assertion was SKIPPED for all 21 mutants. The Phase 35 review
 * identified exactly that gap: the untracked-file protection was implemented,
 * read, and never once exercised by a test that could fail.
 *
 * `git init` + `git add -A` + `git -c user.* commit` makes every copied file
 * tracked, which is the correct starting state. A mutant then removes ONE file
 * from the index while leaving it on disk, producing precisely the Phase 31/32
 * condition: local parity green, hosted CI red, because the runner checks out
 * the index and the file is not in it.
 */
function gitInitMirror(root) {
  const git = (...args) =>
    spawnSync('git', ['-c', 'user.name=p36', '-c', 'user.email=p36@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    });
  // The store is a symlink into the real repository; without this it would be
  // walked as 100k+ files and the commit would take minutes.
  writeFileSync(
    path.join(root, '.gitignore'),
    ['node_modules', '.next', 'dist', ''].join('\n'),
  );
  let r = git('init', '-q');
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  r = git('add', '-A');
  if (r.status !== 0) throw new Error(`git add failed: ${r.stderr}`);
  r = git('commit', '-q', '-m', 'mirror baseline');
  if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`);
}

/** Remove `relPath` from the index while leaving the file on disk. */
function gitUntrack(root, relPath) {
  const r = spawnSync('git', ['rm', '--cached', '-q', '--', relPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`git rm --cached failed for ${relPath}: ${r.stderr}`);
  if (!existsSync(path.join(root, relPath))) {
    throw new Error(`git rm --cached also removed ${relPath} from disk; the mutant needs it present-but-untracked`);
  }
}

function readMirror(root, relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}
function writeMirror(root, relPath, content) {
  writeFileSync(path.join(root, relPath), content);
}

// ---------------------------------------------------------------------------
// Mutants. Each receives the mirror root and returns a short description of
// what it changed. Each must change SOMETHING — asserted by the caller.
// ---------------------------------------------------------------------------
const wf = (root) => YAML.parse(readMirror(root, workflowRel));

/** Find the single step whose `name` contains `namePart`. */
function stepNamed(doc, namePart) {
  const hits = [];
  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      const name = step.name ?? step.uses ?? '';
      if (String(name).includes(namePart)) hits.push({ jobId, index, step });
    }
  }
  if (hits.length !== 1) {
    throw new Error(`expected exactly one step matching ${JSON.stringify(namePart)}, found ${hits.length}`);
  }
  return hits[0];
}

function mutateWorkflow(root, fn) {
  const doc = wf(root);
  fn(doc);
  writeMirror(root, workflowRel, YAML.stringify(doc));
}

const STEP = {
  storageBackup: 'Storage backup — STORAGE_DIR archive',
  n12Mutate: 'Mutation — the N-12 429 contract',
  dbSuites: 'Database-backed suites — e2e and unit+integration',
  ciParity: 'CI contract — the workflow satisfies the parity contract',
  ciMutate: 'Mutation — removing a required Phase 28 gate from CI is detected',
};

const MUTANTS = [
  // --- 1. the gate is deleted from the workflow ---------------------------
  {
    id: 'C1',
    label: 'the N-12 mutation gate is deleted from ci.yml',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { jobId, index } = stepNamed(doc, STEP.n12Mutate);
        doc.jobs[jobId].steps.splice(index, 1);
      });
      return 'removed the `verify:ratelimit:n12:mutate` step';
    },
  },
  {
    id: 'C2',
    label: 'the STORAGE_DIR backup/restore gate is deleted from ci.yml',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { jobId, index } = stepNamed(doc, STEP.storageBackup);
        doc.jobs[jobId].steps.splice(index, 1);
      });
      return 'removed the `verify:storage:backup` step';
    },
  },
  {
    id: 'C3',
    label: 'the throwaway-database suite driver is deleted from ci.yml',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { jobId, index } = stepNamed(doc, STEP.dbSuites);
        doc.jobs[jobId].steps.splice(index, 1);
      });
      return 'removed the `run-db-suites.mjs` step';
    },
  },
  {
    id: 'C4',
    label: 'the CI-parity gate itself is deleted from ci.yml',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { jobId, index } = stepNamed(doc, STEP.ciParity);
        doc.jobs[jobId].steps.splice(index, 1);
      });
      return 'removed the `verify-ci-parity.mjs --list` step';
    },
  },
  {
    id: 'C5',
    label: 'the CI-integration mutation harness is deleted from ci.yml',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { jobId, index } = stepNamed(doc, STEP.ciMutate);
        doc.jobs[jobId].steps.splice(index, 1);
      });
      return 'removed the `mutate-ci-integration.mjs` step';
    },
  },

  // --- 2. the gate is renamed, or the contract entry is dropped -----------
  {
    id: 'C6',
    label: 'the CI command for a Phase 28 gate is renamed (contract not updated)',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { step } = stepNamed(doc, STEP.storageBackup);
        step.run = 'pnpm --filter @ecc/api verify:storage-backup-and-restore';
      });
      return 'renamed the storage-backup step to `verify:storage-backup-and-restore`';
    },
  },
  {
    id: 'C7',
    label: 'the p28-n12-mutate entry is removed from REQUIRED_GATES',
    expected: 'fail',
    apply(root) {
      const src = readMirror(root, parityRel);
      const next = removeObjectEntry(src, "id: 'p28-n12-mutate'");
      writeMirror(root, parityRel, next);
      return 'deleted the `p28-n12-mutate` contract entry';
    },
  },
  {
    id: 'C8',
    label: 'the p28-storage-backup entry is removed from REQUIRED_GATES',
    expected: 'fail',
    apply(root) {
      const src = readMirror(root, parityRel);
      writeMirror(root, parityRel, removeObjectEntry(src, "id: 'p28-storage-backup'"));
      return 'deleted the `p28-storage-backup` contract entry';
    },
  },
  {
    id: 'C9',
    label: 'the p28-db-suites entry is removed from REQUIRED_GATES',
    expected: 'fail',
    apply(root) {
      const src = readMirror(root, parityRel);
      writeMirror(root, parityRel, removeObjectEntry(src, "id: 'p28-db-suites'"));
      return 'deleted the `p28-db-suites` contract entry';
    },
  },

  // --- 3. the step cannot fail, or is narrowed ---------------------------
  {
    id: 'C10',
    label: 'the storage-backup gate is made advisory (continue-on-error)',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        stepNamed(doc, STEP.storageBackup).step['continue-on-error'] = true;
      });
      return 'set `continue-on-error: true` on the storage-backup step';
    },
  },
  {
    id: 'C11',
    label: 'the db-suite driver is made advisory (continue-on-error)',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        stepNamed(doc, STEP.dbSuites).step['continue-on-error'] = true;
      });
      return 'set `continue-on-error: true` on the run-db-suites step';
    },
  },
  {
    id: 'C12',
    label: 'the db-suite driver is silenced with `|| true`',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { step } = stepNamed(doc, STEP.dbSuites);
        step.run = 'node scripts/run-db-suites.mjs || true';
      });
      return 'appended `|| true` to the run-db-suites command';
    },
  },
  {
    id: 'C13',
    label: 'the N-12 mutation gate is narrowed to one of its eight mutants',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { step } = stepNamed(doc, STEP.n12Mutate);
        step.run = 'pnpm --filter @ecc/api verify:ratelimit:n12:mutate --only M-N12-1';
      });
      return 'added `--only M-N12-1` to the N-12 mutation command';
    },
  },
  {
    id: 'C14',
    label: 'the CI-parity step is switched from --list to full re-execution',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { step } = stepNamed(doc, STEP.ciParity);
        step.run = 'node scripts/verify-ci-parity.mjs';
      });
      return 'dropped `--list` from the verify-ci-parity command';
    },
  },

  // --- 4. the gate survives only as a comment ----------------------------
  {
    id: 'C15',
    label: 'REGRESSION: the step is replaced by a shell comment naming the gate',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { step } = stepNamed(doc, STEP.storageBackup);
        step.run = '# pnpm --filter @ecc/api verify:storage:backup\ntrue';
      });
      return 'replaced the storage-backup command with a shell comment naming it';
    },
  },
  {
    id: 'C16',
    label: 'REGRESSION: the step is deleted and replaced by a YAML comment',
    expected: 'fail',
    apply(root) {
      mutateWorkflow(root, (doc) => {
        const { jobId, index } = stepNamed(doc, STEP.dbSuites);
        doc.jobs[jobId].steps.splice(index, 1);
        // A step whose `run` is only a YAML comment: the parser drops the
        // comment, so the workflow still contains the words the old
        // `workflowText.includes()` check searched for.
        doc.jobs[jobId].steps.splice(index, 0, {
          name: 'Database-backed suites (see scripts/run-db-suites.mjs)',
          run: 'echo "run-db-suites.mjs is run by scripts/run-db-suites.mjs; see scripts/run-db-suites.mjs"',
        });
      });
      return 'replaced the run-db-suites step with a step that only echoes its name';
    },
  },

  // --- 5. the artefact a required gate invokes is missing ----------------
  {
    id: 'C17',
    label: 'the storage backup script is RENAMED, with nothing else updated',
    // The exit criterion this covers: a required gate renamed without updating
    // the contract must fail. The workflow command and the package script
    // still name the old file, so the step would break on the runner — and the
    // packageScript target check, which only proved the entry point was
    // DECLARED, was satisfied. The contract now resolves the entry point to
    // the script it invokes, which is what catches this.
    expected: 'fail',
    apply(root) {
      const from = path.join(root, 'scripts', 'verify-storage-backup-restore.mjs');
      const to = path.join(root, 'scripts', 'verify-storage-backup-restore-v2.mjs');
      if (!existsSync(from)) throw new Error('the storage backup script is not present in the mirror');
      renameSync(from, to);
      return 'renamed verify-storage-backup-restore.mjs to ...-v2.mjs, updating nothing';
    },
  },
  {
    id: 'C18',
    label: 'the `verify:storage:backup` package script is deleted',
    expected: 'fail',
    apply(root) {
      const pkgPath = path.join(root, 'apps', 'api', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (!Object.hasOwn(pkg.scripts, 'verify:storage:backup')) {
        throw new Error('the mirror has no verify:storage:backup package script');
      }
      delete pkg.scripts['verify:storage:backup'];
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      return 'deleted the `verify:storage:backup` entry from apps/api/package.json';
    },
  },
  {
    id: 'C21',
    label: 'POSITIVE CONTROL: a fully COORDINATED rename of the storage script',
    // The gate still works, so the contract must still hold. This is the
    // over-correction guard: an earlier version of C17 renamed the file AND
    // updated the package script, and was written up as a false negative in
    // the verifier. It was not. That is a legal refactor, and a CI contract
    // that fails it would push people to stop renaming things rather than to
    // keep gates wired. What must fail is the UNCOORDINATED rename (C17);
    // this mutant exists so the difference between the two is explicit and
    // stays that way.
    expected: 'pass',
    apply(root) {
      const from = path.join(root, 'scripts', 'verify-storage-backup-restore.mjs');
      const to = path.join(root, 'scripts', 'verify-storage-backup-restore-v2.mjs');
      if (!existsSync(from)) throw new Error('the storage backup script is not present in the mirror');
      renameSync(from, to);
      const pkgPath = path.join(root, 'apps', 'api', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      pkg.scripts['verify:storage:backup'] = 'node ../../scripts/verify-storage-backup-restore-v2.mjs';
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      return 'renamed the script AND updated the package script to match';
    },
  },

  // --- 7. Phase 36 (P35-2): the UNTRACKED-ARTIFACT protection -------------
  //
  // P35-2, verbatim: "the untracked-artifact detection path has no passing
  // mutant". `untrackedTargetProblem()` opens with
  //
  //     if (!existsSync(path.join(repoRoot, '.git'))) return null;
  //
  // and every mirror built before Phase 36 was a bare temp directory with no
  // `.git`, so that branch was skipped for all 21 existing mutants. The check
  // was implemented, read carefully, and never exercised by anything that could
  // fail. This is the exact class of defect the Phase 32 root cause was: local
  // green coexisting with hosted red because the file was in the working tree
  // and absent from the commit the runner checks out.
  //
  // These three mutants form a 2x2 with the harness's own scoring:
  //
  //   C22  untracked + assertion live      -> must FAIL  (the check works)
  //   C23  untracked + assertion disabled  -> must PASS  (C22's failure came
  //                                           from that assertion and nothing
  //                                           else)
  //   C24  tracked   + assertion live      -> must PASS  (positive control: a
  //                                           fully committed tree is fine)
  //
  // C22 alone would be a weaker result than it looks. The contract has several
  // reasons to report a problem, so "exit 1" does not by itself prove the
  // untracked assertion fired. C23 removes that ambiguity: with the assertion
  // neutralised and the tree otherwise identical, the contract must go green.
  // If C22 and C23 disagree, C22's detection was attributable to the untracked
  // assertion specifically.
  {
    id: 'C22',
    label: 'a gate script is present on disk but NOT tracked by git (P35-2)',
    // The Phase 31/32 condition reproduced exactly. The file exists, so the
    // EXISTENCE check is satisfied; only `git ls-files` can catch this.
    expected: 'fail',
    apply(root) {
      gitInitMirror(root);
      gitUntrack(root, path.join('scripts', 'verify-storage-backup-restore.mjs'));
      return 'committed every mirror file, then removed scripts/verify-storage-backup-restore.mjs from the index ' +
        '(the file stays on disk)';
    },
  },
  {
    id: 'C23',
    label: 'CONTROL for C22: the untracked assertion itself is disabled',
    // This is the mutant the Phase 35 review asked for: "removes/bypasses the
    // untracked-target assertion while leaving the rest of the harness
    // syntactically valid". It must NOT be detected — because the tree it
    // leaves behind is the one C22 proved to be broken, and with the assertion
    // gone the contract can no longer see it. A contract that still failed
    // here would be failing for some OTHER reason, which would mean C22 proved
    // nothing about the untracked path.
    //
    // The edit is a single early return inside the function body, so the file
    // stays parseable (asserted by isParseableJs before scoring) and nothing
    // else in the contract changes.
    expected: 'pass',
    apply(root) {
      gitInitMirror(root);
      gitUntrack(root, path.join('scripts', 'verify-storage-backup-restore.mjs'));
      const src = readMirror(root, parityRel);
      const anchor = 'function untrackedTargetProblem(step) {';
      const at = src.indexOf(anchor);
      if (at === -1) throw new Error(`anchor not found: ${anchor}`);
      const insertAt = at + anchor.length;
      const next = `${src.slice(0, insertAt)}\n  return null; // Phase 36 mutant C23: the assertion is bypassed${src.slice(insertAt)}`;
      writeMirror(root, parityRel, next);
      return 'made the gate script untracked AND inserted `return null` at the top of untrackedTargetProblem()';
    },
  },
  {
    id: 'C24',
    label: 'POSITIVE CONTROL: every file is tracked (P35-2)',
    // The over-correction guard for the pair above. A git work tree in which
    // everything is committed is the normal state, and the contract must hold
    // in it. Without this, a "fix" that made untrackedTargetProblem always
    // report a problem would pass C22 and C23 while breaking every run.
    expected: 'pass',
    apply(root) {
      gitInitMirror(root);
      return 'made the mirror a git work tree with every file committed';
    },
  },

  // --- 6. the contract itself is truncated -------------------------------
  {
    id: 'C19',
    label: 'the required-gate contract is emptied',
    expected: 'fail',
    apply(root) {
      const src = readMirror(root, parityRel);
      let next = src;
      for (const id of MUTANTS.contractIds) next = removeObjectEntry(next, `id: '${id}'`);
      writeMirror(root, parityRel, next);
      return `removed all ${MUTANTS.contractIds.length} contract entries`;
    },
  },
  {
    id: 'C20',
    label: 'the contract loses ONE Phase 28 entry while keeping the rest',
    // This is the important one: C19 is caught by the size check, so a mutant
    // that trips the size check proves nothing about whether the per-entry
    // guards work. Here the contract is still 16 entries — large enough to
    // satisfy the size guard — and only the explicit Phase 28 id guard can
    // catch it.
    expected: 'fail',
    apply(root) {
      const src = readMirror(root, parityRel);
      const next = removeObjectEntry(src, "id: 'p28-storage-backup'").replace(
        /\n\s*\/\/ --- Phase 28 gates, wired in by Phase 29 after the independent review ---/,
        '\n  /* Phase 28 gates, wired in by Phase 29 after the independent review */\n  // The storage-backup entry has been dropped.',
      );
      writeMirror(root, parityRel, next);
      return 'dropped only p28-storage-backup, leaving 16 entries';
    },
  },
];

// Filled in below; kept on MUTANTS so C19 can enumerate them.
MUTANTS.contractIds = [
  'p23-w1-metadata', 'p23-w3-routes', 'p23-w5-config', 'p23-w6-audit', 'p23-w6-triage',
  'p23-w2-auth-suite', 'p23-w9-migrations', 'p23-w10-artifact', 'p23-w1-metadata-mutate',
  'p23-w3-routes-mutate', 'p23-w5-config-mutate', 'p24-d2-lifetime-mutate',
  'p28-n12-mutate', 'p28-storage-backup', 'p28-db-suites', 'p29-ci-parity', 'p29-ci-integration-mutate',
  // Phase 36 (P35-1, P34-1).
  'p36-image-optimizer', 'p36-image-optimizer-mutate',
  'p36-dependency-floor', 'p36-dependency-floor-mutate',
];

// ---------------------------------------------------------------------------
// Run the gate against a mirror
// ---------------------------------------------------------------------------
function runParity(root) {
  // Phase 32. `PATH` and `HOME` are deliberately NOT forwarded.
  //
  // They used to be, and that was the entire cause of hosted run 36618193752's
  // `api` job failure. The child is spawned by ABSOLUTE interpreter path
  // (`process.execPath`) and `--list` executes nothing, so it needs neither to
  // resolve nor to run; forwarding them only made this file *read* `PATH` and
  // `HOME`, which `verify-config-contract.mjs` then correctly reported as two
  // environment variables that are read by code and documented in no template.
  //
  // The failure was real and the contract was right to raise it. The defect was
  // the unnecessary dependency, not the assertion, so the dependency is removed
  // here rather than the assertion being relaxed in the config contract. A
  // harness that inherited the developer's PATH made the gate's result depend on
  // whose shell ran it; this one is now identical on a laptop and on a runner.
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-ci-parity.mjs'), '--list'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    env: { CI: '1', FORCE_COLOR: '0' },
  });
  const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  return {
    status: res.status,
    signal: res.signal,
    timedOut: res.error?.code === 'ETIMEDOUT',
    problems: output
      .split('\n')
      .filter((l) => /^\s+- /.test(l))
      .map((l) => l.replace(/^\s+- /, '').slice(0, 220)),
    output,
  };
}

// The real files, so a leak is caught even though nothing writes to them.
const preRun = {
  workflow: readFileSync(path.join(repoRoot, workflowRel), 'utf8'),
  parity: readFileSync(path.join(repoRoot, parityRel), 'utf8'),
  apiPkg: readFileSync(path.join(repoRoot, apiPkgRel), 'utf8'),
  n12Script: readFileSync(path.join(repoRoot, 'scripts', 'mutate-rate-limit-n12.mjs'), 'utf8'),
  storageScript: readFileSync(path.join(repoRoot, 'scripts', 'verify-storage-backup-restore.mjs'), 'utf8'),
  dbSuiteScript: readFileSync(path.join(repoRoot, 'scripts', 'run-db-suites.mjs'), 'utf8'),
};

let failures = 0;

log('Phase 29 (F-2) — mutation test of the CI-integration control\n');
log('  Every mutant below must be DETECTED by scripts/verify-ci-parity.mjs.');
log('  Mutants are applied to a throwaway mirror; the real files are never written.\n');

// ---------------------------------------------------------------------------
// CONTROL. An unmutated mirror must pass, or a failing mutant means nothing.
// ---------------------------------------------------------------------------
log('  CONTROL  (unmutated mirror — the contract must hold)');
{
  const root = makeMirror();
  const res = runParity(root);
  if (res.status !== 0) {
    log('      FAIL  the unmutated repository FAILS its own CI-parity contract.');
    for (const p of res.problems) log(`        - ${p}`);
    log('        Fix the contract before trusting any mutant result.');
    failures += 1;
  } else {
    log('        -> green, so a red mutant is attributable to the mutation\n');
  }
}

for (const m of MUTANTS) {
  if (only && !only.has(m.id)) continue;
  log(`  ${m.id}  ${m.label}`);

  const root = makeMirror();
  let description;
  try {
    description = m.apply(root);
  } catch (err) {
    log(`      FAIL  the mutant could not be applied: ${err?.message ?? String(err)}`);
    log('        A mutant that does not apply proves nothing.');
    failures += 1;
    continue;
  }

  // The edit must have changed something. A no-op mutant would produce a
  // "detected, as required" verdict that demonstrates nothing at all.
  const MIRROR_SOURCE = { [workflowRel]: 'workflow', [parityRel]: 'parity', [apiPkgRel]: 'apiPkg' };
  const changed = Object.keys(MIRROR_SOURCE).filter(
    (r) => readFileSync(path.join(root, r), 'utf8') !== preRun[MIRROR_SOURCE[r]],
  );
  const renamed = !existsSync(path.join(root, 'scripts', 'verify-storage-backup-restore.mjs'));
  // Phase 36 (P35-2). A mutant that only changes the GIT INDEX — committing the
  // mirror, or removing a file from the index while leaving it on disk — changes
  // no file content, so the content comparison above cannot see it and would
  // score such a mutant as a no-op. That verdict would be wrong twice: the
  // mutant did apply, and rejecting it would delete the only coverage the
  // untracked-artifact protection has. Git state is therefore its own change
  // signal, and a mirror that became a work tree counts as changed.
  const becameWorkTree = existsSync(path.join(root, '.git'));
  if (changed.length === 0 && !renamed && !becameWorkTree) {
    log('      FAIL  the mutant did not change the mirror. Its result would be meaningless.');
    failures += 1;
    continue;
  }
  log(
    `        applied: ${description} [${changed.length} file(s) changed` +
      `${renamed ? ' + 1 rename' : ''}${becameWorkTree ? ' + git index' : ''}]`,
  );

  // A mutant that leaves the gate's own source unparseable has not tested
  // anything: `node` exits 1 on a SyntaxError, which is indistinguishable
  // from the gate correctly rejecting the mutant. That is a vacuous green,
  // and five mutants scored it before this check existed. Any mutant that
  // edits JS must leave JS that parses.
  if (changed.includes(parityRel)) {
    const parse = isParseableJs(path.join(root, parityRel));
    if (!parse.ok) {
      log(`      FAIL  the mutant left scripts/verify-ci-parity.mjs unparseable (${parse.reason}).`);
      log('            A syntax error makes node exit 1 whatever the contract says, so this');
      log('            mutant cannot distinguish detection from breakage. Fix the harness.');
      failures += 1;
      continue;
    }
  }

  const res = runParity(root);
  const detected = res.status !== 0 && !res.timedOut && res.signal === null;

  if (m.expected === 'fail') {
    if (detected) {
      log(`        -> DETECTED (exit=${res.status}), as required:`);
      for (const p of res.problems.slice(0, 3)) log(`             ${p}`);
    } else {
      log(`      FAIL  NOT DETECTED (exit=${res.status}${res.timedOut ? ' TIMEOUT' : ''}).`);
      log('            The CI contract claims to require this gate and does not. Fix the verifier.');
      failures += 1;
    }
  } else {
    // A positive control whose verdict is not printed is a check nobody can
    // read, which is the same failure as not having it. An earlier version of
    // this harness had no `else` at all, so C21 ran and its result was simply
    // absent from the output.
    if (detected) {
      log(`      FAIL  a FALSE POSITIVE (exit=${res.status}). The gate still works, so the contract`);
      log('            must hold. Rejecting a correctly-wired refactor would train people to stop');
      log('            renaming things rather than to keep gates wired.');
      for (const p of res.problems.slice(0, 3)) log(`             ${p}`);
      failures += 1;
    } else {
      log('        -> correctly NOT detected: the gate still works, so the contract still holds.');
    }
  }
  log('');
}

if (!keepMirrors) {
  for (const m of createdMirrors) rmSync(m, { recursive: true, force: true });
  log(`  ${createdMirrors.length} throwaway mirror(s) removed.`);
} else {
  log(`  ${createdMirrors.length} mirror(s) kept under ${createdMirrors.join(', ')}`);
}
log('');

// Byte-identity of every real file this harness could conceivably have touched.
log('  POST-CONDITION  (the real files must be byte-identical)');
for (const [label, file, before] of [
  ['.github/workflows/ci.yml', workflowRel, preRun.workflow],
  ['scripts/verify-ci-parity.mjs', parityRel, preRun.parity],
  ['apps/api/package.json', apiPkgRel, preRun.apiPkg],
  ['scripts/mutate-rate-limit-n12.mjs', 'scripts/mutate-rate-limit-n12.mjs', preRun.n12Script],
  ['scripts/verify-storage-backup-restore.mjs', 'scripts/verify-storage-backup-restore.mjs', preRun.storageScript],
  ['scripts/run-db-suites.mjs', 'scripts/run-db-suites.mjs', preRun.dbSuiteScript],
]) {
  const after = readFileSync(path.join(repoRoot, file), 'utf8');
  if (after === before) {
    log(`    ok    ${label} is unchanged`);
  } else {
    log(`    FAIL  ${label} was modified. A leaked mutant corrupts every later phase.`);
    writeFileSync(path.join(repoRoot, file), before);
    failures += 1;
  }
}

log('');
if (failures) {
  log(`  RESULT  FAIL — ${failures} problem(s). The CI integration is not proven to be`);
  log('          protected against CI drift. Do not treat F-2 as closed.');
  process.exit(1);
}
log('  RESULT  PASS — every Phase 28 CI gate is enforced by the CI contract, the contract');
log('          cannot be satisfied by a comment or an advisory step, and the real files were');
log('          never written.');
log('');
log('  NOT PROVEN BY THIS HARNESS: that GitHub Actions runs this workflow. Nothing here');
log('  executes on a hosted runner, and no hosted result is claimed.');
