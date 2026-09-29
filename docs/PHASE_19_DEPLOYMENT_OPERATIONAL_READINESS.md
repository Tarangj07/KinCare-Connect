# Phase 19 — Deployment & Operational Readiness

**Checkpoint base:** `d0cd0dd` — Complete Phase 17 testing CI and reliability, plus the uncommitted, independently approved Phase 18 implementation and post-review cleanup.
**Status:** Implementation and verification complete. **No commit created. No deployment performed.**
**Scope:** Deployment configuration, environment correctness, startup/shutdown behaviour, health/readiness, and operational safety. **No product features.**

---

## 1. Objective

Make the existing KinCare-Connect application safe to run in a realistic
deployment environment, and make the deployment contract explicit and
verifiable. This phase configures, validates, and documents; it does not
deploy to any cloud account and does not introduce an infrastructure platform.

## 2. Scope

In scope: environment contract accuracy, production startup validation,
liveness/readiness separation, graceful shutdown, storage deployment contract,
database migration readiness, CI deployment-readiness validation, web
production configuration, Docker image correctness, operational documentation.

Explicitly out of scope: product features, realtime/WebSockets, push/SMS/email
providers, AI/LLM, OCR, EHR, GPS, payments, subscriptions, UI redesign,
dependency upgrades, cloud infrastructure (Kubernetes/Terraform/Helm), and
automatic production deployment.

## 3. Repository baseline

```text
HEAD: d0cd0dd  Complete Phase 17 testing CI and reliability
Uncommitted (approved): Phase 18 implementation + post-review cleanup
Pre-existing user changes, untouched: PROJECT_PLAN.md (M), PROJECT_PLAN-old.md,
  SECURITY_REVIEW_PHASE_16/17/18.md (untracked)
```

Phase 19 was developed on top of the approved uncommitted Phase 18 tree and
does not modify any Phase 13–18 source file. Verified by mtime: every
Phase 16/17/18 security file retains its pre-Phase-19 timestamp.

## 4. Existing deployment architecture (verified, not assumed)

Phase 19 inspected what already existed before changing anything:

| Component | Pre-existing state |
| --- | --- |
| `apps/api/Dockerfile` | **Existed** (added in Phase 1, `d42dcd2`). Multi-stage. Had two defects — see §12. |
| `apps/web/Dockerfile` | **Existed** (Phase 1). Multi-stage. Would **fail to build** — see §12. |
| `docker-compose.yml` | **Existed.** Postgres, Redis, MinIO + bootstrap, with healthchecks and named volumes. **No application services** — still the case. |
| `.dockerignore` | Existed. |
| `.github/workflows/ci.yml` | Existed (Phase 17): typecheck, build, build-determinism, unit + integration tests, advisory lint. |
| `/api/v1/health` | Existed: liveness and readiness conflated, with a database round-trip and a raw driver error echoed to an unauthenticated caller. |
| Graceful shutdown | **Absent** — `enableShutdownHooks()` was never called, so `PrismaService.onModuleDestroy` (`$disconnect`) never ran on SIGTERM. |
| Production env validation | Partial: JWT secret (Phase 16) and `STORAGE_DIR` (Phase 18) threw at their own construction points, but nothing validated `DATABASE_URL` and there was no single pre-flight. |

## 5. Environment contract

Audited every variable actually read by `apps/api`, `apps/web`, `apps/mobile`,
and CI tooling (both `process.env['X']` and `process.env.X` forms, plus
Prisma's `env("DATABASE_URL")` in `schema.prisma`, plus `docker-compose.yml`
`${…}` interpolation).

### Variables the application actually consumes

| Variable | Consumer | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma (`schema.prisma`) | **All environments** | Validated at startup: must be a `postgres://`/`postgresql://` URL. |
| `JWT_ACCESS_SECRET` | `security-config.ts` | **Production** | ≥32 chars, not a placeholder. Fails fast (Phase 16). |
| `STORAGE_DIR` | `storage.service.ts` | **Production** | Fails fast (Phase 18); permissions now verified (§8). |
| `NODE_ENV` | security-config, rate-limit guard, storage, cookie | Optional | `production` activates secure cookies, mandatory secret, mandatory storage. |
| `PORT` | `main.ts` | Optional | Default `3000`. |
| `NEXT_PUBLIC_API_URL` | `apps/web` | Optional | Build-time, browser-visible. **Never a secret.** |
| `expo.extra.apiBaseUrl` | `apps/mobile` | Optional | Read from `app.json`, **not** from an env var. |
| `ECC_TEST_DISABLE_RATE_LIMIT` | test harness only | **Test-only** | Ignored unless `NODE_ENV=test`; ignored entirely when `NODE_ENV=production`. Must never be set in a deployment. |

### Templates corrected

- **`.env.example` (root)** — was materially inaccurate and is now the single
  deployment-oriented reference. Removed: `API_BASE_URL`, `JWT_REFRESH_SECRET`,
  `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `WEB_ALLOWED_ORIGINS`, `LOG_LEVEL`,
  `EXPO_PUBLIC_API_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` — all confirmed read by
  nothing. Added: `STORAGE_DIR` (which Phase 18 made mandatory but which was
  documented nowhere), and `ECC_TEST_DISABLE_RATE_LIMIT` marked test-only.
  **Fixed a live bug:** `DATABASE_URL` pointed at port `5432` while
  `docker-compose.yml` publishes the container's 5432 on host port `5433`.
  All ten variables `docker-compose.yml` interpolates were retained.
- **`apps/api/.env.example`** — left as Phase 18 produced it; already
  accurate and free of the stale entries.
- **`apps/mobile/.env.example`** — documented `EXPO_PUBLIC_API_URL`, which
  nothing consumes; replaced with an explanation of the real mechanism
  (`expo.extra.apiBaseUrl` in `app.json`).

**Regression guard:** `scripts/verify-env-contract.mjs` (run in CI) asserts
that required variables are documented, that the eleven known-dead variables
stay absent, and that the test-only opt-out is not presented as normal
configuration. It exits non-zero on violation (verified: exit 1 when a stale
variable is injected, exit 0 when clean).

**No hardcoded security-sensitive value was made configurable.** Access-token
TTL (15m) and refresh-cookie TTL (30d) remain hardcoded; the template now
says so instead of implying otherwise.

## 6. Production startup requirements

New `src/config/runtime-config.ts` runs `assertRuntimeConfig()` as the first
statement of `bootstrap()`, before Nest initialises anything.

- **Fail closed.** An invalid production configuration aborts startup. It
  never falls back to a development default.
- **No rule was relaxed.** The JWT check *invokes* the existing
  `resolveJwtAccessSecret` rather than re-implementing it, and the
  `STORAGE_DIR` rule reuses the Phase 18 policy, so the two cannot drift.
- **No secret disclosure.** Errors name the variable and the requirement,
  never a value. Verified live: a short secret produces
  `JWT_ACCESS_SECRET must be at least 32 characters.` with no value, and an
  invalid `DATABASE_URL` produces no host, port, or password.
- **Non-production is not over-constrained.** `STORAGE_DIR` remains optional
  in development/test; `DATABASE_URL` is required everywhere.

Verified live against the built artifact (all three abort startup):

| Scenario | Result |
| --- | --- |
| production, no `STORAGE_DIR` | refuses: `STORAGE_DIR is required when NODE_ENV=production…` |
| production, 10-char secret | refuses: `JWT_ACCESS_SECRET must be at least 32 characters.` |
| production, `STORAGE_DIR` at `0755` | refuses: `must not be accessible to group or other users` |
| production, fully valid | starts, `listening on :3199` |

## 7. Database readiness

- `prisma validate` — **PASS** ("The schema at prisma/schema.prisma is valid").
- Fresh-database `prisma migrate deploy` — **PASS** (both migrations applied).
- `prisma migrate status` — **PASS** ("Database schema is up to date!").
- Application startup against the migrated schema — **PASS** (live, §6/§9).
- Test isolation — every DB-backed run used a dedicated throwaway database;
  the development database was never written to.

**No Prisma schema or migration change was made or required.** The Prisma
image now ships `prisma/` so `migrate deploy` can be run from the container
as a deployment step; that is packaging only.

## 8. Storage readiness

Phase 18's hardening is **preserved, not duplicated or weakened**: directories
are still created `0700`, files still written `0600`, path containment is
untouched, and nothing is silently chmod-ed.

Phase 19 added *verification* of the deployment contract, because Phase 18's
modes only apply to paths the process creates — a directory provisioned by an
operator or mounted as a volume can already exist with looser permissions:

- A configured `STORAGE_DIR` that is **not a directory** → startup fails.
- A configured `STORAGE_DIR` readable/writable by **group or other** →
  startup fails in production; logs a warning in development.
- An existing directory is **never** silently tightened; the operator is told
  the required mode and how to fix it.

Verified live (0755 → refused) and by 6 new behavioural tests, including one
that asserts a `0750` directory is left at `0750` after a refusal (proving no
silent chmod).

## 9. Health/readiness behaviour

The two probes were previously conflated in one endpoint, which both mixed
liveness with a dependency check and echoed the raw driver error to an
**unauthenticated** caller.

| Endpoint | Purpose | DB touched | Status codes |
| --- | --- | --- | --- |
| `GET /api/v1/health` | **Liveness** — is the process healthy? | No | always `200` |
| `GET /api/v1/health/ready` | **Readiness** — should this instance take traffic? | `SELECT 1` | `200` ready, `503` not ready |

- A database outage can no longer make a running process report unhealthy to
  an orchestrator's liveness probe.
- **Disclosure removed:** the previous `database.detail` returned the raw
  driver message, which can reveal the database host, port, and name. Failures
  now report only a status. A test asserts a realistic driver message
  (`Can't reach database server at \`db.internal:5432/ecc\``) never reaches
  the response.
- The stale `phase: 2` marker (a project milestone, not a deployment
  property) was removed, and the web health page was updated to match.
- Neither route is an authorization bypass: both were already unauthenticated,
  expose no user/senior/document data, and perform no lookup beyond `SELECT 1`.

Verified live: `/health` → `200 {"status":"ok","service":"api"}`;
`/health/ready` → `200 {"status":"ok","service":"api","database":{"status":"ok"}}`.
Separately verified live: the API **refuses to start** when the database is
unreachable at boot (Prisma `$connect` fails), so the 503 path is reachable
only for a database that fails *after* startup — covered by unit tests.

## 10. Graceful shutdown

`PrismaService.onModuleDestroy` (`$disconnect`) existed but was never invoked,
because `main.ts` never called `app.enableShutdownHooks()`. A container stop
therefore dropped in-flight queries and left the pool to the server's own
timeouts.

One line was added: `app.enableShutdownHooks()`. Nest now registers SIGTERM
and SIGINT handlers, stops accepting connections, lets in-flight requests
finish, and runs `onModuleDestroy` before exit.

Verified live: the process started, served `/health`, and **exited cleanly on
SIGTERM**. No worker or queue architecture was introduced (there is none).

## 11. Web production configuration

- `NEXT_PUBLIC_API_URL` is the only web environment variable. It is a URL,
  browser-visible by design, and carries **no secret**. No other
  `NEXT_PUBLIC_*` variable exists.
- The health page no longer renders the raw fetch error, which on a public
  page could disclose the internal API host; it reports a generic message.
- The stale `phase` field was removed from the page.
- `next.config.mjs` enables no `output: 'standalone'`, so the image ships
  `.next` + `node_modules`; the Dockerfile comment claiming "standalone
  output" was corrected to describe what is actually done.

## 12. CI validation

Added to the `api` job — validation only, using the job's existing ephemeral
Postgres service and throwaway values. **No cloud credentials, no production
secrets, no deployment.**

1. `verify-env-contract.mjs` — templates match the code.
2. Production contract enforced fail-closed — a valid production config must
   be accepted, an invalid one must abort startup, and the failure must name
   the missing variable.
3. Deployment smoke test — start the API in production mode, probe liveness
   and readiness, then assert the process **exits on SIGTERM**.
4. Artifact sanity — `dist/main.js`, `prisma/schema.prisma`,
   `prisma/migrations/` present; no spec/test files and no `dist/testing` in
   the production build.

### Dockerfile defects fixed (both pre-existing since Phase 1)

- **`apps/api/Dockerfile`** — line 26 was
  `COPY --from=build /repo/packages ./node_modules/@ecc 2>/dev/null || true`.
  `COPY` has no shell, so the `2>/dev/null || true` tokens are invalid; and
  the compiled API has **no runtime import of any `@ecc/*` package**, so the
  copy was unnecessary. Removed. Also: the invalid `COPY` was replaced with a
  `prisma/` copy so migrations can be deployed from the image, and a
  `HEALTHCHECK` was added against the liveness endpoint.
- **`apps/web/Dockerfile`** — copied `apps/web/public`, **which does not
  exist**, so the image build would fail at that `COPY`. Created
  `apps/web/public/.gitkeep`. Also replaced `CMD ["npx", "next", "start"…]`
  with the installed binary path, so the runtime image does not attempt
  package resolution at container start.

`ENV NODE_ENV=production` is preserved in both images, which is what makes
the Phase 16/18 fail-closed rules active in a container.

## 13. Security boundary (Phase 19 sanity check)

| Check | Result |
| --- | --- |
| Authentication bypass introduced | **No.** `JwtAuthGuard`, HS256 pinning, and the mandatory `sub` claim are untouched. |
| Authorization changes | **No.** No `AuthorizationService`, role, or ACL file was modified. Document/emergency/messaging authorization is byte-identical. |
| IDOR / BOLA | **No.** No resource-access code changed. |
| Secret exposure | **No.** Startup errors were empirically confirmed free of values, hosts, and connection strings. |
| Unsafe health-endpoint disclosure | **Fixed, not introduced** — the raw driver error is gone; a regression test pins it. |
| Path traversal | **No.** Storage containment untouched and still tested. |
| Insecure storage permissions | **No.** Phase 18 modes preserved; the contract is now additionally *verified*. |
| Production test-mode bypass | **No.** `ECC_TEST_DISABLE_RATE_LIMIT` remains inert unless `NODE_ENV=test`, and inert entirely when `NODE_ENV=production`. The rate-limit guard is untouched by this phase. |
| Client-side privilege decisions | **No.** The web app still holds no authorization logic. |
| New dependencies | **None.** No lockfile change. |
| Prisma schema/migrations | **None.** |

Phase 16–18 controls re-verified present: HS256 pinning, required `sub`,
JWT fail-fast, lockout, `isActive` checks, `endsAt` enforcement, storage
0600/0700, `storageKey` stripping, P2025 race mapping, request-ID
sanitization, rate-limit production proof.

### Recorded, not fixed (outside Phase 19 scope)

- The API and web Dockerfiles install with `--frozen-lockfile=false`, which
  can resolve newer versions than the lockfile pins. Changing it was **not**
  attempted because the images cannot be built in this environment, and an
  unverifiable change to a production build is worse than a documented one.
- Both images run as **root**. Running as a non-root user is the correct
  hardening, but it requires the `STORAGE_DIR` volume to be owned by that
  user, which cannot be validated here. Documented in §16.
- `next build` runs with `eslint.ignoreDuringBuilds`, so a lint regression is
  not caught by the image build. Pre-existing and deliberate (CI lints
  separately).

## 14. Tests executed

| Lane | Command | Result |
| --- | --- | --- |
| API unit | `pnpm --filter @ecc/api test` | **PASS** — 16 files / **153** |
| API integration | `pnpm --filter @ecc/api test:integration` | **PASS** — 5 files / **60** |
| API all (DB) | `pnpm --filter @ecc/api test:all` | **PASS** — 21 files / **213**, 0 failed, 0 skipped |
| API all (no DB) | `env -u DATABASE_URL … test:all` | **PASS** — 10 files / 109 passed / 104 DB-gated skipped / 0 failed |
| Mobile | `pnpm --filter @ecc/mobile test` | **PASS** — 6 files / **32** |
| Web | `pnpm --filter @ecc/web test` | **PASS** — **1** |
| Root | `pnpm test` / `test:integration` / `test:all` | **PASS** — 11/11 tasks |
| Env contract | `node scripts/verify-env-contract.mjs` | **PASS** (exit 0); fails correctly (exit 1) on injected drift |
| DB | `prisma validate` / `migrate deploy` / `migrate status` | **PASS** |
| Startup | live production boot, fail-closed cases, probes, SIGTERM | **PASS** |

New tests: `runtime-config.spec.ts` (14) and `health.controller.spec.ts`
(rewritten, 5) and `storage.service.spec.ts` (+6). Suite total 190 → 213.

## 15. Build / typecheck / lint results

| Gate | Result |
| --- | --- |
| API typecheck (main + seed + test) | **PASS — 0 errors** |
| Mobile typecheck | **PASS — 0 errors** |
| Web typecheck | **PASS — 0 errors** |
| API build — clean / warm | **PASS**, `dist/main.js` present both times |
| API `build:verify` | **PASS** |
| Web production build | **PASS** |
| API lint | **55 errors / 127 warnings — identical to the Phase 18 baseline** (one warning introduced by import order was fixed rather than absorbed) |
| Mobile lint | 0 errors / 8 warnings — pre-existing, untouched |
| Web lint | **PASS** — 0 problems |
| `git diff --check` | **clean** |

The 55 pre-existing API lint errors were not hidden and not fixed.

## 16. Known limitations

- **The Docker images were not built.** `docker build` requires a full
  workspace install and network access that this environment does not
  provide. The Dockerfiles were corrected by inspection and the equivalent
  behaviours they encode (startup validation, liveness/readiness, SIGTERM
  exit, artifact sanity) were each executed directly against the built
  application. **BLOCKED BY ENVIRONMENT — images unbuilt.**
- **`docker-compose.yml` still defines no application services.** Adding api
  and web services would be genuine deployment work and is left for a
  later, explicitly requested step.
- Running containers as root; `--frozen-lockfile=false` (both recorded in §13).
- Log output is plain `console`/Nest logging. `LOG_LEVEL` remains unimplemented
  by design; structured logging with PHI redaction is a later phase.
- No metrics, tracing, or error tracking. Out of scope by instruction.
- Backups: the application performs none. The only durable state is
  PostgreSQL (compose-managed named volume `postgres_data`) and the
  `STORAGE_DIR` document directory. Restoring either is an operator
  responsibility; `prisma migrate deploy` must be run after any restore.
- The rate limiter is still the Phase 3 in-process placeholder and is not
  shared across replicas. Unchanged by this phase.
- Redis and MinIO are still defined in compose with no application consumer.

## 17. Deferred work

- Application services in `docker-compose.yml`; a compose-based staging stack.
- Non-root container users and frozen-lockfile image builds (§13).
- TLS termination, domain configuration, secret-manager integration, and
  automated backup/retention for PostgreSQL and document storage.
- CORS configuration for a browser client (the API currently has none, which
  is the secure default; it is a functional prerequisite for web integration).
- Structured logging, metrics, and error tracking.
- Object storage (S3/MinIO) in place of the local filesystem.

## 18. Explicit Phase 20 boundary

**Phase 20 was NOT started.** No product features, realtime/WebSockets, push
or SMS/email providers, AI/LLM, OCR, EHR integration, GPS, payments,
subscriptions, UI redesign, dashboard functionality, or unrelated
refactoring. No placeholder or stub for a future phase was created.
`PROJECT_PLAN.md`, `PROJECT_PLAN-old.md`, and every `SECURITY_REVIEW_*`
artifact are unmodified. **No Git commit was created and nothing was pushed.**

---

## Operator quick reference

```bash
# 1. Provision PostgreSQL; set DATABASE_URL, JWT_ACCESS_SECRET (>=32 chars,
#    not a placeholder) and STORAGE_DIR (0700) in the process environment.
#    The API does not read .env files — export the variables.

# 2. Apply migrations.
#
#    From a checkout, the published command is:
pnpm --filter @ecc/api exec prisma migrate deploy
#
#    From the production IMAGE, invoke the CLI BY PATH (Phase 21, L-01):
docker run --rm -e DATABASE_URL="$DATABASE_URL" <image> \
  node_modules/.bin/prisma migrate deploy
#
#    The bare form `npx prisma migrate deploy` is WRONG for the image, for
#    two independent reasons:
#      - `prisma` is not on PATH in the runtime tree, so npx resolves nothing
#        and the inherited node-entrypoint rewrites argv to `node prisma ...`;
#      - `/app/prisma` is the migration *directory*, not a program, so that
#        fails with `Cannot find module '/app/prisma'`.
#    The equivalent that bypasses argv rewriting entirely is:
docker run --rm --entrypoint node -e DATABASE_URL="$DATABASE_URL" \
  <image> node_modules/prisma/build/index.js migrate deploy
#    Both forms are verified against a real image and a throwaway PostgreSQL
#    by scripts/verify-docker-images.mjs, and the migration path is verified
#    end to end on throwaway databases by scripts/verify-db-migrations.sh.

# 3. Build and start
pnpm --filter @ecc/api build
NODE_ENV=production PORT=3000 node apps/api/dist/main.js

# 4. Probes
curl -fsS http://localhost:3000/api/v1/health       # liveness   -> 200
curl -fsS http://localhost:3000/api/v1/health/ready  # readiness  -> 200 / 503

# 5. Stop: send SIGTERM; the process drains and disconnects Prisma.
```

> **Phase 23 correction.** The `npx prisma migrate deploy` line in the
> original version of this quick reference was copied from a checkout
> workflow and is wrong for the production image, which the API Dockerfile
> had already documented as a known trap. It is corrected above. The general
> lesson is recorded in
> `docs/PHASE_23_PRODUCTION_SECURITY_RELEASE_ASSURANCE.md`: documentation
> drift was found by auditing every published command against the artefact it
> applies to, not by reading the prose.

---

**Status:** implementation, tests, documentation, and verification complete.
Awaiting independent Phase 19 security/reliability review.
