# Phase 16 — Security & Reliability Remediation

**Date:** 2026-09-26
**Inputs:** `SECURITY_REVIEW_PHASE_16.md` (independent read-only audit)
**Constraint:** Side project. No scope expansion, no Phase 17 features. Only verified Critical/High findings fixed; Mediums only where they were part of the fix path.

---

## Status legend

- **FIXED** — code change + regression test with meaningful assertions + verification executed.
- **PARTIALLY FIXED** — core problem addressed, residual limitation documented.
- **UNABLE TO VERIFY** — fix present but environment could not exercise it.

---

## CRITICAL

### C1 (audit A1) — Refresh tokens generated with `Math.random()`

- **Root cause:** `generateRefreshToken()` built the 64-hex "256-bit" token and the `jti` from `Math.random()`, a seeded 53-bit PRNG. Token secrecy (30-day credential, cookie + body accepted) was effectively predictable, and `jti` (`Date.now()-random`) was collision-prone against the `@unique` column.
- **Remediation:** `crypto.randomBytes(32).toString('base64url')` for the secret half and `crypto.randomUUID()` for the jti, centralized in new `apps/api/src/config/security-config.ts` (`generateTokenSecret`, `generateTokenId`). Token format is now `<uuid-jti>.<43-char secret>` so the jti doubles as the O(1) lookup key (see H4).
- **Files:** `apps/api/src/config/security-config.ts` (new), `apps/api/src/auth/auth.service.ts`.
- **Regression tests:** `security-config.spec.ts` (entropy shape, 200-sample uniqueness, UUID v4 shape, non-derivable format); `auth.service.db.spec.ts` (issued token matches `<uuid-v4>.<43 base64url>`; stored `tokenHash` = SHA-256 of secret half; plaintext never persisted; consecutive logins produce distinct tokens **and distinct families**).
- **Verification:** real-Postgres integration run, PASS.
- **Status:** FIXED.

### C2 (audit A2) — Silent JWT secret fallback to `'dev-secret-change-me'`

- **Root cause:** Four sites (`app.module.ts`, `auth.module.ts`, `auth.service.ts`, `auth.guard.ts`) used `process.env.JWT_ACCESS_SECRET ?? 'dev-secret-change-me'`. A missing/typo'd env would sign and verify tokens with a repository-public constant; nothing failed fast.
- **Remediation:** single resolver `resolveJwtAccessSecret()`:
  - `NODE_ENV=production`: **throws** if the secret is missing, <32 chars, or any known placeholder — process cannot boot.
  - dev/test: generates a random ephemeral per-process key (warns loudly). The known constant is gone from the codebase; even dev never uses a public secret. Verification also pins `algorithms: ['HS256']`.
- **Files:** `security-config.ts` (new), `app.module.ts`, `auth.module.ts`, `auth.service.ts`, `auth/guards/auth.guard.ts`.
- **Regression tests:** `security-config.spec.ts` — production refuses missing/placeholder/too-short secrets; accepts real secret; dev fallback is random (≥32 chars, never equals `dev-secret-change-me`) and stable within a process.
- **Verification:** unit suite PASS; guard test asserts `verifyAsync` receives the configured secret + pinned HS256.
- **Status:** FIXED.

---

## HIGH

### H3 (audit A5) — Refresh-token reuse detection was non-functional

- **Root cause:** detection compared `t.updatedAt` on `RefreshToken` rows — a field that **does not exist** in the schema (compile errors TS2339/TS2353 proved it). `undefined > undefined` is always `false`, so the "revoke family on replay" branch was dead code.
- **Remediation:** detection rebuilt on fields that exist and are authoritative: the presented token's row must be **un-revoked and un-superseded** (`revokedAt === null && replacedById === null`); any replay of a rotated/revoked row revokes every live token in the family. Rotation is race-safe: the new row is created and the old row revoked inside one transaction using a **conditional `updateMany({ where: { id, revokedAt: null, replacedById: null } })`**; a lost race is treated as reuse (family revoked), and the transaction never throws a 500 on concurrent rotation.
- **Files:** `auth/auth.service.ts`.
- **Regression tests:** `auth.service.db.spec.ts` — (a) rotation revokes old token + sets `replacedById` and family id is preserved; (b) replay of the rotated-out token raises reuse, **all** family rows end revoked, and the legitimate successor token is then dead; (c) wrong secret with a valid jti is rejected without revoking the family (no false positives); (d) rotation chain works repeatedly.
- **Verification:** real-Postgres PASS (replay test also confirms the `lastUsedAt`-style bookkeeping is unnecessary).
- **Status:** FIXED.

### H4 (audit A6) — O(n) Argon2 verification on every refresh/logout

- **Root cause:** refresh/logout scanned all live `refresh_tokens` rows and ran Argon2 (≈100 ms) against each; one public endpoint multiplied cost by total active sessions across all users.
- **Remediation:** redesign per the schema's own documented design ("we store a SHA-256 hash of the random 256-bit secret, plus an opaque jti"): token embeds its jti → verification is a single indexed `findUnique({ where: { jti } })` + constant-time (`timingSafeEqual`) SHA-256 comparison. 256-bit CSPRNG entropy makes hashing (not Argon2) the correct primitive. Argon2 remains for passwords only. No schema/migration change (columns unchanged; format change is app-side).
- **Files:** `auth/auth.service.ts`, `security-config.ts` (`hashToken`).
- **Regression tests:** `auth.service.db.spec.ts` — seeded 50 foreign live tokens then rotated + replayed the target token; asserts reuse revocation is family-scoped (foreign families untouched), i.e. lookup/revocation no longer walks the table; plus C1/H3 tests proving correct semantics at O(1).
- **Verification:** real-Postgres PASS.
- **Status:** FIXED.

### H5 (audit A8) — `JwtAuthGuard` cookie bypass without identity

- **Root cause:** guard returned `true` when no Bearer token but a `refresh` cookie existed, and never set `req.user` — authentication silently degraded to "controller remembers to check `sub`"; `RolesGuard` then defaulted an unauthenticated request to role `USER`.
- **Remediation:** bypass branch deleted. Guard accepts **only** a valid Bearer JWT (HS256-pinned) and additionally requires a non-empty `sub` before attaching identity; otherwise 401. The refresh endpoint was already `@Public()` and never needed the guard path.
- **Files:** `auth/guards/auth.guard.ts`.
- **Regression tests:** `auth/guards/auth.guard.spec.ts` — cookie-only request → 401 **and `req.user` stays undefined**; missing/malformed/forged headers → 401; valid signature but no `sub` → 401; valid token → `true` + identity attached + exact verify options asserted.
- **Verification:** unit PASS; the now-booting supertest suites (`messaging`, `auth.controller`) independently confirm 401 for unauthenticated requests (previously 200/500).
- **Status:** FIXED.

### H6 (audit A4) — PRIVATE feed posts visible to all circle members

- **Root cause:** `findBySenior`/`findOne` filtered by `visibility` only when the client asked; `PRIVATE` posts were returned to everyone (incl. OBSERVERs), while the DTO accepted `PRIVATE` writes — a broken data-sharing promise.
- **Remediation:** server-side visibility predicate in `FeedService`: list and single-read now always apply `AND [{ OR: [{ visibility != PRIVATE }, { authorUserId = me }] }]` (plus optional requested-visibility narrowing). Author-only for PRIVATE; CIRCLE/ORGANIZATION unchanged (org separation intentionally not implemented — no scope expansion). Also stopped leaking author `email` in feed responses (was part of the same payload).
- **Files:** `modules/feed/services/feed.service.ts`.
- **Regression tests:** `auth/authorization.db.spec.ts` (real DB) — PRIVATE post: visible to author, **not** to FAMILY_ADMIN (higher role), not to OBSERVER, not via direct-id `findOne` (enumeration attempt), and explicit `?visibility=PRIVATE` listing returns zero foreign rows. CIRCLE post visible to admin. Cross-senior listing denied.
- **Verification:** real-Postgres PASS.
- **Status:** FIXED.

### H7 (audit A7) — Account lockout was dead code; failed logins un-audited

- **Root cause:** `login` read `failedLoginCount`/`lockedUntil` but nothing ever incremented/reset them; failed attempts produced no audit rows.
- **Remediation:** lockout check moved **before** password verification (locked accounts unprobeable); each bad password increments the counter and, on the 10th failure, sets `lockedUntil = now + 15 min`; every failure is audited (`auth.login.failed`, with ip/userAgent — see H-notes below); a successful login resets the counters and records `lastLoginAt`.
- **Files:** `auth/auth.service.ts`.
- **Regression tests:** `auth.service.db.spec.ts` — single failure increments + audits; 10 failures ⇒ locked state, correct password refused while locked, and after simulated expiry login succeeds **and** counter resets to 0/`lockedUntil=null`.
- **Verification:** real-Postgres PASS.
- **Status:** FIXED. (Residual: per-IP guard is still the in-process `RateLimitGuard` — unchanged Medium A13.)

### H8 — Deactivated accounts could still log in

- **Root cause:** `login` verified the password against inactive/soft-deleted users and issued fresh access+refresh tokens; `isActive` was only honoured on refresh.
- **Remediation:** `login` rejects `!isActive || deletedAt` with a 403 **after** password verification (no account-state oracle for wrong passwords) and audits `auth.login.inactive`. `GET /auth/me` now re-reads the user (`getProfile`) so a deactivated account stops returning an identity even with an unexpired token.
- **Files:** `auth/auth.service.ts`, `auth/auth.controller.ts` (`/me` now DB-backed, JWT-subject-derived only).
- **Regression tests:** `auth.service.db.spec.ts` (inactive and soft-deleted users with correct password → 403; refresh for deactivated user → 401); integration test asserts `/me` 401 without auth (the old unauthenticated 200 stub is gone).
- **Verification:** real-Postgres PASS.
- **Status:** FIXED.

### H9 (audit A9) — OBSERVER could write and delete PHI (health measurements)

- **Root cause:** `measurement create` explicitly allowed OBSERVER; `archive` had **no role check at all** — any circle member could soft-delete measurement history, unlike every comparable destructive op (documents/medications/appointments/emergency).
- **Remediation (policy: OBSERVER is read-only):** OBSERVER removed from the record-allowed set (FAMILY_ADMIN, FAMILY_MEMBER, CAREGIVER, DOCTOR); archive restricted to FAMILY_ADMIN/DOCTOR (recorder corrections go through a steward, history isn't self-erased).
- **Files:** `modules/health/services/measurement.service.ts`.
- **Regression tests:** `authorization.db.spec.ts` — OBSERVER cannot record; OBSERVER cannot archive; FAMILY_MEMBER cannot archive; FAMILY_ADMIN can archive; cross-circle outsider denied entirely. Read paths for OBSERVER unaffected (assertions + 22 existing emergency-service suite + controller suites still pass).
- **Verification:** real-Postgres PASS.
- **Status:** FIXED.

### H10 (audit A3) — Care-circle membership `endsAt` never enforced

- **Root cause:** `AuthorizationService` and the emergency-recipient query filtered only `status=ACTIVE, deletedAt=null`; an ended caregiver relationship (`endsAt` past, status untouched) retained full PHI access forever.
- **Remediation:** single `membershipWhere()` helper adds `OR: [{endsAt:null},{endsAt:{gt:now}}]` to `canAccessSenior` + `getMemberRole` (hence every `assertCanAccessSenior` consumer: all senior-scoped controllers); emergency alert recipient fan-out applies the same filter.
- **Files:** `auth/authorization.service.ts`, `modules/emergency/services/emergency.service.ts`.
- **Regression tests:** `authorization.db.spec.ts` — ACTIVE+null endsAt ⇒ allowed; ACTIVE+past endsAt ⇒ access denied, role null, assert throws (the exact A3 row shape); cross-senior isolation maintained.
- **Verification:** real-Postgres PASS.
- **Status:** FIXED.

### H11 (audit A16) — Login never delivered the access token

- **Root cause:** `POST /auth/login` computed `result.access` but returned only `{ user }`. The mobile client (and any future web client) could never obtain a token — every authenticated call 401'd and the "SecureStore token flow" checkpointed in Phase 14 was inoperative.
- **Remediation:** login now returns `access` in the body and sets the httpOnly refresh cookie; **refresh rotates the cookie** (previously the rotated refresh token was generated server-side and then discarded, so the cookie held a dead token after first rotation — verified bug); `logout` revokes the caller's own refresh token (cookie- or body-supplied), now bound to the JWT subject so a foreign token can't be revoked through this endpoint; `GET /auth/me` returns the real profile.
- **Files:** `auth/auth.controller.ts`, `auth/auth.service.ts`.
- **Regression tests:** server — `auth.controller.spec.ts` (integration, real DB): login returns non-trivial `access` + `refresh` cookie with `HttpOnly`/`Path=/api/v1/auth/refresh`/`SameSite=Strict`; `/me` 200 with JWT-derived id when authenticated; `auth.service.db.spec.ts` access-token signature verification (`sub`/`email`/`role`). Client — mobile `src/services/auth.spec.ts` asserts the token is stored in SecureStore on login and that the session path uses it (mocked SecureStore; the spec previously couldn't run at all).
- **Verification:** server integration PASS (real DB); mobile suite now actually executes via `pnpm --filter @ecc/mobile test` (6 files, 32 tests — the old script was an `echo` placeholder).
- **Status:** FIXED. **Limitation:** on-device SecureStore/cookie behaviour on a real device/emulator could not be exercised here (no emulator); transport remains whatever the deployment configures (`http://localhost` dev default unchanged — deployment concern, documented in the audit; production TLS is a Phase 19 item).

### H12 (audit B1, #12) — API did not build (47 TS errors); several security controls were therefore inert

Minimal repairs only (no cosmetic refactors):

- Created the missing `modules/medications/medication.module.ts` (imported by `AppModule` — whole app couldn't compile).
- Corrected under-levelled relative imports in 16 files (`../auth/...` → `../../auth/...` etc. in modules; services one level deeper) and `emergency.module` notifications path.
- Name mismatches: `MeasurementService` → `HealthMeasurementService` (module/controller), `CreateFeedUpdateDto` → `CreateFamilyUpdateDto`.
- `notification.controller` `markAsUnread` — method existed on the controller but not the service → implemented (was a guaranteed runtime TypeError).
- Prisma-accuracy fixes (queries referencing non-existent columns, all caught by the compiler):
  - `document.service`: `DocumentAccess` has no `deletedAt`/`user` relation → grant checks drop the phantom filter, expiry semantics fixed to `OR [null, future]` (previously open-ended grants were treated as **expired**), revocation deletes the row (audit entry preserved), grantee PII dropped from `listGrants` (audit A11, in-path), transaction interface corrected.
  - `messaging.service`: `Message` has no `deletedAt` → filter removed.
  - `dose-recording.service`: `findUnique` with non-unique `deletedAt` → `findFirst({ id, seniorId })`; this also closes the **latent IDOR** (B3): skipped/snoozed now bind the dose to the route senior (taken already did).
  - `auth.service` refresh-rotation fields (`updatedAt`/`createdAt`) — handled under H3/H4 redesign.
  - `notification.service` channel/enum + JSON payload typings; `appointment.service` `isTelehealth === true` impossible comparison.
  - `care-task.service` impossible role `'CARETAKER'` → `'CAREGIVER'` (dead-code service, one-word correctness fix).
- Vitest NestJS transform: esbuild drops `emitDecoratorMetadata` → Nest DI injected `undefined` for services in `AppModule`-booting tests. Configured the standard `unplugin-swc` Vite plugin (`vitest.config.ts`, dev-only deps `unplugin-swc`+`@swc/core`; `pnpm-workspace.yaml` allowBuilds entry) + merged duplicate `@nestjs/common` imports it surfaced. `import type` on **injectables** (`AuthService`, `JwtService`, `Reflector`, `PrismaService`) erased DI tokens → converted to value imports where metadata is required (`auth.controller`, `auth.guard`, `roles.guard`, `health.controller`).
- Supertest specs now mirror real bootstrap (`setGlobalPrefix('api/v1')` + global `ValidationPipe`) — the auth/messaging/documents endpoint suites could finally run; three of them previously "passed" only because they never loaded.
- **Verified pre-existing repo defect found while proving H3/H4:** the Phase 13 migration `20260915000000_phase13_emergency_alerts` could never apply to a fresh database (`prisma migrate deploy` → E42804/P3009: the status/severity mapping ran as standalone UPDATEs writing text into enum columns whose target values didn't exist yet). Mapping moved into the `USING` clauses of the `ALTER COLUMN TYPE` statements (identical value semantics). The migration file is not yet applied to any live deployment (no deployed DBs exist — local dev containers only), so editing it in place is safe; **flag for the reviewer** as a process deviation (completed-phase migration was touched because it was a *verified build/deploy blocker* for the required regression evidence, not a schema change: zero DDL semantics altered — same enums, same mapping table, same resulting columns).
- **Status:** FIXED — `tsc` (main + seed) 0 errors, `nest build` emits `dist/main.js` (verified after tsbuildinfo hygiene), AppModule boots in integration tests.

---

## Bonus reliability fixes that were strictly in the fix-path of the above (not scope creep)

1. **Login now issues one rotation family per login** (`familyId = generateTokenId()` instead of `familyId = userId`). The old design shared a single family per user, so the working H3 detection would have revoked *every* device whenever any one token was replayed — i.e. correct reuse detection was impossible without this per-session family. Schema unchanged (`familyId` already existed and is documented per ARCHITECTURE §4.6).
2. **Auth audit events now carry `ipAddress`/`userAgent`** (login success/failure/reuse) — the schema columns existed and are documented as "correlates with the API request log"; without them the new lockout/reuse detection produced unattributable audit rows. (Partial touch of audit A21.)
3. **Messaging notifications now reach the other participants, not the sender** (audit A22) — one-line recipient correction in the path that H3/H4 tests exercised end-to-end.
4. **`verifyHash` fails closed**: seed data uses a structurally invalid argon2 placeholder; the old code threw a 500 on `argon2.verify`; now it returns `false` (generic 401) and, since H7, counts toward lockout.
5. **`/auth/me` unauthenticated 200-stub removed** (audit A23-3): the `@Public()` POST twin returned `globalRole:'USER'` to anonymous callers and the GET returned an empty-object shape; both replaced by the guard-protected DB-backed profile. (One fewer "authenticated-looking" endpoint.)

---

## Explicitly NOT fixed (Medium/Low or documented — Phase 16 scope discipline)

- A11 audit-log PHI (`title` in metadata) & email in feed/message payloads (email drop was in-path only), A12 notification retention after circle removal, A13 Redis/shared rate limiting, A14 password policy, A15 storage purge/BigInt serialization (still present; download/list BigInt serialization path unchanged), A17 web cookie cross-origin design, A18 CORS/`WEB_ALLOWED_ORIGINS` unwired, A19 docker defaults, A20 dependency upgrades (Next 14.x RCE advisory remains — upgrade would violate "no unrelated refactoring"), A21 audit grant-table/append-only DB role, A23 remaining lows.
- B2 (care-task controller still stubbed), B4 (BullMQ/Socket.IO claims), B5 (changePassword not yet exposed), B6 (`@Public` still decorative — global guard needs a test suite of its own; guard hardened instead), B7 (mock-vs-real DB gap: *closed for auth/feed/health/messaging/documents by the new real-DB specs*), B9 seed placeholder users (login now fails closed instead of 500 — documented), B10 dead dashboard links, B11 no CI (repo has no CI infrastructure; adding one is out of scope), B12 architecture drift (docs describe RS256/S3/presign — unchanged).

---

## Test inventory (new/changed evidence)

| File | Nature | Tests |
|---|---|---|
| `src/config/security-config.spec.ts` | unit | 11 (C1/C2/H4 primitives) |
| `src/auth/guards/auth.guard.spec.ts` | unit | 6 (H5) |
| `src/auth/auth.service.db.spec.ts` | **real DB** | 15 (C1/C2-adjacent, H3, H4, H7, H8, H11, logout/changePassword) |
| `src/auth/authorization.db.spec.ts` | **real DB** | 12 (H6, H9, H10 + cross-senior/cross-circle) |
| `src/auth/auth.controller.spec.ts` | real DB supertest | 5 (+2 new: token delivery, cookie attrs, authenticated /me) |
| `src/modules/{documents,messaging}/*.spec.ts` | real DB supertest | 4 + 22 (harness made to actually run) |
| `src/modules/emergency/emergency.controller.spec.ts` | service-level | 22 (unchanged, still green) |
| `src/modules/documents/services/document.service.spec.ts` | mock | 13 (revoke mock aligned to real schema) |
| mobile `src/services/auth.spec.ts` | now-executed | 6 (token stored on login; refresh failure clears) |

## Verification results (executed 2026-09-26)

- **API tests with DB** (`DATABASE_URL` → postgres:16-alpine container, `prisma migrate deploy` from scratch): **116/116 PASS, 11/11 files.**
- **API tests without DB** (CI shape): 54 PASS, 62 DB-gated SKIPPED, 0 failed.
- **API typecheck** (`tsconfig.json` and `tsconfig.seed.json`): **0 errors** (was 47).
- **API build** (`nest build`, clean tsbuildinfo): **`dist/main.js` emitted OK** (was failing; also verified the tsbuildinfo poisoning trap: stale buildinfo from `--noEmit` runs must be cleared — noted for CI design, B11).
- **API lint**: 55 errors (baseline before remediation: 56) — all remaining are pre-existing `no-explicit-any`/`no-control-regex` in legacy specs/DTOs + 1 `no-var-requires`; **zero errors in any Phase-16 touched/created file**; ~warning churn is pre-existing import-sort debt.
- **Mobile tests**: placeholder script replaced with real `vitest run`: **32/32 PASS**; `tsc --noEmit`: 0 errors (was red — audit B8; fixed minimally: tsconfig `module`, spec type casts only).
- **Web tests**: 1/1 PASS, typecheck clean, lint clean (untouched).
- **`git diff --check`**: clean.
- **Migration redeploy**: fresh-container `prisma migrate deploy` applies both migrations cleanly (previously failed — see H12).

## Summary counts

- **Critical: 2/2 fixed.**
- **High: 10/10 fixed** (incl. build blocker; H11 has a documented device-verification limitation).
- **Medium touched incidentally: 4/16** (A21 partial: auth-event ip/ua; A22 messaging recipients; A11 listGrants PII; A23-3 me-stub removal).
- **Regression tests added/expanded: 44 new tests + 7 re-enabled endpoint tests** (with real-DB behavioural assertions, permitted + denied + cross-user/cross-senior paths).
- **Phase 17 started: NO.** **Commit created: NO.**
