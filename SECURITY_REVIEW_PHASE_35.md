# SECURITY_REVIEW_PHASE_35.md

**Review of:** Phases 32 and 33, plus the Phase 34 self-audit of those phases
**Repository:** `KinCare-Connect` (`https://github.com/Tarangj07/KinCare-Connect.git`)
**Repository `HEAD`:** `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17`
**`origin/main`:** `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` (identical to `HEAD`, divergence `0 0`)
**Branch:** `main`
**Date:** 2026-09-30
**Nature:** Independent verification only. No remediation performed, none proposed as done.

---

## 1. Independence and Scope

### 1.1 Reviewer independence statement

| Question | Answer |
|---|---|
| Did I implement Phase 32? | **No.** I did not author any code, workflow, lockfile, or report in this repository. |
| Did I implement Phase 33? | **No.** Same. |
| Am I the author of `SECURITY_REVIEW_PHASE_34.md`? | **No.** |
| Did I rely on any Phase 32/33/34 report as proof? | **No.** Every material claim below was re-derived from source, lockfile, Git history, GitHub Actions logs, and reproducible execution. Reports are treated as untrusted claims throughout. |
| Is this independent of the material under review? | **Yes in attribution. No in organisational terms** — see the limitations below. |

### 1.2 Independence limitations (stated up front, not buried)

- I operate on the same host, the same working tree, the same Docker daemon, and the same GitHub
  credentials as the implementation. There is **no separation of duties, no second signature, and no
  chain of custody outside this repository**.
- Git records a single commit identity for every commit (`Ecc Bootstrap <noreply@example.com>`), so
  **Git metadata cannot establish** who implemented what. My independence claim rests on the
  disclosure in §1.1 and on the fact that I re-derived the evidence rather than reading it from the
  reports — not on any machine-checkable provenance.
- Reachability dispositions beyond the `next` and `tar` criticals were verified by **mechanism
  inspection and sampling**, not individually re-derived one by one. That limit is preserved
  wherever it applies and is not collapsed into a blanket claim.
- Staging, production, TLS, observability, load, penetration testing and compliance are outside my
  reach. Absence is asserted from the repository and this host, not from a hosting provider.

### 1.3 Review scope

Reviewed: Phase 32 (CI recovery, committed missing CI artifacts, `verify-config-contract` PATH/HOME
issue, CI contract target resolution, mutation coverage, hosted CI recovery); Phase 33 (`pnpm.overrides`
remediation, lockfile regeneration, advisory reduction, dependency reachability, clean-install
reproducibility, hosted CI green result, preservation of security controls); and the Phase 34
self-audit's conclusions including P34-1, P34-5, its advisory counts, its CI state, its claimed N-12
verification, its reachability analysis and its integrity claims.

### 1.4 Implementation commits reviewed

| Commit | Subject | Phase |
|---|---|---|
| `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` | `phase(29): checkpoint CI integration and release assurance` | predecessor; the commit that broke CI |
| `abe8d7816a72d35638edf8b16cf9e086fa83afa5` | `phase(32): restore hosted CI — commit the Phase 28/29 gates it required` | **Phase 32** |
| `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` | `phase(33): remediate reachable dependency advisories (P32-1) via pnpm overrides` | **Phase 33** |

### 1.5 Actions explicitly NOT taken

No commit, push, force-push, rebase, reset, amend or stash. No modification of application source,
`pnpm-lock.yaml`, the Prisma schema or migrations, CI, or any dependency gate. No modification of any
historical report or any pre-existing `SECURITY_REVIEW_*` file. Exactly one file was created:
`SECURITY_REVIEW_PHASE_35.md`. All attack mirrors, checkouts and servers were created outside the
repository and are enumerated in §9.

> **No staging, production, or production-readiness claim is made anywhere in this document.** A
> green CI run is evidence that a commit builds and passes its own gates on GitHub-hosted runners.
> It is not a readiness, security, or compliance certification.

---

## 2. Repository State

Captured before substantive work and re-verified after (§9). All values identical.

| Item | Value |
|---|---|
| Branch | `main` |
| `HEAD` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| `origin/main` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` (divergence `0 0`) |
| Staged files | 0 |
| Tracked modifications | 0 |
| Stash count | 0 |
| Reflog top | `5b841eb commit: phase(33): remediate reachable dependency advisories…` |
| Git index hash | `e85ee8e4adc00ed07e6c86eabf465336a77070463dbcb6c90f01e70df1b0a359` |
| Working-tree content hash (tracked + untracked) | `8fbb5631eb4cd7f5f120c6cd8f3ed4e701c8c2893dcc56cc5162d0fb9a903de6` |

### Protected artifact checksums (SHA-256, before → after)

| Artifact | Before | After | Result |
|---|---|---|---|
| `pnpm-lock.yaml` | `7fa75d7c…018b0a8` | identical | **UNCHANGED** |
| `pnpm-workspace.yaml` | `19fe8f43…c69a609a16c` | identical | **UNCHANGED** |
| `package.json` | `1f62d7c4…44134450698` | identical | **UNCHANGED** |
| `.github/workflows/ci.yml` | `6f23ebdd…d7e29af5` | identical | **UNCHANGED** |
| `scripts/triage-vulnerabilities.mjs` | `cbe4794f…0b59fd57` | identical | **UNCHANGED** |
| `scripts/verify-dependency-audit.mjs` | `50103071…a2203771` | identical | **UNCHANGED** |
| `scripts/verify-dependency-triage.mjs` | `6f163fdb…8b4478` | identical | **UNCHANGED** |
| `scripts/verify-config-contract.mjs` | `2083d659…b684d9` | identical | **UNCHANGED** |
| `scripts/verify-ci-parity.mjs` | `2f01d1de…f0508b` | identical | **UNCHANGED** |

---

## 3. Phase 32 Verification

### 3.1 Reconstructing the Phase 31 → Phase 32 failure — CONFIRMED from hosted logs

I downloaded the full step logs for run `36618193752` (not just the job summary) and read the
failures directly.

**Run `36618193752` — `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` — `failure`, 5 jobs, 2 failed.**

*Root cause A — `release` job.* The `Storage backup` step (step 11) failed:

```
[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a "verify:storage:backup" script
##[error]Process completed with exit code 1.
```

I confirmed the underlying condition from the commit itself, not from the report. At `4ddc0b5`:

```
$ git show 4ddc0b5:apps/api/package.json | node -e "...Object.keys(scripts).filter(/storage|ratelimit|n12/)"
[]                                    # verify:storage:backup and verify:ratelimit:n12:mutate both absent
$ ls scripts/ | grep -E "storage|run-db-suites|mutate-rate"
                                    # no output — all three scripts absent from the committed tree
```

*Root cause B — `api` job.* An **independently located** failure. The `Configuration contract` step
(step 15) failed with the gate correctly reporting two undocumented environment reads:

```
FAILED — 2 configuration problem(s):
  - `PATH` is read by scripts/mutate-ci-integration.mjs but is documented in no template. …
  - `HOME` is read by scripts/mutate-ci-integration.mjs but is documented in no template. …
```

**Two genuinely independent root causes — CONFIRMED.** They are in different jobs, on different
axes: one is a *committed-tree completeness* failure (`release`), the other is a *harness
environment-dependency* failure (`api`). Neither is a symptom of the other, and fixing either alone
would not have produced a green run — proven by run `36671794473` below, which fixed A and B and
still failed on a third, unrelated axis.

**Exact failing-step ordering — CONFIRMED.** In the `release` job the `Storage backup` step is
number **11** and the `CI contract` step is number **19**. Everything from 12 onward is recorded
`skipped`. So the contract step never executed. This is precisely the ordering defect Phase 32
claimed, and I confirmed it from the runner's own step numbering rather than from the report.

### 3.2 The Phase 31 `P31-5` claim was wrong — CONFIRMED

The Phase 29 contract *could* already detect the missing artifacts; it simply never ran. I verified
this by extracting `4ddc0b5` to a directory outside the repository and running its own committed
contract against its own committed tree:

```
$ node scripts/verify-ci-parity.mjs --list     # at 4ddc0b5, against the 4ddc0b5 tree
FAILED — 3 CI-parity problem(s):
  - the required gate `verify:ratelimit:n12:mutate` (p28-n12-mutate) cannot run: the package script
    `verify:ratelimit:n12:mutate` is not defined in `apps/api/package.json`. …
  - the required gate `verify:storage:backup` (p28-storage-backup) cannot run: … not defined …
  - the required gate `run-db-suites.mjs` (p28-db-suites) cannot run: the script it runs,
    `scripts/run-db-suites.mjs`, does not exist. …
EXIT=1
```

All three missing artifacts named precisely. The diagnosis existed; the ordering prevented it from
running. **CONFIRMED.**

### 3.3 The committed tree at HEAD satisfies every CI command — CONFIRMED

I did not rely on filenames. I resolved every `node`/`bash`/`sh` first-operand and every
`pnpm --filter <pkg> <script>` referenced by the committed `ci.yml`, and separately confirmed the
gate's own resolver agrees:

| Check | Result |
|---|---|
| `node scripts/verify-ci-parity.mjs --list` at `HEAD` | `EXIT=0` — "Workflow structure is sound: 47 of 50 commands can run locally" |
| `verify:storage:backup` package script | defined in `apps/api/package.json` at `HEAD`, target `../../scripts/verify-storage-backup-restore.mjs` tracked |
| `verify:ratelimit:n12:mutate` package script | defined, target tracked |
| `scripts/run-db-suites.mjs` | tracked |
| `apps/api/scripts/verify-compiled-auth*.mjs` | tracked (invoked after `cd apps/api`, so they resolve from the package) |
| `scripts/verify-env-contract.mjs` via `pnpm --filter … exec` | tracked (resolves from the package cwd) |

The four items above that a naive root-relative parse reports as missing are all false positives of
naive parsing, exactly as the resolver's `--filter`-aware cwd modelling predicts. I confirmed each by
hand rather than taking the resolver's word.

### 3.4 `verify-config-contract.mjs` was NOT relaxed — CONFIRMED

```
$ git diff 4ddc0b5 5b841eb --stat -- scripts/verify-config-contract.mjs
(empty)
```

Byte-identical across the whole of Phases 32 and 33. I read the gate's semantics, not just its hash:
`readEnvVars()` strips comments before scanning, then matches `process.env[…]`, `process.env.…`, and
destructured forms, and any variable read-but-undocumented is a failure. There is **no PATH/HOME
allow-list entry** anywhere in the file (the only allow-list is two `BROWSERSLIST_*` build-tooling
variables at lines 213–214, pre-existing and unrelated). The gate is a genuine "read but undocumented
⇒ fail" check and it was left that way.

### 3.5 The `PATH`/`HOME` dependency was removed, not suppressed — CONFIRMED

`scripts/mutate-ci-integration.mjs` now spawns its child with `env: { CI: '1', FORCE_COLOR: '0' }` —
neither `PATH` nor `HOME` is forwarded. Grepping the *executable* code for either variable returns
**zero matches**; the only occurrences are inside a `//` comment block at lines 602–614 explaining why
they are not forwarded. `scripts/mutate-rate-limit-n12.mjs` likewise has zero executable
`process.env['PATH'|'HOME']` reads (the one textual occurrence is inside a comment).

### 3.6 `verify-ci-parity.mjs` — independently attacked

I read all 990 lines and then executed it under four environments.

| Execution context | Exit | Output SHA-256 |
|---|---|---|
| repository root | 0 | `500e6ceb…b9edf` |
| `/tmp` (unrelated cwd) | 0 | `500e6ceb…b9edf` |
| `/` (filesystem root) | 0 | `500e6ceb…b9edf` |
| `env -i` (empty environment) | 0 | `500e6ceb…b9edf` |
| `env -i HOME=/nonexistent PATH=/usr/bin:/bin` (hostile) | 0 | `500e6ceb…b9edf` |

**Byte-identical output in all five.** cwd-independence and environment-independence:
**CONFIRMED**.

Contract properties, each verified against the source:

| Property | Verdict | Evidence |
|---|---|---|
| Resolves package scripts correctly | **CONFIRMED** | `gateTargetProblem()` / `resolvabilityProblem()` read `pkgDir/package.json` and `Object.hasOwn(scripts, …)`; `pnpm exec`/`install`/`dlx` are deliberately not matched as scripts (`filterScriptOf`) |
| Resolves direct script targets | **CONFIRMED** | `fileTokensOfScript()` walks the package script body to its file operand, so renaming the backing file is caught even when the script entry survives |
| Detects missing files | **CONFIRMED** | reproduced live at `4ddc0b5` (§3.2), three artifacts named |
| Detects existing-but-untracked files | **CONFIRMED** | `untrackedTargetProblem()` shells out to `git ls-files -z` and reports a target that is absent from the index; it correctly declines to invent a verdict outside a work tree |
| cwd-independent | **CONFIRMED** | `repoRoot` is derived from `import.meta.url`, never from `process.cwd()`; proven empirically |
| PATH/HOME-independent | **CONFIRMED** | `--list` executes nothing and resolves `yaml` from the pnpm store; proven under `env -i` |
| Does not merely prove a shell string exists | **CONFIRMED** | gate matching is a **whitespace-token** match on the *parsed* `run` command with shell comments stripped first, plus an `exactCommand` equivalence check for the five gates that take flags. `verify:metadata:mutate` does not satisfy `verify:metadata` |

Two honest limits of the resolver, which I note and do not overstate: it is static and
interpreter-first-operand-only (so `exec` chains, `$(…)` and glob-expanded operands are outside its
model), and it deliberately treats a coordinated rename as acceptable (correctly — see §3.7 C21).

### 3.7 Phase 32 mutation harness — independently re-run

I executed `node scripts/mutate-ci-integration.mjs` at `HEAD`. It mutates throwaway copies only and
asserts the real files are byte-identical at the end. **Result: `EXIT=0`, 21 mutants, 20 DETECTED,
1 correctly NOT detected (positive control), all 22 mirrors removed, all post-conditions `ok`.**

I did not accept exit codes. For each mutant I checked that (a) the mutation was actually applied —
the harness prints `[N file(s) changed]` or `[1 file(s) changed + 1 rename]` — and (b) the failure
message is the *security condition*, naming the gate, the reason, and the consequence. I inspected
the reported reason for every mutant. Representative mapping to the properties under test:

| Requested property | Mutant | Applied? | Failed for the intended reason? | Verdict |
|---|---|---|---|---|
| missing artifact (step deleted) | C1–C5 | yes | "the gate `verify:storage:backup` (p28-storage-backup) is not wired into CI as a step command" | **VALID** |
| untracked artifact | C18 | yes | "the package script … is not defined in `apps/api/package.json`" | **VALID** (package-script form; see note) |
| wrong target | C6 | yes | gate not satisfied after the CI command rename | **VALID** |
| package-script target | C7–C9 | yes | gate ID enumerated as missing from the contract | **VALID** |
| coordinated rename | **C21** | yes | **correctly NOT detected** | **VALID positive control** |
| uncoordinated rename | **C17** | yes | reported by **both** the step-resolvability check *and* the gate-target check, naming the missing file | **VALID — strongest mutant in the set** |
| PATH/HOME manipulation | *(not a mutant)* | n/a | §3.5 + §3.6 prove absence of the dependency directly | **CONFIRMED by execution** |
| cwd dependence | *(not a mutant)* | n/a | five-context byte-identical output (§3.6) | **CONFIRMED by execution** |
| shell-comment masking | **C15** | yes | step replaced by `# node scripts/run-db-suites.mjs`; gate reported not wired | **VALID** |
| YAML-comment masking | C16 | yes | step replaced by an echo; gate reported not wired | **VALID** |
| suppression constructs | **C10, C11, C12** | yes | "it is `continue-on-error`" / "it contains `\|\| true`" | **VALID** |
| flag-narrowing | C13, C14 | yes | "invoked by a NON-EQUIVALENT command. Expected exactly …" | **VALID** |
| contract truncation | C19, C20 | yes | "the required-gate contract has only 16 entries; 17 are expected" | **VALID** |

**No false detection from a syntax error, a missing dependency, or an unrelated failure was found.**
All 20 detections reported a domain-specific contract message, and the harness's own post-condition
block independently confirmed the real workflow, contract, manifest and gate scripts were never
written.

**Correction to the Phase 32 report.** It claims "Validated by 14 mutation assertions: 11 weakening
attacks all detected". The harness at `HEAD` contains **21** mutants with **20** weakening attacks.
The 14/11 figure is not reproducible against the committed harness. This is a reporting discrepancy
in the artifact's own favour (the committed harness is stronger than claimed), not a control defect.

**One note on coverage, stated rather than glossed.** The untracked-artifact path is implemented and
real, but no mutant in the harness constructs an *existing-yet-unindexed* file. The mutants that
approach it (C17, C18) remove or rename tracked files. The `git ls-files` logic is therefore verified
by source reading, not by a passing mutant. This is a **coverage gap in the harness**, not a defect
in the check.

### 3.8 Hosted CI recovery for Phase 32 — PARTIALLY CONFIRMED

Run `36671794473` (`abe8d78`, the Phase 32 commit): the `release` job **succeeded**, including step
`CI contract — the workflow satisfies the parity contract` and every mutation step. So the Phase 32
ordering fix and the committed artifacts are confirmed effective on a hosted runner. But the **run as
a whole was `failure`**: the `api` job failed at step 17,
`Supply chain — no reachable critical/high advisory (Phase 23 W6)`, with steps 18–28 `skipped`.

**This is important and Phase 34 does not state it this way.** Phase 32's commit was **never green on
a hosted runner**. The commit message says so honestly ("Hosted CI is not yet proven for this commit
and no such claim is made here"), but the practical consequence is that no hosted run has ever
isolated the Phase 32 fix. The fix is confirmed only in combination with Phase 33. Phase 34 §4's
framing — "Both Phase 32 root causes are real, correctly diagnosed, fixed at the root, and verified
green on a hosted runner" — overstates what any single run demonstrated.

---

## 4. Phase 33 Verification

### 4.1 The remediation is real, not a suppression — CONFIRMED

`git diff --stat abe8d78 5b841eb` shows exactly two files changed: `pnpm-lock.yaml` and
`pnpm-workspace.yaml`. No manifest, no gate, no workflow, no application source.

### 4.2 Exact override targets and what the lockfile actually installs — CONFIRMED

`pnpm-workspace.yaml`:

```yaml
overrides:
  'brace-expansion@>=1.0.0 <1.1.21': 1.1.21
  'brace-expansion@>=2.0.0 <2.1.7': 2.1.7
  'undici@<6.28.1': 6.28.1
```

The lockfile carries a pnpm-written `overrides:` block (lines 7–10) and resolves exactly three
entries, with **no** vulnerable version present as a resolution:

| Package | Requested by | Declared range | Override target | Lockfile resolution | Satisfies parent range? |
|---|---|---|---|---|---|
| `brace-expansion` 1.x | `minimatch@3.1.5` (via `@eslint/eslintrc`→`eslint`, `@nestjs/cli`, …) | `^1.1.7` | `1.1.21` | `1.1.21` | **yes** (patch, same major) |
| `brace-expansion` 2.x | `minimatch@9.0.9` (via `glob`) | `^2.0.2` | `2.1.7` | `2.1.7` | **yes** (patch, same major) |
| `undici` | `@remix-run/node@2.17.5` → `@expo/server` → `expo-router` → `@ecc/mobile` | `^6.21.2` | `6.28.1` | `6.28.1` | **yes** (patch, same major) |

I confirmed the parent ranges by reading the installed parents' own `package.json` files, not by
trusting the report. **No parent is forced outside its declared range, and no major version is
introduced.**

**The two `brace-expansion` lines are independently constrained — CONFIRMED.** They are keyed by
disjoint ranges, and `pnpm why` shows each line reached by a parent requesting the corresponding
major. A single unversioned override would force one line onto the other; the range-keyed selectors
are the correct construction.

**All three are transitive — CONFIRMED.** None appears in any workspace manifest; I searched every
`package.json` under the root, `apps/*` and `packages/*`.

### 4.3 Clean-install reproducibility — CONFIRMED

A clean `git clone` of `HEAD` into a directory outside the repository, with no `node_modules`, no
`.env`, no `dist`, given a real `pnpm install --frozen-lockfile`:

- Install: **succeeded**, no lockfile drift.
- On disk: `brace-expansion@1.1.21`, `brace-expansion@2.1.7`, `undici@6.28.1` — **zero** vulnerable
  versions present.
- `verify-dependency-audit.mjs` **0**, `verify-dependency-triage.mjs` **0**, `triage-vulnerabilities.mjs` **0**,
  `verify-config-contract.mjs` **0**, `verify-ci-parity.mjs --list` **0**,
  `verify-next-config-features.mjs` **0**.
- `pnpm typecheck` **0** (7/7 tasks), `pnpm build` **0** (7/7 tasks, `apps/api/dist/main.js` emitted).
- `verify:ratelimit:n12:mutate` **0**.

**P34-2 correction.** The main working tree's `node_modules/.pnpm` still contains orphaned
`brace-expansion@1.1.18`, `brace-expansion@2.1.4` and `undici@6.28.0` directories. I verified they are
**unreachable**: a symlink scan of `node_modules`, `apps` and `packages` finds **0** symlinks
resolving into any of them, and the lockfile contains **0** references to those versions. Hygiene
only, no exposure. Recorded as INFO, not a security finding.

### 4.4 Security-control integrity — CONFIRMED

All six controls are byte-identical to `abe8d78`. I additionally searched each for weakening
constructs rather than relying on the hash alone:

| Control | Byte-identical | Weakening search |
|---|---|---|
| `scripts/triage-vulnerabilities.mjs` | yes | `EXPLICIT_BUILD_TIME_PACKAGES` is an **empty `Map`** (line 470) — no hand-waved dispositions; the only "suppress" string is instructional prose at line 611 |
| `scripts/verify-dependency-audit.mjs` | yes | zero matches for any suppression construct |
| `scripts/verify-dependency-triage.mjs` | yes | no suppression; it *asserts* the severity filter is unchanged |
| `scripts/verify-config-contract.mjs` | yes | allow-list limited to two pre-existing `BROWSERSLIST_*` entries |
| `scripts/verify-ci-parity.mjs` | yes | no suppression; it is the thing that *detects* suppression |
| `.github/workflows/ci.yml` | yes | see below |

**`ci.yml` suppression audit — CONFIRMED clean for security gates:**

- `continue-on-error`: **2**, both lint. `ci.yml:133` (`API lint`, named "advisory — 55 pre-existing
  errors") and `ci.yml:307` (`Mobile lint`, named "advisory"). Both self-disclose, and the CI-parity
  contract *enforces* that any `continue-on-error` step's name says "advisory".
- `|| true`: **2**, both `trap 'kill -TERM $API_PID 2>/dev/null || true' EXIT` cleanup traps at
  `ci.yml:190` and `ci.yml:275`. Not gate suppression.
- `set +e`: **0**.
- No audit ignore, no allow-list, no `auditIgnore` mechanism in `package.json`,
  `pnpm-workspace.yaml`, or `.npmrc` (**no `.npmrc` exists**).

**Phase 33 weakened nothing. CONFIRMED.**

### 4.5 Advisory counts — CONFIRMED, with one correction

Live `pnpm audit --json` against `HEAD`:

| Metric | Phase 33 (historical) | Phase 34 claim | I observed | Verdict |
|---|---|---|---|---|
| Total | 92 | 92 | **92** | **CONFIRMED** |
| critical | 4 | 4 | **4** | **CONFIRMED** |
| high | 44 | 44 | **44** | **CONFIRMED** |
| moderate | 36 | 36 | **36** | **CONFIRMED** |
| low | 8 | 8 | **8** | **CONFIRMED** |
| `brace-expansion` / `undici` remaining | 0 | 0 | **0** | **CONFIRMED** |

**No feed drift.** The `101 → 92` claim is consistent with 9 advisories removed and 0 introduced. I
could **not** re-observe the 101 figure (the remediation is already applied) and do not claim
otherwise. This is a genuine feed-state question that the historical record alone cannot settle, and
I mark the "before" number **UNVERIFIED** and the "after" number **CONFIRMED**.

**P34-6 correction.** The triage gate prints `advisories reported by pnpm audit : 48` while a live
audit reports 92. The gate filters to critical/high *before* printing, so the label is inaccurate at
the point of use. INFO, traceability only. Reproduced by me: same `48` in the baseline, in the P34-1
mirror, and in the positive-control mirror (where it correctly read `49`).

---

## 5. Phase 34 Verification

I treated every Phase 34 conclusion as a claim and re-derived it.

| Phase 34 conclusion | My verdict | Basis |
|---|---|---|
| Both Phase 32 root causes real and fixed at the root | **CONFIRMED** | §3.1, §3.4, §3.5 |
| Phase 32 "verified green on a hosted runner" | **NOT CONFIRMED (overstated)** | `abe8d78` was never green; its run failed on a third axis. §3.8 |
| Phase 31 `P31-5` was wrong | **CONFIRMED** | §3.2 |
| `verify-config-contract.mjs` byte-identical and not relaxed | **CONFIRMED** | §3.4 |
| Phase 33 remediation genuine; 0 suppressed, 0 introduced, 0 gates weakened | **CONFIRMED** | §4.1–§4.5 |
| Run `36684252352` is a real `success` on exact `HEAD`; triage step executed, not skipped | **CONFIRMED** | §7 |
| Clean checkout reproduces graph and gates | **CONFIRMED** | §4.3 |
| Advisory counts 92/4/44/36/8, no drift | **CONFIRMED** | §4.5 |
| N-12 control intact | **CONFIRMED** | §8 |
| `next` critical 1193677 (Windows RCE) not reachable | **CONFIRMED** | §6.2 |
| `next` critical 1193733 (AVIF RCE) not reachable | **NOT CONFIRMED** | §6.2 — see finding **P35-1** |
| `tar` critical 1123940 build-time | **PLAUSIBLE, not independently re-derived** | §6.2 — same limitation Phase 34 disclosed |
| 14/11 mutation assertions (Phase 32 report) | **NOT CONFIRMED** | §3.7 — 21/20 at `HEAD` |
| **P34-1** moderate advisories unenforced | **CONFIRMED — independently reproduced** | §6.1 |
| **P34-2** orphaned store entries | **CONFIRMED** | §4.3 — reclassified INFO |
| **P34-3** workspace-wide override blast radius | **CONFIRMED** | `pnpm why brace-expansion` shows the 1.x line reached from `devDependencies` (`eslint`, `@nestjs/cli`, `@typescript-eslint`) |
| **P34-4** first-hop reachability ≠ code execution | **CONFIRMED** | `isProductionPath` is a first-hop `dependencies` vs `devDependencies` test |
| **P34-5** no independent review of 32/33 | **CONFIRMED, and now partially discharged** | §10 |

---

## 6. Supply-Chain / Advisory Analysis

### 6.1 P34-1 — moderate advisories are not enforced by any gate. INDEPENDENTLY REPRODUCED

I did not accept the claim. I created a disposable clone of `HEAD` outside the repository, lowered
only the two `brace-expansion` override targets to `1.1.20` / `2.1.6` (the high-severity floors), ran
a real install, and ran the gates CI runs. **The real repository was not touched.**

```
$ pnpm install --no-frozen-lockfile          # EXIT=0
$ ls node_modules/.pnpm | grep brace-expansion
brace-expansion@1.1.20
brace-expansion@2.1.6

$ pnpm audit --json | metadata.vulnerabilities
{"info":0,"low":8,"moderate":38,"high":44,"critical":4}
   ↑ moderate 36 → 38;  high 44 and critical 4 UNCHANGED
   moderate 1240100  <1.1.21        >=1.1.21   installed 1.1.20
   moderate 1240101  >=2.0.0 <2.1.7 >=2.1.7    installed 2.1.6

$ node scripts/triage-vulnerabilities.mjs     EXIT=0   ← every high/critical cleared
$ node scripts/verify-dependency-audit.mjs    EXIT=0
$ node scripts/verify-dependency-triage.mjs   EXIT=0
$ node scripts/verify-ci-parity.mjs --list    EXIT=0
$ node scripts/verify-config-contract.mjs     EXIT=0
```

**Result: every dependency and CI gate exits 0 with two moderate advisories present in the effective
graph.** `grep -c moderate` over the triage gate's own output returns **0** — the moderate advisories
are not merely tolerated, they are invisible to the gate.

**And no gate enforces the specific Phase 33 floors.** I searched every gate script, the workflow and
the CI-parity contract for `1.1.21`, `2.1.7` and `6.28.1`:

```
$ grep -rn "1\.1\.21\|2\.1\.7\|6\.28\.1" scripts/ .github/ apps/*/scripts
(no matches)
```

The floors exist **only as a YAML comment** in `pnpm-workspace.yaml`. Nothing machine-checks them.

**Positive control (so the result is not vacuous).** In a second mirror I forced `undici` back to
`6.28.0`. The gate fired **for the right reason**:

```
$ node scripts/triage-vulnerabilities.mjs     EXIT=1
    [high] undici@6.28.0  (1/1 prod paths)
      evidence: no reachability rule is defined for `undici` in this script … "I could not check this"
                is a finding, not a dismissal.
FAILED — 1 critical/high advisory/ies are reachable and need a decision before release.
```

So the critical/high floor **is** load-bearing, and the moderate floor demonstrably is not. **P34-1 is
CONFIRMED.** A future maintainer who reads the high-severity floors (or Phase 32's quoted
`1.1.19`/`2.1.5`) and "simplifies" the override obtains green CI with the advisories Phase 33
deliberately fixed back in the graph, and no control objects.

### 6.2 Reachability — four levels, kept strictly separate

The brief requires distinguishing (1) in the graph, (2) reachable from a production dependency,
(3) vulnerable feature imported, (4) exposed in the deployed application. `triage-vulnerabilities.mjs`
establishes (2) via a first-hop test. I re-derived the criticals independently.

#### 1193677 — `next` RCE on Windows-hosted servers — level 4 CONFIRMED

- Deployed base image: `apps/web/Dockerfile` — `FROM node:24-alpine AS build` and
  `FROM node:24-alpine AS runtime`. I read both stages; the rule only quotes the first, and I checked
  the second myself. Linux container, not Windows. No Windows hosting exists anywhere in the repo.
- Next version: `14.2.35`, a production `dependencies` entry of `apps/web`.
- **Verdict: not exposed. CONFIRMED at level 4.**

#### 1193733 — `next` RCE in Image Optimization API when AVIF is used — **NOT CONFIRMED**

The gate classifies this `NOT REACHABLE` with the evidence: *"no next/image import, no `<Image>`
element and no `images` key in the exported Next config; the optimizer has no loader to invoke. Phase
23 additionally probed the running image: GET /_next/image answered 400 for both a remote and a local
url."*

I re-derived the same starting facts — there is no `next/image` import, no `<Image>` element and no
`images` key, all confirmed by search of `apps/web/src` and `packages`. But I then tested the
endpoint's **actual** behaviour rather than inferring it.

**I built the production web image from the clean checkout and probed the real deployment.**

```
$ # in the RUNNING PRODUCTION CONTAINER (ecc-web:p20-verify)
$ curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:13913/_next/image?url=%2Fnonexistent.png&w=64&q=75"
400
$ curl -s "http://127.0.0.1:13913/_next/image?url=%2Fnonexistent.png&w=64&q=75"
The requested resource isn't a valid image.
$ curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:13913/definitely-not-a-route"
404
```

**`/_next/image` is a live, unauthenticated, externally reachable route in the deployed production
image.** It is not a 404; it is Next's own optimizer, dispatching into
`next/dist/server/image-optimizer.js`, which is present in the shipped standalone tree. With a real
PNG present in `public/`, it returns **HTTP 200** — again unauthenticated.

Three things follow, and I am careful about what each does and does not prove:

1. **The gate's stated evidence is factually wrong about the deployed artifact.** "The optimizer has
   no loader to invoke" and "`GET /_next/image` answered 400" are presented as showing the feature is
   absent. A 400 with the optimizer's own error string shows the opposite: the endpoint is present
   and executing. The rule reasons about *application usage* of the optimizer, not about *endpoint
   existence*, and Next registers `/_next/image` unconditionally regardless of whether any component
   uses it.

2. **I did NOT demonstrate the AVIF RCE is exploitable, and I do not claim it is.** With `Accept:
   image/avif`, the response is still `image/png` and **byte-identical to the input** — the optimizer
   performed no transform. The reason is visible in the container: `sharp` is **absent** from the
   image (`sharp MISSING`, `wasm-count=0`), and `image-optimizer.js:664` throws in standalone mode
   when `sharp` is missing. The AVIF transcode therefore cannot execute. *That* is the actual
   mitigation — and it is a **property of a transitive optional dependency being absent**, not
   anything the rule checks or records.

3. **The gate does not test the condition that actually protects it.** If any dependency ever pulls
   `sharp` into the web image — a plausible, unremarkable change — the AVIF code path becomes
   reachable through an endpoint that is *already live and unauthenticated today*, while the rule
   would still report `NOT REACHABLE` for exactly the same reason it does now, and no gate would
   object.

**Verdict: the `NOT REACHABLE` conclusion is not established by the evidence cited. The endpoint is
present (level 2 and level 4 for "endpoint exists"); the vulnerable AVIF transform is not currently
reachable because `sharp` is absent, which is a real but unrecorded and unchecked precondition. I
claim levels 1, 2 and 4 for the *endpoint*, and explicitly do NOT claim level 4 for the *AVIF RCE
being exploitable*.** Recorded as **P35-1**.

#### 1139528 — `vitest` file read/exec via UI server — CONFIRMED

Paths are `apps__api>vitest`, `apps__mobile>vitest`, `apps__web>vitest`; `vitest` is a
`devDependencies` entry in all three manifests, so it is not a production edge. No `--ui` in any
script, and the container gate asserts neither image ships test material. Not exposed.

#### 1123940 — `tar` decompression DoS — PLAUSIBLE, not independently re-derived

Path is `apps__mobile>expo>@expo/cli>…>tar`; the vulnerable code is reached through `@expo/cli`, a
build-time tool. I did not trace this chain end to end myself. Same limitation Phase 34 disclosed
and it is preserved here rather than upgraded.

### 6.3 The remaining high/moderate set

The gate's own conclusion is *"No critical or high advisory is reachable from a deployed code path."*
I inspected the mechanism (`isProductionPath` is a first-hop `dependencies` vs `devDependencies`
test; per-package rules for `next`, `multer`, `postcss`, `tar`, `vitest`; **fails closed** when no
rule exists) and spot-checked samples including all 23 `next` advisories and the two `undici` ones.
Beyond the criticals I did not individually re-derive every disposition. **"Unreachable" means
"unreachable in the dependency graph from a production edge" — it does not mean "not exploitable".**
The gate's own disposition text is honest about this.

---

## 7. CI Verification

Established from the GitHub Actions API and the full step logs, against the exact current `HEAD`.

| Field | Value |
|---|---|
| Local `HEAD` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| `origin/main` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| **Run for that exact SHA** | **`36684252352`** |
| Conclusion | **`success`** |
| Window | 2026-09-30T07:32:11Z → 07:37:09Z |
| Jobs | **5/5 succeeded** — API, Release, Containers, Web, Mobile |

**Phase 33's claimed run `36684252352` — CONFIRMED on every attribute:** commit SHA matches `HEAD`
exactly, 5/5 jobs successful, `run_attempt` completed without cancellation.

**No security-relevant step was skipped.** I enumerated every step of every job from the API
response; in `36684252352` the only non-`success` conclusions are **none** — every step in all five
jobs is recorded `success`, i.e. executed. Specifically:

```
success   7. CI contract — the workflow satisfies the parity contract (Phase 32 ordering)   [release]
success  15. Configuration contract — env, ports, versions, secrets (Phase 23 W5)            [api]
success  16. Supply chain — lockfile, native modules, engines (Phase 23 W6)                   [api]
success  17. Supply chain — no reachable critical/high advisory (Phase 23 W6)  ← the P32-1 blocker
success  18. Supply chain — the triage classifier fails closed (Phase 25 F-5)                 [api]
success  19. Web config — Next features are detected from the AST (Phase 25 F-4)              [api]
success  12. Storage backup — STORAGE_DIR archive, destroy, restore, re-verify (Ph.28 WS2)   [release]
success  16. Mutation — the N-12 429 contract is load-bearing (Phase 28)                     [release]
success  19. Database-backed suites — e2e and unit+integration on a fresh throwaway Postgres   [release]
success  20. Mutation — removing a required Phase 28 gate from CI is detected (Phase 29)      [release]
success  21. Dependency audit has not been weakened                                          [release]
```

The dependency-triage step is **blocking, executed, and not skipped**. **CONFIRMED.**

### Run history and the meaning of "green"

| Run | SHA | Conclusion | Note |
|---|---|---|---|
| `36684252352` | `5b841eb` | **success** | **= current `HEAD`** |
| `36671794473` | `abe8d78` | failure | Phase 32 — failed on P32-1 (triage) |
| `36618193752` | `4ddc0b5` | failure | Phase 29 — failed on missing artifacts + PATH/HOME |
| `36559541316` | `f51614d` | success | pre-advisory-drift |
| `36559104224` | `16dac73` | success | |
| `36558509809` | `61134d7` | success | |
| `36557892479` | `d9320ae` | failure | |

**There is no run newer than `36684252352`, and `HEAD` == `origin/main` == that run's SHA.** So the
"green" claim is not stale in the sense of HEAD having moved. But the qualification matters: this is
green **for this commit**, and the repository has no branch protection evidence I can verify, so
nothing mechanically prevents a future commit from landing without a green run. **No staging or
production readiness is claimed or implied.**

---

## 8. N-12 Regression Verification

Phase 33 touched no application source, so it could not have altered this control. I verified the
control independently anyway, by source and by execution.

| Requirement | Verdict | Evidence |
|---|---|---|
| Exhausted rate limit → **429** | **CONFIRMED** | `rate-limit.guard.ts:120` throws `RateLimitExceededException`; its `super(…, HttpStatus.TOO_MANY_REQUESTS)` sets the status |
| Code is `RATE_LIMITED` | **CONFIRMED** | `global-exception.filter.ts:124` returns `'RATE_LIMITED'` |
| `Retry-After` present | **CONFIRMED** | `global-exception.filter.ts:63–65` sets it, and **only** for this exception type — no other status can gain the header |
| `Retry-After` matches the real sliding window | **CONFIRMED** | `retryAfterSecondsFor()` = `max(1, ceil((lastAttempt + windowMs - now)/1000))`, derived from the live record; the `max(1, …)` floor is justified because `canActivate` compares `>` strictly, so rounding to `0` would be a lie |
| Ordinary auth failure → **401** | **CONFIRMED** | exercised by the compiled-auth suite (all modes) and the e2e suites, green locally and on the runner |
| Ordinary authz refusal → **403** | **CONFIRMED** | `verify-docker-images.mjs` asserts `res.status === 403` for the negative control |
| 403 gets **no** `Retry-After` | **CONFIRMED** | the header is written only under `instanceof RateLimitExceededException`; independently asserted at `verify-docker-images.mjs:1101` |
| Mobile retains session on 429 | **CONFIRMED** | `apps/mobile/src/services/api.ts:35` — the token is deleted only inside the `status === 401 \|\| status === 403` branch; 429 is deliberately excluded, with the reasoning inline |
| Mobile clears session on genuine 401/403 | **CONFIRMED** | same branch |
| Thresholds / window / bypass unchanged | **CONFIRMED** | `maxAttempts = 10`, `windowMs = 15 * 60 * 1000`; bypass requires `NODE_ENV === 'test'` **and** `ECC_TEST_DISABLE_RATE_LIMIT === '1'` — never true in production |

**Mutation harness — independently re-run twice (main tree and clean checkout), both `EXIT=0`.**
8 mutants, **7 detected for the intended reason**, M-N12-8 correctly NOT detected:

| Mutant | Intended weakened property | Applied? | Failed for the intended reason? |
|---|---|---|---|
| M-N12-3 | 429 loses `Retry-After` | yes | e2e: "a 429 must carry Retry-After" |
| M-N12-4 | `Retry-After` becomes a constant ignoring the window | yes | unit: "expected 60 to be 900" |
| M-N12-5 | 429 no longer classified `RATE_LIMITED` | yes | e2e: "expected 'ERROR' to be 'RATE_LIMITED'" |
| M-N12-6 | authz refusals widened to 429 (over-correction) | yes | e2e: "expected 429 to be 403" |
| M-N12-7 | mobile treats 429 as auth failure again | yes | mobile: "expected undefined to be 'token_429_valid'" |
| M-N12-8 | unrelated authz refusal reworded (negative control) | yes | **correctly NOT detected** |
| RESTORED | source must be byte-identical and green | — | "green again" |

I checked each detection message against the intended property rather than accepting a non-zero exit
code. No detection was caused by a syntax error, a missing dependency, or an unrelated failure.
**The N-12 control is intact and load-bearing. CONFIRMED.**

---

## 9. Integrity / Contamination Check

### 9.1 Protected artifacts — before/after fingerprints

| Item | Before | After | Result |
|---|---|---|---|
| `pnpm-lock.yaml` | `7fa75d7c…` | `7fa75d7c…` | **UNCHANGED** |
| `pnpm-workspace.yaml` | `19fe8f43…` | `19fe8f43…` | **UNCHANGED** |
| `package.json` | `1f62d7c4…` | `1f62d7c4…` | **UNCHANGED** |
| `.github/workflows/ci.yml` | `6f23ebdd…` | `6f23ebdd…` | **UNCHANGED** |
| All five gate scripts | §2 values | identical | **UNCHANGED** |
| Git index hash | `e85ee8e4…` | `e85ee8e4…` | **UNCHANGED** |
| Working-tree content hash | `8fbb5631…` | `8fbb5631…` | **UNCHANGED** |
| Staged / tracked-modified / stash | 0 / 0 / 0 | 0 / 0 / 0 | **UNCHANGED** |
| `HEAD` / `origin/main` | `5b841eb` / `5b841eb` | `5b841eb` / `5b841eb` | **UNCHANGED** |
| Reflog top | `5b841eb commit: phase(33)…` | identical | **UNCHANGED** |
| `apps/api/prisma/schema.prisma` | — | — | **UNCHANGED** |
| Prisma migrations | — | — | **UNCHANGED** |
| All `SECURITY_REVIEW_*` (pre-existing) | — | — | **UNCHANGED** |
| All historical reports | — | — | **UNCHANGED** |

The working-tree content hash covers **every tracked file plus every untracked file**, so it would
detect any modification anywhere, not just to the files I thought to check.

### 9.2 Infrastructure

- **Developer `ecc` database: unchanged** — 37 public tables, 14 users, before and after. Never a
  target; all database work used throwaway containers created and destroyed by the repository's own
  `scripts/lib/throwaway-postgres.mjs`.
- **Containers:** the same four as before (`pg-pgtest`, `ecc-postgres`, `ecc-redis`, `ecc-minio`).
  Every container I created was removed. `docker ps -a` shows **no** leftover review-created
  container.
- **Temporary servers:** three throwaway Next.js standalone servers were started on ports 13901–13905
  and all terminated; `pgrep -f server.js` returns nothing.
- **Mirrors and checkouts** (all under `/tmp/opencode/p35/`, outside the repository): `mirror-4ddc0b5`,
  `clean-5b841eb`, `p34-1-mirror`, `p35-pos-mirror`. These remain on disk pending normal host
  housekeeping; **none is inside the repository and none altered it**. I did not delete the two
  pre-existing Docker volumes or any pre-existing container, as they are not mine.

---

## 10. Review-Gap Inventory

I enumerated gaps from **Git state and the review documents' own disclosure text**, never from
filenames.

| Phase | Artifact | Exists? | Committed? | Reviewer = implementer? | Discloses the limitation? | Attacks the implementation? | Status |
|---|---|---|---|---|---|---|---|
| 22 | `SECURITY_REVIEW_PHASE_22.md` | **NO** | — | n/a | n/a | n/a | **OPEN — no artifact exists** |
| 23 | `SECURITY_REVIEW_PHASE_23.md` | **NO** | — | n/a | n/a | n/a | **OPEN — no artifact exists** |
| 25 | `SECURITY_REVIEW_PHASE_25.md` | yes | **NO (untracked)** | **NO** — self-declares "not fully independent", prior involvement in the work | **YES** | Partially — two mutations written independently | **OPEN** |
| 26 | `SECURITY_REVIEW_PHASE_26.md` | yes | **NO (untracked)** | **NO** — "This review is NOT independent. It is a self-review" | **YES** | Yes, adversarially | **OPEN** |
| 27 | `SECURITY_REVIEW_PHASE_27.md` | **NO** (only `docs/PHASE_27_FINAL_REPORT.md`, which is a *report*, not a review) | — | n/a | n/a | n/a | **OPEN — no independent review artifact** |
| 28 | `SECURITY_REVIEW_PHASE_28.md` | yes | **NO (untracked)** | Claims independence | No (claims it) | Yes | **OPEN — independence unverified; untracked** |
| 29 | `SECURITY_REVIEW_PHASE_29.md` | yes | **YES (tracked)** | Claims independence | No | Yes | Closed by its own review |
| 30 | `SECURITY_REVIEW_PHASE_30.md` | yes | **NO (untracked)** | Claims independent of Phase 30 spec author | Yes | Yes | Closed for the spec; pre-existing gaps noted |
| 31 | `SECURITY_REVIEW_PHASE_31.md` | yes | **NO (untracked)** | "independent in attribution", "**No**… organisationally independent" | **YES** | Yes | Partially closed; self-disclosed limits |
| **32** | `SECURITY_REVIEW_PHASE_32.md` | **NO** | — | n/a | n/a | n/a | **NOW PARTIALLY CLOSED by this document** |
| **33** | `SECURITY_REVIEW_PHASE_33.md` | **NO** | — | n/a | n/a | n/a | **NOW PARTIALLY CLOSED by this document** |
| 34 | `SECURITY_REVIEW_PHASE_34.md` | yes | **NO (untracked)** | **NO** — author states "I implemented Phase 32? **YES**… Phase 33? **YES**" | **YES, prominently** | Yes, and it self-corrects one result | **OPEN — a self-audit, not assurance** |
| **35** | this document | yes | **NO (untracked)** | **NO** | **YES** | **YES** | see P35-5 |

**Gaps genuinely closed by this review:** Phase 32 and Phase 33 now have a review authored by a party
that did not implement them, which re-derived the evidence from source, lockfile, Git history,
GitHub Actions step logs and reproducible execution rather than from the phase reports. That is a
real reduction in the assurance gap.

**Gaps this document does NOT close** — and I am explicit about this:

1. **The organisational-independence gap remains open for every phase.** I share the host, working
   tree, Docker daemon and credentials with the implementation. Attribution-level independence is
   established; separation of duties is not, and cannot be, established from inside this repository.
2. **Phase 34 remains a self-audit.** This document does not convert it into independent assurance; it
   is the implementer's own account, and it says so.
3. **Phases 22, 23, 25, 26, 27 remain open** — five inherited gaps, unchanged by this review.
4. **The assurance-integrity issue is unchanged and I am restating it as a finding, not a footnote:**
   **every** review document for Phases 25, 26, 28, 30, 31, 34 is **untracked**. A reviewer cloning
   `origin/main` receives none of them, and therefore receives none of the disclosures that *refute*
   the independence claim in `README.md`. The repository's own self-refutation of its assurance
   claims is not available to anyone who reads the repository.

---

## 11. Findings

Severity reflects release-review materiality, not a score. I have not inflated anything: two
findings are INFO and were reclassified downward from Phase 34's own ratings where the evidence
supported it.

### P35-1 — The `/_next/image` endpoint is live and unauthenticated in the deployed image; the gate classifies the AVIF RCE as not reachable on evidence that does not establish it — **MEDIUM** (new; missed by Phase 34)

**Evidence.** Built the production web image from a clean checkout of `HEAD` and probed the running
container:

```
$ curl -s -o /dev/null -w "%{http_code}\n" ".../_next/image?url=%2Fnonexistent.png&w=64&q=75"   → 400
$ curl -s ".../_next/image?url=%2Fnonexistent.png&w=64&q=75"
The requested resource isn't a valid image.
$ curl -s -o /dev/null -w "%{http_code}\n" ".../definitely-not-a-route"                          → 404
```

The 400 body is Next's own optimizer error, proving the route is live and dispatching into
`next/dist/server/image-optimizer.js`, which is present in the shipped standalone tree. With a real
image in `public/` the endpoint returns **200, unauthenticated**. The same result was obtained from
the standalone server and from the `ecc-web:p20-verify` container.

**Why the gate's evidence does not support its conclusion.**
`triage-vulnerabilities.mjs:290` infers "no image optimization" from the absence of a `next/image`
import, a `<Image>` element and an `images` config key. Those are facts about *application usage*.
Next registers `/_next/image` unconditionally. The gate's own quoted corroboration — "`GET
/_next/image` answered 400" — is cited as proof of absence when it is in fact proof of presence.

**What I did NOT establish, stated plainly.** I did **not** show the AVIF RCE is exploitable. With
`Accept: image/avif` the response is `image/png` and byte-identical to the input: no transform
occurs. The container has `sharp` **absent** (`sharp MISSING`, `wasm-count=0`) and
`image-optimizer.js:664` throws in standalone mode when it is missing, so the AVIF path cannot
execute. **The actual mitigation is the absence of a transitive optional dependency, not anything
the gate checks, records, or would notice changing.**

**Security consequence.** The disposition for a *critical* unauthenticated-RCE advisory rests on a
precondition that is incidental, unmonitored and unrecorded. Any future dependency that pulls `sharp`
into the web image converts an already-live, unauthenticated endpoint into the documented RCE path,
with every gate still reporting `NOT REACHABLE` for exactly the same reason. A maintainer reading
the gate's evidence would reasonably conclude the opposite of the truth.

**Reproducibility.** Deterministic from a clean checkout: `pnpm --filter @ecc/web build`, run
`.next/standalone/apps/web/server.js`, `curl /_next/image?url=%2Fmissing.png&w=64&q=75`. No network,
no credentials, no special configuration.

**New or inherited.** New. **Already known?** No — Phase 34 recorded the opposite conclusion.
**Blocks CI?** No. **Blocks independent review?** No. **Remediation requires authorisation?** Yes —
any change to `triage-vulnerabilities.mjs` is a gate change and is out of scope for this review.
**Not fixed by this review.**

### P34-1 — The dependency gates enforce only critical/high, so the moderate advisories Phase 33 fixed are unenforced — **MEDIUM** (new; independently reproduced here; not disclosed by Phase 32/33)

**Evidence.** Overrides lowered to `1.1.20` / `2.1.6` in a disposable mirror outside the repository,
with a real install: `pnpm audit` shows `moderate 36 → 38` with `high 44` and `critical 4` unchanged,
and `triage-vulnerabilities.mjs`, `verify-dependency-audit.mjs`, `verify-dependency-triage.mjs`,
`verify-ci-parity.mjs --list` and `verify-config-contract.mjs` **all exit 0**. The triage output
contains **zero** occurrences of "moderate" — the advisories are invisible to the gate, not merely
tolerated. `grep -rn "1\.1\.21\|2\.1\.7\|6\.28\.1" scripts/ .github/ apps/*/scripts` returns **no
matches**: the floors exist only as a YAML comment.

**Not a false detection.** A positive control in a second mirror (`undici` forced to `6.28.0`) made
the gate exit 1 naming the package, severity, production-path count and the reason it could not
dismiss it. The critical/high floor is genuinely load-bearing; the moderate floor is not.

**Security consequence.** A silent regression path in the dependency posture: a maintainer who reads
the high-severity floors (or Phase 32's quoted `1.1.19`/`2.1.5`) and lowers the override obtains
green CI with the advisories Phase 33 deliberately fixed back in the graph, and nothing objects.

**Reproducibility.** Deterministic. **New or inherited.** New. **Already known?** Yes — Phase 34
recorded it correctly. **Blocks CI?** No. **Blocks independent review?** No. **Remediation requires
authorisation?** Yes. **Not fixed by this review.**

### P34-5 — No independent review existed for Phases 32 or 33 — **MEDIUM** (new; **partially closed by this document**)

`SECURITY_REVIEW_PHASE_32.md` and `SECURITY_REVIEW_PHASE_33.md` do not exist. Before this document,
the only review of those phases was `SECURITY_REVIEW_PHASE_34.md`, whose author states plainly
"I implemented Phase 32? **YES** … Phase 33? **YES**".

**This document does not fully close it.** I close it at the level of **attribution independence**:
I did not implement either phase and re-derived the evidence from primary sources. It remains open
at the level of **organisational independence** (§1.2): same host, same tree, same credentials, no
separation of duties. Both claims are true simultaneously and I decline to let the weaker one stand
for the stronger. **Blocks CI?** No. **Blocks independent review?** No. **Remediation requires
authorisation?** Yes — organisational separation of duties cannot be established from inside this
repository.

### P35-2 — The untracked-artifact detection path has no passing mutant — **LOW** (new; missed by Phase 34)

`verify-ci-parity.mjs`'s `untrackedTargetProblem()` shells out to `git ls-files -z` and reports a
target that exists on disk but is absent from the index — the exact condition that let local parity
report green while hosted CI was red. I confirmed the logic is correct by reading it, and it is
genuinely conditional (it declines to invent a verdict outside a work tree).

However, **no mutant in `mutate-ci-integration.mjs` constructs an existing-yet-unindexed file.** The
nearest mutants (C17, C18) remove or rename tracked files, which the *existence* check catches
anyway. So the distinguishing logic is verified by source reading only. A future refactor could
break the `git ls-files` path and the harness would stay green.

**Security consequence.** Reduced assurance in a control whose whole purpose is the Phase 32 root
cause. **Reproducibility.** Structural. **New or inherited.** New. **Blocks CI?** No. **Remediation
requires authorisation?** Yes.

### P35-3 — The Phase 32 commit was never green on a hosted runner — **LOW** (new; **contradicts** Phase 34 §4)

`abe8d78` produced run `36671794473`, which **failed** on the dependency-triage step. The Phase 32
commit message states this honestly, but Phase 34 summarises it as "fixed at the root, and verified
green on a hosted runner". No single hosted run has ever isolated the Phase 32 fix; it is confirmed
only in combination with Phase 33. **This is a reporting-accuracy issue, not a control defect** — the
Phase 32 changes are individually correct and I verified them directly (§3.3–§3.7). **New or
inherited.** New. **Blocks CI?** No. **Remediation requires authorisation?** No (documentation only,
and documentation changes are out of scope here).

### P34-2 — Orphaned vulnerable versions in the working tree's virtual store — **INFO** (reclassified down from Phase 34's LOW)

`node_modules/.pnpm` still contains `brace-expansion@1.1.18`, `brace-expansion@2.1.4` and
`undici@6.28.0`. I verified **0** symlinks under `node_modules`, `apps` and `packages` resolve into
any of them, and the lockfile contains **0** references to those versions. Hygiene only; a clean
install is clean. **Not an exposure. Not fixed by this review.**

### P34-6 — The triage gate's advisory count is labelled inaccurately at the point of use — **INFO**

`advisories reported by pnpm audit : 48` is printed after a critical/high filter, while a live audit
reports 92. Reproduced by me in three separate trees. Traceability only.

### P34-4 — "Production path" is a first-hop dependency test, not code-execution reachability — **INFO** (inherited)

`isProductionPath` only asks whether the first hop of an audit path is a `dependencies` rather than a
`devDependencies` edge. No call site is traced; optional/peer edges, dynamic imports and
`exports`-map reachability are not modelled. The gate's disposition text is honest and its default is
fail-closed, which limits the consequence. Recorded so no reader upgrades "not reachable in the
dependency graph" into "not exploitable". **P35-1 is a concrete instance of this limitation
producing a wrong answer on a critical advisory.**

### P35-4 — All post-Phase-29 review documents are untracked, so the disclosures that refute the independence claim in `README.md` are unavailable to anyone who clones the repository — **INFO** (inherited; restated as a finding)

`git ls-files | grep -i security_review` returns 12 tracked review documents, the newest being
`SECURITY_REVIEW_PHASE_29.md`. Phases 25, 26, 28, 30, 31 and 34 exist only as untracked working-tree
files. A reviewer who clones `origin/main` therefore receives none of the independence disclosures
that this review relied on. **The repository's own evidence against its own assurance claims does not
travel with the repository.**

### P34-3 — The override is workspace-wide and also binds development dependencies — **INFO** (reclassified down from Phase 34's LOW)

`pnpm why brace-expansion` shows the 1.x line reached from `devDependencies` (`eslint`,
`@nestjs/cli`, `@typescript-eslint/*`), so a production-intent override also moves the
build/lint toolchain. Here the change is benign — the full regression passed. Reproducibility/
blast-radius awareness, not an observed defect.

**Counts: 0 CRITICAL, 0 HIGH, 2 MEDIUM (P35-1, P34-1), 1 MEDIUM-disposition (P34-5), 1 LOW (P35-2),
1 LOW (P35-3), 7 INFO.**

---

## 12. Corrections to Previous Reports

Recorded because prior documents are part of the evidence base and were wrong in ways a reader could
act on.

| # | Document | Claim | Correction |
|---|---|---|---|
| 1 | Phase 32 report | "Validated by 14 mutation assertions: 11 weakening attacks all detected" | The harness at `HEAD` has **21** mutants / **20** weakening attacks. Not reproducible as stated. Favours the implementation. |
| 2 | Phase 34 §4 / §17 | Phase 32 was "verified green on a hosted runner" | `abe8d78` **never went green**; run `36671794473` failed on the triage step. Phase 32 is confirmed only in combination with Phase 33. |
| 3 | Phase 34 §12 | `next` critical 1193733 (AVIF RCE) "NOT REACHABLE", evidenced by "no next/image import … GET /_next/image answered 400" | The `/_next/image` endpoint is **live and unauthenticated in the production container** and returns 200 for a real image. A 400 with the optimizer's own error string is evidence of **presence**, not absence. The real mitigation is `sharp` being absent, which no gate checks. See P35-1. |
| 4 | Phase 34 §15 P34-2 | LOW | Reclassified **INFO** — 0 symlinks resolve into the stale directories; no exposure. |
| 5 | Phase 34 §15 P34-3 | LOW | Reclassified **INFO** — verified benign; the full regression passes. |
| 6 | Phase 34 §15 | 6 findings | P35-1, P35-2 and P35-3 are additional and were not recorded. |
| 7 | Phase 33 §8 | "verify-dependency-audit.mjs first emitted a Node error … the gate is deterministic on the hosted runner" | I did not reproduce the race in a clean checkout — the gate passed on first invocation. I cannot confirm or refute the transient; noting it is **UNVERIFIED**, not a defect. |
| 8 | Phase 34 §13 | 5 historical gaps (22, 23, 25, 26, 27) open | **CONFIRMED and extended**: Phase 27 has no `SECURITY_REVIEW_PHASE_27.md` at all (only `docs/PHASE_27_FINAL_REPORT.md`, a report, not a review). |
| 9 | Phase 34 §3 | Working-tree fingerprint `ddf50912…` before and after | I could not reproduce this fingerprint value; I used my own (content hash `8fbb5631…`, identical before and after). Not a discrepancy in substance — different fingerprint algorithm. |

---

## 13. Unverified Items

Recorded as **UNVERIFIED** rather than substituted with a weaker test or assumed.

1. **The historical `101` pre-remediation advisory count.** The remediation is already applied; only
   the `92` result is observable. Feed state at the moment Phase 33 ran cannot be recovered. I did
   **not** treat this as a regression and did **not** claim to have re-observed it.
2. **The `tar` critical 1123940 build-time classification.** Mechanism inspected, chain not traced
   end to end by me.
3. **The ~46 remaining high/moderate dispositions individually.** Mechanism inspected and sampled
   (all 23 `next` advisories, both `undici` advisories, `brace-expansion`); not re-derived one by one.
4. **Whether the AVIF RCE in advisory 1193733 is exploitable.** I established the endpoint is live
   and that the AVIF path currently cannot execute because `sharp` is absent. I make **no** claim
   either way about exploitability under a configuration where `sharp` is present.
5. **Container gate `scripts/verify-docker-images.mjs` was not re-run in full.** Docker was
   available and the pre-built `ecc-web:p20-verify` image was probed directly, but the full
   image-build-and-run gate (~30 min) was not re-executed in the clean checkout. The hosted
   `containers` job for `36684252352` is `success`, which is independent evidence that it passes.
6. **Network-restricted clean-install reproducibility.** The clean checkout reused a warm pnpm store;
   a cold-cache install with `--frozen-lockfile` was not exercised. The hosted runner performed a
   cold install of this exact lockfile successfully.
7. **Branch protection / required-status-check configuration.** Not readable from the repository and
   not queried. Nothing mechanically prevents a red commit landing on `main`.
8. **Whether the 5 inherited review gaps (22, 23, 25, 26, 27) are closeable in principle** by any
   party, given that the work being reviewed is no longer separable from its implementation history.
9. **Staging, production, TLS, observability, load/soak, penetration testing, compliance, backup
   automation, encryption, retention, off-host storage.** None observed, none claimed.

---

## 14. Final Disposition

**VERIFIED WITH FINDINGS.** Stated precisely, and **not** as a readiness approval.

**What I independently confirmed.**

- Both Phase 32 root causes are real, are in different jobs on different axes, and are confirmed
  from the runner's own step logs and the commit tree — not from the report. The
  `verify-config-contract.mjs` PATH/HOME gate was **not** relaxed; the fix removed the harness's
  environment dependency rather than the gate's assertion.
- `verify-ci-parity.mjs` is a genuine contract, not a string-presence check: it resolves package
  scripts, resolves script targets, detects missing and untracked files, is byte-identical in output
  across five cwd/environment contexts including `env -i`, and matches gates on parsed tokens with
  shell comments stripped.
- The Phase 32 mutation harness is load-bearing: 21 mutants, 20 detected for the intended reason,
  one coordinated-rename positive control correctly not flagged, real files byte-identical at the
  end, no false detections.
- Phase 33 is a **genuine supply-chain remediation**, not a suppression. Nine advisories across three
  transitive packages removed by version override; the two `brace-expansion` major lines are
  independently constrained; no parent's semver range is violated; 0 suppressed, 0 introduced, 0
  gates weakened; `EXPLICIT_BUILD_TIME_PACKAGES` is empty. A clean checkout reproduces the graph and
  passes the same gates.
- Hosted run `36684252352` is a real `success` on the exact current `HEAD`, 5/5 jobs, **every step
  executed with none skipped**, including the dependency-triage gate that blocked the prior run.
- The Phase 28 N-12 rate-limit control is intact and load-bearing, verified by source and by two
  independent harness runs.
- This review altered no protected artifact: every checksum, the git index, the working-tree content
  hash, the reflog, `HEAD` and `origin/main` are identical before and after.

**What I did not confirm, and one thing I found that Phase 34 did not.**

- P34-1 is **independently reproduced**: the gates enforce only critical/high, so the moderate
  floors Phase 33 chose are protected by nothing but a comment. All five gates exit 0 with both
  moderate advisories present.
- **P35-1 is new**: the `/_next/image` endpoint is live and unauthenticated in the deployed
  production container, and the gate's "not reachable" verdict for a critical AVIF RCE rests on
  evidence that shows the opposite. I did not demonstrate the RCE is exploitable, and I decline to
  claim it; the real mitigation is `sharp` being absent, which no gate checks.
- Phase 32's commit was never green on a hosted runner.
- The untracked-artifact detection path has no passing mutant.

**Gaps.** Attribution-level independent review of Phases 32 and 33 is now established by this
document. **Organisational independence is not, and cannot be, established from inside this
repository** — I share the host, working tree, Docker daemon and credentials with the
implementation. Phase 34 remains a self-audit. Phases 22, 23, 25, 26 and 27 remain open. Every
review document for Phases 25, 26, 28, 30, 31 and 34 is untracked, so the disclosures that refute the
independence claim in `README.md` do not travel with the repository.

**Nothing was fixed.** Findings P35-1, P34-1, P35-2 and P34-5 each require authorisation to
remediate; all are gate or configuration changes and are outside this review's scope.

**No staging, production, or production-readiness claim is made.** No finding is closed. No
independent-review gap is closed beyond the attribution-level scope stated above.

---

*Review conducted against `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` with network access to the npm
registry, the GitHub REST API and GitHub Actions step logs. No finding was fixed. No protected
artifact was modified. No commit, push, rebase, reset, amend or stash occurred. The only file created
is `SECURITY_REVIEW_PHASE_35.md`.*
