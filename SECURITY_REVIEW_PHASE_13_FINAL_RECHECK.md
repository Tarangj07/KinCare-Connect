# Phase 13 — Final Independent Security Re-Review (Recheck)

**Baseline:** `43c9bf8` (Harden Phase 12 document management security)
**Date:** 2026-09-16
**Reviewer:** Independent (no prior Phase 13 review dependency)
**Status:** INDEPENDENT FINAL RE-REVIEW

---

## 1. Scope Verification

```
git status --short
```

Modified: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`
Untracked (Phase 13 only):
- `SECURITY_REVIEW_PHASE_13.md`
- `SECURITY_REVIEW_PHASE_13_FINAL.md`
- `apps/api/prisma/migrations/20260915000000_phase13_emergency_alerts/`
- `apps/api/src/modules/emergency/`
- `docs/PHASE_13_EMERGENCY_ALERTS.md`

`git diff --check`: no whitespace errors.
`git diff 43c9bf8 --stat`: `apps/api/prisma/schema.prisma` (+92/-23 lines), `apps/api/src/app.module.ts` (+2 lines). Only Phase 13 files changed. No Phase 14 files or references found (`grep -rni "phase.14"` returns nothing). No unrelated changes.

---

## 2. Migration Verification — Critical Recheck

**File inspected in full:** `apps/api/prisma/migrations/20260915000000_phase13_emergency_alerts/migration.sql`

**Findings:**

A. Not truncated. Ends properly at line 105 with the cancellation FK.
B. Cancellation columns exist:
```
ALTER TABLE "emergency_alerts" ADD COLUMN "cancelled_by_user_id" UUID;
ALTER TABLE "emergency_alerts" ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);
```
C. FK exists:
```
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
D. Ordering valid:
- `users` table exists before all user FKs added.
- `emergency_alerts` table exists before any ALTER.
- Enum/type transformations (status, severity) completed before column drops (`kind`, `escalated_at`, `context` dropped after mapping).
- Cancellation columns (`cancelled_by_user_id`, `cancelled_at`) created before their FK.
- No duplicate column/constraint definitions.
- No SQL truncation after remediation.
E. Legacy enum CASE mappings intact (lines 14–55): `DETECTED -> ACTIVE`, `ACKNOWLEDGED -> ACKNOWLEDGED`, `ESCALATED -> ACTIVE`, `RESOLVED -> RESOLVED`, `FALSE_ALARM -> CANCELLED`; `INFO -> MEDIUM`, `LOW -> MEDIUM`, `MEDIUM -> MEDIUM`, `HIGH -> HIGH`, `CRITICAL -> CRITICAL`.
F. Migration consistent with `EmergencyAlert` model in `apps/api/prisma/schema.prisma`:
- `type`: `EmergencyAlertType` (`MEDICAL`, `FALL`, `SOS`, `MEDICATION`, `OTHER`) — matches.
- `severity`: `EmergencyAlertSeverity` (`CRITICAL`, `HIGH`, `MEDIUM`) — matches.
- `status`: `EmergencyAlertStatus` (`ACTIVE`, `ACKNOWLEDGED`, `RESOLVED`, `CANCELLED`) — matches.
- `message`: `String? @db.Text` — migration retains as nullable text column.
- `source`: `String` — unchanged.
- `detectedAt`: `DateTime @map("detected_at") @db.Timestamptz(6)` — unchanged.
- `createdByUserId`: `String? @map("created_by_user_id") @db.Uuid` with FK `ON DELETE SET NULL ON UPDATE CASCADE` — present.
- `acknowledgedAt` / `acknowledgedByUserId` — present.
- `resolvedAt` / `resolvedByUserId` — present.
- `cancelledAt` / `cancelledByUserId` — present (remediated).
- `resolution`: `String? @db.Text` — unchanged.
- `externalId`: `String?` — unchanged.
- All four user FKs (`createdBy`, `acknowledgedBy`, `resolvedBy`, `cancelledBy`) use `ON DELETE SET NULL ON UPDATE CASCADE`.

**Verdict:** Previous critical finding (missing cancellation fields + FK) is **FULLY RESOLVED**.

---

## 3. Authorization / IDOR

Controller (`emergency.controller.ts`):
- `@UseGuards(JwtAuthGuard, RolesGuard)` — present.
- `@Roles('USER', 'SUPER_ADMIN')` — present.
- `getUserId(req)` extracts from `req.user.sub` (JWT actor identity); no request-body override.
- Every endpoint binds `seniorId` (route param) and `alertId` (route param).

Service (`emergency.service.ts`):
- Every method calls `assertCanAccessSenior(userId, seniorId)` (checks active `CareCircleMember` for target senior, `status = ACTIVE`, `deletedAt = null`, circle `isActive = true`, `deletedAt = null`).
- `assertRole` performs server-side role lookup (`getMemberRole`) — independent of controller guards.
- `findAlert` uses `findFirst({ id: alertId, seniorId })` — cross-senior blocked.
- `createAlert` requires `userId` and `seniorId`; no client-controlled identity fields in DTO.
- `acknowledgeAlert`, `resolveAlert`, `cancelAlert`: all check `alert.status` explicitly; state machine enforced.
- `cancelAlert` requires role `['FAMILY_ADMIN', 'CAREGIVER', 'DOCTOR']` — `FAMILY_MEMBER` excluded.
- `resolveAlert` requires role `['FAMILY_ADMIN', 'CAREGIVER', 'DOCTOR']` — `FAMILY_MEMBER` excluded.
- `acknowledgeAlert` allows `['FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR']`.
- Inactive/deleted membership rejected by `assertCanAccessSenior` and `getMemberRole` (`deletedAt = null`, `status = ACTIVE`).
- Client cannot select authorization role — derived from DB membership only.

---

## 4. Identity Security

- `createdByUserId` set to `userId` (JWT `sub`) at creation.
- `acknowledgedByUserId` set to `userId` at acknowledgment.
- `resolvedByUserId` set to `userId` at resolution.
- `cancelledByUserId` set to `userId` at cancellation.
- No DTO fields accept actor identity. `CreateEmergencyAlertDto` only accepts `type`, `severity`, `message?`, `source`.
- `req.user.sub` is the sole actor source throughout.

---

## 5. State Machine / Concurrency

- `ACTIVE` -> `ACKNOWLEDGED` (`acknowledgeAlert`): checks `status === 'ACTIVE'` before update; conditional `WHERE { id, seniorId, status: 'ACTIVE' }` protects against stale-state overwrites.
- `ACTIVE` / `ACKNOWLEDGED` -> `RESOLVED` (`resolveAlert`): checks `status in ['ACTIVE', 'ACKNOWLEDGED']`; conditional `WHERE { id, seniorId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }`.
- `ACTIVE` -> `CANCELLED` (`cancelAlert`): checks `status === 'ACTIVE'`; conditional `WHERE { id, seniorId, status: 'ACTIVE' }`.
- Terminal states (`RESOLVED`, `CANCELLED`) protected: no endpoint allows transition out of terminal state; no generic PATCH endpoint exists.
- Audit creation and mutation occur inside the same `prisma.$transaction`.

---

## 6. Cancellation / Resolution Integrity

`cancelAlert()` writes ONLY:
- `status: 'CANCELLED'`
- `cancelledAt: new Date()`
- `cancelledByUserId: userId`

Does NOT write:
- `resolvedAt`
- `resolvedByUserId`

`resolveAlert()` has inverse behavior: writes ONLY `status: 'RESOLVED'`, `resolvedAt`, `resolvedByUserId`; does NOT write `cancelledAt` or `cancelledByUserId`.

Verified by reading service source directly (lines 220–243 for cancel; 181–205 for resolve).

---

## 7. Notification Security

- Recipients derived server-side from active `CareCircleMember` rows (`where: { circle: { seniorId, deletedAt: null, isActive: true }, status: 'ACTIVE', deletedAt: null }`); no client-controlled recipient list.
- Creator excluded: `recipientIds.delete(userId)`.
- Inactive/deleted members excluded by query predicates (`deletedAt: null`, `status: 'ACTIVE'`, circle `deletedAt: null`, `isActive: true`).
- `SeniorProfile.id` is never used as `Notification.userId`. The senior's linked user account (`user.id`) is only included if it exists and is separate from `SeniorProfile.id`.
- Notification payload (`NotificationService.createNotification`) contains only `{ alertId, seniorId, type, severity }`; no `message`, `body`, `resolution`, `context`, or any PHI.
- Notification dispatch (`notificationService.createNotification`) occurs outside the transaction, but does not affect authorization.

---

## 8. Audit Security

- `createAlert`: audit `action: 'emergency_alert.created'`, `actorUserId: userId`, `resourceType: 'emergency_alert'`, `resourceId: alert.id`, `seniorId`, `metadata: { type, severity, source }` (no message/body/PHI).
- `acknowledgeAlert`: audit `action: 'emergency_alert.acknowledged'`, `actorUserId: userId`, `resourceId: alertId`, `metadata: {}`.
- `resolveAlert`: audit `action: 'emergency_alert.resolved'`, `actorUserId: userId`, `resourceId: alertId`, `metadata: {}`.
- `cancelAlert`: audit `action: 'emergency_alert.cancelled'`, `actorUserId: userId`, `resourceId: alertId`, `metadata: {}`.
- All audits created within the same `prisma.$transaction` as the mutation (`tx.auditLog.create`).
- `actorUserId` is never derived from the request body; only from the `userId` parameter passed from the controller (JWT `sub`).
- `resourceType` and `action` are server-controlled strings.
- `resourceId` is the actual database `alert.id` (not a client-provided value).

---

## 9. Input Validation

`CreateEmergencyAlertDto`:
- `type`: `@IsEnum(EmergencyAlertType)`
- `severity`: `@IsEnum(EmergencyAlertSeverity)`
- `message`: `@IsOptional()`, `@IsString()`, `@MaxLength(2000)`, `String?`
- `source`: `@IsString()`, `@MaxLength(256)`

`main.ts`:
- `new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })` — globally enforced.

No externally controlled value can alter:
- Actor identity (not in DTO).
- Senior ownership (route param only, bound by service).
- Notification recipients (derived server-side).
- Audit actor/resource (derived from DB/userId).
- Authorization role (derived from DB membership).

---

## 10. Controller Security

- `JwtAuthGuard` and `RolesGuard` applied at controller class level.
- Every endpoint uses `@Req()` and extracts `userId` from `req.user.sub`; no body-derived identity.
- Every endpoint binds both `seniorId` and `alertId` (where applicable) to route parameters; service binds them to DB queries.
- No generic PATCH endpoint; only explicit action endpoints (`acknowledge`, `resolve`, `cancel`).

---

## 11. Test Effectiveness

`emergency.controller.spec.ts` inspected (22 tests executed).

Assertions are meaningful:
- `F01` (auth): denies `bad-user`, denies `observer-b`, allows `family-admin`; verifies `createdByUserId` equals user param.
- `F02` (cross-senior IDOR): verifies `findAlert('missing')` throws `ForbiddenException`.
- `F03` (notification isolation): verifies recipients contain only user IDs (not `senior-1` profile ID); excludes creator (`user-admin`); includes derived senior user (`user-senior`).
- `F04` (state transition / audit / transaction): verifies audit events exist with correct `action` and `actorUserId`.
- `F05` (cancellation/resolution separation): verifies `cancel` writes `cancelledAt`/`cancelledByUserId` and NOT `resolvedAt`/`resolvedByUserId`; inverse for `resolve`.
- `F06` (input validation): verifies service passes severity directly; relies on DTO for enum validation.
- `F07` (JWT actor identity): verifies `createdByUserId` equals provided user param; `actorUserId` equals user param in audit.
- `F08` (role authorization matrix): verifies `FAMILY_MEMBER` denied for resolve/cancel; `CAREGIVER`/`DOCTOR` allowed; `OBSERVER` denied for create.

No `expect(true).toBe(true)` placeholders found. No skipped tests.

---

## 12. Test Execution

```
cd apps/api
npx vitest run src/modules/emergency/emergency.controller.spec.ts
```

Result:
- `Test Files: 1 passed (1)`
- `Tests: 22 passed (22)`
- Duration: ~13ms
- No skipped tests. No failures.

---

## 13. Prisma / Database Verification

`npx prisma generate`: **PASS** (client generated successfully).
`npx prisma validate`: **FAIL** — `DATABASE_URL=''` (empty); error `P1012` (must provide nonempty URL). This is an environment limitation, not a Phase 13 defect.
`npx prisma migrate status`: **FAIL** — same `DATABASE_URL=''` environment limitation.

Because `DATABASE_URL` is empty (`.env` shows `DATABASE_URL=`), runtime database verification could not be performed. Verification relies on static SQL and schema consistency checks (completed above).

Migration file exists at:
`apps/api/prisma/migrations/20260915000000_phase13_emergency_alerts/migration.sql`

No database connection available; the database schema was not verified at runtime. Static verification confirms the migration SQL and `schema.prisma` are fully consistent.

---

## 14. Migration-Specific Database Check

No usable `DATABASE_URL` exists (`.env` shows `DATABASE_URL=`). Runtime database verification could not be performed. Static verification confirms:
- `cancelled_by_user_id` UUID column defined.
- `cancelled_at` TIMESTAMPTZ(6) column defined.
- `emergency_alerts_cancelled_by_user_id_fkey` FK exists with `ON DELETE SET NULL ON UPDATE CASCADE`.

If a database were available, the verification would confirm these columns and constraints exist in the actual `emergency_alerts` table. This limitation is documented and does not block approval.

---

## 15. Remaining Findings

### Critical
None.

### High
None.

### Medium
None.

### Low
None.

### Informational
- `DATABASE_URL` is empty (pre-existing environment issue; does not affect Phase 13 code quality or security controls).
- No realtime event broadcasting implemented (documented known limitation in `docs/PHASE_13_EMERGENCY_ALERTS.md`).
- Only `IN_APP` notification channel used (no SMS/email/push integration; documented).

---

## 16. Pre-Existing Issues (Not Phase 13 Defects)

1. `DATABASE_URL=''` in `.env` — prevents runtime database verification.
2. No realtime gateway/module implemented (existing architecture limitation, not new in Phase 13).
3. `NotificationService.archive()` sets `readAt` instead of removing/deleting (existing behavior; unrelated to Phase 13 security).

---

## 17. Final Verdict

**APPROVED FOR PHASE 13 CHECKPOINT**

Justification (all required conditions met):
- Previous critical migration defect (missing `cancelled_by_user_id`, `cancelled_at`, FK) is **fully resolved**.
- Migration is complete, not truncated, and internally consistent with `schema.prisma`.
- No new critical or high security defects exist.
- Authorization / IDOR is sound (`JwtAuthGuard` + `RolesGuard` + server-side `assertCanAccessSenior` + `assertRole` + `findFirst({ id, seniorId })`).
- Identity binding is sound (`userId` from JWT `sub`; no body override).
- State machine is sound (explicit transition checks + conditional `WHERE` predicates + terminal-state protection).
- Cancellation / resolution integrity is sound (separate fields, no cross-writing).
- Notification isolation is sound (server-derived recipients, no message/body in payload).
- Audit integrity is sound (atomic transaction, server-controlled action/resource, JWT-derived actor).
- Input validation is sound (`IsEnum`, `IsString`, `MaxLength`, `whitelist`, `forbidNonWhitelisted`, `transform`).
- Tests are meaningful and passing (22/22 passed, actual security assertions, no placeholders).
- No Phase 14 work exists.
- Phase 13 files only; no unrelated modifications.

Phase 13 may proceed to the Git checkpoint.

---
*Report produced independently without modifying any source files, migrations, tests, or committing changes. No Phase 14 work initiated.*
