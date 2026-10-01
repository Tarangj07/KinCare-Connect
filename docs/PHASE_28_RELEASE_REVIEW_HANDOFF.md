# Phase 28 — Release Review Handoff

**This document is NOT a security review.**

It is a briefing for a **genuinely independent** reviewer. It exists because
Phase 28 could not close two outstanding blockers itself, and a handoff is the
honest alternative to pretending otherwise.

---

## 0. Read this first: what is and is not independent

| Subject | Status |
| ------- | ------ |
| Independent review of **Phase 25** | **OPEN.** Not performed. |
| Independent review of **Phase 26** | **OPEN.** Not performed. |
| Independent review of Phases 22, 23 | **OPEN.** No review exists at all. |
| Independent review of Phases 13–14, 16–21, 24 | Genuinely independent (per `docs/RELEASE_READINESS.md` §5). |

`SECURITY_REVIEW_PHASE_25.md` and `SECURITY_REVIEW_PHASE_26.md` exist and
contain real technical work. **They were not produced by an independent
party.** For Phase 26 the reviewer wrote the code under review. For Phase 25
the reviewer had already reproduced and endorsed the findings before
reviewing them. Both documents carry a prominent disclosure to that effect.

**A review written by the implementer cannot close these blockers, however
careful it is.** Only a different person, organisation, or deliberately
separated session can do that. Phase 28 did not attempt to close them and
produced no substitute review.

If you are that reviewer: **nothing below tells you what conclusion to
reach.** Where Phase 28 believes a control is sound, it says so *and* tells
you how to attack it. Several of those attack recipes have already found
real defects in Phase 28's own verification code.

---

## 1. Repository state

| | |
|---|---|
| Repository | `Tarangj07/KinCare-Connect` |
| Branch | `main` |
| `HEAD` at time of writing | `f51614dae70187262a22d67786ffb3b5bfd4ef58` |
| `origin/main` at time of writing | `f51614dae70187262a22d67786ffb3b5bfd4ef58` (identical) |
| Working tree at time of writing | **dirty and uncommitted** — see §2 |

**Phase 28 made no commit and no push.** Changes exist only in the working
tree of the machine that produced this document. To review them you must
obtain that working tree; a plain `git clone` will give you `f51614d` and
**none of the Phase 28 work.**

---

## 2. Artifacts that are NOT in git

These files are **untracked**. A clean clone does not contain them. This is
stated plainly because a reviewer who silently reviews a tree without them
would not know what they are missing.

| File | SHA-256 |
| ---- | ------- |
| `SECURITY_REVIEW_PHASE_25.md` | `fa50aed7091aa98a58e076aed2c055342d7aa70b2c239514e998e4e4f1d304ec` |
| `SECURITY_REVIEW_PHASE_26.md` | `44b47f177307e1da7b369afef4b3fcaaad2307e7eab812f5f902e7223b12ddad` |
| `docs/PHASE_27_FINAL_REPORT.md` | `428414ed7aeb3d0b455eeb70c7958e946d873feb8cbcdb14442bd4646add055e` |
| `docs/RELEASE_READINESS.md` | `f622630458771382f39cb1dc65adbfcb6bcce579e5f852fb217ddb75550180af` |
| `docs/BACKUP_RESTORE.md` | `fdd6fdb1f17b0b3a9a2613e29ab9ef5dd241286cbea949c8e015e29b2398b556` |

`docs/BACKUP_RESTORE.md` was **modified during Phase 28** (§0 of that file
records four corrections), so the digest above is the corrected version.

---

## 3. Scope 1 — Phase 25 findings F-1…F-5

Full detail in `SECURITY_REVIEW_PHASE_25.md`. Summary of what to attack:

| ID | Claim | Phase 28's position | Where to attack it |
| -- | ----- | ------------------- | ------------------ |
| **F-1** | A future-dated `iat` defeats the access-token lifetime bound | Believed closed | `apps/api/src/config/security-config.ts` (`isAccessTokenIssuedInThePast`, `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS`), `apps/api/src/auth/guards/auth.guard.ts` |
| **F-2** | The DTO gate checked metatype presence, not that validation runs | Believed closed | `scripts/verify-config-contract.mjs` §ValidationPipe; mutate it |
| **F-3** | Keyed `@Body('field')` escapes DTO validation coverage | Believed closed for live routes; **3 Phase 4 public stubs still bind keyed body params** | `apps/api/src/auth/auth.controller.ts` (`forgot-password`, `reset-password`); `scripts/verify-route-authorization.mjs` |
| **F-4** | The Next.js `rewrites` triage rule was wrong | Believed closed, **lower confidence** | `scripts/verify-next-config-features.mjs`; **known residual N-2**: the detector reads `next.config.mjs` only, so a plugin or a sibling `next.config.js` injecting rewrites is invisible |
| **F-5** | The dependency classifier failed open on unknown advisories | Believed closed | `scripts/verify-dependency-audit.mjs`, `scripts/verify-dependency-triage.mjs` |

**Known trap (N-1):** `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` is not asserted
as an absolute anywhere. A *coordinated* change to the constant and its specs
stays green. If you test F-1, change the constant alone, or prove the bound
against a literal.

---

## 4. Scope 2 — Phase 26 workstreams

Full detail in `SECURITY_REVIEW_PHASE_26.md`.

| WS | Change | Files |
| -- | ------ | ----- |
| **WS1** | ValidationPipe strictness gate: asserts the pipe options are *literal* `true` in both `main.ts` and `create-test-app.ts` | `scripts/verify-config-contract.mjs` |
| **WS5** | Documentation alignment across phase reports | `docs/*` |
| **WS6** | Release-artifact gate determinism: self-provisioned throwaway PostgreSQL | `scripts/verify-release-artifact.mjs`, `scripts/lib/throwaway-postgres.mjs` |

**Phase 28 modified `scripts/verify-config-contract.mjs`** (see §7 WS1) — so
the WS1 gate is inside the Phase 28 diff and deserves fresh scrutiny.

**Known open (N-10):** `verify-release-artifact.mjs` and
`verify-db-migrations.sh` both delete and rebuild `apps/api/dist`. Run
concurrently, one can delete the artifact the other is executing. This is
**real and intermittent**, mitigated procedurally only. Phase 28 ran them
sequentially. Do not assume the warning is theoretical.

---

## 5. Scope 3 — Phase 27 re-attacks

`docs/PHASE_27_FINAL_REPORT.md`. Phase 27 re-attacked F-1…F-5 and found **no
Critical or High issues**, but recorded N-12 (closed in Phase 28, §6) and
confirmed that the Phase 25/26 independence blockers could not be closed by
the implementer.

---

## 6. Scope 4 — Phase 28 changes (this is the newest and least reviewed work)

### 6.1 N-12 — rate-limit HTTP semantics

**The defect.** `RateLimitGuard` threw `ForbiddenException`, so an exhausted
budget returned **403 Forbidden**. Clients could not distinguish throttling
from an authorization refusal; 429 is the retryable status. The global
exception filter already had a `case 429: return 'RATE_LIMITED'` branch that
no code path could reach.

**The change.**

| File | Change |
| ---- | ------ |
| `apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts` | **NEW.** `RateLimitExceededException extends HttpException`, status 429, carries `retryAfterSeconds`. |
| `apps/api/src/auth/guards/rate-limit.guard.ts` | Throws the new exception instead of `ForbiddenException`. Adds `retryAfterSecondsFor()`, derived from the real sliding window. |
| `apps/api/src/common/filters/global-exception.filter.ts` | Sets `Retry-After` **only** for `RateLimitExceededException`. |
| `apps/api/src/auth/guards/rate-limit.guard.spec.ts` | 8 assertions updated; 9 new cases for status, message, retry contract, and window decay. |
| `apps/api/test/rate-limit.http.e2e-spec.ts` | **NEW.** 12 cases over the real HTTP stack, no database. |
| `apps/mobile/src/services/api.ts` | Comment only — **no logic change**. 429 already fell outside the `401 \|\| 403` branch. |
| `apps/mobile/src/services/api.spec.ts` | 2 new cases. |
| `apps/api/scripts/verify-compiled-auth.mjs` | `isRateLimited` accepts 429 as well as 403. |
| `scripts/verify-docker-images.mjs` | Rate-limit check now requires 429 + `RATE_LIMITED` + valid `Retry-After`, and **fails loudly on 403**. **New check:** a real authorization refusal is still 403 `FORBIDDEN` with no `Retry-After`. |
| `scripts/mutate-container-gate.mjs` | M8, M9, M10, M11 added. |
| `scripts/mutate-rate-limit-n12.mjs` | **NEW.** 8 mutants. |

**Note for the reviewer — NestJS has no `TooManyRequestsException` in the
installed version (10.4.22).** The fix uses `HttpException` with
`HttpStatus.TOO_MANY_REQUESTS`. If you believe a framework-native class
should exist, that is a fair challenge; check the installed package rather
than the docs.

**Note on `Retry-After` correctness.** The window slides on `lastAttempt`,
which advances only on an *allowed* request. The value is
`lastAttempt + windowMs - now`, floored at 1 second. The floor is not
cosmetic: `canActivate` resets on `now - lastAttempt > windowMs` (strict), so
at exactly the boundary the request is *still refused* and `Retry-After: 0`
would be a lie. Challenge this if you disagree.

**What was NOT changed:** the budget (10), the window (15 min), the per-IP
key, the refusal condition, and the test-bypass scoping are all untouched.

### 6.2 WS2/WS2.5 — STORAGE_DIR backup and restore

- `scripts/verify-storage-backup-restore.mjs` — **NEW**, 22 checks.
- `docs/BACKUP_RESTORE.md` — corrected: §0 records four defects (D-1…D-4)
  that were found by executing the procedure rather than reading it.
- `scripts/run-db-suites.mjs` — **NEW** test driver for throwaway-PostgreSQL runs.

**Observation recorded, deliberately not fixed:** `resolveContainment`
prefix-checks the key lexically and does not call `realpath`, so a symlink
planted inside `STORAGE_DIR` is followed. **Not client-reachable** (a
`storageKey` is always `<documentId>/<random><ext>` from `generateSafeKey`,
read back from the database; `upload` never creates symlinks). Left unfixed
because `realpath`-based containment would break deployments where
`STORAGE_DIR` is itself a symlinked mount path. Judge that call.

### 6.3 The environment/tooling observation

On the host used in Phase 28 (GNU tar 1.35, gzip 1.14), `tar xz ARCHIVE`
and `tar cz ARCHIVE` — the short forms **omitting `-f`** — do not bind
`ARCHIVE` as the archive operand. Measured 8/8 reproducible; extraction
exits 2 with `gzip: stdin: unexpected end of file` and restores nothing,
while `tar xzf` and `tar -xzf` succeed. The runbook now uses explicit `-f`
throughout. This is an observation about one host's tooling, not a claim
about GNU tar generally — and it is a good example of the trap in §8.

---

## 7. Commands to run

**Sequentially. Not concurrently.** See N-10 in §4.

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r build
pnpm --filter @ecc/api run build:verify

# No-database
pnpm --filter @ecc/api run test                       # unit
cd apps/web && pnpm test; cd ../mobile && pnpm test

# With a throwaway PostgreSQL — never the developer `ecc` database
node scripts/run-db-suites.mjs                       # e2e + all-with-DB

# Security gates
node scripts/verify-config-contract.mjs
node scripts/verify-env-contract.mjs
node scripts/verify-dependency-audit.mjs
node scripts/verify-dependency-triage.mjs
node scripts/verify-next-config-features.mjs
node apps/api/scripts/verify-decorator-metadata.mjs
node apps/api/scripts/verify-route-authorization.mjs

# dist-mutating — RUN THESE ALONE, ONE AT A TIME
bash scripts/verify-db-migrations.sh
node scripts/verify-release-artifact.mjs

node scripts/verify-ci-parity.mjs

# Phase 28 additions
node scripts/verify-storage-backup-restore.mjs
node scripts/mutate-rate-limit-n12.mjs

# Container gate — needs the images built
node scripts/verify-docker-images.mjs
node scripts/mutate-container-gate.mjs --only M8,M9,M10,M11
```

`verify-compiled-auth-suite.mjs` requires a `DATABASE_URL` and a `STORAGE_DIR`
(mode `0700`). Point it at a throwaway database; it writes users.

---

## 8. Known traps — verifier defects already found in this project

**Read this section before believing any green result.** Every item below is
a case where a verification method was itself wrong while reporting success.
Phase 28 added three more.

| # | Defect | Consequence |
|---|--------|-------------|
| 1 | A gate read the **real** file instead of the mutant | Green forever, proving nothing |
| 2 | Container provisioning happened **outside** the cleanup `try/finally` | Leaked containers |
| 3 | A test **silently stripped `iat`** before checking the token predicate | The F-1 check could not fail |
| 4 | An assertion read the **wrong response field** | Vacuous pass |
| 5 | The DTO gate assumed a field it never verified | Vacuous pass |
| 6 | Shutdown tests were structurally invalid | Never exercised shutdown |
| 7 | The release-artifact gate required an **externally running** database | Failed for the wrong reason |
| 8 | **Concurrent** gates corrupted `apps/api/dist` | Intermittent, undocumented failure |
| 9 | A workflow **ordering** defect was invisible on a warm runner | Only appeared on a clean runner |
| 10 | **Phase 28:** `verify-storage-backup-restore.mjs` compared only entries *below* the root, never the root's own mode | A restore left at `0755` produced a manifest identical to the source and the mode check reported **ok** — a false green on the one permission the application enforces at startup |
| 11 | **Phase 28:** the same harness ran `rmSync` in its `finally` on a tree whose modes a fault had changed, and the cleanup **failed with `EACCES`**, leaving the fixture directory on disk | Cleanup that can itself fail is not cleanup |
| 12 | **Phase 28:** the harness buffered all results and printed them at the end | One uncaught throw destroyed every result already gathered; a real failure surfaced as a bare stack trace |
| 13 | **Phase 28:** its own leak detector matched the string `CANARY`, which appeared only in the canary's *filename* | A successful traversal escape was scored as a non-escape |

Items 10–13 were found by **fault injection**, not inspection. The method:
inject a realistic defect into the verifier's input, confirm it fails, restore,
confirm green. Consider doing the same to anything here you are asked to
trust.

**Also note the Phase 16→27 precedent:** a review of this material by an
agent that had previously worked on it was rejected as assurance. Do not
repeat that.

---

## 9. What remains unproven, regardless of this handoff

Independent review cannot manufacture evidence for any of these. They are
absent, not pending analysis:

- Any deployment to any environment. Nothing has ever been deployed.
- Staging. **No staging environment exists** — no GitHub environments, no
  staging secrets, no staging host.
- Independent review of Phases 22, 23, 25, 26.
- TLS termination, encryption at rest, backup encryption, retention,
  backup scheduling/automation.
- Production-volume backup and restore, and production load/capacity.
- Observability, metrics, alerting, log aggregation, disk monitoring.
- Penetration testing, soak testing, compliance certification.
- `STORAGE_DIR` backup/restore against any real storage backend — only a local
  filesystem was exercised.
- GitHub Actions on a hosted runner **after** these Phase 28 changes.

---

## 10. Integrity statement

At the time of writing: no commit was made, no push was made, no rebase, no
reset, no amend, no stash. `HEAD` and `origin/main` are both
`f51614dae70187262a22d67786ffb3b5bfd4ef58`. `pnpm-lock.yaml`, the Prisma
schema and the Prisma migrations are unchanged. The developer `ecc` database
was not targeted by any Phase 28 operation. No historical phase report and no
existing `SECURITY_REVIEW_*` file was modified.

`docs/PHASE_28_FINAL_REPORT.md` in the same working tree records this in
detail, including the exact file list and the full test and gate results.
