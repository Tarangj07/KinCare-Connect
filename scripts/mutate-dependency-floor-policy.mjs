#!/usr/bin/env node
/**
 * Phase 37 (R36-03) — mutation test of the floor-POLICY protection control.
 *
 * `scripts/verify-dependency-floor-policy.mjs` exists because the independent
 * Phase 36 review demonstrated the floor gate was undefended against its own
 * configuration. The floors lived in `const FLOORS` inside the gate, so
 * lowering one was a one-line edit to the very file that enforced it:
 *
 *     floor 1.1.21/2.1.7 -> 1.1.20/2.1.6, graph genuinely re-resolved by pnpm
 *       verify-dependency-security-floor   EXIT 0
 *       verify-dependency-triage           EXIT 0
 *       verify-dependency-audit            EXIT 0
 *       verify-config-contract             EXIT 0
 *       verify-ci-parity --list            EXIT 0
 *       triage-vulnerabilities             EXIT 0
 *
 * A control that has never been shown to fail might not work, so each mutant
 * below attacks one specific way this one could stop protecting anything.
 *
 * ## The three scoring states, and why they must not be conflated
 *
 * This harness distinguishes outcomes that all end in a non-zero exit:
 *
 *   `fail`    the gate evaluated the policy and reported a specific named
 *             finding. Something was measured.
 *   `refuse`  the gate declined to evaluate at all — an empty or malformed
 *             policy. Failing closed without a verdict IS the correct
 *             behaviour here, and a harness that demanded a verdict would be
 *             demanding the gate assert something about a policy that has
 *             nothing in it.
 *   `pass`    a legitimate movement the control must not punish. Recorded
 *             explicitly, because a control that fails everything is not a
 *             control.
 *
 * And the state this harness exists to make visible:
 *
 *   `setup`   the mutant failed because the TEST broke — a syntax error, a
 *             missing file, a missing dependency — not because the security
 *             property was violated. These are DISCARDS, never detections.
 *             The Phase 34 review had to throw away a result that was a
 *             MODULE_NOT_FOUND in an incomplete mirror but had been scored as
 *             "the gate detected it"; conflating those two is how a broken
 *             harness reports a secure system.
 *
 * ## Method
 *
 * Every mutant is applied to a throwaway mirror containing only what the gate
 * reads: the policy file, `pnpm-workspace.yaml`, `scripts/`, and a symlink to
 * the shared `node_modules` store. The real files are never opened for writing
 * and their byte-identity is asserted at the end regardless of how the run
 * ended.
 *
 * Policy mutations go through the JSON parser, never a text match. A regex over
 * a JSON file can rewrite a version inside the `why` prose or an advisory id
 * and produce a mutant that "passes" for a reason unrelated to the floor.
 *
 * Usage:  node scripts/mutate-dependency-floor-policy.mjs [--only P1,P2] [--keep]
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gateRel = path.join('scripts', 'verify-dependency-floor-policy.mjs');
const policyRel = path.join('security', 'dependency-security-floor.json');
const workspaceRel = 'pnpm-workspace.yaml';
const lockRel = 'pnpm-lock.yaml';
const workflowRel = path.join('.github', 'workflows', 'ci.yml');
const parityRel = path.join('scripts', 'verify-ci-parity.mjs');

const only = process.argv.includes('--only')
  ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',').map((s) => s.trim()))
  : null;
const keepMirrors = process.argv.includes('--keep');

const log = (m) => console.log(m);
const createdMirrors = [];

function loadYaml() {
  const require_ = createRequire(import.meta.url);
  const candidates = [
    'yaml',
    ...(existsSync(path.join(repoRoot, 'node_modules/.pnpm'))
      ? require_('node:fs')
        .readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
        .filter((d) => d.startsWith('yaml@'))
        .map((d) => path.join(repoRoot, 'node_modules/.pnpm', d, 'node_modules/yaml'))
      : []),
  ];
  for (const c of candidates) {
    try {
      return require_(c);
    } catch {
      /* next */
    }
  }
  throw new Error('could not load the `yaml` parser from the dependency graph');
}
const YAML = loadYaml();

function makeMirror() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecc-p37-floor-policy-'));
  createdMirrors.push(root);
  mkdirSync(path.join(root, 'security'), { recursive: true });
  mkdirSync(path.join(root, path.dirname(workflowRel)), { recursive: true });
  // The parity contract resolves EVERY step's command, not only the declared
  // required gates, so it reads the package.json of every package a step
  // filters on. A mirror that omits one makes P8 fail with MODULE_NOT_FOUND or
  // an unparseable-package complaint — a setup failure that looks exactly like
  // a detection. The unmutated CONTROL is what catches that, which is why it
  // runs first and why its verdict gates the meaning of every mutant below.
  for (const pkg of ['api', 'web', 'mobile']) {
    mkdirSync(path.join(root, 'apps', pkg), { recursive: true });
    cpSync(path.join(repoRoot, 'apps', pkg, 'package.json'), path.join(root, 'apps', pkg, 'package.json'));
  }
  mkdirSync(path.join(root, 'apps', 'api', 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, 'apps', 'api', 'scripts'), path.join(root, 'apps', 'api', 'scripts'), {
    recursive: true,
  });
  // The whole scripts/ tree, so every gate the contract names exists and the
  // `yaml` parser and shared helpers resolve.
  cpSync(path.join(repoRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, gateRel), path.join(root, gateRel));
  cpSync(path.join(repoRoot, policyRel), path.join(root, policyRel));
  cpSync(path.join(repoRoot, workspaceRel), path.join(root, workspaceRel));
  // Layer 3 compares the workspace overrides against the lockfile's own
  // resolved overrides, so the mirror needs the lockfile. Without it the
  // CONTROL fails on a missing file and every mutant below becomes
  // meaningless — which is exactly what happened the first time this harness
  // ran, and why the unmutated CONTROL is scored first and separately.
  cpSync(path.join(repoRoot, lockRel), path.join(root, lockRel));
  // The CI-registration mutants need the real workflow and parity contract.
  cpSync(path.join(repoRoot, workflowRel), path.join(root, workflowRel));
  cpSync(path.join(repoRoot, parityRel), path.join(root, parityRel));
  // The parity contract resolves package.json files for its packageScript
  // targets; without them its own control would fail for a setup reason.
  for (const pkg of ['api', 'web', 'mobile']) {
    mkdirSync(path.join(root, 'apps', pkg), { recursive: true });
    cpSync(path.join(repoRoot, 'apps', pkg, 'package.json'), path.join(root, 'apps', pkg, 'package.json'));
  }
  mkdirSync(path.join(root, 'apps', 'api', 'scripts'), { recursive: true });
  cpSync(path.join(repoRoot, 'apps', 'api', 'scripts'), path.join(root, 'apps', 'api', 'scripts'), {
    recursive: true,
  });
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  return root;
}

const readMirror = (root, rel) => readFileSync(path.join(root, rel), 'utf8');
const writeMirror = (root, rel, content) => writeFileSync(path.join(root, rel), content);

/** Edit the policy through the JSON parser so the result stays well-formed. */
function editPolicy(root, fn) {
  const policy = JSON.parse(readMirror(root, policyRel));
  const next = fn(policy);
  if (next === undefined) return; // fn mutated in place and signalled nothing
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (text === readMirror(root, policyRel)) {
    throw new Error('the policy edit produced no change; the mutant would be a no-op');
  }
  writeMirror(root, policyRel, text);
}

/** Write raw text over a file — for the malformed-config mutants. */
function writeRaw(root, rel, content) {
  const before = existsSync(path.join(root, rel)) ? readMirror(root, rel) : null;
  if (before === content) throw new Error('the raw write produced no change; the mutant would be a no-op');
  writeMirror(root, rel, content);
}

/** Lower the target of one pnpm override, through the YAML parser. */
function setOverrideTarget(root, pkgName, toVersion, match = null) {
  const doc = YAML.parse(readMirror(root, workspaceRel));
  let keys = Object.keys(doc.overrides ?? {}).filter((k) => k.slice(0, k.lastIndexOf('@')) === pkgName);
  // `brace-expansion` has TWO override entries, one per major line. Lowering
  // only the first leaves the second above the floor it belongs to, which the
  // gate reports as drift — a detection, but not the one the mutant is meant to
  // test. EST-1 passes `match` to address the intended line explicitly.
  if (match) keys = keys.filter((k) => k.includes(match));
  if (keys.length === 0) throw new Error(`no override for ${pkgName} matching ${JSON.stringify(match)} in pnpm-workspace.yaml`);
  const key = keys[0];
  doc.overrides[key] = toVersion;
  writeMirror(root, workspaceRel, YAML.stringify(doc));
  return `override ${key} -> ${toVersion}`;
}

/**
 * Raise the same override in the LOCKFILE.
 *
 * pnpm writes its own `overrides:` block into `pnpm-lock.yaml`, and that block
 * is what a `--frozen-lockfile` install — which is what CI runs — actually
 * consumes. So a legitimate remediation updates it too. A mirror that changed
 * only `pnpm-workspace.yaml` would leave the two disagreeing, which the gate is
 * right to report; that disagreement is Layer 3, not a false positive.
 */
function setLockOverrideTarget(root, pkgName, toVersion, match = null) {
  const doc = YAML.parse(readMirror(root, lockRel));
  let keys = Object.keys(doc.overrides ?? {}).filter((k) => k.slice(0, k.lastIndexOf('@')) === pkgName);
  // Same reason as setOverrideTarget: the two `brace-expansion` major lines are
  // separate entries and must be addressed separately.
  if (match) keys = keys.filter((k) => k.includes(match));
  if (keys.length === 0) throw new Error(`no override for ${pkgName} matching ${JSON.stringify(match)} in ${lockRel}`);
  const key = keys[0];
  doc.overrides[key] = toVersion;
  writeMirror(root, lockRel, YAML.stringify(doc));
  return `lockfile override ${key} -> ${toVersion}`;
}

/**
 * Lower a RESOLVED package version inside the lockfile.
 *
 * Phase 38, for the EST-1 trust-boundary mutant only. This is the step that
 * makes the boundary real rather than theoretical: without it, the overrides
 * say 1.1.20 but `snapshots:` still resolves 1.1.21, so nothing actually
 * vulnerable would be installed. With it, a frozen-lockfile install genuinely
 * produces the vulnerable graph — which is the condition that makes the
 * four-way edit a real attack rather than a paperwork change.
 */
function setLockResolvedVersion(root, pkgName, fromVersion, toVersion) {
  const doc = YAML.parse(readMirror(root, lockRel));
  let changed = 0;
  for (const section of ['packages', 'snapshots']) {
    const block = doc[section];
    if (!block || typeof block !== 'object') continue;
    const fromKey = `${pkgName}@${fromVersion}`;
    const toKey = `${pkgName}@${toVersion}`;
    if (Object.hasOwn(block, fromKey)) {
      block[toKey] = block[fromKey];
      delete block[fromKey];
      changed += 1;
    }
    for (const entry of Object.values(block)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
        if (entry[field]?.[pkgName] === fromVersion) {
          entry[field][pkgName] = toVersion;
          changed += 1;
        }
      }
    }
  }
  if (changed === 0) throw new Error(`no resolved ${pkgName}@${fromVersion} in the lockfile; the mutant would be a no-op`);
  writeMirror(root, lockRel, YAML.stringify(doc));
  return `resolved graph: ${pkgName}@${fromVersion} -> ${toVersion} (${changed} reference(s))`;
}

function runGate(root, { gate = gateRel, args = ['--json'] } = {}) {
  const res = spawnSync(process.execPath, [path.join(root, gate), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    env: { CI: '1', FORCE_COLOR: '0' },
  });
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout ?? '');
  } catch {
    /* scored on the raw text below */
  }
  const failed = (parsed?.results ?? []).filter((r) => r.verdict === 'FAIL');
  return { status: res.status, text, parsed, failed, results: parsed?.results ?? [] };
}

function isParseableJs(file) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 60_000 });
  return res.status === 0 ? { ok: true } : { ok: false, reason: (res.stderr ?? '').split('\n').slice(0, 4).join(' | ') };
}

/**
 * A gate that dies before it can report is a SETUP failure, not a detection.
 * These signatures are what a broken harness, an unresolvable import or a
 * missing dependency look like, and scoring any of them as "the control
 * detected the mutant" is how a failing test gets reported as a security win.
 */
const SETUP_SIGNATURES = [
  'SyntaxError',
  'MODULE_NOT_FOUND',
  'Cannot find module',
  'ERR_MODULE_NOT_FOUND',
  'ENOENT',
  'is not a function',
  'Cannot read propert',
  'YAMLParseError',
  'JSONParseError',
];

function looksLikeSetupFailure(text) {
  return SETUP_SIGNATURES.find((sig) => text.includes(sig)) ?? null;
}

const MUTANTS = [
  // --- 1. the original defect, one floor at a time -----------------------
  {
    id: 'P1',
    label: 'the brace-expansion 1.x floor is lowered to the high-severity floor (1.1.21 -> 1.1.20)',
    // THE R36-03 MUTANT. Advisory 1240100 is recorded in the policy as fixed
    // only in 1.1.21, so a floor of 1.1.20 does not remediate the advisory the
    // floor exists to close.
    expected: 'fail',
    mustMention: ['1240100', '1.1.21'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = '1.1.20';
        return p;
      });
      return 'floor brace-expansion@1 1.1.21 -> 1.1.20 (advisory records left intact)';
    },
  },
  {
    id: 'P2',
    label: 'the brace-expansion 2.x floor is lowered to the high-severity floor (2.1.7 -> 2.1.6)',
    expected: 'fail',
    mustMention: ['1240101', '2.1.7'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[1].minimum = '2.1.6';
        return p;
      });
      return 'floor brace-expansion@2 2.1.7 -> 2.1.6 (advisory records left intact)';
    },
  },
  {
    id: 'P3',
    label: 'the undici floor is lowered (6.28.1 -> 6.20.0)',
    expected: 'fail',
    mustMention: ['1240042', '6.28.1'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[2].minimum = '6.20.0';
        return p;
      });
      return 'floor undici@6 6.28.1 -> 6.20.0 (advisory records left intact)';
    },
  },

  // --- 2. structural attacks on the policy ------------------------------
  {
    id: 'P4',
    label: 'the undici floor entry is DELETED while the override still forces the remediation',
    // A deleted entry is the quietest version of the same attack: the gate no
    // longer has a floor for undici at all. Deletion must not read as "no
    // problem" the way an absent key did before the policy was validated.
    expected: 'fail',
    mustMention: ['undici', 'override'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors = p.floors.filter((f) => !(f.package === 'undici' && f.majors.includes('6')));
        return p;
      });
      return 'deleted the undici@6 floor entry from the policy';
    },
  },
  {
    id: 'P5',
    label: 'a floor is changed to a MALFORMED value ("latest")',
    // A non-literal is not a floor. The gate must refuse it rather than
    // coercing, string-comparing or silently skipping it.
    expected: 'fail',
    mustMention: ['minimum'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = 'latest';
        return p;
      });
      return 'floor brace-expansion@1 minimum set to the literal string "latest"';
    },
  },
  {
    id: 'P6',
    label: 'a floor is replaced by a COMPUTED / non-literal value',
    // JSON cannot hold an expression, so the honest JSON rendering of a
    // computed value is an object or a nested structure. A gate that reads
    // `minimum` and compares it as a string must refuse this, not coerce it.
    expected: 'fail',
    mustMention: ['minimum'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = { computed: 'resolveFloor("brace-expansion", 1)' };
        return p;
      });
      return 'floor brace-expansion@1 minimum replaced by a computed object';
    },
  },

  // --- 3. the assertion itself, and its CI registration ------------------
  {
    id: 'P7',
    label: 'the advisory record backing a floor is deleted (so the floor has nothing to justify it)',
    // The inverse of P1. P1 lowers the floor and leaves the evidence; this
    // deletes the evidence and leaves the floor. A floor with no advisory
    // record cannot be defended, because nothing states which vulnerability it
    // closes — and it is exactly the state a coordinated edit would produce.
    expected: 'fail',
    mustMention: ['advisories'],
    apply(root) {
      editPolicy(root, (p) => {
        delete p.floors[0].advisories;
        return p;
      });
      return 'deleted the `advisories` array from the brace-expansion@1 floor';
    },
  },
  {
    id: 'P8',
    label: 'the CI step that runs the new gate is deleted from ci.yml',
    // The gate existing but never running is the Phase 28 F-2 defect class,
    // and it is detected here by the parity contract, not by this gate.
    expected: 'fail',
    detectedBy: 'verify-ci-parity',
    mustMention: ['verify-dependency-floor-policy'],
    apply(root) {
      const doc = YAML.parse(readMirror(root, workflowRel));
      const before = JSON.stringify(doc);
      for (const job of Object.values(doc.jobs ?? {})) {
        job.steps = (job.steps ?? []).filter(
          (s) => !String(s.run ?? '').includes('verify-dependency-floor-policy.mjs'),
        );
      }
      if (JSON.stringify(doc) === before) {
        throw new Error('no CI step runs verify-dependency-floor-policy.mjs — is the gate registered?');
      }
      writeMirror(root, workflowRel, YAML.stringify(doc));
      return 'deleted the CI step that runs verify-dependency-floor-policy.mjs';
    },
  },

  // --- 4. coordinated edits ---------------------------------------------
  {
    id: 'P9',
    label: 'COORDINATED EDIT: the floor AND its advisory evidence are both lowered together',
    // The attack the naive "keep a second copy of the numbers" fix does not
    // stop. This mutant lowers the floor to 1.1.20 AND rewrites the advisory's
    // recorded patched version to match, so the policy is internally consistent
    // — and the only thing left that can object is the pnpm override, which
    // still forces 1.1.21. If this mutant PASSES, the control is worthless
    // against a coordinated edit and the design must be redone.
    expected: 'fail',
    mustMention: ['override', '1.1.21'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = '1.1.20';
        for (const adv of p.floors[0].advisories) {
          if (adv.id === '1240100') adv.patchedIn = '1.1.20';
        }
        return p;
      });
      return 'lowered the floor AND rewrote advisory 1240100 patchedIn to match, leaving the policy self-consistent';
    },
  },
  {
    id: 'P10',
    label: 'COORDINATED EDIT: the floor is lowered AND the pnpm override is lowered with it',
    // The full coordinated attack: every in-repository statement of the floor
    // is lowered together. This is the limit of what an in-repo control can
    // stop, and it is recorded here as an EXPLICIT, VISIBLE expectation
    // rather than left for a future reader to discover. It must still be
    // DETECTED by the fact that the policy would no longer match the
    // advisories it claims to close in the untouched `why`/advisory record for
    // the OTHER entries — and the harness asserts a real detection, so a
    // regression that lets this through is visible.
    expected: 'fail',
    mustMention: ['brace-expansion'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = '1.1.20';
        for (const adv of p.floors[0].advisories) {
          if (adv.id === '1240100') adv.patchedIn = '1.1.20';
        }
        return p;
      });
      setOverrideTarget(root, 'brace-expansion', '1.1.20');
      return 'lowered the floor, the advisory record AND the pnpm override together';
    },
  },

  // --- 5. positive controls ---------------------------------------------
  {
    id: 'P11',
    label: 'DRIFT: the floor is raised in the policy but the pnpm override is left behind',
    // Initially mis-specified by me as a positive control, and running it proved
    // that was wrong. Raising a floor WITHOUT raising the override means the
    // policy demands 1.1.22 while pnpm still forces 1.1.21: the graph can
    // never satisfy the policy, and a future `pnpm install` would silently
    // produce a graph the policy rejects. That is genuine drift and the gate is
    // right to report it.
    //
    // The legitimate version of this change is P12: raise the floor AND the
    // override together. Both are asserted here — this one as a detection, P12
    // as a tolerance — because the difference between them is precisely the
    // property under test.
    expected: 'fail',
    mustMention: ['override', '1.1.22'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = '1.1.22';
        p.floors[0].advisories.push({ id: '1999999', severity: 'high', patchedIn: '1.1.22' });
        return p;
      });
      return 'raised the brace-expansion@1 floor to 1.1.22 but left the pnpm override at 1.1.21';
    },
  },
  {
    id: 'P12',
    label: 'POSITIVE CONTROL: a legitimate coordinated REMEDIATION (floor + advisory + override + lockfile)',
    // The adoption guard, and the one this control must not break. When a
    // future advisory fixes at 1.1.22 the remedy is to raise the floor, and
    // every record of that decision is updated together: the policy floor, the
    // advisory that justifies it, the pnpm override, and the lockfile the
    // frozen-lockfile install consumes. Nothing is weakened, so the control
    // must pass. A gate that failed here would push people to LOWER floors
    // instead of remediating, which is the exact outcome R36-03 is about.
    expected: 'pass',
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = '1.1.22';
        p.floors[0].advisories.push({ id: '1999999', severity: 'high', patchedIn: '1.1.22' });
        return p;
      });
      setOverrideTarget(root, 'brace-expansion', '1.1.22');
      setLockOverrideTarget(root, 'brace-expansion', '1.1.22');
      return 'raised the floor, added the justifying advisory, and raised the pnpm override AND the lockfile to match';
    },
  },
  {
    id: 'P13',
    label: 'POSITIVE CONTROL: the policy is re-serialised with different formatting but identical content',
    // A reformat must not be a finding. If the gate compared the file's bytes
    // to a stored digest rather than its MEANING, an ordinary `prettier` run
    // would fail CI, and a control that punishes formatting trains people to
    // avoid running the formatter.
    expected: 'pass',
    apply(root) {
      const policy = JSON.parse(readMirror(root, policyRel));
      writeRaw(root, policyRel, JSON.stringify(policy));
      return 're-serialised the policy as a single line (identical content, different bytes)';
    },
  },

  // ======================================================================
  // PHASE 38 — the F-01 / F-02 trust boundary
  // ======================================================================
  //
  // Phase 37's control was independently reviewed. Two findings came back:
  //
  //   F-01 (MEDIUM) a coordinated four-file edit — policy floor, advisory
  //        evidence, workspace override, lockfile — still yields green CI.
  //   F-02 (LOW)    the gate's own header misdescribed Layer 3 and said
  //        "three statements" where four are checked.
  //
  // F-02 is documentation and was fixed without touching executable behaviour.
  //
  // F-01 is NOT a defect to be closed, and the mutants below are written to
  // make that explicit rather than to paper over it. The final mutant in this
  // group, `EST-1`, performs the complete coordinated edit INCLUDING the
  // resolved graph, and is EXPECTED TO PASS THE GATE. It is recorded here as a
  // passing mutant with an explicit `expected: 'boundary'` so that:
  //
  //   - the escape is measured rather than assumed;
  //   - a future reader can see it was found, not overlooked;
  //   - and if the control ever changes such that this mutant DOES fail, the
  //     harness reports the boundary moved, which is itself information.
  //
  // The honest framing, repeated in the gate header and the phase report: an
  // actor who can rewrite the dependency policy can rewrite the control that
  // checks it. Closing that requires branch protection, code ownership and
  // required review — all outside this repository, none implemented here.
  {
    id: 'EST-1',
    label: 'TRUST BOUNDARY (expected to PASS): policy + advisory evidence + workspace override + lockfile + resolved graph, all weakened together',
    // The complete coordinated edit. Every one of the four statements the
    // policy states, plus the graph the lockfile actually installs, is lowered
    // to the state that reinstates moderate advisories 1240100 and 1240101.
    //
    // This mutant PASSING is the correct and expected outcome. It is recorded
    // rather than omitted because an unrecorded limit is indistinguishable from
    // an undiscovered one. See F-01 in SECURITY_REVIEW_PHASE_37.md.
    expected: 'boundary',
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimum = '1.1.20';
        for (const a of p.floors[0].advisories) if (a.id === '1240100') a.patchedIn = '1.1.20';
        p.floors[1].minimum = '2.1.6';
        for (const a of p.floors[1].advisories) if (a.id === '1240101') a.patchedIn = '2.1.6';
        return p;
      });
      setOverrideTarget(root, 'brace-expansion', '1.1.20', '<1.1.21');
      setOverrideTarget(root, 'brace-expansion', '2.1.6', '<2.1.7');
      setLockOverrideTarget(root, 'brace-expansion', '1.1.20', '<1.1.21');
      setLockOverrideTarget(root, 'brace-expansion', '2.1.6', '<2.1.7');
      setLockResolvedVersion(root, 'brace-expansion', '1.1.21', '1.1.20');
      setLockResolvedVersion(root, 'brace-expansion', '2.1.7', '2.1.6');
      return 'lowered the floor, the advisory evidence, the pnpm override, the lockfile override AND the lockfile resolved graph together';
    },
  },
  {
    id: 'EST-2',
    label: 'an UNEXPECTED field is added to a floor (schema is closed)',
    // F-01-adjacent and newly detected in Phase 38. A misspelled or spare field
    // next to a correct one is a field no check reads, so it can be written
    // without anything noticing — and a reader may mistake it for policy.
    expected: 'fail',
    mustMention: ['outside the declared schema'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].minimumVer = '1.1.20';
        return p;
      });
      return 'added an undeclared `minimumVer` field beside the real `minimum`';
    },
  },
  {
    id: 'EST-3',
    label: 'the policy declares a schema version this gate does not implement',
    // A policy written for a different schema must not be certified by a gate
    // that models a different one. Before Phase 38 this field was read by nobody.
    expected: 'fail',
    mustMention: ['schema version'],
    apply(root) {
      editPolicy(root, (p) => {
        p.policyVersion = 99;
        return p;
      });
      return 'set policyVersion to 99, a schema this gate does not implement';
    },
  },
  {
    id: 'EST-4',
    label: 'the advisory severity is rewritten to a value outside the audit vocabulary',
    // Severity participates in no comparison, so before Phase 38 it could be
    // altered freely. It is the human-readable reason a floor exists, so an
    // unrecognised value is evidence that has rotted.
    expected: 'fail',
    mustMention: ['severity'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].advisories.find((a) => a.id === '1240100').severity = 'negligible';
        return p;
      });
      return 'rewrote advisory 1240100 severity to "negligible"';
    },
  },
  {
    id: 'EST-5',
    label: 'the same advisory is recorded against two different floors',
    // One advisory describes one fix version. Recording it twice means at least
    // one of the two floors is claiming a remediation that is not the advisory's.
    expected: 'fail',
    mustMention: ['exactly one floor'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[2].advisories.push({ id: '1240100', severity: 'moderate', patchedIn: '1.1.21' });
        return p;
      });
      return 'recorded advisory 1240100 under both brace-expansion@1 and undici@6';
    },
  },
  {
    id: 'EST-6',
    label: 'a floor is REMOVED while its override is still in force',
    expected: 'fail',
    mustMention: ["every forced package line has a floor"],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors = p.floors.filter((f) => !(f.package === 'brace-expansion' && f.majors.includes('1')));
        return p;
      });
      return 'removed the brace-expansion@1 floor while its override remains';
    },
  },
  {
    id: 'EST-7',
    label: 'a floor is added for a package the dependency graph does not contain',
    // A floor for a package that is not installed constrains nothing and, worse,
    // looks like coverage. The graph is the independent witness.
    expected: 'fail',
    mustMention: ['override'],
    apply(root) {
      editPolicy(root, (p) => {
        p.floors.push({
          package: 'phantom-package',
          majors: ['1'],
          minimum: '9.9.9',
          advisories: [{ id: '1888888', severity: 'low', patchedIn: '9.9.9' }],
          why: 'not actually installed',
          reachedVia: 'nowhere',
        });
        return p;
      });
      return 'added a floor for `phantom-package`, which is not in the graph';
    },
  },
  {
    id: 'EST-8',
    label: 'the recorded rationale behind a floor is deleted',
    // `why` and `reachedVia` are what make the floor a decision rather than a
    // number. Removing them leaves a bare pin with nothing to argue about.
    expected: 'fail',
    mustMention: ['why'],
    apply(root) {
      editPolicy(root, (p) => {
        delete p.floors[0].why;
        return p;
      });
      return 'deleted the `why` rationale from the brace-expansion@1 floor';
    },
  },
  {
    id: 'EST-9',
    label: 'POSITIVE CONTROL: the advisory severity is corrected, not weakened',
    // The mirror of EST-4. Correcting recorded evidence to match reality must be
    // allowed — a gate that refused honest corrections would train people to
    // leave wrong records in place rather than fix them.
    expected: 'pass',
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[0].advisories.find((a) => a.id === '1240100').severity = 'moderate';
        return p;
      });
      return 'set advisory 1240100 severity to its correct value, "moderate"';
    },
  },
  {
    id: 'EST-10',
    label: 'POSITIVE CONTROL: a legitimate remediation to a NEW advisory, fully coordinated',
    // The adoption guard for Phase 38's stricter schema: adding an advisory,
    // raising the floor, and raising both override records is the normal way
    // this repository remediates a future vulnerability. It must still pass.
    expected: 'pass',
    apply(root) {
      editPolicy(root, (p) => {
        p.floors[2].minimum = '6.28.2';
        p.floors[2].advisories.push({ id: '1777777', severity: 'high', patchedIn: '6.28.2' });
        return p;
      });
      setOverrideTarget(root, 'undici', '6.28.2');
      setLockOverrideTarget(root, 'undici', '6.28.2');
      return 'remediated a new undici advisory, raising the floor and both override records';
    },
  },
];

// ---------------------------------------------------------------------------
const preRun = {
  policy: readFileSync(path.join(repoRoot, policyRel), 'utf8'),
  gate: readFileSync(path.join(repoRoot, gateRel), 'utf8'),
  workspace: readFileSync(path.join(repoRoot, workspaceRel), 'utf8'),
  lock: readFileSync(path.join(repoRoot, lockRel), 'utf8'),
  workflow: readFileSync(path.join(repoRoot, workflowRel), 'utf8'),
  parity: readFileSync(path.join(repoRoot, parityRel), 'utf8'),
};

let failures = 0;
const tally = { applied: 0, detected: 0, refused: 0, tolerated: 0, escaped: 0, discardedSetup: 0 };

log('Phase 37 (R36-03) — mutation test of the floor-policy protection control\n');
log('  `fail`   = the gate evaluated the policy and reported a named finding');
log('  `refuse` = the gate declined to evaluate an unevaluable policy (failing closed IS the assertion)');
log('  `pass`   = a legitimate movement the control must not punish');
log('  setup    = the TEST broke, not the control; these are discarded, never counted as detections\n');

log('  CONTROL  (unmutated mirror — the real policy must certify)');
{
  const root = makeMirror();
  const res = runGate(root);
  if (res.status !== 0) {
    log('      FAIL  the unmutated repository FAILS its own floor-policy control.');
    for (const c of res.failed.slice(0, 5)) log(`        - ${c.check}: ${c.detail}`);
    const setup = looksLikeSetupFailure(res.text);
    if (setup) log(`        (a SETUP signature was present: ${setup} — the mirror is incomplete)`);
    failures += 1;
  } else {
    log(`        -> green across ${res.results.length} checks, so a red mutant is attributable to the mutation\n`);
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
    log('            A mutant that does not apply proves nothing.');
    failures += 1;
    continue;
  }

  // The mirror must actually have changed, in a file this mutant claims to touch.
  const watched = {
    policy: policyRel, gate: gateRel, workspace: workspaceRel,
    lock: lockRel, workflow: workflowRel, parity: parityRel,
  };
  const changed = Object.keys(watched).filter(
    (k) => readMirror(root, watched[k]) !== preRun[k],
  );
  if (changed.length === 0) {
    log('      FAIL  the mutant did not change the mirror. Its result would be meaningless.');
    failures += 1;
    continue;
  }
  tally.applied += 1;
  log(`        applied: ${description} [changed: ${changed.join(', ')}]`);

  // A mutant that leaves the gate unparseable has tested nothing.
  if (changed.includes('gate')) {
    const parse = isParseableJs(path.join(root, gateRel));
    if (!parse.ok) {
      log(`      FAIL  the mutant left the gate unparseable (${parse.reason}). DISCARDED as a setup failure.`);
      tally.discardedSetup += 1;
      failures += 1;
      continue;
    }
  }

  // P8 is proven by the parity contract, not by the gate itself.
  const isParityMutant = m.detectedBy === 'verify-ci-parity';
  const res = isParityMutant
    ? runParityContract(root)
    : runGate(root);

  // ---- a setup failure is a DISCARD, never a detection ------------------
  const setupSig = looksLikeSetupFailure(res.text);
  if (setupSig) {
    log(`      DISCARD  the run failed with a SETUP signature (\`${setupSig}\`), not a security finding.`);
    log('               This is a broken harness or an incomplete mirror; it is NOT counted as a detection.');
    tally.discardedSetup += 1;
    failures += 1;
    continue;
  }

  // Phase 38. A `boundary` mutant is EXPECTED TO PASS THE GATE. It is not a
  // positive control and it is not a tolerated legitimate change: it is a
  // measured escape, and recording it as measured is the whole point of
  // including it. Scoring it as a failure would misrepresent the control; not
  // recording it would leave the boundary undiscovered rather than documented.
  if (m.expected === 'boundary') {
    if (res.status === 0) {
      log('        -> CONFIRMED ESCAPE (exit=0). This is the documented trust boundary, measured rather than');
      log('           assumed: an actor who controls all four statements AND the resolved graph is outside the');
      log('           boundary this repository can enforce. Closing it needs branch protection, code ownership');
      log('           and required review — none of which is implemented or verified here.');
      tally.escaped += 1;
    } else {
      log(`        -> the gate REJECTED the complete coordinated edit (exit=${res.status}).`);
      log('           The trust boundary has MOVED: this is stronger than Phase 38 documented. Report it as a');
      log('           change in coverage, and re-verify that nothing weaker still passes.');
      for (const c of res.failed.slice(0, 3)) log(`             [FAIL] ${c.check}: ${c.detail.split('\n')[0]}`);
      tally.detected += 1;
    }
    log('');
    continue;
  }

  if (m.expected === 'pass') {
    if (res.status !== 0) {
      log(`      FAIL  a FALSE POSITIVE (exit=${res.status}). This movement is legitimate, so the control must hold.`);
      for (const c of res.failed.slice(0, 3)) log(`             [FAIL] ${c.check}: ${c.detail}`);
      failures += 1;
      continue;
    }
    log('        -> correctly NOT flagged: this change weakens nothing, so the control holds');
    tally.tolerated += 1;
    log('');
    continue;
  }

  if (res.status === 0) {
    log('      FAIL  NOT DETECTED (exit=0). The control claims to enforce this and does not.');
    failures += 1;
    log('');
    continue;
  }

  // The failure must name the intended property, or it is not evidence.
  const missing = (m.mustMention ?? []).filter((t) => !res.text.includes(t));
  if (missing.length > 0) {
    log(`      FAIL  detected, but NOT for the intended reason — the output never mentions: ${missing.join(', ')}`);
    log(`            raw output: ${res.text.trim().slice(-500)}`);
    failures += 1;
    log('');
    continue;
  }

  if (m.expected === 'refuse') {
    log('        -> DETECTED (exit=1) by refusing to evaluate — failing closed on an unevaluable policy');
    tally.refused += 1;
  } else {
    log(`        -> DETECTED (exit=1) for the intended reason:`);
    for (const c of res.failed.slice(0, 2)) log(`             [FAIL] ${c.check}: ${c.detail.split('\n')[0]}`);
    tally.detected += 1;
  }
  log('');
}

/** Run the CI-parity contract, which is what proves a gate is still wired in. */
function runParityContract(root) {
  const res = spawnSync(process.execPath, [path.join(root, parityRel), '--list'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    env: { CI: '1', FORCE_COLOR: '0' },
  });
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  return { status: res.status, text, failed: [] };
}

if (!keepMirrors) {
  for (const m of createdMirrors) rmSync(m, { recursive: true, force: true });
  log(`  ${createdMirrors.length} throwaway mirror(s) removed.`);
} else {
  log(`  ${createdMirrors.length} mirror(s) kept under ${createdMirrors.join(', ')}`);
}
log('');

log('  POST-CONDITION  (the real files must be byte-identical)');
for (const [label, file, expected] of [
  ['security/dependency-security-floor.json', policyRel, preRun.policy],
  ['scripts/verify-dependency-floor-policy.mjs', gateRel, preRun.gate],
  ['pnpm-workspace.yaml', workspaceRel, preRun.workspace],
  ['pnpm-lock.yaml', lockRel, preRun.lock],
  ['.github/workflows/ci.yml', workflowRel, preRun.workflow],
  ['scripts/verify-ci-parity.mjs', parityRel, preRun.parity],
]) {
  const after = readFileSync(path.join(repoRoot, file), 'utf8');
  if (after === expected) log(`    ok    ${label} is unchanged`);
  else {
    log(`    FAIL  ${label} was modified. A leaked mutant corrupts every later phase.`);
    failures += 1;
  }
}

log('');
log(`  TALLY  ${tally.applied} mutant(s) applied: ${tally.detected} detected by evaluation, ` +
  `${tally.refused} detected by refusing, ${tally.tolerated} correctly tolerated, ` +
  `${tally.escaped} confirmed trust-boundary escapes, ${tally.discardedSetup} discarded as setup failures.`);
log('');
if (failures) {
  log(`  RESULT  FAIL — ${failures} problem(s). The floor policy is not proven tamper-evident.`);
  process.exit(1);
}
log('  RESULT  PASS — a lowered floor, a deleted floor, a malformed floor, a computed floor and a');
log('          missing advisory record are each detected, the CI registration is enforced by the parity');
log('          contract, coordinated edits are still caught, and legitimate coordinated remediation');
log('          (raising a floor) and a pure reformat are not punished.');
log('');
log('  PHASE 38 — the trust boundary is MEASURED, not assumed:');
log('          18 of 23 mutants are detected for a named reason, 4 are legitimate and correctly tolerated,');
log('          and exactly ONE escapes: EST-1, the complete coordinated edit covering the policy floor, the');
log('          advisory evidence, the workspace override, the lockfile override AND the resolved graph. That');
log('          escape is expected and is the boundary this repository cannot enforce from inside itself. It is');
log('          recorded here as a passing mutant precisely so it cannot be rediscovered as a surprise.');
log('');
log('  NOT PROVEN BY THIS HARNESS: that the recorded advisory data is itself correct — the `patchedIn` values');
log('          are asserted for shape and cross-checked against the two override records, not fetched from the');
log('          advisory feed, which would make this gate network-dependent and unavailable before install.');
log('          NOT PROVEN either: that any control outside this repository (branch protection, CODEOWNERS,');
log('          required review, signed commits) is configured. None of them is verified here.');
process.exit(0);
