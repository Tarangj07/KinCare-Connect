# SECURITY_REVIEW_PHASE_44.md — Independent Review of Phase 43

**Subject:** Phase 43 — remediation of P42-01 (dependency-scope filter bypass) and P42-02 (mutation coverage)
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline reviewed:** `199877aef283eff36984114ecf486eaec1554c39` — `HEAD` == `origin/main`
**Reviewed work:** uncommitted working-tree changes (Phase 37 + 38 + 39 + 41 + 43 chain)
**Review date:** 2026-10-01
**Nature:** Review only. No application source, dependency manifest, lockfile, CI workflow, security gate or mutation harness was modified. No fix was implemented. Nothing was committed, pushed, amended, rebased, reset or stashed.

> **NO PRODUCTION-READINESS, STAGING-READINESS OR RELEASE-READINESS CLAIM IS MADE.** No score or ranking is assigned. No advisory is claimed to be suppressed, allow-listed, downgraded or remediated.

---

## 0. Independence disclosure

### 0.1 Did I implement Phase 43?

**No.** This session began with a read-only baseline capture. Every Phase 43 artefact was found already present and uncommitted in the working tree. All conclusions below were re-derived from repository source, pnpm 11.25.0's own distributed source, `pnpm-lock.yaml`, the GitHub Actions API, real audit output and isolated mirrors — **not** by reading `docs/PHASE_43_FINAL_REPORT.md`. I read that report only after my measurements were complete, to compare its claims against what I had measured.

### 0.2 Am I organisationally independent?

**No, and this review cannot discharge an independent-review requirement.**

### 0.3 Do I share the implementer's environment?

**Yes, in every respect that matters.** Same machine, same filesystem, same Node v24.18.0 / pnpm 11.25.0 toolchain, same git identity (`Tarangj07`), same `~/.local/share/pnpm/store`, same corepack pnpm cache, same hosted-runner credentials (`gh` authenticated as `Tarangj07` with `repo` + `workflow` scopes), same Docker daemon and same developer PostgreSQL. I did not build a separate environment, and I could not have.

Consequently I cannot claim:

- separation of duties from the implementing agent;
- independence from the repository owner, who also commissions these reviews;
- an audit function distinct from the party under review; or
- independence in the sense an external auditor or a separate organisation would provide.

### 0.4 Does the organisational-independence gap remain open?

**Yes, and it is one unbroken condition across the whole chain.** `SECURITY_REVIEW_PHASE_42.md` §0 records the identical framing for Phases 39, 40 and 41, and itself discloses that `SECURITY_REVIEW_PHASE_37.md` §2 does the same. Every link in the chain repeats the disclosure; none closes it.

**I repeat it rather than close it.** A reviewer requiring organisational independence must obtain a review from a party outside this repository and session. **This review does not close that requirement for Phase 43, and I am not going to describe it as though it did.**

What this review does rest on, which a reader may weigh accordingly:

- every measurement was taken by me, not read from a report;
- all attacks ran in throwaway mirrors outside the repository, which were removed;
- **five of my own reviewer-harness defects were found, disclosed, discarded and the affected evidence rerun** (§9.4);
- no crash, syntax error, or no-op is counted as a detection anywhere in this document;
- `mutate-container-gate.mjs` is recorded **NOT TESTED** and no conclusion depends on it.

---

## 1. The central question, and my answer

> *"Can an audit invocation produce a dependency population smaller than the repository's intended complete graph while the Phase-43 gate nevertheless accepts it as complete?"*

**Answer, stated precisely: not through any mechanism the gate is able to observe, and yes through one it structurally cannot observe — but the latter cannot produce a green CI.**

I attacked this from eight directions. Results:

| attack surface | outcome |
|---|---|
| **argv** (25 runtime forms) | **REJECTED in all 25.** No bypass. |
| **configuration** (`.npmrc`, 8 vectors) | No effect — `totalDependencies` stayed 1494 in every case. |
| **environment** (`npm_config_*`, `PNPM_*`, 8 vectors) | No effect. |
| **PATH / tool substitution** | **argv allowlist IS bypassable** — but the population invariant caught it. |
| **pnpm semantics** (scope flags, severity flags) | All scope flags rejected; severity flags caught by the census. |
| **lockfile semantics** | Invariant verified against pnpm's own source; robust across graph changes. |
| **report manipulation** | Coherent forgeries accepted — the documented boundary. |
| **CI integration** | Command unchanged and proved so; parity intact. |

**The single most important finding of this review is positive and structural.** I bypassed the argv allowlist completely (a `pnpm` wrapper on `PATH` silently injecting `--dev`, with the gate's validated `AUDIT_ARGV` untouched and the self-check reporting itself satisfied) — and the population invariant caught it. That is exactly the behaviour the Phase 43 B+C design claims, and it means **the allowlist alone would have been insufficient**. Phase 43's reasoning was correct, and I verified it rather than assuming it.

**Where the boundary lies.** A fully coherent report forgery defeats the advisory gate. I reproduced it end to end (§7.3). But it is contained: under the same forged toolchain, **four other dependency gates all fail**, because they read `pnpm-lock.yaml` directly and never invoke `pnpm`. The job cannot go green with a vulnerable graph.

---

## 2. Scope

**In scope.** Independent re-derivation of P42-01 closure; the canonical-invocation allowlist; the `totalDependencies` ↔ lockfile population invariant and its underlying pnpm semantics; configuration/environment/PATH vectors; the report-forging boundary; F-40-01 regression including reconstruction of the Phase-40 gate; all 10 source mutants; the mutation harness's own machinery; CI integration and parity; hosted-CI status; the full regression suite; the supply-chain boundary; and the review-gap history.

**Out of scope and untouched.** Remediation of anything. The pre-existing parity `step.if` gap. Lint debt. Historical review gaps. The 44 sub-threshold advisories. P42-04 (clean-repository limitation). Container image rebuilds.

**Method constraint honoured.** All attacks ran against the real gate binary in mirrors under `/tmp`. The repository was read, never written. The only file this review creates is this document.

---

## 3. Baseline

| Item | Value |
|---|---|
| `HEAD` | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` (identical) |
| Branch | `main` |
| Unpushed commits | 0 |
| Node / pnpm / git / Docker | v24.18.0 / 11.25.0 / 2.53.0 / 29.8.1 |
| Pre-existing tracked modifications | `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`, `scripts/verify-dependency-security-floor.mjs`, `scripts/mutate-dependency-security-floor.mjs` |
| Untracked at baseline | 29 entries — the Phase 37–43 chain: 4 `scripts/` gates+harnesses, `security/`, `docs/PHASE_{27,28,30,32,33,37,38,39,41,43}*`, 11 `SECURITY_REVIEW_PHASE_*.md` |
| Containers at baseline | `pg-pgtest`, `ecc-minio-bootstrap`, `ecc-postgres`, `ecc-redis`, `ecc-minio`, `unruffled_aryabhata` |
| Worktrees | primary only |

**Protected-artefact checksums (baseline, re-verified in §17):**

```
7fa75d7c2388114a96b45b3616bc01d4f005a469367d473ed2b2b34cb018b0a8  pnpm-lock.yaml
19fe8f43efb128f81b0cc192bf0c580521d093a944eb843a8add4c69a609a16c  pnpm-workspace.yaml
1f62d7c4e73088e642575cfa12dbd60e4ba3a031eba00cd53a5ae05134450698  package.json
8fdff747952effdada45c82bab26112c339091ae3be6663f96155cf7ca83eaf5  .github/workflows/ci.yml
6452483654fe95a1ea911984e74d63168e3684d213bc17a2c3aa1c932dcee596  scripts/verify-dependency-advisory-visibility.mjs
04c0d8399b6dd92fe0eb08618b3314e913813612a559c17addd60ab17a64741b  scripts/mutate-dependency-advisory-visibility.mjs
a11bf953dc833b0ee26279d845c839d24dee1904e970fef89faf3f684e21c198  scripts/verify-ci-parity.mjs
e9d61a1a017deee65755b05fc523e60b339748b45ed69a43d60068a9c29fa7f2  scripts/triage-vulnerabilities.mjs
a36fd3e7803a7adbbdd6ac77c0f2a51053899b98ee751d447664ea6ce1d1c9be  apps/api/prisma/schema.prisma
6cbe8d4e37922a2c898c381062e64cef4cbf24ba46c750c4b0384dbb8de7e6de  security/dependency-security-floor.json
8cb99b3568b046a0bea11a69dfcd24726cf7bcdb443bc8eebf1e74239fb009d4  (aggregate of apps/api/prisma/migrations/**)
```

A cleanup script was authored before any temporary resource was created.

---

## 4. Re-deriving P42-01

I reproduced the escape before evaluating the fix.

**Mirror.** `/tmp/opencode/ph44/mirror-vuln`, with the Phase 33 `undici` remediation reverted **in the mirror only** (`'undici@<6.28.1': 6.28.0`), lockfile re-resolved in the mirror. The real `pnpm-lock.yaml` and `pnpm-workspace.yaml` were verified byte-identical immediately afterwards.

**Genuine audit of the reproduced graph:**

```
full   recs 95  census 95  totalDeps 1494  undici: 1239934, 1240039, 1240042
--dev  recs 22  census 22  totalDeps 1022  undici: NONE
--prod recs 80  census 80  totalDeps 1111  undici: 1239934, 1240039, 1240042
--no-optional  recs 95  census 95  totalDeps 1379  undici: 1239934, 1240039, 1240042
-D     recs 22  census 22  totalDeps 1022  undici: NONE
-P     recs 80  census 80  totalDeps 1111  undici: 1239934, 1240039, 1240042
--optional    recs 95  census 95  totalDeps 1494  undici: 1239934, 1240039, 1240042
```

`undici` is prod-only, so `--dev`/`-D` exclude it entirely while the report stays internally consistent (22 records / census 22). **P42-01 reproduced. — REPRODUCED**

**Phase-43 gate against each genuine report:**

| report | verdict | named failure |
|---|---|---|
| `--dev` | exit **1** | `the audited population is the complete resolved graph, not a dependency-scope subset (Phase 43 P42-01)` |
| `--prod` | exit **1** | same |
| `--no-optional` | exit **1** | same |
| `-D` | exit **1** | same |
| `-P` | exit **1** | same |
| `--optional` | exit **1** | `no advisory exists against a package the security floor claims to remediate` (population intact — correctly fails on the floor) |
| full | exit **1** | floor assertion (the mirror genuinely violates the floor) |

**No false claim emitted.** Grepping every rejected output for `proven UNFILTERED` / `no filter was applied to this report` returned **0 occurrences** in all seven cases. — INDEPENDENTLY VERIFIED

---

## 5. The canonical-invocation allowlist

I verified the invariant at runtime rather than by reading the source. Each case mutated `AUDIT_ARGV` in a mirror and ran the gate **LIVE** against the vulnerable graph.

**25 cases, 25 rejected.** Control first: with canonical argv the population is complete, so only the floor assertion fires (exit 1).

| case | argv form | argv check | population check | verdict |
|---|---|---|---|---|
| reordered | `['--json','audit']` | FIRED | silent | REJECT |
| benign extra | `+ --reporter=json` | FIRED | silent | REJECT |
| unknown arg | `+ --totally-unknown` | FIRED | silent | REJECT |
| `--dev` | separate token | FIRED | FIRED | REJECT |
| `--prod` | separate token | FIRED | FIRED | REJECT |
| `--no-optional` | separate token | FIRED | FIRED | REJECT |
| `-D` | **short form** | FIRED | FIRED | REJECT |
| `-P` | **short form** | FIRED | FIRED | REJECT |
| `--optional` | separate token | FIRED | silent | REJECT |
| `--audit-level=high` | `--flag=value` | FIRED | silent | REJECT |
| `--audit-level`,`high` | **space-separated** | FIRED | silent | REJECT |
| `--severity=high` | alias | FIRED | silent | REJECT |
| `--prod-only-deps` | **unknown future flag** | FIRED | silent | REJECT |
| duplicate args | `['audit','--json','--json']` | FIRED | silent | REJECT |
| missing `--json` | `['audit']` | FIRED | silent | REJECT |
| extra `--json` | `['audit','--json','--json','--json']` | FIRED | silent | REJECT |
| `.concat(['--dev'])` | **concat** | FIRED | FIRED | REJECT |
| `[...EXTRA]` | **spread** | FIRED | FIRED | REJECT |
| helper function | `a2('--dev')` | FIRED | FIRED | REJECT |
| separate constant | `const S='--no-optional'` | FIRED | FIRED | REJECT |
| `['--json','audit','--dev']` | filter first | FIRED | FIRED | REJECT |
| built via `.map()` | no-op semantically | silent | silent | REJECT (floor assertion) |
| `Object.freeze` bypassed, `.push('--dev')` after | **mutable-array attack** | FIRED | FIRED | REJECT |

The gate validates the **runtime value** handed to `spawnSync`, not source spelling — every indirection form was caught. — INDEPENDENTLY VERIFIED

### 5.1 Can the effective invocation be altered without changing the validated `AUDIT_ARGV`?

**Yes — via PATH/tool substitution.** I wrote a `pnpm` wrapper that injects `--dev` into any `audit` invocation:

```
LIVE gate, canonical AUDIT_ARGV, wrapper injecting --dev:
  [OK] the audit invocation applies no severity threshold
  [OK] the audit invocation is the canonical complete-population form (Phase 43 P42-01)   <-- ALLOWLIST SATISFIED
  ...
  [FAIL] the audited population is the complete resolved graph ... (Phase 43 P42-01)
         pnpm audited 1022 dependencies but pnpm-lock.yaml resolves 1494 ... (472 missing)
EXIT=1
```

**The allowlist was bypassed and the population invariant caught it.** This is the single most valuable result of this review: it demonstrates empirically that **B alone would not have been sufficient**, and that Phase 43's decision to add C was not defensive decoration. I record this as an observation about design validation, not as a defect — the implemented design is the two-layer one, and it held.

**Configuration and environment — no vector found.** `.npmrc` (`audit-level`, `dev`, `prod`, `optional`, `production`, `dev-dependencies`, `no-optional` — 8 vectors) and environment (`npm_config_audit_level`, `npm_config_dev`, `npm_config_prod`, `npm_config_optional`, `npm_config_production`, `PNPM_DEV`, `PNPM_PROD`, `npm_config_ignore_registry_errors` — 8 vectors) all left `totalDependencies` at **1494** and records at **92**. `pnpm-workspace.yaml` declares no audit-scoping keys. — INDEPENDENTLY VERIFIED (no effect)

---

## 6. The population invariant

This is the control the whole remediation rests on, so I derived its semantics from **pnpm's own distributed source**, not from the implementation's explanation.

### 6.1 What `totalDependencies` actually counts

From `/home/tarang/.cache/node/corepack/v1/pnpm/11.25.0/dist/pnpm.mjs`, `lockfileToAuditRequest()`:

```js
const versionStatesByName = Object.create(null);
let totalDependencies = 0;
const registerOccurrence = (o) => {
  let versionStates = versionStatesByName[o.name];
  if (!versionStates) { versionStates = new Map(); versionStatesByName[o.name] = versionStates; request[o.name] = []; }
  const state = versionStates.get(o.version);
  if (!state) {                                   // first sighting of this (name, version)
    versionStates.set(o.version, {...});
    request[o.name].push(o.version);
    totalDependencies++;                          // <-- counted here
    ...
  }
  ...                                              // later sightings: NOT counted
};
```

So **`totalDependencies` is the number of distinct `(package name, version)` pairs reachable from the importers**, obtained by a graph walk honouring `include` (which dependency types are traversed) and `optionalOnly`. Critically, it is incremented by the **same traversal that builds the submitted advisory request** — so it cannot diverge from what was actually sent. That is the structural reason the invariant is sound. — SOURCE-VERIFIED

### 6.2 What the lockfile `packages` count represents, and whether they are equivalent

| question | finding |
|---|---|
| lockfile `packages` entries | **1494** |
| `snapshots` entries | 1496 (peer-resolution variants, e.g. `@babel/core@7.29.7(supports-color@8.1.1)`) |
| `packages` keys carrying a peer suffix | **0** — verified across all 1494 |
| distinct `name@version` reconstructed from `packages` keys | **1494** |
| `metadata.totalDependencies` (unfiltered audit) | **1494** |
| **Are they equivalent?** | **Yes, for this repository, and for a structural reason**: `packages` is keyed by `name@version` without peer suffixes, while `snapshots` carries the variants. Using `packages` is therefore the correct counterpart to pnpm's `(name, version)` counting. Using `snapshots` would have produced 1496 and failed every legitimate audit — so Phase 43's choice of `packages` is right. |
| workspace packages (`link:`) | 14 across the 8 importers; correctly **excluded** from both sides, because pnpm's walker skips entries with no version |
| dev-only deps | included in the count; `devDependencies`/`optionalDependencies` overlap `dependencies` (1091 + 383 = 1474 ≠ 1494), so those three fields are **not** a partition — only `totalDependencies` is used, correctly |
| Can a valid full audit ever differ? | Not observed. See the robustness test below. |

### 6.3 Robustness: is this a coincidence of today's graph?

Phase 43's report asserts the invariant; I tested whether it survives a graph change, because "byte-identical today" is weak evidence.

In a mirror I added `qs@6.14.0` to `apps/api` and re-resolved:

```
lockfile packages count : 1495   (was 1494)
newdep-full   totalDependencies 1495  -> MATCHES lockfile: YES
newdep-noopt  totalDependencies 1380  -> reduction detected
gate vs newdep-noopt.json: "pnpm audited 1380 dependencies but pnpm-lock.yaml
resolves 1494, so FEWER packages ... (114 missing)"  EXIT=1
```

**The invariant tracks graph changes on both sides and still detects reductions in a changed graph.** It is structural, not a numeric coincidence. — INDEPENDENTLY VERIFIED

### 6.4 Adversarial `totalDependencies` values — 12 attacks, all rejected

| attack | verdict |
|---|---|
| deleted | REJECT — `no usable metadata.totalDependencies` |
| `"1494"` (string) | REJECT |
| `" 1494 "` (padded numeric string) | REJECT |
| `1494.000000001` (float) | REJECT |
| `-1494` | REJECT |
| `null` | REJECT |
| `0` | REJECT |
| `99999` (inflated) | REJECT |
| `[1494]` (array) | REJECT |
| `{n:1494}` (object) | REJECT |
| `true` | REJECT |
| `1494n` (BigInt) | **NOT TESTABLE** — JSON has no BigInt; my harness initially crashed serialising it, which I disclose as my own defect (§9.4) and then dropped as untestable rather than counted as anything |

### 6.5 Fail-closed on lockfile problems

| state | verdict |
|---|---|
| lockfile present but **corrupt YAML** | REJECT — `the resolved graph could not be counted … Flow map in block collection must be sufficiently indented` |
| lockfile valid YAML but **no `packages` section** | REJECT — `carries no readable 'packages' section` |
| lockfile **missing** | REJECT — `pnpm-lock.yaml exists` |

---

## 7. The report-forging boundary

I did not assume the documented boundary was correct; I characterised it.

### 7.1 What the gate CAN establish

- that the records reconcile tier-by-tier with the registry census;
- that the packages pnpm submitted match the packages `pnpm-lock.yaml` resolves;
- that the invocation handed to `spawnSync` was exactly `['audit','--json']`;
- that no advisory exists against any package the floor policy declares.

### 7.2 What the gate CANNOT establish

| attack | verdict | classification |
|---|---|---|
| **metadata-only rewrite** — forged `totalDependencies` matching the lockfile | REJECT (census still incoherent unless also forged) | — |
| **records-only rewrite** — undici records deleted, census left at full | REJECT — `MISSING`/`more records than the census reports` | — |
| **census-only rewrite** — census zeroed, records retained | REJECT | — |
| **totalDependencies-only rewrite** — forged to the lockfile count | REJECT for a scope-reduced report unless the census also agrees | — |
| **records + census coerced together, `totalDependencies` left untouched** | **ACCEPT** | **documented boundary** |
| **`module_name` of a floored package renamed** (`undici` → `totally-not-undici`) | **ACCEPT** | **documented boundary** |
| **coordinated full forgery** via a malicious `pnpm` on PATH | **ACCEPT** | **documented boundary** |

### 7.3 The end-to-end forgery, reproduced

In the vulnerable mirror, a `pnpm` wrapper that emits a doctored-but-coherent report (undici's 3 advisories removed, census decremented by 3, `totalDependencies` untouched at 1494) while the real resolved graph contains `undici@6.28.0`:

```
11 check(s): 11 passed, 0 failed.
PASSED — completeness was established two ways, and both had to hold. ...
EXIT=0
```

Every check passes: the argv allowlist sees canonical argv, the census reconciles, `totalDependencies` matches the lockfile, and the floored package appears nowhere in the forged report.

### 7.4 Is the boundary contained? — Yes, and I verified it rather than assuming

Running the **entire dependency-gate suite** under the same forged `pnpm`:

| gate | invokes `pnpm`? | exit |
|---|---|---|
| `verify-dependency-audit` | **yes** | 1 |
| `verify-dependency-triage` | no (reads lockfile) | 1 |
| `verify-dependency-security-floor` | no (reads lockfile) | **1** |
| `verify-dependency-floor-policy` | no (reads lockfile) | **1** |
| `verify-dependency-advisory-visibility` | **yes** | **0** |

**The advisory gate is fooled; four other gates fail.** `verify-dependency-security-floor` reports `[BREACH] undici@6.28.1 — the graph resolves undici@6.28.0, which is BELOW the floor`. I also confirmed that removing the `undici` override from `pnpm-workspace.yaml` is caught by `verify-dependency-floor-policy` (15/16 checks, `undici has a corresponding pnpm override` fails).

**A forged report cannot produce a green dependency-gate job.** — INDEPENDENTLY VERIFIED

### 7.5 Does the documentation accurately describe this?

**Yes — the Phase 43 header is accurate.** It states:

> *"a report whose `advisories` AND `metadata` both agree with each other AND with `pnpm-lock.yaml` cannot be refuted from within the report alone."*

That describes §7.2 rows 5, 6 and 7 precisely. P42-03's correction genuinely landed.

**Two precision observations**, neither a control defect:

- **INFO — the boundary is broader than the *pinned test*.** `M43-BOUNDARY-POPULATION-ASSERTED` pins only the `totalDependencies`-forgery variant. The §7.2 rows 5 and 6 forgeries are *simpler* — they leave `totalDependencies` truthful — and are not pinned by any mutant. The prose covers them; only the test does not. Narrowing the boundary later would therefore require editing prose rather than deleting a test, which is the opposite of what the harness comment claims for that mutant.
- **INFO — the header attributes the forgery to an actor who can "rewrite this control, the lockfile and the floor policy".** True, but not the only route: PATH substitution forges the report while touching **no tracked file**. Same trust level, different mechanism. Worth stating because a reader could otherwise infer that report forgery requires a repository edit.

Neither affects enforcement. Neither is a bypass. Both are recorded as **INFO**.

---

## 8. F-40-01 regression

Phase 43's population check must not have obscured the Phase-41 census control. I tested that explicitly.

### 8.1 Genuine severity-filtered reports

| report | verdict | named failure |
|---|---|---|
| full | exit 0 (11/11 OK) | — |
| `--audit-level=moderate` (84 recs / census 92) | exit 1 | `MISSING: low: 8 missing` |
| `--audit-level=high` (48 / 92) | exit 1 | `MISSING: low: 8 missing; moderate: 36 missing` |
| `--audit-level=critical` (4 / 92) | exit 1 | `MISSING: low: 8; moderate: 36; high: 44` |

**The census reconciliation remains the named failure for every severity filter**, and the population check stays silent because `--audit-level` does not reduce the population. The two controls are correctly separated. — INDEPENDENTLY VERIFIED

### 8.2 Reconstructing the Phase-40 gate

I rebuilt the Phase-40 gate in a mirror by deleting the Phase-41 census block, the Phase-43 population block, and neutralising the canonical-argv check, then confirmed it parses.

The `--audit-level=high` filter retains `undici`'s HIGH advisory, so that is **not** the historical escape shape. The true F-40-01 escape needs an advisory that is *entirely* below the threshold — `brace-expansion`'s 1240100/1240101, both moderate. In a mirror with `brace-expansion` reverted to 1.1.20/2.1.6:

```
full:  94 recs, census 94, brace-expansion: 1240100:moderate, 1240101:moderate
high:  48 recs, census 94, brace-expansion: NONE

PHASE-40 gate  on the genuine --audit-level=high report: 6 checks, 6 passed  EXIT=0  "PASSED"
PHASE-43 gate  on the SAME report:                             [FAIL] ...the report is UNFILTERED   EXIT=1
```

**The historical F-40-01 escape reproduces against the Phase-40 gate and is closed by the Phase-43 gate.** — REPRODUCED and confirmed closed

### 8.3 The census control is not masked

The Phase-43 gate reports the census check as the failure for severity filters (§8.1), so the Phase-41 control is demonstrably still doing the work rather than being silently replaced. — INDEPENDENTLY VERIFIED

---

## 9. Source-mutation review (F-40-02)

I did not accept the reported tally. I re-implemented all 10 `mutates: 'gate'` mutants in my own harness, **reading each polarity out of the shipped harness source** so my harness could not silently agree with a wrong one.

**10 of 10 independently verified.**

| mutant | polarity (from harness) | non-no-op | parses | no crash | control | mutant | verdict |
|---|---|---|---|---|---|---|---|
| `M41-SRC-SEV-NARROW` | weaken | ✅ | ✅ | ✅ | exit 1 (floor assertion) | **exit 0** | **VERIFIED** |
| `M41-SRC-PKGMATCH` | weaken | ✅ | ✅ | ✅ | exit 1 | **exit 0** | **VERIFIED** |
| `M41-SRC-CENSUS-OFF` | weaken | ✅ | ✅ | ✅ | exit 1 (census) | **exit 0** | **VERIFIED** |
| `M41-SRC-CENSUS-ABSENT-OK` | weaken | ✅ | ✅ | ✅ | exit 1 (census) | **exit 0** | **VERIFIED** |
| `M41-SRC-LEVEL-ADDED` | reject (LIVE) | ✅ | ✅ | ✅ | exit 0 (canonical legitimate) | **exit 1**, argv self-check fired | **VERIFIED** |
| `M41-SRC-EMPTY-TOLERATED` | weaken | ✅ | ✅ | ✅ | exit 1 (not empty) | **exit 0** | **VERIFIED** |
| `M41-SRC-SEVCONST` | pass | ✅ | ✅ | ✅ | exit 1 | exit 1 — **benign change does not weaken** | **VERIFIED** |
| `M43-SRC-POPULATION-OFF` | weaken | ✅ | ✅ | ✅ | exit 1 (population) | **exit 0** | **VERIFIED** |
| `M43-SRC-CANONICAL-OFF-POPULATION-CATCHES` | reject (LIVE) | ✅ | ✅ | ✅ | exit 1 (same argv, guards intact) | **exit 1** | **VERIFIED** |
| `M43-SRC-BOTH-SCOPE-GUARDS-OFF` | weaken (LIVE) | ✅ | ✅ | ✅ | exit 1 (same `--dev`, guards intact) | **exit 0** | **VERIFIED** |

### 9.1 The two critical claims — both confirmed

**Claim 1: disabling canonical argv validation alone MUST NOT allow `--dev`.**

`M43-SRC-CANONICAL-OFF-POPULATION-CATCHES` silences the argv check **and** adds `--dev` to `AUDIT_ARGV`. Result: **exit 1**, and the named failure is `the audited population is the complete resolved graph` — **not** the silenced canonical check. The population invariant independently rejects the scoped audit. I asserted explicitly that the population check is what caught it and the silenced one did not. — **CONFIRMED**

**Claim 2: disabling BOTH scope guards DOES restore the P42-01 escape.**

`M43-SRC-BOTH-SCOPE-GUARDS-OFF` disables both and adds `--dev`, LIVE. Result: **exit 0**. Its paired control — the *same* `--dev` addition with the guards intact — **exits 1**. Both controls are genuinely load-bearing, and removing them restores exactly the Phase-42 silent pass. — **CONFIRMED**

This is the F-40-02 methodology correctly applied to Phase 43's own code, and it holds.

### 9.2 No default/reject mutant misclassified as weaken

Verified: `M41-SRC-LEVEL-ADDED` and `M43-SRC-CANONICAL-OFF-POPULATION-CATCHES` both carry the default reject polarity and both fail closed with exit 1; `M41-SRC-SEVCONST` carries `expected: 'pass'` and correctly stays rejecting. The polarity distinction Phase 43 introduced is correctly encoded. — INDEPENDENTLY VERIFIED

### 9.3 Paired-input integrity

`M41-SRC-CENSUS-ABSENT-OK` and `M43-SRC-POPULATION-OFF` were both extended by Phase 43 because the new population check made them INEFFECTIVE. I verified the extensions are *additive* (census guards + population guard disabled) and that each is fed the same document its pair rejects. `M-EMPTY` / `M41-SRC-EMPTY-TOLERATED` are both now given a coherent `totalDependencies` so the pair differs only in gate source. Both pairs behave as claimed. — INDEPENDENTLY VERIFIED

### 9.4 My own reviewer-harness defects — disclosed, discarded, rerun

Per the review standard I disclose rather than absorb:

1. **`attack-population.mjs` BigInt crash** — `JSON.stringify` cannot serialise a BigInt. The harness died mid-run. I removed that case as **untestable** (JSON has no BigInt) rather than counting it as a pass or a detection.
2. **`attack-population.mjs` wrong baseline** — my D1/D2 "legitimate acceptance" cases used the *vulnerable mirror's* full report, which legitimately fails the floor assertion. I re-ran them against the clean repository's genuine full report (exit 0, 11/11 OK).
3. **`review-source-mutants.mjs` no-op detection inverted** — I compared the mutated source to itself after writing, so every mutant reported "non-no-op: false". Fixed to capture the original before mutation.
4. **`review-source-mutants.mjs` inverted polarity assertion** — I wrote `mut.status !== 1` for a "must be rejected" check. Fixed to `=== 1`.
5. **`review-source-mutants.mjs` wrong fixture base and wrong LIVE control** — I based fixtures on the vulnerable-mirror report (which contains real floored advisories, so the floor assertion fired regardless of the mutation), and I applied a "control exits 0" expectation to LIVE mutants whose meaningful control is the same-argv variant with guards intact. Both fixed; all 10 mutants then verified.

**Every discarded result was discarded. Nothing counted anywhere in this document came from these defective runs.**

---

## 10. Attacking the mutation harness

`"30 applied / 0 escapes"` is worthless unless the harness can actually fail. I tested that directly.

**Sabotage test.** Outside the repository I built a complete harness copy with both scope guards disabled in its gate. Result:

```
TALLY  26 mutant(s) applied, of which 6 mutate the gate's OWN SOURCE:
       4 genuine escapes, 0 detected for the wrong reason,
       0 ineffective, 4 discarded as setup failures.
RESULT  FAIL — 8 problem(s). The advisory-visibility control is not proven.
HARNESS EXIT=1
```

The four escapes were exactly the right mutants: `M43-SCOPE-DEV`, `M43-SCOPE-PROD`, `M43-SCOPE-NO-OPTIONAL`, `M43-SCOPE-METADATA-MISSING`. **The harness genuinely detects an escape of the scope control, and the report-side mutants are what detect it.** The reported "0 escapes" is therefore meaningful. — INDEPENDENTLY VERIFIED

**Machinery audit:**

| property | status |
|---|---|
| gate-source mutation confirmed by change-signal (`m.mutates === 'gate' && !changed.includes('gate')` → discard) | present, line 1276 |
| syntax error cannot count as detection (`isParseableJs` gate before scoring) | present, line 460 |
| setup signatures checked before scoring | present, lines 1219, 1304 |
| unmutated CONTROL gates the whole campaign | present, line 1214 |
| environment inheritance (needed for LIVE mutants that spawn `pnpm`) | `{ ...process.env, CI: '1', FORCE_COLOR: '0' }` — correct and necessary |
| protected-file restore on mismatch | present, line 1399 |
| anchors must occur exactly once (dead anchor → SETUP, discarded) | proven working — the sabotage test produced 4 correct SETUP discards |

**One minor hygiene issue, pre-existing and not Phase-43-introduced — INFO.** The `m.apply()` throw path does `continue` without `rmSync(root)`, leaking that mirror until the final cleanup loop. The end-of-run sweep (`for (const m of createdMirrors) rmSync(...)`) reclaims it, so nothing accumulates across runs and nothing is left behind. Harmless; noted for completeness only.

**Scope coverage.** The harness captures `--dev`, `--prod`, `--no-optional`, `--optional`. It does not capture `--lockfile-only`, `--recursive`, `--workspace-root`, `--filter` — correct, since all are byte-identical to the full audit and admit no population mutant that would not degenerate into a no-op (which is precisely the failure Phase 43 encountered and correctly discarded). No gap.

---

## 11. Re-attacking the claimed scope surface

Every Phase-43 measurement was re-run independently.

| flag | recs | totalDeps | byte-identical to full |
|---|---|---|---|
| *(none)* | 92 | 1494 | — |
| `--optional` | 92 | 1494 | **yes** |
| `--lockfile-only` | 92 | 1494 | **yes** |
| `--recursive` | 92 | 1494 | **yes** |
| `--workspace-root` | 92 | 1494 | **yes** |
| `--filter @ecc/api` | 92 | 1494 | **yes** |
| `--filter @ecc/mobile` | 92 | 1494 | **yes** |
| `--dir apps/api` | 92 | 1494 | **yes** |
| `--filter @ecc/nonexistent` | — | — | non-JSON output → gate fails closed |
| `--filter-prod` | — | — | non-JSON output → gate fails closed |

Phase 43's measurements are **confirmed accurate**. — SOURCE-VERIFIED

**The brief's challenge: does "byte-identical today" mean "cannot alter population in principle"?**

**No — and that distinction does not weaken the control.** I state the three categories explicitly:

- **Actual pnpm 11.25.0 behaviour:** `--dev`/`-D`, `--prod`/`-P`, `--no-optional` reduce the submitted population; `--audit-level` does not. Verified against the binary.
- **Repository-specific behaviour:** that `--optional`, `--lockfile-only`, `--recursive`, `--workspace-root`, `--filter` and `--dir` are no-ops *on this graph today*. They are not guaranteed no-ops in general.
- **Invariant the gate actually enforces:** none of that matters. The gate compares `totalDependencies` to the lockfile count, so **any** future behaviour of those flags that reduced the population would produce a mismatch and be rejected — no enumeration required. I demonstrated this concretely by changing the graph (`§6.3`), where the invariant tracked the change and still caught the reduction.

This is precisely why Phase 43 chose an allowlist plus a measured invariant rather than a flag denylist, and it holds up under the challenge. — INDEPENDENTLY VERIFIED

---

## 12. CI integration

| property | value | verdict |
|---|---|---|
| gate command | `node scripts/verify-dependency-advisory-visibility.mjs` | **exactly matches** parity `exactCommand` |
| job | `api`, step 19 of 29 | correct |
| ordering | `pnpm install --frozen-lockfile` at step 3; gate at 19 | after installation ✅ |
| `if:` | none | no suppression |
| `continue-on-error` | none | no suppression |
| `\|\| true` / `set +e` | none on this step | no suppression |
| `working-directory` | none (defaults to workspace root) | correct |
| `env` | none | correct |
| job-level `if` / `continue-on-error` | none | — |
| duplicate/shadow gate | exactly 2 steps total (gate + harness) | none |
| harness step | `release` step 20, `node scripts/mutate-dependency-advisory-visibility.mjs`, after install at step 3 | correct |

The five `continue-on-error` occurrences and two `|| true` occurrences elsewhere in the workflow are pre-existing and unrelated (API lint, mobile lint, storage-probe traps).

**Did Phase 43 change the CI command? No — proved, not asserted.** I programmatically removed the Phase-43 comment block and the `Phase 43 P42-01` step-label suffix, then re-hashed:

```
reversed              : 860bd055fad2201d3ac7295e2ccb0ec95d6bb729c25a32606123fe62490bf5fb
Phase-43 start baseline: 860bd055fad2201d3ac7295e2ccb0ec95d6bb729c25a32606123fe62490bf5fb
MATCH -> Phase 43 changed ONLY the comment block and the step label
```

A step-label-only change cannot affect enforcement, and parity matches on `exactCommand`, not labels. — INDEPENDENTLY VERIFIED

**Parity.** `scripts/verify-ci-parity.mjs` is **unchanged** by Phase 43 (checksum `a11bf953…` identical to the Phase-42 baseline). Both registrations present at lines 460, 470 and enforced at 976, with unchanged `exactCommand` and targets. On the real tree parity exits 1 with **4 problems, identical in count and cause to the Phase-42 baseline** — all untracked-target failures arising from the uncommitted Phase 37–43 chain (2 Phase 37, 2 Phase 39/41). **This is not a Phase-43 defect**, and I do not report it as one. On a fully-committed mirror of the identical tree parity exits **0**. `mutate-ci-integration.mjs` passes. — INDEPENDENTLY VERIFIED

---

## 13. Hosted CI

**HOSTED CI UNVERIFIED.** Determined from primary GitHub evidence:

| check | result |
|---|---|
| `scripts/verify-dependency-advisory-visibility.mjs` in `199877a`? | **ABSENT** |
| `scripts/mutate-dependency-advisory-visibility.mjs` in `199877a`? | **ABSENT** |
| `docs/PHASE_43_FINAL_REPORT.md` in `199877a`? | **ABSENT** |
| `advisory-visibility` in `199877a:.github/workflows/ci.yml`? | **0** occurrences |
| commits ahead of `origin/main`? | **0** — nothing has been pushed |
| run for `199877a` | `36714434566`, `success`, 2026-09-30 |
| Phase-43 gate text in that run's logs? | **0** mentions |

Nothing has been committed or pushed, so no Phase 37/39/41/43 gate has ever executed on a GitHub runner. The older green run is for a commit that contains none of this work and is **not** evidence for it. Every result in this document is a local result. — HOSTED CI UNVERIFIED

---

## 14. Regression

| Gate | Exit | Result |
|---|---|---|
| `verify-dependency-audit.mjs` | 0 | PASS |
| `verify-dependency-triage.mjs` | 0 | PASS |
| `verify-dependency-security-floor.mjs` | 0 | PASS |
| `verify-dependency-floor-policy.mjs` | 0 | PASS |
| `verify-dependency-advisory-visibility.mjs` (LIVE) | 0 | PASS — **11 checks, 11 passed, 0 failed** |
| `mutate-dependency-advisory-visibility.mjs` | 0 | PASS — 30 applied / 10 source / 20 detected / 7 weakened / 3 tolerated / **0 escapes / 0 wrong-reason / 0 ineffective / 0 setup** |
| `mutate-dependency-security-floor.mjs` | 0 | PASS |
| `mutate-dependency-floor-policy.mjs` | 0 | PASS |
| `mutate-config-contract.mjs` | 0 | PASS |
| `mutate-ci-integration.mjs` | 0 | PASS |
| `verify-ci-parity.mjs --list` | **1** | 4 problems — **all pre-existing untracked-target failures**, identical to the Phase-42 baseline; green on a committed mirror |
| `pnpm typecheck` | 0 | 11/11 tasks |
| `pnpm build` | 0 | 7/7 tasks |
| `pnpm --filter @ecc/web test` | 0 | 1 file / 1 test |
| `pnpm --filter @ecc/mobile test` | 0 | 6 files / 34 tests |
| `run-db-suites.mjs` | 0 | e2e **8 files / 138 tests**; unit+integration **27 files / 348 tests** |
| `verify-release-artifact.mjs` | 0 | PASS — 13 PASS, 0 FAIL |
| `verify-db-migrations.sh` | 0 | PASS — valid, reproducible, idempotent, sufficient |
| `verify:storage:backup` | 0 | PASS |
| `verify:ratelimit:n12:mutate` | 0 | PASS |
| `verify-docker-images.mjs --skip-build` | 0 | PASS — 58 PASS, 0 FAIL. **No rebuild performed.** |
| `pnpm lint` | **1** | **FAILING — reported as failing, not green.** 8/11 tasks; `@ecc/mobile` 18 problems (0 errors, 18 warnings) vs `--max-warnings 0`. **Pre-existing**, identical to the Phase-42 baseline; Phase 43 touched no application source. |

**Docker:** `mutate-container-gate.mjs` — **NOT TESTED**. Not executed, not counted as passing, and no conclusion depends on it.

---

## 15. Supply-chain boundary

Phase 43 did **not**: upgrade or downgrade any dependency; modify `pnpm-lock.yaml` (`7fa75d7c…` unchanged); modify `pnpm-workspace.yaml` (`19fe8f43…` unchanged); alter the Phase 33 overrides (`brace-expansion` 1.1.21/2.1.7, `undici` 6.28.1 — verified intact); suppress an advisory (no `ignore-vulnerabilities`, `auditConfig`, `neverAuditDependencies` or allowlist anywhere); alter the triage reachability policy (`e9d61a1a…` unchanged); modify the security floor policy (`6cbe8d4e…` unchanged); modify application source (no tracked change under `apps/` or `packages/`); or modify the Prisma schema or migrations (`a36fd3e7…` and `8cb99b35…` unchanged). Root `package.json` unchanged. — INDEPENDENTLY VERIFIED

**The 44 sub-threshold advisories remain counted, not adjudicated.** The live gate reports:

> *"44 of 92 advisories are below the critical/high threshold and are **not adjudicated by triage** … Recorded, not suppressed; remediating them needs dependency upgrades and is tracked as open work, not closed by this gate."*

I make **no claim that they are safe** and **no claim that they are remediated**. Visibility, reachability and remediation remain three distinct things.

---

## 16. Review-gap history

Note that review files are numbered by **review** phase, not subject phase: `SECURITY_REVIEW_PHASE_40.md` reviews Phase 39; `SECURITY_REVIEW_PHASE_42.md` reviews Phase 41; this file reviews Phase 43.

| Phase | Report | Independent review | Independence status |
|---|---|---|---|
| 22 | yes | **none** | NO REVIEW ARTIFACT |
| 23 | no | **none** | NO REVIEW ARTIFACT |
| 25 | yes | `…PHASE_25.md` | **not established** |
| 26 | yes | `…PHASE_26.md` | **not established** |
| 27 | yes | **none** | NO REVIEW ARTIFACT |
| 32 | yes | **none** | NO REVIEW ARTIFACT |
| 33 | yes | **none** | NO REVIEW ARTIFACT |
| 34 | no | `…PHASE_34.md` | **not established** |
| 35 | no | `…PHASE_35.md` | disclosed: did not implement |
| 36 | yes | `…PHASE_36.md` | disclosed: did not implement |
| 37 | yes | `…PHASE_37.md` | disclosed: did not implement |
| 38 | yes | **none** | NO REVIEW ARTIFACT |
| 39 | yes | `…PHASE_40.md` | disclosed: did not implement |
| 40 | n/a (review phase) | `…PHASE_40.md` | disclosed: did not implement |
| 41 | yes | `…PHASE_42.md` | disclosed: did not implement |
| 42 | n/a (review phase) | `…PHASE_42.md` | disclosed: did not implement |
| 43 | yes | **this document** | disclosed: did not implement |

**Observations.**

- Six phases (22, 23, 27, 32, 33, 38) have **no independent review artefact at all**. I do not claim to have closed those and they cannot be closed retroactively.
- For 25, 26 and 34 a review artefact exists but neither a non-implementation disclosure nor an organisational-independence claim could be established from it. Classified **REVIEW GAP (independence unestablished)** — not claimed sound, not claimed unsound.
- **The organisational-independence gap is a single, continuous, unbroken condition across the entire chain.** Every link discloses it; none closes it. **I do not close it, and it cannot be closed from inside this repository.**

---

## 17. Cleanup and integrity

| check | result |
|---|---|
| reviewer mirrors removed | ✅ no `/tmp/ecc-ph44-*`, `/tmp/ph44-mirror*`, `/tmp/ecc-p39-visibility-*` |
| temporary worktrees | ✅ primary only |
| throwaway containers | ✅ none; no container matching `ph44` |
| pre-existing containers unchanged | ✅ all six with **identical creation timestamps** to baseline |
| temporary databases | ✅ none; `run-db-suites.mjs` and the migration gate each destroyed their own |
| reviewer processes | ✅ none left |
| `pnpm-lock.yaml` | ✅ `7fa75d7c…` unchanged |
| `pnpm-workspace.yaml` | ✅ `19fe8f43…` unchanged |
| root `package.json` | ✅ `1f62d7c4…` unchanged |
| `.github/workflows/ci.yml` | ✅ `8fdff747…` unchanged |
| `scripts/verify-dependency-advisory-visibility.mjs` | ✅ `64524836…` unchanged |
| `scripts/mutate-dependency-advisory-visibility.mjs` | ✅ `04c0d839…` unchanged |
| `scripts/verify-ci-parity.mjs` | ✅ `a11bf953…` unchanged |
| `scripts/triage-vulnerabilities.mjs` | ✅ `e9d61a1a…` unchanged |
| `security/dependency-security-floor.json` | ✅ `6cbe8d4e…` unchanged |
| Prisma schema / migrations | ✅ `a36fd3e7…` / `8cb99b35…` unchanged |
| application source | ✅ no tracked change |
| developer DB | ✅ `ecc` 37 tables, databases `ecc`/`postgres`/`template0`/`template1` — untouched |
| commits / pushes / amends / rebases / resets / stashes | ✅ none |

`git status --porcelain` differs from baseline by exactly one new untracked entry: `?? SECURITY_REVIEW_PHASE_44.md`.

---

## 18. Findings

No **CRITICAL**, **HIGH** or **MEDIUM** finding. The central security property survives every attack I could mount.

### P44-01 — INFO — the argv allowlist is bypassable by PATH substitution; the population invariant is what actually holds

`scripts/verify-dependency-advisory-visibility.mjs` (`auditInvocationProblems`, `checkAuditedPopulation`).

A `pnpm` wrapper on `PATH` that injects `--dev` satisfies the canonical-argv check, which reports itself OK. The population invariant then rejects the reduced population. **No escape results.**

This is a **positive validation of the B+C design**, recorded because the allowlist's standalone security value is lower than its prominence in the code suggests, and because a future refactor that treated the allowlist as the primary control — or that removed the population check as redundant — would reintroduce P42-01 exactly. The harness's `M43-SRC-CANONICAL-OFF-POPULATION-CATCHES` already pins this dependency. No fix proposed or needed.

### P44-02 — INFO — a coherent report forgery defeats the advisory gate; contained by four lockfile-reading gates

A `pnpm` that emits a forged-but-coherent report (advisories + census agreeing, `totalDependencies` matching the lockfile) makes the advisory gate exit 0 while the real graph violates the floor. Reproduced end to end.

**Contained**: under the same forged toolchain, `verify-dependency-audit`, `verify-dependency-triage`, `verify-dependency-security-floor` and `verify-dependency-floor-policy` all exit 1, because they read `pnpm-lock.yaml` directly and never invoke `pnpm`. A vulnerable graph cannot produce a green dependency-gate job.

Phase 43's header states this boundary **accurately**, and P42-03's correction genuinely landed. No fix proposed.

### P44-03 — INFO — the accepted boundary is broader than the test that pins it

`M43-BOUNDARY-POPULATION-ASSERTED` pins only the `totalDependencies`-forgery variant. Two simpler forgeries — coercing records+census while leaving `totalDependencies` truthful, and renaming a floored package's `module_name` — are also accepted and are pinned by **no** mutant. The prose covers them; the tests do not.

Narrowing this boundary later would require editing a comment rather than deleting a test, which is the opposite of the harness mutant's own stated intent. **INFO**, not a control defect.

### P44-04 — INFO — the header attributes report forgery to an actor who can rewrite tracked files; PATH substitution needs none

The header says that actor "already holds the ability to rewrite this control, the lockfile and the floor policy". True, but PATH substitution achieves the same forgery while touching **no tracked file** — the same trust level by a different route. Worth stating so a reader does not infer that report forgery requires a repository edit. No enforcement impact.

### P44-05 — INFO — the mutation harness leaks a mirror on the `m.apply()` throw path

`scripts/mutate-dependency-advisory-visibility.mjs`: the `catch` around `m.apply(root)` does `continue` without `rmSync(root)`. The end-of-run sweep reclaims it, so nothing accumulates and nothing is left behind. **Pre-existing**, not introduced by Phase 43. Hygiene only.

### Not Phase-43 findings — recorded for completeness

- **Pre-existing parity `step.if` gap** — `suppressionProblem()` never inspects `step.if`; a required gate wrapped in `if: ${{ false }}` is not flagged. Present in `HEAD`, affects all gates equally, untouched by Phase 43.
- **4 untracked-target parity failures** — caused by the uncommitted Phase 37–43 chain; green on a committed mirror. **Not a Phase-43 defect.**
- **`pnpm lint` exit 1** — pre-existing, documented in the Phase-42 review, no application source touched by Phase 43.
- **P42-04** — a genuinely clean repository still cannot pass this gate. Deliberate fail-closed invariant, unchanged.
- **Hosted CI unverified; organisational independence unresolved** — status, not defects.

---

## 19. Final disposition

# APPROVED WITH FINDINGS

**Basis for the disposition.**

Phase 43's two scoped claims both survive independent testing. **P42-01 is closed**: I reproduced the escape on a real graph and confirmed the gate now rejects `--dev`, `--prod`, `--no-optional`, `-D` and `-P` — through `--audit-file` (how Phase 42 delivered it) and through the live path, with the population mismatch named and no false "proven UNFILTERED" claim. **P42-02 is closed**: nine new mutants including three source mutants whose polarity I re-derived from the harness source, and I confirmed the harness genuinely detects an escape by sabotaging a copy of its gate and watching it report 4.

I attacked the central question from eight directions rather than confirming the advertised cases, and that is where the review's value lies: **I bypassed the argv allowlist completely via PATH substitution, and the population invariant caught it.** That is empirical proof that Phase 43's two-layer design was necessary and correct — a single-layer fix would have failed. I also verified from pnpm's own distributed source *why* the invariant is sound (`totalDependencies` is incremented by the same traversal that builds the submitted advisory request, so it cannot diverge from what was sent), and proved it is not a numeric coincidence by changing the graph and watching both sides track.

F-40-01 and F-40-02 remain intact — the historical Phase-40 escape still reproduces against a reconstructed Phase-40 gate and is closed by the Phase-43 gate, and all 10 source mutants independently verify with correct polarity.

The residual boundary — a coherent report forgery — is real, is documented **accurately** (P42-03's correction genuinely landed), and is contained: four other dependency gates read the lockfile directly and fail independently, so a vulnerable graph cannot yield a green job. I am not treating it as a new finding because it is not one; the documentation already says it.

The five findings are all **INFO**: none weakens the control, and none requires a fix. Two are precision observations about documentation and test coverage that a future maintainer would benefit from.

**Why not "APPROVED FOR PHASE 43 CHECKPOINT":** P44-03 and P44-04 are real precision gaps in an otherwise correct implementation, and I prefer to record them than to round them away. Neither is material.

**Not claimed.** No production, staging or release readiness. No score or ranking. That the 44 sub-threshold advisories are safe or remediated. That hosted CI has validated any of this — **HOSTED CI UNVERIFIED** (§13).

**Organizational independence — stated separately and NOT satisfied.** I did not implement Phase 43, and I re-derived every material claim from primary sources. I am, however, an in-repository verification pass sharing the implementer's machine, toolchain, git identity and credentials, and I implemented nothing to fix. **This review cannot discharge an independent-review requirement for Phase 43, and the same unbroken gap applies to Phases 35–42.** It must be closed by a party outside this repository and session. Nothing in this document should be read as closing it.

**Scope note.** This review fixed nothing. P44-01 through P44-05 are documented, not remediated.