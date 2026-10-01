# PHASE 39 FINAL REPORT — Next Control / Security Hardening

**Phase:** 39
**Baseline:** `199877aef283eff36984114ecf486eaec1554c39` (identical to `origin/main`; tree `774566b4b973da5ae15590c010e2dfc8f64ecca4`)
**Input record:** `docs/PHASE_38_FINAL_REPORT.md`, treated as an implementation record requiring verification, not as evidence
**Date:** 2026-09-30
**Nature:** Pre-flight audit plus implementation of exactly one remediated control weakness.

> **No production-readiness, staging-readiness, release-readiness, compliance-certification or organizational-independence claim is made anywhere in this document.** No security score, rating or ranking is assigned or should be inferred.

---

## 1. Objective

Begin with a strict pre-flight and security-control audit, then implement only the next **objectively justified** repository-side remediation. If none existed, the phase would have stopped after the pre-flight with a report explaining why.

Phase 38 was assumed correct and verified rather than trusted. A genuine weakness was found in the pre-flight, reproduced, and remediated.

---

## 2. Pre-flight baseline

### Git state

| Property | Value |
|---|---|
| HEAD | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` |
| Divergence | `0  0` |
| Branch | `main` |
| Tree hash | `774566b4b973da5ae15590c010e2dfc8f64ecca4` |
| Staged | 0 |
| Stash | 0 |
| Rebase/merge/cherry-pick | none |
| Reflog head | `199877a phase(36): record the final report` |
| Tracked modifications | 4 (the Phase 37 edits, pre-existing) |
| Untracked | 23 (pre-existing reviews/reports + Phase 37/38 artifacts) |

### Protected-artifact fingerprints

298 artifacts fingerprinted before any change: 12 core files, 21 `SECURITY_REVIEW_*`, 36 `docs/*.md`, 3 Prisma, **226 application source files**.

### Hosted CI — inspected, not assumed

| Property | Value |
|---|---|
| Latest run | `36714434566` |
| SHA | `199877ae…` — matches HEAD |
| Conclusion | `success` |
| Jobs | 5 |
| Steps | 97, **0 skipped** |

**This run does NOT cover Phase 37 or Phase 38.** All of that work is uncommitted, so no hosted run has ever executed the floor-policy gate. Hosted CI status for the current state is therefore **UNVERIFIED** — there is no run to inspect. Nothing was pushed.

### Dependency/security state

```
pnpm audit  ->  92 advisories: 4 critical, 44 high, 36 moderate, 8 low
```

| Gate | Result |
|---|---|
| `verify-dependency-floor-policy.mjs` | PASS (16 checks) |
| `verify-dependency-security-floor.mjs` | PASS |
| `verify-ci-parity.mjs --list` | exit 1 — exactly 2 untracked-file findings (Phase 37) |

### Phase 35–38 state, verified rather than summarised

| Item | Verification performed | Result |
|---|---|---|
| P35-1 image optimizer | `verify-next-image-optimizer.mjs` run | PASS (`/_next/image` → 404) |
| P34-1 / P36-01…R36-04 | floor + policy gates run | PASS / PASS |
| Phase 37 F-01 (coordinated boundary) | harness `EST-1` | **Confirmed escape, as documented** |
| Phase 37 F-02 (documentation) | header text inspected | Correct as written |
| Phase 38 F-38-01 (per-major coverage) | `EST-6` re-run | **Detected — still fixed** |
| Phase 38 EST-2…EST-6 | harness re-run | 9 detected, 1 tolerated, 0 escapes |
| Untracked parity findings | `verify-ci-parity.mjs --list` | 2 (Phase 37) → now **4** (adds 2 Phase 39) |
| `verify-docker-images.mjs` | run with `--skip-build` | PASS (runtime checks, existing images) |
| `mutate-container-gate.mjs` | **NOT RUN** | Mutates `apps/api/src/*` in place; forbidden by scope rule 1 |

### The finding

**F-39-01 — 44 of 92 advisories reach no security gate.**

```
pnpm audit --json                       -> 92 advisories
pnpm audit --audit-level=high --json    -> 48 advisories     (44 dropped)
triage-vulnerabilities.mjs              -> 48 rows, all critical/high
```

Two independent pre-filters, neither recorded as a policy decision anywhere:

1. `pnpm audit` is invoked with `--audit-level=high`, so the low/moderate advisories are **absent from the document** triage reads.
2. `triage-vulnerabilities.mjs:846` then filters to `critical || high`.

**Not theoretical for this repository.** The advisories Phase 33 remediated — 1240100 (`>=1.1.21`) and 1240101 (`>=2.1.7`) — are **both moderate**. The vulnerabilities the security floor exists to exclude were invisible to the machinery meant to notice their return.

---

## 3. Finding selected

**F-39-01 — advisory visibility blind spot.** Chosen because it is objectively reproducible, security-relevant, inside repository control, independently testable, capable of regression protection, not documentation wording, not an accepted trust boundary, and not dependent on infrastructure that does not exist.

### Considered and rejected

| Candidate | Why not |
|---|---|
| Triage the 42 sub-threshold advisories fully | Measured during pre-flight: produces **19 REACHABLE** advisories across 11 packages. Remediating needs dependency **upgrades**, i.e. a **lockfile change** — forbidden by scope rule 2, and `next` 14.2.35 → 15.5.x would also change the runtime the P35-1 control was validated against. |
| Close the Phase 37 four-file boundary | Already an explicitly accepted **TRUST BOUNDARY**; not a remediated weakness. |
| Fix R36-01 / R36-02 | Outside this phase's decision criteria; not reproducible within scope. |
| `mutate-container-gate.mjs` coverage | Mutates protected application source; scope rule 1 forbids it. |

---

## 4. Reproduction

```
$ pnpm audit --json                       # 92 advisories
$ pnpm audit --audit-level=high --json    # 48 advisories
$ node scripts/triage-vulnerabilities.mjs # 48 rows, exit 0
```

Advisories 1240100 and 1240101 appear in **none** of them.

Decisive test — the gate built for this finding, run against the R36-03 vulnerable graph captured during the Phase 37 independent review:

```
$ node scripts/verify-dependency-advisory-visibility.mjs \
    --audit-file <R36-03 vulnerable audit>
[FAIL] no advisory exists against a package the security floor claims to remediate
6 check(s): 5 passed, 1 failed.        EXIT=1
```

In the same tree, all six pre-existing dependency gates exited **0**.

---

## 5. Root cause

Two severity filters, applied in sequence, each independently sufficient to hide a class of vulnerability:

| # | Location | Effect |
|---|---|---|
| 1 | `triage-vulnerabilities.mjs:831` — `pnpm audit --audit-level=high --json` | 44 advisories removed from the JSON before any script reads it |
| 2 | `triage-vulnerabilities.mjs:846` — `.filter(severity === 'critical' \|\| 'high')` | the same 44 would be removed again if #1 were fixed alone |

Neither is a security judgement. Both are inherited scope choices. The floor policy cannot see the gap either, because it covers only the two packages it was written for — `brace-expansion` and `undici` — while the 36 moderate advisories sit in 19 other packages.

---

## 6. Remediation

A **visibility gate** that observes the complete advisory set and asserts one property:

> No advisory may exist against a package the dependency security floor policy claims to have remediated — at any severity.

This is the precise statement of "the floor is doing its job". If `brace-expansion` carries any advisory, the floor has failed, whatever the severity and whatever the resolved version.

**What it deliberately does not do.** It does not adjudicate the other 42 advisories. That omission is measured, recorded, and stated in the gate's own header: triaging them produces 19 REACHABLE findings whose remediation requires dependency upgrades this phase is not authorized to make. They are **counted and reported** so the remaining gap is on the record rather than out of sight — not suppressed, not hidden, and not closed by this gate.

**Fail-closed.** A missing lockfile, unreadable audit report, missing `advisories` key, an **empty** advisory set, or a floor policy declaring no floors are all failures. An empty report is treated as failure rather than success, because a filtered report is indistinguishable from a clean one — that is the original defect.

---

## 7. Files changed

### Created (2)

| File | Purpose |
|---|---|
| `scripts/verify-dependency-advisory-visibility.mjs` | The visibility gate |
| `scripts/mutate-dependency-advisory-visibility.mjs` | Its mutation harness (10 mutants) |

### Modified (2)

| File | Change | Additive? |
|---|---|---|
| `.github/workflows/ci.yml` | 2 steps (gate in `api`, harness in `release`) | **77 insertions, 0 deletions** |
| `scripts/verify-ci-parity.mjs` | 2 `REQUIRED_GATES` + 2 `REQUIRED_GATE_IDS` entries | **58 insertions, 0 deletions** |

### Explicitly NOT modified

`pnpm-lock.yaml` · `pnpm-workspace.yaml` · `package.json` · `scripts/triage-vulnerabilities.mjs` (the pre-existing filter is **preserved, not relaxed**) · `scripts/verify-dependency-security-floor.mjs` · `scripts/verify-dependency-floor-policy.mjs` · `scripts/mutate-dependency-*.mjs` · `security/dependency-security-floor.json` · all Prisma · all `SECURITY_REVIEW_*` · all historical reports · **all 226 application source files**.

---

## 8. Protected files verified unchanged

| Set | Result |
|---|---|
| 12 core artifacts | 10/12 unchanged; the 2 differences are the CI files authorized to change |
| `.github/workflows/ci.yml` | **0 lines removed** — purely additive |
| `scripts/verify-ci-parity.mjs` | **0 lines removed** — purely additive |
| Prisma schema + 2 migrations | 3/3 unchanged |
| All 21 `SECURITY_REVIEW_*` | 21/21 unchanged |
| All 36 `docs/*.md` | 36/36 unchanged |
| All 226 application source files | 226/226 unchanged |
| `triage-vulnerabilities.mjs` | unchanged, `6e8a93f3…` — filter preserved, not weakened |
| `pnpm audit` severities | identical before/after: `4 critical, 44 high, 36 moderate, 8 low` |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | unchanged — **no dependency was modified at any point** |

No stop condition was reached. Nothing was suppressed, downgraded, allow-listed or bypassed.

---

## 9. Mutation methodology

- **Unmutated control verified first** in every harness, so no red result is attributable to an incomplete mirror.
- Each mutant must (a) change something the harness watches, (b) leave edited JS parseable, (c) fail with a **setup signature** check, and (d) be scored on the **named** check it was supposed to trip.
- Four outcomes kept distinct: `DETECTED`, `tolerated` (positive control), `setup failure` (**discarded**), `genuine escape`.
- Mutants vary the **audit fixture** and the **floor policy** via `--audit-file`; the real lockfile is never touched. This is both sufficient and safer than regenerating a graph.
- Repository restored after every mutant; a post-condition asserts byte-identity of all five real files, independently confirmed by checksum.
- Setup signatures hunted: `SyntaxError`, `MODULE_NOT_FOUND`, `Cannot find module`, `ERR_MODULE_NOT_FOUND`, `ENOENT`, `is not a function`, `Cannot read propert`, `YAMLParseError`, `JSONParseError`.

---

## 10. Mutation results

`node scripts/mutate-dependency-advisory-visibility.mjs` → **PASS**

```
TALLY  10 mutant(s) applied: 9 detected, 1 correctly tolerated,
       0 genuine escapes, 0 discarded as setup failures.
```

| ID | Mutation | Expected | Result | Detected by |
|---|---|---|---|---|
| CONTROL | real advisory set, real policy | green | **green** | control; makes red attributable |
| M-MOD | **moderate** advisory vs `brace-expansion` (the R36-03 condition) | fail | **DETECTED** | `no advisory exists against a package the security floor claims to remediate` |
| M-LOW | **low** advisory vs `undici` | fail | **DETECTED** | same check |
| M-CRIT | **critical** advisory vs `brace-expansion` | fail | **DETECTED** | same check |
| M-UNDICI | moderate advisory vs the **second** floored package | fail | **DETECTED** | same check |
| M-EMPTY | advisory set replaced with an **empty** one | fail | **DETECTED** | `the audit report is not empty` |
| M-NOISSUES | `advisories` key removed entirely | fail | **DETECTED** | `the audit report carries an advisory set` |
| M-NOFLOOR | floor policy emptied | fail | **DETECTED** | `the floor policy declares at least one floor` |
| M-CI | CI step deleted from `ci.yml` | fail | **DETECTED** | parity contract (independently re-verified below) |
| M-PASS | moderate advisory vs `next` (**no floor**) | pass | **correctly tolerated** | positive control |

**Every detection names its intended check** — verified by extracting the `[FAIL]` line per mutant, not by exit code alone.

**M-CI independently re-verified outside the harness:** a mirror with the CI step present gave `verify-ci-parity.mjs --list` **exit 0**; after removing it, parity **exit 1** with the message *"the gate `verify-dependency-advisory-visibility.mjs` (p39-advisory-visibility) is not wired into CI as a step command… A gate that only runs locally is a convention. Note that a comment mentioning the name does not count."*

---

## 11. Positive controls

| Control | Why it matters |
|---|---|
| M-PASS | A moderate advisory against `next` — which has **13** real moderate/low advisories and **no** floor — is **tolerated**. This is the honesty check: the gate asserts the **floor** holds and does not silently claim the 42 unadjudicated advisories are fine. A gate that failed here would be manufacturing a remediation this phase is not authorized to make. |
| M-PASS2 (reclassified) | Originally written as a no-op "control proper" and **discarded**; rewritten as a *detectable* low-severity advisory against a floored package, so it proves the control is not severity-bounded at the triage threshold. |
| Unmutated CONTROL | Green before any mutant in both the new and pre-existing harnesses. |

---

## 12. Harness defects discovered and discarded

All were defects in **my own** harness code, found and fixed before any result was counted.

| # | Defect | Handling |
|---|---|---|
| H-39-1 | The change-signal watched only the five repository files, so the **six** fixture-only mutants were scored as no-ops — **8 setup failures** where the control was never challenged. | Fixture content added to the change signal; all mutants re-run. No discarded result was counted as a detection. |
| H-39-2 | `M-PASS2` was a "positive control" that mutated nothing, making it indistinguishable from a no-op. | Rewritten as a detectable mutant. |
| H-39-3 | Syntax errors in the new harness: a missing parenthesis, an over-engineered lazy `createRequire`, and a `repoRoot` use-before-declaration. | All found by `node --check` before execution; fixed; harness then ran. |
| H-39-4 | An ad-hoc mirror for the M-CI re-verification failed with `ENOENT` from a malformed `cp -r`. | Recognised as a **setup failure, not a detection**; mirror rebuilt correctly and the result re-derived. |

No repository defect was fixed. No production or policy file was modified in producing these results.

---

## 13. Local verification

| Gate / suite | Result |
|---|---|
| `verify-dependency-advisory-visibility.mjs` | **PASS** (6 checks) |
| `verify-dependency-floor-policy.mjs` | **PASS** (16 checks) |
| `verify-dependency-security-floor.mjs` | **PASS** |
| `verify-dependency-audit.mjs` | **PASS** |
| `verify-dependency-triage.mjs` | **PASS** |
| `verify-config-contract.mjs` | **PASS** |
| `verify-next-config-features.mjs` | **PASS** |
| `verify-next-image-optimizer.mjs` | **PASS** |
| `verify-env-contract.mjs` | **PASS** |
| `verify:metadata` / `verify:routes` | **PASS** / **PASS** |
| `verify:ratelimit:n12:mutate` | **PASS** |
| `verify:storage:backup` | **PASS** |
| `mutate-ci-integration.mjs` | **PASS** |
| `mutate-dependency-security-floor.mjs` | **PASS** |
| `mutate-dependency-floor-policy.mjs` | **PASS** |
| `mutate-next-config-rewrites.mjs` | **PASS** |
| `mutate-dependency-advisory-visibility.mjs` | **PASS** (10 mutants) |
| `verify-db-migrations.sh` | **PASS** (15 checks) |
| `verify-release-artifact.mjs --skip-web` | **PASS** |
| `run-db-suites.mjs` | **PASS** — **138 + 348 = 486 DB-backed**, 0 skipped/todo |
| mobile / web tests | **PASS** — 34 / 1 |
| typecheck api / mobile / web | **PASS** ×3 |
| build api / web, `build:verify` | **PASS**, 280 files |
| `verify-ci-parity.mjs --list` | exit 1 — **4** untracked findings (2 Phase 37 + 2 Phase 39), correct and **not suppressed** |
| `verify-docker-images.mjs --skip-build` | **PASS** (runtime checks; no rebuild) |

### CI integration

| Property | Result |
|---|---|
| Gate in CI | Yes — `api` job, `node scripts/verify-dependency-advisory-visibility.mjs` |
| Harness in CI | Yes — `release` job, exact command |
| `continue-on-error` / `if:` | **false / none** on both |
| `\|\| true`, `set +e`, `\|\| :`, `&& exit 0` | **none** |
| `REQUIRED_GATES` / `REQUIRED_GATE_IDS` | **25 / 25**, 0 duplicates, exact match |
| `exactCommand` set | Yes — and deliberately **without** `--audit-file`, so CI asserts against the live graph, not a fixture |
| cwd independence | exit 0 from `/` and `/tmp` |
| hostile environment | exit 0 under `env -i` |

---

## 14. Clean-checkout verification

Applicable: the change affects CI, the security-policy control set, and tracked/untracked detection.

A `git worktree` at HEAD with the Phase 37/38/39 state applied, then the real install procedure:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | **PASS** — *"Lockfile is up to date, resolution step is skipped"*, 3.4 s |
| `verify-dependency-advisory-visibility.mjs` | **exit 0** |
| `verify-dependency-floor-policy.mjs` | **exit 0** |
| `verify-dependency-security-floor.mjs` | **exit 0** |
| `mutate-dependency-advisory-visibility.mjs` | **exit 0**, tally 10/9/1/0/0 |
| `mutate-dependency-floor-policy.mjs` | **exit 0** |
| `verify-dependency-audit.mjs` | **exit 0** after `prisma generate` |
| `verify-ci-parity.mjs --list` | **exit 0** once the untracked files are committed in that mirror |

No result depended on a file left outside git. Worktree removed.

---

## 15. Hosted CI result

**No run exists for the Phase 39 state, and none was created.** Nothing was committed or pushed, so hosted CI status for the current state is **UNVERIFIED** — not green, not red, simply absent.

The latest run `36714434566` (5 jobs, 97 steps, 0 skipped, `success`) covers `199877a` = Phase 36 only, and does **not** cover the floor-policy gate, the advisory-visibility gate, or anything added since.

CI green is **not** claimed. Local gates passing is not CI passing.

---

## 16. Remaining limitations

1. **The 42 sub-threshold advisories are reported, not remediated.** 36 moderate + 8 low across 19 packages. Pre-flight measurement: full triage yields **19 REACHABLE** advisories across `next`, `qs`, `file-type`, `@nestjs/core`, `esbuild`, `ajv`, `uuid`, `multer`, `decode-uri-component`, `fast-uri`, `fast-xml-parser`, `@vitest/mocker`. Remediation requires dependency upgrades and therefore a lockfile change — **not authorized in this phase**. This is **OPEN**, not closed.
2. **`next@14.2.35` still carries critical advisory 1193733** (unauthenticated RCE in the Image Optimization API). It is mitigated by `images.unoptimized: true` (P35-1), not removed. Upgrading to `>=15.5.x` would clear it but requires a lockfile change and would alter the runtime the P35-1 control was validated against. **OPEN.**
3. **7 moderate `next` advisories are reported as reachable** by the pre-flight experiment (XSS in App Router, cache poisoning, DoS in the Image Optimization API, Server Action payload). Reported, not adjudicated.
4. **The advisory set changes over time.** This gate observes what the registry returns at run time; it does not pin or archive it. Mutant M-EMPTY exists precisely because an empty report must never read as success.
5. **`file-type@20.4.1`** sits in advisory 1114726's vulnerable range and is a runtime dep of `@nestjs/common` via 11 production paths, but the vulnerable code is reached only through a lazy `eval('import("file-type")')` inside `FileTypeValidator`, which this application never uses. Determined **NOT reachable** by direct inspection, and recorded here rather than left implicit.
6. **`mutate-container-gate.mjs` — NOT TESTED.** Mutates `apps/api/src/*` in the working tree; forbidden by scope rule 1. **No container-mutation coverage is claimed.**
7. **Container images were not rebuilt.** `--skip-build` exercised runtime checks against images built earlier the same day; no application source changed, so no rebuild was required.
8. **The gate's own integrity is not self-verified.** Nothing in this repository verifies `verify-dependency-advisory-visibility.mjs` other than its own harness, which lives in the same tree under the same actor's control.
9. **`triage-vulnerabilities.mjs` still filters to critical/high.** It was left **deliberately unchanged** — relaxing it would fail CI on 19 unadjudicated findings whose remediation is unauthorized. The visibility gap is now covered by a separate gate instead.

---

## 17. Trust boundaries

1. **Coordinated manipulation of policy + advisory evidence + workspace overrides + lockfile + resolved graph.** Remains possible and remains **TRUST BOUNDARY** — confirmed by Phase 38 mutant `EST-1` and re-confirmed in this pre-flight. The party who can rewrite the dependency policy can rewrite the control that checks it.
2. **Uncommitted controls have no hosted-run evidence.** The floor-policy gate, the advisory-visibility gate and their harnesses have never executed on a runner. Their correctness rests entirely on local execution.
3. **Branch protection, CODEOWNERS, required approvals, signed commits, CI permissions.** **None implemented, none verified, no claim made.** Closing boundary (1) requires these.
4. **Remediation of the 42 sub-threshold advisories** is outside repository-local enforcement as defined here, because it needs a dependency-upgrade decision and a lockfile change.
5. **Organizational independence remains unsatisfied** for every phase in this repository, including this one.

---

## 18. Explicit non-claims

This document does **not** claim production readiness, staging readiness, release readiness, compliance certification, or organizational independence. It does not claim the 42 sub-threshold advisories are harmless. It does not claim CI is green — **no hosted run exists for this state**. It does not claim container-mutation coverage. It does not claim any advisory is suppressed, allow-listed or downgraded. It does not claim the four-file dependency-floor boundary is closed.

| Marker | Applied to |
|---|---|
| **PASS** | 24 local gates; 10-mutant harness; clean-checkout reproduction; integrity checks |
| **DETECTED** | 9 mutants, each on its named check |
| **POSITIVE CONTROL** | M-PASS; the unmutated CONTROL in both harnesses |
| **SETUP FAILURE** | 4 harness defects (H-39-1…4) and 1 mirror failure — all discarded, none counted |
| **TRUST BOUNDARY** | the four-file coordinated edit; uncommitted controls having no hosted evidence |
| **NOT TESTED** | `mutate-container-gate.mjs`; container image rebuild; remediation of the 42 sub-threshold advisories |
| **UNVERIFIED** | hosted CI for the current state (no run exists) |
| **BLOCKED** | remediation of the 19 REACHABLE sub-threshold advisories — needs lockfile modification, which is not authorized |

---

## 19. Git state

| Property | Value |
|---|---|
| HEAD | `199877aef283eff36984114ecf486eaec1554c39` — **unchanged** |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` — **unchanged** |
| Tree hash | `774566b4b973da5ae15590c010e2dfc8f64ecca4` — **unchanged** |
| Staged | 0 |
| Stash | 0 |
| Worktrees | main only (the clean-checkout worktree was removed) |
| Throwaway containers/DBs | none remaining |
| Developer `ecc` database | never targeted |

Tracked modifications remain the 4 pre-existing Phase 37 edits plus 2 additive Phase 39 edits to CI files. `SECURITY_REVIEW_PHASE_39.md` was **not** created; it belongs to the independent reviewer.

---

## 20. Whether commit/push occurred

**No. Nothing was committed and nothing was pushed.** No authorization was sought or assumed, per instruction 11. All Phase 37, 38 and 39 artifacts remain uncommitted working-tree changes, and `verify-ci-parity.mjs --list` correctly reports 4 untracked-file findings. That finding was **not** suppressed.
