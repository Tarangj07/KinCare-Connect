# ARCHITECTURE.md

> Target architecture. This document is the contract the codebase is built
> against. Where implementation has not yet started, treat the text as a
> decision record, not as a description of what is shipped.

---

## 1. Goals and non-goals

**Goals**

* A monorepo that ships three runnable apps (web, mobile, api) and a small
  set of shared packages.
* Clear domain boundaries inside the API. Feature modules own their
  controllers, services, repositories, DTOs, and tests.
* Strict server-side authorization on every endpoint. The web and mobile
  UIs may hide actions, but the API never relies on that hiding.
* Event-driven side effects (notifications, audit, escalation) so that
  business logic does not grow into the controllers.
* Accessibility and i18n treated as first-class from the first commit.

**Non-goals**

* We are **not** building an EMR, a clinical decision support system, or a
  prescribing tool. The product is a care-coordination layer.
* We are **not** claiming HIPAA, GDPR, or any other regulatory compliance
  in this repository. We implement technical controls that make compliance
  achievable; the legal/BAA/training side is the deploying organisation's
  responsibility. See `COMPLIANCE.md` (added in Phase 26) for the full split.

---

## 2. Repository layout

```
ecc/                                  # repo root
├── apps/
│   ├── api/                          # NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/               # filters, guards, pipes, interceptors
│   │   │   ├── config/               # zod-validated env loader
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── seniors/
│   │   │   │   ├── care-circles/
│   │   │   │   ├── medications/
│   │   │   │   ├── appointments/
│   │   │   │   ├── care-tasks/
│   │   │   │   ├── health/
│   │   │   │   ├── feed/
│   │   │   │   ├── messaging/
│   │   │   │   ├── documents/
│   │   │   │   ├── emergency/
│   │   │   │   ├── notifications/
│   │   │   │   ├── audit/
│   │   │   │   └── consent/
│   │   │   └── realtime/             # Socket.IO gateway
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── test/
│   ├── web/                          # Next.js (App Router)
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/                 # feature-scoped client logic
│   │   └── lib/
│   └── mobile/                       # Expo / React Native
│       ├── app/                      # expo-router
│       ├── components/
│       ├── features/
│       └── lib/
├── packages/
│   ├── ui/                           # shared design tokens + React Native Web components
│   ├── types/                        # cross-app DTOs (zod schemas + inferred types)
│   ├── validation/                   # zod schemas reused by api + forms
│   ├── config-eslint/
│   ├── config-tsconfig/
│   └── i18n/                         # message catalogues, ICU MessageFormat
├── infra/
│   ├── docker/                       # compose files, dev Dockerfile
│   └── ci/                           # reusable workflows
├── docs/
│   ├── architecture/  (this file)
│   ├── security/      (THREAT_MODEL.md, SECURITY.md)
│   ├── api/
│   ├── product/
│   └── adr/           # architecture decision records
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── README.md
└── LICENSE
```

---

## 3. Runtime architecture

```
                ┌────────────────────┐
                │      Web (Next)    │──────┐
                └────────────────────┘      │
                ┌────────────────────┐      │  HTTPS / WSS
                │  Mobile (Expo)    │──────┤
                └────────────────────┘      │
                                            ▼
                                ┌──────────────────────────┐
                                │  NestJS API (REST + WS)  │
                                │  ┌────────────────────┐  │
                                │  │ Auth (JWT + RfT)   │  │
                                │  ├────────────────────┤  │
                                │  │ RBAC + ABAC guard  │  │
                                │  ├────────────────────┤  │
                                │  │ Feature modules    │  │
                                │  ├────────────────────┤  │
                                │  │ Event bus (outbox) │  │
                                │  └─────────┬──────────┘  │
                                └────────────┼─────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              ▼                              ▼                              ▼
       ┌─────────────┐                ┌─────────────┐                ┌─────────────┐
       │ PostgreSQL  │                │   Redis     │                │   Object    │
       │ (Prisma)    │                │ BullMQ +    │                │   storage   │
       │             │                │ cache       │                │ (S3/MinIO)  │
       └─────────────┘                └──────┬──────┘                └─────────────┘
                                              │
                                              ▼
                                    ┌────────────────────┐
                                    │  Worker process    │
                                    │  (same Nest build) │
                                    │  Notifications,    │
                                    │  escalation,       │
                                    │  email, push       │
                                    └────────────────────┘
```

* The **API process** serves HTTP + WebSocket and is the only component
  that talks to Postgres directly. It writes events into an **outbox**
  table in the same transaction as the business write.
* A **worker process** (same code, `pnpm --filter @ecc/api start:worker`)
  tails the outbox via BullMQ, dispatches notifications, and performs
  retries with exponential backoff.
* **Postgres** is the source of truth. **Redis** is for transient state
  (rate-limit counters, refresh-token jti index, BullMQ queues).
* **Object storage** is accessed only through `StorageService` which
  returns signed URLs with short TTLs. Buckets are private; the API
  never returns a permanent URL.

---

## 4. Cross-cutting concerns

### 4.1 Configuration

* All env loaded by a single zod schema in `apps/api/src/config/env.ts`.
* The application refuses to start if any required variable is missing or
  fails validation. Defaults are explicit; nothing is read with `||`.
* Web and mobile read **public** env only (e.g. `NEXT_PUBLIC_API_URL`,
  `EXPO_PUBLIC_API_URL`); they never see DB credentials, JWT secrets,
  or storage keys.

### 4.2 Validation

* Inbound HTTP bodies and query strings are validated with zod schemas
  declared in `packages/validation` and reused by the API's
  `ZodValidationPipe`. Form libraries on the web/mobile reuse the same
  schemas for client-side validation. The schema is the contract; the
  client cannot bypass the server's check.

### 4.3 Errors

* A global `AllExceptionsFilter` maps known error classes to a stable
  JSON shape:
  ```json
  { "error": { "code": "string_code", "message": "human readable", "requestId": "..." } }
  ```
* Stack traces are never returned to the client. They are logged with
  the request id at `error` level.

### 4.4 Logging

* `pino` with `pino-http`. Every request is logged once at completion
  with method, path, status, duration, request id, **and the
  authenticated user id only** — never PHI.
* Health-data fields are scrubbed at the logger level using a `redact`
  list (`req.body.*`, `req.query.*`, etc., for the health and feed
  modules).

### 4.5 Request identity

* `requestId` middleware: inbound `x-request-id` is honoured if present,
  otherwise a new ULID is generated. Echoed on the response.

### 4.6 Auth model

* Access token: 15 min, HS256 (or RS256 in production — see Phase 16).
  Claims: `sub` (user id), `roles` (global), `csc` (array of
  `{circleId, role}` — the user's care-circle memberships).
* Refresh token: 30 days, random 256-bit secret stored hashed (Argon2id)
  in `refresh_tokens` table with `jti`, `userId`, `userAgent`, `ip`,
  `expiresAt`, `revokedAt`. Rotation on every use; reuse triggers
  family-wide revocation.
* Cookies for the **web app** are httpOnly + Secure + SameSite=strict,
  scoped to `/api/v1/auth`. The mobile app uses the same API but stores
  tokens in `expo-secure-store` (Keychain / Keystore).
* CSRF: the auth cookie path is separate from the API path; mutating
  requests require a same-site cookie plus an `X-CSRF-Token` header
  bound to the session.

### 4.7 Authorization model

Two layers, both enforced server-side.

1. **RBAC** — global role on `users`. Used for non-resource routes
   (`/admin/*`, billing, organisation management).
2. **Care-circle authorization (ABAC)** — every senior-scoped endpoint
   resolves a `CareCircleMember` row for the caller's user id and the
   target senior id. Allowed actions depend on the caller's per-circle
   role (`FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR`).

A `SeniorAccessGuard` (factory) is the single chokepoint. Resources
that do not pass through it cannot be reached.

### 4.8 Data model principles

* UUID v7 primary keys (`@default(dbgenerated("gen_random_uuid()"))`
  via `pgcrypto`).
* `createdAt` / `updatedAt` on every table.
* Soft delete (`deletedAt`) only on entities where undelete is a real
  product requirement (User, SeniorProfile, Medication, Appointment,
  CareTask, HealthDocument). Audit log entries are **never** soft
  deleted.
* `organizationId` is nullable on every tenant-scoped table; null
  means the resource belongs to a private family.
* All FK columns are indexed. Composite indexes follow the actual
  query patterns in `docs/api/QUERY_PATTERNS.md` (to be written in
  Phase 2).

### 4.9 Eventing

* Domain events are emitted through a typed `EventBus` (in-process
  for now, swappable for an outbox-driven broker). The bus has a
  single in-memory implementation and a transactional outbox
  implementation behind the same interface.
* Events are named in past tense: `medication.dose.taken`,
  `appointment.created`, `emergency.alert.escalated`.

### 4.10 Object storage

* Single `StorageService` interface with two adapters:
  * `S3StorageAdapter` (production) — talks to S3 via the AWS SDK.
  * `MinioStorageAdapter` (dev) — talks to the local MinIO container.
* All object access goes through a `PresignService` that returns
  short-lived (5 min) signed URLs. The signed URL is never persisted
  in the database.

### 4.11 Realtime

* Socket.IO with a single `/realtime` namespace. The handshake
  validates the access JWT and stores the user id on the socket.
  Authorization for joining a conversation or a senior's updates
  channel is enforced by a server-side `canAccessSenior(userId,
  seniorId)` check — never by trusting a client-supplied `room`
  name.

### 4.12 Mobile

* Expo Router for navigation. i18n via `i18next` + `react-i18next`,
  with locale resolution from the device (English / Hindi / Gujarati
  in the scaffold; copy ships English-only at MVP).
* Minimum touch target 48×48 dp, base font 18 sp, contrast ratio
  ≥ 4.5:1.

### 4.13 Web

* Next.js App Router. RSC for read-only pages; client components only
  where interaction requires it. No server actions for mutations
  involving PHI; those go through the REST API so the audit log is
  the source of truth.

### 4.14 Internationalisation

* All user-visible strings are keys resolved through `packages/i18n`.
* The catalog is ICU MessageFormat so pluralisation and gender are
  supported. English is the only fully translated locale at MVP; the
  architecture is in place to drop in translations without code
  changes.

---

## 5. Data ownership

| Concept                | Lives in                                                  |
| ---------------------- | --------------------------------------------------------- |
| Account / login        | `User`                                                    |
| Global role            | `User.role` (SUPER_ADMIN) or `OrganizationMembership`     |
| Care-circle role       | `CareCircleMember.role`                                   |
| Senior                 | `SeniorProfile` (may have no login account)               |
| Senior-as-user         | `User` with `seniorProfileId` (1:1) — opt-in              |
| Organisation           | `Organization`                                            |
| Organisation membership| `OrganizationMembership(userId, organizationId, role)`    |

The data model explicitly supports a senior who has no login: a
`SeniorProfile` is created by a family admin and the senior interacts
with the system via a caregiver or family member.

---

## 6. Compliance posture

`COMPLIANCE.md` (added in Phase 26) documents:

* Technical controls we implement (encryption in transit, hashing,
  access control, audit logging, session security).
* Technical controls we **do not** implement and why (e.g. field-
  level encryption at rest is left to the cloud provider's managed
  Postgres / RDS encryption).
* Organisational controls that remain the deployer's responsibility
  (BAA, workforce training, vendor risk assessments, breach
  notification process, contingency planning).

We will not market the product as HIPAA-compliant; we will market it
as built with HIPAA-aligned practices and engineered to make a
compliance programme achievable.

---

## 7. Open architectural questions

These are tracked so the implementation does not make irreversible
choices prematurely.

1. **Outbox vs. broker.** Phase 8 starts with the Postgres outbox.
   If a real message broker becomes necessary, the `EventBus`
   interface shields the rest of the system.
2. **Schema-per-tenant vs. row-level multi-tenancy.** Default:
   row-level. Revisit when the first paying organisation needs
   data residency.
3. **Symmetric vs. asymmetric JWT signing.** HS256 in dev. Phase 16
   evaluates RS256 with KMS-managed keys.

## 8. Phase 1 implementation notes

The deviations from the planned stack in this phase are recorded
here so reviewers can see the current state of each major choice.

| Concern               | Planned                                    | Phase 1 implementation                |
| --------------------- | ------------------------------------------ | ------------------------------------- |
| Frontend framework    | Next.js + TypeScript                       | Next.js **14.2.x** (App Router)       |
| Backend framework     | NestJS + TypeScript                        | NestJS **10.4.x**                     |
| Linter                | ESLint (version unspecified)               | **ESLint 8.57** (legacy config)       |
| Test runner           | Vitest / Jest                              | **Vitest 2.x**                        |
| Build orchestrator    | Turborepo                                  | **Turborepo 2.x**                     |
| Package manager       | pnpm                                       | pnpm **11.25.0** via Corepack         |
| Healthcheck surface   | `/healthz` (liveness), `/readyz` (readiness) | `GET /api/v1/health` returns `{status, service, phase}`. Split into liveness/readiness is Phase 18. |
| Security headers      | HSTS, CSP, `X-Content-Type-Options`, etc.  | Default `helmet` set (CSP, HSTS, COOP, CORP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`). Tightening lands in Phase 16. |
| Error response shape  | `{ error: { code, message, requestId } }`  | Implemented via `GlobalExceptionFilter`. |
| Local dev ports       | not specified                              | api `3000`, web `3001`, postgres `5433`, redis `6380`, minio `9000/9001`. |

## 9. Phase 2 implementation notes

| Concern                    | Planned                                             | Phase 2 implementation                                                 |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| Database                   | PostgreSQL 16 + Prisma                              | PostgreSQL 16 + Prisma **5.22**                                        |
| Migration tool             | Prisma Migrate                                      | Prisma Migrate (`migrate dev` / `migrate deploy`)                     |
| ID strategy                | UUID v7 via `gen_random_uuid()`                     | UUID v4 via `gen_random_uuid()` (pgcrypto) — v7 deferred              |
| Seed                       | Deterministic demo data                             | Deterministic, idempotent, 6 users / 1 senior / 1 org / 1 circle       |
| Health measurements        | Flexible typed model                                | JSONB `value` + `HealthMeasurementType.schema` (scalar/compound)       |
| Medication adherence       | Per-dose tracking                                   | 3-layer: `Medication` → `MedicationSchedule` → `MedicationDose`        |
| Authorization ACL          | Care-circle membership                              | `CareCircleMember` with `CircleRole` enum (5 roles)                   |
| Tenancy                    | Row-level `organizationId`                          | Nullable `organizationId` on all tenant tables; `NULL` = private       |
| Audit log                  | Append-only                                         | `audit_logs` table + app-role `INSERT` only (grants Phase 16)         |
| Consent                    | First-class records                                 | `Consent` with scope/granted/expires/revoked                          |
| Emergency alerts           | State machine                                       | 5 states (`DETECTED`..`FALSE_ALARM`) + de-dup unique key              |
| Documents                  | Metadata + S3                                       | `HealthDocument` (storageKey, hash, scanStatus) + `DocumentAccess`    |
| Seed reproducibility       | From clean DB                                       | `migrate reset --force` → `migrate deploy` → `db seed` verified       |

**Deviations from the planned stack:**

* **UUID v4 instead of v7.** `gen_random_uuid()` is v4. v7 would
  require a custom DB function; v4 is acceptable for MVP and does
  not affect correctness.
* **HealthMeasurement.value is JSONB.** A single JSONB column with
  `HealthMeasurementType.schema` handles both scalar (HR, glucose)
  and compound (BP systolic/diastolic) without a wide table.
* **RefreshToken table created in Phase 2.** Phase 3 will consume
  it; adding it now keeps migrations clean.

**Open architectural questions (updated):**

1. **Outbox vs. broker.** Phase 8 starts with the Postgres outbox.
   If a real message broker becomes necessary, the `EventBus`
   interface shields the rest of the system.
2. **Schema-per-tenant vs. row-level multi-tenancy.** Default:
   row-level. Revisit when the first paying organisation needs
   data residency.
3. **Symmetric vs. asymmetric JWT signing.** HS256 in dev. Phase 16
   evaluates RS256 with KMS-managed keys.
4. **Row-level security (RLS) policies.** Phase 16 will add RLS
   policies so that the application role cannot cross the
   organization boundary without an explicit join through
   `OrganizationMembership`. The nullable `organizationId` on every
   tenant table is the prerequisite.
5. **Field-level encryption.** If PHI encryption-at-rest beyond
   the managed Postgres provider's disk encryption is required,
   Phase 16 will evaluate `pgp_sym_encrypt` columns and a
   key-rotation strategy.

**Known limitations:**

* No RLS policies yet — the `organizationId` column exists but
  is not enforced at the DB layer. Phase 16.
* `AuditLog` is append-only in the schema; the application-role
  grants (`INSERT` only) are applied in Phase 16.
* Mobile vitest pipeline is a no-op. Adding the proper
  Metro + `jest-expo` test runner is Phase 14 work.
* `helmet`'s default CSP is shipped; a hardened CSP (no
  `unsafe-inline`, explicit `connect-src`) lands in Phase 16.
* No CI workflow yet — that is Phase 19.

