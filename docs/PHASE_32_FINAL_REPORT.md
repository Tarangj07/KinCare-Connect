# PHASE 32 — HOSTED CI REMEDIATION AND RELEASE-GATE RESTORATION

**Phase:** 32 — Hosted CI remediation and release-gate restoration
**Type:** CI / release-assurance remediation. **Not** a feature phase, **not** a general security-hardening phase.
**Date:** 2026-09-30
**Commit:** `abe8d7816a72d35638edf8b16cf9e086fa83afa5` (pushed to `origin/main`)
**Hosted run:** [`36671794473`](https://github.com/Tarangj07/KinCare-Connect/actions/runs/36671794473)
**Predecessor:** `4ddc0b5` — hosted run [`36618193752`](https://github.com/Tarangj07/KinCare-Connect/actions/runs/36618193752) (**FAILED**)

> **This phase does not claim the system is production ready, staging ready, or release ready.**
> **CI is NOT green.** Two of the two Phase 31 CI failures are fixed and verified on a hosted
> runner; a third, previously-masked, genuine supply-chain failure now blocks one job. That
> failure is recorded, not worked around. See §10, §14, §15.

---

## 1. Objective

Restore the repository's ability to execute its committed GitHub Actions workflow successfully on
a clean hosted runner, by fixing the root causes of the two failures in hosted run `36618193752`
and by making the CI contract able to detect that class of defect. No production-readiness claim
is made or implied.

---

## 2. Phase 31 failures reproduced

Phase 31 was not taken on trust. Both failures were re-derived from the hosted run and reproduced
locally before any change was made.

| Phase 31 finding | Reproduced? | Evidence |
|---|---|---|
| **P31-1** — `4ddc0b5` has a failing hosted run | **Yes** | `gh run view 36618193752` → `failure`; jobs `API` and `Release` red |
| **P31-2** — committed workflow invokes uncommitted scripts | **Yes** | `git cat-file -e 4ddc0b5:scripts/run-db-suites.mjs` → absent; same for `verify-storage-backup-restore.mjs`, `mutate-rate-limit-n12.mjs`; `apps/api/package.json` at `4ddc0b5` has neither `verify:storage:backup` nor `verify:ratelimit:n12:mutate` |
| **P31-3** — committed config-contract gate fails on `PATH`/`HOME` | **Yes** | Runner log: `` `PATH` is read by scripts/mutate-ci-integration.mjs but is documented in no template. `` (same for `HOME`) |
| **P31-4** — N-12 rate-limit fix uncommitted | **Yes** | `git show 4ddc0b5:apps/api/src/auth/guards/rate-limit.guard.ts` → `throw new ForbiddenException(...)` (403) |
| **P31-5** — parity contract "cannot detect resolvability" | **Yes, but the finding is WRONG — see §3** | the committed contract *does* detect it; it was never reached |

**Runner evidence for the release-job failure (verbatim):**
```
[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a "verify:storage:backup" script
##[error]Process completed with exit code 1.
```

---

## 3. Root causes

### 3.1 Root cause A — the committed workflow referenced artifacts that were never committed *(FIXED)*

`ci.yml` (committed) invoked three Phase 28/29 scripts and two `package.json` entries that existed
only in the working tree. The `release` job therefore died on its first Phase 28 step and skipped
its remaining 13 steps.

**Fixed** by committing all five artifacts (§4). The N-12 mutation harness can only assert that the
429 contract is load-bearing *if the 429 contract exists*, so the Phase 28 N-12 change it guards is
committed with it. That is the authorisation the maintainer gave; it is the one place this phase
touches protected application source, and it is itemised in §12 and §15.

### 3.2 Root cause B — an unnecessary `PATH`/`HOME` dependency in a mutation harness *(FIXED)*

`scripts/mutate-ci-integration.mjs` spawned its child with
`env: { PATH: process.env.PATH, HOME: process.env.HOME, … }`. The child is launched by **absolute
interpreter path** (`process.execPath`) and `--list` executes nothing, so it needs neither.
Forwarding them made that file *read* `PATH` and `HOME`; `verify-config-contract.mjs` correctly
reported both as undocumented environment reads and failed the `api` job on every runner.

**Fixed at the root cause, not by relaxing the assertion.** Verified: `verify-ci-parity.mjs --list`
runs correctly under `env -i` (empty environment), and the three N-12 suites run under `env -i`.
The harnesses now resolve their targets from `repoRoot` and spawn with no inherited environment.
`apps/api/src/.../mutate-rate-limit-n12.mjs` was changed from `pnpm exec vitest` (a `PATH` lookup)
to an absolute interpreter running an absolute, `repoRoot`-relative vitest entry point.

**`scripts/verify-config-contract.mjs` is byte-identical to `4ddc0b5`.** The working-tree
`PATH`/`HOME` allowlist entries that existed before this phase were **deliberately reverted and not
committed.** The dependency was removed rather than the security gate relaxed.

Regression proof — re-introducing the old line reproduces the exact hosted failure, and removing it
resolves it:
```
regressed:  FAILED — 2 configuration problem(s):  - `PATH` is read by scripts/mutate-ci-integration.mjs …
restored:   EXIT=0
```

### 3.3 Ordering defect — the contract ran after the steps it governs *(FIXED)*

**This corrects Phase 31's P31-5.** Running the committed parity contract against the committed
tree (an extraction of `4ddc0b5`, not the working tree) shows the contract **already detected all
three missing artifacts and reported them precisely**, exiting 1:

```
FAILED — 3 CI-parity problem(s):
  - the required gate `verify:ratelimit:n12:mutate` (p28-n12-mutate) cannot run: the package script
    `verify:ratelimit:n12:mutate` is not defined in `apps/api/package.json`. The workflow invokes it,
    so the step would fail on the runner. …
  - the required gate `verify:storage:backup` (p28-storage-backup) cannot run: …
  - the required gate `run-db-suites.mjs` (p28-db-suites) cannot run: the script it runs,
    `scripts/run-db-suites.mjs`, does not exist. …
```

The contract was never reached: the broken step sat *earlier* in the job than the contract step, so
the run died on the symptom and the diagnosis was never produced. Phase 31 concluded from a
working-tree run that the contract "cannot detect resolvability"; that inference was incorrect. The
accurate statement is: **the contract validates the tree it executes in, and it was never given the
chance to run.**

**Fixed** by moving the contract step to immediately after `pnpm install` in the `release` job, so a
broken contract is reported as a contract failure. The step is not weakened, not made advisory, and
not duplicated.

---

## 4. Files changed

One commit, `abe8d78`, 17 files, +2061 / −38.

| File | Change | Why |
|---|---|---|
| `.github/workflows/ci.yml` | CI contract step moved to the top of the `release` job | §3.3 |
| `apps/api/package.json` | add `verify:storage:backup`, `verify:ratelimit:n12:mutate` | §3.1 |
| `scripts/verify-storage-backup-restore.mjs` | **new** (was untracked) | §3.1 |
| `scripts/mutate-rate-limit-n12.mjs` | **new** (was untracked) + deterministic invocation | §3.1, §3.2 |
| `scripts/run-db-suites.mjs` | **new** (was untracked) | §3.1 |
| `apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts` | **new** (was untracked) | N-12, authorised |
| `apps/api/src/auth/guards/rate-limit.guard.ts` | 403 → 429 + `Retry-After` | N-12, authorised |
| `apps/api/src/common/filters/global-exception.filter.ts` | set `Retry-After` for 429 only | N-12, authorised |
| `apps/api/src/auth/guards/rate-limit.guard.spec.ts` | tests for the 429 contract | N-12, authorised |
| `apps/api/test/rate-limit.http.e2e-spec.ts` | **new** (was untracked) e2e spec | N-12, authorised |
| `apps/mobile/src/services/api.ts` | 429 no longer deletes the session | N-12, authorised |
| `apps/mobile/src/services/api.spec.ts` | tests: token survives a 429 | N-12, authorised |
| `apps/api/scripts/verify-compiled-auth.mjs` | `isRateLimited` accepts 429 **and** 403 | required: committed predicate accepted only 403 |
| `scripts/verify-docker-images.mjs` | asserts 429 + `RATE_LIMITED` + positive `Retry-After`; adds converse check that a real authorization refusal is still 403 with **no** `Retry-After` | required: committed check asserted 403 and would break under 429 |
| `scripts/mutate-container-gate.mjs` | mutants M8–M11 for the N-12 properties | adversarial proof of the new container assertions |
| `scripts/verify-ci-parity.mjs` | resolvability + committed-ness of **every** step | §6 |
| `scripts/mutate-ci-integration.mjs` | drop `PATH`/`HOME`; mirror copies the package manifests the contract now reads | §3.2, §6 |

**Deliberately not committed:** `scripts/verify-config-contract.mjs` (reverted; the security gate is
unchanged), `pnpm-lock.yaml`, `apps/api/prisma/**`, `apps/web/**`, every historical phase report,
every `SECURITY_REVIEW_*`, and `PROJECT_PLAN-old.md`.

---

## 5. CI contract changes

`scripts/verify-ci-parity.mjs` gained two checks that run over **every** step, not only the declared
required gates:

1. **Resolvability.** For each step, resolve what the command actually needs and report what cannot
   be found. `pnpm --filter <pkg> <script>` → the script must exist in that package's manifest, and
   each file token in its body must exist relative to the package. `node`/`bash`/`sh` → the
   interpreter's first non-flag operand must exist, relative to the segment's working directory.
2. **Committed-ness.** A target that exists on disk but is **not tracked by git** is reported, because
   that is the exact condition that let local parity report green while the committed tree could not
   run. Skipped when the script runs outside a git work tree, where the property is not checkable and
   claiming it would be false.

Design constraints honoured: structured resolution via the existing `yaml` parse (not string
matching); `pnpm --filter <pkg>` correctly sets the working directory to the package; multi-line
`run: |` blocks are split so a standalone `cd` is honoured; job-generated build output
(`dist/`, `build/`, `.next/`, …) is recognised as produced-in-job and never required to be
committed; shell globs are excluded. The check is skipped for `pnpm exec` / `pnpm install`, which
resolve a binary rather than a declared script.

---

## 6. Mutation testing

**14 assertions, 14 correct.** Run against throwaway mirrors of the staged tree built from the git
index; the real repository was never written to.

| # | Attack | Expected | Result |
|---|---|---|---|
| A1 | remove the workflow step invoking a Phase 28 gate | detected | **DETECTED** (exit 1) |
| A2 | remove the package script the workflow invokes | detected | **DETECTED** |
| A3 | rename the target file, package script not updated | detected | **DETECTED** |
| A4 | rename the package script, workflow not updated | detected | **DETECTED** |
| A5 | point the package script at a nonexistent target | detected | **DETECTED** |
| A6 | add `\|\| true` to a required gate step | detected | **DETECTED** |
| A7 | add `set +e` to a required gate step | detected | **DETECTED** |
| A8 | hide the command behind `if false` | detected | **DETECTED** |
| A9 | required target present on disk but not committed | detected | **DETECTED** |
| A10 | remove a Phase 28 required gate (N-12 mutation) | detected | **DETECTED** |
| A11 | remove a Phase 29 required gate (CI-integration mutation) | detected | **DETECTED** |
| A12 | make the contract's result depend on cwd | no dependence | **PROVEN** — identical output from repo root, `/tmp`, `/` |
| A13 | make the contract's result depend on `PATH`/`HOME` | no dependence | **PROVEN** — identical under empty and hostile env |
| C1 | **control**: a committed, fully coordinated rename | not flagged | **CLEAN** (exit 0) |

11 weakening attacks, all detected. Two independence properties proven. One positive control confirms
a legitimately coordinated rename (file + package script + contract + workflow) is **not** falsely
flagged — rejecting a correct refactor would train people to stop renaming rather than to keep gates
wired.

`scripts/mutate-ci-integration.mjs` was additionally re-run: **20 mutants, 20 detected**, positive
control `C21` (coordinated rename) correctly not flagged, 0 false negatives, 0 false positives, and
all six real files asserted byte-identical afterwards.

**Harness defect found and fixed during this work.** The first mutation-harness run applied its
attacks to the real repository because the mirror was rebuilt without changing the shell's working
directory. Three working-tree files were modified. They were restored from the git index in the same
session, verified byte-identical to the staged content, and the harness was rewritten with a
`cd`-into-mirror guard and a path assertion that refuses to run against a non-mirror path. No
committed or protected file was affected, and no mutation leaked into the commit. This is recorded
because a harness that can escape its sandbox cannot be trusted with anyone else's tree.

---

## 7. Clean-checkout verification

A genuine clean checkout was built from the git index into an empty directory, made into a real git
work tree, and given a **real** `pnpm install --frozen-lockfile` (1m 12s). It contained no
developer `.env`, no `node_modules` symlink, no pre-existing `dist`, no Phase 25–31 untracked
artifacts, and no developer database or container.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | **PASS** (real install, no developer state) |
| `verify-ci-parity.mjs --list` | **PASS** |
| `verify-config-contract.mjs` | **PASS** (unmodified gate) |
| `verify-env-contract.mjs` | **PASS** |
| `prisma generate` → `typecheck` → `build` | **PASS** |
| `verify:metadata`, `verify:routes` | **PASS** |
| `verify:storage:backup` (Phase 28) | **PASS** |
| `verify:ratelimit:n12:mutate` (Phase 28) | **PASS** |
| `mutate-ci-integration.mjs` (Phase 29) | **PASS** |
| `build:verify` (determinism) | **PASS** |
| `verify-db-migrations.sh` | **PASS** (own throwaway container only) |
| `verify-release-artifact.mjs` | **PASS** |
| `run-db-suites.mjs` (throwaway PG) | **PASS** — 8 files/138 tests + 27 files/348 tests |
| `verify-docker-images.mjs` | **PASS** — incl. both N-12 assertions |
| web build, web tests, mobile tests, mobile typecheck | **PASS** |
| lint | **55 errors / 69 warnings** — baseline held exactly |

**Failures encountered and classified** (per the brief's taxonomy, not silently called environmental):

| Failure | Classification | Detail |
|---|---|---|
| `typecheck`/`build` failed: `Module '"@prisma/client"' has no exported member 'CircleRole'` | **test-harness defect (mine)** | I had not replicated the CI step order. `ci.yml` runs `prisma generate` before `typecheck`. Re-run in CI order: PASS. No repository defect. |
| `prisma validate` exit 1, "undefined" | **environment prerequisite** | The gate needs `DATABASE_URL`, which the `api` job supplies in its `env:` block. With CI's value: PASS. No repository defect. |

---

## 8. Local regression results

All run sequentially where they share `apps/api/dist` (L-3). Exact counts, nothing skipped and
reported as passing.

| Gate | Result |
|---|---|
| `verify-config-contract.mjs` | PASS |
| `verify-env-contract.mjs` | PASS |
| `verify-dependency-triage.mjs` | PASS |
| `verify-next-config-features.mjs` | PASS |
| `verify-decorator-metadata` | PASS (59 DTO identity checks) |
| `verify-route-authorization` | PASS |
| `build:verify` | PASS (280 files in `dist`) |
| `verify-db-migrations.sh` | PASS |
| `verify-release-artifact.mjs` | PASS (70 modules 1:1; 2969 web files; byte-identical rebuilds) |
| `verify-docker-images.mjs` | PASS |
| `verify-ci-parity.mjs --list` | PASS |
| `mutate-ci-integration.mjs` | PASS (20/20 mutants) |
| `mutate-rate-limit-n12.mjs` | PASS (all N-12 protections load-bearing; negative control genuinely blind; source restored byte-for-byte) |
| `verify-storage-backup-restore.mjs` | PASS (22 checks) |
| `run-db-suites.mjs` | PASS — e2e 8 files/138 tests; unit+integration 27 files/348 tests; **0 skipped** |
| API unit + e2e suites | covered by `run-db-suites.mjs` (486 tests total) |
| web tests | 1 file / 1 test (pre-existing gap, blocker `R-3`, unchanged) |
| mobile tests | 6 files / 34 tests |
| typecheck | 11/11 tasks |
| build (api + web) | PASS |
| **lint** | **124 problems (55 errors, 69 warnings) — baseline held exactly; no new debt** |
| `triage-vulnerabilities.mjs` | **FAIL — see §10, §14** |

---

## 9. GitHub Actions run ID

| Field | Value |
|---|---|
| Run | **`36671794473`** |
| Commit | `abe8d7816a72d35638edf8b16cf9e086fa83afa5` |
| URL | https://github.com/Tarangj07/KinCare-Connect/actions/runs/36671794473 |
| Started | 2026-09-30T05:05:34Z |
| Duration | ~5m 28s |

---

## 10. Final CI status

**`failure` — 4 of 5 jobs green. CI is NOT green.**

| Job | `36618193752` (`4ddc0b5`, before) | `36671794473` (`abe8d78`, after) |
|---|---|---|
| **Release** — migrations, release artifacts, security regression sweeps | **failure** | **success** ✅ |
| **API** — typecheck, tests, build | **failure** | **failure** ❌ (different step) |
| Containers | success | success |
| Web | success | success |
| Mobile | success | success |

**Both Phase 31 root causes are fixed and verified on the hosted runner:**

- The **`release` job is now green.** It was the failing job. It runs, on real GitHub hardware,
  the storage backup/restore gate, the N-12 mutation, the DB-suite driver, the CI contract, and the
  CI-integration mutation — steps that previously failed or were skipped.
- **API job step 15 "Configuration contract" now passes** on the runner. Root cause B is fixed.
  It failed in `36618193752`; it passes in `36671794473`.

**The API job now fails at step 17**, which was previously masked because step 15 failed first:

```
step 14. Compiled artifact — every non-public route is guarded …   success
step 15. Configuration contract — env, ports, versions, secrets …  success   ← was failing before
step 16. Supply chain — lockfile, native modules, engines …         success
step 17. Supply chain — no reachable critical/high advisory …      FAILURE  ← previously never reached
step 18+ (18 steps)                                                skipped
```

```
2026-09-30T05:06:40Z FAILED — 5 critical/high advisory/ies are reachable and need a decision before release.
2026-09-30T05:06:40Z ##[error]Process completed with exit code 1.
```

The exact 5, all transitive, none a direct dependency, no `pnpm.overrides` configured:

| Severity | Package | Prod paths | Patched in |
|---|---|---|---|
| high | `brace-expansion@1.1.18` (2 advisories) | 13/100 | `>=1.1.19` |
| high | `brace-expansion@2.1.4` (2 advisories) | 8/28 | `>=2.1.5` / `>=2.1.6` |
| high | `undici@6.28.0` | 1/1 | `>=6.28.1` |

`brace-expansion` arrives via `minimatch`; `undici` via `@remix-run/node` → `@expo/server` →
`expo-router` → `@ecc/mobile`. All three patched versions are available in the registry.

**This is a pre-existing condition that restoring the pipeline made visible, not a regression
introduced by this phase.** The same step **passed** in all three earlier green runs
(`36558509809`, `36559104224`, `36559541316`, all 2026-09-29 ~10:55–11:05Z). The advisory feed moved
in the intervening ~18 hours: `pnpm audit` now reports **53** advisories where Phase 30/31 recorded
48. This is blocker `E-11` — recorded in Phase 30 as "the 48-advisory classification is only as
current as its last run" — becoming real.

**Not worked around.** No `|| true`, no `continue-on-error`, no entry added to
`EXPLICIT_BUILD_TIME_PACKAGES`, no triage rule written, no dependency bumped, no lockfile change.
The gate is a gate; it failed, so CI is red. See §14 for why remediation was not attempted.

---

## 11. Commit SHA

| Field | Value |
|---|---|
| Commit | `abe8d7816a72d35638edf8b16cf9e086fa83afa5` |
| Parent | `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` |
| Subject | `phase(32): restore hosted CI — commit the Phase 28/29 gates it required` |
| Files | 17 (+2061 / −38) |
| `HEAD == origin/main` | yes, `0 0` divergence |
| Pushed | yes, `4ddc0b5..abe8d78  main -> main` |
| Amended / rebased / force-pushed | **no** |

---

## 12. Protected-artifact integrity

All checksums identical to the pre-flight values taken before any change:

| Artifact | Pre-flight | Now | Result |
|---|---|---|---|
| `pnpm-lock.yaml` | `5af2c8991d97ce696fba011c12d9d3ce` | same | **unchanged** |
| `apps/api/prisma/schema.prisma` | `4452c2a2cd00dc683930e164d6ec5a9c` | same | **unchanged** |
| `apps/api/prisma/migrations/**` | — | 0 changes | **unchanged** |
| `PROJECT_PLAN-old.md` | `e6174a55f1ead572fa2c847248f061f7` | same | **unchanged** |
| `SECURITY_REVIEW_*` (tracked set) | `84b7065871c04e8977ebe97dab2093af` | same | **unchanged** |
| `docs/PHASE_*` historical reports | `9248760cf20337c0ad627d5e36e0f7ca` | same | **unchanged** |
| `apps/web/**` | — | 0 files | **unchanged** |
| `scripts/verify-config-contract.mjs` | `4ddc0b5` | byte-identical | **security gate unchanged** |
| Developer `ecc` database | — | 37 tables, 2 migrations, 14 users | **intact** |

**The one authorised protected change** is the N-12 set in `apps/api/src/**` and
`apps/mobile/src/services/api.ts`, listed in §4. What it does **not** do: it does not change
authentication semantics, authorization semantics, DTO validation, ValidationPipe settings, the
rate-limit threshold (10), the window (15 min), the per-IP key, the refusal condition, or the
production-proof bypass rule. It changes the status a throttled client observes (403 → 429), adds a
`Retry-After` computed from the real window, and stops the mobile client deleting the session on a
throttle. `scripts/verify-docker-images.mjs` additionally asserts the **converse** — a genuine
authorization refusal is still `403 FORBIDDEN` with **no** `Retry-After` — and mutant `M11` proves
that a "fix" implemented by widening every 4xx to 429 is caught.

**Environment event, not caused by this phase.** The host restarted during the final verification
(uptime 10 minutes; all four long-running containers share one `StartedAt`). No Phase 32 command
restarts the Docker daemon or those containers. The developer database and its contents are intact
and no throwaway infrastructure leaked. Recorded for completeness rather than as a phase action.

---

## 13. Uncommitted / unrelated work preserved

Twelve untracked paths, all pre-existing Phase 25–31 artifacts, **none committed, none modified**:

```
SECURITY_REVIEW_PHASE_25.md   SECURITY_REVIEW_PHASE_26.md   SECURITY_REVIEW_PHASE_28.md
SECURITY_REVIEW_PHASE_30.md   SECURITY_REVIEW_PHASE_31.md   docs/PHASE_27_FINAL_REPORT.md
docs/PHASE_28_FINAL_REPORT.md docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md
docs/PHASE_30_FINAL_REPORT.md docs/PHASE_30_RECONCILIATION.md docs/PHASE_30_SPEC.md
docs/RELEASE_READINESS.md
```

`SECURITY_REVIEW_PHASE_31.md` is the previous phase's deliverable and is **not** a Phase 32 change,
so it is left uncommitted. `SECURITY_REVIEW_PHASE_32.md` was **not** created — it is reviewer-owned.

All temporary infrastructure was removed: both clean-checkout trees, the mutation-harness mirror,
`/tmp/opencode/p32/*` scratch, and every throwaway PostgreSQL container and volume the gates created.
The one pre-existing container this phase could not attribute (`pg-pgtest` on `127.0.0.1:55432`,
recorded as `P31-10`) was left alone; it holds no application schema.

---

## 14. Remaining blockers

### 14.1 New — the supply-chain gate (this is why CI is red)

**Blocker `P32-1`. Severity: HIGH. OPEN. Not worked around.**

5 critical/high advisories in `brace-expansion@1.1.18`, `brace-expansion@2.1.4` and
`undici@6.28.0` are reachable from production dependency paths and carry no recorded triage
disposition. The gate demands a decision "before release" and fails closed.

**Remediation was deliberately not attempted, because both available routes are outside the
authority this phase was given, and one is explicitly listed as a stop condition:**

| Route | Consequence | Authority needed |
|---|---|---|
| Bump the transitive dependencies (e.g. `pnpm.overrides` for `brace-expansion >=1.1.19` / `>=2.1.5` and `undici >=6.28.1`) | changes `package.json` **and regenerates `pnpm-lock.yaml`**; may pull in new transitive advisories | **Stop condition: "dependency changes appear necessary".** Phase 32 WS7: "alter the lockfile unless dependency resolution genuinely requires it" |
| Hand-triage each advisory — add a reachability rule, or an `EXPLICIT_BUILD_TIME_PACKAGES` entry with a written, checkable reason | a **security judgement** about whether the vulnerable code is on a deployed path | The gate itself warns: *"Do not resolve this by adding the package to EXPLICIT_BUILD_TIME_PACKAGES unless the reason written there is one a reviewer can check."* This is a supply-chain security decision, and Phase 32 is explicitly "NOT a general security-hardening phase" |

The `next@14.2.35`, `tar@6.2.1`, `multer@2.0.2`, `postcss`, `image-size`, `@xmldom/xmldom` and
`turbo-stream` advisories that also show production paths are **not** in the failing set: existing
source-traced rules already dispose of them, some with built-artefact evidence (for example, that no
`use server` directive exists and the built `server-reference-manifest.json` has empty `node`/`edge`
maps, so there is no Server Function endpoint to attack). That machinery works; it simply has no rule
yet for these three packages.

**This is a real supply-chain finding and should be triaged as one.** It is not a CI defect and not an
environment prerequisite.

### 14.2 Inherited — unchanged and still open

| Item | Status |
|---|---|
| `E-9` hosted CI for the current tree | **CHANGED IN CHARACTER, not closed.** A run now exists (`36671794473`) and is `failure`. Previously the blocker was "no run has occurred"; it is now "the current tree is verified-red on a supply-chain gate". |
| `E-11` live dependency advisory set | **MATERIALISED.** No longer hypothetical: the drift is now a concrete, reproducible CI failure. Recommended reclassification from `EXTERNAL` to a live, in-repo gate failure. |
| `R-1` independent review of Phases 22, 23, 25, 26, 27 | **OPEN**, 5 gaps. Not closable by this phase and not attempted. |
| `E-1`…`E-8`, `E-10` staging, TLS, production deployment, pen test, compliance, managed PG/object storage, observability, backup automation, production-scale load | **OPEN.** Untouched. |
| `R-2`…`R-6`, `A-1`…`A-5` | **OPEN.** `R-3` (web test coverage: 1 test) unchanged and re-verified. |
| Phase 31's `P31-9`…`P31-14` documentation and assurance-integrity findings | **OPEN.** Not addressed; this phase touched no documentation claims. |

---

## 15. Security impact

**Net: one security control strengthened, one security gate left red rather than silenced.**

- **Strengthened.** A throttled client now receives a truthful `429` and a `Retry-After` derived from
  the real window, instead of a `403` indistinguishable from an authorization failure. The mobile
  client no longer discards a valid session because the user was throttled. Both properties are
  mutation-proven at source level, container level (M8–M11) and end-to-end.
- **Gate integrity preserved.** `verify-config-contract.mjs` is byte-identical to `4ddc0b5`. The
  dependency gate was **not** relaxed; it failed and CI is red because of it. No `|| true`, no
  `continue-on-error`, no `set +e`, no allowlist entry, no triage rule authored to make a number
  smaller.
- **CI contract materially stronger.** It can now detect an unresolvable or uncommitted CI target, and
  it runs before the steps it governs. 11 of 11 weakening attacks detected; a legitimate coordinated
  rename still passes.
- **New exposure identified, not concealed.** 5 reachable critical/high advisories were surfaced by
  restoring the pipeline. Suppressing them would have converted a red CI into a green CI while
  hiding a genuine supply-chain risk — the precise failure mode this repository's own Phase 29
  contract was built to prevent.

**Phase 31 discovery recorded, as required:**

- *Local green did not imply hosted green.* The committed tree could not run its own workflow while
  every local gate passed, because the local run evaluated the working tree, not the commit.
- *The hosted runner exposed dependency on uncommitted artifacts.* Three scripts and two package
  entries existed only locally; the `release` job failed on a script the repository did not contain.
- *The fix is now committed and CI-enforced.* All five artifacts are in `abe8d78`, the CI contract
  resolves and committed-ness-checks every step's target, it runs first in the job, and a
  regression is a CI failure rather than a silent local divergence.

---

## 16. What is still NOT proven

Green CI, had it been achieved, would have proven none of the following. It was not achieved, and
none of it is claimed.

- **Staging deployment** — no staging environment exists. Never has.
- **Production deployment** — nothing has ever been deployed to any environment.
- **Production TLS** — no certificate, no proxy, no `sslmode` anywhere in the repository or images.
- **Production observability** — no metrics, alerting, log aggregation, tracing or disk monitoring.
- **Production-scale load / soak** — only a bounded 50-concurrent smoke test. No capacity claim.
- **Penetration testing** — none, internal or external.
- **Compliance certification** — no BAA, risk analysis, SOC 2 opinion or ISO certification. The
  repository makes no compliance claim and none is made here.
- **Production-volume backup/restore** — 3 database rows and 8 storage files, local filesystems.
  Automation, encryption, retention, off-host storage and scheduling remain absent.
- **Production readiness** — **not claimed, and not supported.** This repository is not
  production-ready and not staging-ready.
- **Independent review of Phases 22, 23, 25, 26, 27** — still absent; 5 open gaps.
- **That the local and hosted results are equivalent** — they are not, and this phase is the proof.
  Local green coexisted with a red hosted run on the same commit for a full phase before it was found.
- **That this phase's remediation is independently reviewed** — it is not.
  `SECURITY_REVIEW_PHASE_32.md` was deliberately not created.

---

## 17. Exact exit-criteria checklist

| # | Criterion | Status |
|---|---|---|
| 1 | Exact Phase 31 hosted CI failures fixed at root cause | **MET** — `36618193752` re-derived and reproduced; A and B fixed at root cause |
| 2 | Every CI-referenced script/file/package command exists in the committed tree | **MET** — contract resolves all 50 step commands with 0 problems |
| 3 | `verify-ci-parity.mjs` validates the workflow contract structurally | **MET** — §5 |
| 4 | `PATH`/`HOME`/cwd behaviour deterministic | **MET** — proven identical from 3 cwds, empty env, hostile env |
| 5 | Mutation tests prove the new checks are load-bearing | **MET** — 14/14 assertions, 11/11 attacks detected |
| 6 | Clean-checkout verification passes | **MET** — real frozen-lockfile install, 16 gates incl. Docker |
| 7 | Full local regression passes | **PARTIAL** — 20 of 21 gates pass; `triage-vulnerabilities.mjs` fails (§14.1) |
| 8 | No test silently skipped and reported as passing | **MET** — exact counts reported; 0 skipped in DB suites |
| 9 | Lint no worse than 55E/69W | **MET** — 55 errors / 69 warnings, exact |
| 10 | A real GitHub Actions run executes against the Phase 32 commit | **MET** — run `36671794473` on `abe8d78` |
| 11 | All required CI jobs pass | **NOT MET** — 4/5. `API` red on a genuine supply-chain blocker |
| 12 | Final run ID and commit SHA recorded | **MET** — `36671794473`, `abe8d78` |
| 13 | No protected artifact unintentionally modified | **MET** — §12; the one authorised change is itemised |
| 14 | No unrelated work committed | **MET** — 17 files, all Phase 32; 12 untracked artifacts preserved |
| 15 | No security control weakened | **MET** — config gate byte-identical; dependency gate left red, not silenced |
| 16 | No staging/production readiness claim made | **MET** — §16 |
| 17 | `docs/PHASE_32_FINAL_REPORT.md` exists and accurately records the work | **MET** — this document; CI is reported as **failure** |
| 18 | `SECURITY_REVIEW_PHASE_32.md` not created by the implementer | **MET** — not created |

**16 of 18 met. Criterion 11 is not met, and criterion 7 is partial, both because of one blocker
(`P32-1`) that this phase has no authority to close and did not attempt to hide.**

---

*Phase 32 verification against `abe8d7816a72d35638edf8b16cf9e086fa83afa5`. No schema, migration,
lockfile, `apps/web` file, historical phase report, `SECURITY_REVIEW_*` artifact, or
`verify-config-contract.mjs` was modified. One commit, one normal push; no amend, rebase or
force-push. CI for this commit is red and is reported as red.*
