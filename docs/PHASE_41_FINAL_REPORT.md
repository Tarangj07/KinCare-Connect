# PHASE 41 — FINAL REPORT

**Subject:** Phase 41 — advisory-visibility hardening (F-40-01, F-40-02) and CI integration
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline:** `199877aef283eff36984114ecf486eaec1554c39` — `HEAD` == `origin/main`
**Date:** 2026-10-01
**Nature:** Implementation only. No security review was performed and none is written here.

> **NO PRODUCTION-READINESS, STAGING-READINESS OR RELEASE-READINESS CLAIM IS MADE IN THIS DOCUMENT.** No compliance certification, security score or rating is claimed or implied. `SECURITY_REVIEW_PHASE_41.md` was **not** created; a separate reviewer must produce it.

---

## 1. Objective

Close the two MEDIUM findings from the Phase 40 independent review:

- **F-40-01** — `verify-dependency-advisory-visibility.mjs` would pass a severity-filtered advisory report while printing *"PASSED — the full advisory set was observed"*, because it treated a **non-empty** report as a **complete** one.
- **F-40-02** — `mutate-dependency-advisory-visibility.mjs` mutated only fixtures, the policy and the workflow. **No mutant ever wrote the gate's own source**, so every line that decides the property under test was untested, and the gate's docstring made a coverage claim that was demonstrably false.

Phase 41 also integrates the hardened gate into CI and the parity contract, and re-establishes the local and clean-checkout regression baseline.

**Explicitly out of scope and not done:** changing the triage policy for critical/high reachability; upgrading or downgrading any dependency; modifying `pnpm-lock.yaml`; adjudicating the advisories outside any floor; any application-feature work.

---

## 2. Exact pre-flight state

| Item | Observed |
|---|---|
| Branch / HEAD / `origin/main` | `main` / `199877aef283eff36984114ecf486eaec1554c39` / identical |
| Newest commit | `199877a phase(36): record the final report` |
| Modified | `.github/workflows/ci.yml`, `scripts/mutate-dependency-security-floor.mjs`, `scripts/verify-ci-parity.mjs`, `scripts/verify-dependency-security-floor.mjs` |
| Untracked | 11 `SECURITY_REVIEW_*.md`, 12 `docs/PHASE_*`, the Phase 37 + Phase 39 scripts, `security/` |
| Stash | empty |
| Node / pnpm / git | v24.18.0 / 11.25.0 / 2.53.0 |
| Worktrees | primary only |
| Developer DB | 37 tables, hash `461d1a250b11449a2d9ebb153128528c`, 2 migrations, latest `2026-09-14 20:26:22.709031+00` |
| Containers | `pg-pgtest`, `ecc-postgres`, `ecc-redis`, `ecc-minio` |
| Advisory census | `pnpm audit --json` → 92 records (4 critical / 44 high / 36 moderate / 8 low) |

Checksums captured before any change: 70 control/config/report files and 212 application-source + Prisma files.

---

## 3. F-40-01 reproduction (before remediation)

Measured directly, not taken from any report.

**The two independent severity filters, located in source:**
- `scripts/triage-vulnerabilities.mjs:831` — `spawnSync('pnpm', ['audit', '--audit-level=high', '--json'], …)`
- `scripts/triage-vulnerabilities.mjs:846` — `.filter((a) => a.severity === 'critical' || a.severity === 'high')`

**The defect.** The unmodified control accepts a genuinely partial report:

| Report supplied to the unmodified gate | Records | Gate exit | What it printed |
|---|---|---|---|
| genuine `pnpm audit --json` | 92 | **0** | correct pass |
| genuine `pnpm audit --audit-level=high --json` | 48 | 0 | accepted |
| genuine `pnpm audit --audit-level=moderate --json` | **84** | **0** | *"PASSED — the full advisory set was observed"* |

**F-40-01 reproduced.** A report missing 8 of 92 advisories passed while the gate asserted it had observed all of them.

---

## 4. Root cause

**A conflation of *non-empty* with *complete*.** The gate's only completeness signal was `entries.length === 0` — a **total**-filter check. A **partial** filter leaves the report non-empty, so it falls outside the check entirely. The gate therefore had no way to distinguish "the registry reports nothing" from "the tool removed the bottom tier".

Every Phase 39 claim about full-set visibility rested on an unheld assumption: that the invocation carried no `--audit-level`. That assumption was enforced only by the absence of a flag on one `spawnSync` call — and it did not apply at all to a report supplied via `--audit-file`, where the provenance is invisible.

---

## 5. The advisory-visibility contract (what Phase 41 added)

### 5.1 The authoritative property

`pnpm audit --json` emits **two** independent things:

| Field | Behaviour under `--audit-level` |
|---|---|
| `advisories` | the advisory **RECORDS** — **truncated** by a severity threshold |
| `metadata.vulnerabilities` | the registry's severity **CENSUS** of the full population — **not** truncated |

Measured on this repository:

| Command | Records | Census sum | |
|---|---|---|---|
| `pnpm audit --json` | 92 | 92 | **AGREE** |
| `pnpm audit --audit-level=moderate --json` | 84 | 92 | **DISAGREE** |
| `pnpm audit --audit-level=high --json` | 48 | 92 | **DISAGREE** |

The census is produced by the registry from the whole population; a severity threshold removes records and leaves it alone. It is therefore an authoritative witness to how many advisories the report was *supposed* to carry, and comparing it against the records it *does* carry detects a truncated report **per severity tier**, naming the tier that vanished.

**This is deliberately not a remembered constant.** A hardcoded `92` would break the gate the next time the registry publishes an advisory, and the pressure to make it pass again would be precisely the pressure that suppresses a real finding. The census moves with the registry, so nothing needs updating and nothing needs loosening.

### 5.2 Checks added

All are fail-closed. Each reports independently.

1. **`the audit invocation applies no severity threshold`** — `AUDIT_ARGV` was hoisted to a frozen constant and is now audited by the gate itself against `SEVERITY_FILTER_FLAGS`. The Phase 40 invariant of convention is now a check.
2. **`the audit report carries the registry severity census`** — `metadata.vulnerabilities` must exist, be an object, hold finite non-negative integers, and declare only canonical tiers (`info`, `low`, `moderate`, `high`, `critical`). Absent tiers read as zero; **invented** tiers are a failure.
3. **`the advisory records account for the whole population, i.e. the report is UNFILTERED`** — per-tier reconciliation plus a total check. Every advisory must carry a recognised severity, or the record is unreconcilable and the report is rejected.

### 5.3 What was preserved

- **No existing check was removed.** The empty-report check, the floor assertion and the sub-threshold report are all still present and still fail closed.
- **The gate did not broaden into adjudicating moderate/low vulnerabilities.** It still asserts exactly one property about floored packages and still *reports* the remainder.
- **The triage policy is untouched.** `triage-vulnerabilities.mjs` is byte-identical; critical/high reachability triage is unchanged.

### 5.4 Residual boundary, stated not hidden

The census is a witness **from the same document**. An actor who rewrites both `advisories` and `metadata` so they agree produces a coherent report this gate cannot refute from within the report. That actor can already rewrite the control, the lockfile or the floor policy — the boundary Phases 37–38 already measure. What Phase 41 removes is the **accidental** filter, which is the realistic regression. This is recorded in the gate header and in the harness output rather than left implicit.

---

## 6. F-40-02 reproduction (before remediation)

Confirmed by inspection and then by measurement:

- **No Phase 39 mutant wrote the gate source.** The only mutation targets were `writeAuditFixture()`, `editPolicy()` and `writeMirror(root, workflowRel, …)`. `makeMirror()` copied `scripts/` and nothing then touched the gate file, so `isParseableJs()` — the guard meant to reject unparseable gate mutants — was **dead code**, because nothing ever mutated the gate.
- **The docstring claim was false.** Lines 100–103 asserted that narrowing `BELOW_THRESHOLD_SEVERITIES` to `['moderate']` would be caught, *"because a low-severity advisory against a floored package must be reported"* (M-LOW). Narrowing the constant leaves the gate **passing**: the assertion does not depend on it. The claim attributed coverage to a constant the assertion never reads.
- **Regressions in the untested lines escaped.** Narrowing the assertion to critical/high, or corrupting the package comparison, both produced silent passes.

---

## 7. Implementation changes

| File | Change |
|---|---|
| `scripts/verify-dependency-advisory-visibility.mjs` | Phase 41 header section; `AUDIT_ARGV` / `SEVERITY_FILTER_FLAGS` / `CANONICAL_SEVERITIES` constants; `readCensus()`; `reconcileRecordsAgainstCensus()`; argv self-check; two new fail-closed checks; reworded banner and PASS/FAIL text |
| `scripts/mutate-dependency-advisory-visibility.mjs` | Phase 41 header section; `captureFilteredAudit()`; `FILTERED_*` constants; `injectAdvisory()`; `mutateGate()` (uniqueness-checked anchors); live-run support; `LIVE_ENV`; dual-polarity scoring; 11 new mutants; new tally with source-mutation count |
| `.github/workflows/ci.yml` | Phase 41 rationale on the gate step; step renamed to state that unfiltered is *proven*; Phase 41 rationale on the mutation step. **Commands unchanged and still exact.** |
| `scripts/verify-ci-parity.mjs` | `why` text for both p39 entries updated to describe the census contract and the source mutations. **Command, target and id unchanged.** |

**No new file was created. No file was renamed or removed.**

---

## 8. Mutation results

`node scripts/mutate-dependency-advisory-visibility.mjs` → **exit 0**, reproduced identically in the working tree and in a clean checkout.

```
TALLY  22 mutant(s) applied, of which 7 mutate the gate's OWN SOURCE:
         15 detected (the real control rejected the state)   [adversarial-state mutants]
         5 weakened  (the source mutation was proven consequential)  [source mutants]
         2 correctly tolerated (legitimate positive controls)
       failures: 0 genuine escapes, 0 detected for the wrong reason,
                 0 ineffective source mutations, 0 discarded as setup failures.
```

### 8.1 The two polarities

The harness scores **adversarial-state** and **source** mutants on deliberately opposite exit codes, and reports them in separate tallies:

| Mutant class | Question | Required outcome |
|---|---|---|
| adversarial-state | does the real control **reject** this bad state? | exit **1** |
| source | does weakening this line make the control **accept** that same bad state? | exit **0** |

For a source mutant, exit 0 *is* the proof that the mutated line is load-bearing — provided the identical input is rejected by the unmutated control. That is why each source mutant is **paired** with a fixture mutant supplying the same input:

| Source mutant | Paired fixture mutant | Both results |
|---|---|---|
| `M41-SRC-SEV-NARROW` | `M-MOD` (same moderate advisory vs `brace-expansion`) | DETECTED / WEAKENED |
| `M41-SRC-PKGMATCH` | `M-MOD` | DETECTED / WEAKENED |
| `M41-SRC-CENSUS-OFF` | `M41-FILTER-HIGH` (same genuine filtered report) | DETECTED / WEAKENED |
| `M41-SRC-CENSUS-ABSENT-OK` | `M41-NO-CENSORY` (same census-less report) | DETECTED / WEAKENED |
| `M41-SRC-EMPTY-TOLERATED` | `M-EMPTY` (same empty report) | DETECTED / WEAKENED |

Neither half of a pair is sufficient on its own: the fixture half proves the control rejects the input, the source half proves the mutation is what made it accept.

`M41-SRC-LEVEL-ADDED` is the exception and is correctly scored with the **default** polarity. Injecting `--audit-level=high` into the gate's own argv makes the control **fail closed** — the argv self-check fires first — so the required outcome is exit 1. That is the defence working, and it is a stronger result than a silent weakening. Were the argv check absent, this mutant would flip to `weaken`.

### 8.2 Genuine filtered reports, not fakes

`M41-FILTER-HIGH` and `M41-FILTER-MOD` feed reports captured from **real** `pnpm audit --audit-level=…` invocations. `captureFilteredAudit()` **refuses to return a report that is not actually truncated**, so these mutants cannot silently degenerate into no-ops. No synthetic advisory is presented as authoritative in any filter test.

### 8.3 Positive controls — states that must NOT be flagged

| Id | State | Outcome |
|---|---|---|
| `M-PASS` | a moderate advisory against `next`, which has **no** floor | correctly tolerated |
| `M41-SRC-SEVCONST` | `BELOW_THRESHOLD_SEVERITIES` narrowed to `['moderate']` in the **source** | correctly tolerated |
| WS6 `P41-13` | coordinated CI + parity rename (Phases 37–38 trust boundary) | tolerated |
| WS6 `P41-14` | step **name** renamed only | tolerated |

`M41-SRC-SEVCONST` replaces the false Phase 39 claim with a measured one: narrowing that constant governs the **narrative tally only** and cannot weaken the assertion. A tier cannot be hidden by narrowing it, because the census check prints **every** tier with its count and reconciles the records against them.

---

## 9. Negative and positive controls (WS4)

| # | Case | Method | Result |
|---|---|---|---|
| 1 | completely unfiltered full report | genuine `pnpm audit --json` | **accepted** (exit 0, 8/8 checks) |
| 2 | `--audit-level=high` filtered report | genuine report | **rejected** — "records (48) … census 92 … low: 8 missing; moderate: 36 missing" |
| 3 | `--audit-level=moderate` filtered report | genuine report | **rejected** — "records (84) … low: 8 missing" |
| 4 | empty advisory payload | census 92 + `advisories:{}`; and a forged all-zero census + `advisories:{}` | **rejected** both — `the audit report is not empty` |
| 5 | malformed advisory payload | census absent; census non-numeric; census inventing a tier; advisory missing `severity`; `advisories` a string; report not JSON | **rejected** in all six, each on its own check |
| 6 | legitimate clean full report | **NOT REPRESENTABLE** — see below | not claimed |
| 7 | known moderate advisories 1240100/1240101 reintroduced via a weakened graph | genuine lowered-override graph | **detected and named** |

**Case 4 note.** A forged report with an all-zero census and no records is rejected by the retained empty-report check. That check was deliberately **not** made census-relative, because doing so would have turned a new class of forged report into a pass. The trade-off is recorded in case 6.

**Case 6 — stated honestly, not faked.** This repository has 92 advisories and cannot produce a genuinely clean full report, so the case cannot be exercised against real tool output. The gate's retained behaviour is that an **empty** advisory set is always a failure — the Phase 39 posture, preserved. A genuinely clean repository would therefore fail this gate until its census is reconciled rather than assumed clean. That is a **known limitation**, not a pass, and I did not manufacture a fixture to make it look covered.

**Case 7 detail.** In a throwaway mirror with `pnpm-workspace.yaml` overrides lowered to the Phase-34 versions and the lockfile regenerated, the genuine report carries **94 records against a census of 94**, so the census reconciles and the report is proven unfiltered — **and** the floor assertion still names both:

```
1240100 (moderate) brace-expansion: vulnerable <1.1.21, patched >=1.1.21
1240101 (moderate) brace-expansion: vulnerable >=2.0.0 <2.1.7, patched >=2.1.7
```

Under the **full coordinated** R36-03 edit (policy + workspace overrides + lockfile together), `verify-dependency-security-floor.mjs` and `verify-dependency-floor-policy.mjs` both exit **0** while the visibility gate exits **1**. The census check does not mask the floor assertion; it runs alongside it.

---

## 10. CI integration

`.github/workflows/ci.yml`:

- **Exact command, unchanged:** `node scripts/verify-dependency-advisory-visibility.mjs` — deliberately without `--audit-file`, so CI asserts against the live dependency graph rather than a saved document.
- **Job placement:** job `api`, step 19. `pnpm install --frozen-lockfile` is step 3, so the install precedes the gate and cannot be skipped by an install failure.
- **No suppression:** no `if:`, no `continue-on-error`, no `|| true`, no `set +e`, no `&& exit 0`, no `2>/dev/null || true`, no job-level conditional, no workflow-level `defaults.run.shell`.
- **Working-directory independence:** verified empirically. The gate resolves its root from `import.meta.url`, so running it from `/tmp` against an absolute path produces the identical verdict.
- **PATH/HOME independence:** the gate spawns `pnpm` from `PATH`, which CI guarantees via `pnpm/action-setup`. The harness's own child environment was a **defect** (§13) and was fixed to inherit `process.env`.
- **One step, no duplicate or shadow gate.** The only other reference is the mutation harness in the `release` job.
- Step names and rationale comments updated to describe the Phase 41 contract. Commands and targets untouched.

## 11. Parity results

`node scripts/verify-ci-parity.mjs --list` → **exit 1**, **4 problems**, all of them the **pre-existing untracked-file** condition:

| Untracked target | Origin |
|---|---|
| `scripts/verify-dependency-floor-policy.mjs` | Phase 37 |
| `scripts/verify-dependency-advisory-visibility.mjs` | Phase 39/41 |
| `scripts/mutate-dependency-floor-policy.mjs` | Phase 37 |
| `scripts/mutate-dependency-advisory-visibility.mjs` | Phase 39/41 |

**Phase 41 introduced no new parity problem.** The count is unchanged from the pre-flight baseline of 4, and the same two Phase 39 entries that were already flagged remain flagged. Per WS5 this condition is **expected during development and is reported, not suppressed**: the contract states that a clean checkout — what a runner sees — would not contain the files, so the step cannot work there while it works in this working tree.

Required-gate registration is internally consistent: `REQUIRED_GATES` entries and the `REQUIRED_GATE_IDS` list agree, and both `p39-advisory-visibility` ids are present. The gate and its harness are contractually required.

## 12. CI contract mutation testing (WS6)

`/tmp/opencode/p41/ws6-harness.mjs` — outside the repository, one throwaway **git** repository per attack so the untracked-target check runs its real code path.

**15 attacks: 12 DETECTED, 3 tolerated (all legitimate), 0 escapes, 0 setup failures.**

| Id | Attack | Outcome |
|---|---|---|
| P41-00 | unmutated committed mirror | TOLERATED (positive control) |
| P41-01 | remove the Phase 41 CI step | **DETECTED** |
| P41-02 | wrong command (extra flag) | **DETECTED** |
| P41-03 | command pointed at a nonexistent target | **DETECTED** |
| P41-04 | rename the target script without updating the workflow | **DETECTED** |
| P41-05 | alter `REQUIRED_GATE_IDS` | **DETECTED** |
| P41-06 | alter the workflow command to a substring | **DETECTED** |
| P41-07 | `continue-on-error` | **DETECTED** |
| P41-08 | `\|\| true` | **DETECTED** |
| P41-09 | `set +e` | **DETECTED** |
| P41-10 | remove the mutation-harness step | **DETECTED** |
| P41-11 | implementation script untracked | **DETECTED** |
| P41-12 | command commented out | **DETECTED** |
| P41-13 | coordinated CI + parity rename | TOLERATED — Phases 37–38 trust boundary |
| P41-14 | step **name** renamed only | TOLERATED — names are documentation, parity matches on `step.run` |

## 13. Harness defects, disclosed and corrected

Three defects were found in the harness or my own test scaffolding. All were **discarded, disclosed, corrected and rerun**. None was counted as a detection, and no finding rests on a discarded result.

1. **Scoring polarity (the substantive one).** On its first Phase 41 run the harness scored source mutants as escapes and reported `FAIL — 6 problem(s)` against a working control. The cause was a real conflation in the harness: adversarial-state and source mutants require **opposite** exit codes, and the Phase 39 scorer applied the adversarial polarity to both. Corrected by adding an explicit `polarity: 'weaken'`, reporting `weakened` / `ineffective` as outcomes distinct from `detected` / `escape`, and splitting the tally. This is recorded because it is exactly the error that would make a mutation campaign report a sound control as unproven.
2. **Environment defect.** The child environment was `{ CI: '1', FORCE_COLOR: '0' }`, which **replaces** the whole environment and drops `PATH`. Fixture runs never noticed because `--audit-file` spawns nothing. The live mutant `M41-SRC-LEVEL-ADDED` failed `ENOENT` — correctly discarded as a setup failure, but proving nothing. Fixed to `{ ...process.env, CI: '1', FORCE_COLOR: '0' }`; the mutant then **DETECTED** on a live run.
3. **Wrong expected string.** `M41-SRC-CENSUS-ABSENT-OK` initially required the literal `GENUINE ESCAPE`, which is harness log text and never appears in gate output. Removed; the mutant is now scored on exit polarity.

Two further **reviewer-scaffolding** defects were found during WS8 and corrected before any result was recorded:

4. **Prisma client not generated.** In the clean checkout `verify-dependency-audit` exited 1 with *"the Prisma query engine did not load"*. Cause: I excluded build output, and CI runs `prisma generate` as an explicit step before that gate. Corrected by reproducing CI's order → **exit 0**.
5. **Web build absent.** `verify-next-image-optimizer` exited 1 in the clean checkout (`images-manifest.json` / standalone server missing). Cause: I excluded `.next`, and CI builds web before that gate. Corrected by building web → **exit 0**, 16 PASS.

Neither was a Phase 41 defect. Both were my mirror construction, and both are disclosed rather than quietly re-run.

---

## 14. Local regression results (WS7)

All against the modified working tree. Exact counts as observed.

### 14.1 Dependency and security gates — all pass

| Gate | Exit |
|---|---|
| `verify-dependency-audit.mjs` | 0 |
| `triage-vulnerabilities.mjs` | 0 |
| `verify-dependency-triage.mjs` | 0 |
| `verify-dependency-security-floor.mjs` | 0 |
| `verify-dependency-floor-policy.mjs` | 0 |
| **`verify-dependency-advisory-visibility.mjs`** | **0** — 9 checks, 9 passed |
| `verify-config-contract.mjs` | 0 |
| `verify-next-config-features.mjs` | 0 |

The hardened gate's own reconciliation line: *"the advisory set accounts for the entire population the registry reports: 92 record(s) against a census of 92 (info 0, low 8, moderate 36, high 44, critical 4)."*

### 14.2 Build, typecheck, artifacts

`@ecc/api typecheck` 0 · `@ecc/web typecheck` 0 · `@ecc/mobile typecheck` 0 · `@ecc/api build` 0 · `@ecc/api build:verify` 0 · `@ecc/web build` 0 · `verify:metadata` 0 · `verify:routes` 0 · `verify-release-artifact.mjs` 0 · `verify:storage:backup` 0 · `verify-next-image-optimizer.mjs` 0

### 14.3 Tests — exact counts

| Suite | Files | Tests | Skipped | Exit |
|---|---|---|---|---|
| `api:unit` | 13 passed | **166 passed** | 44 skipped | 0 |
| `api:integration` (e2e + security, throwaway PG) | 8 passed | **138 passed** | 0 | 0 |
| `api:all` (unit + integration, throwaway PG) | 27 passed | **348 passed** | 0 | 0 |
| `@ecc/mobile test` | 6 passed | **34 passed** | 0 | 0 |
| `@ecc/web test` | 1 passed | **1 passed** | 0 | 0 |

`run-db-suites.mjs` provisioned `ecc-p28-pg-17qjn3895cb63`, migrated it, and **destroyed it**; its own output confirms *"the developer `ecc` database is not involved in this run."*

### 14.4 Migrations and mutation harnesses

| Gate | Exit | Notes |
|---|---|---|
| `bash scripts/verify-db-migrations.sh` | 0 | valid, reproducible, idempotent, sufficient |
| `mutate-dependency-advisory-visibility.mjs` | 0 | **22 mutants, 7 source** |
| `mutate-dependency-floor-policy.mjs` | 0 | 23 applied, 18 detected, 4 tolerated, **1 confirmed trust-boundary escape** (preserved) |
| `mutate-dependency-security-floor.mjs` | 0 | pass |
| `mutate-next-image-optimizer.mjs` | 0 | pass |
| `mutate-config-contract.mjs` | 0 | pass |
| `mutate-next-config-rewrites.mjs` | 0 | pass |
| `mutate-ci-integration.mjs` | 0 | pass |
| `verify:ratelimit:n12:mutate` (N-12) | 0 | pass |
| `verify:metadata:mutate`, `verify:routes:mutate`, `verify:lifetime:mutate` | 0 | pass |

### 14.5 Docker

`verify-docker-images.mjs --skip-build` → **exit 0, 58 PASS, 0 FAIL**, run against the pre-existing images. **No image was rebuilt.** `mutate-container-gate.mjs` is **NOT registered** in CI or the parity contract and was **NOT TESTED** — that exact status is preserved and is not upgraded to a pass.

### 14.6 Lint — reported exactly as observed, not reinterpreted

`pnpm lint` (`turbo run lint`) → **exit 1**. Turbo: 8 successful of 11 tasks, 5 cached.

| Package | Observed |
|---|---|
| `@ecc/api` | **124 problems (55 errors, 69 warnings)**, `--max-warnings 0` — the CI comment's "55 pre-existing errors" is accurate |
| `@ecc/mobile` | **18 problems (0 errors, 18 warnings)**, `--max-warnings 0`; 8 auto-fixable |
| `@ecc/web` | fails under turbo concurrency; **exit 0 standalone** ("No ESLint warnings or errors") — observed discrepancy, not reinterpreted |

**Lint is FAILING.** All of this is pre-existing debt in `apps/api` and `apps/mobile`. Phase 41 touched only `scripts/`, `.github/workflows/ci.yml` and `docs/`, so none of it is attributable to this phase. No gate was silently omitted or reinterpreted as green.

---

## 15. Clean-checkout reproducibility (WS8)

A clean checkout was built from the implementation state (all tracked **and** untracked artefacts, since Phase 37/39 files are not yet committed), with a **genuine** `pnpm install --frozen-lockfile` — no symlinked `node_modules`, because pnpm correctly refuses to operate on one.

| Gate | Exit |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `verify-dependency-advisory-visibility.mjs` | **0** |
| `verify-dependency-security-floor.mjs` | 0 |
| `verify-dependency-floor-policy.mjs` | 0 |
| `verify-dependency-triage.mjs` | 0 |
| `triage-vulnerabilities.mjs` | 0 |
| `verify-config-contract.mjs` | 0 |
| `verify-dependency-audit.mjs` | 0 *(after `prisma generate`, CI's order — §13.4)* |
| `verify-next-image-optimizer.mjs` | 0 *(after `pnpm --filter @ecc/web build`, CI's order — §13.5)*, 16 PASS |
| `mutate-next-image-optimizer.mjs` | 0 |
| `mutate-dependency-advisory-visibility.mjs` | **0** — identical tally: 22 applied, 7 source, 15 detected, 5 weakened, 2 tolerated, 0 failures |
| `pnpm --filter @ecc/api typecheck` / `build` | 0 / 0 |
| **`verify-ci-parity.mjs --list`** | **0** |

**F-40-01 re-checked in the clean checkout:** a genuine `--audit-level=moderate` report (84 of 92) → **exit 1**, *"records (84) do not account for the 92 advisories the registry reports … low: 8 missing"*.

**One honest caveat on the parity result.** The clean checkout is not a git repository, so `verify-ci-parity.mjs` reports **exit 0** there — its untracked-target check has no repository to consult and therefore cannot fire. That means the clean checkout **cannot** exercise the untracked detection that matters most here, and the authoritative result for that property remains the working-tree run in §11 (**exit 1, 4 untracked findings**). I am not reporting the clean-checkout `exit 0` as evidence that the untracked condition is resolved. It is not; it is invisible in a non-repo.

---

## 16. Integrity and contamination check (WS9)

| # | Check | Result |
|---|---|---|
| 1 | protected artifacts vs pre-flight checksums | **4 changed, all in scope and intended:** `ci.yml`, `verify-ci-parity.mjs`, `verify-dependency-advisory-visibility.mjs`, `mutate-dependency-advisory-visibility.mjs`. All 66 others byte-identical, including every `SECURITY_REVIEW_*.md` and every `docs/PHASE_*` |
| 2 | application source modified | **NO** — `apps/api/src`, `apps/api/test`, `apps/web`, `apps/mobile`, `packages` all byte-identical |
| 3 | Prisma schema/migrations changed | **NO** — `schema.prisma` and both migrations byte-identical; `git diff HEAD -- apps/api/prisma/` empty; migration count unchanged at 2 (+`migration_lock.toml`) |
| 4 | `pnpm-lock.yaml` changed | **NO** — byte-identical, unmodified vs `HEAD` |
| 5 | security-review artifact created | **NO** — `SECURITY_REVIEW_PHASE_41.md` does not exist |
| 6 | historical report modified | **NO** — all 12 `docs/PHASE_*` and all 11 `SECURITY_REVIEW_*.md` byte-identical |
| 7 | developer database modified | **NO** — 37 tables, hash `461d1a250b11449a2d9ebb153128528c`, 2 migrations, latest `2026-09-14 20:26:22.709031+00`, identical to pre-flight |
| 8 | throwaway infrastructure removed | mirrors, the vulnerable-graph mirror and the clean checkout all removed; `git worktree list` shows the primary tree only; throwaway Postgres `ecc-p28-pg-17qjn3895cb63` destroyed; **no `ecc_p28*` / `ecc_p41*` database residue** |
| 9 | unrelated tracked modifications overwritten | **NO** — `git status` identical to pre-flight plus the 4 intended changes; nothing was reverted or overwritten |
| 10 | pre-existing untracked artifacts untouched | **YES** — all 11 `SECURITY_REVIEW_*.md`, 12 `docs/PHASE_*`, the Phase 37/39 scripts and `security/` are present and unmodified |
| — | containers | set identical to pre-flight (`pg-pgtest`, `ecc-postgres`, `ecc-redis`, `ecc-minio`); none created, none destroyed |
| — | commit / push / amend / rebase / reset / stash | **NONE** |

---

## 17. Remaining blockers

1. **Everything from Phase 37 + Phase 39 + Phase 41 is uncommitted, and hosted CI for it is UNVERIFIED.** The last hosted green run is **36714434566** for `199877a`, which corresponds to the **Phase 36** state: its API job ends at *"Supply chain — the dependency security floor is enforced (Phase 36 P34-1)"* and its Release job at *"Mutation — the dependency floor detects a lowered remediation (Phase 36)"*, with **no** Phase 37, 39 or 41 step. **No runner has ever executed the advisory-visibility gate.** Local results are not a substitute.
2. **`verify-ci-parity.mjs --list` exits 1** on the 4 untracked targets. This is correct behaviour and is deliberately **not suppressed**. It resolves only on commit — which requires authorisation this phase does not carry.
3. **F-40-05 (pre-existing, out of scope).** The parity contract does not detect a required gate step hidden behind `if:`. Phase 40 proved this predates Phase 39 and I confirmed it again against a Phase-28-era gate. Not expanded into; the shipped Phase 41 step carries no conditional.
4. **No authorisation sought or assumed** for committing or pushing, per instruction 10 and the closing instruction.

## 18. Status classification

### VERIFIED (locally, in the working tree and in a clean checkout)

- F-40-01 **reproduced before** remediation (partial filter, 84 of 92, exit 0) and **closed** — genuine `--audit-level=high` and `--audit-level=moderate` reports are both rejected by name.
- Completeness is reconciled against an **authoritative report property** (the registry severity census), per tier — not against a remembered count or expected package IDs.
- Empty, census-less, census-tampered, malformed and non-JSON reports all fail closed, each on its own check.
- Advisories **1240100 / 1240101** remain detectable when reintroduced through a genuinely weakened graph, and are still detected under the **full coordinated** R36-03 edit while both Phase-37 gates pass.
- F-40-02 **closed**: 7 mutations now write the gate's own source; each is proven consequential by pairing with a fixture mutant supplying the identical input.
- CI contains the gate with an exact command, no suppression, correct placement and working-directory independence; parity requires it and reports the untracked condition honestly.
- CI contract mutation testing: 15 attacks, 12 detected, 3 legitimate positive controls, 0 escapes.
- All dependency, security, build, typecheck, artifact, migration, storage, N-12 and test gates pass. **538 DB-backed tests passed** (138 + 348 + 34 + 1 + 166 unit).
- Docker image verification: **58 PASS, 0 FAIL**, no rebuild.
- Protected artifacts, application source, Prisma and `pnpm-lock.yaml` byte-identical; developer DB fingerprint unchanged.

### NOT TESTED

- **`mutate-container-gate.mjs`** — not registered in CI or parity; requires container rebuilds outside this authorisation. **Status preserved as NOT TESTED, not upgraded to a pass.**
- Docker image **rebuild** — only `--skip-build` was run, against pre-existing images.

### OPEN

- Hosted CI for Phase 37/39/41: no runner execution exists.
- `verify-ci-parity.mjs --list` exit 1 on 4 untracked targets, pending commit authorisation.
- The 44 sub-threshold advisories (36 moderate + 8 low) remain unremediated. Remediating them requires dependency upgrades and a lockfile change, neither authorised here. **No advisory was suppressed, allow-listed, ignored or downgraded, and no threshold was weakened.**
- Review gaps from Phase 40 stand unchanged: **Phases 22, 23, 27, 38** have no review artifact; **Phases 26, 32, 33** remain self-reviewed; no review in this chain is organisationally independent.

### ACCEPTED LIMITATION

- **Report self-consistency boundary.** An actor who rewrites both `advisories` and `metadata` so they agree cannot be refuted from within the report. That actor can already rewrite the control, the lockfile or the floor policy — the boundary Phases 37–38 already measure. Recorded in the gate header and harness output.
- **Four-file coordinated-edit trust boundary** (Phases 37–38), re-confirmed by WS6 `P41-13`; the floor-policy harness's **1 confirmed trust-boundary escape** is preserved.
- **A genuinely clean repository would fail this gate**, because the empty-report check is retained rather than made census-relative. Recorded, not faked (§9 case 6).
- **F-40-05** parity `if:` gap, pre-existing.

---

## 19. Final checkpoint

| Item | Value |
|---|---|
| **Status** | Implementation complete. **NOT reviewed** — `SECURITY_REVIEW_PHASE_41.md` deliberately not created. |
| **Files modified** | `scripts/verify-dependency-advisory-visibility.mjs`, `scripts/mutate-dependency-advisory-visibility.mjs`, `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs` |
| **Files created** | this report only (`docs/PHASE_41_FINAL_REPORT.md`) |
| **Gates** | 8 dependency/security 0 · build/typecheck/artifact/migration/storage/N-12 0 · tests 0 · mutation harnesses 0 · docker `--skip-build` 0 (58 PASS) · **`verify-ci-parity.mjs --list` exit 1** (4 untracked, expected, unsuppressed) · **`pnpm lint` exit 1** (pre-existing) · `mutate-container-gate.mjs` NOT TESTED |
| **Mutations** | gate harness **22 applied / 7 source / 15 detected / 5 weakened / 2 tolerated / 0 failures**. CI contract **15 attacks / 12 detected / 3 tolerated / 0 escapes** |
| **CI integration** | gate present with exact command, job `api` step 19, no suppression, cwd-independent; registered in parity. **Executed on a runner: NO.** |
| **Hosted CI** | **UNVERIFIED for Phase 41.** Last green run `36714434566` = Phase 36 state; contains no Phase 37/39/41 step. |
| **Remaining blockers** | uncommitted Phase 37/39/41 state; parity exit 1 pending commit authorisation; F-40-05 pre-existing parity gap; 44 sub-threshold advisories unremediated; review gaps open |
| **Git** | `HEAD` = `origin/main` = `199877aef283eff36984114ecf486eaec1554c39`. Nothing committed, pushed, amended, rebased, reset or stashed. |
| **Integrity** | 66 protected files, all application source, Prisma and `pnpm-lock.yaml` byte-identical; developer DB unchanged; no throwaway residue; containers unchanged |

**No commit and no push were performed. No production, staging or release readiness is claimed.**
