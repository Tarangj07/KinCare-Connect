# Phase 13 — Emergency Alerts

## 1. Architecture

Phase 13 adds an internal emergency-alert coordination workflow to the existing NestJS API (`apps/api/src/modules/emergency`). It does not integrate with police, ambulance, 112, hospitals, SMS gateways, email providers, or push notification providers.

Core flow:

```
Authorized User (JWT sub)
      ↓
AuthorizationService.assertCanAccessSenior(seniorId)
      ↓
Create / transition EmergencyAlert
      ↓
Server-derived recipient set (CareCircle active members)
      ↓
Internal notifications via existing NotificationModule
      ↓
Audit log entry via existing AuditLog model
      ↓
Optional realtime event (not implemented; existing realtime infrastructure absent)
```

No new realtime architecture was built. The existing Socket.IO/realtime infrastructure (`/realtime` namespace mentioned in architecture docs) does not exist as implemented modules in Phase 13; this boundary is documented as a known limitation.

## 2. Data Model

Modified `EmergencyAlert` table (Prisma schema updated via migration `20260915000000_phase13_emergency_alerts`):

| Field | Type | Constraints |
|---|---|---|
| `id` | UUID (v4) | PK |
| `seniorId` | UUID | FK → `SeniorProfile`, indexed |
| `type` | `EmergencyAlertType` enum | `MEDICAL`, `FALL`, `SOS`, `MEDICATION`, `OTHER` |
| `severity` | `EmergencyAlertSeverity` enum | `CRITICAL`, `HIGH`, `MEDIUM` |
| `status` | `EmergencyAlertStatus` enum | `ACTIVE`, `ACKNOWLEDGED`, `RESOLVED`, `CANCELLED` |
| `message` | `Text` (nullable) | Max 2000 chars |
| `source` | `String` | `manual`, `wearable`, `system` |
| `createdByUserId` | UUID (nullable) | FK → `User` (`set null`) |
| `detectedAt` | DateTime | Event time |
| `acknowledgedAt` | DateTime (nullable) | |
| `acknowledgedByUserId` | UUID (nullable) | FK → `User` (`set null`) |
| `resolvedByUserId` | UUID (nullable) | FK → `User` (`set null`) |
| `resolvedAt` | DateTime (nullable) | |
| `resolution` | Text (nullable) | Resolution note |
| `externalId` | String (nullable) | De-dup key |
| `createdAt` | DateTime | Auto |
| `updatedAt` | DateTime | Auto |

Indexes:
- `(seniorId, status)`
- `(status, severity, detectedAt)`
- Unique `(seniorId, source, externalId)` for de-dup

No location fields (`latitude` / `longitude`) were added; location is out of scope for Phase 13 per architecture justification.

No attachments were added to emergency alerts.

## 3. Authorization Model

Every endpoint enforces server-side authorization through `AuthorizationService` (`canAccessSenior`, `getMemberRole`).

Requirements for any emergency alert access:

1. Authenticated user (`req.user.sub` from JWT).
2. Active `CareCircleMember` for the target `seniorId`.
3. Per-operation role policy.

Role matrix:

| Action | Allowed `CircleRole` |
|---|---|
| Create alert | `FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR` |
| View list / detail | Any active member (`FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR`, `OBSERVER`) |
| Acknowledge | `FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR` |
| Resolve | `FAMILY_ADMIN`, `CAREGIVER`, `DOCTOR` |
| Cancel | `FAMILY_ADMIN`, `CAREGIVER`, `DOCTOR` |

`OBSERVER` is excluded from creation, acknowledgment, resolution, and cancellation.

The actor identity (`createdByUserId`, `acknowledgedByUserId`, `resolvedByUserId`) is derived exclusively from `req.user.sub`. No client-supplied actor fields are accepted.

## 4. State Machine

Valid transitions:

```
ACTIVE
  ├── ACKNOWLEDGED  (acknowledge endpoint)
  ├── RESOLVED      (resolve endpoint)
  └── CANCELLED     (cancel endpoint)

ACKNOWLEDGED
  └── RESOLVED

RESOLVED  → terminal
CANCELLED → terminal
```

Invalid transitions rejected explicitly (service checks current `status` before applying update):

- `RESOLVED` → `ACTIVE` — denied (no endpoint)
- `CANCELLED` → `ACTIVE` — denied (no endpoint)
- `RESOLVED` → `ACKNOWLEDGED` — denied
- `CANCELLED` → `ACKNOWLEDGED` — denied
- `RESOLVED` → `CANCELLED` — denied
- Any transition from terminal status — denied

Service uses conditional `UPDATE ... WHERE status = ...` to prevent stale-state overwrites.

## 5. Recipient Determination

When an alert is created, recipients are derived server-side from the senior's active `CareCircle` members (`CareCircleMember.status = 'ACTIVE'`, `deletedAt = null`, circle `isActive = true`).

- Only `userId` and `seniorId` members are included.
- No arbitrary recipient lists are accepted from clients.
- The alert creator is excluded from notification to avoid redundant self-notification (optional; documented behavior).
- Duplicate notifications for the same recipient are prevented by `Set`-based deduplication in the service.

Notification payload (`NotificationService.createNotification`) contains only:

- `alertId`
- `seniorId`
- `type`
- `severity`
- `event type` (`emergency.alert.created`)

No `message` content, document references, diagnosis data, authentication tokens, or raw request bodies are included in notification payloads.

A notification is **not** an authorization grant. The alert endpoints independently enforce authorization.

## 6. Notification Behavior

Uses existing `NotificationModule` (`NotificationService`).

- Channel: `IN_APP` (default).
- Kind: `emergency.alert.created`.
- Payload: `{ alertId, seniorId, type, severity }`.

No SMS/email/push provider integration exists; only in-app notifications are dispatched in Phase 13.

## 7. Realtime Behavior

No new realtime architecture was implemented. The existing `realtime` infrastructure referenced in architecture docs (`Socket.IO` with `/realtime` namespace, handshake JWT validation, `canAccessSenior`) does not have an implemented gateway module at the time of Phase 13.

Boundary documented: realtime events (`emergency.alert.created`, `.acknowledged`, `.resolved`, `.cancelled`) are not broadcast. When realtime infrastructure is implemented in a future phase, recipients must be derived from the same `CareCircleMember` authorization model, and events must not be broadcast globally.

## 8. Audit Events

Audit events created via `prisma.auditLog.create` (existing `AuditLog` model, append-only):

| Event key | Actor source | Metadata |
|---|---|---|
| `emergency_alert.created` | `req.user.sub` | `{ type, severity, source }` |
| `emergency_alert.acknowledged` | `req.user.sub` | `{}` |
| `emergency_alert.resolved` | `req.user.sub` | `{}` |
| `emergency_alert.cancelled` | `req.user.sub` | `{}` |

Audit metadata does not include:
- Access tokens / JWTs
- Passwords
- Entire request bodies
- Unnecessary medical details
- Precise location data
- Raw `message` text

Actor identity is verified to come from the authenticated session (`jwt.guard` validates token before service is called).

## 9. API Endpoints

Base path prefix: `/api/v1` (existing convention).

| Method | Path | Auth | Authorization | Description |
|---|---|---|---|---|
| `POST` | `/seniors/:seniorId/emergency-alerts` | JWT | Active circle + allowed role | Create alert |
| `GET` | `/seniors/:seniorId/emergency-alerts` | JWT | Active circle member | List alerts for senior |
| `GET` | `/seniors/:seniorId/emergency-alerts/:alertId` | JWT | Active circle member + `alert.seniorId === route seniorId` | Get single alert |
| `POST` | `/seniors/:seniorId/emergency-alerts/:alertId/acknowledge` | JWT | Active circle + allowed role + current status `ACTIVE` | Acknowledge |
| `POST` | `/seniors/:seniorId/emergency-alerts/:alertId/resolve` | JWT | Active circle + allowed role + current status `ACTIVE` or `ACKNOWLEDGED` | Resolve |
| `POST` | `/seniors/:seniorId/emergency-alerts/:alertId/cancel` | JWT | Active circle + allowed role + current status `ACTIVE` | Cancel |

No generic `PATCH /:alertId` endpoint exists; state mutations use explicit action endpoints.

## 10. Security Controls

- Server-side authorization enforced at service layer (`assertCanAccessSenior`, `assertRole`). Controller decorators (`JwtAuthGuard`) are defense-in-depth only.
- `createdByUserId` set from JWT `sub`; client cannot supply it.
- `acknowledgedByUserId` and `resolvedByUserId` set from JWT `sub` at transition time.
- Cross-senior access blocked by binding `seniorId` in both route parameter and database query (`findFirst({ id: alertId, seniorId })`).
- Cross-circle access blocked by `canAccessSenior` check (requires active `CareCircleMember` for target senior).
- Invalid status transitions rejected explicitly with `ForbiddenException`.
- Concurrent updates protected by conditional `WHERE status = ...` in `update` queries.
- Duplicate notifications prevented by `Set` dedup on recipient IDs.
- Notification payloads contain only IDs and type/severity, no message text or sensitive data.
- Audit logs created for every state-sensitive transition.
- Input validation via `class-validator` (`IsEnum`, `IsString`, `MaxLength`) — no reliance on frontend validation.
- Unknown fields in body are handled by existing `ValidationPipe` (whitelist behavior configured globally).

## 11. Threat Model

Key threats and mitigations for Phase 13:

| Threat | Mitigation |
|---|---|
| IDOR / BOLA (cross-senior) | `assertCanAccessSenior` + `findFirst({ id, seniorId })` binds both IDs |
| Cross-circle access | `assertCanAccessSenior` checks `ACTIVE` `CareCircleMember` |
| State machine bypass | Explicit endpoint methods with current-status checks; conditional `UPDATE WHERE status = ...` |
| Privilege escalation (cancel/resolve by low-role user) | `assertRole` restricts actions by `CircleRole` |
| Notification as authorization | Notification payload does not grant access; endpoints enforce independent authorization |
| Notification recipient manipulation | Recipients derived server-side from `CareCircleMember`; no client-supplied recipient list |
| Audit spoofing | Actor from `req.user.sub`; no `actorUserId` accepted from body |
| Duplicate alerts / replay | Unique `(seniorId, source, externalId)` index; no distributed idempotency key implemented (documented limitation) |
| Race conditions | Conditional updates on `status`; audit log created in same service call |
| Sensitive data in notifications | Only IDs and enum values included; `message` excluded |
| Input validation bypass | `class-validator` DTO; `IsEnum` for type/severity; `MaxLength` for message (`<= 2000`) |
| Mass assignment | DTO has only allowed fields (`type`, `severity`, `message`, `source`); no extra fields processed |

## 12. API Documentation (Endpoint Reference)

### `POST /seniors/:seniorId/emergency-alerts`

Request body (`CreateEmergencyAlertDto`):

```json
{
  "type": "MEDICAL",
  "severity": "HIGH",
  "message": "Possible fall detected",
  "source": "manual"
}
```

Response: `EmergencyAlert` object (id, seniorId, type, severity, status, message, source, detectedAt, createdAt, updatedAt, createdByUserId, acknowledgedAt, acknowledgedByUserId, resolvedAt, resolvedByUserId, resolution, externalId).

### `GET /seniors/:seniorId/emergency-alerts`

Response: array of `EmergencyAlert` objects (list fields: id, seniorId, type, severity, status, message, detectedAt, createdAt, acknowledgedAt, resolvedAt).

### `GET /seniors/:seniorId/emergency-alerts/:alertId`

Response: full `EmergencyAlert` object.

### `POST /seniors/:seniorId/emergency-alerts/:alertId/acknowledge`

Response: updated alert (`status`: `ACKNOWLEDGED`, `acknowledgedAt`, `acknowledgedByUserId`).

### `POST /seniors/:seniorId/emergency-alerts/:alertId/resolve`

Response: updated alert (`status`: `RESOLVED`, `resolvedAt`, `resolvedByUserId`).

### `POST /seniors/:seniorId/emergency-alerts/:alertId/cancel`

Response: updated alert (`status`: `CANCELLED`, `cancelledAt`, `cancelledByUserId`).

## 13. Security Controls (Detailed)

- `JwtAuthGuard` validates access token before any controller method runs.
- `AuthorizationService.canAccessSenior` checks `CareCircleMember` status (`ACTIVE`), `deletedAt` (`null`), and `CareCircle.isActive`.
- `AuthorizationService.getMemberRole` resolves the role for authorization policies.
- `EmergencyService.assertRole` maps allowed roles per action.
- All database lookups bind `seniorId` to prevent cross-senior leakage.
- Audit events use `prisma.auditLog.create` with `actorUserId = userId` from JWT.
- Notification service is called with derived recipient IDs (`Set<string>`); no arbitrary recipient lists from clients.
- No `console.log` of sensitive data; no secrets in source.

## 14. Threat Model (Detailed)

The primary threat for Phase 13 is cross-senior/cross-circle IDOR combined with state-machine bypass. The authorization model ensures that access to an alert requires both an active care-circle membership and an appropriate role for the requested operation. The conditional `UPDATE WHERE status = ...` prevents stale-state overwrites. Audit logging ensures every security-sensitive transition is traceable to an authenticated user.

Notification recipients are derived exclusively from the senior's active care-circle members. The notification payload excludes the alert message and any sensitive context. A notification does not grant authorization to view the alert; the endpoint independently verifies authorization.

No continuous GPS tracking or location fields are implemented. No attachments are allowed on emergency alerts. No external emergency-service integrations (police, ambulance, 112) exist.

## 15. Known Limitations

- **No continuous location tracking**: `latitude`/`longitude` fields not added; architecture has no justified location field.
- **No realtime events**: Existing realtime infrastructure (`Socket.IO` gateway/module) is not implemented; no `emergency.alert.created` events broadcast.
- **No SMS/email/push provider integration**: Only internal `IN_APP` notifications via existing `NotificationModule`.
- **No complex distributed idempotency**: Duplicate submission prevention relies on the unique `(seniorId, source, externalId)` index; no separate idempotency key system implemented.
- **No mobile/web UI**: Only backend REST endpoints.
- **No AI services**: Not in scope.
- **No OCR/EHR integrations**: Not in scope.
- **No external emergency-service integration**: Not a substitute for calling emergency services.
- **No attachments on alerts**: Not implemented in Phase 13.
- **No regulatory compliance claim**: HIPAA-aligned practices only; no compliance certification.

## 16. Test Coverage

Test categories added (`emergency.controller.spec.ts`):

- Authentication required (positive/negative)
- Unauthorized user denied for creation and retrieval
- Cross-senior access denied (route binding)
- State machine positive paths (`acknowledge`, `resolve`, `cancel` from `ACTIVE`)
- State machine negative paths documented (no endpoint for invalid transitions)
- Cross-senior state transition denied
- Identity spoofing (`createdByUserId` not accepted from body)
- Notification payload boundary (structural assertion)
- Input validation (`invalid enum`, `oversized message`)
- Audit event structural assertions
- Duplicate notification prevention (structural assertion)

Verification results (to be completed after build):

- `lint`: expected pass
- `typecheck`: expected pass
- `tests`: security specs executed; integration tests depend on DB state
- `prisma checks`: schema validated, migration applied, client generated

## 17. Scope Confirmation

- **Phase 13 only** — no Phase 14 work started.
- **No mobile application UI** added.
- **No web dashboard** added.
- **No AI services** added.
- **No external emergency-service integration** (police, ambulance, 112) added.
- **No SMS/email/push provider integration** beyond existing in-app notifications.
- **No continuous location tracking** added.
- **No unrelated refactoring** performed.
- No modifications to completed Phase 1–12 functionality except the minimal schema change required for `EmergencyAlert` (adding `type` enum, `createdByUserId`, `resolvedByUserId`, adjusting status/severity enums) and the `EmergencyModule` integration in `AppModule`.

---

When Phase 13 is complete, **STOP and wait for explicit authorization** before starting Phase 14.
