# DATABASE.md — Elderly Care Coordination Platform

> This document describes the PostgreSQL schema, ownership model,
> tenancy model, authorization-relevant relationships, important
> indexes, deletion strategy, migration strategy, and Phase 2
> decisions/deviations from the original plan.
>
> The canonical schema lives in `apps/api/prisma/schema.prisma`.
> This file is the human-readable design rationale.

---

## 1. Entity summary (37 tables)

| Domain | Tables |
|--------|--------|
| Identity & access | `users`, `refresh_tokens`, `organizations`, `organization_memberships` |
| Seniors & care circles | `senior_profiles`, `senior_organization_memberships`, `care_circles`, `care_circle_members`, `caregiver_profiles`, `emergency_contacts` |
| Medications | `medications`, `medication_schedules`, `medication_doses` |
| Appointments | `appointments`, `appointment_participants`, `reminders` |
| Care tasks | `care_tasks`, `care_task_assignments` |
| Health measurements | `health_measurement_types`, `health_measurements`, `health_devices` |
| Documents | `health_documents`, `document_accesses` |
| Family feed | `family_updates`, `comments` |
| Messaging | `conversations`, `conversation_participants`, `messages` |
| Notifications | `notifications`, `notification_preferences` |
| Emergency alerts | `emergency_alerts` |
| Audit log | `audit_logs` |
| Consent | `consents` |
| Invitations | `invitations` |
| Subscriptions | `subscriptions`, `organization_subscriptions` |

---

## 2. Ownership model

The central entity is **`SeniorProfile`**. Every care-relevant entity
either:

* belongs directly to a senior (`seniorId` FK), or
* belongs transitively through another senior-scoped entity.

**`User` is the login identity**, **not** the senior. A senior may
have zero or one `User` (1:1 via `User.seniorProfileId`). Most
users (family, caregivers, doctors) are *not* seniors.

---

## 3. Tenancy model (row-level multi-tenancy)

* **Organizations** (`organizations`) are optional containers.
* `organizationId` is **nullable** on every tenant-scoped table.
* `NULL` = private family (no organisation).
* `NOT NULL` = belonging to an organization.
* **No schema-per-tenant**; all tenants share the same tables.
* Phase 16 will add row-level security (RLS) policies so that the
  application role cannot cross the organization boundary without
  an explicit join through `OrganizationMembership`.

Tenant-scoped tables: `senior_profiles` (via
`SeniorOrganizationMembership`), `care_circles` (via
`SeniorProfile` → `SeniorOrganizationMembership`), `medications`,
`appointments`, `care_tasks`, `health_measurements`,
`health_documents`, `conversations`, `notifications`,
`audit_logs`, `consents`, `invitations`.

---

## 4. Authorization-relevant relationships

The authorization layer (Phase 3+) answers:
> *Can authenticated user U perform action A on senior S?*

by checking:

1. Does a `CareCircleMember` row exist where
   `circle.seniorId = S.id` AND (`userId = U.id` OR `seniorId = S.id`)
   AND `status = 'ACTIVE'`?
2. If yes, what is the `role` (`FAMILY_ADMIN`, `FAMILY_MEMBER`,
   `CAREGIVER`, `DOCTOR`, `OBSERVER`)?
3. Does that role permit action A (mapped in `CircleRolePermissions`)?

**Crucial**: a user's access to a senior is **entirely mediated**
by `CareCircleMember`. No `User.globalRole` grants senior-scoped
access (except `SUPER_ADMIN` which bypasses for `/admin/*` only).

```
User ──► CareCircleMember ◄── CareCircle ──► SeniorProfile
       (role, status)          (seniorId)
```

---

## 5. Important indexes

Indexes are designed for the query patterns in Phase 3+ API modules.
Only the most critical are listed here; the full list is in
`apps/api/prisma/schema.prisma`.

| Table | Index | Rationale |
|-------|-------|-----------|
| `users` | `globalRole`, `deletedAt` | Admin queries, soft-delete filtering |
| `refresh_tokens` | `userId`, `familyId`, `expiresAt` | Token rotation, family revocation, expiry sweep |
| `senior_profiles` | `deletedAt`, `fullName` | Admin list, search |
| `senior_organization_memberships` | `(organizationId, endsAt)` | Org-scoped active seniors |
| `care_circles` | `seniorId`, `deletedAt` | Circle lookup per senior |
| `care_circle_members` | `(userId, status)`, `(seniorId, status)`, `(circleId, role)` | Authz join, circle membership list, role filtering |
| `medications` | `(seniorId, isActive)`, `(seniorId, deletedAt)` | Active meds per senior |
| `medication_doses` | `(seniorId, scheduledAt)`, `(seniorId, status)`, `(status, scheduledAt)` | Today's doses, adherence queries, scheduled sweep |
| `appointments` | `(seniorId, startsAt)`, `(seniorId, status)`, `startsAt` | Calendar queries |
| `care_tasks` | `(seniorId, dueAt)`, `(seniorId, status)`, `(status, dueAt)` | Task dashboard |
| `care_task_assignments` | `userId`, `endsAt` | Assigned tasks, expired sweep |
| `health_measurements` | `(seniorId, typeId, measuredAt)`, `(typeId, measuredAt)`, `(seniorId, measuredAt)` | Trend charts, latest reading |
| `health_documents` | `(seniorId, deletedAt)`, `uploadedByUserId` | Senior docs, uploader audit |
| `notifications` | `(userId, readAt)`, `(userId, createdAt)`, `(seniorId, kind)` | Inbox, history, dedup |
| `audit_logs` | `(actorUserId, createdAt)`, `(seniorId, createdAt)`, `(action, createdAt)`, `(resourceType, resourceId)` | Investigation, compliance |
| `consents` | `(seniorId, scope)`, `expiresAt`, `revokedAt` | Scope checks, expiry sweep |
| `invitations` | `(inviteeEmail, status)`, `(seniorId, status)`, `expiresAt` | Accept flow, circle invites, expiry sweep |

---

## 6. Deletion strategy

### Soft delete (`deletedAt`)
Applied to entities where undelete is a real product requirement:

* `User` — account recovery
* `SeniorProfile` — accidental deletion protection
* `Medication` — treatment history
* `Appointment` — clinical record
* `CareTask` — task history
* `HealthDocument` — medical record integrity

**Never** soft-deleted:

* `AuditLog` — append-only; grants enforce no UPDATE/DELETE
* `RefreshToken` — rotation uses `revokedAt`, not soft delete
* `HealthMeasurementType` — reference data

### Hard delete (CASCADE)
Used for child entities that have no meaning without their parent:

* `MedicationSchedule` / `MedicationDose` → `Medication` (CASCADE)
* `CareTaskAssignment` → `CareTask` (CASCADE)
* `AppointmentParticipant` / `Reminder` → `Appointment` (CASCADE)
* `CareCircleMember` → `CareCircle` (CASCADE)
* `DocumentAccess` → `HealthDocument` (CASCADE)
* `ConversationParticipant` / `Message` → `Conversation` (CASCADE)
* `Comment` → `FamilyUpdate` (CASCADE)

### RESTRICT / SET NULL
* `User.seniorProfileId` → `SeniorProfile` (SET NULL): a user who *is* a senior keeps their login if the senior profile is removed.
* `HealthMeasurement.typeId` → `HealthMeasurementType` (RESTRICT): cannot remove a measurement type while measurements exist.
* `HealthDocument.uploadedByUserId` → `User` (RESTRICT): audit trail.

---

## 7. Migration strategy

* **Prisma Migrate** is the single source of truth.
* Every schema change is a new migration (`prisma migrate dev --name <desc>`).
* The `DATABASE_URL` in dev points to the local compose Postgres
  (`localhost:5433`).
* The migration table is `_prisma_migrations` in the `public`
  schema.
* CI runs `prisma migrate deploy` against a fresh test database.
* Phase 16 will add a lock-step migration gate in CI (no drift).

### pgcrypto extension
The initial migration (`20260904042815_init`) enables `pgcrypto`
so that `gen_random_uuid()` is available for UUID v4 PKs.

---

## 8. Phase 2 decisions & deviations

| Concern | Planned | Phase 2 implementation |
|---------|---------|------------------------|
| ID generation | UUID v7 via `gen_random_uuid()` | UUID v4 via `gen_random_uuid()` (pgcrypto). v7 would need a custom function; v4 is acceptable for now. |
| Soft delete | Only where undelete is real | Applied to 6 tables; audit log never soft-deleted. |
| Health measurements | Flexible typed model | JSONB `value` with `HealthMeasurementType.schema` for compound (e.g. BP) and scalar. |
| Medication adherence | Per-dose tracking | `Medication` → `MedicationSchedule` → `MedicationDose` (unique per `medicationId + scheduledAt`). |
| Care-circle role | Per-circle role | `CircleRole` enum + `CareCircleMember.role`. `FAMILY_ADMIN` is per-circle. |
| Organization membership | Separate from care circles | `OrganizationMembership.role` (`ORG_ADMIN`, `ORG_MEMBER`). |
| Emergency alert state machine | DETECTED → ACK → ESC → RES / FALSE | `EmergencyAlertStatus` enum; `unique(seniorId, source, externalId)` for de-dup. |
| Consent | First-class record | `Consent` with `scope`, `grantedAt`, `expiresAt`, `revokedAt`, `revocationReason`. |
| Invitations | Email + token hash | `Invitation.tokenHash` + `status` + `expiresAt`. |
| Subscriptions | Tier + status | `Subscription` (family) + `OrganizationSubscription` (org). |

---

## 9. Reproducibility

A clean database can be brought to the seeded state with:

```bash
# 1. Start Postgres (docker compose up -d)
# 2. Apply migrations
pnpm --filter @ecc/api exec prisma migrate deploy

# 3. Generate client (done by migrate deploy)
# 4. Seed
pnpm --filter @ecc/api exec prisma db seed
```

The seed (`apps/api/prisma/seed.ts`) is deterministic and
idempotent — re-running it leaves the same row counts.

---

## 10. Seed data summary

The seed creates **one demo senior** (Meera Patel, b. 1948-04-12)
with:

| Entity | Count | Notes |
|--------|-------|-------|
| Users | 6 | 1 family admin, 1 family member, 1 caregiver, 1 doctor, 1 senior-with-login, 1 org admin |
| Organization | 1 | "Sunrise Care" (ORGANIZATION plan) |
| Care circle | 1 | "Inner Family" with 5 members (incl. senior as OBSERVER) |
| Medications | 2 | Metformin (BID), Lisinopril (daily) |
| Medication schedules | 3 | 2 for Metformin, 1 for Lisinopril |
| Medication doses | 15 | 3 days × 4 schedules, mixed TAKEN/PENDING |
| Appointments | 2 | 1 in-person, 1 telehealth |
| Appointment participants | 3 | |
| Reminders | 3 | 24h/2h for appt1, 30m for appt2 |
| Care tasks | 3 | BP check (daily, caregiver), walk (completed), check-in call (daily, family admin) |
| Health measurement types | 5 | BP, HR, glucose, SpO2, weight |
| Health measurements | 21 | 5 days × (BP + HR + glucose + SpO2) + 1 weight |
| Emergency contacts | 3 | Daughter, son, provider 24/7 |
| Family updates | 2 | 1 measurement, 1 appointment |
| Comments | 1 | On measurement update |
| Notifications | 3 | task.due, med.due, appt.upcoming |
| Consents | 1 | share_with_care_circle |
| Audit logs | 1 per seed run | circle.member.added |

---

## 11. Unresolved design questions (for future phases)

1. **Audit log append-only enforcement**: Phase 16 will use Postgres
   GRANT/REVOKE so the app role has `INSERT` only. This document
   assumes the grants are applied.
2. **Row-level security**: Phase 16 will add RLS policies for
   organization isolation. The schema has `organizationId` nullable
   everywhere but policies are not yet active.
3. **Encrypted PHI columns**: If field-level encryption is required,
   Phase 16 will add `pgp_sym_encrypt` columns and a key-rotation
   strategy. Not implemented in Phase 2.
4. **UUID v7**: If time-ordered PKs become important for index
   locality, a migration to v7 can be added later.
5. **Care-circle many-to-many**: Currently `CareCircle` is 1:1 with
   `SeniorProfile` (via `seniorId`). Phase 4 may make it many-to-many
   (a senior can have multiple circles; a circle can cover multiple
   seniors). The FK is already on `CareCircle.seniorId`; a join table
   would be the migration.

---

## 12. Validation checklist (Phase 2 gate)

* [x] `pnpm -r typecheck` — passes
* [x] `pnpm -r lint` — passes (0 warnings)
* [x] `pnpm -r test` — passes (6 API tests incl. 4 DB integration)
* [x] `pnpm -r build` — passes
* [x] `prisma migrate status` — no drift
* [x] Database reproducible from clean state (reset → deploy → seed)
* [x] Seed succeeds and is idempotent
* [x] No secrets committed
* [x] No PHI in logs (seed uses deterministic random, not real data)