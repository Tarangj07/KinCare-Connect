#!/usr/bin/env node
/**
 * Phase 36 (P34-1) — mutation test of the dependency security-floor control.
 *
 * `scripts/verify-dependency-security-floor.mjs` exists because the independent
 * Phase 35 review demonstrated that Phase 33's remediation floors were protected
 * by nothing. With the overrides lowered to the HIGH-severity advisory floors in
 * a disposable mirror:
 *
 *     pnpm audit -> moderate 36 -> 38 (advisories 1240100 and 1240101 return),
 *                   high 44 unchanged, critical 4 unchanged
 *     verify-dependency-audit.mjs     EXIT 0
 *     verify-dependency-triage.mjs    EXIT 0
 *     triage-vulnerabilities.mjs      EXIT 0
 *     verify-ci-parity.mjs --list     EXIT 0
 *
 * Every dependency gate filters to critical and high at
 * `triage-vulnerabilities.mjs:748` BEFORE deciding anything, so below that line
 * the moderate advisories Phase 33 deliberately fixed were invisible. The floors
 * existed only as a YAML comment.
 *
 * A control that has never been shown to fail might not work, so each mutant
 * below attacks one specific way this one could stop protecting anything, and
 * each is checked for TWO things:
 *
 *   1. the mutant was actually APPLIED — a no-op mutant produces a "detected,
 *      as required" verdict that demonstrates nothing;
 *   2. it failed for the INTENDED reason — the output names the floor and the
 *      version that breached it, not a syntax error, a missing parser, or an
 *      unrelated failure.
 *
 * A mutant is rejected outright when it fails for an unintended reason. That is
 * not a theoretical concern in this repository: Phase 34 recorded a result that
 * had to be discarded because `verify-dependency-audit.mjs` failed on a
 * `MODULE_NOT_FOUND` for the Prisma query engine in an incomplete test mirror —
 * a setup artifact scored as a control detecting something.
 *
 * ## Why the lockfile is mutated directly
 *
 * Mutants D5 and D6 edit the RESOLVED GRAPH in `pnpm-lock.yaml` without
 * reinstalling. That is not laziness — it is the point. The control reads the
 * lockfile because the lockfile is what a `--frozen-lockfile` install consumes.
 * A `pnpm-workspace.yaml` that declares the correct override while the lockfile
 * still resolves the vulnerable version is precisely the drift a check must
 * catch, and it is invisible to a control that reads the declaration instead.
 * D5 produces that state with a correct override; D6 produces the state a
 * partially-applied or hand-edited install would leave behind.
 *
 * ## What this harness does NOT do
 *
 * It never runs `pnpm install`, never touches `pnpm-workspace.yaml` in the real
 * repository, and never writes outside a throwaway mirror. The repository's
 * lockfile and overrides are byte-compared at the end regardless of outcome.
 *
 * Usage:  node scripts/mutate-dependency-security-floor.mjs [--only D1,D2] [--keep]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireCjs = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gateRel = path.join('scripts', 'verify-dependency-security-floor.mjs');
const lockRel = 'pnpm-lock.yaml';
const workspaceRel = 'pnpm-workspace.yaml';
/** Phase 37 (R36-03): the floors live in this policy file, not in the gate. */
const policyRel = 'security/dependency-security-floor.json';

const only = process.argv.includes('--only')
  ? new Set((process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').map((s) => s.trim()))
  : null;
const keepMirrors = process.argv.includes('--keep');

const log = (m) => console.log(m);
const createdMirrors = [];

// The `yaml` parser, resolved exactly as the gate resolves it.
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

function makeMirror() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p36-floor-mutate-'));
  createdMirrors.push(root);
  cpSync(path.join(repoRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, lockRel), path.join(root, lockRel));
  cpSync(path.join(repoRoot, workspaceRel), path.join(root, workspaceRel));
  // Phase 37 (R36-03). The floors moved out of the gate into a policy file, so
  // a mirror without it is an incomplete tree: the gate fails closed on a
  // missing policy, and every mutant would score as "detected" for a setup
  // reason. This is the same class of defect this harness already rejects
  // mutants for, caught here by running the unmutated CONTROL.
  mkdirSync(path.join(root, 'security'), { recursive: true });
  cpSync(path.join(repoRoot, policyRel), path.join(root, policyRel));
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
}

function readMirror(root, rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}
function writeMirror(root, rel, content) {
  writeFileSync(path.join(root, rel), content);
}

/**
 * Rewrite one lockfile resolution: rename the `name@old` key to `name@new` and
 * repoint every reference to it in both the `packages:` and `snapshots:`
 * sections, so the mirror stays a coherent graph rather than a text match.
 *
 * Done through the YAML parser, not a regex. A regex over `pnpm-lock.yaml` would
 * happily rewrite a version number inside a comment, an integrity hash or an
 * unrelated package whose name contains the target's, producing a mutant that
 * "passes" for a reason that has nothing to do with the floor.
 */
function setResolvedVersion(root, pkgName, fromVersion, toVersion) {
  const lock = YAML.parse(readMirror(root, lockRel));
  const fromKey = `${pkgName}@${fromVersion}`;
  const toKey = `${pkgName}@${toVersion}`;
  let found = false;

  for (const section of ['packages', 'snapshots']) {
    const block = lock[section];
    if (!block || typeof block !== 'object') continue;
    if (Object.hasOwn(block, fromKey)) {
      block[toKey] = block[fromKey];
      delete block[fromKey];
      found = true;
      continue;
    }
    // Repoint dependents whose resolved dependency names the old version.
    for (const entry of Object.values(block)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
        if (entry[field] && Object.hasOwn(entry[field], pkgName) && entry[field][pkgName] === fromVersion) {
          entry[field][pkgName] = toVersion;
          found = true;
        }
      }
    }
  }

  if (!found) throw new Error(`the lockfile has no reference to ${fromKey}; the mutant would be a no-op`);
  writeMirror(root, lockRel, YAML.stringify(lock));
  return `resolved graph: ${fromKey} -> ${toKey}`;
}

/** Edit a `pnpm-workspace.yaml` override target without touching the lockfile. */
function setOverrideTarget(root, pkgName, toVersion) {
  const src = readMirror(root, workspaceRel);
  const re = new RegExp(`^(\\s*'${pkgName.replace('/', '\\/')}@[^']*':\\s*)[^\\s]+$`, 'm');
  if (!re.test(src)) throw new Error(`no override entry for ${pkgName} in ${workspaceRel}`);
  const next = src.replace(re, `$1${toVersion}`);
  writeMirror(root, workspaceRel, next);
  return `override declaration for ${pkgName} -> ${toVersion} (lockfile left untouched)`;
}

/**
 * Phase 37 (R36-03). Edit the POLICY file, not the gate source.
 *
 * The floors moved out of `verify-dependency-security-floor.mjs` into
 * `security/dependency-security-floor.json`, because a control that stores its
 * own configuration cannot police that configuration — the reviewer showed that
 * editing one line of the gate lowered the floor with every other gate green.
 * D11 and D12 therefore mutate the policy, which is where the defect now lives.
 */
function editFloors(root, fn) {
  const src = readMirror(root, policyRel);
  const next = fn(src);
  if (next === src) throw new Error('the floors edit changed nothing; the mutant would be a no-op');
  writeMirror(root, policyRel, next);
  return next;
}

/** Parse and re-serialise the policy JSON so an edit stays well-formed. */
function editPolicyJson(root, fn) {
  const policy = JSON.parse(readMirror(root, policyRel));
  const next = fn(policy);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (text === readMirror(root, policyRel)) throw new Error('the policy edit changed nothing; the mutant would be a no-op');
  writeMirror(root, policyRel, text);
}

function runGate(root) {
  const res = spawnSync(process.execPath, [path.join(root, gateRel), '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    env: { CI: '1', FORCE_COLOR: '0' },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout ?? '');
  } catch {
    /* scored below on the raw output */
  }
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  // The verdicts come from the PARSED result, never from matching lines in the
  // output. An earlier version of this harness grepped for `BREACH`/`REVIEW` at
  // the start of a line, which works for the human-readable report and silently
  // matches nothing at all under `--json`, where each verdict is a quoted value
  // on its own line. That made every mutant look like it produced no verdict.
  const results = parsed?.results ?? [];
  const of = (verdict) => results.filter((r) => r.verdict === verdict);
  return {
    status: res.status,
    text,
    parsed,
    results,
    breached: of('BREACH'),
    reviewed: of('REVIEW'),
    removed: of('REMOVED'),
    ok: of('OK'),
  };
}

/** A mutant that edits JS must leave JS that parses, or `node` exits 1 regardless. */
function isParseableJs(file) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 60_000 });
  return res.status === 0 ? { ok: true } : { ok: false, reason: (res.stderr ?? '').split('\n').slice(0, 6).join(' | ') };
}

const MUTANTS = [
  // --- the P34-1 case: the remediation is lowered ------------------------
  {
    id: 'D1',
    label: 'brace-expansion 1.x is resolved BELOW the approved floor (1.1.21)',
    expected: 'fail',
    mustMention: ['brace-expansion', '1.1.20', '1.1.21', 'BELOW'],
    apply(root) {
      return setResolvedVersion(root, 'brace-expansion', '1.1.21', '1.1.20');
    },
  },
  {
    id: 'D2',
    label: 'brace-expansion 2.x is resolved BELOW the approved floor (2.1.7)',
    expected: 'fail',
    mustMention: ['brace-expansion', '2.1.6', '2.1.7', 'BELOW'],
    apply(root) {
      return setResolvedVersion(root, 'brace-expansion', '2.1.7', '2.1.6');
    },
  },
  {
    id: 'D3',
    label: 'undici is resolved BELOW the approved floor (6.28.1)',
    expected: 'fail',
    mustMention: ['undici', '6.28.0', '6.28.1', 'BELOW'],
    apply(root) {
      return setResolvedVersion(root, 'undici', '6.28.1', '6.28.0');
    },
  },

  // --- a real regression shape: the override is REMOVED -------------------
  {
    id: 'D4',
    label: 'the brace-expansion 1.x override entry is deleted from pnpm-workspace.yaml',
    // Does not reinstall, so the lockfile still resolves the patched version.
    // The control must therefore report OK — and that is the CORRECT answer,
    // because the resolved graph is what a frozen-lockfile install produces.
    // What this mutant really pins down is that the control is not simply
    // reading `pnpm-workspace.yaml` and calling it a day; D5 below is the
    // mutant that makes the two disagree.
    expected: 'pass',
    apply(root) {
      const src = readMirror(root, workspaceRel);
      const next = src.replace(/^\s*'brace-expansion@>=1\.0\.0 <1\.1\.21':.*\n/m, '');
      if (next === src) throw new Error('the override entry was not found');
      writeMirror(root, workspaceRel, next);
      return 'removed the brace-expansion 1.x override declaration (lockfile unchanged, so the graph still resolves 1.1.21)';
    },
  },

  // --- drift: correct declaration, wrong graph ----------------------------
  {
    id: 'D5',
    label: 'the override DECLARATION is correct but the LOCKFILE still resolves the vulnerable version',
    // The regression a declaration-only check cannot see: a stale lockfile, a
    // partially applied install, or a hand edit to the lockfile. The control
    // must fail, and it can only do so by reading the resolved graph.
    expected: 'fail',
    mustMention: ['brace-expansion', '1.1.20', 'BELOW'],
    apply(root) {
      const override = setOverrideTarget(root, 'brace-expansion', '1.1.21');
      const graph = setResolvedVersion(root, 'brace-expansion', '1.1.21', '1.1.20');
      return `${override}; ${graph}`;
    },
  },
  {
    id: 'D6',
    label: 'the lockfile alone is edited to a vulnerable version (no install run)',
    expected: 'fail',
    mustMention: ['brace-expansion', '1.1.20', 'BELOW'],
    apply(root) {
      return setResolvedVersion(root, 'brace-expansion', '1.1.21', '1.1.20');
    },
  },

  // --- legitimate movements the control must NOT punish -------------------
  {
    id: 'D7',
    label: 'POSITIVE CONTROL: a coordinated UPGRADE above the floor (1.1.21 -> 1.1.22)',
    // A floor, not a pin. This is the difference that keeps the control usable:
    // if a future advisory fixes at 1.1.22, the remedy is to upgrade, and the
    // gate must be green without editing this script. A control that failed
    // here would push people to relax the floor instead of remediate.
    expected: 'pass',
    apply(root) {
      return setResolvedVersion(root, 'brace-expansion', '1.1.21', '1.1.22');
    },
  },
  {
    id: 'D8',
    label: 'POSITIVE CONTROL: the dependency is genuinely GONE from the graph',
    // Removing a dependency removes the advisory with it. That is a legitimate
    // end state and must not be a failure — and must not be a pass by
    // omission either, which is why the control has a distinct REMOVED verdict.
    expected: 'pass',
    mustMention: ['REMOVED'],
    apply(root) {
      const lock = YAML.parse(readMirror(root, lockRel));
      let removed = 0;
      for (const section of ['packages', 'snapshots']) {
        const block = lock[section];
        if (!block || typeof block !== 'object') continue;
        for (const key of Object.keys(block)) {
          const at = key.lastIndexOf('@');
          if (at <= 0) continue;
          if (key.slice(0, at) !== 'undici') continue;
          delete block[key];
          removed += 1;
        }
        for (const entry of Object.values(block)) {
          if (entry && typeof entry === 'object' && entry.dependencies?.undici) {
            delete entry.dependencies.undici;
            removed += 1;
          }
        }
      }
      if (removed === 0) throw new Error('no undici reference was removed; the mutant would be a no-op');
      writeMirror(root, lockRel, YAML.stringify(lock));
      return `removed ${removed} undici reference(s) from the resolved graph`;
    },
  },
  {
    id: 'D9',
    label: 'POSITIVE CONTROL: an unrelated package is added to the graph',
    // The false-positive guard. The control measures only the packages in
    // FLOORS, so an unrelated resolution must not produce a verdict — not
    // BREACH, and not a spurious REVIEW. If adding `left-pad` could fail this
    // gate, every ordinary dependency change would fail CI.
    expected: 'pass',
    forbiddenVerdicts: ['BREACH', 'REVIEW'],
    apply(root) {
      const lock = YAML.parse(readMirror(root, lockRel));
      lock.snapshots['p36-unrelated-probe@1.0.0'] = { resolution: { integrity: 'sha512-p36' } };
      lock.packages['p36-unrelated-probe@1.0.0'] = { resolution: { integrity: 'sha512-p36' } };
      writeMirror(root, lockRel, YAML.stringify(lock));
      return 'added an unrelated package `p36-unrelated-probe@1.0.0` to the graph';
    },
  },
  {
    id: 'D10',
    label: 'POSITIVE CONTROL: a NEW MAJOR of a floored package (brace-expansion 3.0.0)',
    // Not a failure and not a pass: REVIEW. A new major cannot be measured
    // against a floor written for another major. Guessing would either fail a
    // legitimate upgrade or, worse, wave through a vulnerable one, so the
    // honest answer is to make a human look. `expected: 'review'` below is the
    // assertion that the control has that third state at all.
    expected: 'review',
    mustMention: ['REVIEW', '3'],
    apply(root) {
      const lock = YAML.parse(readMirror(root, lockRel));
      lock.snapshots['brace-expansion@3.0.0'] = { resolution: { integrity: 'sha512-p36' } };
      lock.packages['brace-expansion@3.0.0'] = { resolution: { integrity: 'sha512-p36' } };
      writeMirror(root, lockRel, YAML.stringify(lock));
      return 'added brace-expansion@3.0.0 to the graph';
    },
  },

  // --- the control losing its teeth --------------------------------------
  {
    id: 'D11',
    label: 'the floor policy is emptied',
    // A contract that can be silently emptied makes every check vacuous —
    // exactly the "green that means nothing" outcome `verify-ci-parity.mjs`
    // already guards against for its own REQUIRED_GATES with a size check.
    //
    // PHASE 37 CHANGES THIS MUTANT'S MEANING, and the change is the point.
    // When the floors lived in the gate source, emptying them was tolerated
    // (expected: 'pass'), because nothing could detect it — that unmitigated
    // gap IS R36-03. Now the floors live in a policy file that is validated
    // for being non-empty before anything is asserted, so the same mutation is
    // a FAILURE. The expectation inverted because the control improved, and the
    // mutant is retained precisely so that inversion cannot silently regress.
    expected: 'refuse',
    mustMention: ['zero floors', 'R36-03'],
    apply(root) {
      editPolicyJson(root, (p) => {
        p.floors = [];
        return p;
      });
      return 'emptied the `floors` array in the policy file';
    },
  },
  {
    id: 'D12',
    label: 'a floor is RAISED above every existing version (an accidental pin)',
    // The other direction of the same design error, and the more dangerous one
    // for adoption: a floor set to a version nobody has, which turns an
    // upgrade into a permanent CI failure until somebody notices. This MUST be
    // detected by the harness, because the gate cannot distinguish it from a
    // real breach — and that is precisely the argument for the control
    // recording the advisory behind each floor in prose.
    expected: 'fail',
    mustMention: ['1.1.99', 'BELOW'],
    apply(root) {
      editPolicyJson(root, (p) => {
        p.floors[0].minimum = '1.1.99';
        return p;
      });
      return "raised the brace-expansion 1.x floor to 1.1.99, above every version in the graph";
    },
  },
];

// ---------------------------------------------------------------------------
const preRun = {
  gate: readFileSync(path.join(repoRoot, gateRel), 'utf8'),
  lock: readFileSync(path.join(repoRoot, lockRel), 'utf8'),
  workspace: readFileSync(path.join(repoRoot, workspaceRel), 'utf8'),
  policy: readFileSync(path.join(repoRoot, policyRel), 'utf8'),
};

let failures = 0;
log('Phase 36 (P34-1) — mutation test of the dependency security-floor control\n');
log('  Every mutant below must be detected for the INTENDED reason, or be a');
log('  legitimate movement the control must not punish. Mutants are applied to a');
log('  throwaway mirror; the real lockfile, overrides and gate are never written.\n');

log('  CONTROL  (unmutated mirror — every resolved instance must be at or above its floor)');
{
  const root = makeMirror();
  const res = runGate(root);
  if (res.status !== 0) {
    log('      FAIL  the unmutated repository FAILS its own security-floor control.');
    log(`        exit=${res.status} ${res.text}`.slice(-1200));
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

  // The edit must have changed something. Phase 37: the policy file is one of
  // the three artifacts a mutant may legitimately change (lockfile, overrides,
  // policy), so it is part of the change signal. Without this, D11 and D12 —
  // which now edit the policy — would be scored as no-ops and their coverage
  // would be silently discarded.
  const changed =
    readFileSync(path.join(root, lockRel), 'utf8') !== preRun.lock ||
    readFileSync(path.join(root, workspaceRel), 'utf8') !== preRun.workspace ||
    readFileSync(path.join(root, gateRel), 'utf8') !== preRun.gate ||
    readFileSync(path.join(root, policyRel), 'utf8') !== preRun.policy;
  if (!changed) {
    log('      FAIL  the mutant did not change the mirror. Its result would be meaningless.');
    failures += 1;
    continue;
  }
  log(`        applied: ${description}`);

  if (readFileSync(path.join(root, gateRel), 'utf8') !== preRun.gate) {
    const parse = isParseableJs(path.join(root, gateRel));
    if (!parse.ok) {
      log(`      FAIL  the mutant left the gate unparseable (${parse.reason}).`);
      log('            A syntax error makes node exit 1 whatever the gate says.');
      failures += 1;
      continue;
    }
  }

  const res = runGate(root);
  const text = res.text;
  const verdicts = res.results.map((r) => r.verdict);

  if (m.expected === 'fail' || m.expected === 'refuse') {
    if (res.status === 0) {
      log('      FAIL  NOT DETECTED (exit=0). The floor control claims to enforce this floor and does not.');
      failures += 1;
      continue;
    }
    // --- the reason must be the intended one
    const missing = (m.mustMention ?? []).filter((t) => !text.includes(t));
    if (missing.length > 0) {
      log(`      FAIL  detected, but NOT for the intended reason — the output never mentions: ${missing.join(', ')}`);
      log('            A detection that fails for an unrelated cause scores nothing. This is the trap that made');
      log('            a Phase 34 result unusable (a MODULE_NOT_FOUND in an incomplete mirror).');
      log(`            raw output: ${text.trim().slice(-600)}`);
      failures += 1;
      continue;
    }
    // Phase 37. A `refuse` mutant is one the gate must REJECT STRUCTURALLY —
    // before it evaluates anything — rather than one that produces a BREACH
    // verdict against a readable policy. An empty or malformed policy is
    // exactly that case: there is nothing to compare, so the only correct
    // behaviour is to fail closed without a verdict. Requiring a BREACH here
    // would have scored the correct behaviour as an unrelated failure, and
    // "fixing" the gate to emit one would have meant asserting against a policy
    // that has no floors in it.
    if (m.expected === 'refuse') {
      log(`        -> DETECTED (exit=${res.status}) by refusing to evaluate: the policy is not certifiable`);
      log('           (no verdict can be produced from an empty policy; failing closed IS the assertion)');
      continue;
    }
    if (!res.breached.length) {
      log(`      FAIL  the gate exited non-zero but reported no BREACH verdict (verdicts: ${verdicts.join(', ') || 'none'}).`);
      log(`            raw output: ${text.trim().slice(-600)}`);
      failures += 1;
      continue;
    }
    log(`        -> DETECTED (exit=${res.status}) for the intended reason:`);
    for (const r of res.breached.slice(0, 2)) log(`             [BREACH] ${r.floor}: ${r.detail.split('\n')[0]}`);
  } else if (m.expected === 'review') {
    if (res.status !== 0) {
      log(`      FAIL  a new major produced exit=${res.status}; it must be REVIEW, not a failure.`);
      failures += 1;
      continue;
    }
    if (!res.reviewed.length) {
      log(`      FAIL  a new major produced no REVIEW verdict (verdicts: ${verdicts.join(', ') || 'none'}). The`);
      log('            third state does not exist, so an unfamiliar major is silently treated as compliant.');
      failures += 1;
      continue;
    }
    log('        -> REVIEW, as required: a new major forces a human decision rather than a guess');
    for (const r of res.reviewed.slice(0, 2)) log(`             [REVIEW] ${r.floor}`);
  } else {
    // --- must NOT fail, and must not produce a spurious finding
    if (res.status !== 0) {
      log(`      FAIL  a legitimate movement produced exit=${res.status}. A floor that punishes a correct`);
      log('            upgrade, a genuine removal, or an unrelated dependency trains people to relax');
      log('            the floor instead of remediating.');
      for (const r of res.results.slice(0, 3)) log(`             [${r.verdict}] ${r.floor}: ${r.detail.split('\n')[0]}`);
      failures += 1;
      continue;
    }
    const spurious = verdicts.filter((v) => (m.forbiddenVerdicts ?? []).includes(v));
    if (spurious.length > 0) {
      log(`      FAIL  the control reported ${spurious.join(', ')} for a tree it should say nothing about.`);
      failures += 1;
      continue;
    }
    if ((m.mustMention ?? []).some((t) => !text.includes(t))) {
      log('      FAIL  the expected verdict text is absent, so this control no longer distinguishes');
      log('            REMOVED/REVIEW from a silent pass.');
      failures += 1;
      continue;
    }
    log('        -> correctly NOT detected: this movement is legitimate and the floor still holds');
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

log('  POST-CONDITION  (the real files must be byte-identical)');
for (const [label, file, before] of [
  ['scripts/verify-dependency-security-floor.mjs', gateRel, preRun.gate],
  ['pnpm-lock.yaml', lockRel, preRun.lock],
  ['pnpm-workspace.yaml', workspaceRel, preRun.workspace],
  ['security/dependency-security-floor.json', policyRel, preRun.policy],
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
  log(`  RESULT  FAIL — ${failures} problem(s). The dependency security floor is not proven to be`);
  log('          protected. Do not treat P34-1 as closed.');
  process.exit(1);
}
log('  RESULT  PASS — a lowered override, a stale lockfile and an off-graph lockfile edit are all');
log('          detected for the right reason, while a correct upgrade, a genuine removal and an');
log('          unrelated dependency are all correctly tolerated.');
log('');
log('  NOT PROVEN BY THIS HARNESS: that the floors are the CORRECT floors for every future');
log('  advisory. It proves the control enforces the floors recorded in the gate source.');
process.exit(0);
