# PROJECT_PLAN.md — Elderly Care Coordination Platform

> Living document. Update at the end of every phase. Do not declare a phase
> complete unless its gate criteria (see root project brief §40) pass.

---

## 0. Repository state snapshot (Phase 0)

| Aspect               | State                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| Working directory    | `/home/tarang/Desktop/Projects/ElderlyCareCoordinationPlatform` (empty)                |
| Version control      | **Not initialized** — `git init` pending                                               |
| Source code          | None                                                                                   |
| Package manifests    | None                                                                                   |
| Lockfiles            | None                                                                                   |
| Database / Prisma    | None                                                                                   |
| Docker               | None                                                                                   |
| CI                   | None                                                                                   |
| Documentation        | This file, plus the four baseline docs created in Phase 0                              |
| Tooling on host      | Node 24.18.0, npm 11.16.0, Docker 29.7.2, git 2.53.0. pnpm / yarn / psql not present. |

**Implication.** There is no prior architecture to preserve. The monorepo
structure, toolchain selection, and conventions described in the brief §23–24
are the baseline we will adopt, with the deviations noted in
`ARCHITECTURE.md`.

---

## 1. Architectural decisions locked in Phase 0

* **Repo layout.** pnpm + Turborepo monorepo.
  * Rationale: pnpm is widely supported by NestJS, Next.js, and Expo tooling;
    Turborepo gives us incremental builds and task pipelines without bringing
    Nx's heavier config.
  * Note: pnpm is not preinstalled on this host. Phase 1 will install it via
    `corepack enable` (no apt changes), which is the supported route on
    Node 24.
* **Backend.** NestJS 10 + TypeScript + Prisma 5 + PostgreSQL 16.
* **Web.** Next.js 15 (App Router) + TypeScript.
* **Mobile.** Expo SDK 52 + React Native + TypeScript.
* **Realtime.** Socket.IO over a separate `/realtime` namespace, behind the
  same JWT auth used by HTTP.
* **Cache / queue.** Redis 7 (BullMQ for jobs).
* **Object storage.** S3-compatible interface with a local MinIO container
  for dev; production swap-in left as a Phase 19 task.
* **Auth model.** Short-lived access JWT (15 min) + rotating refresh JWT
  (7 days, hashed at rest) stored in an **httpOnly, Secure, SameSite=strict
  cookie** scoped to `/api/v1/auth`. No tokens in `localStorage`.
* **Compliance posture.** HIPAA-aligned engineering practices. **We do not
  claim HIPAA compliance.** A `COMPLIANCE.md` will enumerate the technical
  controls we have implemented and the legal/organisational controls that
  remain the customer's responsibility (BAA, training, risk assessments, etc.).

---

## 2. Domain MVP scope

Implemented in this priority order. Each row is a phase gate.

| Phase | Scope                                                                                          | Status   |
| ----- | ---------------------------------------------------------------------------------------------- | -------- |
| 0     | Repo audit + baseline docs (this file, ARCHITECTURE, THREAT_MODEL, SECURITY)                   | **DONE** |
| 1     | Monorepo foundation (pnpm workspace, Turborepo, ESLint/Prettier, tsconfig, Docker Compose)     | **DONE** |
| 2     | Database schema (Prisma) + initial migration + seed data scaffold                              | **DONE** |
| 3     | Auth + RBAC (register, login, refresh, logout, password reset, email-verify stub, lockout)     | pending  |
| 4     | Senior profiles + care circles (invite/remove, role per circle, audit)                         | pending  |
| 5     | Medication management (CRUD, schedule generator, dose instances, adherence recording)         | pending  |
| 6     | Appointments (CRUD, participants, calendar views, reminder config)                             | pending  |
| 7     | Care tasks (CRUD, assignment, recurrence, dashboard today/overdue/due-soon/completed)          | pending  |
| 8     | Notification system (event bus → BullMQ → push/in-app/email providers)                         | pending  |
| 9     | Health measurements (typed values, trends, configurable alerts — no diagnostics)               | pending  |
| 10    | Family feed (posts, comments, attachments-stub, permission-filtered)                           | pending  |
| 11    | Secure messaging (Socket.IO, server-derived identity, rate-limited)                           | pending  |
| 12    | Document management (S3 + signed URLs, type/size validation, audit)                            | pending  |
| 13    | Emergency alerts (state machine, escalation rules, simulated trigger)                          | pending  |
| 14    | Mobile app (Expo, large-type UI, accessibility)                                                | pending  |
| 15    | Web dashboards (per-role: senior / family / caregiver / org / admin)                           | pending  |
| 16    | Security hardening pass (headers, rate limits, dependency audit, secret scanning)             | pending  |
| 17    | Testing pass (unit, integration, e2e for critical auth & authorization paths)                  | pending  |
| 18    | Observability (structured logs, request IDs, /healthz, /readyz, metrics endpoint)              | pending  |
| 19    | Deployment (Dockerfile prod, GitHub Actions CI/CD, env templates)                              | pending  |
| 20    | AI service boundary (interface only, no LLM dependency in MVP)                                | pending  |

---

## 3. Phase gate checklist (apply to every phase)

1. `pnpm -r typecheck` — no errors.
2. `pnpm -r lint` — no errors.
3. `pnpm -r test` — all tests pass.
4. `pnpm -r build` — production build succeeds.
5. `pnpm --filter @ecc/api prisma:migrate:status` — no drift.
6. Security review: any new endpoint enforces server-side authorization.
7. Audit log entries added for new sensitive operations.
8. Docs updated (this file + relevant doc).
9. No secrets in source. No `console.log` of PHI.
10. No breaking changes to public API without a documented migration.

---

## 4. Out of scope for MVP (explicit non-goals)

* Real medical-device SDKs (Apple HealthKit, Fitbit, Garmin). Adapter
  interfaces are scaffolded; concrete integrations land post-MVP.
* Real payment processing. Subscription tiers are modeled; billing is stubbed.
* LLM-backed features. Interface exists; no model call path in MVP.
* Native push certificates (APNs/FCM). Providers are stubbed behind a
  `PushProvider` interface; local console transport for dev.
* Internationalisation beyond string-extraction scaffolding. English-only
  copy at MVP; Hindi/Gujarati locale files added when translations land.

---

## 5. Open questions for the product owner

These are deferred until the relevant phase rather than blocking Phase 1.

1. Will seniors ever have direct logins, or are they always represented by a
   `SeniorProfile` owned by a family admin? (Brief §43 — both must be supported.)
2. Preferred email transport for dev — Mailpit (Docker) vs. console log only.
3. For organizations, is multi-tenant isolation row-level or schema-per-tenant?
   Default: row-level with `organization_id` on every tenant-scoped table.
4. Should "Family Admin" be a global role or a per-care-circle role? Default:
   per-circle role; global SUPER_ADMIN is separate.
5. Audit-log retention period? Default: 7 years (HIPAA-style), buttressed
   by an append-only table + WORM storage in production.

---

## 6. Phase log

### Phase 0 — Repository & architecture audit (completed)
* Audited the (empty) working directory.
* Confirmed available host tooling.
* Wrote `PROJECT_PLAN.md`, `ARCHITECTURE.md`, `THREAT_MODEL.md`, `SECURITY.md`.
* No code changes were made; the repository is unchanged from its initial
  empty state.

### Phase 1 — Monorepo foundation (completed)
* Git repository initialised on `main`.
* pnpm 11.25.0 managed via Corepack (`packageManager` pinned in
  `package.json`).
* Workspace layout: `apps/{api,web,mobile}`, `packages/{config,types,
  validation,ui}`.
* `turbo.json` with the standard five tasks (`build`, `dev`, `lint`,
  `typecheck`, `test`) plus `clean`.
* `tsconfig.base.json` with strict mode and `noUncheckedIndexedAccess`.
* Shared configs in `packages/config`:
  * `eslint.base.cjs` (legacy config), `eslint.node.cjs`,
    `eslint.browser.cjs`, `eslint.react.cjs`.
  * `tsconfig.base.json`, `tsconfig.node.json`,
    `tsconfig.browser.json`, `tsconfig.react-native.json`.
* Prettier configured at the workspace root (`.prettierrc.json`,
  `.prettierignore`).
* Next.js 14 web app boots and builds; landing page and a `/health`
  page that calls the API are wired up.
* Expo SDK 51 / React Native 0.74 mobile app scaffolded; entry point
  uses `expo-router`. Mobile vitest pipeline is a no-op for Phase 1
  (the proper RN+Metro test runner is configured in Phase 14).
* NestJS 10 API app boots, returns `{"status":"ok","service":"api",
  "phase":1}` from `GET /api/v1/health`, and ships a global
  exception filter, request-id middleware, helmet security headers,
  and `ValidationPipe` configured to reject unknown fields.
* `packages/ui` ships a design-token module (`palette`, `spacing`,
  `radii`, `typography`, `controlSize`, `elevation`) sized for
  senior-friendly UI (base 18px, ≥48px touch targets).
* `docker-compose.yml` brings up `postgres:16-alpine`, `redis:7-alpine`,
  MinIO, and a one-shot bucket bootstrap (`ecc-documents` made
  private). Default host ports shifted to **5433/6380/9000/9001** to
  avoid collisions with a locally-running Redis on 6379.
* Per-app `Dockerfile` for `apps/api` and `apps/web`. Mobile
  `Dockerfile` is deferred to the Expo EAS workflow in Phase 14.
* `.env.example` lists every env variable the platform will use,
  with placeholders only. `.gitignore` covers `node_modules`,
  `.next`, `.expo`, `.turbo`, build outputs, coverage, `.env*`,
  Prisma artefacts, and common secret file extensions.
* **Phase 1 gate: all four validations green.**
  * `pnpm -r typecheck` — passes.
  * `pnpm -r lint` — passes (0 warnings; `--max-warnings 0` enforced).
  * `pnpm -r test` — 2 tests pass (api + web).
  * `pnpm -r build` — passes (api, web, mobile, all packages).
  * `docker compose up -d` — all three services healthy;
    MinIO bucket created with anonymous access disabled.
  * `node dist/main.js` + `curl /api/v1/health` — confirmed live
    response with correct security headers.
  * `next start` + `curl /` and `/health` — confirmed both pages
    return HTTP 200.
* **Deviations from the planned stack:**
  * **Next.js 14 (not 15).** The brief mentions "Next.js + TypeScript"
    without a version. I chose 14.2.x because it is the most recent
    stable line that has settled on the App Router and avoids the
    React 19 / RSC changes in 15. Easy to bump in Phase 15 if the
    product owner wants it.
  * **NestJS 10 (not 11).** Same reason — 10 is the current LTS; 11
    is recent and I prefer not to lead with a brand-new major.
  * **ESLint 8 (not 9).** ESLint 9's flat-config-only stance
    complicates the monorepo inheritance story; sticking with 8.57
    lets `packages/config` ship a clean legacy-config surface and
    lets Next.js's built-in `next lint` work without override flags.
  * **Vitest (not Jest).** Vitest is faster, has first-class ESM
    + TS, and shares Vite's config model. It is mentioned in the
    brief alongside Jest ("Vitest/Jest") so this is on-track.
  * **Turborepo 2.x.** Newer than the 1.x line; 2.x is the current
    major and the JSON schema is stable.
* **Known limitations:**
  * The mobile vitest pipeline is a no-op. Adding the proper
    Metro + `jest-expo` test runner is Phase 14 work.
  * `helmet`'s default CSP is shipped; a hardened CSP (no
    `unsafe-inline`, explicit `connect-src`) lands in Phase 16.
  * No CI workflow yet — that is Phase 19.
* **Next recommended phase:** Phase 2 — Database schema + Prisma.

### Phase 2 — Database schema + Prisma (completed)
* Prisma 5.22 schema with **37 tables** covering the full MVP
  domain (identity, tenancy, seniors, care circles, medications,
  appointments, care tasks, health measurements, documents, family
  feed, messaging, notifications, emergency alerts, audit log,
  consent, invitations, subscriptions).
* **Ownership model:** `SeniorProfile` is the care-relevant entity;
  `User` is the login identity (1:1 optional via `User.seniorProfileId`).
  A senior without a login is fully supported.
* **Tenancy:** row-level multi-tenancy via nullable `organizationId`
  on all tenant-scoped tables; `NULL` = private family.
* **Authorization backbone:** `CareCircleMember` with `CircleRole`
  (`FAMILY_ADMIN`, `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR`, `OBSERVER`)
  is the single ACL for senior-scoped access. `FAMILY_ADMIN` is
  per-circle; `SUPER_ADMIN` is global and only for `/admin/*`.
* **Medication adherence:** three-layer model
  `Medication` → `MedicationSchedule` → `MedicationDose` (unique
  per `medicationId + scheduledAt`). Doses carry `DoseStatus`
  (`PENDING`/`TAKEN`/`SKIPPED`/`MISSED`/`SNOOZED`).
* **Health measurements:** flexible JSONB `value` with
  `HealthMeasurementType.schema` (`scalar` or `compound` for
  blood pressure). 5 built-in types seeded (BP, HR, glucose, SpO2,
  weight).
* **Documents:** metadata only (`storageKey`, `contentHash`,
  `scanStatus`); binaries in MinIO. `DocumentAccess` for additive
  grants beyond care-circle membership.
* **Emergency alerts:** state machine (`DETECTED` → `ACKNOWLEDGED`
  → `ESCALATED` / `RESOLVED` / `FALSE_ALARM`) with de-dup via
  `(seniorId, source, externalId)`.
* **Consent:** first-class records with `scope`, `grantedAt`,
  `expiresAt`, `revokedAt`, `revocationReason`.
* **Audit log:** append-oriented, no UPDATE/DELETE for app role
  (enforced by grants in Phase 16). Tracks actor, action, resource,
  metadata, requestId, IP, UA.
* **Indexes:** 23 composite/partial indexes for senior lookups,
  care-circle membership, medication dose dates, appointments,
  tasks, measurements, notifications, audit events.
* **Deletion:** soft delete on 6 tables (`User`, `SeniorProfile`,
  `Medication`, `Appointment`, `CareTask`, `HealthDocument`);
  CASCADE on child-owned entities; RESTRICT/SET NULL where data
  integrity requires it.
* **Prisma setup:** `PrismaModule` + `PrismaService` wired into
  NestJS. Health endpoint now probes DB (`phase: 2`).
* **Migration:** `20260904042815_init` (enables `pgcrypto` +
  creates all 37 tables + indexes + enums). Verified reproducible
  via `migrate reset --force` → `migrate deploy` → `db seed`.
* **Seed:** deterministic, idempotent, 6 demo users, 1 senior,
  1 org, 1 care circle, 2 meds, 15 doses, 2 appts, 3 tasks,
  21 measurements, 3 notifications, 1 consent, 1 audit entry.
* **Tests:** 2 unit + 4 DB integration (unique email, CASCADE
  doses, SET NULL on senior profile, table presence).
* **Phase 2 gate:** all four validations green + migration status
  clean + DB reproducible + seed idempotent.
* **Deviations from plan:**
  * UUID v4 via `gen_random_uuid()` instead of v7 (no custom
    function; acceptable for MVP).
  * `HealthMeasurement.value` is JSONB (not split columns) to
    support compound measurements without a wide table.
  * `RefreshToken` table created now (Phase 3 will consume it).
* **Documentation:** `docs/DATABASE.md` created with entity summary,
  ownership/tenancy/authz models, index rationale, deletion
  strategy, migration strategy, decisions, and validation checklist.
* **Next recommended phase:** Phase 3 — Authentication + RBAC.

