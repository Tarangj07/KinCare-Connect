# Phase 20 — Container Build & Deployment Verification

## 1. Scope

Phase 20 makes the two pre-existing Dockerfiles actually build and run, and
proves it with real builds and real containers. It is deliberately a
correctness/verification phase, not a feature phase.

In scope:

- `apps/api/Dockerfile` — a self-contained, production-only runtime tree.
- `apps/web/Dockerfile` — a self-contained Next.js production server.
- `.dockerignore` — correctness and secret hygiene of the build context.
- `apps/web/next.config.mjs` — enabling `output: 'standalone'`.
- `scripts/verify-docker-images.mjs` — the regression gate.
- `.github/workflows/ci.yml` — a `containers` job that runs the gate.

Out of scope (see §16): Kubernetes, Helm, Terraform, cloud deployment,
compose-based application deployment, registries, TLS, autoscaling, and every
product feature. Phase 21 was **not** started.

## 2. Baseline

Recorded before any Phase 20 edit, against a throwaway database
(`ecc_p20_ci`), with `NODE_ENV=test`:

| Gate | Result |
| --- | --- |
| API unit | 16 files / 153 passed |
| API integration (real PostgreSQL) | 5 files / 60 passed |
| API `test:all` (with DB) | 21 files / 213 passed |
| API `test:all` (no DB, CI shape) | 10 passed / 11 skipped, 109 passed / 104 skipped |
| API typecheck (main, seed, test) | PASS |
| API build / `build:verify` | PASS / PASS |
| Mobile typecheck + tests | PASS / 32 passed |
| Web typecheck, tests, build | PASS / PASS / PASS |
| API lint | 55 errors, 127 warnings (documented pre-existing baseline) |
| Root `pnpm test` | 11/11 tasks |
| Root `test:integration` / `test:all` | 5/5 tasks each |
| Root `typecheck` / `build` | 11/11 / 7/7 tasks |

The developer database `ecc` was never connected to, migrated against, or
modified.

## 3. P19-01 root cause

P19-01 (raised by the Phase 19 review) was that both Dockerfiles could not
run. Independently confirmed from the filesystem, not taken on trust:

```
apps/api/node_modules/argon2 -> ../../../node_modules/.pnpm/argon2@0.45.1/node_modules/argon2
apps/web/node_modules/next   -> ../../../node_modules/.pnpm/next@14.2.35_.../node_modules/next
```

Under pnpm's isolated linker, `apps/<app>/node_modules` contains **only**
symlinks into the workspace root's `node_modules/.pnpm` store. The old runtime
stages copied `apps/<app>/node_modules` but never the root store, so every
entry in the image was a dangling symlink. Neither container could resolve a
single dependency, let alone start.

The defect was pre-existing from Phase 1 and was never caught because the
images had never been built.

Three further defects surfaced only once real builds were attempted, and are
fixed here as well:

1. **`.dockerignore` did not match nested paths.** Docker matches a pattern
   such as `node_modules` against the context-root path only, so
   `apps/api/node_modules` **and `apps/api/.env`** (a real file containing a
   `DATABASE_URL`) were being sent to the daemon and copied into the build
   stage. Verified experimentally with a purpose-built context.
2. **pnpm 11.25.0 cannot run on Node 20.** `packageManager` pins pnpm@11.25.0,
   whose engines require Node >= 22.13; on `node:20-alpine` it aborts with
   `No such built-in module: node:sqlite`. Both images now use
   `node:24-alpine`, which matches the toolchain the tests actually run on.
3. **Prisma's engines need OpenSSL.** Alpine ships no `libssl`, so
   `prisma migrate deploy` died with `Error loading shared library
   libssl.so.3` and every query would have failed. `openssl` is now installed
   in both stages.

## 4. Docker strategy

Both images are multi-stage, build from the repository context, and install
with `--frozen-lockfile` so the pnpm lockfile is authoritative.

- **API** — runtime dependencies are materialised by
  `pnpm deploy --legacy --prod`, which copies the required store subtree into
  a self-contained `node_modules`. This is pnpm's own supported mechanism for
  producing a flat, relocatable production tree; it is preferred over copying
  the whole root `node_modules` because it excludes dev dependencies and does
  not need a store at runtime.
- **Web** — `output: 'standalone'` in `next.config.mjs` makes Next trace the
  server into a self-contained `.next/standalone` tree containing only the
  files the app actually imports. No `node_modules` copy, no `npx` at
  startup.

Both runtime stages run as uid/gid 1000 (`node`).

## 5. API image architecture

**Build stage** (`node:24-alpine`): install `openssl`; enable corepack and
activate pnpm@11.25.0; copy the workspace manifests, `packages/`,
`apps/api/package.json` and `apps/api/prisma`; `pnpm install
--filter @ecc/api... --frozen-lockfile`; copy the API source; then
`prisma generate`, `nest build`, and `pnpm deploy --legacy --prod`.

**Assembly**: the deployed tree is reduced to what a runtime needs —
`package.json`, `node_modules`, `dist/`, `prisma/` — and the workspace
packages (`@ecc/config`, `@ecc/types`, `@ecc/validation`) are removed. They
are build-time only: the compiled `dist` contains **zero** references to
`@ecc/*` (verified by grep over the built output), and they are TypeScript
sources that a Node runtime could not load anyway.

**Prisma**: the generated client is produced in the build stage and carried
into the deployed tree. The musl engine
(`libquery_engine-linux-musl-openssl-3.0.x`) is selected automatically because the
build stage is Alpine, matching the runtime. The `prisma` CLI, schema and
migrations remain in the image, so migrations are runnable as a deployment
step (verified in §6).

> **Phase 21 correction.** The migration command must be invoked **by path**:
> `docker run --rm -e DATABASE_URL=… <image> node_modules/.bin/prisma migrate
> deploy`. The bare form `docker run <image> prisma migrate deploy` does *not*
> work, because `prisma` is not on `PATH` and the base image's inherited
> `docker-entrypoint.sh` rewrites an unresolvable `argv[0]` to `node prisma
> …`, which then fails with `Error: Cannot find module '/app/prisma'` (exit 1).
> This was recorded as P20-L-01 in the Phase 20 independent review and fixed in
> `apps/api/Dockerfile` and `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md`.
> The `docker run` forms shown in this document are otherwise unchanged.
>
> **Phase 21 correction.** The runtime tree is no longer owned by the runtime
> user. Phase 20 copied it `--chown=1000:1000`, which left every file writable
> by uid 1000. It is now root-owned and non-writable by the runtime user
> (P20-L-03); see `docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md`. The
> `USER 1000:1000`, `STORAGE_DIR` and fail-closed behaviour described here are
> unchanged.

**Self-containment assertion**: the build fails if the assembled tree
contains any broken symlink, so this class of bug cannot silently return.

**Runtime stage**: `openssl`; `NODE_ENV=production`; copy `/app` (root-owned
since Phase 21; it was 1000:1000 in the Phase 20 revision — see the
correction note in §5); `USER 1000:1000`; `EXPOSE 3000`; the existing
liveness-only `HEALTHCHECK` (unchanged); `CMD ["node", "dist/main.js"]`.

`STORAGE_DIR` is still deliberately left unset so the API refuses to start in
production without it. The mounted path must be writable by uid 1000.

## 6. Web image architecture

**Build stage**: `node:24-alpine`, `openssl` not needed (no native DB
driver); install `openssl`-free workspace deps, `pnpm install
--filter @ecc/web... --frozen-lockfile`, `pnpm --filter @ecc/web build`.

**Runtime stage**: copies `.next/standalone` to `/app`, then the two paths
Next's standalone output does *not* include:
`.next/static` → `/app/apps/web/.next/static` and `public` →
`/app/apps/web/public`. `ENV PORT=3001 HOSTNAME=0.0.0.0` preserves the
existing port and makes the server reachable outside its namespace.
`USER 1000:1000`, `EXPOSE 3001`, `CMD ["node", "apps/web/server.js"]` — the
traced server is started directly, with no package manager and no `npx`.

Note the layout is workspace-preserving (the entry point is
`apps/web/server.js`, not `server.js`); the first draft assumed a flat
layout and failed the static-asset check, which is how it was caught.

No authentication or authorization behaviour was changed. `NEXT_PUBLIC_API_URL`
still flows from the runtime environment (verified: the health page reports
the live API as ok when pointed at the API container).

## 7. Dependency/runtime strategy

| | API | Web |
| --- | --- | --- |
| Install | `pnpm install --filter … --frozen-lockfile` | same |
| Build | `nest build` | `next build` |
| Runtime deps | `pnpm deploy --legacy --prod` | Next `standalone` trace |
| Dev deps in image | no | no |
| Store needed at runtime | no | no |
| Entrypoint | `node dist/main.js` | `node apps/web/server.js` |
| Base image | `node:24-alpine` | `node:24-alpine` |
| Runtime user | 1000:1000 | 1000:1000 |
| Size | 422 MB total / 147 MB `/app` | 259 MB total / 24.5 MB `/app` |

## 8. Security considerations

- **No secrets in images.** Verified: no `.env*`, `.git`, `*.pem` or `*.key`
  in either image. `.dockerignore` now uses `**/` prefixes so nested env
  files (including the real `apps/api/.env`) cannot enter the context.
- **No insecure defaults added.** The verification script asserts that
  production start is still **refused** without `STORAGE_DIR` and **refused**
  with a placeholder `JWT_ACCESS_SECRET`. Both fail closed with exit 1.
- **Non-root runtime.** Both images run as uid 1000; the API writes only to the
  operator-mounted `STORAGE_DIR`.
- **No source or test material.** API runtime contains exactly
  `dist/ node_modules package.json prisma`; the workspace packages, `src/`,
  `test/` and `scripts/` are excluded.
- **Improvements were verified, not assumed.** The non-root user, the
  `openssl` package and the symlink-clean tree were each confirmed by running
  the containers; nothing was changed merely to satisfy a checklist. In
  particular, the `HEALTHCHECK`, storage permission enforcement, fail-fast
  validation and shutdown behaviour were left exactly as Phase 16/18/19 wrote
  them.

## 9. CI changes

A new `containers` job in `.github/workflows/ci.yml` runs
`node scripts/verify-docker-images.mjs` on `ubuntu-latest`. It builds both
images and runs the full behavioural gate, so CI now fails if either
Dockerfile stops building, or if either image stops working. The script
creates and destroys its own throwaway PostgreSQL container, so the job needs
no service container and no credentials, and it never touches a CI or
developer database. Job timeout is 30 minutes.

No registry push, no cloud account, no orchestration, no compose deployment
was added.

## 10. Exact verification commands

```bash
# Full gate: builds both images, then inspects and runs them
node scripts/verify-docker-images.mjs

# Re-run the runtime checks against already-built images
node scripts/verify-docker-images.mjs --skip-build

# Individual images
docker build -f apps/api/Dockerfile -t ecc-api:p20 .
docker build -f apps/web/Dockerfile -t ecc-web:p20 .
```

The script exits non-zero on the first failed assertion and always tears down
its containers, network and temporary storage directory.

## 11. API container smoke-test results

Against a disposable `postgres:16-alpine` container (`ecc_p20_verify`),
created and destroyed by the script:

| Check | Observed |
| --- | --- |
| `prisma migrate deploy` from inside the image (run as `node_modules/.bin/prisma migrate deploy`; see the Phase 21 correction in §5) | All migrations successfully applied |
| Production start without `STORAGE_DIR` | exit 1, `STORAGE_DIR is required when NODE_ENV=production` |
| Production start with placeholder secret | exit 1, `JWT_ACCESS_SECRET is missing or set to a placeholder value` |
| Production start with non-postgres `DATABASE_URL` | refused, `DATABASE_URL must be a postgres:// or postgresql:// connection string` |
| `GET /api/v1/health` | `200 {"status":"ok","service":"api"}` |
| `GET /api/v1/health/ready` | `200 {"status":"ok","service":"api","database":{"status":"ok"}}` |
| Docker `HEALTHCHECK` | `healthy` |
| `docker stop` (SIGTERM) | exit **0** in ~0.2 s (not 143, not OOM-killed) |
| Post-shutdown request | connection refused |

Exit code 0 on SIGTERM is the meaningful signal: it proves the signal reached
Node, Nest's shutdown hooks ran, the Prisma pool was closed deliberately and
the process exited on its own.

## 12. Web container smoke-test results

| Check | Observed |
| --- | --- |
| `GET /` | 200, renders expected content |
| `GET /dashboard` | 200 |
| Hashed static asset (`/_next/static/css/…css`) | 200 |
| `GET /health` with live API container | 200, `Status: ok`, `Service: api` |
| `GET /health` with API unreachable | 200, generic `API is unreachable` (no internal address leaked) |
| `GET /p20-no-such-route` | 404 |
| `docker stop` | exit 0 |

## 13. Image inspection results

| Property | API | Web |
| --- | --- | --- |
| Broken symlinks | 0 (of 418) | 0 (of 20) |
| `.env` / `.git` / keys | none | none |
| `/app` contents | `dist node_modules package.json prisma` | `apps node_modules package.json` |
| `src` / `test` / coverage | absent | absent |
| Runtime user | 1000:1000 | 1000:1000 |
| `Cmd` | `node dist/main.js` | `node apps/web/server.js` |
| Exposed port | 3000 | 3001 |
| Layers | 7 | 8 |
| Image size | 422 MB | 259 MB |
| Runtime deps resolve | all 13 checked via `createRequire` | traced by Next |
| argon2 native | loads, musl prebuild | n/a |
| Prisma client + engine | loads, `linux-musl` engine | n/a |

Host `node_modules` is never referenced: the images contain no link to the
build context, and both run correctly with the repository's `node_modules`
untouched.

## 14. Test results

Re-run after all Phase 20 changes — identical to the §2 baseline:

| Gate | Result |
| --- | --- |
| API unit | 16 files / 153 passed |
| API integration | 5 files / 60 passed |
| API `test:all` (DB / no DB) | 213 passed / 109 passed + 104 skipped |
| API typecheck, build, `build:verify` | PASS / PASS / PASS |
| Mobile typecheck + tests | PASS / 32 passed |
| Web typecheck, tests, build | PASS / PASS / PASS |
| API lint | 55 errors, 127 warnings — **unchanged**; nothing hidden or disabled |
| Web lint | clean |
| Mobile lint | 0 errors, 18 warnings (pre-existing) |
| Root `test`, `test:integration`, `test:all`, `typecheck`, `build` | 11/11, 5/5, 5/5, 11/11, 7/7 |
| `git diff --check` | clean |
| Container gate | 21/21 PASS, exit 0 |

No new application tests were added, because Phase 20 changes no application
code. The new tests are the container checks in
`scripts/verify-docker-images.mjs`; they are behavioural (they start real
containers and assert real responses, refusals and exit codes) and they were
proven to fail: pointed at a deliberately broken image the script exits 1, and
a purpose-built image reproducing P19-01's symlink layout is detected and
reported as a broken link.

## 15. Known limitations

- **The `containers` CI job has not been executed on GitHub Actions.** It was
  written and locally validated end to end, but this environment has no remote
  runner, so the hosted-run result is unverified.
- **Node version in CI is inconsistent.** The existing `api`, `mobile` and
  `web` jobs pin `node-version: 20`, but the repository's pinned
  pnpm@11.25.0 requires Node >= 22.13, and the new `containers` job uses 24.
  If those jobs are currently green, GitHub's runner is resolving pnpm
  through its own toolchain rather than Node 20. Aligning them is outside
  Phase 20's scope and is left as a follow-up.
- **Single platform verified.** Builds were verified on linux/amd64. On
  arm64, argon2 and Prisma resolve their own prebuilds/engines at build time;
  the build stage would need to fetch them, which was not exercised here.
- **`openssl` is installed via `apk`**, so the images are not distroless. The
  alternative (distroless/static) was rejected because the Prisma engines and
  argon2 prebuilds need a C library and OpenSSL present.
- **STORAGE_DIR ownership is an operator responsibility.** The image runs as
  uid 1000; a mounted volume must be writable by that uid. Verified locally
  with a `chmod 700` host directory. A `chown`/init wrapper was deliberately
  not added, to avoid weakening the Phase 18 permission enforcement.
  (`scripts/verify-docker-images.mjs` now provisions STORAGE_DIR as a
  disposable Docker volume chowned to 1000:1000 and `chmod` 700, because a
  host temp directory only satisfies this when the invoking user happens to
  be uid 1000.)
- **Web `NEXT_PUBLIC_*` values are inlined at build time** for client bundles.
  The health page is a server component and reads the value at runtime (as it
  did before). No new configuration surface was introduced; a build arg would
  be needed if client-baked values ever become a requirement.
- **No registry, signing, SBOM, or vulnerability scanning** was added; out of
  scope.

## 16. Explicit out-of-scope work

Not implemented in Phase 20: Kubernetes, Helm, Terraform, AWS or any cloud
deployment, infrastructure provisioning, Docker Compose application
deployment, registry publishing, TLS termination, autoscaling, Redis-backed
rate limiting, MinIO/S3 integration, backup automation, metrics, tracing,
structured logging, WebSockets/realtime, push notifications, SMS/email
providers, AI/LLM, OCR, EHR integration, GPS, payments/subscriptions, new
dashboards, new mobile functionality, authentication or authorization
redesign, Prisma schema changes. `docker-compose.yml` is unchanged and still
defines infrastructure only.

## 17. Confirmation that Phase 21 was not started

No Phase 21 work exists. This phase added only container build correctness, a
verification script, one CI job, a `.dockerignore` fix and the
`output: 'standalone'` build option. No product, schema, authentication or
authorization code was added or modified.
