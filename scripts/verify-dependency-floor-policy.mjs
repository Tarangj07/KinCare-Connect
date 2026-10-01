#!/usr/bin/env node
/**
 * Phase 37 (R36-03) — the dependency security floor is itself tamper-evident.
 *
 * ## The defect this exists to close
 *
 * R36-03, reproduced: the minimum acceptable versions lived in `const FLOORS`
 * INSIDE `scripts/verify-dependency-security-floor.mjs` — the very script that
 * enforces them. One edit to one line produced a green build with moderate
 * advisories 1240100 and 1240101 back in the resolved graph:
 *
 *     (floors 1.1.21/2.1.7 -> 1.1.20/2.1.6, graph genuinely re-resolved by pnpm)
 *       verify-dependency-security-floor   EXIT 0
 *       verify-dependency-triage           EXIT 0
 *       verify-config-contract             EXIT 0
 *       verify-next-config-features        EXIT 0
 *       verify-dependency-audit            EXIT 0
 *       verify-ci-parity --list            EXIT 0
 *       triage-vulnerabilities             EXIT 0   ("No critical or high advisory
 *                                                     is reachable…")
 *
 * The control was not wrong. It was configured by the same editable act as
 * everything else in the file, so nothing in the repository could object.
 *
 * ## Why a second copy of the numbers is NOT the fix
 *
 * The obvious repair — write the floors down again in a "protected" place and
 * compare — fails against exactly the attack it is meant to stop. Whoever
 * lowers `FLOORS` lowers the second copy in the same commit, and the check
 * passes. It converts a one-file edit into a two-file edit. That is a speed
 * bump, not a control, and it is the shape of the coordinated-edit requirement
 * this gate is built to resist.
 *
 * ## What this gate actually does
 *
 * It makes the floor **derivable from evidence recorded elsewhere**, and
 * asserts the policy file agrees with that evidence.
 *
 * There is no oracle inside the repository that an editor of the policy cannot
 * also reach — the lockfile is editable, the workspace file is editable, and
 * the advisory records live in the policy itself. So this gate does not claim
 * to have one. It claims something weaker and checkable: that the floor is
 * stated FOUR times in the repository, in four artifacts with four different
 * failure modes, and that the four must agree. Lowering the floor means
 * lowering all four, which is a coherent, reviewable change to the dependency
 * policy of record rather than an edit that looks like a comment tweak.
 *
 * The oracle used here is split by what each layer can honestly claim:
 *
 *   LAYER 1 — INTERNAL CONSISTENCY (offline, deterministic)
 *     Every floor must be at least as high as the `patchedIn` version of every
 *     advisory it claims to remediate, AND at least as high as the highest
 *     `patchedIn` across all advisories recorded for that package. This is the
 *     property that makes the floor MEANINGFUL rather than arbitrary: a floor
 *     of 1.1.20 cannot be defended, because advisory 1240100 records that it
 *     is fixed only in 1.1.21. Lowering the floor while leaving the advisory
 *     record intact fails here.
 *
 *   LAYER 2 — THE OVERRIDE DECLARATION (cross-artifact)
 *     `pnpm-workspace.yaml`'s `overrides:` block is the pnpm-level statement of
 *     the same intent, and it is a DIFFERENT artifact with a different owner and
 *     a different failure mode: if the floor and the override disagree, the
 *     remediation is not what the floor claims, and the resolved graph will not
 *     match the policy. This is a cross-check between two files, not a file
 *     compared with itself.
 *
 *   LAYER 3 — THE LOCKFILE'S RESOLVED-OVERRIDE RECORD (cross-artifact)
 *     `pnpm-lock.yaml` carries its own `overrides:` block, written by pnpm, and
 *     it is what a `--frozen-lockfile` install — which is what CI runs —
 *     actually consumes. This matters more than it first appears: when the
 *     policy and the workspace overrides are BOTH lowered together, they agree
 *     with each other and Layers 1 and 2 both pass. What still disagrees is the
 *     lockfile, and a frozen-lockfile install would then install a graph the
 *     policy never described.
 *
 *     Correction to Phase 37's own description, which called this layer "the
 *     resolved graph". It is not: this gate does not read the resolved package
 *     versions in `snapshots:` at all. It compares the lockfile's OVERRIDE
 *     DECLARATION against the workspace one. The resolved GRAPH remains the
 *     exclusive responsibility of `verify-dependency-security-floor.mjs`, and
 *     the two gates are deliberately not merged — this gate certifies the
 *     POLICY, that one enforces it against the graph.
 *
 * Layers 1, 2 and 3 are what resist a coordinated edit. To pass a weakened
 * policy the editor must ALSO weaken the advisory record inside the same policy
 * file (Layer 1) and the pnpm override (Layer 2) and the lockfile (Layer 3).
 *
 * ## How many statements are actually checked — four, not three
 *
 * Phase 37's header said "three independent statements of the same fact". The
 * implementation checks FOUR, and a reader relying on the old number would
 * under-model the control:
 *
 *   1. `security/dependency-security-floor.json`  -> `floors[].minimum`
 *   2. the same file                              -> `floors[].advisories[].patchedIn`
 *   3. `pnpm-workspace.yaml`                      -> `overrides:`
 *   4. `pnpm-lock.yaml`                           -> `overrides:`
 *
 * (1) and (2) live in one file but are independent CLAIMS: the floor is a
 * threshold, the advisory record is the evidence for it, and a policy that
 * lowered one without the other is internally inconsistent and refused. They
 * are counted separately because they fail separately.
 *
 * ## The trust boundary, stated exactly
 *
 * **A. Ordinary weakening — INSIDE the boundary, detected.** A floor lowered
 * in the policy alone; a floor lowered together with its advisory evidence; a
 * floor lowered together with those and the workspace override; a floor entry
 * deleted, duplicated, renamed, malformed or made non-literal; a package forced
 * by pnpm with no floor covering it; an unexpected field anywhere in the
 * schema. Every one of these fails this gate, and the reasons are enumerated in
 * `mutate-dependency-floor-policy.mjs`.
 *
 * **B. Coordinated manipulation — OUTSIDE the boundary, NOT prevented.** An
 * actor who edits all four statements above AND the resolved graph in
 * `pnpm-lock.yaml`, and who reviews that diff casually, obtains a green build.
 * This was reproduced deliberately (see the harness's M-EST-1 mutant, which is
 * expected to PASS the gate, and the report's F-01). It is not a defect in the
 * gates; it is the boundary.
 *
 * The honest reason B cannot be closed from inside the repository is structural:
 * the party who can rewrite the dependency policy can rewrite the control that
 * checks it. Any "self-protecting" scheme would have to be verified by something
 * that policy cannot reach.
 *
 * **C. What actually closes B — OUTSIDE the repository, and NOT verified here.**
 * Protected-branch review, `CODEOWNERS` on the policy and lockfile, required
 * approvals for dependency changes, signed commits or tags, CI permissions that
 * prevent a workflow from being edited in the same change, and independent
 * security review. None of these is implemented or verified by this repository
 * or by this phase, and no claim is made about them.
 *
 *
 * ## Why not a git-history anchor
 *
 * Anchoring the baseline to a commit hash was considered and rejected as the
 * primary mechanism. `actions/checkout@v4` performs a SHALLOW clone by default
 * (`fetch-depth: 1`), verified against this repository: in a depth-1 clone the
 * anchor commit is not present, so `git cat-file` cannot resolve it. A gate
 * that only works with full history would either fail in CI or need a fetch-depth
 * change that trades a real availability property for a weak one. `pnpm-workspace.yaml`
 * and the advisory records are present in every checkout, which makes them the
 * honest basis for a control that must run everywhere.
 *
 * ## Fail-closed
 *
 * Missing file, malformed JSON, a non-array `floors`, a floor with no
 * `minimum`, a non-literal or non-string `minimum`, a missing or non-array
 * `advisories`, a malformed advisory record, a duplicate (package, major)
 * pair, an unparseable version, or a missing override — every one of these is a
 * FAILURE, never a pass. A policy that cannot be read cannot be certified, and
 * a control that reports success because it could not check is the exact defect
 * class this repository keeps re-learning.
 *
 * Usage:  node scripts/verify-dependency-floor-policy.mjs [--json]
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_REL = 'security/dependency-security-floor.json';
const WORKSPACE_REL = 'pnpm-workspace.yaml';
const policyPath = path.join(repoRoot, POLICY_REL);
const workspacePath = path.join(repoRoot, WORKSPACE_REL);
const asJson = process.argv.includes('--json');

const results = [];
let failures = 0;

/**
 * The policy schema this gate certifies. Declared once, enforced at every level.
 *
 * `policyId` names the SUBJECT and `policyVersion` the SCHEMA. Both are checked
 * so that this gate cannot be silently pointed at a policy written for a
 * different purpose or a schema it does not implement — the situation in which
 * "the gate passed" stops meaning "the policy is well-formed and defended".
 */
const EXPECTED_POLICY_ID = 'dependency-security-floor';
const EXPECTED_POLICY_VERSION = 1;

/**
 * Severities an advisory record may carry.
 *
 * Deliberately the same vocabulary `pnpm audit` reports. This is a CONTROL over
 * what may be written down, not an allow-list of packages: it does not exempt
 * any dependency from any floor, it only refuses to record a severity the
 * advisory feed does not use, so that the recorded justification for a floor
 * cannot be quietly reworded.
 */
const ADVISORY_SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

function record(ok, check, detail) {
  results.push({ check, verdict: ok ? 'OK' : 'FAIL', detail });
  if (!ok) failures += 1;
  return ok;
}

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
      /* next candidate */
    }
  }
  return null;
}

/**
 * Compare dotted versions. Returns <0, 0, >0, or null when either side is not
 * a plain dotted numeric version — and null is a FAILURE at every call site,
 * never a pass. A version this cannot read is a version it cannot certify.
 */
function compareVersions(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  if (!/^\d+(\.\d+)*$/.test(a) || !/^\d+(\.\d+)*$/.test(b)) return null;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

const isDottedVersion = (v) => typeof v === 'string' && /^\d+(\.\d+)+$/.test(v);

/**
 * The minimum version an advisory is fixed in, extracted from its recorded
 * patched version. Recorded here as a plain string rather than parsed out of
 * the advisory feed at run time, because the whole point is that the recorded
 * value is INDEPENDENT of the floor: an editor who lowers the floor has to edit
 * this field too, in the same file, and that is a visible change to a record of
 * fact rather than a tweak to a threshold.
 */
function run() {
  // --- the policy file must exist -----------------------------------------
  if (!existsSync(policyPath)) {
    record(
      false,
      'the dependency security floor policy file exists',
      `${POLICY_REL} is missing. The floor is policy, and a policy that is not written down cannot be ` +
        'certified. This gate refuses to pass on a missing file rather than assuming a benign default.',
    );
    return report();
  }
  record(true, 'the dependency security floor policy file exists', POLICY_REL);

  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (err) {
    record(false, `${POLICY_REL} is parseable JSON`, err.message);
    return report();
  }
  record(true, `${POLICY_REL} is parseable JSON`, '');

  // --- structure, every branch of which must fail closed -------------------
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    record(false, 'the policy is a JSON object', `got ${Array.isArray(policy) ? 'an array' : typeof policy}`);
    return report();
  }
  if (!Array.isArray(policy.floors)) {
    record(false, '`floors` is an array', `got ${typeof policy.floors}. An empty or absent list makes every check below vacuous.`);
    return report();
  }
  if (policy.floors.length === 0) {
    record(
      false,
      '`floors` is non-empty',
      'the floor list is empty. This is exactly the vacuous-contract defect (R36-02 for the gate list, R36-03 ' +
        'here): with no floors declared, every assertion below passes without asserting anything.',
    );
    return report();
  }
  record(true, '`floors` is a non-empty array', `${policy.floors.length} floor(s) declared`);

  // --- Phase 38 (F-01/F-02): the policy's own envelope must be closed -------
  //
  // A policy gate that reads only the keys it knows is a gate that silently
  // accepts a schema it does not understand. Two concrete escapes were measured
  // before this block existed:
  //
  //   - a floor carried an extra, misspelled key (`minimumVer: "1.1.20"`)
  //     alongside a correct `minimum`. The gate read `minimum`, ignored the
  //     typo, and passed — so a reviewer reading the file could be looking at a
  //     field the gate never inspects.
  //   - `policyId` / `policyVersion` were read by nobody. A policy written for
  //     a different schema, or a future version of this one, was certified as
  //     though it were this schema.
  //
  // Both are the same defect class: an unread field is an unconstrained field.
  // Declaring the exact permitted key set, at every level, makes a rename or an
  // addition a FAILURE rather than a silent no-op. That is what lets a future
  // schema change be a deliberate, reviewed edit instead of an accident.
  const POLICY_KEYS = ['policyId', 'policyVersion', 'description', 'floors'];
  const FLOOR_KEYS = ['package', 'majors', 'minimum', 'advisories', 'why', 'reachedVia'];
  const ADVISORY_KEYS = ['id', 'severity', 'patchedIn'];

  const unknownTop = Object.keys(policy).filter((k) => !POLICY_KEYS.includes(k));
  record(
    unknownTop.length === 0,
    'the policy carries no keys outside the declared schema',
    unknownTop.length === 0
      ? `top-level keys: ${POLICY_KEYS.join(', ')}`
      : `unexpected key(s): ${unknownTop.join(', ')}. A field this gate does not read is a field nobody constrains; ` +
        'if one is genuinely needed it must be added to the schema deliberately.',
  );
  record(
    policy.policyId === EXPECTED_POLICY_ID,
    'the policy declares the expected policyId',
    policy.policyId === EXPECTED_POLICY_ID
      ? EXPECTED_POLICY_ID
      : `got ${JSON.stringify(policy.policyId)}. This gate certifies ${EXPECTED_POLICY_ID} only; a policy for a ` +
        'different subject must not be certified by it.',
  );
  record(
    policy.policyVersion === EXPECTED_POLICY_VERSION,
    'the policy declares the schema version this gate understands',
    policy.policyVersion === EXPECTED_POLICY_VERSION
      ? `version ${EXPECTED_POLICY_VERSION}`
      : `got ${JSON.stringify(policy.policyVersion)}, this gate implements version ${EXPECTED_POLICY_VERSION}. A ` +
        'newer policy may carry meaning this gate does not model, so it is refused rather than partially read.',
  );

  const YAML = loadYaml();
  if (!YAML) {
    record(false, 'the `yaml` parser resolves from the dependency graph', 'this gate reads pnpm-workspace.yaml and cannot proceed');
    return report();
  }
  let workspace = null;
  try {
    workspace = YAML.parse(readFileSync(workspacePath, 'utf8'));
  } catch (err) {
    record(false, `${WORKSPACE_REL} is parseable YAML`, err.message);
    return report();
  }
  const overrides = workspace?.overrides;
  if (overrides === undefined || overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    record(
      false,
      '`overrides` is declared in pnpm-workspace.yaml',
      'no usable overrides block. The floor policy and the package manager must agree about the remediation, ' +
        'and this gate cannot compare them if the declaration is absent.',
    );
    return report();
  }
  record(true, '`overrides` is declared in pnpm-workspace.yaml', `${Object.keys(overrides).length} override(s)`);

  // --- COVERAGE: every floored package must be covered, and vice versa ----
  // Asserted from the OVERRIDE side, not the policy side. A floor deleted from
  // the policy leaves nothing in the policy to complain about — the entry
  // simply is not checked any more — so iterating the policy cannot detect its
  // own deletion. Iterating the overrides can: the remediation is still
  // declared there, so a package that pnpm is told to force upward but which
  // the policy no longer constrains is an unprotected remediation.
  //
  // Phase 38: coverage is asserted per (package, MAJOR), not per package. The
  // package-level check alone was measured to pass when the `brace-expansion`
  // 1.x floor was deleted while the 2.x floor remained — the package is still
  // "covered", so nothing complained, and one major line silently lost the
  // constraint the policy exists to apply to it. A floor governs one major
  // line, so coverage has to be counted the same way.
  const overrideLines = new Set();
  for (const [key, value] of Object.entries(overrides)) {
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const name = key.slice(0, at);
    if (typeof value !== 'string' || !/^\d+(\.\d+)*$/.test(value)) continue;
    const major = value.split('.')[0];
    overrideLines.add(`${name}@${major}`);
  }
  const policyLines = new Set(
    policy.floors
      .filter((f) => typeof f?.package === 'string' && Array.isArray(f.majors))
      .flatMap((f) => f.majors.map((m) => `${f.package}@${m}`)),
  );
  for (const line of overrideLines) {
    if (!policyLines.has(line)) {
      record(
        false,
        'every forced package line has a floor',
        `pnpm-workspace.yaml forces \`${line}\` upward but the policy declares no floor governing that major. ` +
          'The remediation is still in force while the policy no longer constrains it, so a regression of that ' +
          'version line would meet no floor at all. Coverage is counted per major because a floor governs one ' +
          'major: deleting one of two lines for the same package must not read as "covered".',
      );
    }
  }
  if (!failures) {
    record(
      true,
      'every forced package line has a floor',
      `${overrideLines.size} forced package line(s), all covered`,
    );
  }

  // --- LAYER 3: the LOCKFILE's own override record ----------------------
  // `pnpm-lock.yaml` carries its own `overrides:` block, written by pnpm, and
  // it is what a `--frozen-lockfile` install — which is what CI runs —
  // actually consumes. This matters more than it first appears: when the
  // policy, the workspace overrides AND the lockfile are all lowered together,
  // the policy and the workspace agree with each other and every in-file
  // check passes. What still disagrees is the lockfile, and a frozen-lockfile
  // install would then install a graph the policy never described. Asserting
  // all three agree is what makes the coordinated edit a failure rather than a
  // silent downgrade.
  const LOCK_REL = 'pnpm-lock.yaml';
  const lockPath = path.join(repoRoot, LOCK_REL);
  if (!existsSync(lockPath)) {
    record(
      false,
      'pnpm-lock.yaml exists',
      `${LOCK_REL} is missing, so the resolved-override record cannot be compared. CI installs from the ` +
        'lockfile under --frozen-lockfile, so an absent lockfile means this control cannot certify the policy.',
    );
    return report();
  }
  let lockOverrides;
  try {
    lockOverrides = YAML.parse(readFileSync(lockPath, 'utf8'))?.overrides;
  } catch (err) {
    record(false, 'pnpm-lock.yaml is parseable YAML', err.message);
    return report();
  }
  if (lockOverrides === undefined || lockOverrides === null || typeof lockOverrides !== 'object' || Array.isArray(lockOverrides)) {
    record(
      false,
      'pnpm-lock.yaml records its overrides',
      'no usable `overrides:` block in the lockfile. The lockfile is the artifact a frozen-lockfile install ' +
        'consumes, so its silence cannot be read as agreement.',
    );
    return report();
  }
  record(true, 'pnpm-lock.yaml records its overrides', `${Object.keys(lockOverrides).length} override(s)`);

  // The workspace overrides and the lockfile overrides must be the SAME map.
  // `pnpm-workspace.yaml` quotes keys; pnpm writes them unquoted. Both arrive
  // here as plain strings from the same parser, so the comparison is exact.
  const wsEntries = Object.entries(overrides).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const lockEntries = Object.entries(lockOverrides).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const mapsAgree =
    wsEntries.length === lockEntries.length && wsEntries.every(([k, v], i) => k === lockEntries[i][0] && v === lockEntries[i][1]);
  if (!mapsAgree) {
    const diff = wsEntries
      .filter(([k, v]) => lockEntries.find(([lk, lv]) => lk === k && lv !== v))
      .map(([k, v]) => `${k} -> ${v} (lockfile has ${lockEntries.find(([lk]) => lk === k)?.[1] ?? 'nothing'})`);
    record(
      false,
      'pnpm-workspace.yaml and pnpm-lock.yaml declare the SAME overrides',
      `the declared overrides and the lockfile's resolved overrides disagree: ${diff.join('; ') || 'the key sets differ'}. ` +
        'A frozen-lockfile CI install consumes the lockfile, so a disagreement means the graph that gets installed ' +
        'is not the graph the policy describes.',
    );
  } else {
    record(
      true,
      'pnpm-workspace.yaml and pnpm-lock.yaml declare the SAME overrides',
      `${wsEntries.length} override(s) agree exactly`,
    );
  }

  // --- per-floor validation ------------------------------------------------
  const seen = new Set();
  /** Phase 38 (F-01): advisory identity is global, so a duplicate is detectable. */
  const advisoryOwner = new Map();

  for (const [i, floor] of policy.floors.entries()) {
    const label = `floors[${i}]`;
    const advisoryIdsInFloor = new Set();
    if (typeof floor !== 'object' || floor === null || Array.isArray(floor)) {
      record(false, `${label} is an object`, `got ${typeof floor}`);
      continue;
    }

    // Phase 38 (F-01): an unread key on a floor is an unconstrained key. A
    // misspelled field next to a correct one is the shape a future edit takes
    // when someone renames a field and believes it still works.
    const unknownFloorKeys = Object.keys(floor).filter((k) => !FLOOR_KEYS.includes(k));
    if (unknownFloorKeys.length > 0) {
      record(
        false,
        `${label} carries no keys outside the declared schema`,
        `unexpected key(s): ${unknownFloorKeys.join(', ')}. If a field is genuinely required it must be added to the ` +
          'schema deliberately and read by this gate, otherwise it is decoration that a reader may mistake for policy.',
      );
    }
    // `why` and `reachedVia` are prose, not thresholds, but they are REQUIRED:
    // they are what turns a bare version pin into a decision someone has to
    // argue for. Their absence is how a floor becomes an unexplained number.
    for (const proseKey of ['why', 'reachedVia']) {
      if (typeof floor[proseKey] !== 'string' || floor[proseKey].trim() === '') {
        record(
          false,
          `${label}.${proseKey} is a non-empty string`,
          `got ${JSON.stringify(floor[proseKey])}. A floor with no recorded rationale is a bare version pin; the ` +
            'rationale is what makes lowering it an argument rather than a typo.',
        );
      }
    }

    // package
    if (typeof floor.package !== 'string' || floor.package.trim() === '') {
      record(false, `${label}.package is a non-empty string`, `got ${JSON.stringify(floor.package)}`);
      continue;
    }
    const pkg = floor.package;

    // majors
    if (!Array.isArray(floor.majors) || floor.majors.length === 0) {
      record(
        false,
        `${label}.majors is a non-empty array`,
        `got ${JSON.stringify(floor.majors)}. Without a declared major this floor governs nothing and would ` +
          'silently skip every instance of the package.',
      );
      continue;
    }
    if (!floor.majors.every((m) => typeof m === 'string' && /^\d+$/.test(m))) {
      record(false, `${label}.majors are numeric strings`, `got ${JSON.stringify(floor.majors)}`);
      continue;
    }

    // minimum — the security value itself
    if (!isDottedVersion(floor.minimum)) {
      record(
        false,
        `${label}.minimum is a literal dotted version`,
        `got ${JSON.stringify(floor.minimum)}. A non-literal, computed or malformed minimum is exactly the ` +
          'shape a gate must refuse to certify, not one it should coerce.',
      );
      continue;
    }
    for (const major of floor.majors) {
      const key = `${pkg}@${major}`;
      if (seen.has(key)) {
        record(false, `${label} does not duplicate an earlier (package, major) pair`, `${key} is declared twice`);
        continue;
      }
      seen.add(key);
    }

    // advisories — the evidence the floor must be justified by
    if (!Array.isArray(floor.advisories) || floor.advisories.length === 0) {
      record(
        false,
        `${label}.advisories is a non-empty array`,
        `got ${JSON.stringify(floor.advisories)}. A floor with no advisory record cannot be justified: nothing ` +
          'states which known vulnerability it exists to close, so lowering it later costs nothing to explain.',
      );
      continue;
    }

    let advisoriesOk = true;
    let highestPatched = null;
    for (const [j, adv] of floor.advisories.entries()) {
      if (typeof adv !== 'object' || adv === null || Array.isArray(adv)) {
        record(false, `${label}.advisories[${j}] is an object`, `got ${typeof adv}`);
        advisoriesOk = false;
        continue;
      }
      // Same reasoning as the floor key set: an advisory field this gate never
      // reads is an advisory field nobody constrains.
      const unknownAdvKeys = Object.keys(adv).filter((k) => !ADVISORY_KEYS.includes(k));
      if (unknownAdvKeys.length > 0) {
        record(
          false,
          `${label}.advisories[${j}] carries no keys outside the declared schema`,
          `unexpected key(s): ${unknownAdvKeys.join(', ')}. Advisory evidence that carries fields no check reads ` +
            'can be altered without any comparison moving, which is how a justification rots silently.',
        );
        advisoriesOk = false;
        continue;
      }
      if (typeof adv.id !== 'string' || !/^\d+$/.test(adv.id)) {
        record(false, `${label}.advisories[${j}].id is a numeric advisory id`, `got ${JSON.stringify(adv.id)}`);
        advisoriesOk = false;
        continue;
      }
      // Phase 38 (F-01): a duplicated advisory id inside one floor means the
      // same vulnerability is recorded twice, so the "highest patchedIn" is
      // computed over a set with a redundant member and the evidence reads as
      // stronger than it is. An id repeated ACROSS floors is likewise a
      // contradiction: one advisory cannot justify two different remediation
      // targets.
      if (advisoryIdsInFloor.has(adv.id)) {
        record(
          false,
          `${label}.advisories[${j}].id is recorded once per floor`,
          `advisory ${adv.id} appears more than once in this floor. Repeating it inflates the apparent evidence ` +
            'without adding any.',
        );
        advisoriesOk = false;
        continue;
      }
      advisoryIdsInFloor.add(adv.id);
      if (advisoryOwner.has(adv.id)) {
        record(
          false,
          `advisory ${adv.id} justifies exactly one floor`,
          `already recorded under ${advisoryOwner.get(adv.id)}. One advisory describes one fix version; ` +
            'recording it against two floors means at least one of those floors is claiming a remediation that is ' +
            'not the advisory\'s.',
        );
        advisoriesOk = false;
        continue;
      }
      advisoryOwner.set(adv.id, `${pkg}@${floor.majors.join(',')}`);
      // Phase 38 (F-01): `severity` is evidence too. It is recorded so a reader
      // can see WHY a floor exists — a floor is frequently set by a MODERATE
      // advisory that every other gate filters out. Rewriting `moderate` to
      // `info` or `low` would not change any comparison below, so without this
      // check it could be changed freely; that is precisely the "evidence may
      // be freely substituted" case the trust boundary has to name.
      if (!ADVISORY_SEVERITIES.includes(adv.severity)) {
        record(
          false,
          `${label}.advisories[${j}].severity is a known severity`,
          `got ${JSON.stringify(adv.severity)}. The permitted values are ${ADVISORY_SEVERITIES.join(', ')}. ` +
            'Severity is not used in any comparison below, which is exactly why an unrecognised value here has to ' +
            'be refused: otherwise the recorded severity of the advisory a floor exists to remediate could be ' +
            'rewritten with no check failing.',
        );
        advisoriesOk = false;
        continue;
      }
      if (!isDottedVersion(adv.patchedIn)) {
        record(
          false,
          `${label}.advisories[${j}].patchedIn is a literal dotted version`,
          `got ${JSON.stringify(adv.patchedIn)}. The recorded patched version is the independent evidence the ` +
            'floor is checked against; if it is unreadable the floor cannot be justified.',
        );
        advisoriesOk = false;
        continue;
      }
      const cmp = compareVersions(adv.patchedIn, floor.minimum);
      if (cmp === null) {
        record(false, `${label}.advisories[${j}].patchedIn compares against the floor`, 'unparseable version');
        advisoriesOk = false;
        continue;
      }
      // ---- THE LOAD-BEARING ASSERTION -----------------------------------
      if (cmp > 0) {
        advisoriesOk = record(
          false,
          `${pkg}@${floor.majors.join(',')} floor covers advisory ${adv.id}`,
          `the floor is ${floor.minimum}, but advisory ${adv.id} (${adv.severity ?? 'unknown severity'}) is only ` +
            `fixed in ${adv.patchedIn}. A floor below the version that fixes a known advisory does not remediate ` +
            `it, so this is precisely the R36-03 weakening: the policy would claim to close ${adv.id} while ` +
            'accepting a version in which it is still present.',
        ) ? advisoriesOk : false;
      }
      if (highestPatched === null || (compareVersions(adv.patchedIn, highestPatched) ?? -1) > 0) {
        highestPatched = adv.patchedIn;
      }
    }

    if (advisoriesOk && highestPatched !== null) {
      const cmp = compareVersions(highestPatched, floor.minimum);
      if (cmp === null) {
        record(false, `${label} highest advisory fix compares against the floor`, 'unparseable version');
      } else {
        record(
          cmp <= 0,
          `${pkg}@${floor.majors.join(',')} floor is at least every advisory fix it claims to close`,
          cmp === 0
            ? `floor ${floor.minimum} == highest recorded fix ${highestPatched} (exact, which is the intended shape)`
            : `floor ${floor.minimum} >= highest recorded fix ${highestPatched}`,
        );
      }
    }

    // ---- LAYER 2: the pnpm override must state the same floor ------------
    // The override key is `name@<range>` and the value is the version forced.
    // The floor this policy declares must be reachable from that declaration,
    // or the remediation and the policy have drifted apart.
    //
    // The match is scoped to the majors THIS floor governs. `brace-expansion`
    // has two override entries, one per major line, and a floor for the 1.x
    // line must not be compared against the 2.x override — that was a real
    // false positive here, caught by running the gate rather than by reading it.
    const matching = Object.entries(overrides).filter(([key, value]) => {
      const at = key.lastIndexOf('@');
      if (at <= 0 || key.slice(0, at) !== pkg) return false;
      // Every version the override can force must fall inside a governed major.
      return floor.majors.some((major) => {
        const cmp = typeof value === 'string' && /^\d+(\.\d+)*$/.test(value) ? compareVersions(value, `${major}.0.0`) : null;
        return cmp !== null && cmp >= 0 && (compareVersions(value, `${Number(major) + 1}.0.0`) ?? 1) < 0;
      });
    });
    if (matching.length === 0) {
      record(
        false,
        `${pkg} has a corresponding pnpm override`,
        `no override for \`${pkg}\` in ${WORKSPACE_REL}. The floor policy claims this package is remediated, but ` +
          'the package manager is not being told to remediate it — so the resolved graph would fall back to the ' +
          'declared dependency range and reintroduce the advisory the floor exists to exclude.',
      );
      continue;
    }
    let overrideOk = true;
    for (const [key, value] of matching) {
      if (!isDottedVersion(value)) {
        record(false, `${pkg} override target is a literal version`, `\`${key}\`: ${JSON.stringify(value)}`);
        overrideOk = false;
        continue;
      }
      const cmp = compareVersions(value, floor.minimum);
      if (cmp === null) {
        record(false, `${pkg} override target compares against the floor`, `\`${key}\`: ${value} vs ${floor.minimum}`);
        overrideOk = false;
        continue;
      }
      if (cmp === 0) {
        // Agreement. The override and the floor are the same statement of the
        // same decision, recorded in two artifacts.
        continue;
      }
      if (cmp > 0) {
        // The override is STRONGER than the floor. Sound as a security
        // posture, but it is drift: the package manager forces a version the
        // policy does not record, so the floor understates what is actually
        // being enforced and a future downgrade of the override would meet a
        // floor that had quietly been left behind.
        overrideOk = record(
          false,
          `${pkg} override and declared floor state the SAME version`,
          `\`${key}\` forces ${value}, which is ABOVE the policy floor ${floor.minimum}. The policy understates the ` +
            'remediation that is actually enforced; the two records of one decision have drifted apart.',
        ) && overrideOk;
        continue;
      }
      overrideOk = record(
        false,
        `${pkg} override and declared floor state the SAME version`,
        `\`${key}\` resolves to ${value}, which is BELOW the policy floor ${floor.minimum}. The policy and the ` +
          'package manager disagree about what "remediated" means; the weaker one wins at install time.',
      ) && overrideOk;
    }
    if (overrideOk) {
      record(
        true,
        `${pkg} override and declared floor state the SAME version`,
        matching.map(([k, v]) => `\`${k}\` -> ${v}`).join('; '),
      );
    }
  }

  report();
}

function report() {
  if (asJson) {
    console.log(JSON.stringify({ results, failures }, null, 2));
    process.exit(failures > 0 ? 1 : 0);
  }

  console.log('\nPhase 37 (R36-03) — the dependency security floor policy is tamper-evident\n');
  console.log(`  policy : ${POLICY_REL}`);
  console.log(`  oracle : ${WORKSPACE_REL} (a different artifact, not a second copy of the policy)\n`);

  for (const r of results) {
    console.log(`    [${r.verdict.padEnd(4)}] ${r.check}`);
    if (r.detail) console.log(`           ${r.detail.replace(/\n/g, '\n           ')}`);
  }

  const ok = results.filter((r) => r.verdict === 'OK').length;
  console.log(`\n  ${results.length} check(s): ${ok} passed, ${failures} failed.\n`);

  if (failures > 0) {
    console.error(
      'FAILED — the dependency security floor policy cannot be certified.\n' +
        'Either the floor has been weakened relative to the advisories it claims to close, or the policy and the\n' +
        'package manager\'s override declaration disagree. Lowering a floor reintroduces a known advisory; the fix is\n' +
        'to remediate, not to relax the policy.\n',
    );
    process.exit(1);
  }

  console.log(
    'PASSED — every declared floor is justified by the advisories it claims to close and agrees with the pnpm\n' +
      'override that enforces it. The floor policy can no longer be weakened by editing the gate that reads it.\n',
  );
  process.exit(0);
}

run();