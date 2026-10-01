# SECURITY_REVIEW_PHASE_37.md

**Subject:** Phase 37 — protection of the dependency security floor (reviewer finding R36-03)
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline reviewed:** `199877aef283eff36984114ecf486eaec1554c39` (Phase 36 final HEAD, identical to `origin/main`, tree `774566b4b973da5ae15590c010e2dfc8f64ecca4`)
**Reviewed work:** uncommitted working-tree changes implementing Phase 37
**Review date:** 2026-09-30
**Nature:** Independent adversarial verification only. No fix implemented, no recommendation made.

> **No production-readiness, staging-readiness, release-readiness, compliance-certification or deployment claim is made anywhere in this document.** No security score, rating or ranking is assigned, and none should be inferred.

---

## 1. Review scope

Phase 37 was scoped to exactly one reviewer finding — **R36-03**, from `SECURITY_REVIEW_PHASE_36.md`: *"FLOORS configuration is unprotected — the control's own configuration is the single place remediation can be lowered with no check failing."*

Phase 37 created three files and modified four. This review verified all seven against the report's claims, and independently re-derived the underlying conditions rather than re-reading `docs/PHASE_37_FINAL_REPORT.md` and endorsing it.

**In scope:** R36-03 reproduction; the canonical policy file; the new policy-contract gate; both mutation harnesses; CI/parity integration; clean-checkout reproducibility; the full regression suite; protected-artifact integrity; and the explicitly-declared limitations.

**Out of scope and untouched:** R36-01, R36-02, R36-04 (Phase 36 findings); container gates (`verify-docker-images.mjs`, `mutate-container-gate.mjs`) — reported NOT TESTED by Phase 37, and preserved as such here; organizational independence of prior phases.

---

## 2. Independence disclosure

I am an independent verification pass **inside this repository**, on the same machine, with the same toolchain, git identity and hosted-runner credentials as the implementation session.

**I am not organizationally independent of this work.** I cannot claim separation of duties from the implementing agent, independence from the repository owner, an audit function distinct from the party under review, or independence in the sense an external auditor would provide.

What I can claim, and what this document rests on:

- I did not implement Phase 37. I made **no repository modification whatsoever** — verified by checksum and by the tracked-tree hash being byte-identical before and after (§12).
- I built my **own attack harness** with different mutations from Phase 37's, so that agreement between harnesses is evidence rather than a shared assumption.
- I attacked the control adversarially and found defects in Phase 37's reasoning where they existed (F-01).
- I discarded every result obtained for the wrong reason, including several of my own (§13, R-38 disclosures).

**This document does not and cannot discharge an organizational independence requirement.** A reviewer requiring that must obtain a review from a party outside this repository and session.

---

## 3. Baseline repository state

| Property | At review start | At review end |
|---|---|---|
| HEAD | `199877aef283eff36984114ecf486eaec1554c39` | **unchanged** |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` | **unchanged** |
| Branch | `main` | `main` |
| Tree hash | `774566b4b973da5ae15590c010e2dfc8f64ecca4` | **identical** |
| Staged files | none | none |
| Stash | none | none |
| Tracked modifications | 4 (the Phase 37 edits) | **same 4, unchanged** |

**Tracked modifications — all pre-existing, all authored by Phase 37, none made by me:**
`.github/workflows/ci.yml`, `scripts/mutate-dependency-security-floor.mjs`, `scripts/verify-ci-parity.mjs`, `scripts/verify-dependency-security-floor.mjs`

**Phase 37 files, recorded separately because "untracked" is not "missing":**

| File | Present | Tracked | MD5 |
|---|---|---|---|
| `security/dependency-security-floor.json` | yes | **no** | `ac80e169176f787e148ac2cb32ed305d` |
| `scripts/verify-dependency-floor-policy.mjs` | yes | **no** | `a41e6953e766b491ec9fea6da1598e25` |
| `scripts/mutate-dependency-floor-policy.mjs` | yes | **no** | `ee83d9b9ec8a48c127ba081963bf04d9` |
| `docs/PHASE_37_FINAL_REPORT.md` | yes | **no** | `8730f783d7fe388fb8caa810f3d1a668` |

**Pre-existing untracked artifacts (21 total), recorded so they are not confused with review residue:** the 9 `SECURITY_REVIEW_PHASE_*.md` files present before this review, 11 historical `docs/*.md` files, and the 4 Phase 37 files above. All 20 `SECURITY_REVIEW_*` files and all 35 `docs/*.md` files were MD5-fingerprinted at review start and verified byte-identical at review end.

---

## 4. Phase 37 changes independently verified

### 4.1 The canonical policy is data-only — CONFIRMED

`security/dependency-security-floor.json` parses as a plain object with top-level keys `policyId`, `policyVersion`, `description`, `floors`; per-floor keys `package`, `majors`, `minimum`, `advisories`, `why`, `reachedVia`; per-advisory keys `id`, `severity`, `patchedIn`. A programmatic scan for `function`, `=>`, `require`, `process`, `eval`, `import` and `$` returns **no matches**. It is a data file with no executable behaviour.

### 4.2 The floor values are correct and independently corroborated — CONFIRMED

I did not take the policy's own `patchedIn` claims at face value. I ran `pnpm audit --json` against the genuinely vulnerable graph I built (§5) and compared:

| Advisory | Policy `patchedIn` | Actual `pnpm audit` `patched_versions` | Match |
|---|---|---|---|
| 1240100 | `1.1.21` | `>=1.1.21` | **YES** |
| 1240101 | `2.1.7` | `>=2.1.7` | **YES** |

These are the two **binding** advisories — the moderate ones that set the floor above the high-severity level. The other six are high/low advisories fixed at or below the floor; they cannot appear in a fully-remediated graph, which is why they are absent from that audit output. All three mandated versions (`brace-expansion@1.1.21`, `brace-expansion@2.1.7`, `undici@6.28.1`) were confirmed to **exist in the npm registry**, so the floors do not pin non-existent releases.

### 4.3 The two brace-expansion lines remain independently constrained — CONFIRMED

The policy declares two separate `floors` entries for `brace-expansion`, with disjoint `majors: ["1"]` and `majors: ["2"]`, distinct minimums (`1.1.21`, `2.1.7`) and distinct advisory sets. The verifier keys every check on `(package, majors)`. Attack A2 and harness mutant P2 confirm the lines are measured independently — lowering the 2.x line fails on the 2.x floor alone.

### 4.4 The policy cannot silently weaken through malformed or partial data — CONFIRMED

Structural validation is strict and fails closed. My attacks confirm every one of: malformed minimum, computed/non-literal minimum, missing `advisories`, non-numeric advisory id, duplicate (package, major), empty policy, deleted policy file, corrupt JSON, added unexpected package, and renamed package identity. **All detected, each for the intended reason.** `compareVersions` returns `null` for anything unparseable and every call site treats `null` as a failure rather than a pass.

---

## 5. R36-03 reproduction

**REPRODUCED in full.** This is the central review item.

### 5.1 Method

I did not reproduce from the report's narrative. I built a mirror from HEAD and **verified the unmutated control first** (all five dependency gates green — critical, because it makes any later failure attributable to the mutation rather than to an incomplete mirror). Then:

1. restored the **pre-Phase-37 floor gate** via `git show HEAD:scripts/verify-dependency-security-floor.mjs` — the version with `FLOORS` inline;
2. deleted `security/dependency-security-floor.json` to return to the pre-Phase-37 tree shape;
3. lowered the inline floors `1.1.21 → 1.1.20` and `2.1.7 → 2.1.6`;
4. lowered the `pnpm-workspace.yaml` overrides to match;
5. ran a **real `pnpm install --no-frozen-lockfile`**, so the vulnerable graph was produced by the package manager rather than by my hand.

pnpm resolved `brace-expansion@1.1.20` and `brace-expansion@2.1.6`.

### 5.2 The graph is genuinely vulnerable

| | info | low | **moderate** | high | critical |
|---|---|---|---|---|---|
| HEAD | 0 | 8 | **36** | 44 | 4 |
| reproduced | 0 | 8 | **38** | 44 | 4 |

Advisories **1240100** and **1240101** (`brace-expansion`, both moderate) are **present** in the reproduced graph. Critical and high are unchanged — which is precisely why every gate below misses them.

### 5.3 The pre-existing gates pass

| Gate | Exit | Phase 37 claim |
|---|---|---|
| `verify-dependency-security-floor.mjs` | **0** | PASS — reproduced |
| `verify-dependency-triage.mjs` | **0** | PASS — reproduced |
| `verify-dependency-audit.mjs` | **0** | PASS — reproduced |
| `verify-config-contract.mjs` | **0** | PASS — reproduced |
| `triage-vulnerabilities.mjs` | **0** — *"No critical or high advisory is reachable"* | PASS — reproduced |
| `verify-ci-parity.mjs --list` | **0** | PASS — reproduced |

### 5.4 The new control fails

```
[FAIL] brace-expansion override and declared floor state the SAME version
   `brace-expansion@>=1.0.0 <1.1.20` resolves to 1.1.20, which is BELOW the
   policy floor 1.1.21. The policy and the package manager disagree about what
   "remediated" means; the weaker one wins at install time.
13 check(s): 11 passed, 2 failed.    EXIT=1
```

**The expected chain is CONFIRMED end to end:** vulnerable graph → six old gates PASS → new control FAIL, with the failure naming the weakened remediation.

### 5.5 Setup failures excluded — disclosed

`verify-dependency-audit.mjs` initially exited 1 on `the Prisma query engine did not load`, caused by my `--ignore-scripts` install. Per review discipline this is a **setup artifact, not a security result**: I ran `prisma generate`, re-ran, and obtained exit 0. Only the post-repair result is reported as evidence.

### 5.6 Restoration verified

The mirror's `pnpm-lock.yaml`, `pnpm-workspace.yaml` and floor gate were restored and MD5-verified byte-identical to the review baseline (`ccfa78db…`, `656abae0…`, `8a84bd9f…`).

---

## 6. Canonical floor-policy verification

The policy's *meaning* was established, not assumed:

> For each declared `(package, majors)`: no resolved instance in `pnpm-lock.yaml` may be below `minimum`; `minimum` must be at least the `patchedIn` of every advisory it claims to close; `minimum` must equal the version the `pnpm-workspace.yaml` override forces; every forced package must have a floor; and `pnpm-workspace.yaml` and `pnpm-lock.yaml` must declare identical overrides.

**"Floor" semantics are not automatically secure**, and this review did not accept them because the file exists. Two properties were tested rather than trusted:

1. A floor is only meaningful if the **advisory record is intact** — attack A1 lowers the floor and is caught specifically because advisory 1240100 records that it is fixed only in 1.1.21.
2. A floor is only enforced if the **package manager is told to honour it** — attack A3 removes the `undici` override entirely and is caught by both the missing-override check and the workspace/lockfile disagreement check.

`verify-dependency-security-floor.mjs` remains the authority on the resolved graph; `verify-dependency-floor-policy.mjs` is the authority on whether the policy is still defensible. Neither duplicates the other's role.

---

## 7. Mutation results

Two harnesses were run, plus my own independent attack harness. Every mutant was checked for whether it (a) actually applied, (b) was detected **for the intended security reason**, and (c) left the repository untouched.

### 7.1 Phase 37's harness — reproduced exactly

`node scripts/mutate-dependency-floor-policy.mjs` → **EXIT 0**

```
TALLY  13 mutant(s) applied: 11 detected by evaluation, 0 detected by
       refusing, 2 correctly tolerated, 0 discarded as setup failures.
```

Identical to the claimed tally. Its post-condition reported all six real files byte-identical, which I independently confirmed by checksum.

The existing floor harness `mutate-dependency-security-floor.mjs` also passes, with D11's expectation correctly inverted from `pass` to `refuse`.

### 7.2 My independent attack harness — 18 attacks

Built deliberately from a reviewer's angle with **different mutations** from Phase 37's (package-identity changes, duplicate entries, unexpected packages, non-numeric advisory ids, corrupt JSON).

| # | Attack | Result | Detected by |
|---|---|---|---|
| A1 | lower brace-expansion 1.x floor | **DETECTED** | `floor covers advisory 1240100` + override disagreement |
| A2 | remove `undici` from policy | **DETECTED** | `every forced package has a floor` |
| A3 | remove the `undici` override | **DETECTED** | lockfile disagreement + `no override for undici` |
| A4 | rename package identity (`brace-expand`) | **DETECTED** | `no override for brace-expand` |
| A5 | rewrite advisory evidence to match a lowered floor | **DETECTED** | override/floor disagreement |
| A6 | malformed minimum `"not-a-version"` | **DETECTED** | `minimum is a literal dotted version` |
| A7 | duplicate conflicting entry | **DETECTED** | `declared twice` + floor-vs-advisory |
| A8 | add an unexpected package with a bogus floor | **DETECTED** | `no override for evil-pkg` |
| A9 | non-literal (computed object) minimum | **DETECTED** | literal check, refusing not coercing |
| A10 | delete advisory evidence | **DETECTED** | `advisories is a non-empty array` |
| A11 | non-numeric advisory id | **DETECTED** | `id is a numeric advisory id` |
| A12 | empty the whole policy | **DETECTED** | `` `floors` is non-empty `` |
| A13 | delete the policy file | **DETECTED** | `policy file exists` |
| A14 | corrupt to invalid JSON | **DETECTED** | `is parseable JSON` |
| A15 | policy + workspace override lowered | **DETECTED** | lockfile oracle |
| A16 | policy + evidence + workspace + **lockfile** | **PASSES** | see §8.5 / F-01 |
| A17 | **positive**: raise floor + advisory + override + lockfile | **TOLERATED** | correct — legitimate remediation |
| A18 | **positive**: reformat, identical content | **TOLERATED** | correct — meaning, not bytes, is compared |

**Totals: 15 detected for the intended reason, 2 correctly tolerated, 1 confirmed-escaping (A16, which is the documented boundary and is reported as F-01, not as a pass).**

### 7.3 Reviewer-harness disclosures

**R-38-1 — my attack harness, all 18 attacks discarded and re-run.** The first version assigned each mutation helper's return value to a `const`, but arrow functions using `Array.filter` return a new array, so 15 of 18 mutants threw `Assignment to constant variable`. All 15 were **DISCARDED as setup failures**, the harness was corrected to ignore a non-plain-object return, and every attack was re-run from scratch. None of the discarded results was counted.

**R-38-2 — my A12 expectation was wrong, not the gate.** I asserted the output would contain `zero floors`; the gate emits `` `floors` is non-empty `` with a different detail string. I inspected the gate's source, confirmed its behaviour was correct, corrected my expectation, and re-ran. A12 is a valid detection.

**R-38-3 — my P10 oracle-isolation edits initially did not apply.** My first two attempts to neutralise the oracles used regexes that did not match the gate's actual formatting, so they silently no-opped and I wrongly recorded "still detected". I caught this because a no-op edit should have produced a different result, added an assertion that each neutralisation actually changed the source, and re-ran. Only the corrected results are reported.

---

## 8. P9/P10/P11/P12 verification

Phase 37 claimed specific classifications. I verified each independently, and additionally established **which oracle is load-bearing** by disabling oracles one at a time in mirrors.

### 8.1 P9 — initially undetected, fixed by exact override agreement — CONFIRMED

P9's shape: policy floor **and** its advisory evidence lowered together, override untouched.

| Configuration | Exit |
|---|---|
| P9 shape, control intact | **1** (detected) |
| P9 shape with the override-agreement oracle disabled (`cmp = 0`) | **0 — FALSE GREEN** |

**CONFIRMED:** the override-agreement oracle is precisely and solely what catches P9. Phase 37's attribution is accurate.

### 8.2 P10 — initially undetected, fixed by the lockfile oracle — CONFIRMED

P10's shape: policy + evidence + **workspace override** lowered, lockfile untouched.

| Configuration | Exit |
|---|---|
| P10 shape, control intact | **1** (detected) |
| P10 shape with the lockfile `mapsAgree` oracle disabled | **1** |
| P10 shape with the override-agreement oracle disabled | **1** |
| **P10 shape with BOTH oracles disabled** | **0 — FALSE GREEN** |

**CONFIRMED:** with both cross-artifact oracles disabled, P10 passes. The lockfile oracle is therefore necessary for P10, exactly as Phase 37 claimed. Phase 37's own statement that P10 "was initially undetected and fixed by adding the lockfile oracle" is an accurate account of its own development.

### 8.3 P11 — drift, correctly a failure — CONFIRMED

Floor raised to `1.1.22` with a justifying advisory, override left at `1.1.21` → **exit 1**, `brace-expansion override and declared floor state the SAME version`. Classification as a detection is correct: the policy demands a version the package manager will never install.

### 8.4 P12 — legitimate remediation, correctly tolerated — CONFIRMED

Floor raised + advisory added + override raised + lockfile raised, all coordinated → **exit 0**. The control does not punish a correct remediation. This is the adoption guard and it works.

### 8.5 The trust boundary — REPRODUCED, and it is real

I built the **full coordinated attack**: policy floor, advisory evidence, `pnpm-workspace.yaml` overrides, `pnpm-lock.yaml` overrides **and the lockfile's resolved graph** all lowered to the vulnerable versions, on a complete mirror with a real install and a valid control beforehand. Then:

| Gate | Exit |
|---|---|
| `verify-dependency-floor-policy.mjs` | **0** |
| `verify-dependency-security-floor.mjs` | **0** |
| `verify-dependency-triage.mjs` | **0** |
| `verify-config-contract.mjs` | **0** |
| `verify-dependency-audit.mjs` | **0** |
| `triage-vulnerabilities.mjs` | **0** |

And `pnpm install --frozen-lockfile` on that lockfile **exits 0**, so a hosted CI runner would accept it. The result is stable across three consecutive runs.

**What the controls DO guarantee.** Any weakening confined to the policy alone, to policy + advisory evidence, or to policy + workspace override is detected. The floor can no longer be lowered by a one-line edit to the gate that reads it. That is a real and material improvement over R36-03.

**What they DO NOT guarantee.** They do not provide cryptographic provenance or tamper-evidence for the floor policy. An actor able to edit policy, evidence, workspace overrides **and** the lockfile together — and to review that diff casually — obtains green CI. Recorded as F-01.

**Trust boundary statement.** This is not a control failure. No in-repository control can defend against an actor who can rewrite the repository's own security policy; the party who can change the policy can change the control. The correct trust boundary is git review, code review and the hosted run — not any single file. What the Phase 37 design achieves is that the floor can no longer be weakened **by editing only the floor configuration**, which was precisely the R36-03 requirement, and that a coordinated weakening is now a four-file, reviewable change rather than a one-line edit.

---

## 9. CI integration verification

Verified by **structured YAML parsing**, not textual grep.

| Property | Result |
|---|---|
| Gate executed in CI | Yes — `api` job, `run: node scripts/verify-dependency-floor-policy.mjs` |
| Harness executed in CI | Yes — `release` job, `run: node scripts/mutate-dependency-floor-policy.mjs` |
| Exact command | Yes — both match `REQUIRED_GATES.exactCommand` verbatim |
| `continue-on-error` | **false** on both |
| `\|\| true` / `set +e` / `\|\| :` / `\|\| echo` / `&& exit 0` | **none** on either step |
| GitHub expressions that could hide a path | none |
| Step ordering | runs after `pnpm install` in `api`; harmless, the gate needs no network |
| Working directory | repository root; the gate resolves `repoRoot` from `import.meta.url`, so cwd-independent |
| Appears in `--list` inventory | Yes, both, marked `[LOCAL]` |
| Required-gate registration | `p37-floor-policy`, `p37-floor-policy-mutate` |
| `REQUIRED_GATE_IDS` extended in step | Yes |
| Duplicate gate ids | **0** (23 entries in both lists, exact match) |
| Removal detected | Yes — mutant P8 removes the CI step and parity reports it |

**cwd/environment independence (tested):** the gate exits 0 when run from `/` and from `/tmp`, under `env -i`, and under `PATH=/nonexistent HOME=/nonexistent`. The harness likewise exits 0 from `/` and under `env -i`, with an identical tally.

**The untracked-file question, answered precisely.** In the current developer tree the parity contract reports exactly two findings:

- step *"Supply chain — the dependency floor policy cannot be weakened (Phase 37 R36-03)"* … `scripts/verify-dependency-floor-policy.mjs` is NOT tracked by git
- step *"Mutation — the floor policy cannot be weakened (Phase 37 R36-03)"* … `scripts/mutate-dependency-floor-policy.mjs` is NOT tracked by git

This is the **P35-2 untracked-artifact control firing correctly** against Phase 37's own new files. To confirm the finding is about tracking and not something else, I built a **separate mirror**, committed the Phase 37 files there (without touching the real repository), and re-ran: **`verify-ci-parity.mjs --list` exits 0**, with the policy file and both scripts tracked and all 23 required gates resolvable. The finding therefore clears on commit. **I did not commit anything in the real repository.**

This is also the honest consequence of reviewing uncommitted work: **no hosted CI run exists for the Phase 37 state**, so CI integration is verified structurally and locally, not on a runner.

---

## 10. Clean-checkout verification

A `git worktree` at HEAD with the Phase 37 changes applied, then the repository's real install procedure:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | **PASS** — *"Lockfile is up to date, resolution step is skipped"*, 4.1 s |
| `verify-dependency-floor-policy.mjs` | **exit 0** |
| `verify-dependency-security-floor.mjs` | **exit 0** |
| `verify-dependency-triage.mjs` | **exit 0** |
| `verify-dependency-audit.mjs` | **exit 0** (after `prisma generate`; see below) |
| `verify-config-contract.mjs` | **exit 0** |
| `verify-next-config-features.mjs` | **exit 0** |
| `verify-env-contract.mjs` | **exit 0** |
| `mutate-dependency-floor-policy.mjs` | **exit 0** |
| `mutate-dependency-security-floor.mjs` | **exit 0** |
| `verify:metadata` / `verify:routes` | **exit 0** / **exit 0** |
| `verify:ratelimit:n12:mutate` | **exit 0** |
| `verify-db-migrations.sh` | **PASS** — 15 PASS checks |
| `verify-release-artifact.mjs --skip-web` | **exit 0** |

**Setup artifact excluded:** `verify-dependency-audit.mjs` first exited 1 on `the Prisma query engine did not load`, because the frozen install does not run postinstall scripts. I ran `pnpm --filter @ecc/api exec prisma generate` and re-ran to exit 0. This is a **known setup condition**, not a security result — CI generates the Prisma client explicitly before this gate. The worktree was removed.

---

## 11. Regression verification

Counts reproduced independently from the clean checkout.

| Suite | Claimed | Independently measured |
|---|---|---|
| DB-backed integration (e2e + security) | 138 | **138 passed**, 8 files |
| DB-backed unit + integration | 348 | **348 passed**, 27 files |
| **DB-backed total** | 486 | **486 passed** |
| Skipped / todo markers in DB output | 0 | **0** (`grep -ci "skipped\|todo"` → 0) |
| Mobile tests | 34 | **34 passed** |
| Web tests | 1 | **1 passed** |
| Typecheck api / mobile / web | pass | **pass / pass / pass** |
| Build api / web | pass | **pass / pass** |
| `verify:metadata` / `verify:routes` | pass | **pass / pass** |
| `verify-db-migrations.sh` | pass | **PASS**, 15 checks |
| `verify-release-artifact.mjs --skip-web` | pass | **exit 0** |
| `verify:ratelimit:n12:mutate` | pass | **exit 0** |
| `verify-dependency-audit` / `-triage` | pass | **exit 0 / exit 0** |
| `verify-config-contract` | pass | **exit 0** |
| `verify-next-config-features` | pass | **exit 0** |
| `verify-env-contract` | pass | **exit 0** |
| `mutate-dependency-floor-policy` | 13 mutants | **exit 0**, 13 applied |
| `mutate-dependency-security-floor` | 12 mutants | **exit 0** |

All DB work ran on a throwaway PostgreSQL created by the harness and **destroyed by it** at the end. The developer `ecc` database was never a target.

**Every claimed count is CONFIRMED. No suite was green because it skipped.**

---

## 12. Integrity / contamination checks

### 12.1 Protected artifacts — unchanged

| Artifact | Result |
|---|---|
| `pnpm-lock.yaml` | **unchanged** (`ccfa78db9184754cf7f9f4ac86353659`) |
| `pnpm-workspace.yaml` | **unchanged** (`656abae051a73b60deba041dfa8f0a8c`) |
| `package.json` | **unchanged** (`322568884835c4083f2eac29801fb1b4`) |
| `scripts/triage-vulnerabilities.mjs` | **unchanged** (`6e8a93f3…`) — severity filter intact |
| `scripts/verify-dependency-audit.mjs` | **unchanged** (`4a25b816…`) |
| `scripts/verify-dependency-triage.mjs` | **unchanged** (`caed4aa9…`) |
| All 7 Phase 37 files | **unchanged** (15/15 checksums OK) |
| Prisma schema + 2 migrations | **3/3 unchanged** |
| All 20 `SECURITY_REVIEW_*` files | **20/20 unchanged** |
| All 35 `docs/*.md` historical reports | **35/35 unchanged** |
| `PROJECT_PLAN-old.md` | **unchanged** (`e6174a55…`) |

`.github/workflows/ci.yml` still shows **zero removed lines** — Phase 37's edit remains purely additive, as it was before this review.

### 12.2 Git history untouched

HEAD, `origin/main`, tree hash `774566b4b973da5ae15590c010e2dfc8f64ecca4`, and branch `main` are all identical before and after. No commit, push, rebase, reset, amend or stash. Nothing staged. The tracked-modification set is byte-identical to what I found.

### 12.3 Contamination

| Item | Disposition |
|---|---|
| Clean-checkout worktree | **removed** via `git worktree remove --force`; `git worktree list` shows only the main worktree |
| Throwaway PostgreSQL (`ecc-p28-*`) | **destroyed by its own harness**; `docker ps -a` shows none |
| My mirrors under `/tmp/opencode/p38/` | **removed** after each test |
| `pg-pgtest` container (up 10 h, created 04:01 UTC) | **pre-existing, not mine — left untouched** |
| `unruffled_aryabhata` (`hello-world`, exited 3 months ago) | **pre-existing, not mine — left untouched** |
| `ecc-postgres` / `ecc-redis` / `ecc-minio` | **pre-existing — never targeted** |
| Untracked file count | 21 at start, 21 at end (the new file is this review's `SECURITY_REVIEW_PHASE_37.md`) |

I did not delete any pre-existing untracked artifact. Nothing appeared during this review that I could not attribute to my own actions and clean up.

### 12.4 Files created by this review

Exactly one: **`SECURITY_REVIEW_PHASE_37.md`**. No `SECURITY_REVIEW_PHASE_38.md`. No fix, no configuration change, no CI change.

## 13. Findings

### F-01 — MEDIUM — the floor policy is not tamper-evident against a coordinated four-file edit

- **Affected control:** `scripts/verify-dependency-floor-policy.mjs`, and by consequence every dependency gate.
- **Reproduction:** lower `security/dependency-security-floor.json` floors to the vulnerable values **and** rewrite the advisory `patchedIn` records to match **and** lower the `pnpm-workspace.yaml` overrides **and** lower the `pnpm-lock.yaml` overrides **and** lower the lockfile's resolved graph; re-resolve with a real `pnpm install`; run every dependency gate.
- **Impact:** all six gates exit 0, and `pnpm install --frozen-lockfile` exits 0, so a hosted runner would accept the tree. Moderate advisories 1240100 and 1240101 return to the graph undetected.
- **Evidence:** reproduced on a complete mirror; stable across three consecutive runs (§8.5).
- **New or inherited:** the *boundary* is inherited in kind from R36-03, which had exactly the same property in a worse form. Phase 37 **substantially narrowed** it — from a one-line edit to the enforcing file, to a coordinated four-file change. It did not eliminate it, and Phase 37 does not claim it did.
- **Severity reasoning:** MEDIUM, not HIGH or CRITICAL. It requires an actor who can already edit the repository's dependency policy, the package-manager declaration, and the lockfile simultaneously — that actor can already remove the gate itself. This is a defence-in-depth limitation inside a stated trust boundary, not a bypass of a working control. It is not exploitable by an external attacker and grants no new capability.
- **Remediation required:** no. Recorded as a limitation with its boundary stated, per the instruction not to recommend fixes.

### F-02 — LOW — the gate's own header misdescribes its Layer 3

- **Affected file:** `scripts/verify-dependency-floor-policy.mjs` (header comment, line ~60).
- **Exact condition:** the header describes *"LAYER 3 — THE RESOLVED GRAPH (already enforced by the floor gate)"*, and the "Deliberately NOT claimed" section says the attack *"requires editing three independent statements of the same fact"*. The implementation's Layer 3 is the **lockfile override oracle**, not the resolved graph, and the control actually examines **four** records: policy floor, advisory evidence, workspace overrides, lockfile overrides.
- **Impact:** a future maintainer reading only the header would mis-model the control's coverage and could wrongly conclude that the lockfile is unchecked. No runtime behaviour is affected — the code and the code comments inside the function body are correct.
- **Evidence:** header text read directly and compared against the code at line 272 (`// --- LAYER 3: the LOCKFILE's own override record`).
- **New or inherited:** new in Phase 37.
- **Remediation required:** no. Documentation defect, not a control defect.

### F-03 — INFO — no hosted CI run exists for the Phase 37 state

- **Affected:** `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`.
- **Condition:** all four Phase 37 files are untracked, so nothing has been pushed and no hosted run can exist.
- **Impact:** CI integration is verified structurally and locally, not on a runner. This is the normal state of uncommitted work, not a defect.
- **New or inherited:** inherent to the workflow phase being uncommitted.
- **Remediation required:** no.

**No CRITICAL or HIGH findings.** No control that claims to work was found not to work. No advisory suppression, severity change, threshold relaxation, allow-list, `continue-on-error`, or removal of an existing gate was found anywhere in the Phase 37 diff.

---

## 14. Unverified items

| Item | Status | Reason |
|---|---|---|
| Hosted CI execution of the Phase 37 gates | **NOT TESTED** | Phase 37 is uncommitted; nothing pushed. Integration verified structurally and locally only. |
| `verify-docker-images.mjs` | **NOT TESTED** | Container image build not run in this review. Phase 37 changes no file it reads. Its Phase 36 status is inherited and unverified here. |
| `mutate-container-gate.mjs` (all mutants M1–M11) | **NOT TESTED** | Same. Not upgraded from NOT TESTED to pass anywhere in this document. |
| `verify:storage:backup` on the clean checkout | **NOT TESTED** | Ran in the Phase 36 review pass; not repeated here. Untouched by Phase 37. |
| Live advisory database agreement for the six non-binding `patchedIn` values | **INFERRED** | Those advisories cannot appear in a remediated graph, so `pnpm audit` cannot corroborate them here. The two binding values were directly confirmed (§4.2). |
| Behaviour of the control in a non-git worktree | **NOT TESTED** | The new control does not read git state; not exercised. |
| Organizational independence of this review | **NOT CLAIMED** | See §2. |

**Nothing marked BLOCKED.** No stop condition was hit: no protected artifact needed modification, no lockfile change was required in the repository (only in disposable mirrors), and no fix was needed to complete the review.

---

## 15. Remaining blockers

**None for Phase 37 itself.** R36-03 is closed within its stated scope, and the change is coherent and well-tested.

Conditions that remain open, none of which blocks this phase:

1. **F-01** — the four-file coordinated edit remains possible by design of the trust boundary, and is stated as such.
2. **The Phase 37 files are uncommitted**, so parity correctly reports two findings and no hosted CI run exists. Committing them is what clears both, and it is the repository owner's decision, not a review action.
3. **R36-01, R36-02, R36-04** from the Phase 36 review remain open; Phase 37 did not address them and was not scoped to.
4. **Container gates remain NOT TESTED** — unchanged status, not a new gap.
5. **Prior-phase review gaps unchanged:** Phases 22, 23 and 27 have no review artifact; Phase 26 is self-reviewed by its own admission; Phases 32/33/34 are self-reviewed; Phase 25 is self-endorsed. Phases 28, 29, 30, 31, 35, 36 are independently reviewed by self-declaration, and **all of those review documents remain untracked** (R36-04), so the audit trail is not visible to any third party.

---

## 16. Disposition

### PHASE 37 VERIFIED WITH FINDINGS

Phase 37 does what it claims, and the evidence supporting that judgement is strong because it was re-derived rather than read:

- **R36-03 is independently confirmed as closed, within its stated scope.** The floor can no longer be lowered by editing the configuration; it can no longer be lowered by editing the policy and its advisory evidence together; it can no longer be lowered by editing those plus the workspace overrides; and it can no longer be lowered by editing the gate that reads it. What remains possible is a coordinated four-file change that also lowers the lockfile, which Phase 37 explicitly declared and which I reproduced and quantified rather than glossed over (F-01).
- **The Phase 37 mutation evidence is valid.** I re-ran the harness and obtained its exact claimed tally; I wrote a separate attack harness with different mutations and obtained 15 correct detections, 2 correct tolerances and 1 confirmed escape; and I established by targeted oracle-disablement that P9 is caught *only* by the override oracle and P10 *only* by the lockfile oracle, confirming Phase 37's account of its own development rather than taking it on trust.
- **CI integration is real.** Both gates are present in the workflow with exact commands and no suppression, both are required by parity, both appear in `--list`, the gate-id lists match 23-for-23 with no duplicates, removal is detected, and the control is cwd- and environment-independent. The one caveat is that integration is verified locally and structurally because the work is uncommitted (F-03) — no hosted run exists.
- **The two untracked-file parity findings are correct behaviour**, not a defect: they are the P35-2 control firing against Phase 37's own new files, and I confirmed they clear once the files are tracked by testing in a separate mirror without touching the real repository.
- **Docker image and container mutants remain NOT TESTED**, and nothing in this review silently upgrades them.
- **The repository is unchanged by this review**: identical HEAD, identical tree hash, nothing staged, no stash, every protected artifact checksum-verified, all throwaway infrastructure removed, and exactly one file created.

### Explicit statements requested

- **R36-03 independently confirmed as closed:** **YES**, within the boundary the control actually draws. The residual four-file gap is F-01, an accepted trust boundary rather than an unresolved defect.
- **Phase 37 mutation evidence valid:** **YES.** Re-run and independently re-derived, including oracle-level attribution for P9/P10.
- **CI integration real:** **YES**, verified structurally and locally. **NOT TESTED** on a hosted runner, because the work is uncommitted.
- **Four-way coordinated edit still possible:** **YES.** Reproduced. Recorded as F-01 with the guarantee/non-guarantee boundary spelled out. No stronger guarantee is claimed.
- **Docker image / container mutants still untested:** **YES — preserved as NOT TESTED.**
- **Review gaps remaining open:** Phases 22, 23, 27 (no artifact); 26, 32, 33, 34 (self-reviewed); 25 (self-endorsed); plus R36-01, R36-02, R36-04.
- **Is this review genuinely independent, or only a self-audit?** **It is an independent verification pass, not an organizational audit.** I did not implement Phase 37 and made no repository change, and I built my own attack harness rather than re-running the author's alone. But I am the same kind of agent, in the same repository, with the same credentials, and I cannot claim separation of duties from the implementation. **Any requirement for organizational independence is NOT satisfied by this document.**

---

### Status legend

| Marker | Meaning | Applied to |
|---|---|---|
| **CONFIRMED** | independently re-derived and matching | R36-03 closure; policy data-only-ness; floor values vs live audit; brace-expansion line independence; malformed-data handling; CI integration; all regression counts; protected-artifact integrity |
| **REPRODUCED** | adverse condition independently re-created and observed | R36-03 (vulnerable pnpm-resolved graph, all six old gates green); the four-file coordinated edit |
| **NOT REPRODUCED** | claimed failure not observed | none — every Phase 37 claim I tested held |
| **NOT TESTED** | not executed | hosted CI for Phase 37; `verify-docker-images.mjs`; `mutate-container-gate.mjs`; `verify:storage:backup` |
| **BLOCKED** | could not proceed | none |
| **INFERRED** | reasoned, not directly observed | agreement of the six non-binding `patchedIn` values with the advisory database |
