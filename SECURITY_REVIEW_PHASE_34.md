# SECURITY_REVIEW_PHASE_34.md

**Review of:** Phases 32 and 33 (and the CI state they produced)
**Baseline reviewed:** `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` (`HEAD` == `origin/main`)
**Date:** 2026-09-30
**Nature:** Review only. No remediation was performed and none is proposed as done.

> **THIS DOCUMENT IS NOT AN INDEPENDENT REVIEW.** See §2. The reviewer of this
> document is the same agent that implemented Phases 32 and 33. It cannot discharge the
> independent-review requirement for those phases, and it must not be cited as though it does.

> **No staging, production, or production-readiness claim is made anywhere in this document.**

---

## 1. Executive Summary

I re-derived the material claims of Phases 32 and 33 from primary sources rather than from those
phases' reports, and I attacked the Phase 33 remediation adversarially in throwaway mirrors.

**What holds up.** Both Phase 32 root causes are real, correctly diagnosed, fixed at the root, and
verified on a hosted runner. Phase 33's remediation is genuine: three transitive packages carrying
nine advisories were removed from the effective dependency graph by moving to patched versions, not
by suppressing, downgrading, re-triaging, or editing any gate. All six control files that could have
been weakened are byte-identical to their pre-remediation state. Hosted run `36684252352` is a real
`success` on the exact current `HEAD`, and the dependency-triage step demonstrably **executed** rather
than being skipped. A clean checkout with a real frozen-lockfile install reproduces the same graph
and passes the same gates.

**What does not hold up, or is weaker than presented.** One genuinely new finding: the dependency
gates enforce **only critical and high** severities, which means the two *moderate* advisories that
Phase 33 deliberately fixed are **not protected by any automated control**. I demonstrated this by
installing overrides at `1.1.20`/`2.1.6` — every dependency and CI gate exits 0 while both moderate
advisories remain in the graph. Phase 33 chose the correct versions; nothing enforces that choice.
Three lower-severity findings and one inherited limitation are recorded in §15.

**Counts and one self-correction.** Advisory counts reproduce exactly (92 total / 4 critical / 44
high / 36 moderate / 8 low), so there is no feed drift. During §8 I initially recorded a control as
having caught a mutation when it had in fact failed on a missing Prisma client in my own incomplete
test mirror. That was my error, it is corrected in §8, and the corrected result is the one that stands.

**Disposition: APPROVED WITH FINDINGS** — the remediation is real and CI is genuinely green, but this
is a self-review, and one medium control gap should be closed.

---

## 2. Reviewer Independence / Limitations

This is the most important section in the document, and it constrains everything else.

| Question | Answer |
|---|---|
| Did I implement Phase 32? | **YES.** I authored its code changes, the `ci.yml` reordering, the parity strengthening, and `docs/PHASE_32_FINAL_REPORT.md`. |
| Did I implement Phase 33? | **YES.** I authored the `pnpm.overrides`, regenerated the lockfile, and wrote `docs/PHASE_33_FINAL_REPORT.md`. |
| Am I independent of the material under review? | **NO.** I am the implementer. |
| Is this document independent assurance for Phases 32/33? | **NO. It cannot be.** |
| Did I review my own work? | Yes. I have tried to review it adversarially, and I have recorded findings against it rather than glossing them — but self-review is materially weaker than review by a separate party, and no amount of rigour removes that. |

**Why this matters concretely.** Phases 25 and 26 were correctly downgraded to *self-review*
precisely because the reviewing party had prior involvement, and the Phase 28 handoff recorded the
principle: *"Reproduction by the implementer's successor is not independent review."* The same rule
applies here with full force. This document is **not** a second pair of eyes on Phases 32 and 33; it
is the implementer checking their own work. It should be treated as a self-audit, and a genuine
independent review of both phases remains **outstanding**.

**Limitations.**

- I share a working tree, host, Docker daemon, and credentials with the implementation. There is no
  separation of duties.
- No second reviewer checked any conclusion here.
- Staging, production, TLS, observability, load, penetration, and compliance remain outside my
  reach; absence was confirmed from the repository and this host, not from a hosting provider.
- The reachability classifications in `triage-vulnerabilities.mjs` were verified for the two `next`
  critical advisories by independent means. For the remaining ~48 high/moderate dispositions I
  inspected the **mechanism** and spot-checked samples; I did not individually re-derive every one.
  That distinction is preserved in §12 and is not collapsed into a blanket claim.

---

## 3. Baseline and Integrity

Captured before substantive work and re-verified after (§18). All identical.

| Item | Value |
|---|---|
| Branch / HEAD / `origin/main` | `main` / `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` / same, divergence `0 0` |
| Staged / tracked-modified / stash | 0 / 0 / 0 |
| Working-tree fingerprint | `ddf509126a948fb3f9c7de7597d535db` (before **and** after) |
| Reflog top | `5b841eb commit: phase(33): remediate reachable dependency advisories…` |
| `pnpm-lock.yaml` | `ccfa78db9184754cf7f9f4ac86353659` |
| `pnpm-workspace.yaml` | `656abae051a73b60deba041dfa8f0a8c` |
| `package.json` | `322568884835c4083f2eac29801fb1b4` |
| `.github/workflows/ci.yml` | `3346692a0468e61148e21e4b1f8556c8` |
| `apps/api/prisma/schema.prisma` | `4452c2a2cd00dc683930e164d6ec5a9c` |
| Prisma migrations (tree hash) | `10f0a383c1124aaae490f77701b195eb` |
| Gate scripts (6 files) | see §18 table — all unchanged |
| `SECURITY_REVIEW_*` aggregate | `84b7065871c04e8977ebe97dab2093af` |
| Historical phase reports aggregate | `e1dd0659b643f200eddbdc005680f245` |
| Developer `ecc` database | 37 public tables, 14 users — intact, never targeted |

---

## 4. Phase 32 Claims Reviewed

### 4.1 Root cause A — committed workflow referenced uncommitted artifacts

**Status: CONFIRMED FIXED.**

I resolved every command in the committed `ci.yml` independently. My first pass produced three
apparent misses (`dist/main.js`, `scripts/verify-compiled-auth*.mjs`, `../../scripts/verify-env-contract.mjs`)
and one apparent missing package script (`exec`). All four were **false positives of my own
extraction**, not defects:

- `dist/main.js` is job-generated build output (built by an earlier step).
- The `verify-compiled-auth*` scripts are invoked after `cd apps/api` and live at
  `apps/api/scripts/`; both are tracked.
- `../../scripts/verify-env-contract.mjs` is invoked via `pnpm --filter @ecc/api exec`, which runs
  with the package as cwd, resolving to the tracked `scripts/verify-env-contract.mjs`.
- `pnpm … exec <tool>` is not a declared package script.

The authoritative check is the repository's own contract, which models `cd` segments, `--filter`
working directories, and build output correctly:

```
$ node scripts/verify-ci-parity.mjs --list
Workflow structure is sound: 47 of 50 commands can run locally, 3 need the remote runner…
EXIT=0
```

Independently, every bare `node`/`bash` target resolved by hand is tracked at `HEAD`, and every
`pnpm --filter <pkg> <script>` referenced by the workflow exists in that package's manifest.

### 4.2 Root cause B — the `PATH`/`HOME` child-process dependency

**Status: CONFIRMED FIXED, and the security gate was not relaxed.**

`scripts/verify-config-contract.mjs` is **byte-identical to `4ddc0b5`** (`4ef391c94e1216ecaa3dff6f08983e27`
at `4ddc0b5`, at `HEAD`, and in the working tree). This is not a hash-only claim; I inspected
semantics: the committed gate contains **zero** `PATH`/`HOME` exemptions, so the relaxation that
existed transiently in the working tree during Phase 32 was reverted and never committed. The gate
remains a genuine "read but undocumented ⇒ fail" check.

The two harnesses no longer read the variables: `mutate-ci-integration.mjs` has 0 `process.env.PATH`
reads, and `mutate-rate-limit-n12.mjs` has exactly one occurrence, which I confirmed is inside a `//`
comment on line 196 and is therefore invisible to the comment-stripping scanner. The N-12 harness
invokes vitest as `process.execPath <repoRoot-relative vitest.mjs>` rather than `pnpm exec`, removing
the `PATH` lookup that made the read necessary.

**Independence is genuinely tested, not asserted.** I ran the parity contract under `env -i` and
under a hostile `HOME=/nonexistent PATH=/usr/bin:/bin` and obtained byte-identical output. The
Phase 29 harness still reports 20 mutants detected with its positive control not falsely flagged.

### 4.3 The ordering defect

**Status: CONFIRMED, and Phase 31's `P31-5` was wrong.** I reproduced this: the committed contract
run against the committed tree (`4ddc0b5`) detects all three missing artifacts and exits 1. It was
simply never reached, because the broken step preceded the contract step. Phase 33's workflow now
runs the contract immediately after install, verified green on the runner.

---

## 5. Phase 33 Supply-Chain Remediation Reviewed

**Status: CONFIRMED as a genuine remediation.**

| Claim | Verdict | Evidence |
|---|---|---|
| All three packages are transitive | **CONFIRMED** | none appears in any workspace manifest; paths are `brace-expansion ← minimatch@3/@9`, `undici ← @remix-run/node ← @expo/server ← expo-router ← @ecc/mobile` |
| Overrides placed in `pnpm-workspace.yaml` | **CONFIRMED appropriate** | the lockfile contains a pnpm-written `overrides:` block, which can only exist if pnpm read the source; pinned `packageManager` is `pnpm@11.25.0` and the running pnpm is `11.25.0` |
| `1.1.18 → 1.1.21`, `2.1.4 → 2.1.7`, `6.28.0 → 6.28.1` | **CONFIRMED** | lockfile resolutions, installed `package.json` files, and `pnpm list` all agree |
| The two `brace-expansion` lines need separate targets | **CONFIRMED** | `minimatch@3` requests `^1.1.7` and `minimatch@9` requests `^2.0.2`; a single unversioned override would force one line onto the other and break resolution |
| No parent's declared range is violated | **CONFIRMED** | `1.1.21 ⊨ ^1.1.7`; `2.1.7 ⊨ ^2.0.2`; `6.28.1 ⊨ ^6.21.2` — all patch-level within the same major |
| Lockfile change corresponds exactly to the intent | **CONFIRMED** | the diff is the `overrides:` block plus three resolution entries and their importer references; `2 files changed, 46 insertions, 12 deletions` |
| Lockfile is internally consistent | **CONFIRMED** | `pnpm install --frozen-lockfile --lockfile-only` succeeds and leaves the lockfile unchanged |
| The `1.1.21`/`2.1.7` choice is the binding floor | **CONFIRMED** | authoritative audit shows 1.1.19, 1.1.20 (high) **and 1.1.21** (moderate) for the 1.x line; 2.1.5, 2.1.6 (high) **and 2.1.7** (moderate) for the 2.x line. Phase 32's quoted 1.1.19/2.1.5 would have left advisories open |
| Phase 33 changed only the two dependency files | **CONFIRMED** | `git diff --stat abe8d78..5b841eb` shows only `pnpm-lock.yaml` and `pnpm-workspace.yaml` |
| No audit suppression added | **CONFIRMED** | no `auditIgnore`/ignore/allowlist mechanism in `package.json`, `pnpm-workspace.yaml`, or `.npmrc`; `EXPLICIT_BUILD_TIME_PACKAGES` is an empty `Map` (line 470) — no hand-waved dispositions |
| Reports left uncommitted as stated | **CONFIRMED** | `docs/PHASE_32_FINAL_REPORT.md` and `docs/PHASE_33_FINAL_REPORT.md` are both untracked |

---

## 6. Dependency Graph Verification

Reconstructed independently rather than read from the report.

**Effective graph** — the only versions any importer declares, and therefore the only versions
installed and linked:

```
brace-expansion@1.1.21    brace-expansion@2.1.7    undici@6.28.1
```

**On-disk state.** In *this* working tree, `node_modules/.pnpm/` also still contains
`brace-expansion@1.1.18`, `brace-expansion@2.1.4` and `undici@6.28.0` as leftover virtual-store
directories. I established they are **orphaned, not reachable**: I walked every symlink under
`node_modules`, `apps` and `packages` and **no symlink resolves into any of the three stale
directories**. A fresh install is clean (§9). Recorded as finding **P34-2**; it is a hygiene issue,
not an exposure.

**Reproducibility.** A clean checkout of `HEAD` with no `node_modules` and no `.env`, given a real
`pnpm install --frozen-lockfile`, installed `brace-expansion@1.1.21`, `brace-expansion@2.1.7` and
`undici@6.28.1`, contained **0** vulnerable versions on disk, and passed `verify-dependency-audit`,
`verify-dependency-triage`, `triage-vulnerabilities`, `verify-config-contract` and
`verify-ci-parity --list` — all `EXIT=0`.

---

## 7. Advisory Verification

Independently reproduced with a live `pnpm audit --json`.

| Metric | Phase 33 (historical) | Observed now | Verdict |
|---|---|---|---|
| Total | 92 | **92** | matches |
| critical | 4 | **4** | matches |
| high | 44 | **44** | matches |
| moderate | 36 | **36** | matches |
| low | 8 | **8** | matches |
| `brace-expansion` / `undici` remaining | 0 | **0** | matches |

**No feed drift.** The `101 → 92` claim is consistent: 9 advisories were removed and 0 introduced.
I could not re-observe the 101 figure because the remediation is already applied, and I do not claim
otherwise.

**A counting discrepancy worth noting (not a defect).** Raw `pnpm audit` reports 92 advisories while
`triage-vulnerabilities.mjs` prints `advisories reported by pnpm audit : 48`. The gate applies its
own filtering before that line. A reader comparing the two numbers could mistake the gate for
under-counting. Recorded as **P34-6** (INFO).

---

## 8. Override Mutation Testing

All mutations ran in throwaway mirrors (`/tmp`), never in the repository. I verified after each batch
that the working-tree fingerprint and lockfile checksums were unchanged.

**Layer 1 — dependency resolution.** Removing any single override, or all three, does **not**
reintroduce the vulnerable version, because the existing lockfile already pins a version that
satisfies each parent's range and pnpm keeps it. This means the override is *belt-and-braces* over
the lockfile, not the sole protection. Re-pointing an override to the vulnerable version
(`1.1.18`, `6.28.0`) does restore the vulnerable version, as expected. Pointing an override at an
incompatible major (`3.0.0`) resolves to `brace-expansion@3.0.0` — an install that would fail
downstream, correctly.

**Layer 2 — the gates are load-bearing (positive control).** With a real install of a tree whose
`undici` override was forced to `6.28.0`:

```
triage-vulnerabilities.mjs   EXIT=1
  [high] undici@6.28.0  (1/1 prod paths)
  FAILED — 1 critical/high advisory/ies are reachable and need a decision before release.
```

The detection is by the **security condition** — the gate names the package, severity, production
path count, and the reason it cannot dismiss it. This is not a syntax error or a broken harness.

**Self-correction.** I initially recorded a stronger result from a third mutation: that
`verify-dependency-audit.mjs` also failed when the overrides were set to the high-severity floors.
Re-running after `prisma generate` showed that failure was a `MODULE_NOT_FOUND` for the Prisma
client in my own incomplete mirror — a setup artifact, **not** a control detecting anything. I
discarded that result. This is precisely the "do not accept a mutant because a setup error failed
it" trap, and the corrected result is what stands.

**Layer 3 — the real gap.** With a complete install at overrides `1.1.20` / `2.1.6` — which clear
every high and critical advisory but not the moderate ones:

```
triage-vulnerabilities.mjs   EXIT=0
verify-dependency-audit.mjs  EXIT=0
verify-dependency-triage.mjs EXIT=0
verify-ci-parity --list      EXIT=0
…
moderate brace-expansion advisories present: 2  (1240100, 1240101)
```

Every gate is green with two moderate advisories in the graph. See **P34-1**.

---

## 9. CI Integrity Verification

| Check | Result |
|---|---|
| All required gates present | Yes — `verify-ci-parity.mjs` `REQUIRED_GATES` still resolves the workflow, contract `EXIT=0` |
| Phase 28 gates present | Yes — `verify:storage:backup`, `verify:ratelimit:n12:mutate`, `run-db-suites.mjs` |
| Phase 29 gates present | Yes — CI-parity step, `mutate-ci-integration.mjs` |
| Phase 32 fixes present | Yes — contract step first in the `release` job; `PATH`/`HOME` dependency gone |
| Dependency audit blocking | Yes — no `continue-on-error` on "no reachable critical/high advisory" or "triage classifier fails closed" |
| `continue-on-error` anywhere | Only **2**, both lint: `ci.yml:133` (API lint) and `ci.yml:307` (Mobile lint) — long-standing, disclosed, and not security gates |
| `\|\| true` / `set +e` | Only 2 occurrences, both `trap 'kill -TERM $API_PID 2>/dev/null \|\| true' EXIT` shell cleanup traps at `ci.yml:190` and `:275` — not gate suppression |
| Hidden allowlist suppressing advisories | None found |
| Package scripts renamed to bypass the contract | No — contract `EXIT=0`, so every referenced script resolves |
| All referenced scripts tracked | Yes (§4.1) |
| Step ordering valid | Yes — contract runs before the steps it governs |

---

## 10. Hosted CI Verification

Established from the GitHub API against the exact current `HEAD`, not inferred from local results.

| Field | Value |
|---|---|
| Local `HEAD` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| Run for that exact SHA | **`36684252352`** |
| Conclusion | **`success`** |
| Window | 2026-09-30T07:32:11Z → 07:37:09Z |

All five jobs succeeded: API, Release, Containers, Web, Mobile. Every security-relevant step is
recorded **`success`**, i.e. **executed** — none is `skipped`:

```
success  15. Configuration contract — env, ports, versions, secrets (Phase 23 W5)
success  16. Supply chain — lockfile, native modules, engines (Phase 23 W6)
success  17. Supply chain — no reachable critical/high advisory (Phase 23 W6)   ← the P32-1 blocker
success  18. Supply chain — the triage classifier fails closed (Phase 25 F-5)
success   7. CI contract — the workflow satisfies the parity contract (Phase 32 ordering)
success  12. Storage backup — STORAGE_DIR archive, destroy, restore, re-verify (Phase 28 WS2)
success  16. Mutation — the N-12 429 contract is load-bearing (Phase 28)
success  19. Database-backed suites — e2e and unit+integration on a fresh throwaway PostgreSQL
```

**The dependency-triage step demonstrably executed** — it is not advisory and was not skipped. This
is a genuine green run for this commit and nothing more is claimed from it.

---

## 11. N-12 Regression Verification

Phase 33's commit touched no application source, so the N-12 control could not have been altered by
it. I verified the control is nonetheless intact.

| Requirement | Status | Evidence |
|---|---|---|
| Rate-limit exhaustion → **429** | CONFIRMED | `rate-limit.guard.ts:120` throws `RateLimitExceededException`; the exception's `super(...)` uses `HttpStatus.TOO_MANY_REQUESTS` |
| → **RATE_LIMITED** classification | CONFIRMED | `global-exception.filter.ts:124` returns `'RATE_LIMITED'` |
| → **Retry-After** | CONFIRMED | `global-exception.filter.ts:64` sets it, only for this exception type |
| **403** stays 403, `FORBIDDEN`, **no** `Retry-After` | CONFIRMED | `verify-docker-images.mjs:1085` asserts `res.status === 403`, `:1101` asserts `res.headers.get('retry-after') === null` |
| **401** for authentication failure | CONFIRMED | exercised by the compiled-auth suite (all modes pass) and the e2e suites |
| Mobile: 429 does **not** delete the session | CONFIRMED | `apps/mobile/src/services/api.ts` deletes the token only inside the `401 \|\| 403` branch; 429 falls through to the generic error path |
| Thresholds / window / bypass unchanged | CONFIRMED | `maxAttempts = 10`, `windowMs = 15 * 60 * 1000`; bypass still requires `NODE_ENV === 'test'` **and** the opt-in flag |
| Control is load-bearing | CONFIRMED | all 8 N-12 mutants detected, including M-N12-6 (authorization refusals widened to 429) and two genuine negative controls |

The converse assertion in the container gate is what prevents an over-correction, and mutant M-N12-6
proves it fires.

---

## 12. Remaining Advisory Reachability

The gate's own conclusion is: *"No critical or high advisory is reachable from a deployed code path."*
That is a **security-sensitive** claim and I examined the mechanism rather than accepting it.

**How reachability is determined.** `isProductionPath` (`triage-vulnerabilities.mjs:700`) takes an
audit path such as `apps__api>@nestjs/cli>…>minimatch>brace-expansion`, splits the importer, and asks
whether the **first hop** appears in that workspace package's `dependencies` (production) rather than
`devDependencies`. If so the package is a *production-path* package. It then applies per-package rules
(`triageNext`, `triage` for `multer`, `postcss`, `tar`, `vitest`, a bundling-toolchain heuristic) or,
with none, it **fails closed**.

**What "reachable" therefore means — and what it does not.** It means *reachable in the dependency
graph from a production edge*, **not** that the vulnerable function executes. Nothing in the gate
traces a call site. This is an inherited design property, recorded as **P34-4**.

**How the classification could be wrong.**

- *False negative* — a package reachable only through an optional/peer edge, a dynamic import, or a
  package `exports` map that the gate does not model could be mis-scoped. The gate partly compensates
  by failing closed when no rule exists, so a missing rule produces a failure rather than a silent
  pass.
- *False positive* — a genuinely unreachable advisory may still be reported, which is safe.
- The bundling-toolchain heuristic treats a path matching an Expo/`@remix-run` pattern as build-time
  when **all** production paths match. That is a regex, not a proof.

**The 4 critical advisories — independently checked.**

| Advisory | Package | Gate's claim | My independent verification |
|---|---|---|---|
| 1193677 | `next` — RCE on Windows-hosted servers | not reachable: web image is Linux and containerised | **CONFIRMED.** `apps/web/Dockerfile:15,26` → `FROM node:24-alpine` for both build and runtime. No Windows hosting exists. |
| 1193733 | `next` — RCE in Image Optimization when AVIF used | not reachable: no image optimization | **CONFIRMED.** No `images` key in `apps/web/next.config.mjs`; no `next/image` import and no `<Image` element anywhere in `apps/web/src`; and `verify-next-config-features.mjs` — an **AST-based** gate, not a text match — asserts optimization is off *and* that it detects the key when present *and* that a comment does not trigger it. |
| 1139528 | `vitest` — file read/exec via UI server | not reachable: dev-only | **CONFIRMED.** Paths are `apps__api>vitest` and `apps__mobile>vitest`; `vitest` is in `devDependencies`, so it is not a production edge. |
| 1123940 | `tar` — decompression DoS | build-time via Expo toolchain | **PLAUSIBLE, not independently re-derived.** Path is `apps__mobile>expo-constants>expo>@expo/cli>…>tar`; the vulnerable code is reached through `@expo/cli`, a build-time tool. I did not trace the full path myself. |

**Categories, kept separate as required.**

- *Demonstrated unreachable in this repository:* the two `next` criticals (verified above with
  built-artefact and AST evidence), and `vitest` (dev-only edge).
- *Classified unreachable by the repository's rule set, mechanism inspected, sample-checked, not
  individually re-derived:* the bulk of the remaining high/moderate set, including `tar`.
- *Not analyzed:* whether the advisories are exploitable in some deployment configuration other than
  this repository's.
- *Not observed / externally conditioned:* anything requiring staging, production, a Windows host,
  image optimization being enabled, or the Vitest UI server being started.

**"Unreachable" is not "safe."** It is a statement about this repository's current configuration. Both
`next` rules say so explicitly in their own action text — *"re-check the moment the Windows hosting
appears"* and *"re-check the moment the image optimization appears."* Those conditions are exactly
the kind of change that would silently invalidate the disposition, and no control enforces the
re-check.

---

## 13. Open Independent-Review Gaps

| Phase | `SECURITY_REVIEW_PHASE_N.md` | Git state | Independence | Status |
|---|---|---|---|---|
| 22 | **ABSENT** | — | n/a | **OPEN — no review exists** |
| 23 | **ABSENT** | — | n/a | **OPEN — no review exists** |
| 25 | present | **UNTRACKED** | **NOT independent** — self-declared: *"This review is not fully independent"* | **OPEN** |
| 26 | present | **UNTRACKED** | **NOT independent** — self-declared: *"This review is NOT independent. It is a self-review"* | **OPEN** |
| 27 | **ABSENT** | — | n/a | **OPEN — no review exists** |
| 28 | present | **UNTRACKED** | claims independence | OPEN (pre-existing) |
| 29 | present | tracked | claims independence | closed by its own review |
| **32** | **ABSENT** | — | — | **OPEN — this document does not close it** |
| **33** | **ABSENT** | — | — | **OPEN — this document does not close it** |

**Five historical gaps remain open** (22, 23, 25, 26, 27), unchanged by Phases 32/33.

**Two new gaps were created by the phases I implemented.** Phases 32 and 33 have no independent
review, and the only review of them is the one in §2 — authored by their implementer. A genuine
independent review of both is **outstanding and is the single most important follow-up** arising from
this document.

Note also that the Phases 25/26/28 reviews are **untracked**, so a reviewer cloning `origin/main`
receives neither them nor the disclosures that refute the independence claim in `README.md`. That
inherited assurance-integrity issue is unchanged.

---

## 14. External / Unproven Claims

**Repository-proven** (and no more): the committed dependency graph contains only patched versions;
`pnpm install --frozen-lockfile` succeeds from a clean checkout and is internally consistent; the
dependency, triage, config, env, CI-parity, build, database, container and N-12 gates pass locally
and were observed passing on hosted runner `36684252352`; the N-12 and CI-integration mutation
harnesses detect their targeted mutations; the compiled-auth suite passes in all modes.

**Unproven / external — none of these is claimed:**

- staging deployment (no staging environment has ever existed)
- production deployment (nothing has ever been deployed anywhere)
- production TLS (no certificate, proxy, or `sslmode`)
- production observability (no metrics, alerting, tracing, or log aggregation)
- production-scale load or soak testing
- penetration testing (none, internal or external)
- compliance certification (none; the repository makes no compliance claim)
- production-volume backup/restore (3 DB rows, 8 storage files, local filesystems)
- backup automation, encryption, retention, off-host storage
- that the remaining 4 critical / 44 high advisories are unreachable in *any* deployed configuration
- independent review of Phases 22, 23, 25, 26, 27, 32, 33

A green CI run is evidence that this commit builds and passes its own gates on GitHub-hosted
runners. It is not a readiness, security, or compliance certification.

---

## 15. Findings

Severity reflects release-review materiality, not a score.

### P34-1 — Dependency gates enforce only critical/high, so the moderate advisories Phase 33 fixed are unenforced — **MEDIUM** (new; not disclosed by Phase 32/33)

`scripts/triage-vulnerabilities.mjs:748` filters `.filter((a) => a.severity === 'critical' || a.severity === 'high')`.
I installed a tree with overrides at `brace-expansion` `1.1.20` / `2.1.6` — which clear **every**
high and critical advisory — and `triage-vulnerabilities.mjs`, `verify-dependency-audit.mjs`,
`verify-dependency-triage.mjs` and `verify-ci-parity --list` **all exited 0**, while advisories
**1240100** (`moderate`, `<1.1.21`) and **1240101** (`moderate`, `>=2.0.0 <2.1.7`) remained in the
effective graph.

Phase 33 selected `1.1.21` / `2.1.7` — the correct binding floor — and that selection is the *only*
thing preventing these from returning. A future maintainer who "simplified" the override to what
looks like the fix floor, or who read Phase 32's quoted `1.1.19` / `2.1.5`, would obtain green CI
with the moderate advisories present and no control objecting.

*Impact:* a silent regression path in the dependency posture. *Reproducibility:* demonstrated
end-to-end with a real install; the detection was by exit status of the security gates, not a setup
error. *Next action:* record the required floors in the override comment (already partially done) and
consider whether the triage gate should surface moderate advisories at reduced severity rather than
discarding them. **Not fixed by this review.**

### P34-2 — Vulnerable versions remain on disk in the working tree as orphaned virtual-store entries — **LOW** (new)

`node_modules/.pnpm/` in the main working tree still contains `brace-expansion@1.1.18`,
`brace-expansion@2.1.4` and `undici@6.28.0`. I walked every symlink under `node_modules`, `apps` and
`packages`: **no symlink resolves into any of them**, and the importers declare only the patched
versions. A clean install is clean (§9). Phase 33's claim that the vulnerable versions are absent from
the *effective graph* is therefore **true**; the *physical* presence in this working tree is a
by-product of pnpm's store reuse, not a loadable exposure.

*Impact:* hygiene; a naive on-disk scanner could report a false positive, and it slightly contradicts
an unqualified reading of "absent from the installed graph". *Reproducibility:* trivial.
*Next action:* `pnpm store prune` or a fresh install when convenient. **Not fixed by this review.**

### P34-3 — The override is workspace-wide and therefore also binds development dependencies — **LOW** (new)

`pnpm.overrides` in `pnpm-workspace.yaml` applies to the whole workspace. `brace-expansion` 1.x is
reached from `devDependencies` (`eslint`, `@nestjs/cli`), so a remediation motivated by a
production-reachable advisory also changes the build/lint toolchain. Here the change is benign —
the full regression passed and lint held at 55 errors / 69 warnings — but a production-intent override
can silently move a developer toolchain version, and that is not visible from the override's
`EXPLICIT` nature.

*Impact:* reproducibility/blast-radius awareness, not an observed defect. *Next action:* note the dev
reachability in the override comment. **Not fixed by this review.**

### P34-4 — "Production path" is a first-hop dependency check, not code-execution reachability — **INFO** (inherited)

`isProductionPath` (`triage-vulnerabilities.mjs:700`) only asks whether the first hop of an audit
path is a `dependencies` (not `devDependencies`) edge. No call site is traced, and optional/peer
edges, dynamic imports and `exports`-map reachability are not modelled. The gate's disposition text
is honest about this ("Whether the vulnerable function was invoked was not traced"), and its
fail-closed default limits the consequence. Recorded so that no reader upgrades "not reachable in the
dependency graph" into "not exploitable".

### P34-5 — No independent review exists for Phases 32 or 33 — **MEDIUM** (new, disclosed here first)

`SECURITY_REVIEW_PHASE_32.md` and `SECURITY_REVIEW_PHASE_33.md` do not exist. The only review of those
phases is this document, authored by their implementer (§2). This is the same condition the
repository correctly identified for Phases 25 and 26.

*Impact:* the CI remediation and the dependency remediation are both unassured by a second party.
*Next action:* commission an independent review of both phases. **This document cannot serve as it.**

### P34-6 — The triage gate's advisory count (48) differs from raw `pnpm audit` (92) without explanation at the point of use — **INFO** (new)

`triage-vulnerabilities.mjs` prints `advisories reported by pnpm audit : 48` while a live
`pnpm audit --json` reports 92. The gate filters before printing. A reader comparing the two could
suspect under-counting. *Impact:* traceability only. *Next action:* label the line to indicate it is
post-filter.

**Counts: 0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW, 1 INFO.**

---

## 16. Required Follow-Up

1. **Commission a genuinely independent review of Phases 32 and 33.** This document does not
   discharge it (P34-5). Highest priority.
2. **Decide whether moderate advisories should be gated or surfaced** (P34-1). At minimum, keep the
   `1.1.21` / `2.1.7` floors documented as required, not incidental, so a future edit does not
   "correct" them downward.
3. **Tidy the working tree's virtual store** when convenient (P34-2) — no security impact.
4. **Note the dev-dependency blast radius** of the workspace-wide override (P34-3).
5. **Independently review the remaining reachability dispositions** beyond the two `next` criticals,
   particularly the `tar` classification, and record the Windows-hosting and image-optimization
   preconditions somewhere that is re-checked when deployment configuration changes.
6. The five pre-existing review gaps (22, 23, 25, 26, 27) remain open and are unaffected by this
   review.

None of the above was performed here.

---

## 17. Final Disposition

**APPROVED WITH FINDINGS**

Basis, stated precisely:

- The Phase 32 root causes were real, correctly diagnosed, fixed at the root, and are verified green
  on a hosted runner. The security gate that Phase 32 declined to touch is byte-identical to its
  pre-remediation state.
- The Phase 33 remediation is genuine. Nine advisories across three transitive packages were removed
  from the effective dependency graph by version remediation, with 0 introduced, 0 suppressed, 0
  gates weakened, and 0 hand-waved dispositions. The binding version floors were independently
  re-derived and confirmed.
- Hosted run `36684252352` on the exact current `HEAD` is `success` with all five jobs and every
  security step **executed**, and the dependency-triage step is demonstrably blocking and not skipped.
- A clean checkout reproduces the same graph and passes the same gates.
- No CRITICAL or HIGH finding was identified. Two MEDIUM findings (P34-1, P34-5) and three LOW (P34-2,
  P34-3, plus the P34-4 INFO limitation) are open and were **not** fixed.

**This approval is a self-review and carries the weight of one.** It does not constitute independent
assurance for Phases 32 or 33, and it must not be cited as closing either phase's review requirement.
No staging, production, or production-readiness claim is made.

---

## 18. Post-Review Integrity Check

Every protected artifact re-hashed after the review and compared to the §3 baseline.

| Artifact | Result |
|---|---|
| `pnpm-lock.yaml` | **UNCHANGED** (`ccfa78db9184754cf7f9f4ac86353659`) |
| `pnpm-workspace.yaml` | **UNCHANGED** (`656abae051a73b60deba041dfa8f0a8c`) |
| `package.json` | **UNCHANGED** (`322568884835c4083f2eac29801fb1b4`) |
| `.github/workflows/ci.yml` | **UNCHANGED** (`3346692a0468e61148e21e4b1f8556c8`) |
| `apps/api/prisma/schema.prisma` | **UNCHANGED** (`4452c2a2cd00dc683930e164d6ec5a9c`) |
| Prisma migrations (tree) | **UNCHANGED** (`10f0a383c1124aaae490f77701b195eb`) |
| `PROJECT_PLAN-old.md` | **UNCHANGED** |
| `scripts/verify-ci-parity.mjs` | **UNCHANGED** (`7c79d38a9a69a7f3c1a3a25280c90784`) |
| `scripts/mutate-ci-integration.mjs` | **UNCHANGED** (`de10c626af29038aadd77e82b5fcb460`) |
| `scripts/triage-vulnerabilities.mjs` | **UNCHANGED** (`779c2283c50fef1b86ec9e819e6a11b8`) |
| `scripts/verify-dependency-audit.mjs` | **UNCHANGED** (`4a25b816bf5c761085008d1c86bc2538`) |
| `scripts/verify-config-contract.mjs` | **UNCHANGED** (`4ef391c94e1216ecaa3dff6f08983e27`) |
| `SECURITY_REVIEW_*` aggregate | **UNCHANGED** (`84b7065871c04e8977ebe97dab2093af`) |
| Historical phase reports aggregate | **UNCHANGED** (`e1dd0659b643f200eddbdc005680f245`) |
| Application source | **UNCHANGED** — no tracked modifications at all |
| `HEAD` / `origin/main` | `5b841eb` / `5b841eb`, divergence `0 0` |
| Staged / tracked-modified / stash | 0 / 0 / 0 |
| Reflog | unchanged; no commit, push, rebase, reset, amend, or stash |
| Working-tree fingerprint | baseline `ddf509126a948fb3f9c7de7597d535db` → after `f26204af3ec47ec898a3672ad9aee8e9`. The **only** difference is the addition of this one permitted untracked file; no tracked path changed and no pre-existing untracked path was added, removed, or modified |
| Developer `ecc` database | intact, 14 users; never targeted |
| Throwaway containers / volumes | none remaining; all attack mirrors and clean checkouts removed |
| Files created | **`SECURITY_REVIEW_PHASE_34.md` only** |
| Files modified | **none** |

---

*Review conducted against `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` with network access to the npm
registry and the GitHub Actions API. No finding was fixed. No protected artifact was modified. No
commit, push, rebase, reset, amend, or stash occurred. This document was written by the implementer
of Phases 32 and 33 and is therefore a self-review, not independent assurance.*
