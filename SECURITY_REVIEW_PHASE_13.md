# Security Review — Phase 13: Emergency Alerts

Status: REVIEW ONLY — NO MODIFICATIONS MADE
Checkpoint: 43c9bf8 (Hard Phase 12)
Phase 13 working tree: uncommitted
Review date: 2026-09-15

---

## 1. Executive Summary

Phase 13 introduces an emergency-alert REST API (`EmergencyModule`) backed by a revised `EmergencyAlert` Prisma model and a destructive schema migration. The authorization architecture relies on the existing `AuthorizationService` (`assertCanAccessSenior`, `getMemberRole`) linked to `CareCircleMember` / `SeniorProfile` / `CareCircle` state checks. The controller uses `JwtAuthGuard` but does NOT use `RolesGuard`; authorization is enforced exclusively in the service layer.

**Verdict: NOT APPROVED**

Key blockers:
- The schema migration is destructive (`kind`, `context`, `escalated_at` dropped; `DETECTED`/`ESCALATED`/`FALSE_ALARM`/`INFO` enum values removed) with no data migration. Running against an existing database with old enum values will fail.
- The `cancel` endpoint incorrectly writes `resolvedAt` and `resolvedByUserId` (same fields as `resolve`) instead of cancellation-specific fields, corrupting audit/state semantics.
- Notification recipient derivation uses `select: { userId: true, seniorId: true }` and inserts both IDs into a `Notification.userId` column that references the `users` table. A `CareCircleMember` with only `seniorId` set (no matching `userId`) will attempt to insert a `SeniorProfile.id` value into `Notification.userId`, violating the FK constraint or notifying the wrong user.
- Test coverage is structural only (`expect(true).toBe(true)`) and provides no effective security verification.

No Phase 14 work, mobile UI, web dashboard, AI, realtime architecture, external providers, or unrelated refactoring was introduced.

---

## 2. Phase 13 Scope Verification

Verified by `git status` and file inspection:

- `apps/api/src/app.module.ts`: imports `EmergencyModule` only.
- `docs/PHASE_13_EMERGENCY_ALERTS.md`: confirms no mobile UI, web dashboard, realtime gateway, SMS/email/push providers, AI, external emergency service integration, or new realtime architecture.
- Source files present: `emergency.controller.ts`, `emergency.service.ts`, `emergency.module.ts`, `create-emergency-alert.dto.ts`, `emergency.controller.spec.ts`, `docs/PHASE_13_EMERGENCY_ALERTS.md`, plus the Prisma migration.
- No modifications outside Phase 13 scope detected in the working tree.

---

## 3. Security Findings

### F-01: Deletion / Migration Failure — HIGH
- File: `apps/api/prisma/migrations/20260915000000_phase13_emergency_alerts/migration.sql`
- Severity: **HIGH**
- Evidence: Migration alters `EmergencyAlertStatus` using:
  `ALTER TABLE ... TYPE "EmergencyAlertStatus_new" USING ("status"::text::"EmergencyAlertStatus_new");`
  Old values (`DETECTED`, `ESCALATED`, `FALSE_ALARM`) are not mapped. Old severity value `INFO` is removed. Columns `context`, `escalated_at`, `kind` are dropped with `DROP COLUMN` and no backup/data migration.
- Impact: If the production/development database contains any rows with the removed enum values, the migration will abort with `invalid input value for enum` errors. The migration is unrecoverable without a manual data-fix script. Dropping `context` deletes structured alert data permanently.
- Remediation: Before applying, add an explicit data-migration block that maps old enum values to new ones (`DETECTED` -> `ACTIVE`, `ESCALATED` -> `ACTIVE` or `RESOLVED`, `FALSE_ALARM` -> `CANCELLED`, `INFO` -> `MEDIUM` or similar), and archive/drop `context` only after confirming it is no longer needed. Confirm with production-like data.

### F-02: Cancel Endpoint Corrupts Audit / Resolution Fields — HIGH
- File: `apps/api/src/modules/emergency/services/emergency.service.ts` (line 201–203)
- Severity: **HIGH**
- Evidence: `cancelAlert` executes:
  ```typescript
  data: {
    status: 'CANCELLED',
    resolvedAt: new Date(),
    resolvedByUserId: userId,
  }
  ```
  This writes `resolvedAt` and `resolvedByUserId` instead of cancellation-specific fields (there are none in the schema). The docs (`PHASE_13_EMERGENCY_ALERTS.md` §12) incorrectly document this as intended (`Response: updated alert (status: CANCELLED, resolvedAt, resolvedByUserId)`).
- Impact: A cancelled alert is indistinguishable from a resolved alert at the data layer (`resolvedAt`/`resolvedByUserId` populated, `status` different). Audit logs say `cancelled` but the database fields say `resolved`. This corrupts audit/state integrity.
- Remediation: Add `cancelledAt` / `cancelledByUserId` columns (or rename/reuse existing ones exclusively for cancellation) and update the service and docs.

### F-03: Notification Recipient Derivation Violates FK / Cross-User Risk — MEDIUM
- File: `apps/api/src/modules/emergency/services/emergency.service.ts` (line 62–87)
- Severity: **MEDIUM**
- Evidence: Member selection:
  ```typescript
  select: { userId: true, seniorId: true }
  ```
  Both `userId` and `seniorId` are inserted into `Notification.userId` (references `users.id`). A `CareCircleMember` can have `userId = null` and `seniorId = <SeniorProfile.id>`. Inserting a `SeniorProfile.id` UUID into `Notification.userId` will either:
  1) Fail with FK violation (`users.id` does not exist), or
  2) Accidentally match an unrelated `users.id` UUID and notify the wrong user.
- Impact: Notification delivery failure or cross-user notification leakage.
- Remediation: Filter members to `userId` only (`select: { userId: true }`) or ensure `NotificationService.createNotification` accepts both user IDs and senior IDs safely (but the `Notification` model requires `userId`). If notifying the senior themselves is required, resolve the senior's linked `User` account first.

### F-04: Controller Missing Role Guards (Defense-in-Depth Gap) — MEDIUM
- File: `emergency.controller.ts`
- Severity: **MEDIUM**
- Evidence: Controller uses only `@UseGuards(JwtAuthGuard)`. Other modules (`feed`, `messaging`, `medications`, `documents`, `notifications`, etc.) use `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles(...)` decorators. Phase 13 relies entirely on service-level `assertRole`.
- Impact: If a service-level authorization check is accidentally removed or bypassed (e.g., via a future refactor), no controller-level guard prevents the request.
- Remediation: Add `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` decorators to controller endpoints, matching the service-level role matrix.

### F-05: Audit Creation Not Atomic with Alert Update (Race / Integrity) — MEDIUM
- File: `emergency.service.ts`
- Severity: **MEDIUM**
- Evidence: In `acknowledgeAlert`, `resolveAlert`, and `cancelAlert`, the Prisma `update` and `auditLog.create` are separate, non-transactional calls. If the update succeeds and the audit insert fails (DB connection drop, constraint error, etc.), the alert state changes but no audit record exists.
- Impact: State change without audit trail; potential for undetected state manipulation if combined with other failures.
- Remediation: Wrap the update and audit creation in a Prisma interactive transaction (`$transaction`).

### F-06: Notification Payload Lacks Message, But No Security Violation — LOW / INFO
- File: `emergency.service.ts` (line 83)
- Severity: **INFO**
- Evidence: Notification payload is `{ alertId, seniorId, type, severity }`. No `message`, `resolution`, or internal IDs leaked. No client-controlled recipient list accepted.
- Impact: None; this is a correct security boundary.
- Note: Confirm notification is NOT treated as authorization (confirmed by endpoint authorization checks).

---

## 4. Authorization Matrix

Verified by inspecting `emergency.service.ts` (`assertRole` calls) and `authorization.service.ts` (`getMemberRole`, `assertCanAccessSenior`).

| Action         | FAMILY_ADMIN | FAMILY_MEMBER | OBSERVER | CAREGIVER | DOCTOR |
|----------------|-------------|---------------|----------|-----------|--------|
| Create         | ALLOWED     | ALLOWED       | DENIED   | ALLOWED   | ALLOWED |
| List / Get     | ALLOWED     | ALLOWED       | ALLOWED  | ALLOWED   | ALLOWED |
| Acknowledge    | ALLOWED     | ALLOWED       | DENIED   | ALLOWED   | ALLOWED |
| Resolve        | ALLOWED     | DENIED        | DENIED   | ALLOWED   | ALLOWED |
| Cancel         | ALLOWED     | DENIED        | DENIED   | ALLOWED   | ALLOWED |

Observations:
- `assertCanAccessSenior` requires an active `CareCircleMember` (`status = ACTIVE`, `deletedAt = null`) within an active `CareCircle` (`isActive = true`, `deletedAt = null`) for the target `seniorId`. Deleted/inactive members and deleted/inactive circles correctly deny access.
- `getMemberRole` checks `SeniorProfile.isActive` and `deletedAt`. A deleted or inactive senior profile will return `null`, denying access.
- `assertRole` is called after `assertCanAccessSenior` for create, acknowledge, resolve, cancel. `findAlerts` and `findAlert` call `assertCanAccessSenior` only (any active member, including `OBSERVER`, can list/get). This matches the docs.
- The controller does NOT use `@Roles()`; the matrix above is enforced only in service code. This is sufficient but lacks controller-level defense in depth (see F-04).

---

## 5. State Machine Review

Documented machine (`docs/PHASE_13_EMERGENCY_ALERTS.md` §4):

```
ACTIVE -> ACKNOWLEDGED -> RESOLVED
ACTIVE -> RESOLVED
ACTIVE -> CANCELLED
```

Verified in `emergency.service.ts`:

- `acknowledgeAlert`: requires `status === 'ACTIVE'`; updates to `ACKNOWLEDGED` with `where: { id: alertId, seniorId, status: 'ACTIVE' }`. Correct.
- `resolveAlert`: allows `ACTIVE` or `ACKNOWLEDGED`; updates to `RESOLVED` with `where: { id: alertId, seniorId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }`. Correct.
- `cancelAlert`: requires `status === 'ACTIVE'`; updates to `CANCELLED` with `where: { id: alertId, seniorId, status: 'ACTIVE' }`. Correct.
- Terminal states (`RESOLVED`, `CANCELLED`) are protected: no endpoint allows transition from terminal states, and the conditional `WHERE` clause ensures no database-level stale-state overwrite.
- Concurrent requests: two simultaneous acknowledgements will result in the first succeeding and the second failing the `WHERE status = 'ACTIVE'` condition (Prisma will return `0` updated records; the service does not explicitly check `prisma.emergencyAlert.update` return value or throw on zero updates). This is a minor gap: if the update returns nothing, the service continues to audit creation and returns the original un-updated record? Actually, `prisma.emergencyAlert.update` throws if the record is not found / conditions not met. So concurrent updates result in exceptions, which is safe (no invalid state transition), but the exception is not explicitly handled (see F-10).

---

## 6. IDOR / BOLA Review

Verified in `emergency.service.ts`:

- `createAlert`: binds `seniorId` (route param) to database insert. `userId` comes from JWT (`req.user.sub`). No `alertId` involved.
- `findAlerts`: query is `where: { seniorId }`. Only returns alerts for the route senior.
- `findAlert`: `findFirst({ id: alertId, seniorId })`. If not found, throws `ForbiddenException`. This prevents access to alerts belonging to another senior.
- `acknowledgeAlert`: `findFirst({ id: alertId, seniorId })` then conditional `update({ where: { id: alertId, seniorId, status: 'ACTIVE' } })`.
- `resolveAlert`: `findFirst({ id: alertId, seniorId })` then conditional `update({ where: { id: alertId, seniorId, status: { in: ... } } })`.
- `cancelAlert`: `findFirst({ id: alertId, seniorId })` then conditional `update({ where: { id: alertId, seniorId, status: 'ACTIVE' } })`.

No `findFirst({ id: alertId })` without `seniorId` exists. No authorization performed after sensitive data retrieval (authorization is the first call in each method). Cross-circle access is blocked by `assertCanAccessSenior` (requires active `CareCircleMember` for the exact `seniorId`).

Note: `findAlert` throws `ForbiddenException('Alert not found for this senior.')` rather than `NotFoundException`. This avoids leaking whether the alert exists at all (404 vs 403 ambiguity), which is a positive security property.

---

## 7. Notification Security Review

Verified:
- Recipients derived server-side from `prisma.careCircleMember.findMany` with `circle: { seniorId, deletedAt: null, isActive: true }` and `status: 'ACTIVE'`, `deletedAt: null`.
- No client-supplied recipient list accepted.
- Creator excluded (`recipientIds.delete(userId)`).
- Payload (`NotificationService.createNotification`) is `{ alertId, seniorId, type, severity }` only. No `message`, `resolution`, or sensitive text included.
- Notification is `IN_APP` channel only. No external SMS/email/push providers added.
- Notification is NOT treated as authorization; endpoints independently enforce authorization.

Issue: Recipient derivation includes `m.seniorId` (see F-03), which can violate the `Notification.userId` FK constraint or send to wrong user.

---

## 8. Audit Security Review

Verified (`prisma.auditLog.create` calls in `createAlert`, `acknowledgeAlert`, `resolveAlert`, `cancelAlert`):

- `actorUserId`: set to `userId` (from JWT `sub`). Not client-controlled.
- `actorType`: `'USER'` (hardcoded).
- `action`: hardcoded strings (`emergency_alert.created`, `.acknowledged`, `.resolved`, `.cancelled`). Not from request body.
- `resourceType`: `'emergency_alert'` (hardcoded).
- `resourceId`: `alert.id` (server-derived).
- `seniorId`: route `seniorId` (server-bound).
- `metadata`: for creation: `{ type, severity, source }`. For transitions: `{}`. No message/body/text included. No JWT tokens included. No arbitrary attacker-controlled data accepted.

No `actorUserId` or `action` fields are accepted from request DTO (`CreateEmergencyAlertDto` does not declare them; `whitelist: true` and `forbidNonWhitelisted: true` in `ValidationPipe` rejects extra properties).

Audit creation is not atomic with state change (see F-05). If audit creation fails, the state change succeeds without audit.

---

## 9. Migration / Data Integrity Review

Verified migration SQL (`20260915000000_phase13_emergency_alerts/migration.sql`):

- `EmergencyAlertStatus` changed from `DETECTED`, `ACKNOWLEDGED`, `ESCALATED`, `RESOLVED`, `FALSE_ALARM` to `ACTIVE`, `ACKNOWLEDGED`, `RESOLVED`, `CANCELLED`.
- `EmergencyAlertSeverity` changed from `INFO`, `LOW`, `MEDIUM`, `HIGH` to `CRITICAL`, `HIGH`, `MEDIUM` (`INFO` and `LOW` removed).
- Columns `kind` (String), `context` (Json?), `escalated_at` (DateTime?) dropped.
- Columns `type` (new enum), `created_by_user_id`, `resolved_by_user_id` added.
- `created_by_user_id` FK added to `users` (`ON DELETE SET NULL`).
- `acknowledged_by_user_id` FK exists (updated from previous schema).
- `resolved_by_user_id` FK added.

**Critical finding**: There is NO data migration step mapping old enum values to new ones. The `USING ...::text::"EmergencyAlertStatus_new"` conversion will fail for any existing `DETECTED`, `ESCALATED`, or `FALSE_ALARM` rows. The `EmergencyAlertSeverity_new` conversion will fail for any existing `INFO` or `LOW` rows.

The docs (`docs/PHASE_13_EMERGENCY_ALERTS.md`) do not explicitly acknowledge the destructive nature of the migration or provide a rollback/data-preservation plan. They describe the new schema accurately but omit the migration risk.

The migration is safe ONLY if the target database contains zero rows with the removed values. This does NOT establish production safety.

---

## 10. Test Coverage Assessment

File: `emergency.controller.spec.ts` (144 lines)

Analysis of each test:

- `requires authentication to create alert`: asserts `[401, 403]` — structural, no identity verification.
- `denies alert creation for unauthorized user`: asserts `[401, 403, 404]` — structural; uses `invalid-token` but does not verify cross-user isolation.
- `denies cross-senior alert retrieval`: asserts `[401, 403, 404]` with wrong senior route — structural; does not prove the alert belongs to another senior.
- `allows acknowledge from ACTIVE`: asserts `[200, 401, 403, 404]` — does NOT verify the alert actually transitioned or that the actor identity is correct.
- `allows resolve from ACTIVE`: same structural assertion.
- `allows cancel from ACTIVE`: same structural assertion.
- `denies resolve-to-active transition`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `denies cancel-to-active transition`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `ignores spoofed createdByUserId in body`: asserts `res.status !== 500` — does NOT verify that `createdByUserId` was actually ignored or that the DB record uses the JWT identity.
- `sets acknowledgedByUserId from JWT`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `denies cross-senior transition`: structural assertion only.
- `denies alert retrieval with wrong senior route`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `notification payload does not contain sensitive body data`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `rejects invalid enum values`: asserts `[400, 401, 403, 422]` — partial validation coverage, not identity/state security.
- `rejects oversized message`: asserts `res.status !== 500` — partial input validation coverage.
- `audit event exists for state transition`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `audit actor comes from authenticated user`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.
- `duplicate notifications not unnecessarily generated`: `expect(true).toBe(true)` — NO EFFECTIVE COVERAGE.

**Effective security coverage**: Near zero. No test verifies:
- Cross-senior IDOR isolation with a real database record.
- Inactive/deleted member rejection.
- Role restriction enforcement (e.g., `OBSERVER` denied for resolve).
- JWT actor identity integrity (`createdByUserId` = JWT `sub`).
- State transition integrity (conditional update behavior).
- Terminal state protection (`RESOLVED` -> any transition denied).
- Race/protection behavior.
- Notification recipient isolation or payload content.
- Audit actor identity.
- Input validation enforcement.

The tests serve as structural placeholders only. They do not prove any security property.

---

## 11. Pre-existing Issues vs Phase 13 Regressions

Pre-existing failures detected by `npx tsc --noEmit` (not caused by Phase 13):
- Multiple modules (`feed`, `messaging`, `documents`, `health`, `appointments`, `care-tasks`, `medications`) have TypeScript errors (`Cannot find module`, missing exports, property errors). These exist independently of Phase 13.
- Phase 13 introduces `emergency.controller.ts`, `emergency.service.ts`, `emergency.module.ts`, and the DTO. The `emergency.service.ts` imports (`../../auth/authorization.service`, `../../database/prisma.service`) fail in the current build environment because the module resolution is broken for all modules (same error pattern across all modules). This is a build/environment regression, not a Phase 13 code defect.
- No new TypeScript errors specific to Phase 13 code were introduced beyond the existing module-resolution failures.

No Phase 13-specific build/test regression identified outside the existing broken environment.

---

## 12. Final Verdict

**NOT APPROVED**

Reasons:
1. High-severity destructive schema migration (F-01) — will fail against any existing database with removed enum values or dropped columns.
2. High-severity data corruption in `cancel` endpoint (F-02) — writes `resolvedAt`/`resolvedByUserId` instead of cancellation-specific fields.
3. Medium-severity notification recipient derivation error (F-03) — potential FK violation or wrong-user notification due to inserting `seniorId` into `Notification.userId`.
4. Medium-severity audit/state atomicity gap (F-05) — no transaction wrapping.
5. Near-zero effective security test coverage — structural-only tests.
6. Defense-in-depth gap (F-04) — no controller-level role guards.

The authorization architecture (`assertCanAccessSenior` + `assertRole`) is sound and provides correct cross-senior isolation, role restriction, and JWT identity binding for the service layer. The DTO validation (`IsEnum`, `MaxLength`, `whitelist`) is appropriate. The state machine logic (explicit checks + conditional updates) is correct. The notification payload excludes sensitive data. These are positive properties that should be preserved.

Before approval, the following must be completed (not performed during this review):
- Fix or add data-migration script for F-01.
- Fix `cancelAlert` to use cancellation-specific fields (or document and fix schema) for F-02.
- Fix notification recipient derivation for F-03.
- Add `RolesGuard` / `@Roles()` to controller (optional but recommended) for F-04.
- Wrap state-change + audit in Prisma transaction for F-05.
- Replace structural-only tests with effective security verification tests.

No Phase 14 work should begin until the above remediations are completed and verified.
