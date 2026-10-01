# PHASE_43_FINAL_REPORT.md — Phase 43: Remediating P42-01 / P42-02

**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline:** `199877aef283eff36984114ecf486eaec1554c39` — `HEAD` == `origin/main` == `main`
**Reviewed input:** `SECURITY_REVIEW_PHASE_42.md` (disposition: **REMEDIATION REQUIRED**)
**Remediating:** P42-01 (dependency-scope filter bypass), P42-02 (missing mutation coverage), P42-03 (documentation understatement, adjacent), P42-05 (stale `42` → `44` in touched comments)
**Date:** 2026-10-01
**Nature:** Implementation/remediation phase. This is **not** an independent review, and it does not perform one.

> **NOT APPROVED.** This document reports an implementation and its measurements. It assigns no readiness status of any kind. Organizational independence and hosted-CI verification are **unresolved** (§16, §17).

---

## 1. Baseline

| Item | Value |
|---|---|
| `HEAD` | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` (identical) |
| Branch | `main` |
| Node / pnpm / git | v24.18.0 / 11.25.0 / 2.53.0 |
| Pre-existing tracked modifications | `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`, `scripts/verify-dependency-security-floor.mjs`, `scripts/mutate-dependency-security-floor.mjs` (Phase 36–39 work, untouched by Phase 43 except the ci.yml comment in §11) |
| Working-tree state | Uncommitted Phase 37–42 chain, as inherited |
| Containers at baseline | `pg-pgtest`, `ecc-minio-bootstrap`, `ecc-postgres`, `ecc-redis`, `ecc-minio`, `unruffled_aryabhata` |
| Developer DB | `ecc-postgres`, 37 tables in `public`, databases `ecc`/`postgres`/`template0`/`template1` |

**Protected-artefact checksums at baseline** (all re-verified in §14):

```
7fa75d7c2388114a96b45b3616bc01d4f005a469367d473ed2b2b34cb018b0a8  pnpm-lock.yaml
19fe8f43efb128f81b0cc192bf0c580521d093a944eb843a8add4c69a609a16c  pnpm-workspace.yaml
1f62d7c4e73088e642575cfa12dbd60e4ba3a031eba00cd53a5ae05134450698  package.json
860bd055fad2201d3ac7295e2ccb0ec95d6bb729c25a32606123fe62490bf5fb  .github/workflows/ci.yml
677b7bd0aef8dbe201fc18629ab2a17a1d48c5ae4ed4d9eb0eb19f790132c0b9  scripts/verify-dependency-advisory-visibility.mjs
b353fd2d178432bafd7d1e27c0491c824c1ed729382b7b40659a90380cc31d04  scripts/mutate-dependency-advisory-visibility.mjs
a11bf953dc833b0ee26279d845c839d24dee1904e970fef89faf3f684e21c198  scripts/verify-ci-parity.mjs
a36fd3e7803a7adbbdd6ac77c0f2a51053899b98ee751d447664ea6ce1d1c9be  apps/api/prisma/schema.prisma
8cb99b3568b046a0bea11a69dfcd24726cf7bcdb443bc8eebf1e74239fb009d4  (aggregate of apps/api/prisma/migrations/**)
```

A cleanup script was authored before any temporary resource was created.

---

## 2. P42-01 reproduction BEFORE remediation

P42-01 was reproduced independently rather than taken on trust.

**Mirror.** `/tmp/opencode/ph43/mirror-undici` — a full copy of the tree outside the repository, with the Phase 33 `undici` remediation reverted **in the mirror only**:

```
'undici@<6.28.1': 6.28.0      # was 6.28.1
```

`pnpm install --lockfile-only` in the mirror resolved `undici@6.28.0`. The real `pnpm-lock.yaml` and `pnpm-workspace.yaml` were never written (verified in §14).

**Genuine audit of the reproduced graph** — the floor is violated:

```
full   recs 95  census 95  totalDeps 1494  undici: 1239934, 1240039, 1240042
--dev  recs 22  census 22  totalDeps 1022  undici: NONE
--prod recs 80  census 80  totalDeps 1111  undici: 1239934, 1240039, 1240042
```

`undici` is a prod-only subtree, so `--dev` excludes it entirely while remaining **internally consistent**: 22 records against a census of 22.

**Escape confirmed against the unmodified gate, both delivery paths:**

| path | result |
|---|---|
| gate `--audit-file <--dev report>` | **exit 0**, 8/8 checks OK, printed *"proven UNFILTERED"* |
| gate **LIVE** with `--dev` added to `AUDIT_ARGV` | **exit 0**, 9/9 checks OK, argv self-check reported itself satisfied |

Meanwhile the same graph under `--prod` correctly failed on the floor assertion. This is exactly the P42-01 finding, reproduced end to end on a real graph.

---

## 3. Root cause

`metadata.vulnerabilities` is the registry's account of **the package population pnpm was submitted**. It is not a census of the repository, and it is not independent of how pnpm was invoked.

A severity threshold (`--audit-level`) removes advisory **records** and leaves the census intact, so the Phase 41 census reconciliation detects it. A **scope** filter (`--dev`, `--prod`, `--no-optional`) removes advisory **packages**, so the census shrinks in the same proportion and the report stays internally consistent. Nothing is forged, so no check reading only the report can refute it.

Two independent causes had to be fixed:

1. **Invocation side** — `SEVERITY_FILTER_FLAGS` was a *denylist* of flags known to truncate records. It contained no scope flag, and could not have contained a correct one forever.
2. **Report side** — the census reconciliation proves the report is complete *relative to the submission* and says nothing about the submission itself.

### 3.1 Measured pnpm audit flag surface (pnpm 11.25.0, this repository)

Every candidate was executed against the real binary. `pnpm audit --fix` was **deliberately never run** — it mutates manifests.

| invocation | records | census | `metadata.totalDependencies` | reduces population? |
|---|---|---|---|---|
| *(none)* | 92 | 92 | **1494** | baseline (= lockfile) |
| `--audit-level=high` | 48 | 92 | 1494 | no — severity only |
| `--audit-level=moderate` | 84 | 92 | 1494 | no |
| `--audit-level=critical` | 4 | 92 | 1494 | no |
| **`--dev` / `-D`** | **22** | 22 | **1022** | **YES** |
| **`--prod` / `-P`** | **77** | 77 | **1111** | **YES** |
| **`--no-optional`** | 92 | 92 | **1379** | **YES** |
| `--optional` | 92 | 92 | 1494 | no — no-op, byte-identical to full |
| `--lockfile-only` | 92 | 92 | 1494 | no — byte-identical to full |
| `--recursive` | 92 | 92 | 1494 | no — byte-identical to full |
| `--workspace-root` | 92 | 92 | 1494 | no — byte-identical to full |
| `--filter @ecc/api` | 92 | 92 | 1494 | no |
| `--ignore-registry-errors` | 92 | 92 | 1494 | no (exit code only) |
| `--ignore <GHSA>` | — | — | — | emits non-JSON preamble → gate fails closed |
| `--ignore-unfixable` | — | — | — | emits non-JSON preamble → gate fails closed |
| `--severity` | — | — | — | **unknown option in pnpm 11** |
| `--fix` | **NOT TESTED** | | | mutates manifests — out of bounds |

Two findings shaped the design:

- **`-D` and `-P` are accepted short forms.** A denylist listing only the long spellings would have missed them.
- **`--severity` is not a valid pnpm 11 flag at all**, yet Phase 41 defended against it. The list guarding the previous version of this control already contained a partly fictional entry — direct evidence that a hand-maintained denylist drifts.

---

## 4. Remediation design

The brief offered three options. **The chosen design is B + C**, because they fail in orthogonal ways and each covers the other's blind spot.

### 4.1 (B) Canonical-invocation allowlist — the invocation side

`AUDIT_ARGV` must be **exactly** `['audit', '--json']`. Any deviation is a failure: an extra token, a reordered argument, or an unknown future flag.

An **allowlist**, not a denylist, deliberately. It does not depend on having enumerated pnpm's flags correctly — which §3.1 shows is a real hazard. An unrecognised flag fails closed precisely because the list cannot be trusted to be complete.

`auditInvocationProblems()` validates the **runtime value** of `AUDIT_ARGV` — the array actually handed to `spawnSync` — not the source text. So argv assembled by `.concat()`, spread, or a helper function is judged on what it produces, not how it was spelled. `DEPENDENCY_SCOPE_FLAGS` is retained **for diagnostics only** so the failure names the responsible flag; it is explicitly documented as *not* the security boundary.

### 4.2 (C) Lockfile population invariant — the report side

`metadata.totalDependencies` is compared against the number of packages `pnpm-lock.yaml` resolves:

```
pnpm-lock.yaml `packages:` entries = 1494   ==   unfiltered metadata.totalDependencies
```

A scope-reducing flag submits fewer packages, and this mismatch is **direct evidence** that the whole graph was not audited — evidence the census cannot supply, because the census is reduced proportionally.

It runs on the **report**, so it holds for a live audit **and** for anything handed in through `--audit-file`. Phase 42 delivered the bypass through `--audit-file`; this is what stops it.

`packages:` is used rather than `snapshots:` deliberately: `snapshots` is 1496 on this repository (peer-resolution variants), so using it would fail a completely unfiltered audit.

### 4.3 Why this covers the complete scope-filter class

| property | coverage |
|---|---|
| Known scope flags (`--dev`, `--prod`, `--optional`, `--no-optional`) | rejected by the allowlist **and** by the population mismatch |
| Short forms (`-D`, `-P`) | rejected by both |
| Any **unknown** future scope flag | rejected by the **allowlist**, and by the population mismatch even if it hides from argv (e.g. via config) |
| Coherent forged report (`totalDependencies` corrected) | **accepted** — this is the residual boundary, pinned by a test (§8) |

The population check is what makes the design robust rather than a blacklist: it measures a quantity the advisory report must agree with, so it holds even for a reduction mechanism that never appears in `argv`.

### 4.4 Fail-closed

Every uncertainty is a failure: missing/non-integer/negative `totalDependencies`, unreadable lockfile, unparseable lockfile, and a `yaml` parser that cannot be loaded. "Cannot be proven" never reads as "proven".

**Known limitation, accepted deliberately.** The invariant ties the gate to pnpm's `totalDependencies` semantics. If a future pnpm changes that accounting, a fully legitimate audit would fail. That is the **safe** direction — a loud failure a human investigates, rather than a silent pass — and it is documented in the gate source.

---

## 5. Exact files changed

| file | change |
|---|---|
| `scripts/verify-dependency-advisory-visibility.mjs` | The remediation. Added `CANONICAL_AUDIT_ARGV`, `DEPENDENCY_SCOPE_FLAGS`, `loadYaml()`, `countLockfilePackages()`, `checkAuditedPopulation()`, `auditInvocationProblems()`; wired the canonical check into `loadAudit()`; wired the population check after census reconciliation; rewrote the header, banner, PASS and FAILED text. **977 lines** (was 587). |
| `scripts/mutate-dependency-advisory-visibility.mjs` | P42-02. Added `captureScopeFilteredAudit()`, `LOCKFILE_PACKAGE_COUNT`, `SCOPE_REPORTS`; added 9 mutants; extended two existing mutants; updated header/logging/summary. **1448 lines** (was 1055). |
| `.github/workflows/ci.yml` | **Comment block + step label only.** No command, no structure change (§11). **759 lines** (was 736). |
| `docs/PHASE_43_FINAL_REPORT.md` | This report. **Created.** |

**Not changed:** `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `scripts/verify-ci-parity.mjs`, `scripts/triage-vulnerabilities.mjs`, `scripts/verify-dependency-security-floor.mjs`, `scripts/mutate-dependency-security-floor.mjs`, `security/dependency-security-floor.json`, all application source, all Prisma schema/migrations. Verified in §14.

---

## 6. Exact argv / filter cases covered

Verified by mutating `AUDIT_ARGV` in a mirror and running the gate **LIVE** against the vulnerable graph. All 16 forms plus a control: **17 passed, 0 failed.** Each was asserted to be a non-no-op, to parse, not to crash, to exit 1, and to name the scope/population problem.

| # | case | argv form | result |
|---|---|---|---|
| L1 | `--dev` | separate token | exit 1 |
| L2 | `--prod` | separate token | exit 1 |
| L3 | `--no-optional` | separate token | exit 1 |
| L4 | `-D` | **short form** | exit 1 |
| L5 | `-P` | **short form** | exit 1 |
| L6 | `--optional` | separate token | exit 1 |
| L7 | `--audit-level=high` | **`--flag=value`** | exit 1 — F-40-01 intact |
| L8 | `--audit-level`, `high` | **space-separated** | exit 1 — F-40-01 intact |
| L9 | filter before `--json` | **reordered** | exit 1 |
| L10 | `--dev` **and** `--no-optional` | **multiple filters** | exit 1 |
| L11 | `.concat(['--dev'])` | **concat** | exit 1 |
| L12 | `[...EXTRA]` | **spread** | exit 1 |
| L13 | `withScope('--prod')` | **helper function** | exit 1 |
| L14 | `--scope=future-thing` | **unknown future flag** | exit 1 — allowlist fails closed |
| L15 | `['audit']` (`--json` dropped) | canonical-form violation | exit 1 |
| L16 | `--filter`, `@ecc/api` | flag **with a value** | exit 1 |
| — | **CONTROL** | unmutated fixed gate, vulnerable graph | exit 1 **on the floor assertion** |

**Report-side cases** (via `--audit-file`, how Phase 42 delivered the bypass) — 23 independent acceptance assertions, **23 passed, 0 failed** (§9).

---

## 7. P42-01 vulnerable-`undici` reproduction AFTER remediation

Same mirror, same reverted `undici@6.28.0` graph, same genuine reports.

| input | pre-fix | post-fix |
|---|---|---|
| `--dev` report via `--audit-file` | **exit 0**, "proven UNFILTERED" | **exit 1**, `the audited population is the complete resolved graph, not a dependency-scope subset (Phase 43 P42-01)` |
| `--prod` report via `--audit-file` | exit 1 (floor assertion) | exit 1 (population check) |
| `--no-optional` report via `--audit-file` | exit 0 | **exit 1** (population check) |
| `-D` report via `--audit-file` | exit 0 | **exit 1** (population check) |
| `-P` report via `--audit-file` | exit 1 | exit 1 |
| LIVE with `--dev` in `AUDIT_ARGV` | **exit 0**, argv self-check satisfied | **exit 1**, both checks fire |
| full report from the same vulnerable graph | exit 1 (floor assertion) | exit 1 (floor assertion) — unchanged |

Failure message, verbatim:

```
pnpm audited 1022 dependencies but pnpm-lock.yaml resolves 1494, so FEWER packages than
the graph contains were submitted to the registry (472 missing). A dependency-SCOPE filter
-- `--dev`, `--prod`, `--optional`, `--no-optional` and their short forms -- reduces the
submitted population, and it reduces the severity census by exactly the same proportion, so
the census alone cannot refute it. This report does NOT describe the complete advisory set
for this repository, and the floors declared in security/dependency-security-floor.json
cannot be proven to hold against packages that were never audited.
```

The gate **no longer prints** "proven UNFILTERED" or "no filter was applied to this report" in any rejected state — verified by grep over the rejected output (0 occurrences). The unqualified completeness claim now appears only in the PASS text, and only after both witnesses hold.

---

## 8. P42-02 mutation-harness changes

Nine mutants added; two existing mutants extended. Harness total: **22 → 30**.

### 8.1 Report-side mutants (5)

| ID | input | expected | outcome |
|---|---|---|---|
| `M43-SCOPE-DEV` | genuine `--dev` report (22 recs, census 22, 1022/1494 deps) | reject | **DETECTED** |
| `M43-SCOPE-PROD` | genuine `--prod` report (80 recs, census 80, 1111/1494) | reject | **DETECTED** |
| `M43-SCOPE-NO-OPTIONAL` | genuine `--no-optional` report (92 recs, census 92, 1379/1494) | reject | **DETECTED** |
| `M43-SCOPE-METADATA-MISSING` | complete report with `totalDependencies` deleted | reject | **DETECTED** |
| `M43-BOUNDARY-POPULATION-ASSERTED` | genuine `--dev` report with `totalDependencies` corrected to 1494 | **accept** | **TOLERATED** — pins the accepted boundary (§15) |

All scope fixtures are **captured from the real package manager**, not hand-written, because the defining property of the bypass is internal coherence — exactly what a hand-written fake would get wrong. `captureScopeFilteredAudit()` and the harness refuse to proceed if `--dev`/`--prod` did not actually reduce the population, so these mutants cannot silently degenerate.

### 8.2 Source mutants (3) — and the polarity problem the brief anticipated

| ID | mutation | polarity | why | outcome |
|---|---|---|---|---|
| `M43-SRC-POPULATION-OFF` | stub the population check; feed the identical genuine `--dev` report | **`weaken`** (exit 0 is the proof) | paired with `M43-SCOPE-DEV`, so the identical input is rejected by the real control | **WEAKENED** |
| `M43-SRC-CANONICAL-OFF-POPULATION-CATCHES` | silence the canonical check **and** add `--dev` to `AUDIT_ARGV`; LIVE | **default / must REJECT** | silencing the argv check must **not** let a scoped audit through — the population check is an independent witness | **DETECTED** (exit 1, population check) |
| `M43-SRC-BOTH-SCOPE-GUARDS-OFF` | disable **both** guards **and** add `--dev`; LIVE | **`weaken`** | single-guard removal is INEFFECTIVE (proved by the row above), so proving the canonical check is load-bearing needs both | **WEAKENED** |

`M43-SRC-BOTH-SCOPE-GUARDS-OFF` reproduces the exact state Phase 42 demonstrated passes silently, and shows that removing the remediation restores it. This is the F-40-02 methodology applied to the new code.

### 8.3 Two existing mutants extended, with the reasons recorded in-source

Both were extended because **the gate became stricter than their fixtures assumed**, which the harness reported honestly rather than reclassifying:

- **`M41-SRC-CENSUS-ABSENT-OK`** was INEFFECTIVE: a report with `metadata` deleted also lacks `totalDependencies`, so the new check failed closed. The mutant now disables all three completeness guards. This is defence in depth being demonstrated, not a gate defect.
- **`M41-SRC-EMPTY-TOLERATED`** was INEFFECTIVE: the empty fixture dropped `totalDependencies`. Both it and its pair **`M-EMPTY`** now carry `totalDependencies` = the lockfile count, making the document internally coherent and **byte-identical between the pair**, so the two mutants differ *only* in the gate source.

### 8.4 One reviewer-side defect, disclosed and corrected

`M43-PASS-OPTIONAL-FLAG-REPORT` was initially written as a positive control fed the genuine `--optional` report. The harness **correctly discarded it as a setup failure**: `--optional`, `--lockfile-only`, `--recursive` and `--workspace-root` all produce a report **byte-identical** to the full audit on this repository, so the mutant changed no file and would have proved nothing. It was replaced by `M43-BOUNDARY-POPULATION-ASSERTED`, which tests something real.

### 8.5 Mutation results

```
TALLY  30 mutant(s) applied, of which 10 mutate the gate's OWN SOURCE:
         20 detected (the real control rejected the state)   [adversarial-state mutants]
          7 weakened  (the source mutation was proven consequential)  [source mutants]
          3 correctly tolerated (legitimate positive controls)
       failures: 0 genuine escapes, 0 detected for the wrong reason,
                 0 ineffective source mutations, 0 discarded as setup failures.

RESULT  PASS
```

| metric | value |
|---|---|
| Total applied | **30** |
| Source mutants | **10** (7 pre-existing + 3 new) |
| Report-side mutants | **20** |
| Detected | **20** |
| Weakened | **7** |
| Tolerated | **3** |
| Genuine escapes | **0** |
| Ineffective source mutations | **0** |
| Detected for the wrong reason | **0** |
| Setup failures discarded | **0** |
| Mirrors created / removed | 31 / 31 |
| Protected files byte-identical afterwards | 5 / 5 |

### 8.6 Positive and negative controls

**Negative controls (must be rejected):** `M43-SCOPE-DEV`, `M43-SCOPE-PROD`, `M43-SCOPE-NO-OPTIONAL`, `M43-SCOPE-METADATA-MISSING`, plus all pre-existing `M-*`/`M41-*` adversarial mutants.

**Positive controls (must NOT be flagged):**
- `M-PASS` — moderate advisory against non-floored `next`.
- `M41-SRC-SEVCONST` — narrowing the narrative threshold; proves it does not weaken the assertion.
- `M43-BOUNDARY-POPULATION-ASSERTED` — the accepted boundary (§15), labelled as a boundary probe rather than mislabelled a positive control.
- The campaign-level **CONTROL** — the unmutated mirror fed the real advisory set must pass, or every mutant result is meaningless.

---

## 9. Acceptance criteria

An independent script (outside the repository, separate from the shipped harness) re-derived every criterion. **23 passed, 0 failed.**

| category | cases | outcome |
|---|---|---|
| Legitimate states accepted | genuine full audit; full + advisory against non-floored package | **accept** |
| F-40-01 severity filter intact | genuine `--audit-level=high`; genuine `--audit-level=moderate`; a critical-only report | **reject** |
| P42-01 scope bypass closed | genuine `--dev`; genuine `--prod`; a `--no-optional`-shaped report; `--dev` with the field renamed | **reject** |
| Fail-closed on absent/malformed | empty report; no `metadata`; no `totalDependencies`; string; float; negative; `null`; inflated; no `advisories`; no census; unknown severity | **reject** |
| Floor assertion intact | moderate advisory against floored `brace-expansion`; **low** advisory against floored `undici` | **reject** |
| Accepted boundary | `--dev` report with `totalDependencies` corrected | **accept** |

**No crash was counted as a detection** anywhere; the classifier treats a non-zero exit with no `[FAIL]` verdict line as a CRASH, distinct from rejection.

---

## 10. Regression results

| # | Gate | Exit | Result |
|---|---|---|---|
| 1 | `verify-dependency-audit.mjs` | 0 | PASS |
| 2 | `verify-dependency-triage.mjs` | 0 | PASS |
| 3 | `verify-dependency-security-floor.mjs` | 0 | PASS |
| 4 | `verify-dependency-floor-policy.mjs` | 0 | PASS |
| 5 | `verify-dependency-advisory-visibility.mjs` (LIVE) | 0 | **PASS — 11 checks, 11 passed, 0 failed** (was 9) |
| 6 | `mutate-dependency-advisory-visibility.mjs` | 0 | **PASS — see §8.5** |
| 7 | `mutate-dependency-security-floor.mjs` | 0 | PASS |
| 8 | `mutate-dependency-floor-policy.mjs` | 0 | PASS |
| 9 | `mutate-config-contract.mjs` | 0 | PASS |
| 10 | `mutate-ci-integration.mjs` | 0 | PASS — every Phase 28 CI gate still enforced |
| 11 | `verify-ci-parity.mjs --list` | **1** | **4 problems — all pre-existing untracked-target failures**, unchanged in count and cause from the Phase 42 baseline (2 Phase 37, 2 Phase 39/41). Green on a fully-committed mirror of the identical tree. |
| 12 | `pnpm typecheck` | 0 | 11/11 tasks |
| 13 | `pnpm build` | 0 | 7/7 tasks |
| 14a | `pnpm --filter @ecc/web test` | 0 | 1 file / 1 test passed |
| 14b | `pnpm --filter @ecc/mobile test` | 0 | 6 files / 34 tests passed |
| 15 | `node scripts/run-db-suites.mjs` | 0 | e2e **8 files / 138 tests**; unit+integration **27 files / 348 tests** |
| 16 | `node scripts/verify-release-artifact.mjs` | 0 | PASS — 13 PASS assertions, 0 FAIL; 280 API files byte-identical across two clean builds; 2969 web files checked |
| — | `bash scripts/verify-db-migrations.sh` | 0 | PASS — valid, reproducible, idempotent, sufficient |
| — | `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` | 0 | PASS — N-12 protections load-bearing |
| — | `pnpm --filter @ecc/api verify:storage:backup` | 0 | PASS |
| — | `pnpm lint` | **1** | **FAILING — reported as failing, not green.** 8/11 tasks; `@ecc/mobile` 18 problems (0 errors, 18 warnings) blocked by `--max-warnings 0`. **Pre-existing and identical to the Phase 42 baseline; Phase 43 touched no application source and did not fix it.** |

---

## 11. CI integration and parity

**The CI command is unchanged**, so no parity registration change was required — the invariant is enforced inside the gate, as the brief prefers.

```yaml
run: node scripts/verify-dependency-advisory-visibility.mjs     # identical to before
```

`scripts/verify-ci-parity.mjs` was **not modified** (checksum `a11bf953…` unchanged). Both Phase 41/43 gates remain registered with matching `exactCommand` and correct targets.

`.github/workflows/ci.yml` was touched for **one reason only**: the existing Phase 41 comment repeated the P42-03 overstatement — describing the census as something `--audit-level` "does NOT touch", implying it covers the repository. A comment on the same gate step, corrected to state that the census evidences the *submitted* population and that the invariant lives in the gate.

**Proven comment-only**, not asserted: programmatically reversing the Phase 43 edit and re-hashing yields exactly the baseline digest `860bd055fad2201d3ac7295e2ccb0ec95d6bb729c25a32606123fe62490bf5fb`. The only other change is the step label, which now also reads `Phase 43 P42-01`.

Structural verification after the edit: `api` job still 29 steps, `release` job still 24, same five jobs, gate step still has no `if:` and no `continue-on-error:`, harness step still present. `mutate-ci-integration.mjs` passes.

---

## 12. Documentation corrections (P42-03, P42-05)

**P42-03 — the understated boundary, corrected in the gate header.** The Phase 41 text implied that refuting a coherent forged report required also rewriting the control, the lockfile or the floor policy. The header now states accurately that rewriting **only `metadata`** suffices; that Phase 43 narrows this (a forged `totalDependencies` must also equal the lockfile count); and that what remains is a coherent forgery of the whole report which cannot be refuted from within the report alone.

**The census is no longer described as a census of "the repository" or "the FULL population."** It is described as the registry's account of the package population pnpm **submitted**, with the `--dev`/`--prod`/`totalDependencies` measurements quoted inline as the evidence for why that distinction matters.

**Claims are now conditional on the tests.** The banner states completeness is established two ways and that "neither alone is sufficient". The PASS text says "both had to hold". The census success message was changed from *"No severity tier is missing, so no filter was applied to this report"* — which was false under a scope filter — to *"No SEVERITY tier is missing… That is a statement about the tiers only"*, pointing at the population check. The PASS text also states the sub-threshold advisories are *"counted, not adjudicated, and not thereby declared safe."*

**P42-05 — stale `42` → `44`.** Both occurrences in the gate header (`lines 52, 64`) now read 44, matching the measured 36 moderate + 8 low.

---

## 13. Docker status

`node scripts/verify-docker-images.mjs --skip-build` was run and **passed** (58 PASS assertions, 0 FAIL): unknown routes 404, the image-optimization endpoint returns 404 with the shipped manifest recording the optimizer disabled, clean SIGTERM shutdown with both containers draining.

**No image rebuild was performed.** `mutate-container-gate.mjs` was **NOT TESTED** and is not claimed as passing; no result depends on it.

---

## 14. Clean and integrity checks

| check | result |
|---|---|
| `pnpm-lock.yaml` | **UNCHANGED** — `7fa75d7c…` ✅ |
| `pnpm-workspace.yaml` | **UNCHANGED** — `19fe8f43…` ✅ |
| root `package.json` | **UNCHANGED** — `1f62d7c4…` ✅ |
| `scripts/verify-ci-parity.mjs` | **UNCHANGED** — `a11bf953…` ✅ |
| `apps/api/prisma/schema.prisma` | **UNCHANGED** — `a36fd3e7…` ✅ |
| `apps/api/prisma/migrations/**` | **UNCHANGED** — `8cb99b35…` ✅ |
| application source (`apps/`, `packages/`) | **UNCHANGED** — no tracked modifications ✅ |
| `.github/workflows/ci.yml` | changed **only** by the Phase 43 comment + step label, proven by hash reversal ✅ |
| gate + harness | changed (the remediation targets) ✅ |
| mirrors | **removed** — no `/tmp/ecc-ph43-*` remains ✅ |
| worktrees | only the primary ✅ |
| throwaway containers | none remain; all six pre-existing containers have **identical creation timestamps** to baseline ✅ |
| developer DB | untouched — `run-db-suites.mjs` and the migration gate each used and destroyed their own throwaway PostgreSQL; `ecc` fingerprints unchanged ✅ |
| unexpected processes | none ✅ |
| commits / pushes / amends / rebases / resets / stashes | **none** ✅ |

`git status --short` differs from the Phase 43 baseline by exactly the three intended modified files plus this report.

---

## 15. Remaining limitations

1. **Accepted boundary — a coherent report forgery is still accepted.** A scope-reduced report whose `totalDependencies` is corrected to the lockfile count passes. This is pinned by `M43-BOUNDARY-POPULATION-ASSERTED` so that narrowing it requires deleting a test. Refuting it would need a witness outside the report and the lockfile — for example an independently captured advisory set — which is a larger architectural change than this phase's brief authorises.
2. **The population invariant depends on pnpm's `totalDependencies` semantics** (equal to the lockfile `packages:` count on this repository). A future pnpm that changes that accounting would fail a legitimate audit. This fails **loudly and closed**, which is the safe direction, and is documented in the gate.
3. **The lockfile is parsed with the `yaml` package resolved from the pnpm store**, mirroring `verify-ci-parity.mjs`. If no `yaml` can be loaded the gate fails closed rather than skipping.
4. **The 44 sub-threshold advisories (36 moderate, 8 low) remain open.** They are counted and reported. They are **not** declared safe and **not** remediated. Remediation needs dependency upgrades including `next` 14.2.35 → 15.5.x, which this phase is not authorised to make.
5. **The gate cannot pass on a genuinely clean repository** — the Phase 42 `P42-04` limitation, unchanged and deliberately accepted.
6. **Pre-existing, untouched, and explicitly out of scope:** the parity `step.if` gap; `pnpm lint` debt; the 4 untracked-target parity failures caused by the uncommitted Phase 37–42 chain; historical review gaps.
7. **The gate now depends on `pnpm-lock.yaml` being readable**, which it already required to exist. A new hard dependency on parsing it is introduced.

---

## 16. Hosted CI status

**HOSTED CI REMAINS UNVERIFIED.**

No Phase 43 code has been committed, so nothing has executed on a GitHub runner. Phase 42 established that the last run (`36714434566`, head `199877aef283…`) contains **none** of the Phase 37–41 artefacts and therefore says nothing about any of them. The same is trivially true of Phase 43.

Every result in this document is a **local** result. `verify-ci-parity.mjs` itself states: *"GitHub Actions has NOT been executed against this workflow; no remote result is claimed."* The gate has never run on a hosted runner.

---

## 17. Organizational independence

**UNRESOLVED, and not resolvable from inside this repository.**

Phase 43 is an **implementation** phase performed by the same party that would be subject to review, on the same machine, with the same toolchain, git identity and credentials. It therefore has **no** independence from its own subject matter and **cannot** discharge an independent-review requirement.

This is the same unbroken condition that Phase 42 (§0) recorded for Phases 37, 39, 40 and 41, and that `SECURITY_REVIEW_PHASE_42.md` states must be closed by a party outside this repository and session. **Phase 43 does not close it and does not pretend to.**

---

## 18. Final status

# REMEDIATION IMPLEMENTED — AWAITING INDEPENDENT REVIEW

**What is established by this phase's own measurements:**

- P42-01 was reproduced before remediation (exit 0, "proven UNFILTERED", `undici` invisible) and is rejected after remediation — via `--audit-file` and via the live path, for `--dev`, `--prod`, `--no-optional`, `-D`, `-P`, and for reordered, duplicated, `=`-form, space-form, concat, spread, helper-assembled and unknown-flag variants. 16 live forms plus a control: **17/17**.
- P42-02 is closed: 9 new mutants including 3 source mutants whose polarity was derived from the implementation and documented; harness **30 applied / 10 source / 20 detected / 7 weakened / 3 tolerated / 0 escapes / 0 ineffective / 0 setup failures**.
- F-40-01 and F-40-02 protections are **intact** — the Phase 41 severity checks were retained, and all 22 pre-existing mutants plus the 23 independent acceptance assertions confirm it.
- Legitimate full audits still pass; empty and malformed reports still fail closed.
- No dependency, lockfile, workspace, Prisma or application-source change.

**Why not "complete":** this is an implementation. It carries no independent verification, no hosted-CI execution, and no organizational independence. The accepted boundary in §15.1 remains open by design and is now test-pinned rather than merely documented.

**Phase 43 is not approved, and nothing in this document should be read as approving it.**