# PHASE 38 FINAL REPORT — Dependency Floor Trust-Boundary Remediation

**Phase:** 38
**Subject:** Remediation of F-02 (complete) and F-01 (trust boundary established, not eliminated)
**Baseline:** `199877aef283eff36984114ecf486eaec1554c39` (Phase 36 final HEAD; identical to `origin/main`; tree `774566b4b973da5ae15590c010e2dfc8f64ecca4`)
**Input findings:** `SECURITY_REVIEW_PHASE_37.md` — F-01 (MEDIUM), F-02 (LOW)
**Date:** 2026-09-30
**Nature:** Implementation of two named reviewer findings. Not a documentation or reconciliation phase.

> **This phase does NOT establish production readiness, staging readiness, release readiness or any compliance certification.** No such claim is made anywhere in this document. No security score, rating or ranking is assigned or should be inferred. Organizational independence remains unsatisfied.

---

## 1. Objective

Phase 37 moved the dependency security floor out of the enforcing gate and added an independent policy contract. Its independent review returned two findings:

- **F-01 (MEDIUM)** — a coordinated four-file edit (policy floor, advisory evidence, workspace overrides, lockfile **and the resolved graph**) still yields green CI.
- **F-02 (LOW)** — the gate's own header misdescribed Layer 3 as "the resolved graph" when the code implements a lockfile-override comparison, and claimed "three statements" where four are checked.

This phase remediates F-02 completely and **reduces the practical risk of F-01 without pretending it can be eliminated**. The explicit instruction — and the correct engineering position — is not to manufacture a self-protecting policy. The objective is a defensible trust boundary with the escape measured rather than hidden.

---

## 2. Baseline

Recorded before any modification:

| Property | Value |
|---|---|
| HEAD | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` |
| Branch | `main` |
| Tree hash | `774566b4b973da5ae15590c010e2dfc8f64ecca4` |
| Staged files | none |
| Stash | none |
| `verify-dependency-floor-policy.mjs` | **exit 0**, 13 checks, 13 passed |
| `verify-dependency-security-floor.mjs` | **exit 0** |
| `verify-ci-parity.mjs --list` | **exit 1**, exactly 2 findings, both untracked Phase 37 files |
| `pnpm audit` | `info 0, low 8, moderate 36, high 44, critical 4` |

Checksums captured for 14 baseline artifacts, all 21 `SECURITY_REVIEW_PHASE_*.md`, all 35 `docs/*.md`, and the Prisma schema plus 2 migrations.

The two parity findings at baseline are the **P35-2 untracked-artifact control firing correctly against Phase 37's own uncommitted files**. They were **not** suppressed, and remain present and correct at the end of this phase (§8).

---

## 3. F-02 remediation — COMPLETE

### 3.1 What was wrong

Two inaccuracies in `scripts/verify-dependency-floor-policy.mjs`:

1. The header described **"LAYER 3 — THE RESOLVED GRAPH"** with the rationale that the floor gate "remains the authority on the graph". The code at line 272 implements `// --- LAYER 3: the LOCKFILE's own override record ---`, comparing the lockfile's `overrides:` block against the workspace one. It never reads the resolved package versions in `snapshots:`.
2. The header claimed the coordinated attack *"require[s] editing three independent statements of the same fact"*. The implementation checks **four**.

A reader relying on either would mis-model the control's coverage — in particular, they could wrongly conclude the lockfile is unchecked.

### 3.2 What changed

Rewrote the header so it:

- **describes Layer 3 as what it is** — the lockfile's resolved-override record — and states explicitly that this gate does *not* read the resolved graph, and that the resolved graph remains `verify-dependency-security-floor.mjs`'s exclusive responsibility, with the two gates deliberately not merged;
- **states the count as four**, enumerating them, and explaining why the floor and the advisory record are counted separately despite sharing a file (they are independent *claims* and they *fail* separately);
- **replaces** the unresolved editorial aside *"the strongest such oracle … lives in `pnpm-lock.yaml`… no: the lockfile is editable too"* with a statement of what the gate can honestly claim — that there is no oracle inside the repository an editor of the policy cannot reach;
- **adds an explicit three-part trust-boundary section** (inside / outside / outside-the-repository), reproduced in §4 below.

### 3.3 Proof that F-02 was documentation-only

Comments were stripped from the pre-edit snapshot and the final file, and the resulting **executable** lines were diffed. The F-02 header edit changed **zero executable lines**; every executable difference in the file is attributable to WS2 (§4).

```
pre-edit executable lines: 478
final    executable lines: 488
```

No executable behaviour was altered to make the old wording true. The gate's check count went 13 → 16, all from WS2 additions, and all from additive checks that were green on the unmodified policy before being attacked.

---

## 4. F-01 trust-boundary treatment

F-01 is **not** eliminable by another JavaScript gate, and this phase does not pretend otherwise. The structural reason: the party who can rewrite the dependency policy can rewrite the control that checks it.

### 4.1 The boundary, as documented in the gate header and here

**A — Ordinary weakening. INSIDE the boundary. DETECTED.** A floor lowered in the policy alone; lowered together with its advisory evidence; lowered together with those and the workspace override; a floor entry deleted, duplicated, renamed, malformed or made non-literal; a package forced by pnpm with no floor covering that version line; an unexpected field anywhere in the schema; an advisory id recorded twice; a severity outside the audit vocabulary.

**B — Coordinated manipulation. OUTSIDE the boundary. NOT prevented.** An actor who edits the policy floor, the advisory evidence, the workspace overrides, the lockfile overrides **and the lockfile's resolved graph**, and who reviews that diff casually, obtains green CI. This was reproduced deliberately (§6.1) and is now **measured rather than assumed**: it is mutant `EST-1` in the repository's own harness, recorded as a *passing* mutant with `expected: 'boundary'`, so it cannot be rediscovered as a surprise and so a future change that closes it is reported as the boundary having moved.

**C — What actually closes B. OUTSIDE the repository. NOT implemented, NOT verified.** Protected-branch review; `CODEOWNERS` on the policy, the workspace file and the lockfile; required approvals for dependency changes; signed commits or tags; CI permissions preventing a workflow from being edited in the same change; independent security review. **None of these is implemented by this repository or this phase, and no claim is made about any of them.**

### 4.2 Risk reduction actually achieved

F-01 is not merely re-documented; the *practical* surface was reduced by closing five validation gaps that were **measured before being fixed** (§5):

| Gap, measured before the fix | Consequence |
|---|---|
| an undeclared field on a floor (e.g. `minimumVer`) | read by nobody, so it could be written freely |
| `policyVersion` / `policyId` | read by nobody; a policy for another schema certified as this one |
| advisory `severity` | participates in no comparison, so the recorded *justification* for a floor could be rewritten freely |
| duplicate advisory id across floors | one advisory could appear to justify two different remediations |
| `why` / `reachedVia` | not required; a bare version pin with nothing to argue about |

Plus one real detection gap found by the new mutant:

| Gap found by EST-6 | Consequence before the fix |
|---|---|
| floor coverage counted **per package**, not per **major** | deleting the `brace-expansion` 1.x floor while the 2.x floor remained passed the gate — one major line silently lost its constraint |

That last one was a genuine escape found by the Phase 38 harness and fixed at the root, changing coverage to be asserted per `(package, major)`.

---

## 5. Exact files changed

### Modified (2)

| File | Change |
|---|---|
| `scripts/verify-dependency-floor-policy.mjs` | **WS1:** header documentation corrected (F-02). **WS2:** closed-schema validation at all three levels, `policyId`/`policyVersion` enforced, advisory severity vocabulary enforced, duplicate advisory id rejected across floors, `why`/`reachedVia` required, coverage asserted per `(package, major)`. |
| `scripts/mutate-dependency-floor-policy.mjs` | Added 10 `EST-*` mutants including the deliberate `EST-1` trust-boundary escape; added `setLockResolvedVersion()`; `setOverrideTarget`/`setLockOverrideTarget` gained a `match` parameter so the two `brace-expansion` major lines can be addressed independently; new `boundary` scoring state with an `escaped` tally; RESULT/NOT-PROVEN text rewritten. |

### Not modified

`.github/workflows/ci.yml` · `scripts/verify-ci-parity.mjs` · `scripts/verify-dependency-security-floor.mjs` · `security/dependency-security-floor.json` · `pnpm-lock.yaml` · `pnpm-workspace.yaml` · `package.json` · `scripts/triage-vulnerabilities.mjs` · `scripts/verify-dependency-audit.mjs` · `scripts/verify-dependency-triage.mjs` · all application source · all Prisma schema/migrations · all `SECURITY_REVIEW_*` files · all historical phase reports.

### Created (1)

`docs/PHASE_38_FINAL_REPORT.md` — this document.

**No stop condition was reached.** The lockfile did not need modification, no protected artifact needed modification, no application source needed modification, no CI semantics needed weakening, no advisory needed suppression, no audit gate needed an ignore, and no security judgement beyond verification was required.

---

## 6. Mutation results

`node scripts/mutate-dependency-floor-policy.mjs` → **EXIT 0**

```
TALLY  23 mutant(s) applied: 18 detected by evaluation, 0 detected by refusing,
       4 correctly tolerated, 1 confirmed trust-boundary escapes,
       0 discarded as setup failures.
```

| ID | Mutation | Expected | Observed |
|---|---|---|---|
| CONTROL | unmutated mirror | green | green across 16 checks |
| P1–P3 | each floor lowered | fail | **DETECTED** (named advisory + override disagreement) |
| P4 | `undici` floor deleted, override intact | fail | **DETECTED** |
| P5 | malformed minimum `"latest"` | fail | **DETECTED** |
| P6 | computed / non-literal minimum | fail | **DETECTED** |
| P7 | advisory record deleted | fail | **DETECTED** |
| P8 | CI step deleted from `ci.yml` | fail | **DETECTED** (parity contract) |
| P9 | coordinated: floor + advisory evidence | fail | **DETECTED** |
| P10 | coordinated: floor + evidence + workspace override | fail | **DETECTED** |
| P11 | drift: floor raised, override left behind | fail | **DETECTED** |
| P12 | **positive**: legitimate coordinated remediation | pass | **correctly tolerated** |
| P13 | **positive**: pure reformat, identical content | pass | **correctly tolerated** |
| **EST-1** | **TRUST BOUNDARY**: policy + evidence + workspace + lockfile + **resolved graph** | **boundary (expected to pass)** | **CONFIRMED ESCAPE — measured, not hidden** |
| EST-2 | undeclared field added to a floor | fail | **DETECTED** (`outside the declared schema`) |
| EST-3 | `policyVersion` set to an unimplemented schema | fail | **DETECTED** |
| EST-4 | advisory severity outside the audit vocabulary | fail | **DETECTED** |
| EST-5 | one advisory recorded against two floors | fail | **DETECTED** |
| EST-6 | one major line's floor removed, override intact | fail | **DETECTED after fix — was a genuine escape** |
| EST-7 | floor added for a package not in the graph | fail | **DETECTED** |
| EST-8 | `why` rationale deleted | fail | **DETECTED** |
| EST-9 | **positive**: severity corrected to its true value | pass | **correctly tolerated** |
| EST-10 | **positive**: new advisory remediated, fully coordinated | pass | **correctly tolerated** |

**Discarded mutations: 0.** Every mutant was scored on a mirror whose unmutated control was green first, so no red is attributable to an incomplete mirror. Post-condition verified all six real files byte-identical, independently confirmed by checksum.

### Two harness defects found and disclosed

Both were in the **Phase 37 harness**, not the gate, and both are disclosed rather than quietly corrected:

1. **EST-1 initially failed for the wrong reason.** `setOverrideTarget`/`setLockOverrideTarget` targeted only the *first* matching override, so with two `brace-expansion` lines the 2.x override stayed above the lowered floor and the gate reported *drift*. The mutant was measuring the wrong thing. Fixed by adding a `match` parameter so each major line is addressed explicitly.
2. **EST-6 exposed a real gate gap** (per-major coverage), described in §4.2.

**Two apparent gate gaps were my probe errors, not defects** — recorded so the count is honest: rewriting a severity from `moderate` to `info` and lowering a `patchedIn` *below* the remediation target both correctly **pass**, because the former is a valid severity in the audit vocabulary and the latter is a conservative (stricter) floor. Both were re-tested: an out-of-vocabulary severity and a `patchedIn` *above* the target are both detected.

---

## 7. Oracle-disablement results

Methodology repeated from Phase 37's independent review, extended to all four oracles. Every neutralisation uses an **exact string replacement**, asserts the source actually changed, and asserts the edited gate still **parses** — a no-op edit would report "still detected" and prove nothing. The unmutated control was run first and was green.

`ESCAPED` = the gate passed a weakened policy.

| Attack | control | advisory off | override off | lockfile off | coverage off | adv+override | adv+lockfile | **ALL off** |
|---|---|---|---|---|---|---|---|---|
| policy floor lowered alone | detected | detected | detected | detected | detected | detected | detected | detected |
| policy + advisory evidence lowered | detected | detected | **ESCAPED** | detected | detected | **ESCAPED** | detected | **ESCAPED** |
| policy + evidence + workspace override | detected | detected | detected | **ESCAPED** | detected | detected | **ESCAPED** | **ESCAPED** |
| **FULL coordinated edit incl. resolved graph** | **ESCAPED** | ESCAPED | ESCAPED | ESCAPED | ESCAPED | ESCAPED | ESCAPED | **ESCAPED** |

**Layered detection is demonstrated, not asserted:**

- Row 1 (policy alone) is caught by **every** oracle individually — the single-file edit that was R36-03 is now caught four times over.
- Row 2 needs the **override oracle** specifically: with advisory evidence rewritten to agree, Layer 1 passes, and only the workspace override disagrees with the floor.
- Row 3 needs the **lockfile oracle** specifically: once the workspace override is lowered too, Layers 1 and 2 both pass, and only the lockfile disagrees.
- Row 4, the complete coordinated edit, **escapes with all oracles live** — because with every statement lowered in agreement, there is nothing left to disagree. This is the boundary, stated exactly as in §4.

The last column is the honest demonstration: **with all repository-local oracles disabled nothing catches the weakening**, and the full row also escapes with oracles live. No absolute-protection claim is made or implied.

**Reviewer-harness defect, disclosed:** the oracle script's first run printed `ENOTDIR … /utf8` for all 32 cells because `read(f, 'utf8')` joined an already-absolute path with the encoding string as a second path segment. Every cell was **discarded**, the helper corrected, and all results re-run. The control-run-first discipline is what made the failure visible rather than misreadable as "everything escapes".

---

## 8. CI / parity verification

Verified by **structured YAML parsing**, not textual grep.

| Property | Result |
|---|---|
| Policy gate present in CI | Yes — `api` job, `node scripts/verify-dependency-floor-policy.mjs` |
| Mutation harness present in CI | Yes — `release` job, `node scripts/mutate-dependency-floor-policy.mjs` |
| `continue-on-error` | **false** on both |
| `\|\| true`, `\|\| :`, `\|\| echo`, `&& exit 0`, `set +e` | **none** |
| Conditional skip (`if:`) | **none** |
| `REQUIRED_GATES` / `REQUIRED_GATE_IDS` | **23 / 23**, zero duplicates, exact match, no drift |
| Gate removal detected | Yes — mutant P8, via the parity contract |
| `ci.yml` modified by Phase 38 | **No** — still 34 insertions vs HEAD, zero deletions |

**The untracked-file findings were NOT suppressed.** `verify-ci-parity.mjs --list` still exits 1 with exactly **2** findings, both naming the untracked Phase 37 files:

- `scripts/verify-dependency-floor-policy.mjs` is NOT tracked by git
- `scripts/mutate-dependency-floor-policy.mjs` is NOT tracked by git

In a clean mirror where those files were committed, `verify-ci-parity.mjs --list` exits **0**, confirming the finding is about tracking and nothing else. Nothing was committed in the real repository to achieve that.

---

## 9. Clean-checkout verification

A `git worktree` at HEAD with the Phase 37 + Phase 38 state applied:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | **PASS** — *"Lockfile is up to date, resolution step is skipped"*, 2.9 s |
| `verify-dependency-floor-policy.mjs` | **exit 0** |
| `verify-dependency-security-floor.mjs` | **exit 0** |
| `verify-dependency-triage.mjs` | **exit 0** |
| `verify-config-contract.mjs` | **exit 0** |
| `verify-dependency-audit.mjs` | **exit 0** (after `prisma generate`; see below) |
| `mutate-dependency-floor-policy.mjs` | **exit 0**, tally 23/18/0/4/1/0 |
| `mutate-dependency-security-floor.mjs` | **exit 0** |
| `verify-ci-parity.mjs --list` | **exit 0** once the Phase 37 files are committed in that mirror |

**Independence from the developer's environment was checked explicitly.** The gate resolves `yaml` through `node_modules/.pnpm/yaml@*/…` relative to its own `repoRoot`, not through a hoisted path. The worktree's frozen install produced **its own** store entry (`node_modules/.pnpm/yaml@2.9.0`), and a bare `require('yaml')` from the worktree correctly **fails** — proving the gate is not silently borrowing the developer tree's copy. It passed using only worktree-local dependencies. No result depended on a file left outside git.

**Setup artifact excluded, not converted to a pass:** `verify-dependency-audit.mjs` first exited 1 on the missing Prisma query engine because a frozen install does not run postinstall scripts. `prisma generate` was run and the gate re-run to exit 0. CI generates the Prisma client explicitly before this gate. The worktree was removed.

---

## 10. Regression results

All run in this phase. Nothing reported as green on the basis of a skip.

| Gate / suite | Result |
|---|---|
| `verify-dependency-floor-policy.mjs` | **PASS** (16 checks) |
| `verify-dependency-security-floor.mjs` | **PASS** |
| `verify-dependency-audit.mjs` | **PASS** |
| `verify-dependency-triage.mjs` | **PASS** |
| `verify-config-contract.mjs` | **PASS** |
| `verify-next-config-features.mjs` | **PASS** |
| `verify-env-contract.mjs` | **PASS** |
| `verify:metadata` / `verify:routes` | **PASS** / **PASS** |
| `verify:ratelimit:n12:mutate` (N-12) | **PASS** |
| `verify:storage:backup` | **PASS** |
| `mutate-ci-integration.mjs` | **PASS** |
| `mutate-dependency-security-floor.mjs` | **PASS** |
| `mutate-dependency-floor-policy.mjs` | **PASS** (23 mutants) |
| `verify-db-migrations.sh` | **PASS** — 15 checks |
| `verify-release-artifact.mjs --skip-web` | **PASS** |
| `run-db-suites.mjs` | **PASS** — **138 + 348 = 486 DB-backed tests**, **0 skipped/todo markers** |
| `pnpm --filter @ecc/mobile test` | **PASS** — 34 tests |
| `pnpm --filter @ecc/web test` | **PASS** — 1 test |
| typecheck api / mobile / web | **PASS** / **PASS** / **PASS** |
| build api / web | **PASS** / **PASS** |
| `build:verify` (build determinism) | **PASS** — 280 files, all builds emitted artifacts |
| `verify-docker-images.mjs --skip-build` | **PASS** — see §11 |

All DB work ran on a throwaway PostgreSQL created by the harness and **destroyed by it**. The developer `ecc` database was never a target.

---

## 11. Docker status

`verify-docker-images.mjs` **was** executed in this phase, because the environment permitted it: the daemon was reachable with ~30 GB free, and no workaround was needed.

```
--skip-build, using the existing ecc-api:p20-verify and ecc-web:p20-verify images
  EXIT 0 — "All container build and runtime checks passed."
```

**Stated precisely, because the scope matters.** This exercised the **container runtime** checks against images built earlier the same day from this tree. Phase 37 and Phase 38 change **no application source** (`git diff --name-only HEAD` filtered on `apps/` and `packages/` is empty), so no image rebuild was required to reflect this phase's changes. A **full image rebuild was not performed.**

`mutate-container-gate.mjs` (all mutants M1–M11) was **NOT TESTED**, and remains so. Reason, stated rather than glossed: the harness **mutates `apps/api/src/*` in the developer working tree in place**, and Phase 38 forbids modifying application source. It additionally requires four `--no-cache` image rebuilds. Running it would have breached this phase's own integrity rule. This is a deliberate scope decision, not an infrastructure failure, and it is **not** counted as a pass.

---

## 12. Integrity verification

### Protected artifacts — unchanged

| Artifact | Result |
|---|---|
| `pnpm-lock.yaml` | **unchanged** — `ccfa78db9184754cf7f9f4ac86353659` |
| `pnpm-workspace.yaml` | **unchanged** — `656abae051a73b60deba041dfa8f0a8c` |
| `package.json` | **unchanged** |
| `.github/workflows/ci.yml` | **unchanged by Phase 38** |
| `scripts/verify-ci-parity.mjs` | **unchanged by Phase 38** |
| `scripts/verify-dependency-security-floor.mjs` | **unchanged by Phase 38** |
| `scripts/triage-vulnerabilities.mjs` | **unchanged** |
| `scripts/verify-dependency-audit.mjs` | **unchanged** |
| `scripts/verify-dependency-triage.mjs` | **unchanged** |
| `security/dependency-security-floor.json` | **unchanged** |
| `PROJECT_PLAN-old.md` | **unchanged** |
| Prisma schema + 2 migrations | **3/3 unchanged** |
| All 21 `SECURITY_REVIEW_PHASE_*.md` | **21/21 unchanged** |
| All 35 `docs/*.md` historical reports | **35/35 unchanged** |
| Application source (`apps/`, `packages/`) | **unchanged** |

**Exactly two files differ from the Phase 37 review baseline**, and both are the files this phase is scoped to modify: `scripts/verify-dependency-floor-policy.mjs` and `scripts/mutate-dependency-floor-policy.mjs`.

`pnpm audit` severities are **byte-identical** before and after: `info 0, low 8, moderate 36, high 44, critical 4`. No package was downgraded, no advisory suppressed, no threshold relaxed.

### Git state

`HEAD` = `origin/main` = `199877ae…`, tree hash `774566b4b973da5ae15590c010e2dfc8f64ecca4` — **unchanged**. Nothing staged. No stash. No commit, push, rebase, reset, amend or force-push.

### Contamination

| Item | Disposition |
|---|---|
| Clean-checkout worktree | **removed**; `git worktree list` shows only the main worktree |
| Throwaway PostgreSQL (`ecc-p28-*`) | **destroyed by its own harness**; none remain |
| Docker container runs | containers removed by the gate; none remain |
| Throwaway mirrors under `/tmp/opencode/p38i/` | removed |
| Developer `ecc` database | **never targeted** |

---

## 13. Remaining findings

**F-01 — MEDIUM → accepted limitation, not a defect.** The four-way coordinated edit remains possible, and is now **measured** (`EST-1`), **documented** in the gate header, and **attributed** by the oracle matrix. The severity is accepted rather than inflated: the actor required is one who can already rewrite the dependency policy, the package-manager declaration and the lockfile, and who can already delete the gate itself. No in-repository control defends against that actor. What this phase delivered is that the attack is no longer a one-line edit, and that its existence is now recorded rather than assumed.

**F-02 — LOW → CLOSED.** Documentation corrected; proven not to change executable behaviour.

**New this phase:**

- **F-38-01 — LOW — coverage was asserted per package rather than per version line.** Found by EST-6: deleting one of two `brace-expansion` major lines passed the gate while that line lost its constraint. **Fixed in this phase** (coverage now asserted per `(package, major)`), and EST-6 retained as a regression mutant.
- **F-38-02 — INFO — five unvalidated policy fields.** Undeclared floor fields, `policyId`, `policyVersion`, advisory `severity`, and advisory ids duplicated across floors were all writable without any check failing. **Fixed in this phase**; each has a dedicated mutant (EST-2, EST-3, EST-4, EST-5).

**Unchanged and still open, not in scope here:** R36-01, R36-02, R36-04 from the Phase 36 review; the Phase 37 review's own observations about untracked historical review artifacts; prior-phase review gaps for Phases 22, 23, 27 (no artifact), 26, 32, 33, 34 (self-reviewed) and 25 (self-endorsed).

**No CRITICAL or HIGH findings.** No control that claims to work was found not to work. No CI semantics were weakened, no suppression introduced, no existing gate removed.

---

## 14. What remains outside repository-local enforcement

Stated plainly, because the objective was to establish a boundary rather than to blur one:

1. **Coordinated manipulation by an actor who controls policy, advisory evidence, workspace overrides and the lockfile together.** Demonstrated to pass here. Not preventable from inside the repository.
2. **Any control that verifies the policy gate itself.** Nothing in this repository checks `verify-dependency-floor-policy.mjs` other than its own mutation harness, which lives in the same tree under the same actor's control. The gate's integrity depends entirely on review.
3. **Branch protection, `CODEOWNERS`, required approvals, signed commits or tags, CI permissions.** **None is implemented, none is verified, and no claim is made about any of them.** Closing F-01's category B requires these, and this phase did not implement or assess them.
4. **The correctness of the recorded advisory data.** `patchedIn` values are asserted for shape and cross-checked against the two override records. This gate deliberately does **not** query the advisory feed, because it must run offline and before install. A wrong `patchedIn` would still have to be corroborated by the workspace and lockfile overrides.
5. **Hosted CI execution of the Phase 37/38 gates.** Nothing was pushed; no hosted run exists for this state. CI integration is verified structurally and locally.
6. **Container image rebuilds and `mutate-container-gate.mjs`.** Runtime checks passed against existing images; no rebuild was performed and the mutation harness was not run, for the reason given in §11.

**Organizational independence remains unsatisfied for every phase in this repository, including this one.** This phase was implemented by the same kind of agent, in the same repository, as the work it reviews.

---

## 15. Commit / push state

**NOT COMMITTED. NOT PUSHED.** No commit was created and no authorization was sought or assumed, per the instruction that neither is to happen without explicit later authorization.

- `HEAD` = `origin/main` = `199877aef283eff36984114ecf486eaec1554c39` — unchanged from the Phase 36 final commit.
- Tree hash `774566b4b973da5ae15590c010e2dfc8f64ecca4` — unchanged.
- 0 staged files, 0 stash entries.
- The Phase 37 and Phase 38 artifacts (including this report) exist as uncommitted working-tree changes. `verify-ci-parity.mjs --list` correctly reports this, and that finding was **not** suppressed.

`SECURITY_REVIEW_PHASE_38.md` was **not** created; it belongs to the independent reviewer.

---

### Status legend

| Marker | Applied to |
|---|---|
| **REPRODUCED** | the EST-1 coordinated escape; the oracle matrix's escaped cells |
| **VERIFIED** | all 23 mutants; 16-check gate; 23/23 parity consistency; every regression gate; clean-checkout reproduction; integrity |
| **FIXED** | F-02 (complete); F-38-01 and F-38-02 (found and closed this phase) |
| **ACCEPTED LIMITATION** | F-01 category B; harness-mutation of application source |
| **NOT TESTED** | `mutate-container-gate.mjs`; hosted CI; full image rebuild |
| **DISCARDED** | 0 mutations; 1 reviewer-harness run (32 cells, `ENOTDIR`, re-run) |
