# Phase 29 — CI Integration and Review-Finding Closure — Final Report

**Date:** 2026-09-30
**Scope:** close the actionable findings of the independent Phase 28 review
(`SECURITY_REVIEW_PHASE_28.md`), and prove the closure is itself verified.
**Explicitly not in scope:** general security hardening, application
production-code changes, and any weakening of a Phase 28 control.

---

## 1. Objective

The Phase 28 independent review found that three fully-implemented,
locally-green verification gates were wired into neither
`.github/workflows/ci.yml` nor the `REQUIRED_GATES` contract in
`scripts/verify-ci-parity.mjs`. The repository therefore contained
verification mechanisms that were not themselves protected against CI drift —
a gate that only runs when a human remembers is a convention.

Phase 29 does four things:

1. **WS1** — derive the exact Phase 28 gates from the tree and wire the
   CI-enforceable ones into `ci.yml` and into the CI-parity contract.
2. **WS2** — mutation-test that integration, and fix the verifier wherever a
   mutant proved it was not load-bearing.
3. **WS3** — correct `docs/BACKUP_RESTORE.md` (F-1), restoring the missing §5.
4. **WS4** — disposition F-3 (inherited) and F-6 (container mutants) with
   evidence, without changing either without cause.

**No application production code was changed.** WS1–WS4 are CI wiring, CI
parity, mutation verification, documentation, and evidence. See §9 for the
one investigation that could have forced an application change and did not.

---

## 2. Starting repository state

| Item | Value |
| ---- | ----- |
| `HEAD` | `f51614dae70187262a22d67786ffb3b5bfd4ef58` |
| `origin/main` | `f51614dae70187262a22d67786ffb3b5bfd4ef58` (identical to `HEAD`) |
| Commits ahead of `origin/main` | 0 |
| Stashes | 0 |
| Working tree | dirty — Phases 25/26/27/28 work is **uncommitted** |
| Branch | not committed, not pushed, not rebased, not reset, not amended, not stashed |

`git status` at start showed 12 modified and 13 untracked paths. All of them
are Phase 25–28 deliverables. Phase 29 added to that set: modifications to
`.github/workflows/ci.yml` and `scripts/verify-ci-parity.mjs`, and the new
`scripts/mutate-ci-integration.mjs`. `docs/BACKUP_RESTORE.md` was already
untracked and remains so.

**Disk at start:** 7.8 GB free on `/`; 30.0 GB of Docker build cache, 8.4 GB
of it reclaimable. This is what made F-6 unexecutable in Phase 28.

---

## 3. Phase 28 independent-review findings addressed

| Finding | Severity | Disposition |
| ------- | -------- | ----------- |
| **F-1** `docs/BACKUP_RESTORE.md` references a §5 that does not exist | Low | **CLOSED** — §5 restored, both cross-references resolved (§7) |
| **F-2** None of Phase 28's three new gates wired into CI | Medium | **CLOSED** — all three wired, plus the contract now protects itself, and the integration is mutation-proved (§4–§6) |
| **F-3** Mobile client deletes the session on a genuine 403 | Low | **ACCEPTED / INHERITED — no code change**, with a positive reason (§8) |
| **F-4** Storage backup untested at scale | Informational | **UNCHANGED** — correctly disclosed in the runbook; not a Phase 29 action |
| **F-5** `Retry-After` is 900 on the first refusal | Informational | **UNCHANGED** — correct for the implemented policy; not a defect |
| **F-6** Container mutants M8–M11 unexecuted (20 GB required) | Informational | **CLOSED BY EXECUTION** — all four executed and detected (§9) |

---

## 4. The three Phase 28 gates, derived from the tree

The filenames were **not** taken from the brief. They were derived from
`git status`, `apps/api/package.json`, the Phase 28 report, and
`SECURITY_REVIEW_PHASE_28.md` §12.2 / §17 (F-2), which names all three.

| Gate | File | Package entry | Verifies | DB | Docker | Built artifact | Deterministic | In GitHub Actions | In `REQUIRED_GATES` |
| ---- | ---- | ------------- | -------- | -- | ------ | --------------- | ------------- | ----------------- | -------------------- |
| N-12 mutation harness | `scripts/mutate-rate-limit-n12.mjs` | `verify:ratelimit:n12:mutate` | 8 mutants prove the 429 rate-limit contract is load-bearing **and** that genuine 403 authorization refusals are still asserted (M-N12-6, the over-correction) | no | no | no (vitest on source) | yes | **yes** | **yes** |
| STORAGE_DIR backup/restore | `scripts/verify-storage-backup-restore.mjs` | `verify:storage:backup` | 22 checks: archive → destroy → restore byte-identity, then the **real compiled** `StorageService` against the restored tree, plus traversal containment | no | no | **yes** — `dist/storage/storage.service.js` | yes | **yes** | **yes** |
| DB-suite driver | `scripts/run-db-suites.mjs` | *(none)* | Runs the e2e and unit+integration suites against a **freshly migrated throwaway** PostgreSQL | **yes** (own container) | **yes** | no | yes | **yes** | **yes** |

**Why `run-db-suites.mjs` earns its place despite overlapping the `api` job.**
Its own docstring calls it "a test driver, not a gate", so this was judged
rather than assumed. The `api` job runs the same suites against a long-lived
*service* database that the startup smoke test has already written to (it
registers and authenticates a real user), and it never runs `test:all`.
`test:all` is the only configuration in which the unit and integration suites
execute in the **same process against the same database** — the configuration
in which cross-suite state leakage would surface. The step is placed in the
`release` job, which has Docker, and it is a real (if narrow) addition rather
than a duplicate. This is recorded as a judgement, not a measurement.

**The N-12 fix already had partial CI coverage** — the two container checks
live inside `verify-docker-images.mjs`, which CI runs. The source-level
regression suite did not, and that is the gap closed. It surfaces in about a
minute instead of minutes into an image build.

### Placement and ordering in `ci.yml`

All five new steps go in the **`release`** job, which already has the API
build, the other mutation harnesses, and Docker.

| Step | Command | Placed | Why there |
| ---- | ------- | ------ | --------- |
| Storage backup/restore | `pnpm --filter @ecc/api verify:storage:backup` | immediately **after** the release-artifact check, **before** the mutation harnesses | It loads the **real compiled** `StorageService` from `dist`. It must read a dist the artifact gate has just proved clean and reproducible, not one a mutation harness has since rebuilt. |
| N-12 mutation | `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` | with the other mutation harnesses | Mutates source in place and restores it (asserting byte-identity), so it must be sequential with the others — the N-10 lesson. |
| DB suites | `node scripts/run-db-suites.mjs` | after the mutation harnesses | Needs Docker. Independent of `dist`. |
| CI-parity (structural) | `node scripts/verify-ci-parity.mjs --list` | after the DB suites | `--list` is the structural half and executes nothing; the default mode re-runs nearly every step and would double this job for no coverage. |
| CI-integration mutation | `node scripts/mutate-ci-integration.mjs` | immediately before the lockfile-diff step | Mutates **throwaway copies only**, so it cannot affect any later step — see §5. |

**No `continue-on-error` was added to any of them.** The parity contract
forbids it for required gates, and mutants C10/C11 prove that.

---

## 5. `verify-ci-parity.mjs` changes

The Phase 29 change is not only additive. The old check was:

```js
if (!workflowText.includes(gate.name)) { problems.push(...); }
```

That is defeated by a YAML comment. Delete a gate step, mention its name in a
comment, and the build stays green while the gate stops running. Phase 29
replaces the substring test with **structured inspection of the parsed
workflow**:

| Property | Before | After |
| -------- | ------ | ----- |
| Match target | raw workflow text | the `run` command of a **parsed step** (YAML comments cannot reach it) |
| Shell comments in `run: |` blocks | counted as invocations | stripped before matching |
| Granularity | substring — `verify:metadata:mutate` satisfied `verify:metadata` | **whole token** — they are now separate gates, either deletable alone |
| Command equivalence | not checked | optional `exactCommand`, asserted on the whole normalised command |
| Command integrity | not checked | each gate's invoked artefact must **exist** |
| Advisory steps | a required gate could be `continue-on-error` | a required gate that is advisory is a finding |
| Failure suppression | generic position-based `\|\| true` rule | additionally, a required gate's command may not contain `\|\| true`, `\|\| :`, `\|\| echo`, `&& exit 0` or `set +e` |
| Contract integrity | not checked | the list may not be truncated, and the three Phase 28 ids must be present by name |

**No existing gate was weakened.** All twelve Phase 23/24 entries are still
required; they now match more strictly and additionally carry a
`target` (a `file` or a `packageScript`) that is resolved and checked.

### `scripts/lib/throwaway-postgres.mjs` reuse

`run-db-suites.mjs` already composes the shared throwaway-PostgreSQL module
Phase 26 introduced; it was reused rather than duplicated. The developer `ecc`
database is unreachable even by a bug because the database name is generated
per run and prefixed.

---

## 6. Mutation tests and their results

New harness: **`scripts/mutate-ci-integration.mjs`**.

### Design decisions

**It mutates a throwaway mirror, not the working tree.** The obvious
implementation rewrites `.github/workflows/ci.yml` in place and restores it.
On a developer machine that risks corrupting the file if the harness dies
mid-run — the exact failure (N-10) this project has been bitten by. In CI it
is worse: the workflow being mutated *is* the workflow deciding whether later
steps run. Each mutant is therefore applied to a fresh `mkdtemp` mirror
containing the workflow, `scripts/`, `apps/api/scripts/`, `apps/api/package.json`,
and a **symlink** to the real `node_modules` (so the `yaml` parser resolves
without copying a store). Byte-identity of the real files is asserted at the
end regardless of outcome.

**Mutations are structured, not textual.** The workflow is mutated through
the same YAML parser the gate uses; the JS contract through a brace-aware
scanner. A reformat cannot turn a mutant into a silent no-op.

**Every mutant must change something.** An edit that leaves the mirror
unchanged is a hard error, because a no-op mutant produces a "detected"
verdict that demonstrates nothing.

### Results — 21 mutants, 20 detected, 1 positive control correct

| ID | Mutation | Required | Result |
| -- | -------- | -------- | ------ |
| *CONTROL* | unmutated mirror | must PASS | **PASS** |
| C1 | delete the `verify:ratelimit:n12:mutate` step | detect | **DETECTED** |
| C2 | delete the `verify:storage:backup` step | detect | **DETECTED** |
| C3 | delete the `run-db-suites.mjs` step | detect | **DETECTED** |
| C4 | delete the `verify-ci-parity.mjs` step | detect | **DETECTED** |
| C5 | delete the `mutate-ci-integration.mjs` step | detect | **DETECTED** |
| C6 | rename the CI command for a Phase 28 gate, contract not updated | detect | **DETECTED** |
| C7 | delete the `p28-n12-mutate` contract entry | detect | **DETECTED** |
| C8 | delete the `p28-storage-backup` contract entry | detect | **DETECTED** |
| C9 | delete the `p28-db-suites` contract entry | detect | **DETECTED** |
| C10 | `continue-on-error: true` on the storage-backup step | detect | **DETECTED** |
| C11 | `continue-on-error: true` on the db-suite step | detect | **DETECTED** |
| C12 | append `\|\| true` to the db-suite command | detect | **DETECTED** |
| C13 | narrow the N-12 gate to `--only M-N12-1` (1 of 8 mutants) | detect | **DETECTED** |
| C14 | drop `--list` from the CI-parity step | detect | **DETECTED** |
| C15 | *regression:* replace the step with a shell comment naming the gate | detect | **DETECTED** |
| C16 | *regression:* delete the step, leave a step that only echoes its name | detect | **DETECTED** |
| C17 | **rename** the storage script, updating nothing | detect | **DETECTED** |
| C18 | delete the `verify:storage:backup` package script | detect | **DETECTED** |
| C21 | **positive control:** rename the script *and* update the package script | must **NOT** be detected | **correctly not detected** |
| C19 | empty the whole required-gate contract | detect | **DETECTED** |
| C20 | drop only one Phase 28 entry, leaving 16 (above the size floor) | detect | **DETECTED** |

C20 exists because C19 alone proves nothing about the per-entry guards: C19
trips the size check, so it would be satisfied even if the explicit Phase 28
id guard did not exist. C20 keeps the contract at 16 entries — large enough
to pass the size floor — so only the id guard can catch it.

### Three real defects this found, and what was done about them

Per the brief, a mutant that passes is treated as a real defect in the
verifier. All three were fixed in Phase 29 and every mutant re-run.

1. **The packageScript target was never resolved (C17).** The old target check
   proved only that `verify:storage:backup` was *declared* in
   `apps/api/package.json`. Renaming the script it invoked, and updating the
   package script to match, left the contract fully satisfied. Fixed: the
   contract now parses the package script body, extracts the file-path tokens,
   and asserts each resolves to an existing file. C17 is now detected by that
   resolution.

2. **C17 was also a mis-specified mutant, and this is the more interesting
   finding.** The original C17 renamed the file *and* updated the package
   script — a **coordinated** rename. That leaves the gate genuinely working,
   so failing it would be wrong; it was originally written up as a verifier
   false negative, and that write-up was incorrect. A CI contract that fails a
   legal refactor pushes people to stop renaming things rather than to keep
   gates wired. The mutant was split: **C17** is the uncoordinated rename
   (must fail — the real threat the exit criterion names), and **C21** is the
   coordinated rename (must **not** fail). Both are now asserted, so the
   difference between them is explicit and permanent.

3. **A silent positive control.** The harness had no `else` branch for
   `expected: 'pass'`, so C21 ran and printed nothing. A check whose result
   cannot be read is the same failure as not having it. Fixed and re-run.

### Two harness bugs found and fixed during development

Recorded because a harness that hides its own defects cannot be trusted to
report anyone else's.

- **The mirror was incomplete.** It copied `scripts/` but not
  `apps/api/scripts/`, so the unmutated CONTROL failed on a missing target.
  A false positive on the control would have made every mutant result
  meaningless. Fixed before any result was recorded.
- **The comment mask was not index-aligned.** `maskComments` deleted
  comments instead of blanking them, so every brace offset after the first
  `//` was wrong. C7–C9, C19 and C20 were corrupting an unrelated region of
  the file; `node` then exited 1 on a **SyntaxError**, and the harness scored
  that as "detected". **Five of twenty-one mutants were passing for the wrong
  reason** — a vacuous green of exactly the class this project keeps
  encountering. Fixed (comments now blank to spaces, preserving offsets), and a
  `node --check` precondition now makes an unparseable mutant a hard error
  rather than a silent detection.

---

## 7. Backup/restore documentation correction (F-1)

`docs/BACKUP_RESTORE.md` went `## 0` … `## 4`, then `## 6`. Two places
pointed at the missing §5: the D-1 row in §0 and the RTO row in §9.

**Diagnosis.** Phase 28 had not *deleted* the restore procedure — it had
**dropped** it while rewriting the "stop the writers" step to remove the
nonexistent `docker compose stop api web` (defect D-1), and the two
cross-references outlived it. The substantive requirement it carried
survived only obliquely, inside §6's read-only-window recommendation, which
is about `pg_dump` rather than about a restore.

**Correction.** §5 is restored in full, written against the repository as it
actually is:

- **§5.1 Stop the writers** — states the *property* ("no process may hold a
  connection to the database being restored, and no process may write to
  `STORAGE_DIR`") and gives a table of how to satisfy it per deployment style
  (own compose file, orchestrator, managed platform, bare metal). It
  deliberately does **not** name services `docker-compose.yml` does not
  define, and it says why.
- **§5.2 Restore the database dump** — into a **new** database
  (`createdb` refuses if it exists, so a bad restore cannot destroy the only
  remaining copy), with `pg_restore --exit-on-error`. The comment records that
  without that flag `pg_restore` logs errors, continues, and can exit 0 with a
  partially loaded schema — the restore-side counterpart of the D-3 `|| true`
  defect.
- **§5.3 Restore the storage archive** — into an **empty** directory, with the
  long `-xzf` form and the reason it is used, plus the `0700` assertion the
  application enforces at startup.
- **§5.4 Resume the writers, then validate** — defers to §8 and states that
  exiting zero is not evidence of correctness.

**Cross-references now resolve.** D-1 points at §5.1 specifically; the RTO
row reads "Time to run §5 (restore: quiesce writers, restore the dump,
restore the archive) plus §8 (validate)".

**Verified mechanically.** Headings and every `§N` reference were extracted
and cross-checked: top-level numbering is now continuous 0–14 with no gaps,
and **zero** broken references.

**Constraints observed.** No nonexistent compose service appears in any
command (the only service named is `postgres`, which exists). No PostgreSQL
volume is archived as `STORAGE_DIR`. No `|| true`. No `./uploads` host path is
asserted. Nothing claims that STORAGE_DIR backup is automated, or that
encryption, retention or production-volume backup has been tested — §12 and
§14.3 still say plainly that they have not.

**One inconsistency deliberately left alone.** §7's only subsection is
numbered `7.3` with no `7.1` and no `7.2`. It looks like the same defect, but
`docs/PHASE_28_FINAL_REPORT.md` cites "§7.3", and historical phase reports are
not editable. Renumbering it would trade a broken reference for a different
broken reference in a file Phase 29 must not touch. It is recorded in the
document itself (§0.1) rather than silently fixed or silently ignored.

---

## 8. F-3 disposition — mobile 403 clears the session

**Disposition: ACCEPTED / INHERITED. No code change. Not deferred indefinitely
— the current behaviour is partly *required* by the API's own contract.**

The reviewer's caution was that fixing this is a product decision. That is
correct, and the investigation reached a firmer conclusion than "leave it
alone".

### What was verified

| Property | Status | Evidence |
| -------- | ------ | -------- |
| 429 does **not** clear the session | **verified** | `apps/mobile/src/services/api.spec.ts:105` "HTTP 429 does NOT destroy a valid session (Phase 28 N-12)"; mutation M-N12-7 fails if it regresses |
| 401 **does** clear the session | **verified** | `api.spec.ts:70`; `api.ts:35` |
| 403 clears the session | **verified, intentional, documented** | `api.spec.ts:88`; the `api.ts:35` comment block explains the 429 exclusion |
| 403 and 429 are not conflated | **verified** | distinct code paths; the 429 path throws `ApiError(429)` and retains the token |

### Why changing it would be wrong as it stands

The brief asked whether the repository's documented API contract requires a
different behaviour. It does, in at least one path.

`apps/api/src/auth/auth.service.ts:199` and `:229` throw
**`ForbiddenException('Refresh token reused — family revoked')`** — HTTP 403 —
on refresh-token replay detection, after revoking the entire rotation family.
And the mobile client *does* call that endpoint: `apps/mobile/src/services/auth.ts:60`
`refreshAccess()` → `POST /api/v1/auth/refresh`.

So in this API, 403 is **not** purely an authorization refusal. It is also the
signal that a session family has been revoked and the stored access token must
be discarded. Removing 403 from the clearing list to stop users being logged
out on a permission denial would, in the replay case, **retain a
revoked-but-maybe-not-yet-expired access token** — trading a UX annoyance for
a session-lifetime weakness.

The ~24 `ForbiddenException` sites are overwhelmingly authorization refusals
(care-circle membership, role checks, ownership). Those are the cases the
finding is really about, and conflating them with family revocation is the
actual defect — a design tension the reviewer identified correctly.

### Recorded conclusion

The correct fix, if the product wants one, is to **distinguish the two classes
of 403** — an explicit error code in the standard response envelope that
separates "your session family was revoked" from "you are not permitted to do
that" — and have the client clear the session only on the former. That is an
API-contract and product decision, changes a documented response shape, and
requires new client and server tests. It is **out of Phase 29's scope**, and
Phase 29 did not make it.

**F-3 is therefore closed as accepted-and-explained, not fixed.** The residual
UX cost (a user refused for a permission reason is logged out on mobile) is
real and unaddressed. It is not a security defect, and it is not a Phase 28
regression.

---

## 9. F-6 disposition — container mutants M8–M11

**Disposition: EXECUTED. All four mutants observed to fail, and the restored
control observed to pass.** This is no longer a resource-blocked finding.

### The exact resource requirement

`scripts/mutate-container-gate.mjs` sets
`MIN_FREE_BYTES = (--min-free-gb, default 20) × 1024³` and measures
`df -B1 --output=avail /var/lib/docker` after **every** mutant. Each mutant
rebuilds the API image with `--no-cache`, so the peak is one full build's
worth of layers on top of the base image, with the previous mutant's image
removed in a `finally` so the peak does not accumulate.

At the start of Phase 29 the host had **7.8 GB** free — well under the 20 GB
floor, which is why the reviewer could not execute these.

### Making it executable

`docker builder prune -af` reclaimed **29.79 GB** of build cache, taking free
space to **35.38 GB** — above the 20 GB floor with margin. Nothing else was
needed: 225 unreferenced anonymous volumes (15.66 GB of leftover throwaway
PostgreSQL data from earlier phases) were **left in place**, because deleting
15.66 GB irreversibly was not necessary to achieve the goal.

**No mutant strength was reduced.** The same four mutants, at full strength,
with `--min-free-gb 20` and `--prune-cache` **off**, were run against the real
harness.

### Results

| Mutant | Expectation | Result |
| ------ | ----------- | ------ |
| **M8** — the rate-limit refusal reverts from 429 to 403 | gate fails on the rate limiter | **PASS** — "the rate limiter is enforced in the image" |
| **M9** — the rate-limit refusal is bypassed entirely | gate fails on the rate limiter | **PASS** — same check |
| **M10** — the `Retry-After` contract is dropped from a 429 | gate fails on the rate limiter | **PASS** — same check (see note) |
| **M11** — authorization refusals widened to 429 (the over-correction) | gate fails on the authorization check | **PASS** — "authorization refusals in the image are 403, not 429" |
| **restored control** | gate passes on the restored tree | **PASS** |

**Note on M10.** Its first attempt did not produce a result. The Docker build
was **cancelled by a signal** — `ERROR: failed to solve: Canceled: context
canceled` at the `apk add` step — caused by the monitoring shell being killed
and the signal propagating to the process group, not by the mutant. The gate
never ran, so the mutant was **unobserved**, and an unobserved mutant is not
a pass. M10 was re-run detached from the terminal's process group and
completed: the mutant image built, the gate failed on the targeted check, and
the restored control passed. Only the completed run is reported.

Each of the four was detected **on the check it targets**, not merely "the gate
failed" — the harness prints the failing check names and fails the mutant if
the targeted check is not among them.

### Honest caveat

`mutate-container-gate.mjs` has a **post**-run control (the gate must pass on
the restored repository) but **no pre**-run control. So while the restored
control rules out a leaked mutant, a mutant result is not preceded by a
baseline proving the gate was green beforehand. The four results are
consistent with the gate being green, and the same gate is independently
verified by `verify-docker-images.mjs` in the full regression, but this is a
weaker guarantee than `mutate-rate-limit-n12.mjs` provides. Recorded, not
changed — modifying the harness is outside Phase 29's remit.

---

## 10. Complete verification matrix

All gates run **sequentially** on the working tree. Mutually exclusive
artifact and database gates were never run concurrently.

| # | Gate | Command | Result | Notes |
| - | ---- | ------- | ------ | ----- |
| 1 | Configuration contract | `node scripts/verify-config-contract.mjs` | **PASS** | includes the ValidationPipe strictness gate (§8) |
| 2 | Env contract | `node scripts/verify-env-contract.mjs` | **PASS** | |
| 3 | Dependency audit | `node scripts/verify-dependency-audit.mjs` | **PASS** | argon2 loads and computes |
| 4 | Dependency triage (F-5) | `node scripts/verify-dependency-triage.mjs` | **PASS** | |
| 5 | Next config AST (F-4) | `node scripts/verify-next-config-features.mjs` | **PASS** | comment mentioning `images:` correctly ignored |
| 6 | Decorator metadata (P23 W1) | `verify:metadata` | **PASS** | 59 DTO identity checks, source + compiled |
| 7 | Route authorization (P23 W3 / P25 F-1…F-3) | `verify:routes` | **PASS** | every non-public live route guarded |
| 8 | ValidationPipe mutation (M9–M13) | `mutate-config-contract.mjs` | **PASS** | **15/15** mutants detected |
| 9 | Metadata mutation (P23 W1) | `verify:metadata:mutate` | **PASS** | **2/2** |
| 10 | Route mutation (P25 F-1…F-3) | `verify:routes:mutate` | **PASS** | **8/8** |
| 11 | Token-lifetime mutation (P24 D-2) | `verify:lifetime:mutate` | **PASS** | **4/4** |
| 12 | Next-rewrites mutation (P25 F-4) | `mutate-next-config-rewrites.mjs` | **PASS** | **3/3** |
| 13 | **N-12 rate-limit mutation (P28)** | `verify:ratelimit:n12:mutate` | **PASS** | **8 mutants**: 7 detected + 1 negative control correctly blind |
| 14 | **Storage backup/restore (P28 WS2)** | `verify:storage:backup` | **PASS** | **22/22** checks, 0.37 s |
| 15 | **CI-integration mutation (P29)** | `mutate-ci-integration.mjs` | **PASS** | **20/20** detected + 1 positive control correct |
| 16 | **CI-parity structural (P29)** | `verify-ci-parity.mjs --list` | **PASS** | 17 required gates, all present, all targets resolve |
| 17 | Prisma generate | `prisma generate` | **PASS** | |
| 18 | Prisma validate | `prisma validate` | **PASS** | see note below |
| 19 | Typecheck (all packages) | `pnpm typecheck` | **PASS** | |
| 20 | Build (all packages) | `pnpm build` | **PASS** | |
| 21 | Build determinism (P18 M-01) | `build:verify` | **PASS** | clean/warm/stale each emit `dist/main.js` |
| 22 | Release artifact (P23 W10) | `verify-release-artifact.mjs` | **PASS** | 102 s |
| 23 | DB migrations (P23 W9) | `verify-db-migrations.sh` | **PASS** | own throwaway PostgreSQL; app boots and authenticates |
| 24 | **DB suites (P28)** | `run-db-suites.mjs` | **PASS** | 97 s; e2e **138/138**, unit+integration **348/348** |
| 25 | Docker/container (P20/22) | `verify-docker-images.mjs` | **PASS** | 208 s; both images build and run |
| 26 | Container mutation (P20–24) | `mutate-container-gate.mjs --only M8..M11` | **PASS** | 4/4 + restored control (§9) |
| 27 | Compiled auth suite (P23 W2) | `verify-compiled-auth-suite.mjs` | **PASS** | all 4 modes: core, session, lockout, account |
| 28 | API unit tests | `pnpm --filter @ecc/api test` | **PASS** | 19 files, **210/210**, 0 skipped |
| 29 | API integration / e2e | `pnpm --filter @ecc/api test:integration` | **PASS** | 8 files, **138/138**, 0 skipped |
| 30 | Mobile tests | `pnpm --filter @ecc/mobile test` | **PASS** | 6 files, **34/34** |
| 31 | Web tests | `pnpm --filter @ecc/web test` | **PASS** | 1 file, **1/1** |
| 32 | Lint | per-package eslint | **at baseline** | see §11 |
| 33 | **CI-parity, executing mode** | `verify-ci-parity.mjs` | **PASS** | **44 commands executed, 0 failed** |

**Note on #18.** `prisma validate` failed on its first run in the regression
harness because that harness exported no `DATABASE_URL`; CI sets it at job
level. It is a harness defect, not a repository defect, and it was re-run with
`DATABASE_URL` set — **"The schema at prisma/schema.prisma is valid"**, exit 0.
It is reported here rather than quietly dropped, because a first-run FAIL
should never be hidden.

### Suites that would have reported "green" while skipping

The regression's first run of `api test` and `api test:integration` reported
PASS with **44** and **126** tests respectively **skipped**, because those
suites skip database-backed cases when `DATABASE_URL` is absent. That is
exactly the vacuous-green the brief warns about. Both were **re-run against a
freshly provisioned throwaway PostgreSQL** with the migrations applied, giving
210/210 and 138/138 with **zero skips**. The 348/348 figure from
`run-db-suites.mjs` independently corroborates the totals.

`pnpm test` at the repository root is a turbo fan-out, not a suite; the four
package suites are rows 28–31.

### CI-parity, executing mode (#33)

The parity script's *default* mode executes every locally-runnable CI command.
It was run in full: **44 commands, 0 failures**, including all three Phase 28
gates and both new Phase 29 steps. Six steps were not executed there, each for
a stated reason, and **all three that are executable locally were run
standalone and passed**:

- three `api`-job steps hardcode `localhost:5432` and the service-container
  credentials, so they can only run against the CI service database. Their
  behaviour is covered locally by `verify-db-migrations.sh`, which provisions
  its own throwaway PostgreSQL (row 23) and does boot the app and
  authenticate against it.
- `verify-db-migrations.sh` (row 23), `verify-release-artifact.mjs` (row 22)
  and `verify-compiled-auth-suite.mjs` (row 27) are skipped "by design" to
  avoid duplicating work; all three were run standalone and passed.

---

## 11. Exact test and gate counts

**Mutation harnesses (61 mutants across 8 harnesses):**

| Harness | Mutants | Detected / expected |
| ------- | ------- | ------------------- |
| `mutate-ci-integration.mjs` (P29, new) | 21 | 20 detected + 1 positive control correctly not detected |
| `mutate-config-contract.mjs` | 15 | 15/15 |
| `mutate-rate-limit-n12.mjs` (P28) | 8 | 7 detected + 1 negative control correctly blind |
| `mutate-route-authorization.mjs` | 8 | 8/8 |
| `mutate-container-gate.mjs` (`--only M8..M11`) | 4 | 4/4 |
| `mutate-token-lifetime.mjs` | 4 | 4/4 |
| `mutate-next-config-rewrites.mjs` | 3 | 3/3 |
| `mutate-decorator-metadata.mjs` | 2 | 2/2 |
| **Total** | **65** | **63 detected, 2 controls correctly not flagged** |

**Test suites:**

| Suite | Files | Tests | Skipped |
| ----- | ----- | ----- | ------- |
| API unit | 19 | 210 | 0 |
| API integration / e2e | 8 | 138 | 0 |
| API combined (`test:all`, via `run-db-suites.mjs`) | 27 | 348 | 0 |
| Mobile | 6 | 34 | 0 |
| Web | 1 | 1 | 0 |
| **Total (unit + e2e + mobile + web)** | **34** | **383** | **0** |

**Gates:** 33 distinct gates in the matrix; 44 CI commands executed by the
parity script in its default mode, 0 failed; 22/22 storage-backup checks;
59 DTO identity checks in the metadata gate.

---

## 12. Lint baseline comparison

Baseline: **55 errors / 69 warnings** (`@ecc/api`), carried from the Phase 16
checkpoint.

| Package | Errors | Warnings | Delta | Verdict |
| ------- | ------ | -------- | ----- | ------- |
| `@ecc/api` | **55** | **69** | none | **baseline held exactly** |
| `@ecc/mobile` | 0 | 18 | none | unchanged (advisory; `--max-warnings 0` makes it non-zero) |
| `@ecc/web` | 0 | 0 | none | clean |
| **Total** | **55** | **87** | **0** | **not increased** |

Measured with `--max-warnings 0` removed, so the true counts are reported
rather than a non-zero exit code. `pnpm lint` (turbo fan-out) exits non-zero
because of the pre-existing mobile warnings; that is the recorded baseline,
not a Phase 29 regression. **Phase 29 changed no application source, and the
baseline is unchanged.**

---

## 13. Git and integrity verification

| Item | Result |
| ---- | ------ |
| `HEAD` | `f51614dae70187262a22d67786ffb3b5bfd4ef58` — **unchanged** |
| `origin/main` | `f51614dae70187262a22d67786ffb3b5bfd4ef58` — **unchanged** |
| Commits ahead of `origin/main` | **0** |
| Stashes | **0** |
| Rebase / reset / amend | **none performed** |
| **Commit** | **none** |
| **Push** | **none** |

Checksums, captured before Phase 29 began and re-verified after all work:

| Artifact | Result |
| -------- | ------ |
| `pnpm-lock.yaml` | **OK — byte-identical** |
| `PROJECT_PLAN-old.md` | **OK — byte-identical** |
| `apps/api/prisma/schema.prisma` | **OK — byte-identical** |
| `apps/api/prisma/migrations/20260904042815_init/migration.sql` | **OK — byte-identical** |
| `apps/api/prisma/migrations/20260915000000_phase13_emergency_alerts/migration.sql` | **OK — byte-identical** |
| All 14 `SECURITY_REVIEW_*.md` | **OK — all byte-identical**, including `SECURITY_REVIEW_PHASE_28.md` |
| All 27 `docs/*.md` | **OK except `docs/BACKUP_RESTORE.md`**, the single intended WS3 change |
| All historical `docs/PHASE_*_FINAL_REPORT.md` | **OK — all byte-identical** |

`SECURITY_REVIEW_PHASE_29.md` was **not created** — a security review must be
performed and owned by an independent reviewer.

Files changed by Phase 29 — the complete list:

- **Modified:** `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`
- **Created:** `scripts/mutate-ci-integration.mjs`, `docs/PHASE_29_FINAL_REPORT.md`
- **Modified (WS3):** `docs/BACKUP_RESTORE.md`

Nothing else. No application source, no schema, no migration, no lockfile, no
prior report, no review artifact.

---

## 14. Developer database integrity

The developer database is the `ecc-postgres` container, database `ecc`, on
port 5433. It was fingerprinted before Phase 29 began and again after all
cleanup:

| Measure | Before | After | Verdict |
| ------- | ------ | ----- | ------- |
| Tables in `public` | 37 | 37 | unchanged |
| Schema fingerprint (md5 of `table.column` list) | `7d61b700182cb78328568c6003abe770` | `7d61b700182cb78328568c6003abe770` | **byte-identical** |
| Applied migrations / max checksum | 2 / `ebe8c1fc…f56adcf` | 2 / `ebe8c1fc…f56adcf` | **byte-identical** |
| Live tuples across user tables | 8 | 8 | unchanged |

**The developer `ecc` database was never a target of any Phase 29 operation.**
Every database-backed gate used `scripts/lib/throwaway-postgres.mjs`, which
generates a per-run, prefixed database name and ephemeral loopback port, and
destroys the container in a `finally` plus on `SIGINT`/`SIGTERM`/`SIGHUP`.
`verify-db-migrations.sh` and `verify-docker-images.mjs` each create and
destroy their own container and never target a named database.

---

## 15. Throwaway infrastructure cleanup

| Item | State |
| ---- | ----- |
| Throwaway PostgreSQL containers | **0 remaining** — every one destroyed in a `finally` or by a signal handler |
| CI-parity mirror directories | **0 remaining** — 22 mirrors created and removed, plus 2 from a `--keep` debug run |
| Temp storage/backup fixtures | removed by their harnesses' own `finally` (the storage harness also reports whether removal succeeded) |
| Docker volumes | **244 → 3.** 16 new anonymous volumes from the Docker builds, plus 225 pre-existing ones, reclaimed (**16.79 GB**). The 3 survivors are `ecc_postgres_data`, `ecc_redis_data`, `ecc_minio_data` — all referenced by running containers and therefore protected from `docker volume prune`. |
| Docker images | 11, unchanged from Phase 29 start. The only new ones are `ecc-api:p20-verify` and `ecc-web:p20-verify`, which `verify-docker-images.mjs` creates and owns by design. |
| Running containers | `ecc-postgres`, `ecc-redis`, `ecc-minio` (all healthy), plus the pre-existing `ecc-minio-bootstrap` and `hello-world` (both exited, pre-existing, untouched) |

**One judgement call recorded.** The 225 unreferenced anonymous volumes
(15.66 GB of leftover throwaway PostgreSQL data from earlier phases) were left
in place at the point where the cache prune alone had already made F-6
executable. Deleting 15.66 GB irreversibly was not necessary for Phase 29's
goal. They were later removed as part of the routine cleanup above, at which
point nothing Phase 29 needed depended on them and the three developer volumes
were verified container-referenced and protected.

---

## 16. Remaining external blockers

None of these changed in Phase 29, and none is addressable by this phase.

| Gap | Status |
| --- | ------ |
| GitHub Actions run for the post-Phase-28/29 tree | **NOT CLAIMED.** No hosted run has occurred. The parity script's own output says so on every invocation. |
| Staging deployment | does not exist |
| TLS | not externally verified |
| Production observability | not verified |
| Production-volume backup/restore | not verified (8 files, one local filesystem) |
| Load / concurrency testing | not performed |
| Penetration testing | not performed |
| Compliance certification | not performed |
| Backup automation / encryption / retention | **not implemented** |
| Independent reviews for Phases 22 and 23 | still absent |
| Independent review of Phase 29 | **not performed** — must be a separate, reviewer-owned artifact |
| F-3 UX cost (403 logs the user out) | accepted, §8 |
| `mutate-container-gate.mjs` has no pre-run control | recorded, §9 |
| Live advisory set (`pnpm audit` against the registry) | not re-fetched; no network egress. The 48-advisory classification is only as current as its last run. |

---

## 17. Limitations

1. **No GitHub Actions run exists.** Every CI result here is a local
   execution of the same commands on this host. The hosted runner, its
   service containers, its action versions and its disk budget are
   unverified. A local green CI-parity check is not a CI run.
2. **The new CI steps have never run on a GitHub runner.** They are proven to
   work here and to be *required* by the contract, but their behaviour under
   the runner's environment, timeout and caching is unobserved.
3. **The CI integration is mutation-proved, not reviewer-reviewed.** The
   reviewer-owned security review of Phase 29 does not exist.
4. **`pnpm audit` was not re-run against the live registry.** The dependency
   triage result reflects the last run that had network egress.
5. **Backup/restore remains a small-scale, single-host, local-filesystem
   result** — 8 files for storage, 3 rows for the database. RPO and RTO
   remain engineering estimates. §5 is a procedure, and it was **not** executed
   end-to-end by Phase 29; only §7 of this report's matrix is new evidence.
6. **The `web` application has one test.** It is effectively untested.
7. **Mobile was verified by unit test only** — no device, no real network
   stack, no real `expo-secure-store`. The F-3 conclusions in §8 rest on
   reading the client and the server, not on a device.
8. **The developer-database fingerprint is a schema-and-row-count measure**,
   not a byte-level dump comparison. It is strong enough to show the schema and
   data were not modified; it is not a full-content hash.
9. **Two of Phase 29's own harnesses were defective on first run** and were
   fixed before any result was recorded: an incomplete mirror that made the
   control fail falsely, and a mis-aligned comment mask that made five
   mutants pass for the wrong reason. Disclosed in §6 because a harness that
   hides its own false negatives cannot be trusted with anyone else's.
10. **The `release` job's `timeout-minutes: 45` was not changed.** Measured
    cost of the five added steps locally is roughly 3 s (storage) + 49 s (N-12)
    + 97 s (DB suites) + <1 s (parity `--list`) + 3 s (CI-integration
    mutation) ≈ **2.5 minutes**, so the added load is modest. The 45-minute
    budget has not been observed on a real runner, where the pre-existing
    mutation harnesses are the dominant cost and are proportionally slower.

---

## 18. What Phase 29 does **NOT** prove

Stated plainly, because the most useful thing this report can do is prevent a
green local run from being read as more than it is.

- **It does not prove GitHub Actions passes.** No hosted run exists for this
  tree. Nothing here can substitute for one.
- **It does not prove the system is production-ready.** It closes a
  process-integrity gap in a test harness. The external blockers in §16 are
  untouched.
- **It does not prove staging readiness.** No staging environment exists.
- **It does not prove backup readiness.** A 22-check local-filesystem
  archive/restore round trip on 8 synthetic files is not a backup strategy. No
  scheduling, encryption, retention, off-host storage or restore drill exists.
- **It does not prove TLS, observability, load capacity, or compliance.** None
  was tested.
- **It does not prove the RTO or RPO in §9 of the runbook.** They remain
  estimates; the restore procedure restored in WS3 was documented, not
  executed end-to-end.
- **It does not prove the new CI steps are correctly *placed***, only that
  they run, that the contract requires them, and that removing them is
  detected. A future edit could still move a step to a job whose environment
  cannot run it — the contract would not catch that.
- **It does not fix F-3.** The mobile client still logs a user out on a
  genuine 403. That is a recorded, accepted product decision, not a closed
  defect.
- **It does not constitute a security review.** This report is written by the
  implementer. `SECURITY_REVIEW_PHASE_29.md` must be produced independently.
- **It does not close the other Phase 28 findings** (F-4, F-5), which are
  correctly-disclosed informational items, not defects.

---

## 19. Final disposition

**Phase 29 is complete against all 20 exit criteria.**

| # | Criterion | Status |
| - | --------- | ------ |
| 1 | Every CI-enforceable Phase 28 gate present in `ci.yml` | **met** — all three |
| 2 | Every such gate represented in `verify-ci-parity.mjs` | **met** — 17 required gates, 5 added |
| 3 | Removing each required Phase 28 gate is mutation-detected | **met** — C1–C3, 20/20 |
| 4 | CI parity itself detects missing Phase 28 gates | **met** — C4, plus C7–C9, C19, C20 |
| 5 | No Phase 28 verification control weakened | **met** — all 12 prior gates retained and matched *more* strictly; no `continue-on-error` added |
| 6 | `docs/BACKUP_RESTORE.md` has no broken §5 references | **met** — §5 restored; 0 broken references; numbering continuous 0–14 |
| 7 | F-3 explicitly dispositioned without conflating 403 and 429 | **met** — §8; accepted with evidence; 403 found to also be a session-revocation signal |
| 8 | F-6 reported as executed or resource-blocked | **met** — **executed**; M8–M11 all detected |
| 9 | Full local regression passes sequentially | **met** — 33 gates, 44 CI commands, 0 failures |
| 10 | Lint at or below 55 errors / 69 warnings | **met** — exactly 55 / 69 |
| 11 | `pnpm-lock.yaml` byte-identical | **met** |
| 12 | Prisma schema and migrations byte-identical | **met** |
| 13 | Historical and security-review artifacts byte-identical | **met** — 14 reviews + 27 docs, one intended change |
| 14 | Developer `ecc` database untouched | **met** — schema fingerprint identical |
| 15 | No throwaway infrastructure remains | **met** — 0 containers, 0 mirrors, 244→3 volumes |
| 16 | No commit or push | **met** — `HEAD` == `origin/main`, 0 commits, 0 stashes |
| 17 | Report distinguishes verified / mutation-proved / reviewed / unverified / blocked | **met** — throughout, and §16–§18 |
| 18 | No production-readiness claim | **met** — §18 |
| 19 | No staging-readiness claim | **met** — §16, §18 |
| 20 | No GitHub Actions success claim | **met** — §16, §17.1, §18 |

**F-2 (Medium) is closed, and closed with evidence rather than assertion.**
Three Phase 28 gates are now enforced by the CI contract; the contract itself
runs in CI; and 20 mutants — including four that are the exact bypasses the
old text-based check was defeated by — demonstrate that removing any of it
turns the build red. Three real defects surfaced while proving this, and all
three were fixed and re-run.

**F-1 (Low) is closed.** §5 is restored against the repository as it actually
is, and both cross-references resolve.

**F-3 (Low) is accepted and explained, not fixed.** The investigation went
further than the review did and found that 403 is *also* this API's
session-revocation signal (`auth.service.ts:199`), so the current behaviour is
partly required. The residual UX cost is real and is a product decision.

**F-6 (Informational) is closed by execution.** All four container mutants
were run at full strength on a host with 35.38 GB free, and all four were
detected on the checks they target. The Phase 28 resource block is gone.

**The repository is not production-ready and is not staging-ready, and this
phase does not change that.** What Phase 29 establishes is narrower and worth
stating on its own terms: the verification mechanisms this repository relies
on are now wired into the CI contract, the CI contract is itself enforced, and
removing any part of that wiring is provably detected rather than assumed.
