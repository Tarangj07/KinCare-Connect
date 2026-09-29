# Phase 22 — CI and Deployment Runbook

**Scope:** the deployment model this repository *actually* supports today, verified end
to end by `scripts/verify-docker-images.mjs` and the GitHub Actions `containers` job.

**This document does not describe Kubernetes, Helm, Terraform, AWS, any registry, or any
orchestrator.** None of those are implemented here. Section 18 lists them explicitly as
unsupported so that no operator mistakes this for a gap to be filled by improvising.

Everything below was executed against real containers and a real PostgreSQL during Phase 22.
Where a command is quoted, it is the command that was run.

---

## 1. What the supported model is

One API container, one web container, one PostgreSQL database, one document-storage volume:

```
        browser / mobile
               |
        [ web container :3001 ]      node:24-alpine, Next.js standalone, uid 1000
               |
        [ API container :3000 ]      node:24-alpine, NestJS dist, uid 1000
             |            |
     [ PostgreSQL ]   [ STORAGE_DIR volume ]   documents, 0700/0600, uid 1000
```

There is no message broker, no cache, no object store, no service mesh. The API is
stateless apart from its storage volume, so replicas are safe as long as they all mount the
same storage.

---

## 2. Environment contract

The API validates its configuration **before** it opens a listening socket
(`apps/api/src/config/runtime-config.ts`). An invalid production configuration aborts
startup rather than half-configuring. Every message names the *variable* and the
requirement; none ever echoes a value, a secret, or a connection string.

### API — required in production

| Variable | Required | Rule | Failure message |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | must be `production` for the production rules to apply | — |
| `DATABASE_URL` | yes | must match `postgres://` or `postgresql://` | `DATABASE_URL must be a postgres:// or postgresql:// connection string.` |
| `JWT_ACCESS_SECRET` | yes | ≥ 32 characters, and not a placeholder | `JWT_ACCESS_SECRET is missing or set to a placeholder value. …` |
| `STORAGE_DIR` | yes | must be set and must exist as a directory with mode `0700` | `STORAGE_DIR is required when NODE_ENV=production. …` |

Optional: `PORT` (default `3000`).

Rejected JWT values, verified in the container:

```
dev-secret-change-me
replace-me-with-a-64-character-random-string-aaaaaaaaaaaaaaaaaa
replace-me-with-a-different-64-character-random-string-bbbbb
… and anything containing "replace-me" or "change-me"
```

In development or test only, a missing/placeholder secret produces a **random ephemeral
per-process key** and a warning. Tokens do not survive a restart. That fallback is
unreachable when `NODE_ENV=production`.

### Web

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | yes, for `/health` to be meaningful | base URL the server-side health page calls |
| `PORT` | no | defaults to `3001`, set in the image |
| `HOSTNAME` | no | defaults to `0.0.0.0`, set in the image |

Nothing is baked into the web image; `NEXT_PUBLIC_API_URL` is read from the runtime
environment.

---

## 3. Required secrets

| Secret | How to generate | Notes |
| --- | --- | --- |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` (64 chars) | HS256 signing key for access tokens. The same value must be on **every** API replica, or tokens issued by one are rejected by the others. |
| `DATABASE_URL` | your secret manager | usually `postgresql://USER:PASSWORD@HOST:5432/DB?schema=public` |
| PostgreSQL password | your secret manager | — |

Rules that hold and are enforced by the image build and the gate:

* No `.env` file is ever sent into a build context. `.dockerignore` excludes `**/.env`,
  `**/.env.*`, `**/.envrc` — including the real `apps/api/.env`.
* No `.git` directory, `*.pem`, `*.key` or `id_rsa*` reaches an image. The gate asserts this.
* `JWT_ACCESS_SECRET` is never given an `ENV` default in any Dockerfile. The image has no
  default secret, which is why production start fails loudly rather than booting insecurely.
* The gate's throwaway database password is a literal for a container it creates and destroys
  on each run. It is not a credential for anything.

---

## 4. `STORAGE_DIR` requirements

Documents are protected health information, so this is the strictest part of the contract.

* **Must be set in production.** The API refuses to start without it, because the
  development default is `./uploads` *inside the application directory* — which would bake
  medical records into a container image and expose them to any static file handler.
* **Must be a mount, not a path in the image.** `/app` is `0555 root:root`, so a
  `STORAGE_DIR` inside the image that is not a mount is correctly unusable.
* **Must be mode `0700`.** Any group/other bit (`permissionBits & 0o077`) is fatal in
  production:

  ```
  Error: STORAGE_DIR has permissions 0755; documents are protected health information
  and must not be accessible to group or other users. Restrict it, e.g. chmod 700 <STORAGE_DIR>.
  ```

  In development the same finding is a warning, so local iteration is not blocked.
* **Must be owned by uid 1000**, the runtime user. The image performs no `chown` and no init
  wrapper; the mount is the operator's responsibility and the Phase 18 check is the
  enforcement.
* **The application then makes it tighter, not looser:** every file it creates is `0600` and
  every directory it creates is `0700`, regardless of the process umask. Verified in the
  image: `file=600 dir=700 roundtrip=ok`.

Provisioning a volume:

```bash
docker volume create ecc-storage
docker run --rm --user 0 -v ecc-storage:/mnt/s <api-image> chown 1000:1000 /mnt/s
docker run --rm --user 0 -v ecc-storage:/mnt/s <api-image> chmod 700 /mnt/s
```

For a host directory, do the equivalent on the host: `chown 1000:1000` then `chmod 700`.

---

## 5. Database requirements

* **PostgreSQL, reachable from the API container**, with the credentials in
  `DATABASE_URL`.
* **The schema must be at the latest migration** before the API serves traffic. Readiness
  only proves the database is *reachable* (`SELECT 1`); it does not prove the schema is
  current. Run section 7 as a deployment step.
* **The API user needs DDL rights for the migration step** and DML rights for serving. A
  common production pattern is to run migrations as one user and serve as another; this
  repository does not implement that separation, so a single user with DDL rights is
  currently required.
* No Redis, MinIO or S3 dependency exists. Do not configure them; nothing reads them.

---

## 6. Building the images

Both images are multi-stage, self-contained, and runnable without a package manager at
startup.

```bash
# API — from the repository root
docker build --no-cache -f apps/api/Dockerfile -t ecc-api:local .
# Web
docker build --no-cache -f apps/web/Dockerfile -t ecc-web:local .
```

Verify before deploying:

```bash
node scripts/verify-docker-images.mjs --skip-build
# 47 PASS, 0 FAIL, exit 0   (49 checks including the two build checks)
```

Base image: `node:24-alpine` for both. Node 24 because `packageManager: pnpm@11.25.0`
declares `"engines": { "node": ">=22.13" }`; every CI job now uses the same major. Both
images install `openssl`, without which the Prisma engines cannot load.

Image facts, measured:

| | API | Web |
| --- | --- | --- |
| size | ~447 MB, 8 layers | ~272 MB, 8 layers |
| user | `1000:1000` | `1000:1000` |
| `/app` | `dist/ node_modules/ package.json prisma/` | traced Next standalone tree |
| entry point | `node dist/main.js` | `node apps/web/server.js` |
| port | 3000 | 3001 |
| `HEALTHCHECK` | present (liveness only) | **absent** — see section 10 |

---

## 7. Running database migrations from the image

Migrations run **as a deployment step**, using the same image, before the API starts.

```bash
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  ecc-api:local \
  node_modules/.bin/prisma migrate deploy
```

Equivalent form, if you prefer to bypass the base image's entrypoint entirely:

```bash
docker run --rm \
  --entrypoint node -e DATABASE_URL="$DATABASE_URL" \
  ecc-api:local \
  node_modules/prisma/build/index.js migrate deploy
```

Expected output and exit code:

```
2 migrations found in prisma/migrations
Applying migration `20260904042815_init`
Applying migration `20260915000000_phase13_emergency_alerts`
All migrations have been successfully applied.
EXIT=0
```

Re-running is a no-op: `No pending migrations to apply.`, exit 0.

> **Do not use** `docker run ecc-api:local prisma migrate deploy`.
> `prisma` is deliberately not on `PATH`. The inherited
> `/usr/local/bin/docker-entrypoint.sh` from `node:*-alpine` rewrites an `argv[0]` it cannot
> resolve to `node "$@"`, so that form silently becomes `node prisma migrate deploy`, and
> `/app/prisma` is the migration *directory*, not a program:
> `Error: Cannot find module '/app/prisma'`, exit 1. Always invoke the CLI by path.

Confirm afterwards:

```bash
docker run --rm -e DATABASE_URL="$DATABASE_URL" \
  ecc-api:local node_modules/.bin/prisma migrate status
# Database schema is up to date!
```

Migrations are read-only in the image: `/app/prisma` is `0444` root-owned, which the CLI does
not need to change.

---

## 8. Starting the API

```bash
docker run -d --name ecc-api \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="$DATABASE_URL" \
  -e JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET" \
  -e STORAGE_DIR=/app/storage \
  -v ecc-storage:/app/storage \
  ecc-api:local
```

Startup **fails closed**, verified in the real image:

| Condition | Exit | Message |
| --- | --- | --- |
| `STORAGE_DIR` unset | 1 | `STORAGE_DIR is required when NODE_ENV=production. …` |
| `JWT_ACCESS_SECRET=change-me-in-production` | 1 | `JWT_ACCESS_SECRET is missing or set to a placeholder value. …` |
| `DATABASE_URL=mysql://someone:somewhere/db` | 1 | `DATABASE_URL must be a postgres:// or postgresql:// connection string.` (and the supplied value is **not** echoed) |
| `STORAGE_DIR` at `0755` | 1 | `STORAGE_DIR has permissions 0755; …` |
| database unreachable | 1 | Prisma `P1001` |

None of these is a warning. Treat a non-zero exit as a failed deployment.

---

## 9. Starting the web

```bash
docker run -d --name ecc-web \
  -p 3001:3001 \
  -e NEXT_PUBLIC_API_URL=http://ecc-api:3000 \
  ecc-web:local
```

Use the API's **container-network** address, not `localhost`, when the two are on a user
defined network. The `/health` page performs a server-side fetch of
`${NEXT_PUBLIC_API_URL}/api/v1/health/ready`, and it is a useful end-to-end proof: if the
page reports `ok` while the API reports `database: ok`, the full web → API → PostgreSQL chain
is live.

---

## 10. Health checks

Two distinct probes. They are **not** interchangeable, and the image's own `HEALTHCHECK` uses
the first.

| Probe | Route | Consults the database? | Use it for |
| --- | --- | --- | --- |
| **Liveness** | `GET /api/v1/health` | no | restart decisions |
| **Readiness** | `GET /api/v1/health/ready` | yes (`SELECT 1`) | routing traffic |

```bash
curl -s localhost:3000/api/v1/health
# {"status":"ok","service":"api"}

curl -s localhost:3000/api/v1/health/ready
# {"status":"ok","service":"api","database":{"status":"ok"}}
```

* Liveness deliberately does **not** touch PostgreSQL, so a database outage never causes an
  orchestrator to restart an otherwise healthy process.
* Readiness returns **503** with `{"status":"degraded","database":{"status":"error"}}` when
  the database is unreachable. It reports only a status; the driver error is logged
  server-side and never returned, because the endpoint is unauthenticated and a raw driver
  message would disclose the database host, port and name.
* The image's `HEALTHCHECK` is liveness-only, on a 30 s interval, 5 s timeout, 20 s start
  period, 3 retries.
* **The web image has no `HEALTHCHECK`.** This is a known, open gap (Phase 20 finding
  P20-L-04), not an oversight in your deployment. If your orchestrator needs one, add it in
  your own image or use an external probe against `GET /` and `GET /health`.

---

## 11. Shutdown and restart

`app.enableShutdownHooks()` is set, so `PrismaService.onModuleDestroy` runs `$disconnect()`
on `SIGTERM`/`SIGINT`. Verified:

```bash
docker stop -t 20 ecc-api
# exits 0 (not 143), OOMKilled=false, in ~0.2 s
# 0 remaining rows in pg_stat_activity for that database
```

Exit code **0** is the signal that the handler ran and the process exited by itself. **143**
would mean the signal was never handled and the process was killed mid-flight, leaving the
connection to be reaped by a server-side timeout instead of drained.

Give the container at least 20 s of grace so in-flight requests can finish. For an
application server this is unusually fast; if a future change adds long-running work, revisit
the grace period rather than the hook.

Restart order on deploy: migrate → start API → wait for readiness → start or roll the web
container. Never roll the API before its schema is current.

---

## 12. Container filesystem model

The application tree is immutable to the runtime user. This is defence in depth: it removes
an attacker's ability to persist inside a compromised container.

| Path | Mode | Owner |
| --- | --- | --- |
| `/app` | `0555` | `root:root` |
| `/app/dist` | `0555` | `root:root` |
| `/app/dist/main.js` | `0444` | `root:root` |
| `/app/package.json` | `0444` | `root:root` |
| `/app/prisma/schema.prisma` | `0444` | `root:root` |
| `/app/node_modules/.bin/prisma` | `0555` | `root:root` |
| `/tmp` | `1777` | `root:root` — Prisma's schema engine needs it |
| `/home/node` | `2755` | `1000:1000` — base image's own home, no application files |
| `STORAGE_DIR` (mount) | `0700` | `1000:1000` — **the only writable path** |

Measured on the shipped image: 8330 regular files, 1106 directories, 418 symlinks,
**0 not root-owned, 0 group/other-writable, 0 broken symlinks, 0 symlinks escaping `/app`.**

Operational consequences:

* The container writes **nothing** under `/app`. Logs go to stdout/stderr.
* Do not add a step that writes into the application tree — a sidecar config file, a
  generated OpenAPI file, a `NODE_OPTIONS` dump. There is no writable space for it.
* Do not enable `--read-only` expecting it to be free. The image-level model already
  delivers the protection; adding `readOnlyRootFilesystem` additionally requires explicit
  writable `/tmp` and `STORAGE_DIR` mounts, which is an orchestrator-level change not
  implemented here.
* If you bind-mount a config file over something in `/app`, the mount's own permissions
  apply, not the image's. Do not use that to reintroduce a writable application path.

---

## 13. CI verification

`.github/workflows/ci.yml` has four jobs.

| Job | Node | What it proves |
| --- | --- | --- |
| `api` | 24 | typecheck, build, build determinism, 153 unit + 60 integration tests against a real PostgreSQL service, deployment contract, production smoke test, **compiled-build authenticated round-trip** |
| `mobile` | 24 | typecheck, 32 tests |
| `web` | 24 | typecheck, lint, 1 test, production build |
| `containers` | 24 | both images built `--no-cache`, then 49 behavioural checks against real containers and a throwaway PostgreSQL it creates and destroys |

Run the whole thing locally:

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm build
pnpm test && pnpm test:integration && pnpm test:all
pnpm --filter @ecc/api build:verify
node scripts/verify-docker-images.mjs          # builds, then verifies
node scripts/verify-env-contract.mjs
```

The `containers` job's gate covers, among other things:

* the documented migration command against a **provably empty** database, then a re-run no-op;
* production start refused for missing `STORAGE_DIR`, a placeholder JWT secret, a non-postgres
  `DATABASE_URL`, and a `0755` `STORAGE_DIR`;
* a **full authenticated round-trip** — register, login, an authenticated `GET /auth/me`, a
  refused unauthenticated `GET /auth/me`, refused HS384 and `alg=none` tokens, and a wrong
  password rejected;
* no path under `/app` writable by uid 1000, and md5 proof that the running container's tree
  is byte-identical to the image's;
* `0600`/`0700` storage modes enforced by the application's own `StorageService` inside the
  read-only image;
* `SIGTERM` exit 0 and database connections released, for both containers.

Advisory steps that do **not** fail the build, and why: API lint
(`continue-on-error`, 55 pre-existing errors carried from the Phase 16 checkpoint) and mobile
lint (`continue-on-error`, 18 pre-existing warnings). They are not weakened by this and are
not to be silenced by editing `.eslintrc`.

### Known CI limitation

The `containers` job has been validated end to end **locally** only. Its result on GitHub
Actions hosted runners had not been observed as of this document. See the Phase 22 final
report for the exact state.

---

## 14. Failure diagnosis

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Exit 1, `STORAGE_DIR is required` | `STORAGE_DIR` not passed, or `NODE_ENV=production` with no value | set it to a mounted path (§4) |
| Exit 1, `STORAGE_DIR has permissions 0755` | the mount is too permissive | `chmod 700` and re-check ownership is 1000:1000 |
| Exit 1, `JWT_ACCESS_SECRET is missing or set to a placeholder` | a template value leaked into the environment | generate with `openssl rand -base64 48` |
| Exit 1, `DATABASE_URL must be a postgres://…` | wrong scheme | use `postgresql://` |
| Exit 1, Prisma `P1001` | database unreachable from the container | check the network, the host, and the port |
| `Error: Cannot find module '/app/prisma'` | the bare `prisma` form was used | use `node_modules/.bin/prisma migrate deploy` (§7) |
| Liveness 200, readiness 503 | database is up for nothing, or the schema is missing | run the migration (§7) |
| Readiness 503 after a working deploy | `DATABASE_URL` differs between the migration step and the API | compare them literally |
| `429`/`403 Rate limit exceeded` from `/auth/*` | the production limiter: 10 attempts per IP per 15 minutes | expected in production; it is not a bug |
| `401` on a valid-looking token | replica with a different `JWT_ACCESS_SECRET`, or token older than 15 minutes | make the secret identical on every replica |
| `500` on any POST/PATCH | see below | check the response body shape |
| Writes to `/app` fail with EACCES | this is correct | there is no writable application space; use `STORAGE_DIR` (§12) |
| Web page renders but `/health` says error | `NEXT_PUBLIC_API_URL` is not a container-reachable address | use the API's network alias (§9) |

### A `400` from any JSON endpoint deserves attention

`{"error":{"code":"BAD_REQUEST","message":"An unexpected error occurred."}}` is what the
global exception filter returns for **any** request whose body the `ValidationPipe` rejects.

During Phase 22 a production image shipped in which **every** `POST /auth/register` and
`POST /auth/login` returned this, because the DTOs were imported with `import type` and the
compiled output never received the DTO class. The image booted, served health checks, and
passed a 37-check container gate; the application was completely unusable.

The gate now performs a real authenticated round-trip, so that class of defect fails the
build. **If you see a 400 on login, do not assume it is a bad password** — check with a
known-good account, and run:

```bash
node apps/api/scripts/verify-compiled-auth.mjs http://localhost:3000/api/v1
```

against a running instance. It exits non-zero and names the failing assertion.

Note the limiter: that script issues 6 requests to rate-limited endpoints and the production
limit is 10 per 15 minutes, so run it once against a fresh process.

---

## 15. Rollback considerations

* **Application rollback is safe** for a schema that has not changed forward. Point the
  previous image at the same database and it serves.
* **Migrations are not automatically reversible.** `migrate deploy` applies; there is no
  `migrate revert` in the operational procedure, and no down-migrations exist in this
  repository. Rolling the *image* back after a migration leaves the newer schema in place.
  That is safe for additive migrations — which is all the two current migrations are — but a
  future destructive migration would need a manual remediation plan written before it ships.
* **Never roll back to a `NODE_ENV`-relaxed configuration.** Development mode accepts a
  weaker `STORAGE_DIR`, a missing `STORAGE_DIR` (defaulting to `./uploads` inside the app
  directory) and an ephemeral JWT key. A "rollback" that drops `NODE_ENV=production` is a
  security regression, not a recovery.
* **Keep the same `JWT_ACCESS_SECRET` across a rollback**, or every issued access token
  becomes invalid and every client is forced to re-authenticate.
* **Re-verify after a rollback** with `node scripts/verify-docker-images.mjs --skip-build`
  against the restored image, so a rollback cannot silently reintroduce a known defect.

---

## 16. Scaling

* The API is stateless. Multiple replicas are safe **if** they share `JWT_ACCESS_SECRET` and
  mount the same `STORAGE_DIR`.
* The rate limiter is **in-process, in-memory**. With more than one replica the effective
  limit is per replica, not global. That is a known limitation of the current
  implementation; a shared store would be required to make the limit global, and no such
  integration exists here.
* Readiness is the correct gate for load-balancer membership. Do not use liveness.

---

## 17. Backup and restore

No backup tooling is implemented. If you need it, operate at the PostgreSQL and volume
layers:

* **PostgreSQL** — `pg_dump`/`pg_restore`, or your managed provider's snapshots. Take a
  logical dump before every migration.
* **Documents** — snapshot the `STORAGE_DIR` volume. Note the files are `0600` and the
  directories `0700`, so a restore must preserve ownership (`1000:1000`) and modes, or the
  API will refuse the directory in production.
* After a restore, run the migration step (§7) before starting the API.

---

## 18. Explicitly unsupported

None of the following is implemented. Do not assume partial support.

| Mechanism | Status |
| --- | --- |
| Kubernetes manifests / Helm charts | **not implemented** |
| Terraform / any IaC | **not implemented** |
| AWS / GCP / Azure deployment | **not implemented** |
| Container registry publishing or image signing | **not implemented** |
| SBOM generation, CVE scanning, image provenance | **not implemented** |
| TLS termination (the images serve plain HTTP) | **not implemented** — terminate upstream |
| `docker compose` application deployment | `docker-compose.yml` exists from Phase 1 and targets the pre-Phase-20 image layout; it has **not** been updated or verified. Do not rely on it. |
| Autoscaling | **not implemented** |
| Distributed rate limiting (Redis) | **not implemented** — the limiter is per-process |
| Object storage (S3 / MinIO) | **not implemented** — documents are on a local volume only |
| Blue/green or canary rollout | **not implemented** — do it with your orchestrator |
| Database backup automation | **not implemented** — see §17 |
| Metrics, tracing, structured logging | **not implemented** — logs are unstructured stdout |
| WebSockets / realtime, push notifications, SMS/email, AI/LLM, OCR, EHR, GPS, payments, dashboards, mobile features | **out of scope, not started** |

---

## 19. Quick reference

```bash
# 0. build
docker build --no-cache -f apps/api/Dockerfile -t ecc-api:local .
docker build --no-cache -f apps/web/Dockerfile -t ecc-web:local .

# 1. verify
node scripts/verify-docker-images.mjs --skip-build          # 47 PASS, 0 FAIL

# 2. storage
docker volume create ecc-storage
docker run --rm --user 0 -v ecc-storage:/mnt/s ecc-api:local chown 1000:1000 /mnt/s
docker run --rm --user 0 -v ecc-storage:/mnt/s ecc-api:local chmod 700 /mnt/s

# 3. migrate
docker run --rm -e DATABASE_URL="$DATABASE_URL" ecc-api:local \
  node_modules/.bin/prisma migrate deploy

# 4. api
docker run -d --name ecc-api -p 3000:3000 \
  -e NODE_ENV=production -e DATABASE_URL="$DATABASE_URL" \
  -e JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET" -e STORAGE_DIR=/app/storage \
  -v ecc-storage:/app/storage ecc-api:local

# 5. web
docker run -d --name ecc-web -p 3001:3001 \
  -e NEXT_PUBLIC_API_URL=http://ecc-api:3000 ecc-web:local

# 6. confirm
curl -s localhost:3000/api/v1/health
curl -s localhost:3000/api/v1/health/ready
curl -s localhost:3001/
curl -s localhost:3001/health

# 7. shutdown
docker stop -t 20 ecc-api ecc-web     # both exit 0
```
