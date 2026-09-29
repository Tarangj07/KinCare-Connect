# SECURITY_REVIEW_PHASE_17.md — Independent Security + Reliability Review

**Subject:** Phase 17 (Testing, CI & Reliability) — uncommitted working tree at `c615e2b` ("Complete Phase 16 security remediation")
**Review date:** 2026-09-26
**Review mode:** READ-ONLY. No source file was created, modified, deleted, or formatted. The only file written by this review is this report.
**Reviewer stance:** Independent; every claim in the Phase 17 report was re-verified against the actual repository, code, and executed commands.

---

## 1. Review scope

- Git/scope integrity of the uncommitted Phase 17 change set.
- Full read of every modified and new source file (application code, test code, configs, CI).
- Security review of Phase 17 fixes vs. Phase 16 controls (regression hunt).
- Deep verification of: document `@Roles` fix, BigInt fix, messaging fixes, health DTO fix, rate-limit test bypass.
- Test-quality audit (placeholders, blanket assertions, real vs. mocked DB paths).
- Real-PostgreSQL integration execution (reviewer-provisioned isolated DB).
- Test lanes, typecheck, build, CI workflow inspection.
- Phase 18 contamination scan and documentation accuracy.

## 2. Repository state verified

```
HEAD: c615e2b85acbf55aeea8a6034dbac4e9bb5cb31d  "Complete Phase 16 security remediation"   ✔ matches checkpoint
git diff --check: clean
git stash list: empty
Tracked modifications: 22 files
Untracked additions: .github/ (ci.yml only), apps/api/src/testing/ (3 files),
  apps/api/test/ (5 files), rate-limit.guard.spec.ts, tsconfig.test.json,
  vitest.config.unit.ts, docs/PHASE_17_TESTING_CI_RELIABILITY.md
PROJECT_PLAN.md: modified (1022+/250-) — PRE-EXISTING user edit (rewritten plan listing
  "Phase 17 — Comprehensive Testing  Status: PLANNED"; touched 16:32, before Phase 17
  infra files). Phase 17 docs correctly declare it out of scope/untouched. NOT modified
  during this review (working-tree diff hash e2291a476dc9e92f6e62a98db3c2da02 identical
  before and after all review runs).
PROJECT_PLAN-old.md, SECURITY_REVIEW_PHASE_16.md: untracked, untouched (mtimes predate Phase 17 work).
```

**Artifact/secret hygiene:** `.env` and `apps/api/.env` are git-ignored (verified via `git check-ignore`); `.env.example` values are empty; no credentials, dumps, uploads, or generated artifacts in the diff. `apps/api/uploads/` added to `.gitignore` and the directory does not exist (tests use a temp `STORAGE_DIR`). `.github/` contains exactly one file (`workflows/ci.yml`). No Prisma schema/migration changes in the diff (0 matches).

**Scope conclusion:** change set matches the claimed scope exactly. No product features, no new endpoints, no schema changes, no dependency-version changes.

## 3. Commands executed (and results)

| Command / check | Result |
| --- | --- |
| `git log/status/diff --stat/diff --check/diff HEAD/name-only/stash list` | ✔ Section 2; diff inspected file-by-file |
| Review DB provisioning: `CREATE DATABASE ecc_review` inside existing postgres:16-alpine container (isolated from dev DB) + `prisma migrate deploy` | ✔ both migrations applied ("All migrations have been successfully applied") |
| `pnpm --filter @ecc/api test` (unit lane, DB present) | ✔ **12 files / 102 passed** |
| `pnpm --filter @ecc/api test:integration` (HTTP+DB lane) | ✔ **5 files / 55 passed**, 0 skipped |
| `pnpm --filter @ecc/api test:all` | ✔ **17 files / 157 passed, 0 failed, 0 skipped** (matches 116→157 claim) |
| `env -u DATABASE_URL pnpm --filter @ecc/api test:all` (no-DB shape) | ✔ 58 passed / 99 skipped / 0 failed — skips are loud, not silent |
| Bad-`DATABASE_URL` probe (`vitest run --config vitest.config.e2e.ts` pointing at a dead port) | ✔ **exit code 1 — suites fail closed when DB is down; cannot silently pass** |
| `pnpm --filter @ecc/api typecheck` (tsconfig + seed + tsconfig.test) | ✔ 0 errors |
| `pnpm --filter @ecc/mobile test` / `typecheck` | ✔ 32 passed / 0 tsc errors |
| `pnpm --filter @ecc/web test` / `typecheck` / `lint` | ✔ 1 passed / 0 tsc errors / 0 lint problems |
| Root `pnpm test` / `test:integration` / `test:all` (turbo) | ✔ 5/5 tasks green each (e.g. api:test:all 157/157) |
| API `eslint "src/**/*.ts" "test/**/*.ts"` | 55 errors / 128 warnings; **0 errors in every Phase 17-authored file** (measured per-file); document.service.ts's 4 errors are `Promise<any>` lines that exist verbatim at `c615e2b` (confirmed via `git show`) |
| `tsc -p tsconfig.build.json` from clean state + `nest build` | ✔ dist/main.js emitted; `dist/testing` absent; 0 spec files in dist — but see M-01 (warm-tsbuildinfo trap) |
| `.github/workflows/ci.yml` PyYAML parse | ✔ valid |
| Placeholder scan (`expect(true)`, `expect(false)`, tautologies, blanket status sets, mocked-DB scan in `test/`) | ✔ only comment references remain; `vi.mock`/`mockImplementation` count in `test/` = **0** |
| Phase 18 contamination grep (`WebSocket\|socket\|Gateway\|push\|openai\|llm\|realtime\|firestore…`) across diff + new files | ✔ 0 hits (single false positive: `createdUserIds.push()`) |
| Review-DB teardown (`DROP DATABASE ecc_review`) | ✔ dev DB untouched, container state restored |

**DB environment note:** The implementer's ephemeral container no longer exists; the review used the repo's running `ecc-postgres` (postgres:16-alpine) with a dedicated isolated database (`ecc_review`), never the dev `ecc` database. All claimed integration results were independently reproduced.

## 4. Files reviewed (full reads)

Application changes: `documents.controller.ts`, `document.service.ts` (incl. download/archive/grant/revoke/list paths), `messaging.service.ts` (assertConversationAccess, createMessage, getMessages, markRead), `create-message.dto.ts`, `measurement.dto.ts`, `measurement.service.ts`, `rate-limit.guard.ts` (+ consumer map), `auth.guard.ts`, `roles.guard.ts`, `authorization.service.ts` (membership predicate), `global-exception.filter.ts`, `security-config.ts`, `main.ts`, `storage.service.ts` (key generation), `app.module.ts`, `prisma/schema.prisma` (HealthDocument, cascade rules).

Tests/infra (all five e2e suites in full; both rewritten gate specs in full; `rate-limit.guard.spec.ts`; `care-fixture.ts`; `create-test-app.ts`; `setup-env.ts`; mobile `security.spec.ts`/`api.spec.ts` diffs + `useAuth.tsx`; three vitest configs; `tsconfig.test.json`; `tsconfig.build.json`; both `package.json` files; `turbo.json`; `.gitignore`; `ci.yml`; `docs/PHASE_17_TESTING_CI_RELIABILITY.md` line-by-line; checkpoint versions of the pre-Phase-17 specs via `git show`).

## 5. Security review — Phase 16 control regression assessment

**Verdict: no regressions. Several Phase 16 controls are now additionally proven at the real HTTP+DB boundary.**

| Control | Phase 17 impact | Evidence |
| --- | --- | --- |
| JWT identity binding (H5/A8) | Unchanged (`auth.guard.ts` untouched); bypass shape now regression-tested over HTTP | messaging gate spec "refresh cookie alone is NOT an authentication path"; documents gate spec same; `auth.guard.spec.ts` changes are type annotations only — assertions verbatim |
| Refresh rotation / reuse / family revocation | Untouched; now HTTP-level proof incl. theft simulation | `auth-session.lifecycle.e2e-spec.ts` (pre-rotation replay → 403; live token then refused) |
| Token hashing / CSPRNG | Untouched; `auth.service.db.spec.ts` change is a cast only | diff reviewed |
| Lockout (H7) | Untouched; proven over HTTP incl. 403 body at threshold | auth-session suite |
| Deactivated-account session stop | Untouched; proven over HTTP (isActive=false → refresh 401) | auth-session suite |
| CareCircle membership + endsAt (H10) | Untouched (`authorization.service.ts` ACTIVE+`endsAt` predicate confirmed); now asserted for messaging reads, document uploads, medication/appointment/measure reads, emergency raise + fan-out exclusion | fixtures carry `endsAtPast` members; denied paths in 4 suites |
| OBSERVER restrictions (H9) | Untouched; proven across medication/measure/feed/emergency write surfaces and document upload | resources/documents/emergency suites |
| PRIVATE feed isolation (H6) | Untouched; proven over HTTP incl. 404-not-403 anti-enumeration for foreign PRIVATE posts | resources suite |
| Emergency authorization + state machine (Phase 13) | Untouched; role matrix, terminal protection, single-writer concurrency + single audit row now proven | emergency suite |
| Document authorization (two-layer) | Controller gate fixed (P3); **service-layer checks verified still present on every method** — upload role list, uploader-or-grant + circle check (`verifyDocumentAccess`), grant/revoke/archive FAMILY_ADMIN/DOCTOR, grantee-must-have-membership, per-route `seniorId` scoping on all lookups | `document.service.ts` full read; documents suite cross-senior/role/substitution tests |
| Messaging authorization | P1 fix removed only the tautological `createdAt` filter; `userId` + `leftAt:null` participant binding intact; reply targets constrained to `conversationId` (cross-conversation reply → 403, pinned) | `messaging.service.ts:13-25,85-110`; messaging suite |
| Audit logging | Intact; storageKey dropped from `document.created` metadata (true — verified in diff); emergency audit metadata confirmed message-free (`{type, severity, source}` only); `hasBody` marker tested | service reads + e2e DB-state queries |
| Notification isolation (A22) | Untouched; recipients verified in DB: never sender, expired members excluded, outsiders excluded, body never in payload; user-scoped notification list/read/archive | messaging + emergency + resources suites |
| Cross-senior isolation | Proven at route-substitution level on every surface tested | all suites |
| Input validation | Strict whitelist behavior preserved; P2/P5 **strengthen** validation coverage (optional UUID still format-checked; `@IsObject` restores transport validation) | suites + DTO diffs |
| Rate limiting | Production behavior byte-identical outside `NODE_ENV=test` (bypass is one early-return line before any mutation; guard never clears store in prod path; only bound to auth routes via `@RateLimit()`, 5 usages) | `rate-limit.guard.ts` read + budget spec |

No IDOR/BOLA introduced; no authorization moved client-side; no service-level check removed; no client input can influence `NODE_ENV` (server process variable; `setup-env.ts` only loads under vitest `setupFiles`; no other guard/middleware reads a test-mode flag; cookie `secure` and prod secret validation key on `=== 'production'`, unaffected).

### 5.1 Document role fix — validated (objective 4)

- `RolesGuard` confirmed matching JWT `user.role`/`globalRole` with default `'USER'`; circle-name decorators could indeed never match → dead endpoints pre-Phase 17 (P3 claim accurate).
- `@Roles('USER','SUPER_ADMIN')` is the established convention on every other senior-scoped controller (medications, appointments, emergency) — verified by grep. Fix aligns, does not invent.
- `assertAccess` (circle check) executes on **every** route before service calls, and each service method re-asserts; OBSERVER upload denied, bare-member read denied, uploader/grantee allowed, expired grant stops download, cross-senior substitution 403/404 — all pinned by tests. No bypass introduced; global role is intentionally not privilege-bearing (documented Phase-13 model).

### 5.2 BigInt fix — validated (objective 5)

`createDocument`/`listDocuments`/`getDocument` all convert `sizeBytes → Number` (download already did). No serialization-500 path remains on the five JSON response shapes. Audit metadata no longer contains `storageKey`. `storageKey` is an opaque `docId/randomhex` value and `contentHash` a SHA-256 of bytes — see **L-01** for the one remaining response-hygiene gap. Authorization on all four paths intact.

### 5.3 Messaging fixes — validated (objective 6)

P1: bare-string timestamp filter gone; participant binding logic otherwise byte-identical. Happy-path 200/201, non-participant 403, closed-conversation 403, and `take>100 → 20` clamp all pass on a real DB — proving the pre-Phase-17 code path is genuinely repaired, not papered over. P2: `replyToId` optional + UUID-when-present (malformed → 400 pinned; DB state proves no persistence). Reply-target cross-conversation → 403 with server-validated `conversationId` scoping. Sender is JWT-bound (spoof fields rejected and DB-checked). Gate-spec replacement is behavioral (exact 401s, real signed-token 400s), not superficial.

### 5.4 Health DTO — validated (objective 7)

`@IsObject` is the minimal correct fix for the whitelist-strip failure; the object survives to `value as object` JSON column. Deep shape is still not validated against `HealthMeasurementType.schema` — pre-existing product gap (E-02), neither claimed nor worsened by Phase 17.

### 5.5 Rate-limit bypass — validated (objective 8)

- Server-side only; no HTTP-influence path; does not touch app bootstrap or other guards (only two other `NODE_ENV` reads exist: cookie `secure` and prod-secret validation, both keyed on `'production'`).
- Production/dev behavior: the guard's decision for any non-`test` NODE_ENV is the identical map/window logic as at `c615e2b` (diff shows a pure additive line).
- `rate-limit.guard.spec.ts` proves real budgeting semantics (fresh instance per test, NODE_ENV deleted to arm the guard): 10 allowed / 11th throws, per-IP independence, bypass only under test. **Not constant-assertion padding.**
- Residual design concern recorded as **L-03** (defense-in-depth).

## 6. Test quality (objective 9)

- All prior placeholders verified gone at the source: checkpoint `git show` confirms the old specs contained `expect(true).toBe(true)` and `GreaterThanOrEqual(200)` assertions exactly as documented.
- New suites are behavioral: positive **and** negative case per boundary, DB-state reads (`fx.prisma.*`) after every rejection (spoofed send not persisted; cross-user mark-read leaves `readAt` null; exactly one ack audit row), PHI-leak content checks against actual audit/notification rows, real app pipeline (`AppModule` + production `ValidationPipe`/filter stack via `create-test-app`). **Zero mocks in `test/`** — DI is the real production graph against the real DB.
- Two tiny status-set assertions remain, both honest and justified: unauthenticated `/tasks` `[401,404]` (route deliberately unmounted; both acceptable outcomes for a nonexistent surface) and notification cross-user mutation `[404,403]` (backed by a DB `readAt` assertion). Recorded as I-03, not a defect.
- Fixture fidelity: mobile `authState` mirrors the *effective* gate in `useAuth.tsx` (`refreshAuth` nulls user when token or stored user is absent, lines 27–33) — verified faithful, slightly stricter than the literal `!!user && !!user.id` expression (I-04).

## 7. Real-database execution (objective 10)

Tests connect to real PostgreSQL (`PrismaClient` + full `AppModule`), migrations applied from scratch by the reviewer, fixtures create genuine user/senior/circle/member rows, cleanup via cascade deletes + explicit FK teardown, unique `runId` emails/circle keys prevent collisions, `connection_limit=5` + `fileParallelism:false` make concurrent AppModule boots sustainable against default `max_connections=100` (observed). Fail-closed behavior under bad DB URL explicitly proven (section 3). No credentials committed anywhere.

## 8. Test lanes (objective 11)

`test` (unit config: `src/**` only — includes lighter DB-backed service specs, correct for any environment with a DB), `test:integration` (`test/**/*.e2e-spec.ts` only), `test:all` (both) — names match behavior, verified by execution. `turbo.json`: `dependsOn ["^build"]`, new lanes `cache:false` (no stale skips); `DATABASE_URL`/`JWT_ACCESS_SECRET` in `globalEnv` invalidate caches on DB swap. No command hides failures (vitest `run` exits non-zero; turbo surfaces task failure; root runs green only because underlying suites pass).

## 9. Typecheck & build (objectives 12–13)

API typecheck now spans main + seed + **test** configs (0 errors; `tsconfig.test.json` include covers `src/**/*.spec.ts` + `test/**` — specs genuinely typechecked, and the four 4-line spec diffs are exactly the type-error repairs claimed, assertion-neutral). Production build excludes `src/testing` and all specs (dist verified). Mobile/web typechecks 0 errors.

## 10. CI (objective 14)

`ci.yml` is valid (PyYAML; single workflow file). Triggers push(main)+PR; concurrency cancel-in-progress. API job: postgres:16 service with `pg_isready` health checks, generate→validate→migrate deploy (correct order, service port 5432 matches `DATABASE_URL`), frozen lockfile install, throwaway 32+ char secret + explicit `NODE_ENV=test` (CI is a test environment — the guard bypass is active here by design and appropriate), typecheck → build → unit → integration (same suites as local — verified identical commands), lint `continue-on-error`. The advisory lint cannot mask *real* errors: they are still printed as failing steps (red) and only job status is non-blocking — acceptable and documented; mobile lint same treatment; web lint blocking and green. **The remote workflow has not been executed** (no push) — the phase doc says exactly this; no claim of remote CI pass exists anywhere (checked).

## 11. Phase 18 contamination (objective 15)

**None.** Scan for realtime/WebSocket/gateway/push/AI/LLM/new-schema/dashboard features across every Phase 17 file and the full diff: zero implementation hits. No future-phase stubs or dead scaffolding added. `apps/api/test/` (new dir) contains only the 5 claimed suites; `src/testing/` only the 3 helpers. The CI workflow belongs to Phase 17's own claimed scope ("minimal CI").

## 12. Documentation accuracy (objective 16)

`docs/PHASE_17_TESTING_CI_RELIABILITY.md` matches the code on every substantive claim, including per-file test counts (messaging 13, documents 9, emergency 8, resources 18, auth-session 7, rate-limit 4 — all match the executed run), the P1–P7 bug table (each independently confirmed at source level), checkpoint-state claims in §2 (verified via `git show c615e2b`), and §3.3/§9's honest disclosure of the 500-on-concurrent-ack, unmounted tasks controller, 201 semantics, advisory lint, and "CI never ran remotely". Limitations are disclosed, not hidden. Two immaterial inaccuracies: lint-warning count (§8 table says 127; measured 128 — and contradicts §3.3's own 128) → I-01; and fixture PENDING/ENDED/deleted-circle/senior capabilities are *available* but unasserted while §3.2/§5 phrasing reads as coverage (no overclaim of security properties) → I-02.

## 13. Findings

### A. Security vulnerabilities
**None.** (No Critical, no High.)

### B. Reliability defects

**M-01 — Medium — API build can silently emit nothing when `tsconfig.build.tsbuildinfo` is stale/warm (pre-existing mechanism, surfaced during review)**
- File: `apps/api/nest-cli.json` (`deleteOutDir: true`) + incremental base config (`@ecc/config/tsconfig.node.json`)
- Issue: reproduced — a warm `tsconfig.build.tsbuildinfo` (e.g. left by a prior build; one existed at review start) causes `nest build` to `rm -rf dist` then skip emit as "up to date", exiting 0 with **no dist**. `pnpm --filter @ecc/api build` therefore can pass locally while producing zero output. A `dist`-dependent run would execute stale/absent code.
- Why it matters: build success is a release gate; silent zero-output success defeats it. CI (fresh checkout, no tsbuildinfo) is unaffected.
- Phase 17 regression? **No** — Phase 17 did not change `tsconfig.json`/`nest-cli.json`/base config; the quirk predates the checkpoint. Found during build verification.
- Remediation: set `"incremental": false` (or `tsc -b` without composite) for the build config, or delete `*.tsbuildinfo` in the build script, or add a post-build `dist/main.js` existence assertion.

### C. Test-quality / infrastructure
No defects. (Observations I-03/I-04 are informational.)

### D. Scope / documentation
- **I-01 — Info** — `docs/PHASE_17_TESTING_CI_RELIABILITY.md` §8: "55 errors / 127 warnings"; measured 128 warnings (55 errors correct). Trivial count drift, internally contradicts the same doc's §3.3.
- **I-02 — Info** — `care-fixture.ts` creates PENDING/ENDED members, a deleted circle and a deleted senior that **no** e2e case asserts against (e.g. deleted-circle access). Capability, not coverage; §3.2's phrasing slightly overstates. Consider one deleted-circle access test.

### E. Pre-existing issues (not caused by Phase 17; verified unchanged)
- **L-01 — Low** — `document.service.ts:190` `createDocument` returns the full row (`{...document}`), so the **upload response** still includes `storageKey` + `contentHash`, while `getDocument`/list/download paths strip them (Phase 17 inconsistency; both values are opaque/self-owned and only reach the authorized uploader — no cross-user exposure). Remediation: strip in the create response too.
- **L-02 — Low** — `document.service.ts` `listGrants` authorizes with circle membership only: any active member (**including OBSERVER**) can enumerate grant records (grantee ids, expiry) of any document in their senior's scope, including documents they cannot open. Within-circle metadata only, emails stripped in Phase 16 — unchanged by Phase 17; documents e2e only proves the A11 PII fix. Remediation: restrict to uploader or FAMILY_ADMIN/DOCTOR.
- **L-03 — Low** — `rate-limit.guard.ts:22` — security control toggled by a deployment env var. If a production/staging container ever ships with `NODE_ENV=test` (e.g. from an image default), auth rate-limiting silently disables with no signal. No client can influence it; all tested paths keep it out of prod; the guard is the sole consumer. Remediation: prefer an explicit config token/DI flag (e.g. injected via testing module overrides) over env sniffing, or warn at bootstrap when `NODE_ENV==='test'` and `PORT` is bound.
- **L-04 — Low** — Concurrent emergency-ack loser surfaces 500 instead of 403/409 (`emergency.service.ts:144` conditional-update + follow-up `update` not-found). Non-exploitable (single transition, single audit row — both pinned by tests), generic `INTERNAL_ERROR` shape, stack only server-logged (filter verified). Documented and pinned by Phase 17; not fixed (correctly out of test-only scope).
- **I-05 — Info** — Care-task controller unmounted (routes 404) and dose services controller-less (audit B2/B3) remain product gaps; Phase 17's 404-contract assertion is the honest interim.
- **I-06 — Info** — POST commands returning 201 (style) left untouched.

## 14. Phase 16 regression assessment
**No weakening of any Phase 16 security control.** Every modified file that touches a security boundary was read in full; the two behavioral deltas (P3 document gate, P1 messaging filter) strictly *restore* the Phase 13/16 design (service-level circle authorization; participation binding) rather than loosen it. JWT/auth/session, membership/endsAt, OBSERVER/PRIVATE, emergency, document, messaging, audit, notification, validation controls are intact and — for the first time in this codebase — proven end-to-end over real HTTP + PostgreSQL by 55 new integration assertions with zero mocks in the integration lane.

## 15. Phase 18 contamination assessment
**Clean.** No realtime, WebSocket, push-notification, AI/LLM, dashboard, or schema changes anywhere in the change set.

## 16. Limitations of this review
- Remote GitHub Actions execution unverified (no push; consistent with phase claims) — validated statically (YAML) plus all step commands reproduced locally against the reviewer-provisioned DB.
- `actionlint` not installed on this host.
- `git diff --check` / stash-compare baseline parity was relied upon for the "55 errors at checkpoint" claim; per-file attribution was verified directly (checkpoint blobs contain the same erroring lines).
- Review executed tests against a fresh isolated database inside the repo's running postgres container; the dev database was not read or written.

## 17. Final verdict

# APPROVED FOR PHASE 17 CHECKPOINT

Criteria: zero unresolved Critical/High security findings ✔; no Phase 16 regression ✔; meaningful real-DB tests pinning every security-sensitive fix ✔; test infrastructure independently reproduced (157/157 API with DB; fail-closed without) ✔; no Phase 18 contamination ✔. The Medium finding (M-01) is a pre-existing build-pipeline trap, not a Phase 17 defect; it does not block the checkpoint and should be scheduled as small future work. Committing the checkpoint remains the owner's decision (none was created here).

## 18. End-of-review summary

- **Critical: 0 · High: 0 · Medium: 1 · Low: 4 · Info: 6**
- **Tests executed:** API unit 102/102 · API integration 55/55 (fresh migrated DB) · API all 157/157 (0 failed/0 skipped) · API all w/o DB 58 pass/99 skip/0 fail · bad-DB probe fails closed · mobile 32/32 · web 1/1 · root `test`/`test:integration`/`test:all` all green via turbo.
- **Typecheck:** API (main+seed+test configs) 0 errors · mobile 0 · web 0.
- **Build:** API emits `dist/main.js` with no `src/testing`/spec content (one pre-existing warm-tsbuildinfo silent-no-emit trap found, M-01) · web `next build` parity accepted from phase claims (lint/type/test re-run green here).
- **Files modified by this review:** **none** — only `SECURITY_REVIEW_PHASE_17.md` created. Working-tree diff hash before and after review: `e2291a476dc9e92f6e62a98db3c2da02` (identical); transient build caches (`*.tsbuildinfo`, `dist/`) created during verification were removed.
- **Commit created:** **No** — HEAD remains `c615e2b`; stash empty.
- **Phase 18 started:** **No.**
