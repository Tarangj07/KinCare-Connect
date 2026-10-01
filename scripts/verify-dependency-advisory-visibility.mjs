#!/usr/bin/env node
/**
 * Phase 39 (F-39-01) — advisories the pipeline does not currently SEE.
 *
 * ## The blind spot, measured
 *
 * This repository has a complete advisory pipeline. It also has a hole in the
 * middle of it, and the hole was found in Phase 39's pre-flight rather than by
 * reading any report:
 *
 *     pnpm audit --json                        -> 92 advisories
 *     pnpm audit --audit-level=high --json     -> 48 advisories
 *     scripts/triage-vulnerabilities.mjs       -> 48 rows, all critical/high
 *
 * Forty-four advisories — 36 moderate and 8 low — reach NO gate, because TWO
 * independent filters drop them:
 *
 *   1. `pnpm audit` is invoked with `--audit-level=high`, so the JSON is
 *      already truncated before the triage script ever reads it. The low and
 *      moderate advisories are not in the document, not merely ignored.
 *   2. `triage-vulnerabilities.mjs` then filters to critical-or-high.
 *
 * Neither filter is a security judgement. Both are scope choices inherited
 * from Phase 23, and neither is recorded as a policy decision anywhere.
 *
 * ## Why this is not a theoretical concern
 *
 * Phase 33 remediated `brace-expansion` and `undici` to floors chosen by
 * MODERATE advisories (1240100 at `>=1.1.21`, 1240101 at `>=2.1.7`). Those
 * advisories sit BELOW this filter. So the exact vulnerabilities this repository
 * deliberately fixed are invisible to the machinery that is supposed to notice
 * their return.
 *
 * Demonstrated, not assumed: in the reproduced R36-03 graph
 * (`brace-expansion` resolved to 1.1.20/2.1.6), advisories 1240100 and 1240101
 * are PRESENT in `pnpm audit --json` and appear in the output of no gate at
 * all. All six dependency gates exited 0. The floor policy passed because the
 * floor itself had been lowered in the same move.
 *
 * ## What this gate does, and what it deliberately does NOT do
 *
 * It makes the whole advisory SET visible and then asserts exactly one
 * property over it:
 *
 *     No advisory may exist against a package the dependency security floor
 *     policy claims to have remediated.
 *
 * That is the precise statement of "the floor is doing its job". If
 * `brace-expansion` carries any advisory at any severity, the floor has failed,
 * whatever the severity and whatever the graph looks like.
 *
 * It does NOT adjudicate the other 42 advisories, and that omission is
 * deliberate and recorded. Triaging moderates in full was measured during
 * pre-flight: it produces 19 REACHABLE advisories across 11 packages
 * (`next`, `qs`, `file-type`, `@nestjs/core`, `esbuild`, `ajv`, `uuid`, …), and
 * remediating them requires UPGRADING dependencies — including `next` from
 * 14.2.35 to 15.5.x, which would also change the runtime the Phase 35
 * image-optimizer control was validated against. That work needs a lockfile
 * change and a dependency upgrade decision, neither of which this phase is
 * authorized to make, and neither of which should be smuggled in disguised as
 * a security fix. It is recorded as OPEN instead.
 *
 * So the honest scope of this gate is: the floor is enforced against EVERY
 * advisory, and the remaining 44 are now COUNTED and REPORTED so their
 * existence is on the record rather than off it. A count that changes is
 * surfaced, not silently accepted.
 *
 * ## Fail-closed
 *
 * A missing lockfile, an unreadable audit report, a malformed policy, a
 * package name that cannot be compared, or a floor policy that declares no
 * floors are all FAILURES. This gate never reports success because it could
 * not check: `pnpm audit` returning something unparseable, or the advisory set
 * coming back EMPTY (which would be a catastrophic and silent result if the
 * filter were ever mis-edited), is a failure rather than a pass.
 *
 * ## Phase 41 — "the full advisory set" becomes a checked contract, not a claim
 *
 * Phase 40 finding F-40-01 (MEDIUM): this gate could print
 *
 *     PASSED — the full advisory set was observed
 *
 * on a report that was not the full advisory set. Reproduced: a report from
 * `pnpm audit --audit-level=moderate --json` carries 84 of this repository's 92
 * advisories, and this gate accepted it and exited 0. The cause was a single
 * conflation: the gate treated a NON-EMPTY report as a COMPLETE one. Non-emptiness
 * is necessary but not sufficient — a *partial* severity filter leaves the report
 * non-empty, which is precisely the shape Phase 39's own empty-report check cannot
 * see. So a filter that removed only the `low` tier was invisible while the gate
 * asserted it had observed everything.
 *
 * Phase 41 closes that by validating an AUTHORITATIVE PROPERTY OF THE REPORT
 * ITSELF rather than a count this file remembers and rather than a list of
 * expected package IDs.
 *
 * ### The property
 *
 * `pnpm audit --json` emits TWO independent things:
 *
 *   advisories                the advisory RECORDS, TRUNCATED by `--audit-level`
 *   metadata.vulnerabilities  the registry's severity CENSUS of the package
 *                             population pnpm SUBMITTED
 *
 * Measured on this repository:
 *
 *     pnpm audit --json                     -> 92 records; census sums to 92   AGREE
 *     pnpm audit --audit-level=moderate     -> 84 records; census sums to 92   DISAGREE
 *     pnpm audit --audit-level=high         -> 48 records; census sums to 92   DISAGREE
 *
 * A severity threshold removes records and leaves the census alone, so the
 * census witnesses how many advisories the submission was SUPPOSED to carry, and
 * comparing it against the records it actually carries detects a truncated report
 * per severity tier — naming which tier vanished.
 *
 * This is deliberately NOT a remembered constant. A hardcoded "92" would break
 * the gate the next time the registry publishes an advisory, and the pressure
 * to make it pass again would be exactly the pressure that suppresses a real
 * finding. The census moves with the registry, so nothing has to be updated for
 * the gate to keep working, and nothing has to be suppressed for it to go green.
 *
 * ### What the census is NOT — Phase 43 (P42-01), corrected
 *
 * The census is evidence about the package population pnpm was handed. It is
 * NOT a census of this repository, and it is NOT independent of how pnpm was
 * invoked.
 *
 * Phase 42 (P42-01) demonstrated this against a real graph rather than arguing
 * it. `pnpm audit --dev` submits only the devDependency closure, so the registry
 * faithfully describes THAT population and the census agrees with the truncated
 * record set:
 *
 *     pnpm audit --json   -> 92 records; census 92; metadata.totalDependencies 1494
 *     pnpm audit --dev    -> 22 records; census 22; metadata.totalDependencies 1022
 *     pnpm audit --prod   -> 77 records; census 77; metadata.totalDependencies 1111
 *
 * Every number is internally consistent. Nothing is forged, so no check that
 * reads only the report can refute it — including this one. With `undici` (a
 * prod-only package this repository deliberately floored) reverted to a
 * vulnerable version, `--dev` returned a report in which that package appears
 * nowhere, and this gate passed.
 *
 * Phase 43 therefore adds a second, independent witness:
 * `metadata.totalDependencies` is compared against the number of packages
 * `pnpm-lock.yaml` actually resolves, and the invocation is held to an exact
 * canonical form rather than screened against a list of known-bad flags.
 *
 * ### Residual boundary, stated accurately — corrected in Phase 43
 *
 * The Phase 41 version of this section was too narrow, and Phase 42 (P42-03)
 * recorded why: it implied that producing a coherent forged report required also
 * rewriting this control, the lockfile, or the floor policy. That is not so.
 *
 * Rewriting ONLY `metadata` in the report — no edit to this file, to
 * `pnpm-lock.yaml`, or to `security/dependency-security-floor.json` — yields a
 * coherent report that reconciles perfectly and that this gate accepts. The
 * Phase 43 population check narrows this: a forged `totalDependencies` must also
 * equal the lockfile's own package count, so the forgery now has to agree with
 * the resolved graph as well. But it is still a forgery reachable from inside
 * the report, and that is the honest boundary:
 *
 *   - a report whose `advisories` AND `metadata` both agree with each other AND
 *     with `pnpm-lock.yaml` cannot be refuted from within the report alone.
 *   - Nothing here claims the census is an independent authority. It is the
 *     registry's account of one submission, cross-checked against the graph.
 *
 * What Phase 41 removed is the ACCIDENTAL severity filter. What Phase 43 removes
 * is the ACCIDENTAL scope filter. What neither removes is a deliberate, coherent
 * forgery of the whole report — and that actor already holds the ability to
 * rewrite this control, the lockfile and the floor policy.
 *
 * Usage:  node scripts/verify-dependency-advisory-visibility.mjs [--audit-file <path>] [--json]
 *         --audit-file  read a saved `pnpm audit --json` report instead of
 *                        invoking the package manager. Used by the mutation
 *                        harness so a synthetic graph can be adjudicated
 *                        without an install, and available for offline triage.
 *                        A saved report is adjudicated by the same census
 *                        contract AND the same population contract, so a report
 *                        saved from a FILTERED run is rejected here exactly as
 *                        a live filtered run is — whether it was filtered by
 *                        severity (Phase 41, F-40-01) or by dependency scope
 *                        (Phase 43, P42-01).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_REL = 'security/dependency-security-floor.json';
const LOCK_REL = 'pnpm-lock.yaml';
const policyPath = path.join(repoRoot, POLICY_REL);
const lockPath = path.join(repoRoot, LOCK_REL);
const asJson = process.argv.includes('--json');
const auditFileIndex = process.argv.indexOf('--audit-file');

/**
 * Severities that are BELOW the pipeline's operating threshold.
 *
 * This constant is the entire point of the gate, so it is written out rather
 * than derived. If someone narrows it to `['moderate']`, the 8 low advisories
 * go back to being invisible — and the mutation harness M-LOW proves that,
 * because a low-severity advisory against a floored package must be reported.
 */
const BELOW_THRESHOLD_SEVERITIES = ['moderate', 'low'];

/**
 * The EXACT argv used to obtain the advisory population.
 *
 * Phase 41: hoisted to a frozen constant and then audited by the gate itself.
 * The Phase 40 review showed that the only thing standing between the gate and
 * the original blind spot was the absence of a `--audit-level` token on one
 * `spawnSync` call — an invariant enforced by convention, which is the same
 * shape of defect the census check below exists to remove. It is now a check.
 *
 * Phase 43 (P42-01): this is now held to a CANONICAL FORM rather than screened
 * against a list of known-bad flags. See CANONICAL_AUDIT_ARGV.
 */
const AUDIT_ARGV = Object.freeze(['audit', '--json']);

/**
 * The one audit invocation this gate is permitted to make — Phase 43 (P42-01).
 *
 * ## Why an allowlist rather than a longer denylist
 *
 * Phase 41 screened `AUDIT_ARGV` against `SEVERITY_FILTER_FLAGS`, a list of
 * flags known to truncate advisory RECORDS. Phase 42 (P42-01) found the bypass
 * that list could not see: `pnpm audit --dev` and `--prod` do not filter by
 * severity at all. They reduce the set of PACKAGES pnpm submits to the registry,
 * so the registry census describes that smaller population and continues to
 * agree with the truncated record set. The census cannot detect this class,
 * because the forged report is not forged at all — it is internally consistent.
 *
 * Measured on this repository (pnpm 11.25.0), so the design is based on observed
 * behaviour rather than on the documented flag list:
 *
 *     invocation        records  census  metadata.totalDependencies
 *     (none)               92      92  1494   <- the complete graph
 *     --dev / -D           22      22  1022   <- reduced population
 *     --prod / -P          77      77  1111   <- reduced population
 *     --no-optional        92      92  1379   <- reduced population
 *     --audit-level=high   48      92  1494   <- population intact, records cut
 *
 * A denylist would have had to enumerate `--dev`, `-D`, `--prod`, `-P`,
 * `--optional` and `--no-optional` correctly, forever, across pnpm upgrades.
 * That is exactly the kind of hand-maintained list that silently drifts: the
 * same investigation that found the bypass also found that `--severity` — which
 * Phase 41 defended against — is not a valid pnpm 11 flag at all. A list whose
 * entries are already partly fictional is not a security boundary.
 *
 * So the invariant is stated positively: the invocation IS the canonical one.
 * Any deviation — an extra token, a reordered argument, an unknown future flag —
 * is a failure, and does not depend on having enumerated the flag correctly.
 *
 * ## This is checked, not conventional
 *
 * `auditInvocationProblems()` below compares the RUNTIME value of `AUDIT_ARGV`
 * against this constant. It inspects the array that will actually be handed to
 * `spawnSync`, not the source text, so an argv assembled through `.concat()`,
 * a spread of another constant, or a helper function is judged on what it
 * produces rather than on how it was spelled. Phase 43 proves both.
 */
const CANONICAL_AUDIT_ARGV = Object.freeze(['audit', '--json']);

/**
 * Flags that reduce or reshape the audited PACKAGE POPULATION — Phase 43.
 *
 * These do not filter advisory records by severity, so `SEVERITY_FILTER_FLAGS`
 * below never sees them and the census reconciliation cannot refute them. They
 * are listed for DIAGNOSTIC QUALITY: when the canonical-form check fires, the
 * operator is told which of these population-reducing flags was responsible
 * rather than only that "something" differed.
 *
 * This list is deliberately NOT the security boundary — `CANONICAL_AUDIT_ARGV`
 * is. Treat these as an explanation attached to a failure, never as the check.
 * Both the long and short spellings are listed because pnpm accepts both and
 * only the long form is documented.
 */
const DEPENDENCY_SCOPE_FLAGS = Object.freeze([
  '--dev',
  '-D',
  '--prod',
  '-P',
  '--optional',
  '--no-optional',
  '--filter',
  '--recursive',
  '--workspace-root',
  '--lockfile-only',
]);

/**
 * Flags that would truncate the advisory RECORDS before this script observes
 * them, while leaving `metadata.vulnerabilities` (the census) complete — which
 * is what makes them detectable rather than merely wrong.
 *
 * Phase 43 retains this list and this check unchanged. `--severity` is not a
 * valid pnpm 11 flag (verified against the real binary), so it is inert today;
 * it is kept because removing a Phase 41 protection on the grounds that it is
 * currently unnecessary would be a different decision from this phase's brief,
 * and because a future pnpm may add it.
 */
const SEVERITY_FILTER_FLAGS = Object.freeze(['--audit-level', '--severity']);

/**
 * The severity tiers pnpm's audit report enumerates in its census.
 *
 * Declared explicitly rather than inferred from the report, so a report that
 * invents a tier — or drops one — is a failure instead of silently redefining
 * what "complete" means.
 */
const CANONICAL_SEVERITIES = Object.freeze(['info', 'low', 'moderate', 'high', 'critical']);

const results = [];
let failures = 0;

function record(ok, check, detail) {
  results.push({ check, verdict: ok ? 'OK' : 'FAIL', detail });
  if (!ok) failures += 1;
  return ok;
}

const isCount = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Load the `yaml` parser from the dependency graph — Phase 43.
 *
 * Resolved exactly as `scripts/verify-ci-parity.mjs` resolves it: the package is
 * already in the graph (Next.js depends on it) and is located by scanning
 * `node_modules/.pnpm` for `yaml@*` rather than by pinning one version path, so
 * a `yaml` upgrade does not break this gate. The parity contract is what proves
 * a gate is still wired into CI, so this gate deliberately parses the lockfile
 * with the SAME parser the parity contract uses rather than a second one.
 *
 * A parser that cannot be loaded is a FAILURE, never a silent skip — see
 * `readAuditedPopulation()`.
 */
function loadYaml() {
  const candidates = [
    'yaml',
    ...readdirSync(path.join(repoRoot, 'node_modules/.pnpm'))
      .filter((d) => d.startsWith('yaml@'))
      .map((d) => path.join(repoRoot, 'node_modules/.pnpm', d, 'node_modules/yaml')),
  ];
  for (const c of candidates) {
    try {
      return createRequire(import.meta.url)(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('could not load the `yaml` parser from the dependency graph');
}

/**
 * How many packages the RESOLVED GRAPH contains — Phase 43.
 *
 * This is the repository-side half of the P42-01 remediation. The census check
 * can only prove the report accounts for the population that was SUBMITTED to
 * pnpm audit; it says nothing about whether that population was the whole graph.
 * Counting the lockfile's own package entries answers the second question
 * independently, and does so from a file the advisory report never mentions.
 *
 * `packages:` is used rather than `snapshots:` deliberately: pnpm's
 * `metadata.totalDependencies` equals the `packages` entry count on this
 * repository (1494), while `snapshots` is larger (1496) because it carries
 * peer-resolution variants. Using `snapshots` would therefore fail a completely
 * unfiltered audit, which is the opposite of useful.
 *
 * Any failure here is a FAILURE. A gate that cannot count the graph must not
 * claim the report covered it.
 */
function countLockfilePackages() {
  const YAML = loadYaml();
  const parsed = YAML.parse(readFileSync(lockPath, 'utf8'));
  const packages = parsed?.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error(`${LOCK_REL} carries no readable \`packages\` section`);
  }
  return Object.keys(packages).length;
}

/**
 * Prove the report describes the COMPLETE resolved graph — Phase 43 (P42-01).
 *
 * pnpm reports `metadata.totalDependencies`: how many resolved dependencies it
 * submitted to the registry. Measured against this repository's lockfile, that
 * number is 1494 for an unfiltered audit and strictly smaller for every
 * population-reducing flag found:
 *
 *     (none)          1494      --dev / -D      1022
 *     --prod / -P     1111      --no-optional   1379
 *
 * So a mismatch is direct evidence that fewer packages were submitted than the
 * graph contains, and it is evidence the census CANNOT supply, because a reduced
 * submission also produces a proportionally reduced census.
 *
 * This check runs on the report itself, so it holds for a live audit AND for a
 * report handed in through `--audit-file`. Phase 42's reproduction passed a
 * `--dev` report in through that flag; this is what now stops it.
 *
 * Fails closed on every uncertainty: a missing or non-integer
 * `totalDependencies`, an unreadable lockfile, an unparseable lockfile, and a
 * `yaml` parser that cannot be loaded are all failures, because "cannot be
 * proven" must not read as "proven".
 */
function checkAuditedPopulation(audit) {
  const reported = audit?.metadata?.totalDependencies;
  if (!isCount(reported)) {
    return {
      ok: false,
      reason:
        `the report carries no usable \`metadata.totalDependencies\`, so the number of packages pnpm actually ` +
        `submitted to the registry cannot be established (got ${JSON.stringify(reported ?? null)}). That figure is ` +
        'the only evidence that the audit covered the whole resolved graph rather than a dependency-scope ' +
        'subset of it, so its absence cannot be read as coverage.',
    };
  }
  let expected;
  try {
    expected = countLockfilePackages();
  } catch (err) {
    return {
      ok: false,
      reason:
        `the resolved graph could not be counted, so the audited population cannot be corroborated against ` +
        `it: ${err.message}. ${LOCK_REL} exists (checked earlier), so this is a read or parse failure. A gate ` +
        'that cannot read the graph must not assert the report covered it.',
    };
  }
  if (reported !== expected) {
    const direction = reported < expected ? 'FEWER' : 'MORE';
    return {
      ok: false,
      reason:
        `pnpm audited ${reported} dependencies but ${LOCK_REL} resolves ${expected}, so ${direction} packages ` +
        `than the graph contains were submitted to the registry (${expected - reported} missing). A ` +
        'dependency-SCOPE filter -- `--dev`, `--prod`, `--optional`, `--no-optional` and their short forms -- ' +
        'reduces the submitted population, and it reduces the severity census by exactly the same proportion, ' +
        'so the census alone cannot refute it. This report does NOT describe the complete advisory set for this ' +
        'repository, and the floors declared in security/dependency-security-floor.json cannot be proven to hold ' +
        'against packages that were never audited.',
    };
  }
  return {
    ok: true,
    detail:
      `pnpm submitted ${reported} dependencies and ${LOCK_REL} resolves ${expected}, so the audited population ` +
      'is the complete resolved graph rather than a scope subset of it.',
  };
}

/**
 * Phase 43: judge the audit invocation against the canonical form.
 *
 * Returns a list of human-readable problems; empty means the invocation is the
 * one this gate is permitted to make. Evaluates the RUNTIME value of
 * `AUDIT_ARGV`, so argv assembled by `.concat()`, spread, or a helper is judged
 * on what it produces rather than on how it was written.
 *
 * Three separate problems are reported rather than one, because they are three
 * different mistakes and an operator who is told only "argv differs" has to
 * rediscover which one they made:
 *
 *   1. a known population-scope flag   -> names it, and what it hid
 *   2. a known severity flag           -> the Phase 41 condition, retained
 *   3. any other deviation at all      -> an ALLOWLIST, so unknown future flags
 *                                          fail closed instead of passing
 */
function auditInvocationProblems(argv) {
  const problems = [];
  const tokens = Array.isArray(argv) ? argv : [];

  const flagOf = (t) => {
    const s = String(t);
    const eq = s.indexOf('=');
    return eq === -1 ? s : s.slice(0, eq);
  };
  const flags = tokens.filter((t) => String(t).startsWith('-')).map(flagOf);

  const scope = flags.filter((f) => DEPENDENCY_SCOPE_FLAGS.includes(f));
  if (scope.length > 0) {
    problems.push(
      `it carries the dependency-SCOPE flag(s) ${scope.join(', ')}. These do not filter by severity — they ` +
        'reduce the set of PACKAGES pnpm submits to the registry, and the census shrinks in the same ' +
        'proportion, so the census reconciliation cannot detect them. A prod-only package under a floor ' +
        '(this repository has one) can be excluded entirely and still pass every other check here.',
    );
  }

  const severity = flags.filter((f) => SEVERITY_FILTER_FLAGS.includes(f));
  if (severity.length > 0) {
    problems.push(
      `it carries the severity flag(s) ${severity.join(', ')}. That removes advisory RECORDS while leaving ` +
        'the census complete, which is the Phase 41 (F-40-01) condition.',
    );
  }

  const same =
    tokens.length === CANONICAL_AUDIT_ARGV.length &&
    tokens.every((t, i) => String(t) === CANONICAL_AUDIT_ARGV[i]);
  if (!same) {
    problems.push(
      `argv is [${tokens.map((t) => JSON.stringify(String(t))).join(', ')}] but the only permitted invocation ` +
        `is [${CANONICAL_AUDIT_ARGV.map((a) => JSON.stringify(a)).join(', ')}]. This is an ALLOWLIST, not a ` +
        'denylist: an unrecognised flag is a failure precisely because this list cannot be relied upon to ' +
        'enumerate every flag that reduces the audited population.',
    );
  }

  return problems;
}

/**
 * Read the report's registry-derived severity census.
 *
 * Phase 41. This is the authoritative witness to the size of the advisory
 * population the report was supposed to carry. It is a separate part of the
 * document from the advisory records and it is NOT truncated by a severity
 * threshold, so the two are independent enough to check each other.
 *
 * Every failure mode is a FAILURE. A report whose census is absent, non-numeric,
 * negative, or declares an unrecognised tier cannot be reconciled against its
 * records, and "cannot be reconciled" must never read as "reconciled".
 */
function readCensus(audit) {
  const raw = audit?.metadata?.vulnerabilities;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason:
        'the report carries no `metadata.vulnerabilities` census. That census is the registry\'s statement of how ' +
        'many advisories the population contains, and it is the only thing in this document that can prove the ' +
        'advisory records were not filtered. Without it this gate cannot know whether it is looking at the full set.',
    };
  }
  const malformed = Object.entries(raw).filter(([, v]) => !isCount(v));
  if (malformed.length > 0) {
    return {
      ok: false,
      reason: `the census carries non-numeric or negative counts, which makes it unusable as a witness: ${malformed
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ')}.`,
    };
  }
  const unrecognised = Object.keys(raw).filter((k) => !CANONICAL_SEVERITIES.includes(k));
  if (unrecognised.length > 0) {
    return {
      ok: false,
      reason:
        `the census declares severity tiers this gate does not recognise: ${unrecognised.join(', ')}. A report ` +
        'that invents a tier cannot be reconciled against a fixed definition of "complete".',
    };
  }
  // Absent tiers are read as zero. A registry that omits a zero-valued tier is
  // still describing the same population; inventing a tier is not.
  const census = {};
  for (const tier of CANONICAL_SEVERITIES) census[tier] = raw[tier] ?? 0;
  return { ok: true, census };
}

/**
 * Reconcile the advisory records against the census, per severity tier.
 *
 * This is the check that makes "the full advisory set was observed" a fact
 * rather than a slogan. It answers one question: does the set of records
 * account for exactly the population the registry says exists? A truncated
 * report answers no, and the offending tier is named so the operator can see
 * which filter bit.
 */
function reconcileRecordsAgainstCensus(entries, census) {
  const observed = {};
  for (const tier of CANONICAL_SEVERITIES) observed[tier] = 0;
  const unlabelled = [];
  for (const [id, a] of entries) {
    const sev = a?.severity;
    if (typeof sev !== 'string' || !CANONICAL_SEVERITIES.includes(sev)) {
      unlabelled.push(`${id} (severity=${JSON.stringify(sev ?? null)})`);
      continue;
    }
    observed[sev] += 1;
  }
  if (unlabelled.length > 0) {
    return {
      ok: false,
      reason:
        `${unlabelled.length} advisory record(s) carry no recognised severity tier, so they cannot be ` +
        `reconciled against the census: ${unlabelled.slice(0, 5).join(', ')}${unlabelled.length > 5 ? ', …' : ''}. ` +
        'A record the census cannot account for is a record whose visibility cannot be trusted.',
    };
  }

  const censusTotal = CANONICAL_SEVERITIES.reduce((n, t) => n + census[t], 0);
  const observedTotal = entries.length;
  const shortfalls = [];
  const excesses = [];
  for (const tier of CANONICAL_SEVERITIES) {
    const delta = census[tier] - observed[tier];
    if (delta > 0) shortfalls.push(`${tier}: ${delta} missing`);
    else if (delta < 0) excesses.push(`${tier}: ${-delta} more records than the census reports`);
  }

  if (shortfalls.length === 0 && excesses.length === 0) {
    return {
      ok: true,
      detail:
        `the advisory set accounts for the entire population the registry reports: ${observedTotal} record(s) ` +
        `against a census of ${censusTotal} (${CANONICAL_SEVERITIES.map((t) => `${t} ${census[t]}`).join(', ')}). ` +
        'No severity tier is missing, so no SEVERITY threshold was applied to this report. That is a statement ' +
        'about the tiers only: the census describes the packages pnpm was given, so a dependency-SCOPE filter ' +
        'would still reconcile here. `checkAuditedPopulation()` below is what rules that class out.',
    };
  }

  return {
    ok: false,
    reason:
      `this report is NOT the full advisory set. Its records (${observedTotal}) do not account for the ` +
      `${censusTotal} advisories the registry reports, and the census is unaffected by any severity threshold — ` +
      `so the difference is a filter, not a quiet week. ` +
      (shortfalls.length ? `MISSING from the records: ${shortfalls.join('; ')}. ` : '') +
      (excesses.length ? `UNACCOUNTED FOR in the records: ${excesses.join('; ')}. ` : '') +
      'A filtered report is indistinguishable from a clean one by record count alone, which is why this gate ' +
      'reconciles against the census rather than trusting that the report is merely non-empty.',
  };
}

/** Load the audit report: a saved file if asked, otherwise the live package manager. */
function loadAudit() {
  if (auditFileIndex >= 0) {
    const file = process.argv[auditFileIndex + 1];
    if (!file) {
      record(false, 'the audit report is readable', '--audit-file was given with no path');
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      record(true, 'the audit report is readable', file);
      return parsed;
    } catch (err) {
      record(false, 'the audit report is readable', `${file}: ${err.message}`);
      return null;
    }
  }

  // Phase 41: the invariant that the live invocation carries no severity
  // threshold is now CHECKED rather than assumed. A `--audit-level` token here
  // would truncate the records while leaving the census complete, and the
  // reconciliation below would then be the only thing standing between that
  // regression and a silent pass.
  //
  // Phase 43 (P42-01): the Phase 42 escape was NOT a severity flag. `--dev` and
  // `--prod` reduce the submitted PACKAGE POPULATION, which shrinks the census
  // in the same proportion and therefore reconciles perfectly. The Phase 41
  // check below still runs — it is not replaced — but it is no longer the only
  // thing standing here, and it could never have been sufficient on its own.
  const invocationProblems = auditInvocationProblems(AUDIT_ARGV);

  const filterTokens = AUDIT_ARGV.filter(
    (a) => SEVERITY_FILTER_FLAGS.includes(a) || SEVERITY_FILTER_FLAGS.some((f) => a.startsWith(`${f}=`)),
  );
  record(
    filterTokens.length === 0,
    'the audit invocation applies no severity threshold',
    filterTokens.length === 0
      ? `argv is \`pnpm ${AUDIT_ARGV.join(' ')}\`, with no ${SEVERITY_FILTER_FLAGS.join('/')} token. The advisory ` +
        'records this gate reads are therefore the untruncated population, and the census below can corroborate it.'
      : `argv carries ${filterTokens.join(', ')}. That flag removes advisory RECORDS without touching the census, ` +
        'so this gate would be adjudicating a filtered set while reporting that it saw everything.',
  );

  // Phase 43: the canonical-invocation check. This is the P42-01 remediation on
  // the invocation side; `checkAuditedPopulation()` below is the other half, on
  // the report side.
  record(
    invocationProblems.length === 0,
    'the audit invocation is the canonical complete-population form (Phase 43 P42-01)',
    invocationProblems.length === 0
      ? `argv is exactly \`pnpm ${CANONICAL_AUDIT_ARGV.join(' ')}\`: no severity threshold, no dependency-scope ` +
        'filter, and no unrecognised argument of any kind. The packages pnpm is about to submit are therefore ' +
        'the whole resolved graph, which `metadata.totalDependencies` then corroborates below.'
      : `argv is \`pnpm ${AUDIT_ARGV.join(' ')}\`, which is not the invocation this gate is permitted to make, ` +
        `for ${invocationProblems.length} independent reason(s):\n  - ${invocationProblems.join('\n  - ')}\n` +
        'Phase 42 (P42-01) reproduced a silent pass through exactly this check: `--dev` was accepted, the report ' +
        'reconciled against its own reduced census, and the gate printed that the set was proven unfiltered ' +
        'while a floored prod-only package went unaudited entirely.',
  );

  // NOTE: deliberately NO `--audit-level` here, and none is permitted by the
  // checks above. That flag is one of the two filters that created the blind
  // spot: it removes advisories from the JSON before this script can observe
  // them. Phase 41 adds a second line of defence — the census reconciliation —
  // so that even a report handed in via `--audit-file` from a filtered run is
  // rejected rather than believed.
  //
  // Phase 43 adds a third, and it is the one that closes P42-01: the population
  // check further down runs on the REPORT, so it holds for a live audit and for
  // anything handed in through `--audit-file`. No severity filter and no scope
  // filter survives both.
  const res = spawnSync('pnpm', AUDIT_ARGV, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (res.error) {
    record(false, '`pnpm audit --json` runs', res.error.message);
    return null;
  }
  if (res.status !== 0 && !res.stdout?.trim()) {
    record(false, '`pnpm audit --json` produces a report', `exit=${res.status}: ${(res.stderr ?? '').slice(0, 300)}`);
    return null;
  }
  try {
    const parsed = JSON.parse(res.stdout);
    record(true, '`pnpm audit --json` produces a report', `exit=${res.status}`);
    return parsed;
  } catch (err) {
    record(false, '`pnpm audit --json` output is parseable', err.message);
    return null;
  }
}

function run() {
  // --- the floor policy, which names the packages this gate guards ---------
  if (!existsSync(policyPath)) {
    record(
      false,
      'the dependency security floor policy exists',
      `${POLICY_REL} is missing, so there is nothing to hold advisories against. A visibility gate with no ` +
        'policy would report on nothing while appearing to pass.',
    );
    return report();
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (err) {
    record(false, `${POLICY_REL} is parseable JSON`, err.message);
    return report();
  }
  if (!Array.isArray(policy?.floors) || policy.floors.length === 0) {
    record(
      false,
      'the floor policy declares at least one floor',
      `got ${Array.isArray(policy?.floors) ? `${policy.floors.length} floor(s)` : typeof policy?.floors}. An empty ` +
        'floor list would leave this gate guarding nothing.',
    );
    return report();
  }
  const flooredPackages = new Set(
    policy.floors.filter((f) => typeof f?.package === 'string').map((f) => f.package),
  );
  record(
    true,
    'the floor policy declares at least one floor',
    `${flooredPackages.size} package(s) under a floor: ${[...flooredPackages].join(', ')}`,
  );

  if (!existsSync(lockPath)) {
    record(false, `${LOCK_REL} exists`, 'the resolved graph cannot be read, so the graph cannot be corroborated');
    return report();
  }
  record(true, `${LOCK_REL} exists`, '');

  // --- the full advisory set ----------------------------------------------
  const audit = loadAudit();
  if (!audit) return report();

  const advisories = audit?.advisories;
  if (!advisories || typeof advisories !== 'object' || Array.isArray(advisories)) {
    record(
      false,
      'the audit report carries an advisory set',
      'no usable `advisories` object. A report without advisories is not evidence that there are none.',
    );
    return report();
  }

  const entries = Object.entries(advisories);
  // An empty set is a FAILURE, not a pass. If `--audit-level` is ever
  // reintroduced here, or the registry returns nothing, this is the check that
  // notices — a gate that treats "I saw no advisories" as success is exactly
  // the defect class this exists to end.
  if (entries.length === 0) {
    record(
      false,
      'the audit report is not empty',
      'zero advisories were returned. That is a broken or filtered report, not a clean bill of health: this gate ' +
        'exists because a filtered report looks identical to a clean one.',
    );
    return report();
  }

  const bySeverity = {};
  for (const [, a] of entries) {
    const s = typeof a?.severity === 'string' ? a.severity : 'unknown';
    bySeverity[s] = (bySeverity[s] ?? 0) + 1;
  }
  record(
    true,
    'the audit report is not empty',
    `${entries.length} advisories observed: ${Object.entries(bySeverity).map(([k, v]) => `${v} ${k}`).join(', ')}`,
  );

  // --- Phase 41: COMPLETENESS, which non-emptiness is not -----------------
  //
  // The check above proves the report is non-empty. It does NOT prove the
  // report is complete, and the difference is the whole of F-40-01: a
  // `--audit-level=moderate` run leaves 84 of 92 advisories behind, which is
  // comfortably non-empty and still not the full set.
  //
  // Completeness is established against the report's own registry-derived
  // census, per severity tier. This runs whether the report came from the live
  // package manager or from `--audit-file`, so a fixture saved from a filtered
  // run is rejected on exactly the same grounds as a live filtered run.
  const censusResult = readCensus(audit);
  if (!record(
    censusResult.ok,
    'the audit report carries the registry severity census',
    censusResult.ok
      ? `census declares ${CANONICAL_SEVERITIES.filter((t) => t in (audit?.metadata?.vulnerabilities ?? {})).join(', ')} ` +
        `(${CANONICAL_SEVERITIES.map((t) => `${t} ${censusResult.census[t]}`).join(', ')}; total ` +
        `${CANONICAL_SEVERITIES.reduce((n, t) => n + censusResult.census[t], 0)})`
      : censusResult.reason,
  )) {
    return report();
  }

  const reconciled = reconcileRecordsAgainstCensus(entries, censusResult.census);
  if (!record(
    reconciled.ok,
    'the advisory records account for the whole population, i.e. the report is UNFILTERED',
    reconciled.ok ? reconciled.detail : reconciled.reason,
  )) {
    return report();
  }

  // --- Phase 43 (P42-01): the POPULATION, which the census cannot prove ----
  //
  // The check above reconciles the records against `metadata.vulnerabilities`.
  // That census is the registry's account of the packages pnpm SUBMITTED, so
  // proving the records match it proves the report is complete *relative to the
  // submission* — and says nothing about the submission itself.
  //
  // Phase 42 (P42-01) exploited exactly that gap. `pnpm audit --dev` submits
  // only the devDependency closure; the registry describes that smaller
  // population; the census and the records agree perfectly; and this gate
  // reported that the set was "proven UNFILTERED". Meanwhile the prod-only
  // `undici` — a package this repository deliberately floored — was never
  // audited at all, so its floor could not be proven to hold no matter what the
  // census said.
  //
  // This check closes that by corroborating the submission against the resolved
  // graph, which the advisory report never mentions. It is placed AFTER the
  // census check on purpose: the census check answers "is this report internally
  // complete?", this one answers "was the right population audited?". Keeping
  // them sequential and separately named means a failure says which of the two
  // questions was answered badly.
  //
  // It also runs in `--audit-file` mode, which is how Phase 42 delivered the
  // bypass: a saved `--dev` report is rejected here on the evidence of its own
  // `metadata.totalDependencies`, with no live audit and no argv involved.
  const population = checkAuditedPopulation(audit);
  if (!record(
    population.ok,
    'the audited population is the complete resolved graph, not a dependency-scope subset (Phase 43 P42-01)',
    population.ok ? population.detail : population.reason,
  )) {
    return report();
  }

  // --- THE ASSERTION: a floored package may carry NO advisory -------------
  //
  // Not "no critical/high advisory", and not "no advisory at or above the
  // floor version". ANY advisory against a floored package means the floor is
  // not doing its job, whatever the severity and whatever the resolved version.
  const againstFloored = entries
    .filter(([, a]) => typeof a?.module_name === 'string' && flooredPackages.has(a.module_name))
    .map(([id, a]) => ({
      id,
      module: a.module_name,
      severity: a.severity ?? 'unknown',
      vulnerable: a.vulnerable_versions ?? '?',
      patched: a.patched_versions ?? '?',
    }));

  record(
    againstFloored.length === 0,
    'no advisory exists against a package the security floor claims to remediate',
    againstFloored.length === 0
      ? `checked ${flooredPackages.size} floored package(s) against ${entries.length} advisories`
      : againstFloored
          .map(
            (a) =>
              `${a.id} (${a.severity}) ${a.module}: vulnerable ${a.vulnerable}, patched ${a.patched}. The floor ` +
              `claims ${a.module} is remediated, so this advisory is a floor failure regardless of severity — and ` +
              'this is precisely the class of finding that is invisible to a critical/high-only pipeline.',
          )
          .join('\n  '),
  );

  // --- the sub-threshold advisories, counted so the gap is on the record ---
  const belowThreshold = entries.filter(([, a]) => BELOW_THRESHOLD_SEVERITIES.includes(a?.severity));
  const belowByPackage = {};
  for (const [, a] of belowThreshold) {
    const m = typeof a?.module_name === 'string' ? a.module_name : '(unknown)';
    (belowByPackage[m] ??= []).push(a.severity);
  }
  record(
    true,
    'the count of advisories BELOW the pipeline threshold is reported',
    belowThreshold.length === 0
      ? 'none below the threshold'
      : `${belowThreshold.length} of ${entries.length} advisories are below the critical/high threshold and are ` +
        `not adjudicated by triage: ${Object.entries(belowByPackage)
          .map(([m, list]) => `${m} (${list.length} ${[...new Set(list)].join('/')})`)
          .join(', ')}. Recorded, not suppressed; remediating them needs dependency upgrades and is tracked ` +
        'as open work, not closed by this gate.',
  );

  report();
}

function report() {
  if (asJson) {
    console.log(JSON.stringify({ results, failures }, null, 2));
    process.exit(failures > 0 ? 1 : 0);
  }

  console.log('\nPhase 39 (F-39-01) + Phase 41 (F-40-01) + Phase 43 (P42-01) — every advisory the pipeline must see, is seen\n');
  console.log('  the pipeline filters to critical/high twice (pnpm --audit-level=high, then the triage');
  console.log('  severity filter), so 44 advisories were reaching no gate. This gate reads the untruncated set and');
  console.log('  PROVES it is untruncated, in two independent ways, because neither alone is sufficient:');
  console.log('    - SEVERITY: pnpm emits a registry severity census that --audit-level does not touch, and every');
  console.log('      record is reconciled against it, tier by tier (Phase 41 / F-40-01).');
  console.log('    - POPULATION: metadata.totalDependencies is matched against the packages pnpm-lock.yaml actually');
  console.log('      resolves, and the invocation is held to an exact canonical form (Phase 43 / P42-01). The census');
  console.log('      alone cannot do this — a --dev or --prod audit shrinks the census in the same proportion as the');
  console.log('      records, so it reconciles perfectly while an entire class of packages goes unaudited.');
  console.log('  Non-emptiness alone was never enough: a partial filter leaves a non-empty report (F-40-01), and a');
  console.log('  scope filter leaves a self-consistent one (P42-01).');
  console.log('  It then asserts one thing: a package the security floor claims to remediate carries NO advisory,');
  console.log('  at any severity. It does not adjudicate the sub-threshold remainder — remediating those needs');
  console.log('  dependency upgrades that require authorization this phase does not have.\n');

  for (const r of results) {
    console.log(`    [${r.verdict.padEnd(4)}] ${r.check}`);
    if (r.detail) console.log(`           ${r.detail.replace(/\n/g, '\n           ')}`);
  }
  const ok = results.filter((r) => r.verdict === 'OK').length;
  console.log(`\n  ${results.length} check(s): ${ok} passed, ${failures} failed.\n`);

  if (failures > 0) {
    console.error(
      'FAILED — the advisory set could not be proven complete, the audited population could not be shown to be the\n' +
        'whole resolved graph, or an advisory is present that the security floor is supposed to exclude. Any of those\n' +
        'means the floor is not proven to hold. A report that cannot be reconciled against the registry census, or\n' +
        'whose audited population does not match pnpm-lock.yaml, is treated as a failure rather than as a clean bill\n' +
        'of health — a dependency-SCOPE filter (`--dev`, `--prod`) produces a report that reconciles perfectly and\n' +
        'still describes only part of the graph. Lowering the floor reintroduces a known advisory; the remedy is to\n' +
        'remediate, not to relax the policy.\n',
    );
    process.exit(1);
  }
  console.log(
    'PASSED — completeness was established two ways, and both had to hold. First, the advisory records reconciled\n' +
      'tier-by-tier against the registry severity census, so no severity threshold truncated the set (Phase 41 /\n' +
      'F-40-01). Second, the invocation was the exact canonical complete-population form AND the packages pnpm\n' +
      'audited matched those pnpm-lock.yaml resolves, so no dependency-scope filter hid part of the graph (Phase 43\n' +
      '/ P42-01). On that basis no advisory exists against any package the dependency security floor claims to\n' +
      'remediate. Advisories below the triage threshold are counted and reported so the remaining gap is on the\n' +
      'record rather than out of sight — counted, not adjudicated, and not thereby declared safe.\n',
  );
  process.exit(0);
}

run();
