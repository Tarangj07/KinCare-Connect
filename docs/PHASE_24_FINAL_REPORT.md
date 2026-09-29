# Phase 24 — Final Report

**Status:** complete. Nothing committed, nothing pushed, no git history touched.
**Base commit:** `d0cd0dd` ("Complete Phase 17 testing CI and reliability")
**Predecessor:** `docs/PHASE_23_PRODUCTION_SECURITY_RELEASE_ASSURANCE.md` (the authoritative record of
the nine deferred findings; no `PHASE_23_FINAL_REPORT.md` or `SECURITY_REVIEW_PHASE_23.md` exists in
the repository)
**Full detail:** `docs/PHASE_24_DEFERRED_FINDINGS_CLOSURE.md`

---

## A. Phase 24 scope

Re-evaluate each of Phase 23's nine deferred findings (D-1 … D-9) against the current codebase and
give each an evidence-backed final disposition. Not "fix everything": the answer was allowed to be
defer, obsolete, or "not a security defect". Two were fixed. No dependency was upgraded, no Prisma
schema or migration was touched, no authentication architecture was redesigned, no control was
weakened, and the rate limiter and its production arming are unchanged.

## B. Files created

| File | Purpose |
|---|---|
| `docs/PHASE_24_DEFERRED_FINDINGS_CLOSURE.md` | The investigation, per finding, with the evidence and the reasoning |
| `docs/PHASE_24_FINAL_REPORT.md` | This document |
| `apps/api/src/modules/feed/dto/update-update.dto.ts` | DTO for `PATCH /feed/:updateId` (D-4) |
| `apps/api/src/modules/notifications/dto/update-preference.dto.ts` | DTO for `PATCH /notification-preferences` (D-4) |
| `apps/api/scripts/mutate-token-lifetime.mjs` | Mutation harness proving the D-2 lifetime bound is load-bearing |

## C. Files modified

**Production code (6):** `apps/api/src/config/security-config.ts` (single TTL constant),
`apps/api/src/auth/guards/auth.guard.ts` (`maxAge` on verify), `apps/api/src/app.module.ts`,
`apps/api/src/auth/auth.service.ts` (issuance reads the constant), `apps/api/src/modules/feed/feed.controller.ts`,
`apps/api/src/modules/notifications/preference.controller.ts`.

**Tests (4):** `apps/api/src/auth/guards/auth.guard.spec.ts`,
`apps/api/test/auth-session.lifecycle.e2e-spec.ts`,
`apps/api/test/authorization-matrix.security.e2e-spec.ts`,
`apps/api/test/validation-boundary.security.e2e-spec.ts`.

**Gates, harnesses, CI (9):** `apps/api/scripts/verify-route-authorization.mjs`,
`apps/api/scripts/mutate-route-authorization.mjs`, `apps/api/scripts/verify-compiled-auth.mjs`,
`apps/api/scripts/verify-compiled-auth-suite.mjs`, `scripts/triage-vulnerabilities.mjs`,
`scripts/verify-docker-images.mjs`, `scripts/mutate-container-gate.mjs`, `scripts/verify-ci-parity.mjs`,
`.github/workflows/ci.yml`, `apps/api/package.json`.

## D–L. Dispositions

| Finding | Disposition | One-line reason |
|---|---|---|
| **D-1** deactivated-token window | **DEFER** | Present and accepted: closing it means a per-request DB lookup or revocation list — an architecture change. The window (≤15 min) is now pinned by a test and enforced at verification instead of assumed. |
| **D-2** unbounded token lifetime | **FIXED** | Issuance was already bounded; *verification* trusted `exp` alone. `maxAge` on `verifyAsync` makes effective validity `min(exp, iat + 15m)`, from one shared constant. |
| **D-3** unmounted `CareTaskController` | **DEFER** | Compiled, guarded, unregistered, 5 Phase 7 placeholders. Mounting adds live surface; deleting is a product decision. Now pinned by a 404 test made with an otherwise fully authorised request. |
| **D-4** DTO-less routes | **FIXED** | One route was worse than the two Phase 23 named: `PATCH /feed/:id` was `Partial<DTO>` → compiled metatype `Object` → *no validation at all*, and both Phase 23 gates passed on it. Second instance: `PATCH /notification-preferences`. |
| **D-5** multer DoS | **DEFER** | It *is* a production transitive in the image, but no interceptor exists; multipart is refused. Fixing needs a resolution override for a framework transitive with no reachable exposure. |
| **D-6** next critical RCE | **DEFER (no upgrade)** | 10 critical/high advisories, none reachable: no Server Functions (empty `server-reference-manifest.json`), no image optimizer, middleware, rewrites, WebSocket, custom server, i18n or CSP nonces; not Windows. Next 14→15 is product work. |
| **D-7** devDependency advisories | **DEFER (no upgrades)** | Build-time only, but the classifier that said so was partly wrong; two defects in it were fixed. Lockfile byte-identical. |
| **D-8** frozen-lockfile not hook-enforced | **DEFER** | Drift was *proved* to fail CI, the Docker install layer and the dependency audit. Only a developer's local install is unenforced, and both remedies are out of scope. |
| **D-9** container-mutant disk cost | **DEFER (bounded improvement)** | The obvious fix (prune) was implemented, measured to break the run, and removed. Free-space reporting, a low-space warning and an opt-in flag ship instead. |

**Totals: 2 fixed, 0 obsolete, 7 deferred, 0 dependency upgrades, 0 Prisma changes, 0 auth
architecture changes, 0 weakened controls.**

## M. Security changes made

1. **Access-token lifetime is bounded at verification** (`maxAge`), from one constant shared by
   issuance and verification. Effective validity is `min(exp, iat + 15m)` for any token; a token
   without `iat` is refused. HS256 pinning, mandatory `sub`, production fail-fast, refresh rotation,
   reuse detection, logout, lockout, inactive/deleted checks and cookie flags are untouched.
2. **Every mounted body-carrying route now binds a DTO the pipe will actually validate.** Two DTOs
   added; the strict `ValidationPipe` guarantee no longer silently excludes any live route.
3. **A new compiled-artifact rule** makes that second property a build failure, with two mutants.
4. **Dependency reachability is now derived per advisory and can no longer be waved through**: an
   advisory with no rule reports `REACHABLE (unclassified)` and fails the gate; production-path
   decoding and path aggregation were fixed so the evidence is true.
5. **Two CI workflow steps that could not test their own claims were fixed** (one would have failed
   on its first remote run; the other was green while asserting nothing about signatures).

No control was removed, relaxed, or made conditional. The rate limiter runs in production exactly as
before, and no test-only path was added to production code.

## N. Tests

| Lane | Result |
|---|---|
| API unit (no DB) | 145 passed / 44 skipped (189) — 139 pre-edit, **+6** from Phase 24 |
| API integration (real PostgreSQL) | **126 passed** (7 files) |
| API all, with DB | **315 passed** (26 files) |
| API no-DB / CI shape | 145 passed / 170 skipped |
| Mobile | **32 passed** |
| Web | **1 passed** |
| Root `pnpm test` (turbo) | 11/11 tasks successful |
| Root `pnpm typecheck` | 11/11 tasks successful; API 3 projects clean |

New tests: 5 guard cases (including a block that signs real tokens with the real `JwtService` and
asserts the boundary from both sides), 1 access-token-lifetime pin, 1 care-task-unmounted pin, 4 feed
PATCH validation cases (1 control + 3 negative, with a database assertion that a refused PATCH
mutated nothing), and 1 rewritten matrix case that now shows a smuggled `authorUserId` is refused
outright rather than accepted.

## O. Typecheck / build / lint

| Item | Result |
|---|---|
| Typecheck (API 3 projects, root turbo) | clean |
| Build (turbo 7/7) | clean |
| `build:verify` (determinism) | **PASS** — clean, warm and stale-tsbuildinfo builds each emitted the entry point; 272 files, 0 spec/test files in dist |
| API lint | **55 errors / 69 warnings — exactly the Phase 22/23 baseline** |
| `git diff --check` | clean |

An intermediate state measured 56 errors / 73 warnings. The extra error and the extra warnings were
**fixed, not waived**: a `no-unexpected-multiline` in the new D-3 test, and import ordering on the
lines Phase 24 added.

## P. Mutation testing

| Harness | Mutants | Result |
|---|---|---|
| `verify:metadata:mutate` | 2 | 2/2 |
| `verify:routes:mutate` | 5 (M1–M3 Phase 23, **M4–M5 new**) | **5/5** |
| `verify:lifetime:mutate` (**new**) | 2 | **2/2** |
| `mutate-config-contract` | 8 | 8/8 |
| `mutate-container-gate` | 7 (M1–M6 Phase 23, **M7 new**) | **7/7** across two runs, each failing on the check it targets |
| Triage-rule negative tests | 4 planted features | **4/4 turned the gate red** |

**Four defects in verification methods were found by this and fixed**, each recorded in the phase
document rather than quietly corrected:

1. The D-4 gate rule read route-parameter metadata from the wrong place (Nest 10 stores it on the
   class, keyed by method) — a false negative, caught by its own mutants.
2. The D-2 harness's first version passed a mutant that widened the token lifetime, because the
   tests compared the bound against the same constant the code used. Fixed with an explicit
   policy sentinel.
3. The new `next` triage rule consulted a stale build manifest before live source, so a planted
   `'use server'` did not trip it.
4. The postcss rule matched a `.d.ts` doc comment as a runtime reference, and depended on a web
   build having happened — which is false on a fresh CI checkout, where the advisory step runs in the
   `api` job before the `web` build.

## Q. Database verification

All database work used throwaway containers created for this phase (`ecc-p24-pg` on port 55440, and
a CI-shaped `ecc-p24-ci-pg` on 5432 with the workflow's own credentials). **The developer `ecc`
database was never contacted.** Both were destroyed at the end.

- `verify-db-migrations` (its own throwaway databases): **15/15 PASS** — pending-status on an empty
  database, `migrate deploy`, status after, a repeated deploy applying zero migrations, a second
  empty database migrating identically, no unannotated destructive statement, shadow-type enum
  idiom, application boot and an authenticated round trip against the fresh schema, and an
  assertion that every URL targeted its own container.
- API integration and no-DB lanes: green against the throwaway database.
- The three workflow steps CI-parity cannot run were executed by hand against the CI-shaped database:
  fail-closed contract, deployment smoke (liveness, readiness, SIGTERM drain), and the compiled
  authenticated round trip.

## R. Container verification

| Step | Result |
|---|---|
| Full build + runtime gate, images built from this tree | **57/57 PASS** (56 pre-existing + 1 new D-2 check), 0 FAIL |
| `--skip-build` re-run | 55 PASS, 0 FAIL |
| Container mutation harness, 7 mutants | 7/7 detected across two runs |
| Gate passes again on the restored repository | yes (55 checks) |

The new image-level check mints two tokens with the real secret against the running image — a fresh
one (must be accepted) and a one-hour-old one with a ten-year `exp` (must be refused) — and mutant
M7 proves it fails when `maxAge` is removed.

## S. Security regression verification

All Phase 16–23 controls re-verified green: authentication (HS256 pinning, mandatory `sub`,
production fail-fast, rotation, reuse detection, logout, lockout, inactive/deleted checks, cookie
flags, rate limiter armed in the image), authorization (57 live routes, all non-public routes
guarded, 34-case behavioural matrix including the D-1 gap assertion), input validation, error
boundaries, body limits, password policy (64 KB rejected in 5 ms in the image), storage modes
(0600/0700), non-root containers, artifact hygiene, dependency and configuration contracts, release
artifact reproducibility, and CI parity. Full results in the phase document §14 and §17.

## T. Known limitations

- **GitHub Actions has still never run.** Every command was executed locally — including the three
  steps no local gate could run — but the hosted runner, its service containers, its action versions
  and its timeouts are unverified. No remote result is claimed.
- **The regression counts quoted in the Phase 24 brief do not match this tree** (brief: 153/60/213/
  109+104; measured pre-edit: 139 passed + 44 skipped for the unit lane). Every number in this report
  is a measurement taken in this phase; the brief's figures are unverified against this codebase.
- **`pnpm audit` is a moving input.** 48 critical/high today, and not the same 48 as Phase 23 saw.
  Advisory numbers are snapshots, not invariants, and the triage must be re-run at release.
- **The D-6 deferral is structurally fragile**: "not reachable" rests on the app declaring no Server
  Actions, middleware, rewrites or image optimization. One import changes it — and the gate turns
  red on the same run.
- **Two container mutants (M3, M4) were inconclusive in the first run** and are only resolved by the
  second; the cause was my own concurrent/interrupted harness runs, not a gate defect, and this is
  recorded rather than presented as a clean single run.
- **No load, performance or penetration testing** was done, and nothing here replaces it.
- The postcss and Expo-toolchain reachability arguments are static arguments about code paths, not
  proof of absence. Both fail closed when the code changes.
- `ACCESS_TOKEN_TTL_SECONDS` is deliberately not configurable; changing the lifetime is a code
  change, and the bound is measured against the issuer's clock.

## U. Out-of-scope confirmation

Not started, not attempted, not partially built: deployment; Kubernetes, Terraform, Helm; cloud
services, credentials or managed databases; WebSockets/realtime; push, SMS, email providers; AI/LLM,
OCR; EHR integration; GPS; payments; Redis, MinIO/S3 migration; backup infrastructure; dashboard
redesign; mobile feature work; a Next.js major upgrade; any Prisma schema or migration change; any
change to `PROJECT_PLAN.md`, `PROJECT_PLAN-old.md` or any `SECURITY_REVIEW_*` artifact.

**No new Critical/High vulnerability was found in the product.** Three issues were found in
*verification* (a gate rule with a false negative, a dependency classifier that under-reported
production paths, and two CI steps that could not test their claims). All are documented with their
before/after evidence. No Prisma migration was required, no authentication architecture change was
required, and no major dependency upgrade was performed.

## V. Git status

HEAD is still `d0cd0dd`. Nothing was committed, pushed, amended, reset, rebased or stashed. The
Phase 18–23 working tree is intact alongside the Phase 24 changes: 63 changed/untracked entries at
the start of this phase, 73 now (+10: 2 documents, 2 DTOs, 1 harness, and 5 files I touched that were
previously untracked). No user work was discarded, and no file outside the Phase 24 scope was
modified. `git diff --check` is clean.

## W. Commit status

**No commit created. Nothing pushed. No git history modified.** As instructed.

## X. Phase 25 confirmation

**Phase 25 has not started.** No Phase 25 work is present. The natural candidates, in the order this
report would recommend them: (1) run GitHub Actions for the first time and treat the result as
evidence rather than expectation; (2) schedule the Next 15 upgrade as product work, since D-6's
"not reachable" is one import away from changing; (3) decide whether Phase 7 / care tasks are still
in scope, which is what D-3 is actually waiting on; (4) a load/performance test, which the ReDoS
finding suggests would have earned its keep. The final state is ready for an independent review of
Phase 24.
