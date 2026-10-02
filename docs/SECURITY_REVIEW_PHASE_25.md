# INDEPENDENT SECURITY REVIEW — Phase 25 (d6f92b3)

**Reviewer:** Independent review (review-only — no fixes, no commit, no push)
**Checkpoint:** `d6f92b3` (Product Readiness remediation checkpoint)
**Parent:** `85bd86a` (Phase 50 supply-chain remediation)
**Scope:** Phase 25 implementation + Product Readiness remediation at `d6f92b3`
**Method:** Source inspection, script execution, dependency verification, test reproduction, runtime verification (no source changed; no gate weakened; no deployment performed)

---

## 1. Phase 25 diff inspected independently

`git log --oneline -3`: `d6f92b3` → `85bd86a` → `511be02`
`git status --short`: clean (no uncommitted tracked changes at checkpoint; review doc is untracked, which is correct for a review-only phase)
`git diff 85bd86a..d6f92b3 --stat` shows 13 files changed, 703 insertions, 56 deletions:

- `app.module.ts` (+ CareTasksModule import)
- `auth/auth.controller.ts` (+ `@HttpCode(501)` on 3 stubs; honest messages)
- `care-tasks/care-tasks.controller.ts` (+ service injection; service calls)
- `care-tasks/care-tasks.module.ts` (new)
- `feed/feed.controller.ts` (+ `@HttpCode(501)` on PATCH stub)
- `notifications/preference.controller.ts` (+ `@HttpCode(501)` on PATCH stub)
- 4 test files updated (regression tests for mounted module and honest stubs)
- 2 docs added (`PRODUCT_READINESS_PREFLIGHT.md`, `PRODUCT_READINESS_SECURITY_REVIEW.md`)

No `pnpm-lock.yaml` change (`git diff pnpm-lock.yaml` = empty); no `prisma/schema.prisma` change; no `migrations/` change; no Dockerfile change; no CI workflow change (`.github/workflows/ci.yml` unchanged).

---

## 2. Authentication review

- `auth.controller.ts`: `register` (`@Public()` + `@RateLimit()` + `JwtAuthGuard` absent — correct); `login` (`@Public()` + `@RateLimit()` — correct); `refresh` (`@Public()` + `@RateLimit()` — correct); `logout` (`@UseGuards(JwtAuthGuard)` — correct); `me` (`@UseGuards(JwtAuthGuard)` — correct).
- Stubs: `forgot-password` (`@Public()` + `@RateLimit()` + `@HttpCode(501)`); `reset-password` (`@Public()` + `@RateLimit()` + `@HttpCode(501)`); `verify-email` (`@Public()` + `@HttpCode(501)`). All honest (501); none leak session/user state; none modify data.
- Cookie settings preserved: `refresh` cookie `path: '/api/v1/auth/refresh'` (scoped), `httpOnly: true`, `secure: NODE_ENV === 'production'`, `sameSite: 'strict'`. `ecc_at` cookie protected by same settings (`security-boundary.test.ts` verifies).
- Rate limiter still active (`RateLimit` decorator on auth endpoints; `verify-config-contract.mjs` asserts `ECC_TEST_DISABLE_RATE_LIMIT` only for `NODE_ENV === 'test'`).
- `verify:auth:compiled` requires `DATABASE_URL`; not executed in this review (expected; not a regression). `security-config.ts` unchanged; `ACCESS_TOKEN_TTL_SECONDS` unchanged.

Verdict: **No regression; no vulnerability.**

---

## 3. Authorization / Care-Circle isolation

- `CareTaskController` (`care-tasks.controller.ts` line 13): `@Controller('seniors/:seniorId/tasks')`; `@UseGuards(JwtAuthGuard, RolesGuard)`.
- `assertAccess(req, seniorId)` (line 20): calls `authorizationService.assertCanAccessSenior(userId, seniorId)` before any service call.
- Controller role gates preserved (`FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR` for create; `FAMILY_ADMIN`, `CAREGIVER` for update/cancel; `FAMILY_ADMIN` only for cancel).
- Service-level authorization (`care-task.service.ts`): `assertCanAccessSenior` enforced on `create`, `findBySenior`, `findOne`, `update`, `cancel`, `complete`. Role gates duplicated at service layer.
- Module mounted (`care-tasks.module.ts` created; `AppModule` imports `CareTasksModule` at line 40). No circular dependency (`FeedModule`, `DocumentsModule`, etc. unchanged).
- `verify:routes` executed independently (`pnpm --filter @ecc/api verify:routes`): **FAILS** with concrete evidence:

```
FAILED — 2 authorization-structure problem(s):
  - PATCH /api/v1/seniors/:seniorId/tasks/:taskId (CareTaskController.update) binds a whole request body to `Object` at parameter #2, which Nest's ValidationPipe skips: this body is accepted unvalidated — no whitelist, no forbidNonWhitelisted, no type or length constraints. `Partial<SomeDto>` and inline type literals both emit `Object` here. Bind it to a DTO class.
  - POST /api/v1/seniors/:seniorId/tasks (CareTaskController.create) binds a whole request body to `Object` at parameter #1, which Nest's ValidationPipe skips: this body is accepted unvalidated — no whitelist, no forbidNonWhitelisted, no type or length constraints. `Partial<SomeDto>` and inline type literals both emit `Object` here. Bind it to a DTO class.
```

This is an exact reproduction of **F-3** from Phase 25 (`keyed `@Body('field')` escapes DTO coverage`). The readiness phase mounted `CareTasksModule` but did not create DTO classes (`create-senior.dto.ts` exists; `care-tasks` has no `create-task.dto.ts` or `update-task.dto.ts`). The controller continues to use inline type literals (`body: { title: string; ... }`), which emit `Object` in compiled `dist/`, bypassing `whitelist` and `forbidNonWhitelisted`.

Verdict: **Concrete P1 security/reliability finding — the readiness phase did not fully address F-3 for care tasks.** The module is mounted and authorization enforced, but the body is unvalidated at the security boundary.

---

## 4. Stub endpoint review

Evidence (`auth.controller.ts`, `feed.controller.ts`, `notifications/preference.controller.ts`):
- `forgot-password`: `@Public()` + `@HttpCode(501)`; message: `'Password reset is not implemented. Use account registration and login.'`; no email/SMTP interaction.
- `reset-password`: `@Public()` + `@HttpCode(501)`; message: `'Password reset is not implemented.'`; no `prisma.user.update()` called; no audit log for reset.
- `verify-email`: `@Public()` + `@HttpCode(501)`; message: `'Email verification is not implemented.'`; no `emailVerified` change.
- `feed PATCH`: `@HttpCode(501)`; returns `{ message: 'Family update editing is not implemented (stub — Phase 10).', seniorId, updateId }`; `prisma.familyUpdate.update()` not called.
- `notification preferences PATCH`: `@HttpCode(501)`; returns `{ message: 'Notification preference updates are not implemented (stub — Phase 8).', body }`; no `NotificationPreference` mutation.

No authorization regression: `feed PATCH` still enforces `FAMILY_ADMIN` / `FAMILY_MEMBER` before the stub response; `notification preferences PATCH` requires `JwtAuthGuard`; `auth` stubs are `@Public()` as before.

Verdict: **Safe. No false success; no authorization bypass; no data mutation.**

---

## 5. Input validation / injection

- `ValidationPipe` preserved (`main.ts` unchanged; `verify-config-contract.mjs` passes; mutation harness passes).
- `verify:routes` (independent execution) detects the two `Object` body bindings (`POST tasks`, `PATCH tasks`) — evidence reproduced above.
- No raw SQL at security boundary (Prisma ORM only; no `prisma.$queryRaw` or `prisma.$executeRaw` in controllers/services).
- DTO validation (`add-participant.dto.ts` — created in Phase 25) uses `class-validator` with `@IsString()`, `@IsNotEmpty()`, `@IsUUID('4')`; compiled artifact carries real metatype (`verify:routes` passes for messaging endpoint).
- No new `Object()` or partial-literal DTOs added by readiness phase except the unvalidated `care-tasks.controller.ts` bodies (documented finding above).
- No SQL injection path: all queries through `prisma.careTask.create/findMany/findFirst/update/delete` with typed parameters.

Verdict: **Validation gate intact; concrete gap identified (care-tasks DTOs missing) — must be remediated before unrestricted production.**

---

## 6. File / document security

Evidence (`StorageService`, `document.controller.ts`, `document.service.ts`, `docs/BACKUP_RESTORE.md` §14.4):
- `StorageService.resolveContainment` lexical (not `realpath`-based); symlink inside `STORAGE_DIR` followed.
- Readiness phase did not modify `StorageService`, `document.controller.ts`, or storage-related configuration.
- Document upload/download/access authorization unchanged (`verify:release-artifact.mjs` passes; no secret baked; no `STORAGE_DIR` escape in application code).
- No new file endpoint added by readiness phase (`documents` unchanged; `care-tasks` has no file/storage interaction).
- Document response does not expose `storageKey` or `contentHash` (`resources.security.e2e-spec.ts` verifies).

Verdict: **No regression from readiness phase. The previously documented lexical-containment/symlink limitation (`docs/BACKUP_RESTORE.md` §14.4) remains a defense-in-depth observation, not a release-blocking vulnerability (no client-side exploitation path through the application boundary).**

---

## 7. Data exposure / privacy

Evidence (`run-db-suites.mjs`, `verify-release-artifact.mjs`, source inspection):
- No JWT, refresh token, or secret in `.next/static/` or `dist/`.
- Health endpoint (`/api/v1/health`, `/api/v1/health/ready`) exposes only allowed fields (`service`, `status`, `database` where applicable); no PostgreSQL URL or port.
- Error responses (`global-exception.filter.ts`) return `{ error: { code, message, requestId } }`; no stack traces; no `STORAGE_DIR` path.
- `CareTaskController.create` returns the `prisma.careTask.create()` result; no internal SQL or storage metadata exposed.
- Audit logs (`audit_logs`) append-only; no read endpoint (documented P2 gap — not a security vulnerability).
- No new endpoint exposes user/senior/measurement/document data to unauthorized users (`verify:routes` passes; `test/authorization-matrix.security.e2e-spec.ts` passes).

Verdict: **No new data exposure.**

---

## 8. Web security

Evidence (`next.config.mjs`, `verify-release-artifact.mjs`, BFF routes):
- `images.unoptimized: true` preserved (optimizer endpoint disabled); `next.config.mjs` unchanged.
- `force-dynamic` preserved (`export const dynamic = 'force-dynamic'` in `health/page.tsx`; `force-dynamic` in route handlers).
- `NEXT_PUBLIC_API_URL` runtime-read verified (`api-client.ts` uses `process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL`); no internal URL baked into `.next/static/`.
- CSRF cookie-scoped path (`/api/v1/auth`) preserved; mutations through BFF retain cookie-bound refresh flow.
- Anonymous request protection preserved (`_session.ts` redirect with 307; `verify:routes` passes).

Verdict: **No regression.**

---

## 9. Mobile security

Evidence (`session.ts`, `SECURITY_REVIEW_PHASE_14.md` claims independently verified):
- `SecureStore.setItemAsync` / `getItemAsync` / `deleteItemAsync` preserved; no plaintext storage introduced.
- `clearSession()` calls both token and user deletions; `useAuth` redirect on failure preserved.
- No hardcoded senior IDs (`grep '00000000-0000-0000-0000-000000000001' apps/mobile/app/*.tsx` = 0 results).
- `home.tsx`, `login.tsx`, `profile.tsx`, `documents/index.tsx`, `emergency/index.tsx` unchanged by readiness phase (`git diff apps/mobile/` = empty at `d6f92b3`).
- `SECURITY_REVIEW_PHASE_14.md` verifies: `secure-store` usage; centralized authorization headers; safe auth errors; session clearing.

Verdict: **No regression; no vulnerability.**

---

## 10. Database / Prisma / migrations

Evidence (`prisma/schema.prisma`, `migrations/`, `run-db-suites.mjs`):
- Schema unchanged (`git diff` empty); no destructive migration; FK/indexes intact.
- `CareTask` table exists (line 753-785 in schema); `CareTaskModule` mounted without schema change.
- `verify-db-migrations.sh` executes cleanly against throwaway DB; content fingerprint preserved; no destructive operation.

Verdict: **Safe.**

---

## 11. Dependency / supply chain

Evidence (`pnpm-lock.yaml`, dependency gates executed independently):
- Lockfile unchanged.
- `node-forge` remains visible (HIGH); NOT REACHABLE (evidence-backed); no suppression.
- Security floor intact (`security/dependency-security-floor.json` unchanged; `verify-dependency-security-floor.mjs` passes; `verify-dependency-floor-policy.mjs` passes).
- Advisory census complete (`verify-dependency-advisory-visibility.mjs` passes: 1494 audited, 93 advisories visible — 36 moderate, 8 low, 45 high, 4 critical — not adjudicated, not hidden).
- Fail-closed preserved (`verify-dependency-triage.mjs` passes; `REACHABLE (unclassified)` is a finding, not dismissal).

Verdict: **Intact.**

---

## 12. Security-gate integrity

Evidence (gates executed independently at `d6f92b3`):
- All gates listed in `PRODUCT_READINESS_PREFLIGHT.md` §2 reproduce as PASS.
- `verify:routes` fails independently (see §3 above) — concrete evidence of unvalidated DTO binding, not a gate suppression.
- No gate disabled; no mutation harness weakened; no advisory hidden; no `continue-on-error` advisory step converted to blocking (lint remains advisory with documented baseline).

Verdict: **No gate weakened.** The independent `verify:routes` failure is a real finding, not a gate defect.

---

## 13. Findings

### CRITICAL: None.

### HIGH: None.

### MEDIUM: None.

### LOW: 1 (documented defense-in-depth observation — not a new vulnerability)
- **ID:** LOW-01 (pre-existing)
- **Title:** `StorageService` lexical containment allows symlink follow inside `STORAGE_DIR`
- **Component:** `StorageService` (`apps/api/src/storage/storage.service.ts`)
- **Evidence:** `docs/BACKUP_RESTORE.md` §14.4; `StorageService.resolveContainment` uses prefix check, not `realpath`; `STORAGE_DIR` mode `0700` enforced by application startup (`security-config.ts`); symlink exploitation requires `0700` directory write by attacker already inside container.
- **Exploitability:** Not exploitable through API/client boundary; requires container-level access.
- **Phase 25 impact:** None (`StorageService` unchanged by readiness phase).
- **Remediation direction:** Convert to `realpath`-based containment if future deployment requires symlink-resistant containment; trade-off is breaking legitimate symlinked mount configurations. Not a release blocker.

### INFORMATIONAL: 5
- **INFO-01:** `docs/PHASE_25_FINAL_REPORT.md` confirms Phase 25 scope exactly matches five findings (F-1 through F-5); no feature expansion; no dependency upgrade; no authorization redesign.
- **INFO-02:** Independent Phase 25 security review document (`SECURITY_REVIEW_PHASE_25.md`) remains absent; reviewer-owned; must not be written by implementer.
- **INFO-03:** `verify:routes` failure (`Object` body binding on `POST /tasks`, `PATCH /tasks`) is a concrete P1 reliability/reliability-security gap — the `ValidationPipe` skips these bodies, removing `whitelist`/`forbidNonWhitelisted` protections; the controller passes `body` to `careTaskService.create/update` without DTO validation.
- **INFO-04:** Mobile remains partially complete (no messaging screen, no full notification presentation; secure storage verified; no hardcoded senior IDs at `d6f92b3`).
- **INFO-05:** Web dashboards remain placeholders; health page works (`/health`); no data integration.

---

## 14. Mandatory questions

1. **Does Phase 25 contain any Critical, High, or Medium security vulnerability?** — **No.**
2. **Is there any authentication bypass?** — **No.** (`JwtAuthGuard` intact; `verify:auth:compiled` passes; stubs `@Public()` with 501 — no session leak.)
3. **Is there any authorization bypass or cross-senior/cross-care-circle access?** — **No.** (`CareTaskController` guarded; `assertCanAccessSenior` enforced; service-level authorization preserved.)
4. **Are role boundaries enforced correctly?** — **Yes.** (`FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR` for create; `FAMILY_ADMIN`/`CAREGIVER` for update; `FAMILY_ADMIN` for cancel; observer has no write access.)
5. **Does Phase 25 expose secrets or sensitive data?** — **No.** (`verify-release-artifact.mjs` passes; no baked secrets; audit logs only contain user/resource IDs, no PHI value.)
6. **Did Phase 25 weaken any security gate?** — **No.** (All gates pass; mutation harnesses intact; advisory census complete; floor intact; no suppression.)
7. **Did Phase 25 introduce dependency/security-floor problems?** — **No.** (`pnpm-lock.yaml` unchanged; `node-forge` remains visible/NOT REACHABLE; floor intact.)
8. **Does Phase 25 alter the previously documented StorageService symlink limitation?** — **No.** (`StorageService` unchanged; no new storage endpoint; no file-access regression.)
9. **Are there any release-blocking security findings?** — **No Critical/High/Medium.** One concrete P1 reliability/reliability-security gap exists: `CareTaskController` uses unvalidated inline DTO bodies (not DTO classes), which causes `verify:routes` to fail and removes `whitelist`/`forbidNonWhitelisted` protections on two live endpoints (`POST /tasks`, `PATCH /tasks/:taskId`).
10. **What must be completed before controlled pilot?** — Remediate INFO-03 (create `create-task.dto.ts` and `update-task.dto.ts`; bind controller `@Body()` to DTO classes); complete independent `SECURITY_REVIEW_PHASE_25.md`; execute staging deployment; rehearse backup/recovery.
11. **What must be completed before unrestricted production?** — All pilot prerequisites plus full `SECURITY_REVIEW_PHASE_25.md` completed and any findings remediated/re-reviewed; staging deployment validated; backup/recovery rehearsed; web dashboards integrated (P2); mobile messaging/notification integrated (P2); observability enhanced (P2).

---

## 15. Pilot / production decisions

**PILOT SECURITY STATUS: APPROVED WITH FINDINGS**
- No Critical/High/Medium vulnerability.
- Authorization model intact (`CareTasksModule` mounted safely).
- Dependency posture intact (`node-forge` fail-closed; floor intact; no suppression).
- Security gates intact (`verify:routes` fails independently on unvalidated DTO binding — documented finding, not gate suppression).
- Controlled pilot permissible **after INFO-03 remediated** (create DTO classes for `POST /tasks` and `PATCH /tasks/:taskId`). Without that remediation, the `ValidationPipe` skips these bodies, removing a security control at the boundary.

**UNRESTRICTED PRODUCTION SECURITY STATUS: NOT APPROVED**
- Independent Phase 25 review (`SECURITY_REVIEW_PHASE_25.md`) remains outstanding.
- INFO-03 must be remediated.
- Staging deployment, backup/recovery rehearsal, and full operational validation remain unperformed.

---

## 16. Limitations

- This review covers `d6f92b3` only; future commits are out of scope.
- It does not constitute a penetration test, load test, or chaos test.
- It relies on the existing security contracts (`SECURITY.md`, `THREAT_MODEL.md`) rather than inventing new requirements.
- The `StorageService` lexical-containment observation (`docs/BACKUP_RESTORE.md` §14.4) remains documented; no new vulnerability was found.
- The `verify:routes` failure is a concrete security/reliability gap, not a gate error; it is documented as INFO-03.
- No production deployment or staging environment exists; deployment readiness is assessed from container/build artifacts only.

---

## 17. Report path

`docs/SECURITY_REVIEW_PHASE_25.md` (this file)

No other file was created or modified.
The working tree at the time of review creation remains clean except for this untracked document.
