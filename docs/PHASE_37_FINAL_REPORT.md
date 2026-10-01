# PHASE 37 FINAL REPORT — Protect the Dependency Security Floor

**Phase:** 37
**Subject:** R36-03 — the dependency security floor's own configuration was undefended
**Baseline:** `199877aef283eff36984114ecf486eaec1554c39` (Phase 36 final HEAD, identical to `origin/main`)
**Prior independent review:** `SECURITY_REVIEW_PHASE_36.md`
**Date:** 2026-09-30
**Nature:** Implementation of one reviewer finding. Not a documentation or reconciliation phase.

> **This phase does NOT establish production readiness, staging readiness, or any compliance certification.** No such claim is made anywhere in this document. No security score, rating, or ranking is assigned or should be inferred.

---

## 1. Objective

Phase 36 added a resolved-graph dependency security floor gate that closed P34-1. The independent Phase 36 review then found **R36-03**: the floors were configured *inside the gate that enforced them*, so the control and its configuration were the same editable object.

Phase 37's single objective is to make that floor **tamper-evident** — so that a future maintainer cannot produce

```
vulnerable version  →  weaker floor  →  green CI
```

by editing only the floor configuration.

Scope is deliberately narrow. R36-01 (plugin-derived Next config), R36-02 (coordinated edit of both required-gate lists) and R36-04 (untracked historical review artifacts) were investigated by the reviewer and are **not** remediated here: R36-04 is an audit-trail issue, not a code remediation, and historical reports are protected from modification by this phase's own rules.

---

## 2. R36-03 reproduction

I did not take the reviewer's finding on trust. I re-derived it in throwaway mirrors under `/tmp`, never the developer tree.

### 2.1 Where the floor was configured, and how it was consumed

Before this phase, the entire floor policy lived in `scripts/verify-dependency-security-floor.mjs` as a `const FLOORS = [...]` array inside the executing script. I confirmed by search that **nothing else in the repository referenced those values**:

```
$ grep -rn "1\.1\.21|2\.1\.7|6\.28\.1" scripts/ .github/ --include=*.mjs --include=*.yml
scripts/verify-dependency-security-floor.mjs:118:    minimum: '1.1.21',      <- the gate's own source
scripts/verify-dependency-security-floor.mjs:128:    minimum: '2.1.7',
scripts/verify-dependency-security-floor.mjs:137:    minimum: '6.28.1',
.github/workflows/ci.yml:130:  # ...chose 1.1.21 / 2.1.7 rather than...      <- a COMMENT
```

The only other occurrence was a prose comment in `ci.yml`, which the parity contract correctly ignores as a security boundary.

### 2.2 The reproduction

I built a full mirror, lowered the floors to the high-severity-only values (`1.1.21 → 1.1.20`, `2.1.7 → 2.1.6`), lowered the `pnpm-workspace.yaml` overrides to match, and ran a **real `pnpm install`** so the vulnerable graph was produced by the package manager rather than by hand-editing its output. pnpm resolved `brace-expansion@1.1.20` and `brace-expansion@2.1.7 → 2.1.6`.

The graph was genuinely vulnerable:

| | info | low | moderate | high | critical |
|---|---|---|---|---|---|
| HEAD overrides | 0 | 8 | **36** | 44 | 4 |
| lowered overrides | 0 | 8 | **38** | 44 | 4 |

Advisories **1240100** (`brace-expansion`, moderate, patched `>=1.1.21`) and **1240101** (`brace-expansion`, moderate, patched `>=2.1.7`) were absent at HEAD and present in the lowered graph.

Every dependency-security gate on that tree:

| Gate | Exit |
|---|---|
| `verify-dependency-security-floor.mjs` | **0** |
| `verify-dependency-triage.mjs` | **0** |
| `verify-dependency-audit.mjs` | **0** |
| `verify-config-contract.mjs` | **0** |
| `verify-next-config-features.mjs` | **0** |
| `verify-ci-parity.mjs --list` | **0** |
| `triage-vulnerabilities.mjs` | **0** — *"No critical or high advisory is reachable from a deployed code path."* |

**R36-03 confirmed in full.** The moderation of this phase's own results: two intermediate attempts produced non-zero exits for reasons unrelated to the security property — an incomplete mirror (`ENOENT` on `apps/api/src/main.ts`) and a `--ignore-scripts` install (Prisma query engine not generated). Both were diagnosed as setup artifacts, fixed, and re-run; they are not evidence.

Root cause confirmed in source: `scripts/triage-vulnerabilities.mjs:846` still filters to `critical || high` before deciding anything, so both moderate advisories were invisible to it. This phase does not touch that line and does not need to — it adds an independent check.

---

## 3. Root cause

The defect is a **separation-of-concerns failure**, not a logic bug. The floor gate's logic was correct; it simply had no way to object to its own configuration, because its configuration *was* its own configuration.

Lowering a floor was not merely "unnoticed". It was **invisible by construction**: any check that would have complained lived in the same file, and editing the file edited the check.

This is the same failure shape the Phase 36 reviewer catalogued twice in the same phase — R36-02 (a required-gate list reducible by a coordinated edit) and D11 in the floor harness (emptying `FLOORS` was *expected to pass*). D11 was, in effect, R36-03 written down as an accepted test outcome.

---

## 4. Design decision

### 4.1 What was rejected, and why

**Rejected: a second copy of the numbers.** Writing the floors down again in a "protected" location and comparing. It fails against the exact attack it targets — whoever lowers `FLOORS` lowers the second copy in the same commit. It converts a one-file edit into a two-file edit, which is a speed bump, not a control.

**Rejected: a git-history anchor** (record a commit SHA, verify the policy blob at that commit). This was my first implementation and I built the baseline file for it. I then verified against this repository that `actions/checkout@v4` performs a **shallow clone by default**:

```
$ git clone --depth 1 … && git rev-list --count HEAD
1
$ git cat-file -e 5b841eb…  → anchor NOT available in a depth-1 clone
```

A gate that only works with full history would either fail in CI or force a `fetch-depth` change that trades a real availability property for a weak one. Rejected; the baseline file was deleted rather than left as decoration.

### 4.2 What was adopted

**The floors moved into a data file with no executable behaviour**, and **the assertion is derived from artifacts outside the policy file**:

| Layer | Oracle | What it resists |
|---|---|---|
| **1 — Advisory justification** | `advisories[].patchedIn` inside the policy, recorded independently of `minimum` | A floor lowered while its evidence stays intact |
| **2 — Override agreement** | `pnpm-workspace.yaml` `overrides:` — a *different artifact*, different purpose | An edit to the policy alone |
| **3 — Lockfile agreement** | `pnpm-lock.yaml` `overrides:` — what a `--frozen-lockfile` CI install actually consumes | The full coordinated edit, lowering all three |
| **4 — Coverage** | Every forced package must have a floor, asserted from the **override** side | A floor silently deleted from the policy |
| **5 — Structure** | Strict type/shape validation | Missing, malformed, non-literal, computed values |

Layer 4 is asserted from the override side rather than the policy side for a specific reason: **iterating the policy cannot detect its own deletion.** If the `undici` entry is removed, nothing in the policy remains to complain. Iterating the overrides can, because the remediation is still declared there.

Layer 3 is the decisive layer against a full coordinated edit. When the policy, the workspace overrides *and* the lockfile are all lowered together, the first two agree with each other and every in-file check passes. The lockfile does not agree — and since CI installs with `--frozen-lockfile`, a mismatch means the graph that gets installed is not the graph the policy describes.

### 4.3 What this does NOT claim

This control cannot stop someone who edits the policy, the advisory records inside it, `pnpm-workspace.yaml` **and** `pnpm-lock.yaml` together and reviews the diff carelessly. No in-repository control can: an attacker who can rewrite the policy can rewrite the control.

What it does is make that attack require editing **four independent statements of the same fact** where before it required editing one line — and makes each of the first three individually sufficient to fail. Git review, blame and the hosted run close the remainder. That boundary is stated in the gate's own header rather than left for a future reader to discover, and mutant P10 exists so the boundary is measured rather than assumed.

### 4.4 Fail-closed

Missing file, malformed JSON, non-array `floors`, empty `floors`, non-literal `minimum`, missing `majors`, missing/empty `advisories`, malformed advisory record, duplicate (package, major), unparseable version, absent `overrides`, unparseable lockfile, absent `pnpm-lock.yaml` — **every one is a FAILURE, never a pass.** Both gates refuse to assert against a policy they cannot read.

---

## 5. Files changed

### Created

| File | Purpose |
|---|---|
| `security/dependency-security-floor.json` | The canonical floor policy. Data only, no executable behaviour. Declares, per floor: package, majors, minimum, the advisories it closes with each one's patched version, and the reasoning in prose. |
| `scripts/verify-dependency-floor-policy.mjs` | The independent contract. Five layers; no hard-coded copy of the floors; no network required. |
| `scripts/mutate-dependency-floor-policy.mjs` | Mutation harness for the contract, with setup-failure discrimination and positive controls. |
| `docs/PHASE_37_FINAL_REPORT.md` | This document. |

### Modified

| File | Change | Additive? |
|---|---|---|
| `scripts/verify-dependency-security-floor.mjs` | `FLOORS` constant replaced by `loadFloors()`, which reads the policy file and fails closed on every unreadable shape. All enforcement logic, verdicts and messages unchanged. | Behaviour-preserving refactor |
| `scripts/mutate-dependency-security-floor.mjs` | Mirror now copies the policy file; change-signal and post-condition now include it; D11/D12 repointed at the policy. D11's expectation **inverted** from `pass` to `refuse`. | Yes |
| `.github/workflows/ci.yml` | Two new steps (gate + harness). | **Purely additive — zero lines removed** |
| `scripts/verify-ci-parity.mjs` | Two `REQUIRED_GATES` entries and two `REQUIRED_GATE_IDS` entries. | **Purely additive — zero lines removed** |

### Explicitly NOT changed

`pnpm-lock.yaml` · `pnpm-workspace.yaml` (the Phase 33 overrides are untouched) · `triage-vulnerabilities.mjs` · `verify-dependency-audit.mjs` · `verify-dependency-triage.mjs` · all Prisma schema/migrations · all application source · all historical phase reports · all `SECURITY_REVIEW_*` files.

---

## 6. Mutation results

### 6.1 New harness — `mutate-dependency-floor-policy.mjs`

**13 mutants applied · 11 detected by evaluation · 0 detected by refusing · 2 correctly tolerated · 0 discarded as setup failures.**

| ID | Mutation | Expected | Observed | Attribution |
|---|---|---|---|---|
| CONTROL | unmutated | green | green across 13 checks | control; makes every red attributable |
| P1 | brace-expansion 1.x floor 1.1.21 → 1.1.20 | fail | **DETECTED** | `brace-expansion@1 floor covers advisory 1240100` |
| P2 | brace-expansion 2.x floor 2.1.7 → 2.1.6 | fail | **DETECTED** | `brace-expansion@2 floor covers advisory 1240101` |
| P3 | undici floor 6.28.1 → 6.20.0 | fail | **DETECTED** | `undici@6 floor covers advisory 1240042` |
| P4 | undici floor entry **deleted** | fail | **DETECTED** | `every forced package has a floor` |
| P5 | minimum → `"latest"` (malformed) | fail | **DETECTED** | `minimum is a literal dotted version` |
| P6 | minimum → computed object | fail | **DETECTED** | same literal check, refusing rather than coercing |
| P7 | `advisories` array deleted | fail | **DETECTED** | `advisories is a non-empty array` |
| P8 | CI step deleted from `ci.yml` | fail | **DETECTED** | parity contract: `verify-dependency-floor-policy.mjs` |
| P9 | **coordinated**: floor AND its advisory evidence lowered | fail | **DETECTED** | `override and declared floor state the SAME version` |
| P10 | **coordinated**: floor + advisory + override + lockfile | fail | **DETECTED** | `pnpm-workspace.yaml and pnpm-lock.yaml declare the SAME overrides` |
| P11 | drift: floor raised, override left behind | fail | **DETECTED** | override/floor disagreement |
| P12 | **positive**: legitimate coordinated remediation (floor + advisory + override + lockfile) | pass | **correctly NOT flagged** | adoption guard |
| P13 | **positive**: policy re-serialised, identical content | pass | **correctly NOT flagged** | proves the gate compares meaning, not bytes |

**P9 is the mutant that proves the design.** It is the coordinated edit that the naive "keep a second copy" fix cannot stop. It was **undetected on the first run** of this harness — the honest finding that forced Layer 2 to require *exact* agreement rather than `override ≥ floor`.

**P10 was also undetected on the first run**, which is what forced Layer 3 (the lockfile oracle). Both defects were fixed at the root and re-verified; neither result was scored as evidence before the fix.

**P11 was initially mis-specified by me as a positive control.** Running it proved that wrong: raising a floor without raising the override is genuine drift, and the gate is right to report it. It was reclassified as a detection, with P12 as the legitimate version.

### 6.2 Existing harness — `mutate-dependency-security-floor.mjs`

**12 mutants · 7 required detections, all detected for the intended reason · 4 positive controls correctly tolerated · 1 refused (D11) · 0 discarded.**

D11's expectation **inverted** from `pass` to `refuse`: when the floors lived in the gate source, emptying them was tolerated because nothing could detect it — that unmitigated gap *is* R36-03. The mutant is retained precisely so that inversion cannot silently regress.

### 6.3 Setup-failure discrimination

The new harness classifies outcomes into five states and **never** counts a broken test as a detection: `fail` (evaluated, named finding), `refuse` (declined to evaluate an unevaluable policy), `pass` (legitimate movement), and `setup` (**discarded**). Setup signatures actively hunted: `SyntaxError`, `MODULE_NOT_FOUND`, `Cannot find module`, `ENOENT`, `is not a function`, `YAMLParseError`, and others.

This discipline was exercised rather than asserted. An early P8 run returned `MODULE_NOT_FOUND` because the mirror lacked files the parity contract resolves; the harness **discarded it as a setup failure** rather than counting it as detection of a deleted CI step. The mirror was then completed and P8 re-run to a genuine detection. A separate run failed because the mirror lacked `pnpm-lock.yaml` — the unmutated CONTROL caught it, and all 12 results from that run were discarded rather than scored.

---

## 7. CI / parity integration

### 7.1 Integration

Both new gates are wired into `.github/workflows/ci.yml` as parsed `run:` commands and registered in `REQUIRED_GATES` with backing artefacts and `exactCommand` values:

| Gate id | Command | Artefact |
|---|---|---|
| `p37-floor-policy` | `node scripts/verify-dependency-floor-policy.mjs` | `scripts/verify-dependency-floor-policy.mjs` |
| `p37-floor-policy-mutate` | `node scripts/mutate-dependency-floor-policy.mjs` | `scripts/mutate-dependency-floor-policy.mjs` |

`REQUIRED_GATE_IDS` was extended in step, so the coordinated-edit weakness the reviewer identified as R36-02 is **not** repeated here for the Phase 37 entries.

### 7.2 Verification

| Property | Result |
|---|---|
| Visible in `verify-ci-parity.mjs --list` | Yes — both steps appear in the inventory |
| Required by parity | Yes — `mustMention: ['verify-dependency-floor-policy']` |
| Removal detected | Yes — mutant P8, via the parity contract |
| Arbitrary cwd | `EXIT=0` from `/` and from `/tmp` |
| Empty environment (`env -i`) | `EXIT=0` |
| Hostile `PATH`/`HOME` | `EXIT=0` |
| Harness under `env -i` | `EXIT=0` |
| Targets resolved from `repoRoot` | Yes — the gate derives `repoRoot` from `import.meta.url`; no cwd-relative path anywhere |
| Requires no network | Yes — it runs before any install, so an install failure cannot suppress it |

### 7.3 The Phase 31/32 failure class is not reintroduced

That class was: local parity green, hosted CI red, because a referenced file was in the working tree and absent from the commit. `verify-ci-parity.mjs` detected this **against my own new files** during development:

```
FAILED — 2 CI-parity problem(s):
  - step "Supply chain — the dependency floor policy cannot be weakened (Phase 37 R36-03)"
    … depends on a file that is not committed: `scripts/verify-dependency-floor-policy.mjs` is NOT tracked by git
  - step "Mutation — the floor policy cannot be weakened (Phase 37 R36-03)"
    … `scripts/mutate-dependency-floor-policy.mjs` is NOT tracked by git
```

The P35-2 control caught the new gate exactly as designed. It will clear when the files are committed. Verified in a committed clean-checkout mirror where `verify-ci-parity.mjs --list` exits **0** with all 23 required gates registered and resolvable.

No `continue-on-error`, `|| true`, `set +e`, `if: always`, audit ignore, allow-list, severity change or threshold relaxation was introduced. Verified by inspecting the added lines and by confirming `triage-vulnerabilities.mjs:846` is byte-identical.

---

## 8. Full regression results

All run in this pass. Nothing is reported as green on the basis of a skip.

| Gate / suite | Result |
|---|---|
| `verify-dependency-floor-policy.mjs` | **PASS** (13 checks) |
| `verify-dependency-security-floor.mjs` | **PASS** (3 instances at/above floor) |
| `verify-dependency-audit.mjs` | **PASS** |
| `verify-dependency-triage.mjs` | **PASS** |
| `verify-config-contract.mjs` | **PASS** |
| `verify-env-contract.mjs` | **PASS** |
| `verify-next-config-features.mjs` | **PASS** |
| `verify-next-image-optimizer.mjs` | **PASS** (404 on all three `/_next/image` probes; `/` and `/health` 200) |
| `triage-vulnerabilities.mjs` | **PASS** — no reachable critical/high |
| `verify:metadata` / `verify:routes` | **PASS** / **PASS** |
| `verify:metadata:mutate` / `verify:routes:mutate` / `verify:lifetime:mutate` | **PASS** / **PASS** / **PASS** |
| `mutate-config-contract.mjs` / `mutate-next-config-rewrites.mjs` | **PASS** / **PASS** |
| `mutate-rate-limit-n12.mjs` | **PASS** |
| `mutate-ci-integration.mjs` | **PASS** (24 mutants) |
| `mutate-dependency-security-floor.mjs` | **PASS** (12 mutants) |
| `mutate-dependency-floor-policy.mjs` | **PASS** (13 mutants) |
| `verify:storage:backup` | **PASS** |
| `verify-db-migrations.sh` | **PASS** |
| `verify-release-artifact.mjs --skip-web` | **PASS** (280 files byte-identical across two clean builds) |
| `run-db-suites.mjs` | **PASS** — **138 + 348 = 486 DB-backed tests**, 0 skipped, on a throwaway PostgreSQL that was destroyed |
| API tests | included in the 486 |
| Mobile tests | **PASS** — 34 tests |
| Web tests | **PASS** — 1 test |
| Typecheck (api / mobile / web) | **PASS** / **PASS** / **PASS** |
| Build (api / web) | **PASS** / **PASS** |
| `verify-ci-parity.mjs --list` | **PASS** from a committed clean checkout |

**Not run in this pass:** `verify-docker-images.mjs` and `mutate-container-gate.mjs` (container image builds). These were green at HEAD, are untouched by this phase, and this phase changes no file either gate reads. Recorded as **NOT TESTED** rather than passed.

### Clean-checkout reproducibility

A `git worktree` at HEAD with the Phase 37 changes applied, then a **frozen-lockfile install** (`Lockfile is up to date, resolution step is skipped`, 3.2 s):

```
floor-policy EXIT=0   floor-gate EXIT=0   dep-triage EXIT=0
floor-policy-mutate EXIT=0   floor-mutate EXIT=0   ci-parity --list EXIT=0
```

The worktree has been removed.

---

## 9. Adversarial lower-floor result

The mandatory WS6 test, run in a throwaway mirror.

**Step 1 — lower the floor exactly as R36-03 described** (`1.1.21 → 1.1.20`, `2.1.7 → 2.1.6`, advisory records untouched):

```
[FAIL] brace-expansion@1 floor covers advisory 1240100
[FAIL] brace-expansion override and declared floor state the SAME version
[FAIL] brace-expansion@2 floor covers advisory 1240101
[FAIL] brace-expansion override and declared floor state the SAME version
13 check(s): 9 passed, 4 failed.        EXIT=1
```

On the *same* tree, `verify-dependency-security-floor`, `verify-dependency-triage`, `verify-config-contract` and `verify-ci-parity --list` all still exited **0** — i.e. the exact R36-03 signature persists for the old gates, and **the new gate is the only thing that objects.**

**Step 2 — escalate: also rewrite the advisory evidence** (policy self-consistent):

```
[FAIL] brace-expansion override and declared floor state the SAME version   (×2)
13 check(s): 11 passed, 2 failed.       EXIT=1
```

**Step 3 — escalate further: also lower the pnpm override:**

```
[FAIL] pnpm-workspace.yaml and pnpm-lock.yaml declare the SAME overrides
13 check(s): 12 passed, 1 failed.       EXIT=1
```

All three escalation levels fail closed; the third is caught by the lockfile oracle.

**Step 4 — restore and prove green.** The correct policy and `pnpm-workspace.yaml` were restored and MD5-verified byte-identical to baseline (`ac80e169…`, `656abae0…`), then:

```
verify-dependency-floor-policy   EXIT=0
verify-dependency-security-floor EXIT=0
verify-dependency-triage        EXIT=0
verify-config-contract          EXIT=0
```

**Legitimate coordinated change not falsely rejected:** mutant P12 raises the floor, adds the justifying advisory, and raises the override *and* the lockfile together — a real remediation. The control passes it. Mutant P13 confirms a pure reformat is not a finding.

---

## 10. Integrity checks

### Before / after, on the protected artifacts

| Artifact | Before | After |
|---|---|---|
| `pnpm-lock.yaml` | `ccfa78db…` | **`ccfa78db…` OK — unchanged** |
| `pnpm-workspace.yaml` | `656abae0…` | **`656abae0…` OK — unchanged** (Phase 33 overrides untouched) |
| `scripts/triage-vulnerabilities.mjs` | `6e8a93f3…` | **OK — unchanged** (severity filter intact) |
| `scripts/verify-dependency-audit.mjs` | `4a25b816…` | **OK — unchanged** |
| `scripts/verify-dependency-triage.mjs` | `caed4aa9…` | **OK — unchanged** |
| Prisma schema + 2 migrations | — | **3/3 OK — unchanged** |
| 20 `SECURITY_REVIEW_*` files | — | **20/20 OK — unchanged** |
| 34 historical `docs/*.md` reports | — | **34/34 OK — unchanged** |

The four files that *did* change (`ci.yml`, `verify-ci-parity.mjs`, `verify-dependency-security-floor.mjs`, `mutate-dependency-security-floor.mjs`) were each diffed. For the two CI-contract files, **zero lines were removed — both changes are strictly additive**, so no existing gate can have been weakened by their edit.

### Explicit confirmations

- **Lockfile changed only if genuinely required:** not changed at all.
- **Prisma schema/migrations unchanged:** confirmed by checksum.
- **Application source unchanged:** `git diff HEAD --stat -- apps/ packages/` is empty.
- **Existing dependency gates not weakened:** severity filter intact; all pre-existing dependency gates re-run green.
- **CI gained no suppression:** verified by inspecting added lines.
- **No advisory suppressed, no vulnerable package downgraded, no audit threshold relaxed, no existing gate removed:** confirmed; `git diff` shows additive changes only.
- **Developer `ecc` database untouched:** never targeted. All DB work used throwaway PostgreSQL instances, each destroyed by its own harness; `docker ps -a` shows none remaining.
- **Throwaway containers/databases removed:** confirmed; no `p28`/`artifact`/`migrat` containers remain.
- **No unrelated tracked modification overwritten:** full change set is exactly the 4 modified + 3 new paths.
- **No historical report or security review edited:** 54/54 checksums OK.
- **`SECURITY_REVIEW_PHASE_37.md` was NOT created** — it belongs to the independent reviewer.
- **No commit or push performed.** HEAD remains `199877ae…`, `origin/main` unchanged, nothing staged.

---

## 11. Remaining limitations

1. **Not organizationally independent.** This is an implementation pass, not a review. `SECURITY_REVIEW_PHASE_37.md` does not exist and must be produced by an independent reviewer.
2. **The four-way coordinated edit is not stopped.** An editor who changes the policy, its advisory records, `pnpm-workspace.yaml` and `pnpm-lock.yaml` together, and reviews the diff carelessly, will pass. This is measured by mutant P10 rather than assumed. No in-repository control can prevent it — the party that can rewrite the policy can rewrite the control.
3. **The advisory data is asserted, not verified against the live feed.** `patchedIn` values are recorded in the policy and cross-checked internally and against the two override records. This gate does not query the advisory database, deliberately: it must run offline and before any install. If a recorded `patchedIn` were itself wrong, Layers 2 and 3 would still require the floor, the override and the lockfile to agree on it — but the underlying version claim would be unverified here. `triage-vulnerabilities.mjs` remains the gate that reads live advisory data.
4. **`verify-docker-images.mjs` and `mutate-container-gate.mjs` were not run** (container image builds). Untouched by this phase; recorded as NOT TESTED.
5. **R36-01, R36-02 and R36-04 remain open** and are out of scope here.
6. **The `verify-ci-parity.mjs --list` gate currently reports two untracked-file findings** in the developer tree. This is correct behaviour — it clears on commit. It is not a defect and was not suppressed.
7. **Prior review gaps for Phases 22, 23, 27 (no artifact), 26 (self-reviewed), 32/33/34 (self-reviewed) and 25 (self-endorsed) are unchanged** by this phase.

---

## 12. Statement on readiness

**This phase does NOT establish production readiness.** It does not establish staging readiness, release readiness, or any compliance certification, and it makes no claim about the security of any deployment environment. It addresses exactly one reviewer finding — R36-03 — and the evidence above is limited to the repository and the throwaway mirrors described. No production or staging environment was created or required; no deployment was performed; no pentest was performed.

Whether the change is correct, and whether the residual coordinated-edit limitation is acceptable, is a judgement for the independent reviewer.

---

### Status legend

| Marker | Applied to |
|---|---|
| **VERIFIED** | R36-03 reproduction; all 23 Phase 37 gates and mutation results; WS6 escalation and restoration; clean-checkout reproducibility |
| **REPRODUCED** | R36-03 with a real pnpm-resolved vulnerable graph (all seven gates green) |
| **NOT TESTED** | `verify-docker-images.mjs`, `mutate-container-gate.mjs` |
| **ACCEPTED LIMITATION** | The four-way coordinated edit (measured by P10) |
| **OPEN / OUT OF SCOPE** | R36-01, R36-02, R36-04; prior-phase review gaps |