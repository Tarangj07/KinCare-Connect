# Phase 28 — Final Report

**Finding closure and release assurance.**

| | |
|---|---|
| Repository | `Tarangj07/KinCare-Connect` |
| Branch | `main` |
| `HEAD` | `f51614dae70187262a22d67786ffb3b5bfd4ef58` |
| `origin/main` | `f51614dae70187262a22d67786ffb3b5bfd4ef58` |
| Working tree | **dirty and uncommitted — no commit, no push, no rebase, no reset, no amend, no stash** |

**This phase does not constitute an independent security review, production
deployment validation, penetration test, compliance certification, or
production-readiness certification.**

No security score or rating is assigned here, and none should be inferred.

---

## 1. Scope

| WS | Work | Outcome |
| -- | ---- | ------- |
| WS1 | N-12 — rate-limit HTTP semantics | **Fixed**, mutation-proven at source and in the image |
| WS2 | `STORAGE_DIR` backup/restore | **Executed** on throwaway data; the runbook it came from was defective and was corrected |
| WS3 | Independent-review boundary | **Preserved as OPEN.** Handoff written; no substitute review produced |
| WS4 | Release-blocker reconciliation | §10 below |
| WS5 | Clean container rebuild | `docker build --no-cache`; 57/57 container checks green |
| WS6 | Full sequential regression | Green — §7 |
| WS7 | Integrity verification | §9 — clean |

---

## 2. Pre-flight state (captured before any change)

| Item | Value |
| ---- | ----- |
| `HEAD` = `origin/main` | `f51614d` (no divergence) |
| Staged files | none |
| Tracked modifications | none (`git diff HEAD --stat` empty) |
| Untracked | 5 pre-existing files: `SECURITY_REVIEW_PHASE_25.md`, `SECURITY_REVIEW_PHASE_26.md`, `docs/BACKUP_RESTORE.md`, `docs/PHASE_27_FINAL_REPORT.md`, `docs/RELEASE_READINESS.md` |
| Developer `ecc` DB | 37 tables; user fingerprint `e93602ae8749a3a2579f6d87a5fdd895`; `_prisma_migrations` md5 `1175a242e45f8f42968dc9ac2d28b305` |
| `pnpm-lock.yaml` | `5af2c8991d97ce696fba011c12d9d3ce` |
| `apps/api/prisma/schema.prisma` | `4452c2a2cd00dc683930e164d6ec5a9c` |

Checksums for 33 protected files were captured to
`/tmp/opencode/phase28-preflight-checksums.txt` and re-verified at the end
(§9).

---

## 3. N-12 root cause

Traced to source during pre-flight, not taken from the Phase 27 report.

1. `apps/api/src/auth/decorators/rate-limit.decorator.ts` applies
   `UseGuards(RateLimitGuard)`. Purely additive — no interceptor, no
   `@Throttle`, no `ThrottlerModule` anywhere in the repository.
2. `apps/api/src/auth/guards/rate-limit.guard.ts:76` threw
   `new ForbiddenException('Rate limit exceeded. Try again later.')`. **This
   was the sole origin of the 403.** Nothing in Nest or Express converted it.
3. `apps/api/src/common/filters/global-exception.filter.ts:54-70` reads
   `exception.getStatus()` and faithfully propagated 403, mapping it via
   `codeForStatus(403)` → `'FORBIDDEN'`.
4. `global-exception.filter.ts:110-111` — `case 429: return 'RATE_LIMITED'`.
   **Unreachable.** Exhaustive search confirmed `429` appeared nowhere in
   application source except this branch.

The Phase 27 diagnosis was correct.

---

## 4. The fix

| File | Change |
| ---- | ------ |
| `apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts` | **NEW.** `RateLimitExceededException extends HttpException`, status 429, carries `retryAfterSeconds` |
| `apps/api/src/auth/guards/rate-limit.guard.ts` | Throws the new exception; adds `retryAfterSecondsFor()` |
| `apps/api/src/common/filters/global-exception.filter.ts` | Sets `Retry-After` **only** for `RateLimitExceededException` |
| `apps/mobile/src/services/api.ts` | **Comment only — no logic change** |

**NestJS 10.4.22 has no `TooManyRequestsException`.** Verified by inspecting
the installed package: no such file, and it is absent from
`exceptions/index.js`. The fix therefore uses `HttpException` with
`HttpStatus.TOO_MANY_REQUESTS`, which is the correct framework abstraction
for the installed version.

**Unchanged, deliberately:** budget (10), window (15 min), per-IP key, the
refusal condition, the store, and the `NODE_ENV=test` + 
`ECC_TEST_DISABLE_RATE_LIMIT=1` bypass scoping. No control was weakened,
raised, or bypassed.

### 4.1 HTTP behaviour, before and after

Measured against the running container image (not inferred):

| Condition | Before | After |
| --------- | ------ | ----- |
| An exhausted rate-limit budget | `403 Forbidden`, `error.code = "FORBIDDEN"` | `429 Too Many Requests`, `error.code = "RATE_LIMITED"` |
| `Retry-After` on a throttle | absent | present, positive integer, ≤ 900 |
| Genuine authorization refusal | `403 FORBIDDEN` | `403 FORBIDDEN` — **unchanged** |
| Authentication failure | `401 UNAUTHENTICATED` | `401 UNAUTHENTICATED` — **unchanged** |
| Requests below the budget | served | served — **unchanged** |
| Limiter body | `Rate limit exceeded. Try again later.` | **identical**, verbatim |

### 4.2 `Retry-After` correctness

`THREAT_MODEL.md:250` already specified "structured 429 with `Retry-After`"
as the intended mitigation, and `SECURITY_REVIEW_PHASE_16.md:201` had
flagged the missing 429 as a defect that was never fixed. So the header was a
documented requirement, not a new invention.

The value is **derived from the limiter's real state, not asserted**. The
window slides on `lastAttempt`, which advances only on an *allowed* request
(the refusal path throws before that update), so the honest remainder is
`lastAttempt + windowMs - now`.

Two details are load-bearing and are asserted by tests:

- **The floor of 1 second is not cosmetic.** `canActivate` resets on
  `now - lastAttempt > windowMs` — strictly greater. At exactly
  `lastAttempt + windowMs` the request is *still refused*, so
  `Retry-After: 0` would be a lie that costs the caller another failure.
- **Rounding is up**, to the next whole second, because `Retry-After` is
  defined in seconds and rounding down would again invite a refused attempt.

Proven non-constant: at `t₀` the value is 900; at `t₀ + 14 min` it is 60.
A hardcoded value would pass a "is it positive" check while telling every
throttled caller to wait the full 15 minutes.

No fake duration was invented, and no architectural change to the limiter was
required.

### 4.3 A second-order defect this fixed

`apps/mobile/src/services/api.ts` cleared the stored access token on `401`
**or `403`**. Because the API answered a throttle with 403, **being rate
limited logged the user out** — a condition that resolves on its own
destroyed the session instead. With 429 the code is already correct, so the
only change was a comment. The behaviour is now pinned by two new tests
rather than left to coincidence.

---

## 5. Tests added

**`apps/api/src/auth/guards/rate-limit.guard.spec.ts`** — 8 assertions
updated, **9 new cases**: status is 429 not 403; no `ForbiddenException`
instance; message preserved verbatim; message names no IP/identifier/internal
state; budget is still exactly 10; `Retry-After` is a positive integer inside
the window; it *shrinks* as the window elapses; it is never 0 at the boundary;
the window still expires.

**`apps/api/test/rate-limit.http.e2e-spec.ts`** — **NEW, 12 cases**, real
HTTP through the real guards and the real global filter, with **no database**
(the `PrismaService` is stubbed to *throw* if anything reaches the data layer,
so "this proves nothing about the database" is enforced by the harness, not
asserted in a comment).

The spec does not merely read a status number. It proves the 429 came from
the limiter by asserting `error.code === 'RATE_LIMITED'`, a value produced
**only** by the filter's `case 429` branch, and it asserts the response
envelope is exactly `{code, message, requestId}` with no stack trace, no
Prisma text, no secret, and no echoed client IP.

**Negative controls in the same suite** — an unrelated 403 role refusal is
**not** reported as rate limiting and carries no `Retry-After`; a missing
token is 401; an invalid token is 401; an ordinary `ForbiddenException`
still maps to 403 through the real filter.

**`apps/mobile/src/services/api.spec.ts`** — 2 new cases: a 429 does not
delete a valid access token, and a 429 error message leaks no server prose.

---

## 6. Mutation results

### 6.1 `scripts/mutate-rate-limit-n12.mjs` (NEW) — 8/8 correct

Control green first, so a failing mutant is attributable to the mutation.

| Mutant | Expected | Result |
| ------ | -------- | ------ |
| M-N12-1 429 → 403 | fail | **detected** (unit + e2e) |
| M-N12-2 refusal bypassed (`return true`) | fail | **detected** (unit + e2e) |
| M-N12-3 `Retry-After` header dropped | fail | **detected** (e2e) |
| M-N12-4 `Retry-After` fabricated constant | fail | **detected** (unit) |
| M-N12-5 `RATE_LIMITED` removed from the status map | fail | **detected** (e2e) |
| M-N12-6 authorization refusals widened to 429 | fail | **detected** (e2e negative control fired) |
| M-N12-7 mobile treats 429 as an auth failure | fail | **detected** (mobile) |
| M-N12-8 unrelated authorization refusal reworded | **pass** | **correctly NOT detected** |

M-N12-8 is a true blind-spot control: it proves the suites are not simply
coupled to the whole authorization surface, which is what would make M-N12-6's
detection accidental rather than meaningful.

The harness **hard-errors if a mutant's anchor text is not present exactly
once**. This fired during development: M-N12-8's anchor was wrong, the mutant
was a no-op, and the harness refused to report a result rather than printing a
meaningless "pass".

Every mutated file is asserted byte-identical after restore, and a
pre-harness snapshot is compared independently at the end, so a leaked mutant
cannot hide behind its own `finally`.

### 6.2 `scripts/mutate-container-gate.mjs` — 4 new mutants, all detected

| Mutant | Result |
| ------ | ------ |
| M8 the refusal reverts to 403 | **detected** |
| M9 the refusal is bypassed entirely | **detected** |
| M10 `Retry-After` dropped from a 429 | **detected** |
| M11 authorization refusals widened to 429 | **detected** |

Each rebuilds the API image with `--no-cache`; the gate must fail, and the
gate was confirmed green again on the restored repository.

### 6.3 Pre-existing harnesses re-run

`mutate-config-contract` (15 mutants), `mutate-decorator-metadata`,
`mutate-route-authorization`, `mutate-next-config-rewrites`,
`mutate-token-lifetime` — **all PASS**.

### 6.4 A gate I modified was itself mutation-tested

`scripts/verify-config-contract.mjs` failed on my new harness (it reads `PATH`
and `HOME` when spawning suites with a minimal environment). I classified
those two as non-configuration alongside the existing `TERM` entry, with a
stated reason — a classification, not a relaxation — and then proved the gate
still works:

- removing `PATH` from the list → gate fails again ✔
- introducing a genuinely undocumented application variable
  (`P28_UNDOCUMENTED_APP_VAR` read by `body-limit.ts`) → gate fails ✔
- restored → gate passes ✔

A first attempt at this was a **bad mutant** (allow-listing `STORAGE_DIR`,
which is already documented, changed nothing) and is recorded as such.

---

## 7. Full sequential regression

Run **strictly sequentially**. `verify-db-migrations.sh` and
`verify-release-artifact.mjs` were run **one at a time**, never concurrently,
per N-10.

| Check | Result |
| ----- | ------ |
| `pnpm -r typecheck` | PASS (5 workspaces) |
| `pnpm -r build` | PASS |
| `build:verify` | PASS — 280 dist files, warm build reproducible |
| API unit (no DB) | **166 passed / 44 skipped** (was 157/44; +9 new) |
| API integration (throwaway PG) | **138 passed** (was 126; +12 new) |
| API all-with-DB | **348 passed**, 27 files |
| Web | 1 passed |
| Mobile | **34 passed** (was 32; +2 new) |
| `verify-config-contract` | PASS |
| `verify-env-contract` | PASS |
| `verify-dependency-audit` | PASS |
| `verify-dependency-triage` | PASS |
| `verify-next-config-features` | PASS |
| `verify-decorator-metadata` | PASS |
| `verify-route-authorization` | PASS |
| `verify-compiled-auth-suite` (4 modes) | PASS |
| `verify-db-migrations.sh` | PASS (run alone) |
| `verify-release-artifact.mjs` | PASS, 280 files byte-identical across two clean builds (run alone) |
| `verify-ci-parity.mjs` | PASS |
| `verify-docker-images.mjs` | **PASS — 57/57** (clean `--no-cache` image) |
| `mutate-container-gate` M8–M11 | PASS |
| `mutate-rate-limit-n12` | PASS — 8/8 |
| `verify-storage-backup-restore.mjs` | PASS — 22/22 |
| **Lint (`apps/api`)** | **124 problems — 55 errors / 69 warnings, exactly the documented baseline. Net lint debt added: zero.** |
| Lint (`apps/web`) | clean |
| Lint (`apps/mobile`) | 18 warnings (pre-existing, advisory) |

Two new import-sorting warnings appeared from my edits, were fixed with
`eslint --fix`, and the baseline was re-confirmed.

**The `dist`-mutating gates were never run concurrently**, and the CI-parity
gate independently confirms the two remain un-concurrent in the workflow.

---

## 8. Container re-proof (WS5)

`docker build --no-cache -f apps/api/Dockerfile -t ecc-api:p20-verify .`
from the repository root — a genuine clean build, not a cached layer reuse.

**57/57 checks pass**, including, unchanged from before: non-root uid 1000,
immutable `/app` (every write denied to the runtime user), `STORAGE_DIR`
writable only where intended, 0700/0600 enforcement, fail-closed production
start (missing `STORAGE_DIR`, placeholder JWT secret, non-postgres
`DATABASE_URL`, group/other-readable `STORAGE_DIR` — all exit 1), Argon2id
hashing, Prisma migrations, liveness/readiness, graceful SIGTERM drain for
both containers, and no secrets in the image.

New, from WS1: the rate-limit check now requires **429 + `RATE_LIMITED` + a
valid `Retry-After`**, and **fails loudly if the image answers 403**. A
separate new check proves a **real authorization refusal is still 403
`FORBIDDEN` with no `Retry-After`**, using the gate's own valid token against
a senior-scoped route with a random senior id — a genuine
`assertCanAccessSenior` refusal, on a route that is not `@RateLimit()`, so the
two conditions are cleanly separable.

---

## 9. `STORAGE_DIR` backup/restore (WS2)

### 9.1 The documented procedure was defective

Phase 27 wrote the storage procedure but never executed it. Executing it
first exposed four defects, all corrected in `docs/BACKUP_RESTORE.md` §0:

| # | Defect | Consequence |
| - | ------ | ----------- |
| **D-1** | §4/§5 used `docker compose stop api web` / `exec api` / `start api web`. **`docker-compose.yml` defines only `postgres`, `redis`, `minio`, `minio-bootstrap`.** `docker compose stop api web` fails: `no such service: api`. | The "stop the writers" step could not be executed as written |
| **D-2** | The storage archive mounted **`ecc_postgres_data`** and tared `/var/lib/postgresql/data` into a file named `storage-<ts>.tar.gz` | Archived a **raw PGDATA directory** and mislabelled it as the document backup |
| **D-3** | The same command ended in `\|\| true` | **`tar` still creates the output file when it fails** — measured exit 2 *and* a 20-byte file. A failed backup looked exactly like a successful one |
| **D-4** | "`STORAGE_DIR` lives on the host (default `./uploads`)" | No such host path or volume is defined anywhere in the repository |

D-3 is the most dangerous class: a backup command that cannot fail visibly.
A silently-empty backup is worse than none, because it is believed in.

The procedure is now **orchestration- and storage-backend agnostic**, states
the requirement ("no writer is running") rather than naming services this
repository does not define, and §4.1 states plainly that **this repository
does not provide the storage backend** — that is a deployment responsibility.
`docker-compose.yml` was **not** modified.

### 9.2 An environment finding, from executing rather than reading

My own first draft of the restore step used `tar xzp`. It **failed**:

```
gzip: stdin: unexpected end of file
tar: Child returned status 1        (exit 2, nothing extracted)
```

Investigation, 8/8 reproducible: on this host (GNU tar 1.35, gzip 1.14), the
short forms that **omit `-f`** do not bind the archive operand at all.

| Command | Result |
| ------- | ------ |
| `tar xz ARCHIVE -C DIR` | exit 2, nothing extracted |
| `tar xzpf ARCHIVE -C DIR` | exit 0, extracted |
| `tar xzf ARCHIVE -C DIR` | exit 0, extracted |
| `tar -xz -f ARCHIVE -C DIR` | exit 0, extracted |

The runbook now uses explicit `-f` throughout, with the measurement recorded
in §4.3. This is an observation about one host's tooling, not a claim about
GNU tar generally. I then ran the corrected §4.3 → §5 procedure **verbatim,
end to end**: backup, destroy, restore, and the §7.3 fingerprint matched
exactly.

### 9.3 Storage restore evidence

`scripts/verify-storage-backup-restore.mjs` — 22/22, on a `mkdtemp` tree
removed in a `finally`, no real documents, no PHI, developer `ecc` untouched.

| Property | Result |
| -------- | ------ |
| Fixture | 8 files / 12 directories: normal documents, deep nesting, **spaces in the filename**, **shell-significant characters** (`$'&`), a zero-byte file, a 512 KB binary blob, an empty directory, realistic `<documentId>/<random><ext>` keys |
| Source modes | 0700 dirs, 0600 files, no group/other bits |
| Archive contains only `STORAGE_DIR` | 21 entries; **no** `postgres` / `PG_VERSION` / `ecc_postgres_data`; the out-of-tree canary was not captured |
| D-2 fixed | proven by the archive listing |
| D-3 fixed | a failing `tar` is detectable from its exit status; the 20-byte file it still leaves is documented as *not* evidence of success |
| Tree genuinely destroyed | confirmed absent before restore |
| **Restore byte-identical** | **21 entries compared, 0 differences** in SHA-256, size, mode and relative path |
| Empty subdirectory / zero-byte file | both survived |
| `STORAGE_DIR` root mode after restore | **0700** |
| **Application usability** | the **real compiled `StorageService` from `dist`** starts on the restored tree in `NODE_ENV=production` and retrieves a document whose digest matches the pre-backup value |
| Traversal containment on the restored tree | `../`, `doc/../../canary`, absolute path, trailing `..` — **all refused**; the canary was never read |
| A post-restore write | lands inside `STORAGE_DIR` at mode 0600 |
| Nothing escaped | the canary was never archived and never read through the service |

### 9.4 The verifier was itself defective — three real bugs, found by fault injection

Per the methodology rule, I injected realistic faults rather than trusting a
green result. The harness had genuine defects:

1. **False green on the most important permission.** The manifest compared
   only entries *below* the root and never the root's own mode. A restore
   left at `0755` produced a manifest **identical to the source**, and the
   mode check reported **ok** — a false green on exactly the permission the
   application enforces at startup. Now recorded and asserted explicitly.
2. **Cleanup could itself fail.** The `finally` ran `rmSync` on a tree whose
   modes a fault had changed, and it **failed with `EACCES`, leaving the
   fixture directory on disk**. Cleanup now repairs ownership first and
   reports whether removal actually succeeded.
3. **A leak detector that could not detect a leak.** The containment check
   matched the string `CANARY`, which appeared only in the canary's
   *filename* — so a successful traversal escape was scored as a non-escape.
   Now matches content.

After the fixes, the mode fault is caught in **three independent places** and
the harness exits non-zero. An earlier draft also buffered all output and
printed at the end, so one uncaught throw destroyed every prior result; output
is now incremental.

### 9.5 Observation: containment is lexical, not `realpath` — measured, not fixed

`resolveContainment` prefix-checks the key lexically and does **not** call
`realpath`. A symlink planted inside `STORAGE_DIR` and pointing outside it
**is followed**, and its target is read. Measured, not assumed.

**This is not client-reachable.** `storageKey` is always
`<documentId>/<random-hex><ext>` from `generateSafeKey`; `retrieve` is called
with the value read back from the database; `upload` uses `writeFileSync` and
never creates a symlink. Exploiting it requires an attacker who can already
write inside a `0700` directory owned by the application uid — who can then
read the files directly and gain nothing.

Recorded as a **defence-in-depth observation** and deliberately **not
changed**: `realpath`-based containment would break deployments where
`STORAGE_DIR` is itself a symlinked mount path, which is common and
legitimate. Widening this into a finding would misrepresent its severity;
hiding it would misrepresent the code.

---

## 10. Release-blocker matrix

| # | Blocker | Disposition | Evidence |
| - | ------- | ----------- | -------- |
| 1 | **N-12** rate limiting returns 403 not 429 | **CLOSED** | §4, §5, §6, §8; 8 source mutants + 4 container mutants |
| 2 | `STORAGE_DIR` backup/restore never executed | **CLOSED at small scale** | §9.3, 22/22 on throwaway data |
| 3 | `BACKUP_RESTORE.md` procedure defective | **CLOSED** | §9.1 D-1…D-4, §9.2 |
| 4 | **Independent review of Phase 25** | **OPEN — BLOCKED BY EXTERNAL INFRASTRUCTURE** | Requires a separate reviewer. Not closable by this implementer |
| 5 | **Independent review of Phase 26** | **OPEN — BLOCKED BY EXTERNAL INFRASTRUCTURE** | As above |
| 6 | Independent review of Phases 22, 23 | **OPEN — BLOCKED BY EXTERNAL INFRASTRUCTURE** | No review exists at all |
| 7 | No staging environment | **OPEN — BLOCKED BY EXTERNAL INFRASTRUCTURE** | 0 GitHub environments, 0 staging secrets, no staging host |
| 8 | No production deployment | **OPEN — BLOCKED BY EXTERNAL INFRASTRUCTURE** | Nothing has ever been deployed |
| 9 | TLS termination | **OPEN — BLOCKED BY EXTERNAL INFRASTRUCTURE** | No certificate, no proxy config, no `sslmode` |
| 10 | Observability / metrics / alerting | **OPEN — UNPROVEN** | None implemented |
| 11 | Load / concurrency / capacity | **OPEN — UNPROVEN** | Bounded smoke test only; not capacity testing |
| 12 | Penetration testing | **OPEN — NOT ATTEMPTED** | Never performed |
| 13 | Compliance certification | **OPEN — NOT ATTEMPTED** | None; see `COMPLIANCE.md` |
| 14 | Lint baseline | **UNCHANGED** | 55 errors / 69 warnings, exactly as documented. Net debt added: zero |
| 15 | Dependency advisories | **UNCHANGED — PROVEN for the current graph** | `verify-dependency-audit` + `-triage` green; unknown advisories fail closed |
| 16 | Next.js `rewrites` deferred risk (N-2) | **OPEN — DEFERRED BY DESIGN** | Detector reads `next.config.mjs` only; a plugin is invisible |
| 17 | `dist` rebuild race (N-10) | **OPEN — DEFERRED BY DESIGN** | Mitigated procedurally only; both gates run sequentially here |
| 18 | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` not absolute (N-1) | **OPEN — DEFERRED BY DESIGN** | A coordinated change to the constant and its specs stays green |
| 19 | DTO constraint floor / keyed-body stubs (N-3, N-4, N-7) | **OPEN — DEFERRED BY DESIGN** | Documented limitations |
| 20 | Backup automation, encryption, retention | **OPEN — UNPROVEN** | Not implemented; §4 is a manual command |
| 21 | GitHub Actions after these changes | **OPEN — UNPROVEN** | Local and gate evidence only; no CI run on this tree |
| 22 | `symlink` containment observation | **RECORDED — NOT A FINDING** | §9.5; not client-reachable |

**Nothing in this phase converted "not tested" into "passed."**

---

## 11. Independent-review status

**Both blockers remain OPEN. No substitute review was created.
`SECURITY_REVIEW_PHASE_28.md` was deliberately not written.**

The reasoning is not procedural politeness. Phase 26 was implemented by the
agent performing this phase, and Phase 25 was previously endorsed by it. A
review written by the implementer is not independent review, and the
disclosure in those documents does not change what they are.

`docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` was written instead. It carries
`HEAD`/`origin/main`, the F-1…F-5 scope, the Phase 26 WS1/WS5/WS6 scope, the
Phase 27 re-attacks, the Phase 28 changes, reproduction commands, SHA-256
digests for the untracked artifacts, and — pointedly — a list of **thirteen
verifier defects already found in this project**, three of which Phase 28
found in its own code. It states what remains unproven and does not state a
conclusion for the reviewer to reach.

**A note a reviewer needs:** `SECURITY_REVIEW_PHASE_25.md`,
`SECURITY_REVIEW_PHASE_26.md`, `docs/PHASE_27_FINAL_REPORT.md`,
`docs/RELEASE_READINESS.md` and `docs/BACKUP_RESTORE.md` are **untracked**. A
clean clone contains none of them, and none of the Phase 28 work. Committing
was not authorized, so this is stated rather than papered over.

---

## 12. Git integrity

| Item | Value |
| ---- | ----- |
| `HEAD` | `f51614d` — **unchanged** |
| `origin/main` | `f51614d` — **unchanged** |
| Branch | `main` — unchanged |
| Staged files | **none** |
| Stash | **empty** |
| Reflog | last entry is the pre-existing `f51614d`; **no new commits** |
| Commit / push / rebase / reset / amend | **none** |

**Byte-identical to the pre-flight capture:**

`PROJECT_PLAN-old.md`; all 14 `SECURITY_REVIEW_PHASE_*.md` files (13, 13_FINAL,
13_FINAL_RECHECK, 14, 16, 17, 18, 19, 20, 21, 24, 25, 26); every historical
phase report (`PHASE_12` … `PHASE_27`, `RELEASE_CHECKPOINT_PHASE_26`,
`RELEASE_READINESS`, `DATABASE`, `MESSAGING`); `pnpm-lock.yaml`
(`5af2c899…`); `apps/api/prisma/schema.prisma` (`4452c2a2…`); all Prisma
migration files.

**The only intended change to a pre-existing file** is
`docs/BACKUP_RESTORE.md` — the WS2.5 runbook correction.

### Files modified (10)

`apps/api/package.json` · `apps/api/scripts/verify-compiled-auth.mjs` ·
`apps/api/src/auth/guards/rate-limit.guard.spec.ts` ·
`apps/api/src/auth/guards/rate-limit.guard.ts` ·
`apps/api/src/common/filters/global-exception.filter.ts` ·
`apps/mobile/src/services/api.spec.ts` · `apps/mobile/src/services/api.ts` ·
`scripts/mutate-container-gate.mjs` · `scripts/verify-config-contract.mjs` ·
`scripts/verify-docker-images.mjs` — **+451 / −20 lines**

### Files created (6)

`apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts` ·
`apps/api/test/rate-limit.http.e2e-spec.ts` ·
`scripts/mutate-rate-limit-n12.mjs` ·
`scripts/verify-storage-backup-restore.mjs` ·
`scripts/run-db-suites.mjs` ·
`docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` · `docs/PHASE_28_FINAL_REPORT.md`
(this file) · plus the modified `docs/BACKUP_RESTORE.md`.

No dependency version was changed. No Prisma file was changed. No product
feature was introduced. No security control was weakened.

---

## 13. Developer database integrity

The developer `ecc` database was **never targeted** by any Phase 28 operation.
Every DB-backed run used `scripts/lib/throwaway-postgres.mjs`, whose database
names are always prefixed (`ecc_p28_*`, `ecc_p28auth_*`) so a developer
database cannot be reached even by a bug.

| Measure | Pre-flight | Post-phase | Match |
| ------- | ---------- | ---------- | ----- |
| Tables in `public` | 37 | **37** | ✔ |
| User fingerprint | `e93602ae8749a3a2579f6d87a5fdd895` | **`e93602ae8749a3a2579f6d87a5fdd895`** | ✔ |
| `_prisma_migrations` md5 | `1175a242e45f8f42968dc9ac2d28b305` | **`1175a242e45f8f42968dc9ac2d28b305`** | ✔ |
| Databases present | `ecc, postgres, template0, template1` | **identical** | ✔ |

Throwaway infrastructure was cleaned up: no `p28*` containers, no
`p28*` databases, no gate containers or networks left running.

---

## 14. What remains UNPROVEN

Stated plainly, because most of this project is genuinely well verified and
therefore easy to over-read.

**Not proven, and not closable by this phase:**

- Independent review of Phases 22, 23, 25, 26.
- Any deployment to any environment. **The system has never been deployed.**
- Staging. No GitHub environments, no staging secrets, no staging host.
- TLS termination; encryption at rest; backup encryption; retention;
  rotation; backup scheduling or automation.
- Backup and restore at production volume, and production load/capacity.
- `STORAGE_DIR` backup/restore against **any real storage backend** — only a
  local filesystem was exercised. No volume, no network filesystem, no
  object-store mount, no platform snapshot API.
- Consistency of a database dump and a storage archive taken at different
  instants. §6 of the runbook recommends a read-only window; it is **not
  proven that a window is necessary**, nor that a mismatch is harmless.
- A real document round trip over HTTP (upload/download) against a restored
  tree. The storage service was exercised directly — a narrower claim.
- Symlink handling in a storage backup/restore round trip.
- Observability, metrics, alerting, log aggregation, disk monitoring.
- Penetration testing, soak testing, chaos testing, compliance certification.
- GitHub Actions on a hosted runner **after** the Phase 28 changes. The CI
  workflow has not been executed against this tree.
- The `dist` rebuild race (N-10) is mitigated procedurally only. It was
  avoided here, not fixed.
- The Next.js `rewrites` residual (N-2): a plugin injecting rewrites is
  invisible to the detector.

**Explicit statement of scope.** This phase does not constitute an independent
security review, production deployment validation, penetration test,
compliance certification, or production-readiness certification. N-12 is
closed and `STORAGE_DIR` backup/restore is now executed at small scale; that
is a real improvement to a real defect list. It is not, and is not presented
as, evidence that this system is ready to run, let alone ready to hold real
patients' data.

No security score is assigned, and none should be inferred from the volume of
green checks. A green suite is evidence about the properties it actually
asserts — and this project has now demonstrated, repeatedly and including in
this phase, that verifiers themselves can be wrong while reporting success.
