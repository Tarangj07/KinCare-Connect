# Security Review — Phase 28 (Independent Release Assurance Review)

**Reviewer:** independent reviewer, engaged solely for adversarial verification
**Repository:** KinCare-Connect (`elderly-care-coordination-platform`)
**HEAD reviewed:** `f51614dae70187272a22d67786ffb3b5bfd4ef58` = `origin/main`
**Date of review:** 2026-09-29
**Tree state reviewed:** Phase 28 implemented but **uncommitted** (working tree)

This review was produced under an explicit read-only mandate. No implementation
file, gate, report or lockfile was modified. No commit, push, rebase, reset,
amend or stash was performed. No historical phase report and no existing
`SECURITY_REVIEW_*` file was touched.

---

## 1. Scope

Verify, adversarially and against the current tree, whether the security and
release claims made by **Phase 28** survive scrutiny, and whether the claims
they rest on (Phases 24, 25, 26) still hold.

Explicitly **out of scope**: implementing fixes, re-running a phase, and any
numerical security score, ranking, percentage or "best/worst" assessment.

---

## 2. Independence statement

**I am a separate reviewer. I did not implement Phase 28, and I did not author
any of the code, gates, scripts or reports under review.**

What I was given: the repository at the stated HEAD with Phase 28's changes
uncommitted in the working tree, plus the implementer's written claims
(test counts, mutation results, gate results).

**What I did NOT rely upon:**

- No claim in `docs/PHASE_28_FINAL_REPORT.md` or
  `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` was accepted as evidence for
  anything. Every claim in §4 below was re-derived from the tree.
- The pre-existing `SECURITY_REVIEW_PHASE_25.md` / `_26.md` were treated as
  **untrusted inputs**, not as findings. Phase 25 F-1…F-5 and Phase 26's
  ValidationPipe assertion were re-tested from scratch.
- The Phase 27 report's dispositions for D-1…D-9 were re-derived, not
  repeated.

**What I independently reproduced:** every test count, every gate result, every
mutation result, the F-1 → F-5 chain, the N-12 HTTP contract, the storage
backup/restore, the database backup/restore, the clean container build, and the
CI/gate battery. Reproduction was against the current tree using throwaway
infrastructure.

**Bias risk I am disclosing:** the Phase 28 code is unusually well-commented,
and several of its comments assert properties (e.g. "`Retry-After` is
`lastAttempt + windowMs - now`", "only place `Retry-After` is set") that a
reviewer might be tempted to accept. I did not. Every such claim was checked
against observed runtime behaviour by measuring the header, not by reading the
comment. Where a comment and the code disagreed, I report the code.

**One methodological disclosure:** two of my own reviewer-built harnesses had
defects I found and corrected mid-review (a backup taken after the first of two
edits, which leaked a mutant into my throwaway copy; and a stale-process bug
that made a check read a dead server). Both were reviewer-side only. Neither
touched the repository. I re-ran the affected checks after fixing. This is
recorded because a review that hides its own false negatives is not worth
much.

---

## 3. Repository / Git baseline

| Item | Value |
| ---- | ----- |
| `git rev-parse HEAD` | `f51614dae70187272a22d67786ffb3b5bfd4ef58` |
| `git rev-parse origin/main` | `f51614dae70187272a22d67786ffb3b5bfd4ef58` (identical) |
| Branch | `main` |
| Staged changes | none |
| Stash / rebase / merge / cherry-pick state | none (empty `git stash list`, no `.git/rebase-*`, no `MERGE_HEAD`) |
| Tracked modifications | 10 files (Phase 28) |
| Untracked | 12 entries |

### 3.1 Integrity of protected files — VERIFIED CLEAN

| File | SHA-256 (captured at review start) | State |
| ---- | --------------------------------- | ----- |
| `pnpm-lock.yaml` | `bc20d17e46fda82c8eeef4dabdd202a68a767356151401f24c731391ac4ec3b8` | unchanged (`git diff` empty) |
| `apps/api/prisma/schema.prisma` | `a36fd3e7803a7adbbdd6ac77c0f2a51053899b98ee751d447664ea6ce1d1c9be` | unchanged |
| `apps/api/prisma/migrations/**` | aggregate `5b0f253924f5b552e7d103a4445e977606a585e24982cdde0d95484a615fd223` | `git status --porcelain` empty |
| `PROJECT_PLAN-old.md` | `277614287b60f697f98f83ff4f1d929b886ad1ef539b14a440c8bd544070ef13` | unchanged |
| `.github/workflows/ci.yml` | — | unchanged |
| `apps/api/Dockerfile`, `apps/web/Dockerfile` | — | unchanged |
| All `package.json` except `apps/api/package.json` | — | unchanged |
| All 12 existing `SECURITY_REVIEW_PHASE_*.md` | — | unchanged |
| All historical `docs/PHASE_*.md` | — | unchanged |

### 3.2 Developer `ecc` database — UNTOUCHED

Captured at review start and re-verified at review end:

| Measure | Start | End |
| ------- | ----- | --- |
| Public tables | 37 | 37 |
| `users` rows | 14 | 14 |
| `_prisma_migrations` rows | 2 | 2 |
| `users` content fingerprint (md5) | `e93602ae8749a3a2579f6d87a5fdd895` | `e93602ae8749a3a2579f6d87a5fdd895` |
| `pg_database_size` | 11,713,559 bytes | 11,713,559 bytes |

The user fingerprint independently matches the value the Phase 28 implementer
recorded in its own pre-flight table. **No destructive test was run against this
database.** All database work used `postgres:16-alpine` throwaway containers
with prefixed, per-run database names.

### 3.3 Phase 28 file inventory — reported list is ACCURATE

All 11 reported-modified and all 7 reported-created files are present as
described. No undisclosed implementation file was found.

**Minor documentation inaccuracy (OBS-1, informational):**
`docs/BACKUP_RESTORE.md` is reported as *modified* but is in fact **untracked**
— it was created in Phase 27 and never committed, so Phase 28 edited a file
that does not exist in Git history. The runbook's "Corrected: Phase 28" claim
is true on disk but there is no committed baseline to diff against. This does
not affect the runbook's content, which I audited directly (§10).

---

## 4. Phase 28 claims tested

| # | Claim | Verdict |
| - | ----- | ------- |
| 1 | Rate limit returns 429, not 403 | **CONFIRMED** at source, unit, e2e, live production process, and in the clean image |
| 2 | `Retry-After` reflects the real window | **CONFIRMED** by live measurement over time |
| 3 | 401 / 403 paths unaffected | **CONFIRMED** at source and live |
| 4 | Mobile keeps session on 429, drops on 401 | **CONFIRMED** |
| 5 | Unit suite = 166 | **CONFIRMED** (166 passed, 44 skipped without a DB) |
| 6 | API e2e = 138 | **CONFIRMED** (138 passed with a real database) |
| 7 | all-with-DB = 348 | **CONFIRMED** (348 passed) |
| 8 | mobile = 34 | **CONFIRMED** |
| 9 | container = 57/57 | **CONFIRMED** on a clean rebuild |
| 10 | typecheck / build / build:verify PASS | **CONFIRMED** |
| 11 | compiled-auth: all 4 modes PASS | **CONFIRMED** |
| 12 | migrations / artifact / CI-parity / config / env / dependency / next-config / metadata / routes PASS | **CONFIRMED** |
| 13 | lint = exactly 55 errors / 69 warnings | **CONFIRMED — and still red** (see §14) |
| 14 | rate-limit source mutations 8/8 | **CONFIRMED** (harness PASS) + **11 more independent mutations, 11/11 detected** |
| 15 | container rate-limit mutations 4/4 | **PARTIALLY VERIFIED** — see §6.3 |
| 16 | storage backup/restore 22/22 | **CONFIRMED** |
| 17 | throwaway infrastructure cleaned | **CONFIRMED** for all gate-provisioned containers |
| 18 | developer `ecc` database untouched | **CONFIRMED** |
| 19 | no commit / push | **CONFIRMED** — HEAD and `origin/main` identical, no stash |

**Claims 1–14, 16–19 hold. Claim 15 is not fully independently executable in
this environment; the underlying properties were nevertheless proven at source
level (§6.3).**

---

## 5. N-12 — independent verification

### 5.1 Source-level trace

Traced by reading code, not comments:

1. `@RateLimit()` (`apps/api/src/auth/decorators/rate-limit.decorator.ts:6-8`)
   → `UseGuards(RateLimitGuard)`.
2. `RateLimitGuard.canActivate`
   (`apps/api/src/auth/guards/rate-limit.guard.ts:104-126`) →
   `throw new RateLimitExceededException(this.retryAfterSecondsFor(record, now))`
   at line 120.
3. `RateLimitExceededException`
   (`apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts:43-49`)
   → `super(msg, HttpStatus.TOO_MANY_REQUESTS)`, i.e. **429**; carries
   `retryAfterSeconds`.
4. `GlobalExceptionFilter.catch`
   (`.../global-exception.filter.ts:63-65`) sets
   `Retry-After: <retryAfterSeconds>`; then lines 67-83 read
   `exception.getStatus()` → 429 and `codeForStatus(429)` → `RATE_LIMITED`
   (line 123-124).
5. Response: `429` + `error.code = RATE_LIMITED` + `Retry-After`.

No other code path can produce a 429: the only 429 source in the repository is
this exception, and `@RateLimit()` is applied to exactly 5 routes, all in
`auth.controller.ts` (lines 63, 77, 90, 129, 136).

### 5.2 Live `NODE_ENV=production` process (compiled `dist`)

Ran two production processes against throwaway databases.

**D — Rate-limit exhaustion (measured):**

```
attempt  1..10 -> HTTP 401  code=UNAUTHENTICATED   <no Retry-After>
attempt 11     -> HTTP 429  code=RATE_LIMITED      Retry-After: 900
attempt 12..14 -> HTTP 429  code=RATE_LIMITED      Retry-After: 900
```

Response body:
`{"error":{"code":"RATE_LIMITED","message":"Rate limit exceeded. Try again later.","requestId":"…"}}`
— no stack, no driver text, no client IP, exactly the three documented keys.

**C — Authentication failure (unchanged):**
- no token → `401 UNAUTHENTICATED "Access token missing."`
- garbage token → `401 UNAUTHENTICATED "Access token invalid or expired."`

**B — Genuine authorization denial (unchanged):**
A real user token (role `USER`, no care-circle membership) against
`GET /api/v1/seniors/<random-uuid>/medications`:

```
HTTP 403 Forbidden
{"error":{"code":"FORBIDDEN","message":"Access denied: no authorized care-circle
 membership for this senior.", …}}
Retry-After: (absent)     <- correct: a 403 is terminal, not retryable
```
Repeated → still 403, still no `Retry-After`. So 403 and 429 are
demonstrably distinguishable from the same client at the same moment.

**E — `Retry-After` correctness (measured over time, not read from code):**
Same exhausted process, probed repeatedly:

| Elapsed since exhaustion | `Retry-After` |
| ------------------------ | ------------- |
| +0 s | 900 |
| +13 s | 887 |
| +33 s | 867 |
| +53 s | 847 |

A hard-coded constant would have returned 900 four times. The value decreases
1:1 with real elapsed time and equals `lastAttempt + 900s − now`, which matches
the implementation's sliding-window semantics. The floor-at-1 rule was also
exercised by the unit suite at the exact reset boundary (`Retry-After: 1` at
`lastAttempt + windowMs`, and allowance resumes at `+1 ms`).

### 5.3 G — no accidental global semantic change

Enumerated **139** `ForbiddenException` / `UnauthorizedException` / 429
references across `apps/api/src`. `ForbiddenException` remains in
`emergency`, `feed`, `medications`, `messaging`, `documents` and other
services/controllers. None was changed by Phase 28 (the diff touches only
`rate-limit.guard.ts`, `global-exception.filter.ts`, and the new exception
file). The global filter's `codeForStatus` mapping is unchanged except that
`case 429` is now reachable.

### 5.4 H — the filter does not convert the new exception back to 403

Confirmed by construction and by measurement: the filter's status comes from
`exception.getStatus()` unconditionally, and the new exception's constructor
passes `HttpStatus.TOO_MANY_REQUESTS`. Live output is 429 (§5.2). The
`Retry-After` header is written in a block guarded by
`exception instanceof RateLimitExceededException`, so no other status can gain
it — verified by the 403 probe above returning no header.

### 5.5 F — mobile client behaviour

`apps/mobile/src/services/api.ts:35` reads
`if (res.status === 401 || res.status === 403)`. 429 is absent, so it falls
through to the generic `ApiError` path. The suite asserts the token
**survives** a 429 (`apps/mobile/src/services/api.spec.ts:105-135`) and is
deleted on 401 (line 70-86) and 403 (line 88-103). Both pass.

**Note (inherited, not introduced by Phase 28):** the mobile client still
clears the session on **403**. A genuine authorization refusal (e.g. "no
care-circle membership for this senior") will therefore log the user out. The
Phase 28 brief asked that 403 not clear the session "unless it is specifically
an authentication/session invalidation path already designed to do so"; the
403 clearing is pre-existing and unchanged, and the API deliberately keeps 403
for authorization, so the two designs are now in tension. See F-3 in §17.

---

## 6. Mutation results

### 6.1 The repository's own harness — REPRODUCED

`node scripts/mutate-rate-limit-n12.mjs`, executed in an out-of-tree copy so
the real tree was never mutated:

```
CONTROL green
M-N12-1  429->403                 detected (unit=1, e2e=1)
M-N12-2  refusal bypassed         detected (unit=1, e2e=1)
M-N12-3  Retry-After dropped      detected (e2e=1)
M-N12-4  constant Retry-After     detected (unit=1)
M-N12-5  RATE_LIMITED removed     detected (e2e=1)
M-N12-6  403 widened to 429       detected (e2e=1)
M-N12-7  mobile clears on 429     detected (mobile=1)
M-N12-8  reworded 403 (control)   correctly NOT detected
RESTORED CONTROL green; RESULT PASS
```
**8/8 as claimed.**

### 6.2 My own independent mutations — 11/11 detected

Reviewer-authored, out-of-tree, targeting the eight attacks the brief mandated
plus three extra. Each had to make the suites fail.

| # | Weakening | Detected by |
| - | -------- | ----------- |
| 1 | `HttpStatus.TOO_MANY_REQUESTS` → `FORBIDDEN` | unit + e2e |
| 2 | `TOO_MANY_REQUESTS` → `UNAUTHORIZED` | unit + e2e |
| 3 | `res.setHeader('Retry-After', …)` removed | e2e |
| 4 | `retryAfterSecondsFor` returns a constant `300` | unit |
| 5 | `retryAfterSecondsFor` returns `0` | unit + e2e |
| 6 | filter maps the new exception to 403 | e2e |
| 7 | mobile adds `|| res.status === 429` | mobile |
| 8 | class reparented onto `ForbiddenException` | unit + e2e |
| 9 | window never slides (`lastAttempt` not advanced) | unit + e2e |
| 10 | `Retry-After` emitted as a non-integer (`'soon'`) | unit + e2e |
| 11 | filter returns `RATE_LIMITED` for **every** 4xx | unit + e2e |

**No verification gap for the eight mandated attacks.** Mutation #9 is
notable: it is a way for `Retry-After` to become permanently 900 while every
other property still looks correct, and it is caught.

### 6.3 Container-level mutations M8–M11 — PARTIALLY VERIFIED

`scripts/mutate-container-gate.mjs` adds M8 (429→403), M9 (refusal bypassed),
M10 (`Retry-After` dropped) and M11 (403 widened to 429). I verified:

- All four anchor strings occur **exactly once** in their target files, so each
  mutant applies cleanly rather than silently no-opping.
- The two gate checks they target are present in `verify-docker-images.mjs` and
  assert the status, the `RATE_LIMITED` code and a positive-integer
  `Retry-After`, and throw explicitly on a 403 throttled response.
- On a **clean rebuild** (previous images deleted first) both checks PASS, and
  the new `authorization refusals in the image are 403, not 429` check passes
  against a real token.

**What I did not execute:** the four full `--no-cache` mutant rebuilds. The
harness itself refuses to run below 20 GB free; this machine has ~7.8 GB. I
therefore cannot claim the container mutants were *observed* to fail. The
source-level equivalents of M8/M10/M11 were each independently detected (§6.2
#1, #3, #6), which is strong but is **not** the same as an observed
container-level failure. **This is a recorded limitation, not a pass.**

### 6.4 Container image container-hygiene note

My first clean-build run had to delete the pre-existing `ecc-api:p20-verify` /
`ecc-web:p20-verify` images to guarantee the build was not reusing anything.
The gate itself does not force this; an operator who has a previous tag present
gets whatever `--cache` yields. Not a defect, but a caveat on "clean build".

---

## 7. Phase 25 F-1 — future-dated `iat`

**Reproduced the original vulnerable condition first**, against the real
`jsonwebtoken` 9.0.3 verifier with `maxAge: 900`:

| Token shape | `verifyAsync` with `maxAge` only |
| ----------- | ---------------------------------- |
| `iat` +10 years, `exp` +10 years | **ACCEPTED** |
| `iat` +1 h, `exp` = now+900 | **ACCEPTED** |
| `iat` +60 s | **ACCEPTED** |
| `iat` +5 s / +6 s | **ACCEPTED** |
| no `iat` | rejected (`iat required when maxAge is specified`) |
| `iat` as a string | rejected |

This confirms F-1's premise: `maxAge` bounds `iat + 15m`, so a *future* `iat`
extends validity without bound. A correctly signed ten-year-future token was
accepted by `maxAge` alone.

**Then verified the current implementation rejects it**, at three levels:

| Level | future iat +10y exp | future iat + normal exp | future iat +6s | future iat +5s (edge) | normal |
|-------|--------------------|------------------------|----------------|----------------------|--------|
| **Source** (`isAccessTokenIssuedInThePast`) | rejected | rejected | rejected | accepted | accepted |
| **Compiled `dist`** (`JwtAuthGuard`) | `401` | `401` | `401` | accepted | accepted |
| **Live `NODE_ENV=production` process** | `401` | `401` | — | — | accepted |

Also rejected: `iat` as a string, and a token with no `sub`.

**Verdict: F-1 is closed as claimed, and closed at the artifact level, not just
in unit tests.** The 5-second tolerance is deliberate, documented, and
absorbable (a 5-second clock skew is not an attack vector). Independent
corroboration: `scripts/verify-db-migrations.sh` asserts
`a token with a ten-year future iat and exp -> 401 (F-1 closed)` and
`a token with iat five minutes in the future -> 401`, both observed passing.

---

## 8. Phase 25 F-2 / F-3 — DTO validation and keyed bodies

Attacked in an out-of-tree copy with a **real `tsc` rebuild** of the mutated
source, then re-ran the gate against the mutated artifact.

| Attack | Result |
| ------ | ------ |
| All constraints stripped from `LoginDto` (a **public** route's DTO) | **GATE FAILS** — "carries 0 validation constraint(s) … none at all" |
| `LoginDto` carrying only `@IsOptional` / `@ValidateIf` (type-clean build, so the failure is not a TS error) | **GATE FAILS** — "carries 3 … all of them conditional … which enforce nothing by themselves" |
| Keyed `@Body('body')` planted on `POST /seniors/:seniorId/feed` (state-changing, non-public) | **GATE FAILS** — "binds a KEYED body field … Bind the body to a DTO" |
| Extra keyed body added to public `POST /auth/verify-email` | **GATE PASSES** (correct: the documented public allow-list permits keyed bodies there) |

Answers to the brief's specific sub-questions:

- **DTO metatype alone is insufficient** — confirmed. The gate reads
  class-validator's own `getMetadataStorage()` from the *same* module
  resolution the pipe uses (`verify-route-authorization.mjs:73-74`), not a
  name or a type.
- **A DTO with no effective constraints is rejected** — confirmed.
- **`@IsOptional` / `@ValidateIf` do not count** — confirmed, via the
  `CONDITIONAL_VALIDATION_TYPES` filter (line 77) and demonstrated empirically.
- **Public auth routes are not exempted** — confirmed. The body checks run
  *before* the `if (publicReason) continue;` at line 399-406, and the mutation
  on `POST /auth/login` — the public route with the richest DTO — was caught.
- **A state-changing route cannot bypass DTO validation by keying the body** —
  confirmed.

**Verdict: F-2 and F-3 are closed and load-bearing.** Both the detection half
and the non-over-correction half (F-3's allow-list) were exercised.

---

## 9. Phase 25 F-4 / F-5

### 9.1 F-4 — Next.js rewrites AST analyser

I wrote 16 probes against the shipped
`scripts/lib/next-config-features.mjs` and **all 16 behaved correctly**:

| Probe | Expected | Result |
| ----- | -------- | ------ |
| `async rewrites() { … }` (the documented Next form) | detect | detected as a **method** |
| `rewrites: async () => […]` | detect | detected as a **property** |
| `rewrites() {…}` sync method | detect | detected |
| `export default async (phase,{defaultConfig}) => ({ … rewrites … })` | detect | detected |
| named `export default function config(){ return { rewrites … } }` | detect | detected |
| CJS `module.exports = { rewrites … }` | detect | detected |
| `const cfg = {rewrites}; export default cfg` | detect | detected |
| `Object.assign({}, { rewrites … })` | detect | detected |
| `plugins: [...]` | **fail closed** | `analysable=false`, `opaque=["plugins"]` |
| `{ ...base }` spread | fail closed | `analysable=false` |
| computed key `{ [k]: … }` | fail closed | `analysable=false` |
| indirect export of an imported identifier | fail closed | `analysable=false` |
| `export default withPreset({…})` | fail closed | `analysable=false` |
| the word `rewrites:` in a comment / string | no detection | not detected |
| `rewrites:` on an unrelated object | no detection | not detected |
| `env: { rewrites: [] }` (nested, not top level) | no detection | not detected |

**No arbitrary config code is evaluated** — the analyser parses with the
TypeScript compiler API and never `import`s or `require`s the config. Verified
by reading: no `eval`, no dynamic `import()` of the target file.

Caller behaviour confirmed: `triage-vulnerabilities.mjs` treats
`analysable: false` as `present: true` (i.e. REACHABLE), so an unreadable
config cannot be reported as absence.

**Verdict: F-4 closed.** Residual, unchanged: the analyser reads
`apps/web/next.config.mjs` only (Phase 27's N-2).

### 9.2 F-5 — dependency classifier

Planted my own unknown advisories through the real
`triage-vulnerabilities.mjs --audit-file` path:

| Fixture | Classification | Gate exit |
| ------- | -------------- | --------- |
| `reviewer-unknown-lib`, high, dev-only paths | **`REACHABLE (unclassified)`** — *not* BUILD-TIME | 1 |
| `reviewer-prod-lib`, critical, production paths | **`REACHABLE (unclassified)`** | 1 |

An advisory with no explicit rule does **not** silently become BUILD-TIME.
`EXPLICIT_BUILD_TIME_PACKAGES` is the only non-rule route, and it is empty of
silent entries. The shipped verifier `verify-dependency-triage.mjs` passes
(21/21 assertions).

**Current advisory population re-checked: 48 triaged advisories**, unchanged —
30 `BUILD-TIME`, 18 `NOT REACHABLE`, **0 `REACHABLE`**. Classification is
identical to the previous phase's record.

**Verdict: F-5 closed.**

---

## 10. Storage backup / restore

### 10.1 Runbook audit against real infrastructure

| Brief requirement | Result |
| ----------------- | ------ |
| No nonexistent `docker-compose` service names | **CONFIRMED FIXED.** `docker compose config --services` returns exactly `minio, minio-bootstrap, postgres, redis`. The runbook now uses a `PG="docker compose exec -T postgres"` variable and orchestration-agnostic wording (§4.1). No `api`/`web` service is named. |
| No PostgreSQL volume used as document storage | **CONFIRMED FIXED.** `grep` finds no operative `postgres_data` / `var/lib/postgresql` command; the only mentions are in the Phase 28 correction table describing the old defect. §4.3 archives `$STORAGE_DIR` only. |
| No `\|\| true` hiding backup failure | **CONFIRMED FIXED.** The only occurrence is prose explaining its removal. `set -euo pipefail` is set and the exit status is checked. |
| No assumed `STORAGE_DIR` volume | **CONFIRMED FIXED.** §4.1 states plainly the repository provides no storage backend; §1 says Redis/MinIO are unused and must not be backed up. |
| Restore works with a plain host directory | **CONFIRMED** — the verifier uses `mkdtemp` and `tar -xzf … -C`. |

**FOUND — documentation defect (LOW, DOC-1): `docs/BACKUP_RESTORE.md` has no
§5.** The document runs `## 0` … `## 4`, then jumps to `## 6 Handling
application writes during backup`. Two places reference the missing section:

- §9 RTO table: "RTO | Time to run **§5** plus §8"
- §0 correction D-1: "§4/§5 used `docker compose stop api web` …"

Phase 28 deleted the Phase 27 §5 (the "stop the writers" section) when it
removed the nonexistent `api`/`web` service names, but did not renumber and
did not repoint the two references. The operational content the removed §5
carried — the requirement that writers be stopped — **is** preserved, but
only obliquely, in §6's read-only-window recommendation. An operator following
the RTO row is pointed at a section that does not exist. This is a
documentation defect, not a security defect.

### 10.2 The automated verifier

`node scripts/verify-storage-backup-restore.mjs` → **`PASS — 22/22`**, exactly
as claimed, reproduced from scratch:

- Fixture: 8 files / 12 directories, deep nesting, spaces, shell-significant
  characters, a zero-byte file, a 512 KB blob, an empty subdirectory, realistic
  `<documentId>/<random><ext>` layout.
- Archive: 21 entries, provably contains no PostgreSQL path and no out-of-tree
  canary.
- **A failing `tar` is detectable**: measured exit 2, and the file is *still
  created* — confirming the `|| true` defect (D-3) was real and dangerous.
- Source tree destroyed, then restored: **21 entries compared, 0 differences**
  in SHA-256, size, mode and relative path.
- Empty subdirectory survived; zero-byte file still zero bytes; `STORAGE_DIR`
  root still `0700`, contents `0600`.
- The **real compiled `StorageService` from `dist`**, running in
  `NODE_ENV=production`, starts on the restored tree and retrieves a document
  whose digest matches the pre-backup value.
- Traversal refused on the restored tree: `../`, `doc/../../canary`, absolute
  path, trailing `..`. The out-of-tree canary was never read.
- A post-restore upload lands inside `STORAGE_DIR` at mode `0600`.
- Fixture tree removed in `finally`; my run reported `cleaned up … removed`.

**Path-resolution check:** the script resolves `dist` from its own location
(`repoRoot`), not from `cwd`, so it cannot be tricked into reading a different
tree.

### 10.3 Traversal — my own independent probes

I drove the compiled `StorageService.retrieve()` directly with variants the
shipped harness does not cover:

| Probe | Result |
| ----- | ------ |
| `../CANARY.txt` | refused — "invalid key" |
| `..%2fCANARY.txt` (encoded) | refused — not found |
| `%2e%2e%2fCANARY.txt` | refused — not found |
| `..\CANARY.txt` (Windows-style) | refused — "invalid key" |
| `C:\Windows\win.ini` | refused — not found |
| `x\0/../../CANARY.txt` (NUL byte) | refused — "invalid key" |
| `/tmp/.../CANARY.txt` (absolute) | refused — "invalid key" |
| `．．/CANARY.txt` (fullwidth dots) | refused — not found |
| `.. /CANARY.txt` | refused — not found |
| `a/b/../../../../CANARY.txt` | refused — "invalid key" |

**Encoded, Windows-style, NUL-byte and Unicode-dot traversal are all refused.**
The container is not client-reachable in any case (§10.4), but the check is
belt-and-braces.

### 10.4 Containment model: **lexical, not `realpath`**

Confirmed by reading `apps/api/src/storage/storage.service.ts:83-101` and by
observation. `resolveContainment` normalises the key, rejects absolute paths
and `..` sequences, then prefix-checks `path.resolve(baseDir, key)`. It never
calls `realpath`, so a **symlink planted inside `STORAGE_DIR` is followed**.

The shipped verifier plants exactly such a symlink and reports
`FOLLOWED — the lexical prefix check does not resolve symlinks`. I confirmed
this independently.

**Exploitability assessment — this is NOT a vulnerability:**

- `storageKey` is always `<documentId>/<random-hex><ext>` produced by
  `generateSafeKey` (line 103-107) with a 16-byte CSPRNG value.
- `retrieve`/`delete`/`exists` are called with the value read back from the
  `health_documents` row, not from a client-supplied path. I confirmed the
  compiled route-authorization gate and the controllers do not accept a
  caller-supplied key.
- `upload` uses `writeFileSync` (line 115) and `mkdirSync`; no code path in the
  repository creates a symlink.
- Exploitation therefore requires an attacker who can already write inside a
  `0700` directory owned by the application uid — at which point they can read
  the files directly and have gained nothing.

**Classification: defence-in-depth observation, not a security defect.** The
Phase 28 runbook's §14.4 records this accurately, including the reason it was
deliberately not changed (switching to `realpath` breaks deployments where
`STORAGE_DIR` is itself a symlinked mount path). I agree that is a real
trade-off and that it should be decided explicitly rather than discovered
during an incident.

**Symlink behaviour in the backup path is UNVERIFIED.** The fixture contains no
symlink, so a storage tree containing symlinks has not been round-tripped
through archive/restore. §14.3 says so. I did not close that gap.

### 10.5 Not proven

Production volume (8 files is not a scale test); any real storage backend
(volume, network filesystem, object-store mount, platform snapshot); encryption;
retention; rotation; scheduling. The verifier says all of this in its own
output, which is honest.

---

## 11. Database backup / restore — independently reproduced

Phase 27 claimed a real DB backup/restore. I did not take that claim. I ran my
own end-to-end drill on a throwaway `postgres:16-alpine` container.

| Step | Observed |
| ---- | -------- |
| Seed via the **real application** (`NODE_ENV=production`, compiled `dist`) | `register` → 201, `login` → 201, `/auth/me` → 200 |
| Pre-backup fingerprint | tables **37**, migrations **2**, users-md5 `6967a78429a0e71c3def83b7e08fbc3c`, audit rows **2** |
| `pg_dump -Fc` | exit 0, 119,102 bytes |
| `pg_restore --list` | 303 TOC lines, **37 TABLE DATA** entries |
| **Destructive step** | `DROP DATABASE … WITH (FORCE)`; confirmed absent |
| `pg_restore` into a fresh empty database | **exit 0, no errors** |
| Post-restore fingerprint | tables **37**, migrations **2**, users-md5 `6967a78429a0e71c3def83b7e08fbc3c`, audit rows **2** |
| **`prisma migrate status`** | "2 migrations found… **Database schema is up to date!**" |
| **Pre-backup user logs in on restored data** | **HTTP 201** — the decisive test |
| `/auth/me` with the re-issued token | **HTTP 200**, same user id |
| Wrong password on restored data | **HTTP 401** — the hash restored as a **hash** |
| Refresh-token storage | 2 rows, both 64-char hashes, **0** un-hashed |
| Cleanup | throwaway container removed |

**Every claim in §14 of the runbook reproduced independently**, including the
content-fingerprint equality and the pre-backup-user-can-authenticate result.
The developer `ecc` database was never a target (verified by fingerprint in
§3.2).

### 11.1 Storage: three different levels of claim — kept distinct

| Claim | Status |
| ----- | ------ |
| Documented procedure (`docs/BACKUP_RESTORE.md` §4/§6) | Present and internally consistent; see DOC-1 |
| Automated verifier (`scripts/verify-storage-backup-restore.mjs`) | **Executed**, 22/22, on throwaway fixtures |
| Actual tested restore of real documents over HTTP | **NOT DONE** — the service was exercised directly, not through a running API backed by a restored tree |

**A passing throwaway test is not production backup readiness.** Backup
automation, encryption, off-host storage, retention and RPO/RTO all remain
unimplemented, as the runbook states. I do not treat any of that as a security
*defect*: it is an operational gap with a stated owner, and the runbook is
explicit about it.

---

## 12. CI / release gates

Run **sequentially** (never concurrently — the `dist` sharing issue in N-10 makes
concurrent runs unsafe).

| Gate | Result |
| ---- | ------ |
| `verify:metadata` (decorator metadata) | **PASS** — 213 typed params, 62 class-typed, 0 `Function` entries, 59 identity checks |
| `verify:routes` (route authorization) | **PASS** |
| `verify-config-contract.mjs` | **PASS** |
| `verify-env-contract.mjs` | **PASS** |
| `verify-dependency-audit.mjs` | **PASS** (argon2id + Prisma query engine load verified) |
| `triage-vulnerabilities.mjs` | **PASS** — 48 advisories, 0 reachable |
| `verify-dependency-triage.mjs` | **PASS** 21/21 |
| `verify-next-config-features.mjs` | **PASS** |
| `typecheck` (api, web, mobile) | **PASS** |
| `build` / `build:verify` | **PASS** — 280 files, no spec/testing material |
| `verify-db-migrations.sh` | **PASS** — reproducible, idempotent, app boots and authenticates |
| `verify-release-artifact.mjs` | **PASS** — clean/warm/stale builds, 1:1 dist↔src, byte-identical rebuilds, no secrets, SIGTERM exit 143 |
| `verify-docker-images.mjs` | **PASS** 57/57 on a clean rebuild |
| `verify-ci-parity.mjs` | **PASS** — 39 of 42 locally-runnable commands executed, 0 failed |
| compiled-auth (4 modes) | **PASS** — core, session, lockout, account |
| `verify-storage-backup-restore.mjs` | **PASS** 22/22 |

### 12.1 Throwaway PostgreSQL cleanup — verified on all four paths

`scripts/lib/throwaway-postgres.mjs` is Phase 26's contribution. I tested it
directly:

| Path | Behaviour | Leftover |
| ---- | --------- | -------- |
| Success (no explicit `destroy()`) | `process.on('exit')` cleans up | **NONE** |
| **Readiness failure** (container starts, server never accepts queries) | `start()` catches, calls `destroy()`, rethrows | **NONE** |
| Unexpected exception (uncaught) | `uncaughtException` handler destroys, exit 1 | **NONE** |
| Test failure (non-zero suite exit) | exit handler destroys | **NONE** |
| SIGTERM mid-run | signal handler destroys, exit 130 | **NONE** |
| `migrate()` failure after handlers installed | `uncaughtException` destroys | **NONE** |

Determinism: per-run random suffix, ephemeral host port, loopback-only
publishing, and a database name always prefixed `ecc_<label>_…` so a developer
database cannot be reached even by a bug. **Provisioning is deterministic and
cleanup is complete on all tested paths.**

After the entire review — every gate, every mutation harness, both backup/restore
drills — `docker ps -a` showed **only the developer's own long-running
`ecc-postgres`, `ecc-redis`, `ecc-minio` containers**. No leaked containers, no
leaked ports from gate-provisioned infrastructure.

### 12.2 CI parity gap — FOUND (see F-2 in §17)

`verify-ci-parity.mjs` has a `REQUIRED_GATES` list that fails the build if a
gate is not wired into `.github/workflows/ci.yml`. **None of Phase 28's three
new gates is in that list, and none is in `ci.yml`:**

| New gate | In `ci.yml`? | In `REQUIRED_GATES`? |
| -------- | ------------ | --------------------- |
| `mutate-rate-limit-n12.mjs` (`verify:ratelimit:n12:mutate`) | **no** | **no** |
| `verify-storage-backup-restore.mjs` (`verify:storage:backup`) | **no** | **no** |
| `run-db-suites.mjs` | **no** | **no** |

The two container-gate N-12 checks *are* wired in, because they live inside
`verify-docker-images.mjs`, which CI runs. So the N-12 fix has partial CI
coverage via the container job.

---

## 13. ValidationPipe strictness (Phase 26)

Ten reviewer-authored attacks against a mutated copy, run with the gate invoked
**by absolute path from an unrelated cwd** to defeat any cwd-based path
resolution.

| Attack | Result |
| ------ | ------ |
| V1 remove `forbidNonWhitelisted: true` | **DETECTED** |
| V2 `forbidNonWhitelisted: false` | **DETECTED** |
| V3 `forbidNonWhitelisted: process.env.NODE_ENV === "production"` (non-literal) | **DETECTED** |
| V4 `forbidNonWhitelisted: { enabled: true }` (nested property) | **DETECTED** |
| V5 `whitelist: false` | **DETECTED** |
| V6 `transform: false` | **DETECTED** |
| V7 delete the **entire** `useGlobalPipes` registration | **DETECTED** |
| V8 production hardened but the **e2e mirror** `create-test-app.ts` silently relaxed | **DETECTED** |
| V9 pipe hoisted to a variable (options no longer statically visible) | **DETECTED** |
| V0 control (unmutated) | **green** (correct) |

Each property is asserted **semantically**: the parser reads the AST and
distinguishes a literal `true` from `false`, from a non-literal expression, from
a shorthand, and from a missing property
(`verify-config-contract.mjs:406-417`). A "no `ValidationPipe` at all" and a
"pipe whose options cannot be statically read" are reported as **distinct**
failures (lines 466-480).

**Path-resolution check (the specific attack the brief asked for):** I mutated
`main.ts` in the throwaway copy, then ran the gate **from
`/tmp/opencode/p28rev/elsewhere`**, an unrelated directory. It reported:

> `apps/api/src/main.ts:39 — the global ValidationPipe does not set
> forbidNonWhitelisted (the production bootstrap); unknown properties are
> silently accepted rather than rejected.`

…and exited 1. The gate resolves paths against its **own `repoRoot`**
(`verify-config-contract.mjs:427-430`, with an explicit comment warning that
resolving against `cwd` would let a scratch run read the real repository's
file). **The gate is genuinely reading the mutated file.** With the copy
restored, the same invocation from the unrelated cwd exits 0.

Both call sites are checked: production `main.ts` and the e2e harness mirror
`create-test-app.ts` (`PIPE_SITES`, line 458-461).

**Verdict: the Phase 26 assertion is load-bearing, semantically checked, and
path-safe.**

---

## 14. Test results — actual counts

Every number below is what **I** observed, not a historical figure.

| Suite | Command | Result |
| ----- | ------- | ------ |
| API unit (no DB) | `vitest run --config vitest.config.unit.ts` | **166 passed**, 44 skipped (DB-gated) |
| API e2e (real DB) | `vitest run --config vitest.config.e2e.ts` | **138 passed** |
| API all (real DB) | `vitest run` | **348 passed**, 27 files |
| Mobile | `pnpm --filter @ecc/mobile test` | **34 passed**, 6 files |
| Web | `pnpm --filter @ecc/web test` | **1 passed** |
| Rate-limit guard unit | | 19 passed |
| N-12 HTTP e2e | | 12 passed |
| Mobile `api.spec.ts` | | 9 passed |
| `typecheck` | api + web + mobile | PASS |
| `build` / `build:verify` | | PASS |

> **Note on the "166" figure.** Running the unit suite *without* a database
> reports `166 passed | 44 skipped`. Those 44 are not failures — they are
> DB-gated specs that self-skip. The implementer's report cites 166 for unit and
> 138 for e2e, which is exactly the no-DB / with-DB split. Accurate, but a
> reader could mistake 166 for "total unit tests" when the total is 210. Worth
> stating explicitly in future reports.

### 14.1 Lint — **BASELINE-EQUIVALENT, NOT GREEN**

```
✖ 124 problems (55 errors, 69 warnings)
Exit status 1
```

**Exactly the known baseline: 55 errors / 69 warnings.** Lint remains **red**;
it is `continue-on-error` in CI and advisory. It is neither a regression nor a
pass. It should not be described as "green" in any release document.

---

## 15. Phase 24 D-1…D-9 reconciliation

Re-derived from the current tree. **No previous disposition was accepted
without evidence.**

### D-1 — deactivated-account window · **STILL OPEN · security-relevant · bounded by 15 min**

`JwtAuthGuard` (`auth.guard.ts:26-86`) validates the token and sets
`req.user`; it **never queries account state**. `isActive` / `deletedAt` are
checked only at **issuance** (`auth.service.ts:133-138`), at **refresh**
(line 204: `findUnique({ where: { id, isActive: true } })`) and in
`getProfile` (line 279).

So a user deactivated *after* obtaining a token keeps access until that token
expires. **The bound is `ACCESS_TOKEN_TTL_SECONDS` = 15 minutes**, enforced at
*verification* by `maxAge` (not at issuance, which is why Phase 24's D-2 fix
converted a policy into a property of verification). I confirmed the 15-minute
bound empirically: a one-hour-old token with a ten-year `exp` is refused.

- Security-relevant: yes, but it is a **15-minute** window, not an unbounded one.
- Still applicable: **yes.**
- Deferred disposition justified: **yes**, for a bounded 15-minute revocation
  latency on a 15-minute-token system — a well-understood, standard trade-off.
  Nothing about it changed in Phases 25-28.
- **What would invalidate the disposition:** any increase in
  `ACCESS_TOKEN_TTL_SECONDS`; a longer-lived credential (refresh cookie is
  30 days) reaching a route without a state re-check; or a deployment that
  relies on immediate revocation. The first is mutation-tested (M2 of
  `mutate-token-lifetime.mjs`) and caught.

### D-2 — access-token lifetime · **CLOSED · verified**

`maxAge: ACCESS_TOKEN_TTL_SECONDS` at `auth.guard.ts:72`, constant
`15 * 60` at `security-config.ts:23`. Verified at source, compiled dist and a
live process (§7). Mutation-tested (M1, M2 of the harness — both observed to
fail the suite).

### D-3 — `CareTaskController` compiled but unreachable · **STILL OPEN · not security-relevant**

`CareTaskController` (`apps/api/src/modules/care-tasks/care-tasks.controller.ts:13`)
is compiled into `dist` but declared in **no** module: `CareTaskService` is
referenced from nowhere outside `care-tasks/`, and the directory contains no
`*.module.ts`. The route-authorization gate lists it under "Compiled but NOT
registered in any module (unreachable — not a live surface)".

- Security-relevant: **no.** Unreachable code is not an attack surface.
- Still applicable: **yes** — it is dead code in a shipped artifact.
- Bounded: **yes** — 5 handlers, not registered.
- Disposition justified: **yes.** It is a hygiene/dead-code issue.
- **Would invalidate it:** someone registering the controller, which would make
  its 5 handlers a live surface — and at that moment the gate would hold them
  to the full guard/DTO standard (it only exempts *unregistered* controllers,
  `verify-route-authorization.mjs:336-339`).

### D-4 — unvalidated request body · **CLOSED · verified**

F-2 and F-3 above. Confirmed by mutation.

### D-5 — multer advisories · **STILL OPEN as a disposition · verified NOT reachable**

6 high advisories classified `NOT REACHABLE`. Independently confirmed:
`grep` finds **zero** references to `multer`, `FileInterceptor`,
`FilesInterceptor` or `AnyFiles` in `apps/api/src`, and `multer` is **not a
declared dependency** of `@ecc/api` — it is a transitive of
`@nestjs/platform-express` and is never imported. Document uploads go through
the application's own `StorageService`.

- Security-relevant: **no** — the vulnerable code is never loaded.
- Disposition justified: **yes.**
- **Would invalidate it:** any `@UseInterceptors(FileInterceptor(...))`, or
  multer being promoted to a direct dependency.

### D-6 — Next.js critical/high advisories · **STILL OPEN · verified NOT reachable · the most fragile of the set**

10 `next` advisories (2 critical, 8 high) plus 2 `postcss` high, all
`NOT REACHABLE`. I verified the *premises* independently rather than trusting
the classifier:

| Vulnerable feature | Independently confirmed absent? |
| ------------------ | ------------------------------ |
| `next/image` | **YES** — no `next/image` import, no `<Image` element anywhere in `apps/web/src` |
| middleware / proxy | **YES** — no `middleware.{ts,js}`, no `src/middleware.ts`, no `src/proxy.ts`, no `app/proxy.ts` |
| rewrites | **YES** — `next.config.mjs` declares no `rewrites`; AST analyser agrees |
| Server Actions / Server Functions | **YES** — no `'use server'` directive anywhere |
| redirects / headers / i18n | **YES** — `next.config.mjs` has only `reactStrictMode`, `poweredByHeader`, `output`, `transpilePackages`, `experimental.typedRoutes`, `eslint` |
| `next.config.mjs` content | Verified by reading it directly |

- Security-relevant: **yes if any premise becomes false.** These are
  **critical**-severity advisories.
- Still applicable: **yes.**
- Disposition justified: **yes**, conditional on the premises, which I confirmed.
- **This is the disposition most likely to become invalid, and it is
  premise-dependent rather than code-dependent.** Adding one `next.config.mjs`
  line (`rewrites`, `images`) or one `'use server'` directive flips a
  **critical** RCE advisory from `NOT REACHABLE` to `REACHABLE` and fails the
  build. The triage script states this ("re-check the moment … appears"), and
  the CI job runs it on every push. **The residual risk is that the premise is
  checked by the same script that consumes it** — there is no independent
  second source. I record this as a **defence-in-depth observation**, not a
  defect: a reviewer can and did check the premises by hand.

### D-7 — devDependency / transitive advisories · **STILL OPEN · verified build-time**

30 `BUILD-TIME` advisories across `@xmldom/xmldom`, `tar` (incl. 1 critical),
`vitest` (critical), `vite`, `glob`, `picomatch`, `tmp`, `image-size`,
`turbo-stream`. F-5 now requires each of these to be justified **explicitly**
in code rather than by a generic `devOnly` fallback.

- Security-relevant: **no** — these are dev/build/CI tools, not installed into
  either runtime image.
- Corroborated: the container gate independently confirms the API image ships
  `dist node_modules package.json prisma` and no test or source material, and
  the web image is built from `.next/standalone`.
- Disposition justified: **yes.**
- **Would invalidate it:** moving any of these into a runtime `dependencies`
  block, or shipping a dev-inclusive image.

### D-8 — frozen-lockfile enforcement · **CLOSED · verified**

All four CI jobs run `pnpm install --frozen-lockfile` (ci.yml lines 60, 300,
321, 367). `pnpm-lock.yaml` is **byte-identical** to HEAD throughout this
review (`bc20d17e…`). The release job additionally asserts
`git diff --exit-code -- pnpm-lock.yaml`.

- Security-relevant: yes, as a supply-chain control; currently **effective**.
- **Would invalidate it:** adding a job that installs without the flag, or a
  postinstall that mutates the lockfile.

### D-9 — container-mutation disk cost · **STILL OPEN · confirmed, and it bit me**

`mutate-container-gate.mjs` builds every mutant with `--no-cache` and refuses
to start below **20 GB** free (line 286). This machine has **7.8 GB** free on a
90%-full filesystem, so **I could not run the container mutation harness at
all**, and could not independently observe M8–M11 fail (§6.3).

- Security-relevant: **no** — this is an operational/cost gap.
- Still applicable: **yes, verified.**
- Disposition justified: **partially.** The script's own mitigation
  (`--prune-cache`, low-space warning, post-mutant free-space reporting) is
  reasonable. But a gate that cannot run on a developer machine is a gate that
  only runs on whoever has 20 GB free.
- **What I did instead:** proved the same properties at source level with 11
  mutations (all detected), confirmed all four container anchor strings are
  unique, and ran the real container gate on a clean rebuild (57/57).
- **Would invalidate the disposition:** the disk threshold being met but the
  gate still being skipped for time reasons. The harness needs **4 full
  `--no-cache` image builds**; at ~4 minutes each that is a real CI cost that
  the workflow currently excludes on purpose ("The mutation harnesses are not
  run in CI"). So the container mutation harness **is not in CI either**, and
  is a laptop-only gate.

---

## 16. Remaining Phase 27 findings re-checked

| ID | Re-derived state | Still applicable | Security-relevant |
|----|------------------|------------------|--------------------|
| **N-12** | **Fixed** and verified (§5) | resolved | — |
| **N-10** | `verify-release-artifact.mjs` does `rmSync(apiDist, {recursive:true, force:true})` (lines 248, 408, 413) while `verify-db-migrations.sh` reads `node dist/main.js` from the **same** directory (lines 294, 324). Concurrent runs can pull `dist` out from under a running gate. | **yes** | no (availability/CI integrity) |
| **N-11** | Database name is `ecc_<label>_<slug>`, and `verify-ci-parity.mjs:63` uses `label: 'ci-parity'` → **`ecc_ci-parity_mcyfcd9b2a54`**, containing a hyphen. I reproduced it end-to-end: `prisma migrate deploy` succeeded, `psql -d <name> -tAc` succeeded, `psql -l` listed it. | **yes, but the practical impact is lower than reported** | no |
| **N-2** | Rewrites detector reads `apps/web/next.config.mjs` **only** (line 64). A plugin or a sibling `next.config.js` is invisible. The F-4 analyser now fails closed on `plugins`/spreads *within* that file, but a config in a different file is not examined at all. | **yes** | conditional — see D-6 |
| **N-1** | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` **is** now pinned by an absolute assertion: `auth.guard.spec.ts:273` asserts `toBe(5)`, and mutant M4 widens it to 1 hour and is observed to fail. | **substantially addressed** | no |
| **N-3** | The DTO gate's rule is `c.effective === 0` — a **floor**, not a per-field minimum. A DTO with one trivial constraint on one field and nothing on the rest passes. | **yes** | low (defence-in-depth) |
| **N-4** | Three public stub routes still bind keyed bodies: `forgotPassword @Body('email')`, `resetPassword @Body('token') @Body('newPassword')`, `verifyEmail @Body('token')` (`auth.controller.ts:130,137,143`). All return **constant responses** and are Phase 4 stubs, on the documented public allow-list. | **yes** | low |
| **N-6** | `mutate-config-contract.mjs` operates on `mkdtemp` copies (line 61) and does not modify the repository. Independently exercised above; no path-resolution issue found. | **addressed** | no |
| **N-7** | `PIPE_SITES` is still a hardcoded two-entry list (line 458-461). A **third** file that registers a global pipe would not be checked. | **yes** | low |
| **N-9** | `PROJECT_PLAN.md` retains superseded sections but they are explicitly marked `Status: SUPERSEDED` (lines 906, 934, 956) and line 33 warns readers off. | **addressed as documentation** | no |

---

## 17. Findings from this review

Findings are ordered by consequence, not by novelty. **Nothing below was
fixed.**

### F-1 — `docs/BACKUP_RESTORE.md` references a section that does not exist
**Severity: Low · Category: documentation defect · Component: the runbook**

`## 5` is missing: the document goes `## 0` … `## 4`, then `## 6 Handling
application writes during backup`. Referenced from:

- §9 RTO table — "RTO | Time to run **§5** plus §8"
- §0 correction row D-1 — "**§4/§5** used `docker compose stop api web` …"

**Evidence:** `grep -n "^## " docs/BACKUP_RESTORE.md` returns 0,1,2,3,4,6,7,…,14.
`grep -n "§5"` returns exactly the two references above.

**Consequence:** an operator computing RTO, or reading the D-1 correction, is
pointed at a section that is not there. The substantive requirement that Phase
27's §5 carried ("writers must be stopped during the capture") survives only
obliquely, inside §6's read-only-window recommendation. This is a
**documentation** defect: the three operational defects Phase 28 set out to fix
(D-1 nonexistent services, D-2 PostgreSQL volume as storage, D-3 `|| true`)
**are** correctly fixed and I verified each.

**Exploitability:** none. **Defence-in-depth:** none. **Not a security finding.**

### F-2 — None of Phase 28's new gates is wired into CI
**Severity: Medium · Category: CI/release-process gap · Component: `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`**

`mutate-rate-limit-n12.mjs`, `verify-storage-backup-restore.mjs` and
`run-db-suites.mjs` are **absent from `ci.yml`**, and absent from the
`REQUIRED_GATES` list in `verify-ci-parity.mjs` (lines 229-242) whose entire
purpose is to fail the build when a gate is not wired in.

**Evidence:** `grep -c` for each name in `ci.yml` returns 0; likewise in
`verify-ci-parity.mjs`. The same `grep` returns **1** for
`verify-dependency-triage.mjs` and `verify-next-config-features.mjs`, which *are*
wired in — so the mechanism works and simply was not extended.

**Consequence:** the N-12 regression suite, the storage backup verifier and the
DB-suite driver run only when a human remembers. A future change that reverts
429→403 would be caught in CI **only** by the container job's two new checks
(they are, because they live inside `verify-docker-images.mjs`). The
source-level N-12 regression suite, which runs in seconds, would not run at
all.

**Not a vulnerability.** No protection is missing from the product; a
regression guard is not enforced in CI. **This is the single most actionable
item in this review**, and it is cheap to fix.

### F-3 — Mobile client deletes the session on a genuine 403
**Severity: Low · Category: inherited design tension · Component: `apps/mobile/src/services/api.ts:35`**

Phase 28's brief asked me to confirm `403 → session NOT cleared` *unless it is
specifically an authentication/session invalidation path already designed to do
so*. I confirmed 401 clears and 429 does not — but **403 still clears**, and
that is pre-existing, unchanged code.

**Consequence:** a user who is refused for a genuine authorization reason
(e.g. `403 "Access denied: no authorized care-circle membership for this
senior"`, which I observed live) is logged out on the mobile client, losing a
valid access token over a permission decision that will not change on retry.

**Relationship to N-12:** this is the same class of defect N-12 was, one level
up. The API-side fix is correct; the client-side rule remains broader than the
server's semantics. Not a vulnerability (no access is granted that should not
be; only a UX/session-availability cost), and fixing it is a product decision,
not a security one. **I did not fix it and am not recommending it be fixed
without that decision.**

### F-4 — Storage backup/restore not verified at any scale, and symlink round-trip untested
**Severity: Informational · Category: operational gap · Component: `docs/BACKUP_RESTORE.md` §14.3**

Independently confirmed: 8 files, one local filesystem, no symlink in the
fixture, no real HTTP round-trip. Backup automation, encryption, off-host
storage and retention are **not implemented**. The runbook states all of this
plainly and does not overclaim.

**Not a vulnerability.** It is an operational gap with a named owner, and the
document is honest about it. Recorded so that a throwaway `tar` test is never
mistaken for production backup readiness.

### F-5 — `Retry-After` semantics: the value is 900 on the very first refusal
**Severity: Informational · Category: correctness observation · Not a defect**

The window slides on `lastAttempt`, which is only advanced on an *allowed*
request. A client that spends its 10-request budget in a burst therefore gets
`Retry-After: 900` on the first refusal, even though the budget would have
reset sooner under a different windowing policy. This is **correct for the
implemented policy** and the comment is accurate. Noting it because it will
look surprising to an operator reading access logs, and because the policy
itself (in-process, per-replica, IP-keyed) is a known pre-existing limitation,
not a Phase 28 regression.

### F-6 — Container mutation harness is unreachable on this hardware (D-9 consequence)
**Severity: Informational · Category: verification gap · Component: `scripts/mutate-container-gate.mjs`**

Requires 20 GB free; this machine has 7.8 GB. The harness is also excluded
from CI by design. Consequently the M8–M11 container mutants could not be
observed to fail. §6.3 records the substitute evidence. **This is a limitation
of this review and a property of the harness, both of which are stated rather
than papered over.**

### Non-finding — two leftover temp directories
`/tmp/ecc-p28-storage-Cmvz7X` and `/tmp/ecc-p28-storage-PHk4mY` (both timestamped
17:58, before this review began at 20:24) remain on disk. The verifier's own
output during my run reported `cleaned up … removed`, and my runs left nothing.
These are from the implementer's session — most likely the fault-injection runs
the runbook documents in §14.2, which by their nature abort cleanup. **Not
attributed to Phase 28 as a defect**; recorded because a cleanup path that can
be bypassed by a fault is worth knowing about.

---

## 18. Release-readiness matrix

| # | Category | Verified | Unverified / Blocked | Evidence |
| - | -------- | -------- | -------------------- | -------- |
| 1 | **Security controls** | Global exception filter, helmet headers, body limit, fail-closed production config, request-id | External pen test | §5, §13, §14 |
| 2 | **Authentication** | Registration, login, refresh rotation, reuse detection, lockout, account state, logout, forged/alg-none tokens — all 4 compiled-auth modes | — | §14, compiled-auth PASS |
| 3 | **Authorization** | 0 un-guarded non-public routes; care-circle checks; role guards; duplicate-route detection; live 403 proven | The one *unmounted* controller (D-3) is unverified by design | `verify:routes` PASS, §5.2 |
| 4 | **JWT lifetime** | `min(exp, iat + 15m)`; future `iat` refused at source, dist and live process | — | §7, D-2 |
| 5 | **DTO validation** | Metatype **and** constraint metadata; conditional decorators don't count; public routes not exempt; keyed bodies policed | Per-field minimum (N-3) | §8, 4 mutations |
| 6 | **Rate limiting** | 429 + `RATE_LIMITED` + truthful `Retry-After`; 403/401 untouched; mobile keeps session on 429 | Container mutants M8–M11 not observed failing (F-6); not in CI (F-2); single-replica in-process store | §5, §6.1, §6.2, 11/11 |
| 7 | **Dependency reachability** | 48 advisories triaged; unknown advisory → REACHABLE (unclassified); AST-based rewrites detection; fail-closed analyser | Premise checks share one implementation (D-6) | §9, §15 |
| 8 | **Container hardening** | Clean rebuild; uid 1000; no app-path writes; no secrets; no test material; storage modes; 57/57 | Runtime image from a registry (not built here) | §14, clean build |
| 9 | **Database migration safety** | Reproducible, idempotent, destructive-statement review, app boots and authenticates on a fresh schema | Restore into a newer PG major | `verify-db-migrations.sh` PASS |
| 10 | **Backup / restore** | **Database**: full end-to-end drill reproduced, fingerprint identical, pre-backup user authenticates. **Storage**: 22/22 on throwaway fixtures | Production volume, any real storage backend, symlink round-trip, HTTP round-trip, automation, encryption, retention, RPO/RTO | §10, §11 |
| 11 | **CI** | Workflow structurally sound; 39/42 locally-runnable commands executed, 0 failed; frozen lockfile in all 4 jobs | **GitHub Actions has never run against this tree.** 3 Phase 28 gates not wired in | §12, F-2 |
| 12 | **Staging** | — | **BLOCKED — external infrastructure.** No GitHub environments, no staging secrets, no staging host | Phase 28 disclosure; not contradicted |
| 13 | **Production deployment** | — | **BLOCKED.** No deployment target, no orchestration, no rollback rehearsal | Phase 28 disclosure |
| 14 | **TLS** | — | **UNPROVEN.** No terminator, no certificate management, and the app does not configure TLS to PostgreSQL | Runbook §11; correct disclosure |
| 15 | **Storage durability** | Modes enforced (0700/0600); containment verified against 10 traversal shapes | **UNPROVEN.** No volume, no backup schedule, no durability guarantee | §10.3, §10.5 |
| 16 | **Observability** | — | **UNPROVEN.** No metrics, no alerting, no log aggregation, no disk monitoring. Errors are logged server-side with a request id | Phase 28 disclosure |
| 17 | **Load / concurrency** | N-12 measured under a real burst | **UNPROVEN.** No capacity test, no soak, `connection_limit` set for tests only | Phase 28 disclosure |
| 18 | **Penetration testing** | — | **NOT ATTEMPTED.** Never performed, by anyone | Phase 28 disclosure |
| 19 | **Compliance** | — | **NOT ATTEMPTED.** No certification. `COMPLIANCE.md` exists but certifies nothing | Phase 28 disclosure |

### 18.1 On Phase 28's own disclosures

Each was checked for accuracy rather than accepted:

| Disclosure | Verdict |
| ---------- | ------- |
| Independent reviews of 22/23/25/26 outstanding | **Accurate.** `SECURITY_REVIEW_PHASE_22.md` and `_23.md` **do not exist** in the repository. `SECURITY_REVIEW_PHASE_25.md` and `_26.md` exist but were written by the same agent that implemented those phases, and say so. |
| No staging | **Accurate** — no infrastructure exists. |
| TLS unproven | **Accurate** — no TLS configuration exists anywhere in the tree. |
| Observability unproven | **Accurate** — no metrics or alerting. |
| Production storage volume/load unproven | **Accurate** — `docker-compose.yml` declares only `postgres_data`, `redis_data`, `minio_data`. No application storage volume. |
| Penetration testing unproven | **Accurate** — never attempted. |
| Compliance certification unproven | **Accurate.** |
| Backup automation/encryption/retention absent | **Accurate** — §4 is a manual command; no scheduler, no encryption, no retention. |

**The Phase 28 implementer disclosed the unproven items accurately and did not
overclaim. I found no undisclosed gap in the operational disclosures.**

I do not treat the absence of observability, staging, TLS termination, backup
automation or penetration testing as a **security defect**: each is an
operational absence with a stated owner, and none creates a new, concrete
exploitable condition in the delivered software. They are, however, all
**release blockers for a system holding protected health information**, and
Phase 28 is right to keep them open.

---

## 19. Blockers

### 19.1 Do these findings support closing any previous blocker?

**No. Not on this evidence alone.**

| Blocker | Status after this review |
| ------- | -------------------------- |
| Phase 22 independent review | **OPEN.** No `SECURITY_REVIEW_PHASE_22.md` exists. |
| Phase 23 independent review | **OPEN.** No `SECURITY_REVIEW_PHASE_23.md` exists. |
| Phase 25 independent review | **OPEN.** `SECURITY_REVIEW_PHASE_25.md` exists but was written by that phase's implementer. **This review independently re-verified F-1…F-5 and found them sound and load-bearing** — that is evidence a maintainer may weigh toward closure, but the formal blocker is a maintainer's decision, not mine. |
| Phase 26 independent review | **OPEN.** `SECURITY_REVIEW_PHASE_26.md` has the same authorship problem. **This review independently re-verified the ValidationPipe assertion with 10 mutations and a path-resolution attack, and found it sound.** Same caveat. |
| Phase 28 independent review | **This document.** The N-12 fix, the storage verifier and the runbook corrections were re-derived from the tree and hold, with the qualifications in §6.3 and §17. |

**This review is genuinely independent with respect to Phase 28.** For Phases
25 and 26 it is a *first* independent re-verification, but I was given the
repository and the claims — not a mandate to close those blockers, and I do not
close them.

### 19.2 Release blockers that remain

**I do not state that this system is production ready, and this evidence does
not support such a statement.** The outstanding blockers are:

1. **No staging environment** — external infrastructure.
2. **No production deployment target or rehearsed rollback** — external.
3. **TLS not established** — external, and the app does not terminate it.
4. **Backups are manual, unencrypted, unrotated** — the runbook is a command,
   not a schedule.
5. **No observability or alerting** — including disk-space monitoring, which
   the runbook itself names as the unmitigated failure mode.
6. **No penetration test, no load test, no compliance certification.**
7. **GitHub Actions has never run against this tree** — CI evidence is local
   only.

Within the *code*, the one actionable item is **F-2** (Phase 28's gates not in
CI). Everything else in §17 is a documentation or design-tension item.

---

## 20. Limitations — what I could NOT verify

Stated precisely, because a review that overstates its coverage is worse than
one that admits its edges.

| # | Limitation | Why |
| - | ---------- | --- |
| 1 | **Container mutants M8–M11 were not observed failing.** | `mutate-container-gate.mjs` requires 20 GB free; this machine has 7.8 GB. Substituted: 11 source-level mutations (11/11 detected), anchor-uniqueness checks, and a clean container build on which both new checks PASS. |
| 2 | **GitHub Actions was not executed.** | No remote runner, no network. `verify-ci-parity` executed 39 locally-runnable commands; 3 were skipped by design and 3 need the runner. |
| 3 | **`pnpm audit` against the live registry was not run.** | No network egress. The 48-advisory classification was read from the triage script's own output and the fixtures; I could not confirm the advisory *set* is still current upstream. |
| 4 | **The real advisory set is only as current as its last run.** | Same cause. A newly published advisory would not be in the 48. |
| 5 | **Backup/restore was proven at 3 rows and 8 files.** | Not a production-volume or duration test. RPO/RTO remain **estimates**, correctly labelled as such in §9. |
| 6 | **No load, soak or concurrency testing.** | Out of scope and not attempted. |
| 7 | **Storage symlink round-trip through archive/restore is untested.** | No fixture contains a symlink. |
| 8 | **Mobile was verified by unit test only** — no device, no real network stack, no real `expo-secure-store`. | The 429-does-not-clear-session property is proven at the `apiFetch`/`session` boundary with a mocked store. |
| 9 | **`web` has one test.** | Reported as observed. The web application is effectively untested. |
| 10 | **Two of my own harnesses had defects I found and fixed mid-review** (a leaked mutant in my throwaway copy; a stale-process read). | Both reviewer-side; the repository was never affected. Affected checks were re-run after the fix. Disclosed because a review that hides its own false negatives is not trustworthy. |
| 11 | **F-1's conclusion depends on the assertion that `storageKey` is never client-supplied.** | I verified this by reading the storage service, the DTOs and the compiled route table, and by the absence of any symlink-creating call — not by an exhaustive adversarial trace of every controller. |

---

## 21. Exact evidence needed to close the remaining gaps

Each item below states the command or condition that would convert an
UNVERIFIED cell into a VERIFIED one. **None of these was run here except where
marked.**

| Gap | Exact evidence required |
| --- | ---------------------- |
| Container mutants M8–M11 | `docker builder prune -af; node scripts/mutate-container-gate.mjs --only M8,M9,M10,M11 --min-free-gb 20` on a host with ≥20 GB free, with all four observed to FAIL and the final restored control observed to PASS. |
| CI | A green GitHub Actions run against a commit containing the Phase 28 changes. The run must include the `containers` job; the `release` and `api` jobs alone are insufficient. |
| Phase 28 gates in CI | `mutate-rate-limit-n12.mjs`, `verify-storage-backup-restore.mjs` and `run-db-suites.mjs` added to `ci.yml`, **and** added to `REQUIRED_GATES` in `verify-ci-parity.mjs` so the absence fails the build. Then one green run. |
| Current advisory set | `pnpm audit --json` with network egress, then `node scripts/triage-vulnerabilities.mjs`, with the 48-advisory classification re-confirmed and any new advisory reaching an explicit disposition. |
| Staging | A staging environment exercising §4/§6/§8 of the runbook end to end, with a recorded restore drill. |
| TLS | Evidence of a TLS terminator in front of both images, **and** a decision on whether the API terminates it or a proxy does. |
| Observability | A metrics endpoint or log pipeline with disk-space alerting on the database and backup volumes. |
| Backup production-readiness | A scheduled, monitored, off-host, encrypted backup with a recorded restore drill and a measured RPO/RTO. |
| Pen test | An independent third party. |
| Compliance | An accredited assessor. |

---

## 22. Final factual disposition

**What I verified, independently, against the current tree:**

- **N-12 is fixed as claimed.** A live `NODE_ENV=production` process built from
  the compiled artifact answers **429 / `RATE_LIMITED` / `Retry-After`** on
  exhaustion, while **401** (authentication) and **403 / `FORBIDDEN` /
  no `Retry-After`** (authorization) are unchanged. `Retry-After` was measured
  decaying 900 → 887 → 867 → 847 over real elapsed time, so it tracks the real
  window rather than a constant. The mobile client keeps its session on 429 and
  drops it on 401.
- **The N-12 fix is load-bearing.** The repository harness reproduces 8/8; my
  own eleven independent mutations — covering all eight the brief mandated,
  plus three more — were **11/11 detected**.
- **Phase 25 F-1 is closed and proven at the artifact level**, not only in unit
  tests. I first reproduced the original defect (`maxAge` alone accepting a
  ten-year-future `iat`), then showed the current guard rejects it at source, in
  `dist`, and in a live production process.
- **F-2, F-3, F-4, F-5 all hold**, each attacked with my own mutations or
  probes: 4/4 DTO attacks detected; 16/16 Next-config probes correct; an
  unknown advisory classifies as `REACHABLE (unclassified)`, never silently
  BUILD-TIME; the existing 48 advisories are unchanged.
- **The Phase 26 ValidationPipe assertion is sound**: 10/10 attacks detected,
  each property asserted semantically, both call sites checked, and the gate
  provably reads the *mutated* file even when invoked by absolute path from an
  unrelated working directory.
- **Storage backup/restore: 22/22 reproduced.** The three operational runbook
  defects are genuinely fixed. I independently confirmed containment against
  ten traversal shapes including encoded, Windows-style, NUL-byte and
  Unicode-dot variants, and confirmed the containment model is lexical, not
  `realpath` — which is **not client-reachable** and is correctly documented as
  a defence-in-depth observation.
- **Database backup/restore: fully reproduced end to end** on a throwaway
  PostgreSQL — seeded through the real application, dumped, **database
  destroyed**, restored, content fingerprint identical, Prisma migration state
  intact, and **the pre-backup user authenticated successfully** with a wrong
  password still refused.
- **All gates pass**, including a genuinely clean container rebuild (57/57) after
  deleting the previous images, all four compiled-auth modes, and
  release-artifact byte-identical rebuilds.
- **Throwaway PostgreSQL provisioning is deterministic and cleans up on all six
  paths I tested** (success, readiness failure, uncaught exception, test
  failure, SIGTERM, migrate failure). No leaked containers or ports remained
  after the entire review.
- **Every test count the implementer reported reproduces exactly**: 166 unit,
  138 e2e, 348 all-with-DB, 34 mobile, 57/57 container.
- **Lint is 55 errors / 69 warnings — baseline-equivalent, and still red.**
- **The developer `ecc` database is byte-for-byte unchanged** (37 tables, 14
  users, identical fingerprint and size), matching the implementer's own
  pre-flight record.

**What failed:**

- **F-1 (Low, documentation).** `docs/BACKUP_RESTORE.md` has **no §5**; the
  document jumps from §4 to §6, and two places (§9's RTO row and §0's D-1 row)
  reference the missing section. An operator computing RTO is pointed at a
  section that does not exist.
- **F-2 (Medium, CI).** **None of Phase 28's three new gates is wired into
  `ci.yml`,** and none is in `verify-ci-parity.mjs`'s `REQUIRED_GATES` list —
  the mechanism that exists precisely to catch this. The N-12 regression suite,
  the storage verifier and the DB-suite driver run only when a human remembers.
- **F-3 (Low, inherited).** The mobile client still deletes the session on a
  genuine **403**, so a real authorization refusal logs the user out. Pre-existing
  and unchanged by Phase 28; a product decision, not a security defect.
- **F-6 (Informational).** The container mutation harness cannot run on this
  hardware (20 GB required, 7.8 GB free) and is excluded from CI by design, so
  its four new mutants are unproven at the container level.

**What remains unverified:** container-level M8–M11 mutant failure; any
GitHub Actions run against this tree; the current upstream advisory set; backup
and restore at production volume; storage symlink round-tripping; mobile
behaviour on a real device; anything at all about staging, TLS,
observability, load, penetration testing or compliance — none of which has any
evidence in this repository.

**Did I discover new findings?** Yes — F-1 through F-6 in §17, of which F-2
(Phase 28's gates not in CI) is the only one I would put in front of a
maintainer as actionable this week. F-1 is a documentation defect; F-3 is an
inherited design tension; F-4, F-5 and F-6 are limitations and observations
rather than defects. I did **not** find a new security vulnerability, and I
found no evidence that any existing claim was false.

**Do the evidence support closing any previous blocker?** **No — not by
itself, and I am not closing them.** Phases 22 and 23 have never been
independently reviewed and their review files do not exist. Phases 25 and 26
were reviewed by their own implementers; this review is the first independent
re-verification of F-1…F-5 and of the ValidationPipe assertion, and both held —
but whether that satisfies the blocker is a maintainer's decision to record,
not a reviewer's to assume.

**I do not assign a score, a percentage, a ranking, or a "production ready"
verdict, and I found no evidence that would justify one.**

---

**Repository state on completion:** identical to the state at the start of this
review. `HEAD` = `origin/main` = `f51614dae70187272a22d67786ffb3b5bfd4ef58`.
Ten tracked modifications (Phase 28's) and twelve untracked entries, unchanged.
No commit, no push, no history alteration, no implementation change, no existing
report or `SECURITY_REVIEW_*` file touched. The developer database is unchanged.
All throwaway containers I created have been destroyed.
