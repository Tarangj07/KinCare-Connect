# Elderly Care Coordination Platform (ECC)

A multi-tenant coordination platform for elderly care: families, professional
caregivers and the seniors they support use it to share health measurements,
documents, schedules, care tasks, medication history, messaging and emergency
alerts.

Design documents: `ARCHITECTURE.md`, `THREAT_MODEL.md`, `SECURITY.md`,
`COMPLIANCE.md`. The active plan and its current milestone are in
`PROJECT_PLAN.md`. Phase-by-phase history is in `docs/PHASE_*.md` and is kept
as written at the time of each phase.

## Status

The platform is **implemented and locally verified, not externally verified**.

- Functionally complete through the feature set described below, with unit,
  integration and security e2e suites, a Prisma schema of 36 models, and a
  hardened container/CI/release gate suite.
- Every assurance claim in this repository has been checked against a local
  toolchain (Node, pnpm, Docker). See *What is verified* below for the exact
  boundary of that claim.
- There is **no staging environment and no CI run**. GitHub Actions has never
  executed against this repository, because the security and release work
  after `Phase 17` has not been committed or pushed. This is a release
  blocker, recorded in `docs/PHASE_26_FINAL_REPORT.md`.
- Phase 26 is the current milestone. Phase 27 has not started.

## Requirements

| Tool    | Version                              |
| ------- | ------------------------------------ |
| Node    | `>=22.13.0` (engines); CI and images pin Node 24 |
| pnpm    | `11.25.0` (pinned via `packageManager`, activated by Corepack) |
| Docker  | Required for local Postgres and for the container verification gate |

`pnpm-lock.yaml` is committed and must stay byte-identical to the lockfile
`packageManager` resolves. There are no dependency upgrades in flight.

## Quick start

```bash
# 1. Activate the pinned pnpm.
corepack enable

# 2. Install dependencies (frozen lockfile).
pnpm install --frozen-lockfile

# 3. Copy and edit the environment templates.
cp .env.example .env
cp apps/api/.env.example apps/api/.env
#    Set JWT_ACCESS_SECRET to a value of >=32 characters. The placeholder in
#    the template is deliberately rejected by the production validator.

# 4. Start local infrastructure and apply migrations.
docker compose up -d postgres
pnpm --filter @ecc/api prisma:migrate:deploy

# 5. Run the apps (separate terminals).
pnpm --filter @ecc/api dev     # NestJS API, http://localhost:3000
pnpm --filter @ecc/web dev     # Next.js,   http://localhost:3001
```

### About Redis and MinIO

`docker-compose.yml` still defines `redis` and `minio` services from the
original monorepo scaffold. **Neither is used by the application.** Documents
are stored on the local filesystem under `STORAGE_DIR` (see
`docs/MESSAGING.md` and the storage service), and no Redis client is a
dependency. Compose defines them; nothing connects to them. They are legacy
scaffold, not part of the supported deployment model, and no migration to
Redis or S3 has been designed or attempted.

Only `postgres` is required.

## Workspace layout

```
apps/
  api/         NestJS HTTP API (port 3000) — the only server in production
  web/         Next.js (port 3001), dashboard and family-facing client
  mobile/      Expo / React Native client
packages/
  config/      Shared ESLint and TypeScript configurations
  types/       Cross-app TypeScript types and zod schemas
  validation/  Reusable zod validation schemas
  ui/          Design tokens and shared component primitives
```

## The system

### API (`apps/api`)

NestJS 10 on Express. Modules: `appointments`, `care-tasks`, `documents`,
`emergency`, `feed`, `health`, `medications`, `messaging`, `notifications`,
plus `auth`, `common`, `config` and `storage`.

- **Auth** — access tokens in `httpOnly` cookies, rotating refresh tokens
  persisted for revocation, a password policy module, and an in-memory
  rate-limit guard.
- **Authorization** — organization membership plus care-circle role checks,
  enforced per route and asserted structurally over the compiled Nest route
  table by `verify:routes`.
- **Validation** — a global `ValidationPipe` configured with `transform`,
  `whitelist` and `forbidNonWhitelisted`. All three are asserted at the source
  level by `scripts/verify-config-contract.mjs` and mutation-tested; see WS1 of
  `docs/PHASE_26_FINAL_REPORT.md`.
- **Input validation** — DTO `class-validator` classes plus reusable zod
  schemas in `packages/validation`.
- **Hardening** — Helmet, an owner-only `STORAGE_DIR`, an explicit body-size
  limit, a global exception filter that returns a consistent envelope, and a
  request-id middleware that stamps every response and log line.
- **Fail-closed configuration** — `assertRuntimeConfig()` refuses to boot a
  production process whose configuration cannot support one (JWT secret
  present, non-placeholder and long enough; `STORAGE_DIR` writable).

### Data

Prisma 5 against PostgreSQL 16. 36 models covering users, organizations and
subscriptions, senior and caregiver profiles, care circles, contacts,
medications and schedules, appointments, reminders, care tasks, health
measurements and devices, documents and access grants, family updates and
comments, conversations and messages, notifications and preferences, emergency
alerts, audit logs, consent and invitations.

Documents are stored on the filesystem under `STORAGE_DIR` with `0700`
directories and `0600` files, and referenced by metadata rows in PostgreSQL.

### Web (`apps/web`)

Next.js App Router dashboard. Health page reads `NEXT_PUBLIC_API_URL` at
runtime (not baked at build time), which the release-artifact gate asserts.

### Mobile (`apps/mobile`)

Expo client. Not exercised by the container or release gates.

## Verification

Gates live in `scripts/` (repository-wide) and `apps/api/scripts/` (API
specific). Run them sequentially — several rebuild `apps/api/dist` and
`tsconfig.build.tsbuildinfo`, and running two at once makes one delete the
artifact the other is executing.

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build

# API
pnpm --filter @ecc/api verify:metadata        # + verify:metadata:mutate
pnpm --filter @ecc/api verify:routes          # + verify:routes:mutate
pnpm --filter @ecc/api verify:lifetime:mutate
pnpm --filter @ecc/api verify:auth:compiled
pnpm --filter @ecc/api build:verify

# Repository-wide
node scripts/verify-config-contract.mjs   # + mutate-config-contract.mjs
node scripts/verify-env-contract.mjs
node scripts/verify-db-migrations.sh      # provisions its own throwaway PostgreSQL
node scripts/verify-release-artifact.mjs  # provisions its own throwaway PostgreSQL
node scripts/verify-docker-images.mjs     # + mutate-container-gate.mjs
node scripts/verify-dependency-audit.mjs
node scripts/verify-dependency-triage.mjs
node scripts/verify-ci-parity.mjs
```

Every database-using gate provisions and destroys its own throwaway
PostgreSQL container with a unique name and an ephemeral loopback port. The
development database `ecc` is never a target. `scripts/verify-release-artifact.mjs`
and `scripts/verify-db-migrations.sh` both rebuild the API `dist` directory and
must not run concurrently.

### What is verified

Reproduced locally against this tree:

- typecheck, lint, unit tests and the e2e/security suites
- build determinism: clean, warm and stale-tsbuildinfo builds all emit the
  entry point; two clean builds of identical sources are byte-identical
- `dist` contains exactly the source modules, no test material, no credential
- the compiled artifact boots, serves health, and drains on SIGTERM
- structural authorization over the compiled route table
- Nest decorator metadata survives compilation
- migrations apply to an empty database, are idempotent, and reproduce on a
  second database; the application runs against the migrated schema
- no committed secret, no credential baked into an image, no secret in a
  client bundle, `NEXT_PUBLIC_API_URL` read at runtime
- environment/configuration contract: documented variables, ports, and Node /
  pnpm versions are internally consistent across templates, code, Dockerfiles
  and CI
- gate determinism: the mutation harnesses prove each gate rejects the defect
  class it claims to catch

### What is NOT verified

Stated plainly, because a green local gate suite is often read as more than it
is:

- **GitHub Actions has never run.** There is no run ID. `ci.yml` exists and is
  structurally audited by `verify-ci-parity.mjs`, and every locally-runnable
  command is executed locally, but the hosted runner, its service containers
  and its action versions are unverified.
- **No staging environment exists.** No cloud infrastructure, Kubernetes,
  Terraform or Helm. All container and database verification above is
  **LOCAL**, against throwaway containers, and must not be described as
  staging.
- **No production deployment has occurred or been rehearsed.**
- **No backup or restore has been tested.** Nothing in the repository performs
  one, and no claim to that effect should be made.
- **No penetration test, no load or soak testing, no chaos testing.**
- **No compliance certification.** See `COMPLIANCE.md` for exactly which
  technical controls are evidenced and which regulatory obligations remain
  unimplemented.

### Remaining release blockers

1. Phase 18–26 work is uncommitted on `main`; `origin/main` is at an earlier
   commit and lacks this work. It cannot reach a CI runner until it is
   committed, pushed, and the divergence reconciled.
2. No staging environment, so no deployment has been attempted.
3. No backup/restore procedure has been exercised.
4. Lint has a known, tracked baseline of 55 errors / 69 warnings that must not
   grow. It is enforced as an advisory CI step, not as a blocking gate.

## Repository layout

```
apps/            Application workspaces
packages/        Shared libraries
scripts/         Repository-wide verification and mutation gates
docs/            Design and phase documents
.github/         CI workflow (never yet executed)
```

## Documentation

| Document | Contents |
| -------- | -------- |
| `ARCHITECTURE.md` | System design |
| `THREAT_MODEL.md` | Threats, mitigations, residual risk |
| `SECURITY.md` | Security posture and controls |
| `COMPLIANCE.md` | Evidence-backed control inventory and explicit gaps |
| `PROJECT_PLAN.md` | Active plan and current milestone |
| `PROJECT_PLAN-old.md` | Preserved pre-Phase-18 snapshot; not maintained |
| `docs/PHASE_*.md` | Per-phase records, including final reports |
| `docs/DATABASE.md`, `docs/MESSAGING.md` | Topic references |
| `SECURITY_REVIEW_PHASE_*.md` | Reviewer-owned security reviews |

`SECURITY_REVIEW_*` files are produced by independent reviewers, not by the
implementer of the phase they review.
