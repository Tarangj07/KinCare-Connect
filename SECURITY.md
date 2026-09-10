# SECURITY.md

> Engineering security controls. Pair with `THREAT_MODEL.md` (which
> lists threats, mitigations, and residual risk) and `COMPLIANCE.md`
> (which we will add in Phase 1 to document the legal / organisational
> controls that remain the deployer's responsibility).

This file is split into two parts:

1. **Implementation status** — what the running code does *today*.
2. **Planned controls** — what each phase will add.

Items in part 1 are checked off only when the code that enforces them
exists, has tests, and is exercised by CI.

---

## 1. Implementation status

### Phase 0
Repository was empty. No code-level controls in place.

### Phase 1 — Monorepo foundation
* `helmet` middleware with default CSP, HSTS, COOP, CORP,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
* Request ID middleware (`x-request-id`) on every request.
* Global exception filter mapping all errors to stable
  `{ error: { code, message, requestId } }` shape; no stack traces.
* Zod validation pipe configured to forbid unknown fields.
* No secrets in source; `.env.example` lists all variables.

### Phase 2 — Database schema + Prisma
* **Schema design** enforces authorization at the data layer:
  * `CareCircleMember` is the single ACL for senior-scoped access.
  * `User.globalRole` does **not** grant senior access (except
    `SUPER_ADMIN` for `/admin/*`).
  * `organizationId` is nullable on all tenant-scoped tables;
    `NULL` = private family.
* **Soft delete** only where undelete is real product requirement
  (User, SeniorProfile, Medication, Appointment, CareTask,
  HealthDocument). Audit logs are **never** soft-deleted.
* **CASCADE** on child-owned entities (doses, schedules, task
  assignments, appointment participants, messages, document
  accesses). **RESTRICT/SET NULL** where integrity requires it
  (measurement types, uploader references).
* **RefreshToken table** created with `tokenHash` (SHA-256),
  `familyId` for rotation-chain revocation, `replacedById` for
  reuse detection. Plaintext tokens are never persisted.
* **No PHI in audit logs** — `AuditLog.metadata` is documented as
  "do not place PHI or secrets here"; references by ID only.
* **Indexes** for authorization queries: `(userId, status)`,
  `(seniorId, status)` on `care_circle_members`; `(seniorId,
  scheduledAt)` on `medication_doses`; `(actorUserId, createdAt)`
  on `audit_logs`.
* **Reproducibility:** migration `20260904042815_init` enables
  `pgcrypto` and creates all 37 tables. Verified reproducible via
  `migrate reset --force` → `migrate deploy` → `db seed`.

## 2. Planned controls

The list below maps to the threat model. Each control lists the
phase that introduces it; the actual implementation status moves to
part 1 as the code lands.

### 2.1 Cryptography

* **Password hashing.** Argon2id (memory ≥ 64 MiB, iterations ≥ 3,
  parallelism 1) via `argon2` Node module. (Phase 3)
* **Refresh-token storage.** Stored as Argon2id hashes keyed by a
  random 256-bit secret. Plaintext is never persisted. (Phase 3)
* **JWT signing.** HS256 in dev; RS256 with a KMS-managed key in
  production. Public keys cached in Redis with TTL. (Phase 3 / 16)
* **TLS.** TLS 1.2+ everywhere. HSTS with `max-age=63072000;
  includeSubDomains; preload`. (Phase 1)
* **Encryption at rest.** Rely on the managed Postgres provider
  (RDS / Cloud SQL) for disk encryption. Document the assumption in
  `DEPLOYMENT.md`. (Phase 19)

### 2.2 Authentication

* Email + password registration with optional TOTP (Phase 16).
* Login with constant-time response, account lockout after 10
  failed attempts in 15 minutes, per-IP and per-account rate limit
  on `/auth/login` and `/auth/refresh`. (Phase 3)
* Refresh-token rotation on every use; reuse detection revokes the
  entire family. (Phase 3)
* Logout invalidates the refresh token row. (Phase 3)
* Password reset uses a single-use, 30-minute token sent by email;
  the response is identical whether the account exists or not. (Phase 3)
* Email verification stub (the link is logged in dev; provider
  integration is a Phase 8 task). (Phase 3)

### 2.3 Authorization

* `RolesGuard` for global role checks (`@Roles('SUPER_ADMIN')`).
  (Phase 3)
* `SeniorAccessGuard` factory for every senior-scoped endpoint.
  Resolves the caller's `CareCircleMember` row and compares the
  required action against the per-circle role. (Phase 4)
* All conversation / realtime join handlers reuse the same guard
  via a `canAccessSenior(userId, seniorId)` server function. (Phase 11)
* No resource is reachable without the guard. Lint rule (Phase 16)
  flags controllers in `apps/api/src/modules/**` that import
  `Controller` without a `@UseGuards(...)` decorator.

### 2.4 Input handling

* Every controller uses `ZodValidationPipe` with a schema from
  `packages/validation`. (Phase 3, expanded in every feature phase)
* No raw SQL outside `prisma/seed.ts`. (Phase 2)
* File uploads validated by content sniffing (not just extension)
  and rejected against a deny-list. (Phase 12)

### 2.5 Output handling

* All React / React Native text is rendered as text by default; no
  `dangerouslySetInnerHTML` in the codebase (lint rule). (Phase 14, 15)
* Error responses use the standard shape and never include
  `stack`, `error.message` for known classes, or request bodies.
  (Phase 3)
* Health-data modules are added to the logger's `redact` list. (Phase 9)

### 2.6 Transport security

* `helmet` with a hardened CSP (`default-src 'self'`,
  `connect-src 'self' https://api.ecc.example`,
  `frame-ancestors 'none'`, no `unsafe-inline`).
* CORS: explicit origin allow-list (no wildcards in production);
  the mobile and web clients each have their own entry.
* HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy` denying
  unused capabilities. (Phase 1, tightened in 16)

### 2.7 Rate limiting

* Global per-IP token bucket on every route.
* Per-user token bucket once authenticated.
* Per-route hard limits on auth, document presign, and emergency
  alert endpoints. (Phase 3, 8, 12, 13)

### 2.8 Secrets management

* No secrets in source. `.env` is git-ignored; `.env.example` lists
  every variable with a safe default or empty value.
* Local dev secrets are produced by Docker Compose; production
  secrets live in the cloud's secret manager and are surfaced as
  env vars to the container. (Phase 1, 19)
* Pre-commit / CI check: `gitleaks` (or equivalent) blocks commits
  containing known patterns. (Phase 16)

### 2.9 Audit logging

* Append-only `audit_logs` table. Insertions are made via a
  dedicated `AuditService` that is the **only** writer. The table
  has no `UPDATE` or `DELETE` permissions for the application role.
* Entries: `id`, `actorUserId`, `actorType` (`USER` | `OPERATOR` |
  `SYSTEM`), `action`, `resourceType`, `resourceId`, `metadata`
  (jsonb), `ip`, `userAgent`, `requestId`, `createdAt`.
* Sensitive actions covered: login, logout, failed login, password
  change, role change, care-circle membership change, health record
  access, document access, medication changes, appointment changes,
  emergency alert state changes, subscription changes. (Phase 3, 4,
  9, 12, 13)

### 2.10 Dependency hygiene

* `pnpm audit --prod` runs in CI on every PR.
* Renovate (or Dependabot) keeps direct dependencies current.
* Production image is rebuilt weekly to pick up base-image patches.
* A `SBOM` (CycloneDX) is produced on every release. (Phase 19)

### 2.11 Privacy by design

* Minimum-necessary default: a new `SeniorProfile` exposes no health
  data until at least one medication or measurement is recorded.
* The "Who can see this senior?" screen is the first thing a family
  admin sees after creating a senior. (Phase 4)
* Consent records (care-data sharing, health integrations,
  document access) are first-class entities with revocation
  semantics. (Phase 4, 12, 13)

### 2.12 Operational

* `/healthz` (liveness — process up) and `/readyz` (readiness —
  Postgres + Redis reachable) endpoints, no PHI. (Phase 1, expanded 18)
* Error tracking via a self-hosted or managed provider. PII
  redaction at the SDK level. (Phase 18)

---

## 3. Secure development workflow

* Every PR is reviewed by at least one other engineer.
* Security-sensitive PRs (auth, payments, audit log) require a
  second reviewer with the `security` label.
* Every phase gate (see `PROJECT_PLAN.md` §3) includes a
  security-review step.

---

## 4. Disclosure

* We will publish a security contact and a PGP key in
  `.well-known/security.txt` once the public domain is finalised.
* Until then, security issues can be reported by email to the
  maintainer listed in `README.md`.
