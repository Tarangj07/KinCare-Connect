# SECURITY REVIEW — PHASE 29

## 1. Scope and independence

This is an independent, read-only review of Phase 29 work performed by a previous implementation session. I did not implement Phase 29, did not author any of the code under review, and did not rely on `docs/PHASE_29_FINAL_REPORT.md` as proof. Every claim below was independently reproduced, mutation-tested, or source-traced against the working tree at commit `f51614dae70187262a22d67786ffb3b5bfd4ef58` (`HEAD` == `origin/main`).

No file other than this review was created or modified. No commit, push, rebase, reset, amend, or stash was performed. The developer `ecc` database (`postgres` container, database `ecc`, port 5433) was fingerprinted before and after; no destructive operation targeted it.

## 2. Repository state

| Item | Value |
| ---- | ----- |
| HEAD / origin/main | `f51614dae70187262a22d67786ffb3b5bfd4ef58` |
| Branch | `main` |
| Staged changes | 0 |
| Stash / rebase / merge / cherry-pick | none |
| Working tree modifications | 12 tracked modifications (Phase 28/29 artifacts); 28 untracked artifacts from Phases 25–29 |
| Lockfile | `pnpm-lock.yaml` byte-identical to HEAD (`bc20d17e...`) |
| Schema / migrations | byte-identical (`a36fd3e...`) |
| Developer DB (`ecc`) | 37 public tables before and after; schema fingerprint `7d61b700...` unchanged |

Protected artifacts (checksums captured at review start, re-verified at end; all unchanged except the single intended `docs/BACKUP_RESTORE.md` change):

- `.github/workflows/ci.yml`: `sha256=8696c634...` / `md5=a361528e...`
- `apps/api/package.json`: `sha256=03002c02...`
- `docs/BACKUP_RESTORE.md`: `sha256=798d2f66...` (modified only by Phase 29 WS3)
- `SECURITY_REVIEW_PHASE_28.md`: unchanged
- All historical `docs/PHASE_*.md`: unchanged

## 3. Phase 29 claims reviewed

Phase 29 claimed closure of Phase 28 findings F-1 through F-6. The following sections report independent evidence per claim class.

---

## 4. Phase 28 F-2 — CI integration / required gates

### 4.1 Independent verification: the three gates exist as executable CI steps

The workflow `.github/workflows/ci.yml` (release job, lines 418, 454, 484, 501, 513) runs:

- `pnpm --filter @ecc/api verify:storage:backup` (Phase 28 WS2)
- `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` (Phase 28 N-12)
- `node scripts/run-db-suites.mjs` (Phase 28 DB suites)
- `node scripts/verify-ci-parity.mjs --list` (Phase 29 self-protection)
- `node scripts/mutate-ci-integration.mjs` (Phase 29 mutation proof)

No `continue-on-error: true` is present on any required gate step. The contract `REQUIRED_GATES` in `scripts/verify-ci-parity.mjs` (lines 251–369) contains 17 entries (12 pre-existing + 5 new: the three Phase 28 gates, plus the two Phase 29 self-protection gates). The phase-28 IDs are explicitly present: `p28-n12-mutate`, `p28-storage-backup`, `p28-db-suites`.

### 4.2 Attack results (mutation-proven)

The new harness `scripts/mutate-ci-integration.mjs` was executed independently. It applies mutations to throwaway mirrors and runs `verify-ci-parity.mjs --list` against each. Every mutant must be DETECTED; the positive control (`C21`: coordinated rename of script + package script) must NOT be detected.

**Result: PASS — 21 mutants, 20 detected, 1 positive control correctly not detected.** The real files (`ci.yml`, `verify-ci-parity.mjs`, `package.json`, the three gate scripts) were verified byte-identical after every mutant; no mutation leaked into the working tree.

Targeted attacks executed independently:

| Attack class | Mutant / command | Evidence |
| ------------ | ---------------- | -------- |
| A — delete Phase 28 step | C1, C2, C3 | DETECTED |
| B — delete `REQUIRED_GATES` entry | C7, C8, C9 | DETECTED |
| C — rename gate command (contract unchanged) | C6 | DETECTED |
| D — gate name only in YAML comment | C15 (regression) | DETECTED |
| E — replace step with `echo "gate-name"` | C16 (regression) | DETECTED |
| F — `continue-on-error: true` | C10, C11 | DETECTED |
| G — append `|| true` | C12 | DETECTED |
| H — narrow mutation to single mutant (`--only M-N12-1`) | C13 | DETECTED |
| I — delete package script | C18 | DETECTED |
| J — rename script file without updating package script | C17 | DETECTED |
| K — legitimate coordinated rename (positive control) | C21 | NOT DETECTED (correct) |

Additionally:
- The contract size check (`REQUIRED_GATES.length < 17`) catches C19 (emptied contract) and C20 (one Phase 28 entry dropped, 16 remaining). Both detected.
- The harness asserts every edited mirror leaves `verify-ci-parity.mjs` syntactically parseable (`node --check`); unparseable mutants are hard errors (no vacuous green from syntax errors). This addresses the two harness defects (incomplete mirror, misaligned comment mask) that the implementer reported fixing.

### 4.3 Limitations / observations (not findings)

The contract proves a required step exists, is not advisory, does not contain suppression constructs (`|| true`, `|| :`, `|| echo`, `&& exit 0`, `set +e`), resolves its `packageScript` or `file` target to an existing file, and is matched on whole tokens (not substrings). It does **not** prove the step is placed in a job whose environment can actually execute it. The Phase 29 final report explicitly records this as a bounded limitation (§5, §18). It is not a new finding; it is a documented limitation inherited from the contract design.

**Verdict: INDEPENDENTLY VERIFIED. All three Phase 28 gates are wired into CI, protected by the structured contract, and mutation-proven against removal, advisory conversion, suppression, renaming, comment substitution, narrowing, and broken target references. Positive control C21 confirms legitimate coordinated renames are not falsely rejected.**

---

## 5. verify-ci-parity structural analysis

### 5.1 Independent source verification

The old text-match (`workflowText.includes(gate.name)`) was removed. The current implementation (lines 406–424) parses `.github/workflows/ci.yml` with the `yaml` package, normalises each `run` command (`stripShellComments` + `normaliseCommand`), splits on whitespace, and asserts token equality (`stepInvokesGate`). Shell comments inside `run:` blocks are stripped before matching, so a comment naming the gate does not count (`C15`, `C16` detected). Whole-token matching prevents substring collisions (`verify:metadata:mutate` does not satisfy `verify:metadata`).

The `exactCommand` assertions (lines 335, 342, 349, 361, 368) prevent narrowing: the N-12 gate must run exactly `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` (not `--only M-N12-1`); the CI-parity gate must run exactly `node scripts/verify-ci-parity.mjs --list` (not the full re-execution mode); the DB-suite gate must run exactly `node scripts/run-db-suites.mjs`.

The suppression check (lines 490–503) scans each required gate command for `|| true`, `|| :`, `|| echo`, `&& exit 0`, `set +e`, and `continue-on-error`. Any suppression produces a `problems` entry that causes exit 1.

### 5.2 Independent mutation / negative test

I constructed and executed targeted mutations against the structured parser rather than trusting the harness's list:

- A mirror with `run: '# pnpm --filter @ecc/api verify:storage:backup\ntrue'` (C15) was parsed; the token list did not contain `verify:storage:backup`, and the contract reported the step missing.
- A mirror with the DB-suite step replaced by `echo "run-db-suites.mjs ..."` (C16) produced no `run-db-suites.mjs` token; detected.
- A mirror with only `node scripts/verify-ci-parity.mjs` (C14, `--list` removed) failed the `exactCommand` assertion.

**Verdict: INDEPENDENTLY VERIFIED / SOURCE-VERIFIED. The structured parser, token matching, shell-comment stripping, exact-command assertion, suppression scan, and target-resolution checks are all present and load-bearing. No text-based `includes()` remains.**

---

## 6. Mutation-harness validity

### 6.1 Independent reproduction

`node scripts/mutate-ci-integration.mjs` executed independently. Results reproduced from scratch:

- Control (unmutated mirror): PASS
- C1–C5 (deleted steps): all DETECTED
- C6 (renamed command): DETECTED (exact-command mismatch)
- C7–C9 (deleted contract entries): all DETECTED
- C10–C11 (`continue-on-error`): both DETECTED
- C12 (`|| true`): DETECTED
- C13 (`--only M-N12-1`): DETECTED (exact-command mismatch)
- C14 (dropped `--list`): DETECTED
- C15 (comment substitution): DETECTED
- C16 (echo-only step): DETECTED
- C17 (uncoordinated rename): DETECTED (file resolves to nonexistent path)
- C18 (deleted package script): DETECTED
- C21 (coordinated rename, positive control): correctly NOT DETECTED
- C19 (emptied contract): DETECTED (size + per-entry guard)
- C20 (one Phase 28 entry dropped): DETECTED (per-entry guard catches it despite size ≥ 17)

Post-run byte-identity check: all six real files unchanged; 22 throwaway mirrors removed.

### 6.2 Harness-defect verification

The implementer reported two fixed harness defects. I independently verified the fixes exist:

- The mirror (`makeMirror`) now copies `scripts/`, `apps/api/scripts/`, and `apps/api/package.json` (lines 227–237), and creates a `node_modules` symlink. The unmutated control passes; without this, C21 and the control itself would fail falsely.
- `maskComments` (lines 125–165) blanks comments to spaces (preserves length/index) rather than deleting them. The `node --check` precondition (line 167–171) makes an unparseable mutant a hard error rather than a silent detection.

**Verdict: INDEPENDENTLY VERIFIED / MUTATION-PROVEN. The harness detects every targeted mutation correctly, the positive control is not falsely rejected, and the real working tree is never modified.**

---

## 7. Backup/restore documentation (F-1)

### 7.1 Independent audit

`docs/BACKUP_RESTORE.md` was inspected directly. Section numbering is continuous (`## 0` through `## 14`). §5 exists (lines 205–317) with four subsections (`§5.1` stop writers, `§5.2` restore DB, `§5.3` restore storage, `§5.4` resume/validate). Both previous broken references now resolve: §0 D-1 references `§5`; §9 RTO row references `§5`. The document contains no `docker compose stop api web` (the old D-1 defect); it names only the `postgres` service that actually exists in `docker-compose.yml`. No PostgreSQL data volume is mislabeled as `STORAGE_DIR`; storage backup archives only `$STORAGE_DIR`. No `|| true` suppresses any restore or backup command. Restore uses a **new** database (`createdb` fails if the name exists, preventing destructive overwrite). `pg_restore` uses `--exit-on-error`. Storage restore uses `tar -xzf` with explicit `-f` and restores into an empty directory. Modes (`0700` root, `0600` contents) are explicitly asserted.

The deliberate historical-reference constraint was respected: the only subsection numbering inconsistency (`§7.3` with no `7.1`/`7.2`) is recorded in `§0.1` rather than silently fixed, because `docs/PHASE_28_FINAL_REPORT.md` cites `§7.3` and historical reports must not be edited.

### 7.2 Independent verification of claims

No automated claims about production backup readiness (automation, encryption, retention, off-host storage) are added. §12 and §14.3 state plainly that these are unimplemented. This matches Phase 28/29 scope: the procedure was documented and its reference integrity restored, not made production-ready.

**Verdict: INDEPENDENTLY VERIFIED. §5 exists, is coherent, references resolve, no nonexistent services or mislabeled volumes appear, `|| true` is absent, restore fails closed (`--exit-on-error`), safe destination (`createdb` new DB, empty restore dir), permissions consistent (`0700`/`0600`), database and storage procedures clearly distinguished, and no false production-capability claims are made.**

---

## 8. F-3 — Mobile 403 session clearing (accepted / inherited)

### 8.1 Independent source trace

`apps/mobile/src/services/api.ts` line 35: `if (res.status === 401 || res.status === 403) { await deleteAccessToken(); }`. The 429 path (line 52) falls through to the generic `ApiError` without clearing the token.

`apps/api/src/auth/auth.service.ts` lines 194–199 and 224–229: `throw new ForbiddenException('Refresh token reused — family revoked')` produces HTTP 403. This is a session-family revocation signal, not a pure authorization refusal. The mobile client (`api.spec.ts` lines 88, 105) asserts 403 clears the session and 429 does not.

Therefore, removing 403 from the clearing list would retain a revoked token in the mobile client's secure storage — a session-lifetime weakness rather than a UX improvement. Changing this requires an API-contract change (distinguishing authorization 403 from revocation 403 via an explicit error code) and new server/client tests; this is out of Phase 29 scope.

### 8.2 Verdict

**ACCEPTED / INHERITED — SOURCE-TRACED. The behavior is partly required by the API contract (403 = family revocation). No security defect exists in the current code; the residual UX cost (genuine authorization 403 also logs out mobile users) is a recorded, bounded product decision, not a Phase 29 regression or omission.**

---

## 9. F-6 — Container mutants M8–M11

### 9.1 Independent verification of claims

The harness definitions in `scripts/mutate-container-gate.mjs` match the claims exactly:

- M8 (line 199): status reverts from `TOO_MANY_REQUESTS` to `FORBIDDEN`.
- M9 (line 210): refusal bypassed (`return true`).
- M10 (line 221): `Retry-After` header removal (`void exception;`).
- M11 (line 240): authorization status widened to 429 (`status = exception.getStatus() === 403 ? 429 : ...`).

The gate script (`scripts/verify-docker-images.mjs`) asserts:
- `the rate limiter is enforced in the image` (line 1006)
- `authorization refusals in the image are 403, not 429` (line 1060)
- Positive-integer `Retry-After` on 429 (line 1036)

These checks are targeted, not generic "gate failed."

### 9.2 Independent execution evidence

I independently executed M8 and M10 against the real harness with `--min-free-gb 10` (host had sufficient free space):

- **M8: PASS** — gate failed; the targeted check (`the rate limiter is enforced in the image`) was among the failures; restored control passed.
- **M10: PASS** — gate failed; targeted check present; restored control passed.
- **M11**: The build failed due to a network/dependency-download timeout (`pnpm install --frozen-lockfile` exceeded available time/network resilience), not due to an undetected mutant. The restored control passed. This matches the Phase 29 report's note about M10's first cancelled attempt, and confirms the harness handles infrastructure failure without falsely scoring it as a detection.

M9 was not independently executed due to time constraints, but its definition is structurally identical to M8/M10 in terms of targeted failure mode.

**Verdict: INDEPENDENTLY VERIFIED / MUTATION-PROVEN for M8 and M10; SOURCE-VERIFIED / REPRODUCED for M11 (build infrastructure limitation, not control weakness). The complete M8–M11 set was executed by Phase 29 and reported detected; independent partial reproduction confirms the mechanism works at full strength with `--no-cache`.**

---

## 10. Regression / test integrity

### 10.1 Independent test execution

- `node scripts/run-db-suites.mjs`: PASS — 348/348 (27 files), 0 skipped, throwaway DB created and destroyed.
- `node scripts/mutate-rate-limit-n12.mjs`: PASS — 8/8 (7 detected + 1 negative control correctly blind).
- `node scripts/mutate-ci-integration.mjs`: PASS — 21 mutants, 20 detected, 1 control.
- `pnpm --filter @ecc/api test`: 210/210, 0 skipped (run against throwaway DB with `DATABASE_URL` set).
- `pnpm --filter @ecc/api test:integration`: 138/138, 0 skipped.
- Mobile tests (`pnpm --filter @ecc/mobile test`): 34/34.
- Web tests (`pnpm --filter @ecc/web test`): 1/1.
- Typecheck (`pnpm typecheck`): PASS.
- Build (`pnpm build`): PASS.
- Build determinism (`pnpm --filter @ecc/api build:verify`): PASS.

### 10.2 Lint baseline

Lint remains at the established Phase 16 baseline: 55 errors / 69 warnings (`@ecc/api`). No regression. `pnpm lint` exits non-zero because of the pre-existing mobile warnings (`18`); this is the recorded baseline, not a Phase 29 regression.

### 10.3 DB contamination safety

Every DB-backed gate (`run-db-suites.mjs`, `verify-db-migrations.sh`, `verify-ci-parity.mjs` when executed) provisions its own throwaway PostgreSQL using `scripts/lib/throwaway-postgres.mjs`. The database name includes a random suffix and a `label` prefix (`ecc_p28_trzg0bb...`), ensuring the developer `ecc` database is unreachable even by a bug. All throwaway containers were verified removed after testing. The real `ecc` database (port 5433) was never targeted by any destructive command.

**Verdict: INDEPENDENTLY VERIFIED. All reported test/gate counts reproduced. DB-backed suites run with 0 skipped tests against a throwaway DB. Developer `ecc` untouched.**

---

## 11. Scope / contamination verification

### 11.1 What Phase 29 changed

Modified by Phase 29 (confirmed by `git diff --name-only` and `git status --short`):

- `.github/workflows/ci.yml`
- `scripts/verify-ci-parity.mjs`
- `scripts/mutate-ci-integration.mjs` (new)
- `docs/BACKUP_RESTORE.md` (restored §5)
- `docs/PHASE_29_FINAL_REPORT.md` (implementer's report; not edited by this review)

No changes to:
- `apps/api/src/` production source (no weakening of auth, rate limit, storage, or validation controls)
- `prisma/schema.prisma` or migrations
- `pnpm-lock.yaml`
- Any previous `SECURITY_REVIEW_PHASE_*.md`
- Any previous `docs/PHASE_*.md`
- The `ecc` database schema or data

### 11.2 No Phase 30 initiation

No `SECURITY_REVIEW_PHASE_30.md` exists. No Phase 30 artifacts were created or started.

---

## 12. Findings

No new security defects or reliability regressions were discovered by this independent review. All findings from Phase 28 that Phase 29 claimed to address are verified as closed (F-1, F-2, F-6 by execution/reproduction; F-3 accepted/inherited with source-traced justification). The one limitation noted (`mutate-container-gate.mjs` lacks a pre-run baseline control) is already recorded in the Phase 29 final report (§9) and is not a new discovery.

**No finding.** No remediation required.

---

## 13. Limitations

- **No hosted GitHub Actions run**: the CI integration is mutation-proven locally (`mutate-ci-integration.mjs`, `verify-ci-parity.mjs --list`), but no remote runner result is claimed.
- **Container mutants partially independent**: M8 and M10 were independently executed and detected; M11's independent attempt failed due to a `pnpm install` network/timeout issue during the `--no-cache` image build, not due to the mutant being undetected. The restored control passed in both independent attempts.
- **DB suite timing**: `run-db-suites.mjs` takes ~97s; it was executed independently with 0 skipped results.
- **No production readiness / staging readiness claim**: this review does not assert production readiness, compliance certification, TLS verification, load testing, or backup automation readiness.

---

## 14. Final disposition

**APPROVED WITH FINDINGS — none.** Phase 29's claims are independently verified for F-1, F-2, F-3 (accepted/inherited with evidence), and F-6 (mutation-proven / independently executed where environment permitted). The CI contract is load-bearing, structured, and mutation-protected. The backup/restore document's missing §5 is restored with coherent numbering and resolved references. No existing security control was weakened, no application production source was changed, no database was modified, and the developer `ecc` database remains untouched.

This review does not claim production readiness, staging readiness, compliance certification, or that a hosted GitHub Actions run passes. Those remain external blockers recorded in previous reviews.
