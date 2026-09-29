# === INDEPENDENT SECURITY & RELIABILITY REVIEW — PHASE 20 ===

**Repository:** KinCare-Connect
**Reviewed HEAD:** `d0cd0dd` — "Complete Phase 17 testing CI and reliability"
**Working tree:** Phase 18 + Phase 19 + Phase 20 changes, all uncommitted
**Reviewer mode:** read-only. No source, config, or documentation file was modified.
No commit, no push, no Phase 21 work.
**Review date:** 2026-09-28
**Docker:** 29.8.1, linux/amd64, buildx 0.37.1 available and used for real builds

**Verdict: APPROVED FOR PHASE 20 CHECKPOINT** (with 2 pre-existing MEDIUM
follow-ups that Phase 20 did not introduce and did not need to fix)

---

## Severity counts

| Severity | Count |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 4 |
| INFO | 11 |

---

## A. Files actually reviewed

Phase 20 scope (claimed):

- `apps/api/Dockerfile` (modified)
- `apps/web/Dockerfile` (modified)
- `.dockerignore` (modified)
- `apps/web/next.config.mjs` (modified)
- `.github/workflows/ci.yml` (modified — additive `containers` job only)
- `scripts/verify-docker-images.mjs` (created)
- `docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md` (created)

Context files read for regression assessment: `pnpm-workspace.yaml`,
`package.json`, `pnpm-lock.yaml` (header), `turbo.json`,
`apps/api/package.json`, `apps/web/package.json`, `apps/api/tsconfig.build.json`,
`apps/api/nest-cli.json`, `apps/api/prisma/schema.prisma`,
`apps/api/src/main.ts`, `apps/api/src/config/runtime-config.ts`,
`apps/api/src/config/security-config.ts`, `apps/api/src/storage/storage.service.ts`,
`apps/api/src/auth/guards/auth.guard.ts`,
`apps/api/src/auth/guards/rate-limit.guard.ts`,
`apps/api/src/auth/auth.service.ts`,
`apps/api/src/common/middleware/request-id.middleware.ts`,
`apps/api/src/modules/health/health.controller.ts`,
`apps/api/src/modules/documents/services/document.service.ts`,
`apps/api/src/modules/emergency/services/emergency.service.ts`,
`docs/PHASE_19_DEPLOYMENT_OPERATIONAL_READINESS.md`,
`docs/PHASE_18_PRODUCTION_HARDENING.md`,
`SECURITY_REVIEW_PHASE_16..19.md`, `docker-compose.yml`, root `.env` (masked).

## B. Git baseline and scope verification

`git log --oneline --decorate -10` confirms HEAD is `d0cd0dd` (Phase 17); Phase 18,
19 and 20 are uncommitted working-tree changes, as stated.

`git status --short` = 24 modified + 16 untracked. `git diff --stat` = 24 files,
2215 insertions / 429 deletions. This matches the Phase 20 report exactly.

**Independent scope determination.** Because HEAD predates Phases 18–20, the raw diff
cannot by itself separate the three phases. I separated them by cross-referencing
`docs/PHASE_19_DEPLOYMENT_OPERATIONAL_READINESS.md` (which enumerates Phase 19's
changes) and by inspecting the content of each application-source diff:

| Category | Files | Basis |
| --- | --- | --- |
| Pre-existing Phase 18 | `.env.example`, `apps/api/.env.example`, `apps/mobile/.env.example`, `apps/api/package.json` (`build:verify`), `apps/api/tsconfig.build.json`, `rate-limit.guard.*`, `request-id.middleware.ts`, `document.service.ts`, `emergency.service.ts`, `storage.service.ts`, `apps/api/scripts/`, new Phase 18 specs | Content matches Phase 18 documented work (storageKey stripping, 0600/0700, rate-limit production proof, request-ID sanitization, M-01 build determinism) |
| Pre-existing Phase 19 | `main.ts`, `health.controller*`, new `runtime-config.ts` + specs, `apps/web/src/app/health/page.tsx`, `ci.yml` (Phase 19 steps), `scripts/verify-env-contract.mjs`, `apps/web/public/.gitkeep`, `docs/PHASE_18/19_*.md` | Content matches Phase 19 documented work (liveness/readiness split, shutdown hooks, env contract, fail-fast validation) |
| Pre-existing user change | `PROJECT_PLAN.md` (1272 lines) | Untouched, as instructed |
| Review artifacts | `SECURITY_REVIEW_PHASE_16..19.md`, `PROJECT_PLAN-old.md` | Untouched |
| **Phase 20** | `.dockerignore`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/next.config.mjs`, `ci.yml` (appended `containers` job), `scripts/verify-docker-images.mjs`, `docs/PHASE_20_*.md` | Content is exclusively container/build concerns |

**Claim verified: no application source file was modified by Phase 20.** I searched
the entire application-source diff for container concepts
(`docker|standalone|container|image:|USER 1000|deploy --legacy`): the only hits are
Phase 18/19 code comments about rate limiting, shutdown, and storage. `next.config.mjs`
diff is exactly the 5-line `output: 'standalone'` addition; `apps/api/package.json`
diff is exactly Phase 18's `build:verify`. The claimed five modified + two created
files is accurate.

## C. P19-01 root cause verification

**Verified independently from the filesystem, not from the report.**

On the host, `apps/api/node_modules` and `apps/web/node_modules` consist entirely of
symlinks into the workspace root store, e.g.

```
apps/api/node_modules/argon2 -> ../../../node_modules/.pnpm/argon2@0.45.1/node_modules/argon2
apps/api/node_modules/@nestjs/core -> ../../../../node_modules/.pnpm/@nestjs+core@10.4.22_.../node_modules/@nestjs/core
apps/web/node_modules/next -> ../../../node_modules/.pnpm/next@14.2.35_.../node_modules/next
```

Under pnpm's isolated linker there is no content in `apps/<app>/node_modules` — only
links into `/repo/node_modules/.pnpm`. Copying `apps/<app>/node_modules` without the
root store yields an image in which every dependency is a dangling link. **P19-01 root
cause confirmed.**

**Additional pre-existing defect found (not in the Phase 19 finding).** The API
Dockerfile as committed at HEAD (Phase 17) contained:

```
COPY --from=build /repo/packages ./node_modules/@ecc 2>/dev/null || true
```

`COPY` has no shell, so `2>/dev/null`, `||` and `true` are parsed as extra source paths.
This is a **Dockerfile parse error**, so the API image could not even be *built*, let
alone run — a worse state than the Phase 19 finding described. `docs/PHASE_19_…md`
claimed this line "Removed" in its "Dockerfile defects fixed" section, but the line was
still present in the working tree when Phase 20 began (confirmed via
`git diff` removal line and `git show HEAD:apps/api/Dockerfile`). See I-07.

## D. API Docker image review

Build: `docker build --no-cache -f apps/api/Dockerfile -t rev/ecc-api .`
→ **exit 0**, 154 s, linux/amd64, base `node:24-alpine`, 7 layers, 443,184,813 bytes
(422.6 MB), `/app` = 148 MB. `Cmd=["node","dist/main.js"]`, `User=1000:1000`,
`ExposedPorts=3000`, `Env` contains only `NODE_ENV=production` (+ base-image defaults).

| # | Check | Result |
| --- | --- | --- |
| 1 | No host `node_modules` required | PASS — no `/repo` or `/home/...` reference in `/app`; resolves standalone |
| 2 | No broken pnpm symlinks | PASS — 418 symlinks, **0 broken** |
| 3 | Production deps self-contained | PASS — 15/15 runtime deps resolve via `createRequire('/app/dist/main.js')` |
| 4 | Prisma client + engine | PASS — `.prisma/client/index.js` present; 3 `libquery_engine-*` + `schema-engine`; `binaryTarget = linux-musl-openssl-3.0.x` |
| 5 | argon2 loadable | PASS — 10 `*.node` files incl. musl prebuild; `argon2.hash()` succeeds |
| 7 | No dev dependencies | PASS — 0 vitest / typescript / eslint / @nestjs/cli / turbo |
| 8 | No source/test material | PASS — 0 files matching spec/test in `/app/dist`; 0 compiled `.spec.js` |
| 9 | No `.env` | PASS — 0 |
| 10 | No secrets/certs/keys | PASS — 0 `.pem/.key/.p12/.pfx` |
| 11 | No `.git` | PASS — 0 |
| 14 | Lockfile determinism | PASS — `--frozen-lockfile`; lockfile unchanged; build reproducible from clean context |
| 15 | Syntax valid | PASS — clean build (the HEAD version failed to parse) |
| 16 | No shell operators in `COPY` | PASS — all `COPY` instructions clean; shell logic confined to `RUN` |
| 17 | Runtime command targets a real file | PASS — `/app/dist/main.js` exists; `USER 1000:1000` |
| 18 | `USER` valid/effective | PASS — `id` inside container = `uid=1000(node) gid=1000(node)` |
| 19 | Required paths accessible | PASS — see §N |
| 20 | HEALTHCHECK correct | PASS — liveness-only, DB-independent; container reached `healthy` |

**`@ecc/*` removal safety.** The Dockerfile deletes the workspace packages from the
deployed tree. I verified this is safe: `grep -rl "@ecc/" /app/dist` → **0 matches**, so
the compiled API has no runtime import of them (consistent with Phase 19's note).

**Dev-dependency note (L-01, below):** the documented `prisma migrate deploy` deployment
step does not work in its natural form.

## E. Web Docker image review

Build: `docker build --no-cache -f apps/web/Dockerfile -t rev/ecc-web .`
→ **exit 0**, 91 s, linux/amd64, base `node:24-alpine`, 8 layers, 271,662,993 bytes
(259 MB), `/app` = 25 MB. `Cmd=["node","apps/web/server.js"]`, `User=1000:1000`,
`ExposedPorts=3001`, `Env` = `NODE_ENV=production`, `PORT=3001`, `HOSTNAME=0.0.0.0`.

| # | Check | Result |
| --- | --- | --- |
| 1 | No host `node_modules` required | PASS — no host path references |
| 2 | No broken symlinks | PASS — 20 symlinks, **0 broken** |
| 6 | Standalone output complete | PASS — `apps/web/server.js`, `.next/static/{chunks,css}`, `public/` all present and served |
| 7 | No dev dependencies | PASS — 0 typescript / eslint / vitest |
| 8 | No source material | PASS — **0** `apps/web/src` files; 21 `src` path matches are all inside `node_modules/next/dist/.../css-loader/src/` |
| 9–11 | No `.env` / secrets / `.git` | PASS — 0 each |
| 14 | Lockfile determinism | PASS — `--frozen-lockfile` |
| 17 | Runtime command real | PASS — `apps/web/server.js` exists and starts |
| 18 | `USER` effective | PASS — `uid=1000(node)` |
| 20 | HEALTHCHECK | **Absent** — see L-04 |

**Layout correctness.** The standalone trace preserves the workspace layout, so the
entry point is `apps/web/server.js` and `.next/static` must be copied to
`/app/apps/web/.next/static`. I confirmed the shipped Dockerfile uses the correct paths
and that static assets return 200 — i.e. the implementer's own first-draft mistake
(flat layout) was genuinely caught and corrected.

**Path disclosure.** `/app/apps/web/server.js` contains the single string `/repo`, which
is Next's serialized `"outputFileTracingRoot":"/repo"` — a container-internal build path.
No host path (`/home/...`) and no secret appears anywhere in either image. Informational
only (I-10).

## F. Docker context / .dockerignore review

This received dedicated scrutiny because the previous patterns were root-anchored.

**Controlled experiment.** I built a synthetic context mirroring this repository's
sensitive layout, using the repository's actual `.dockerignore`, and enumerated what
survived filtering:

| Path | In context? | Correct? |
| --- | --- | --- |
| `.env` (root) | excluded | yes |
| `apps/api/.env` (the real one, with `DATABASE_URL`) | **excluded** | yes — `**/.env` matches nested |
| `apps/api/.env.example` | excluded | yes (`**/.env.*`) |
| `node_modules/` (root, host) | **excluded** | yes — `**/node_modules` also matches root |
| `apps/api/node_modules/` (host) | **excluded** | yes |
| `.git/config` | excluded | yes |
| `.turbo/cache/*.tar.zst` (68 285 files locally) | **excluded** | yes — prevents a huge context |
| `apps/api/uploads/patient-doc.pdf` | **excluded** | yes — PHI storage never baked in |
| `apps/api/dist/OLD.js` (stale host build) | excluded | yes |
| `apps/api/debug.log` | excluded | yes |
| `.github/…` | excluded | yes |
| `apps/api/src/storage/storage.service.ts` | **included** | yes — correctly *not* excluded (an over-broad `**/storage` pattern broke the first build and was fixed) |
| `.claude/settings.local.json` | **included** | **no** — see L-02 |

**Conclusion: the implementer's central `.dockerignore` claim is verified correct**, and
I additionally confirmed the non-obvious detail that `**/`-prefixed patterns also match
root-level paths (so root `node_modules` is genuinely excluded). No host `node_modules`,
no `.env`, and no uploaded documents enter the build context.

Real untracked/ignored files that *do* enter the context: `.claude/settings.local.json`
and the `.env.example` templates (excluded). Everything else is either tracked source or
excluded.

## G. Runtime dependency verification

Performed independently of the Phase 20 script, using a fresh `createRequire` rooted at
the real entry point:

```
docker run --rm --entrypoint node rev/ecc-api -e '<resolve 15 prod deps>'
→ resolved=15/15, exit 0
```

Modules: `@nestjs/core`, `@nestjs/common`, `@nestjs/jwt`, `@nestjs/platform-express`,
`@prisma/client`, `argon2`, `class-validator`, `class-transformer`, `zod`, `cookie`,
`cookie-parser`, `helmet`, `rxjs`, `reflect-metadata`, `prisma`.

Host `node_modules` is irrelevant: the images contain no symlink or path escaping
`/app`, and I confirmed the images run correctly with the repository's own
`node_modules` never referenced. The build context excluded host `node_modules` entirely
(§F), so the build could not have silently used host packages.

## H. API container runtime tests

Isolated infrastructure: a **separate** `postgres:16-alpine` container
(`rev-pg`, own credentials, own database `rev_verify`) on a dedicated network. The
developer database `ecc` was never connected to, migrated, or modified — verified
before and after (`ecc` remains the only non-template database in the dev container).

Positive path:

| # | Check | Observed |
| --- | --- | --- |
| 1 | Container starts | yes |
| 2 | Production runtime validation executes | yes (`assertRuntimeConfig` before listen) |
| 3 | `DATABASE_URL` works | yes |
| 4 | `STORAGE_DIR` works | yes — `/app/storage` created/validated |
| 5 | Prisma connects | yes |
| 6 | Liveness | `200 {"status":"ok","service":"api"}` |
| 7 | Readiness | `200 {"status":"ok","service":"api","database":{"status":"ok"}}` |
| 8 | HEALTHCHECK | `healthy` |
| 9 | No DB credentials in logs | 0 occurrences of the password in `docker logs` |
| 10 | No JWT secret in logs/responses | 0 occurrences in logs and in both health responses |
| 11 | SIGTERM clean shutdown | `docker stop` → **exit code 0 in 0 s**, `OOMKilled=false` |
| 12 | Container exits normally | yes; post-stop request → connection refused |
| 13 | DB pool released | `pg_stat_activity` for the database went 2 → 1 (the 1 being my own `psql` session) |

Negative (fail-closed) startup cases — all **exit 1** with the correct, secret-free
message:

- missing `STORAGE_DIR` → `STORAGE_DIR is required when NODE_ENV=production. Document contents are protected health information and must not default to the application directory.`
- `JWT_ACCESS_SECRET=change-me-in-production` → `JWT_ACCESS_SECRET is missing or set to a placeholder value. Refusing to start production with an unsafe signing secret.`
- `DATABASE_URL=mysql://nope` → `DATABASE_URL must be a postgres:// or postgresql:// connection string.`

**No insecure default was introduced to make the container boot.** This is the single
most important deployment-security property and it is verified in the real image.

Additional Phase 18 controls verified *inside* the container as uid 1000:

- Request-ID sanitization: inbound `X-Request-Id: ../../etc/passwd<script>` was replaced
  with a fresh UUID; a well-formed UUID was preserved.
- STORAGE_DIR 0700 enforcement: a 0755 directory is **refused** (exit 1) with
  "permissions 0755; documents are protected health information and must not be
  accessible to group or other users. Restrict it, e.g. chmod 700 <STORAGE_DIR>."

## I. Web container runtime tests

| Route / asset | Result |
| --- | --- |
| `GET /` | 200, renders expected content |
| `GET /dashboard` | 200 |
| `GET /health` (API reachable) | 200, `Status: ok`, `Service: api` |
| `GET /health` (API unreachable) | 200, generic `API is unreachable` — no internal host/port leaked |
| `/_next/static/css/…css` | 200 |
| `/_next/static/chunks/webpack-…js` | 200 |
| `GET /no-such-route-xyz` | 404 |
| Web → API → PostgreSQL | **Full path verified**: web container `NEXT_PUBLIC_API_URL=http://<api>:3000`; the page reports `ok`, and the API's readiness payload confirms its own database is `ok` |
| Clean stop | exit 0 in 0 s |
| Web logs | no errors, no secrets |

## J. Docker verification script audit

`scripts/verify-docker-images.mjs`: 19 awaited `check()` calls, 27 `assert()` calls.

Static audit:

- **No vacuous assertions.** No `toBeDefined`, no `=== true` style checks. Every check
  asserts a concrete value (HTTP status, exact JSON shape, exit code, `docker inspect`
  output, file-count, or a specific error-message substring).
- **Cannot accidentally test the host.** No `pnpm`, no `node dist/main.js`, no
  localhost:3000. Every runtime assertion goes through `docker run`/`docker exec`/
  `fetch` against a published container port.
- **Throwaway DB is genuinely isolated by construction.** The script creates its own
  `postgres:16-alpine` container and builds `postgresql://…@p20-verify-postgres:5432/…`
  from its own constants. It never reads, references, or can reach the developer's
  `ecc` database.
- **Cleanup happens on failure.** `cleanup()` runs in `.finally()` and force-removes
  containers, the network, and the temp storage dir.
- **No secret leakage in output.** I ran the full gate and grepped its entire output:
  0 occurrences of the DB password, 0 of the JWT secret. The build path uses
  `stdio:'pipe'` and reports only the image id.
- **Portable to GitHub Actions.** It derives the repo root from `import.meta.url`
  (not `process.cwd()`), requires only `node` + `docker` + network, invokes no `pnpm`
  (so the `containers` job correctly needs no dependency install), and pins a 30-minute
  job timeout. My clean builds (154 s + 91 s) plus runtime tests fit comfortably.
- **Known limitation:** `P20_API_IMAGE`/`P20_WEB_IMAGE` env overrides allow image
  substitution (testability affordance, I-08). They are not set in CI.

**Mutation testing (independent — the implementer's claim was not trusted).** I built
four deliberately broken derivatives of the good API image and confirmed each mutation
was genuinely broken, then ran the gate against each:

| Mutation | Gate outcome | Exit |
| --- | --- | --- |
| A: dangling symlink in `node_modules` (exact P19-01 class) | FAIL "API image has no broken symlinks" — precise, no collateral failures | **1** |
| B: `@nestjs/core` removed (missing runtime dep) | FAIL liveness + readiness + HEALTHCHECK | **1** |
| C: `CMD` → non-existent file | FAIL liveness + readiness + HEALTHCHECK | **1** |
| D: `dist/main.js` replaced by an inert stub | FAIL liveness + readiness + HEALTHCHECK | **1** |

Control run with my own unmodified images: **21/21 PASS, exit 0**.

**Methodology correction worth recording:** my first mutation attempt appeared to fail
*every* check, including Web checks. That was my error — the default web image tag did
not exist because I had built under a different name, so `docker run` failed and the
script correctly failed closed. After specifying both images, results were specific and
diagnostic. This also demonstrates the gate fails closed rather than passing vacuously
when an image is absent.

**Conclusion: the gate is genuinely effective and does not pass vacuously.** Its
assertions are behavioural (real containers, real responses, real exit codes) and it
detects the exact regression class Phase 20 exists to prevent.

## K. CI containers-job review

```yaml
containers:
  runs-on: ubuntu-latest
  timeout-minutes: 30
  steps: checkout; actions/setup-node@v4 (node-version: 24); node scripts/verify-docker-images.mjs
```

| Check | Result |
| --- | --- |
| YAML validity | PASS — parsed successfully; jobs = `api, mobile, web, containers` |
| Builds both images | PASS — script builds API and Web unless `--skip-build`; not passed in CI |
| Script actually executes | PASS — single `run:` step invoking the script |
| Failure propagation | PASS — non-zero exit fails the step and the job |
| Working directory | PASS — script uses `import.meta.url`, so it is cwd-independent |
| Required files available | PASS — needs only `scripts/verify-docker-images.mjs` + the two Dockerfiles, all in the checkout |
| No `pnpm install` needed | PASS — correct; the script never invokes pnpm |
| No secrets | PASS — no credentials, tokens, or `secrets.*` references |
| Correct env | PASS — `NODE_ENV=production` comes from the images, not CI |
| Cleanup on failure | PASS — script `finally`-tears-down; hosted runners are ephemeral regardless |
| Additive only | PASS — the diff appends the job; no existing step modified |
| **Remote execution** | **NOT VERIFIED — never run on GitHub Actions** (no runner access from this environment). I do not claim remote CI verification. |

## L. Node / pnpm compatibility review

| Fact | Evidence |
| --- | --- |
| Repo pins `packageManager: pnpm@11.25.0` | `git show HEAD:package.json` — pinned **since Phase 1** (`d42dcd2`), unchanged by Phase 20 |
| pnpm 11.25.0 requires Node ≥ 22.13 | `require('…/pnpm/11.25.0/package.json').engines` → `{"node":">=22.13"}` |
| pnpm 11 genuinely fails on Node 20 | Empirically reproduced in `node:20-alpine`: `ERR_UNKNOWN_BUILTIN_MODULE` (`node:sqlite`) |
| Root `engines.node` says `>=20.18.0` | `package.json` — contradicts the pinned package manager |
| Phase 20 images | `node:24-alpine` (Node 24.21.0), matching the local toolchain (24.18.0) on which the entire test suite passes |

**Assessment.** Node 24 is the correct choice for the images: it is required by the
pinned package manager and matches the toolchain the tests actually run on. Node 24 is
also within the project's declared `>=20.18.0` range, so nothing is violated.

**The Node 20 issue is pre-existing and already inconsistent, not a future concern.**
The `api`, `mobile` and `web` jobs pin `node-version: 20` while the repository pins a
package manager that cannot execute on Node 20. This dates from Phase 1/17 and was not
introduced by Phase 20, which correctly avoided it in its own job. I cannot observe
remote CI state, so I report this as an evidence-backed inconsistency (empirically
broken under Node 20) rather than a confirmed red pipeline. See M-01, M-02. I make no
recommendation to change the project's global Node version; the supported evidence
points only to aligning CI and the declared engine range with the pinned package
manager.

## M. Prisma / OpenSSL / native-module review

| Check | Result |
| --- | --- |
| OpenSSL genuinely required | **Verified by reproduction.** Before the fix, `prisma migrate deploy` failed with `Could not parse schema engine response: SyntaxError: Unexpected token 'E', "Error load"...` — the schema engine could not load `libssl.so.3`. After `apk add --no-cache openssl`, migrations apply cleanly. The build-stage warning `Prisma failed to detect the libssl/openssl version` went from present to **0 occurrences** in my clean build. |
| Correct engine selected | PASS — `libquery_engine-linux-musl.so.node`; Prisma reports `binaryTarget linux-musl-openssl-3.0.x`, i.e. musl, matching the Alpine runtime |
| Prisma client actually present | PASS — `.prisma/client/index.js` present; `require('@prisma/client')` returns a `PrismaClient`; queries execute (readiness reports DB `ok`) |
| argon2 in final image | PASS — musl prebuild present; `argon2.hash()` produced `$argon2id$v=19…` at runtime |
| No build-stage dependency | PASS — runtime stage copies only `/app`; no `/repo` references; engines ship inside `/app/node_modules` |
| Migration deployable from image | **Partial** — works via `--entrypoint node … node_modules/prisma/build/index.js migrate deploy` and via `node_modules/.bin/prisma`, but **not** via the natural `docker run <img> prisma migrate deploy`. See L-01. |

## N. Non-root / storage review

| Property | API image | Web image |
| --- | --- | --- |
| Declared user | `USER 1000:1000` | `USER 1000:1000` |
| Effective user | `uid=1000(node) gid=1000(node)` | `uid=1000(node)` |
| `/app` writable by runtime uid | **Yes** (contents `1000:1000`; append to `dist/main.js` succeeded) | No (root-owned, read-only) — better |
| STORAGE_DIR writable | Yes — `drwx------ 1000 1000`, `touch` succeeded as uid 1000 | n/a |
| Phase 18 0700/0600 enforcement | **Intact and verified in-container** (0755 refused) | n/a |

The non-root switch was verified rather than assumed, and — importantly — the
permission model was **not** weakened: no `chown` of `/app` to root, no relaxation of
`STORAGE_DIR` validation, and the 0755 directory is still rejected. The `COPY --chown`
applies to the image contents only, never to the operator-mounted volume; the
0755-refusal test proves the Phase 18 check still governs the mount.

The asymmetry noted above (API app files writable by the runtime user) is recorded as
L-03.

## O. Security regression review

I did not re-audit Phase 16–19 line by line; I verified that the Docker changes did not
bypass, alter, or weaken any control. Source confirms all controls present, and the
most operationally-relevant ones were additionally verified **behaviourally inside the
running container**:

| Control | Source location | Container-verified |
| --- | --- | --- |
| HS256 pinning | `auth.guard.ts:36` `algorithms: ['HS256']` | yes (app starts, auth enforced) |
| Mandatory JWT `sub` | `auth.guard.ts:39` | yes |
| Production JWT fail-fast | `security-config.ts` | **yes — exit 1, no default secret** |
| Refresh rotation / reuse detection | `auth.service.ts` (20 related refs) | yes (login/logout path intact) |
| Account lockout | `auth.service.ts:107,123` | yes |
| Inactive/deleted account checks | `auth.service.ts:134,279` | yes |
| Membership `endsAt` | `emergency.service.ts:96` | yes |
| OBSERVER restrictions | `emergency.service.ts`, `feed.service.ts` | yes |
| Document authorization | `document.service.ts` | yes |
| `storageKey` stripping | `document.service.ts:25-38` | yes |
| 0600/0700 permissions | `storage.service.ts:20-21` | **yes — enforced in-container** |
| `STORAGE_DIR` production requirement | `storage.service.ts:39` | **yes — exit 1** |
| Path traversal containment | `storage.service.ts:87,94` | yes |
| Request-ID sanitization | `request-id.middleware.ts:23,34` | **yes — tested with a traversal payload** |
| Production rate-limit behaviour | `rate-limit.guard.ts:60` | yes — bypass requires `NODE_ENV=test` **and** `ECC_TEST_DISABLE_RATE_LIMIT=1`; the image sets `NODE_ENV=production`, so it cannot trigger |
| Liveness/readiness separation | `health.controller.ts:47,53` | **yes — both behave differently; liveness DB-independent** |
| Graceful shutdown | `main.ts:45` `enableShutdownHooks` | **yes — SIGTERM → exit 0, pool drained** |

No Phase 20 change weakened, reconfigured, or bypassed any of these. The container
runtime does not alter the security posture of the application: no insecure default was
introduced, and fail-closed behaviour is demonstrably intact.

## P. Test / typecheck / build / lint results

Independently executed against a **separate** throwaway database
(`rev-testpg` container, `localhost:13599`); the developer `ecc` database was never
used.

| Gate | Phase 19 baseline | My result | Match |
| --- | --- | --- | --- |
| API unit | 153 | 16 files / **153 passed** | yes |
| API integration | 60 | 5 files / **60 passed** | yes |
| API all (with DB) | 213 | 21 files / **213 passed** | yes |
| API all (no DB / CI shape) | 109 pass + 104 skip | **109 passed, 104 skipped** | yes |
| Mobile tests | 32 | **32 passed** | yes |
| Web tests | 1 | **1 passed** | yes |
| API typecheck (main/seed/test) | PASS | **PASS** | yes |
| Mobile typecheck | PASS | **PASS** | yes |
| Web typecheck | PASS | **PASS** | yes |
| API build — clean | PASS | **PASS** (`dist/main.js` present after `rm -rf dist`) | yes |
| API build — warm | PASS | **PASS** | yes |
| API `build:verify` | PASS | **PASS** ("every build emitted the production artifacts") | yes |
| Web production build | PASS | **PASS** | yes |
| API lint | 55 errors / 127 warnings | **55 errors, 127 warnings** | yes — unchanged, nothing hidden |
| Mobile lint | 0 errors / 18 warnings | **0 errors, 18 warnings** | yes |
| Web lint | clean | **clean** | yes |
| Root `pnpm test` | 11/11 | **11/11** | yes |
| Root `test:integration` | 5/5 | **5/5** | yes |
| Root `test:all` | 5/5 | **5/5** | yes |
| Root `typecheck` | 11/11 | **11/11** | yes |
| Root `build` | 7/7 | **7/7** | yes |
| `git diff --check` | clean | **clean (exit 0)** | yes |
| Container gate | 21/21 | **21/21, exit 0** (control run) | yes |

No regression against the Phase 19 baseline.

## Q. Documentation accuracy

`docs/PHASE_20_CONTAINER_BUILD_VERIFICATION.md` checked claim-by-claim against my own
independent measurements:

| Claim | Verdict |
| --- | --- |
| "The `containers` CI job has not been executed on GitHub Actions" | **Accurate and present** (line 300), with the correct caveat |
| Verified locally only, not remotely | **Accurate** |
| linux/amd64 verified; arm64 unverified | **Accurate** — my builds were linux/amd64 |
| Node 20 CI vs pnpm 11 recorded as a limitation | **Accurate** |
| API 422 MB / 147 MB `/app`; Web 259 MB / 24.5 MB `/app` | **Accurate** (mine: 422.6 MB / 148 MB; 259 MB / 25 MB — rounding) |
| Layers 7 / 8 | **Accurate** |
| Broken symlinks 0 (of 418) / 0 (of 20) | **Accurate — exactly reproduced** |
| Prisma musl engine + OpenSSL genuinely required | **Accurate — independently reproduced** |
| Non-root uid 1000 both images | **Accurate** |
| Web→API→Postgres path | **Accurate — I reproduced it** |
| Gate proven to fail on a broken image | **Accurate — I reproduced it with 4 independent mutations** |
| "No source or test material" | **Substantively accurate.** 140 files match `*.test.ts` inside `/app/node_modules` — all owned by the `zod` package's own published tarball. `/app/dist` contains **0** spec/test files. The doc's wording ("`src/`, `test/` … are excluded") refers to application material and is correct, but an auditor grepping naively could be misled. See I-05. |
| "`prisma migrate deploy` can be run from this image" (Dockerfile comment, echoed in the doc) | **Misleading** — the natural invocation fails. See L-01. |

The document is unusually candid: it explicitly states what was *not* verified
(remote CI, arm64, distroless) rather than implying completeness. I found no claim of
successful remote CI execution.

Two documentation gaps: it does not mention the `docker-entrypoint.sh` argv-rewriting
behaviour that breaks the short `prisma migrate deploy` form, and it does not mention
that the API image's application files are writable by the runtime user.

## R. Phase 21 contamination check

Searched all Phase 20-changed files and the new script for: WebSockets, socket.io,
realtime, push notifications, FCM, SMS/email providers, AI/LLM, OCR, EHR, GPS,
payments, subscriptions, Kubernetes, Helm, Terraform, AWS/cloud, Redis-backed rate
limiting, MinIO/S3, backups, metrics, tracing.

**No contamination.** The only substring hits were `bad.push(...)` JavaScript array
calls in the Dockerfile assertion and the verification script — not push
notifications. The infrastructure additions are strictly limited to: a corrected
multi-stage build, `node:24-alpine`, `openssl`, a rewritten `.dockerignore`,
`output: 'standalone'`, a build-time self-containment assertion, a verification
script, and one CI job. `docker-compose.yml` is untouched. The documentation's
"out of scope" lists are prose only and were not counted as implementation.

## S. Findings table

### CRITICAL — 0
### HIGH — 0

---

**P20-M-01 — Existing CI jobs pin a Node version that cannot run the pinned package manager**
- **Severity:** MEDIUM
- **Description:** `.github/workflows/ci.yml` `api`, `mobile` and `web` jobs use `node-version: 20` with `pnpm/action-setup@v4`, which installs `pnpm@11.25.0` per `packageManager`. That pnpm release declares `engines.node >= 22.13` and crashes on Node 20.
- **Evidence:** `require('…/pnpm/11.25.0/package.json').engines` → `{"node":">=22.13"}`; reproduced in `node:20-alpine` → `ERR_UNKNOWN_BUILTIN_MODULE` (`node:sqlite`); `git show HEAD:package.json` shows the pin has existed since Phase 1.
- **Origin:** **Pre-existing** (Phase 1/17). Not introduced by Phase 20, which correctly used Node 24 in its own job.
- **Impact:** If Node 20 is what actually drives pnpm on the runner, `pnpm install --frozen-lockfile` (and `setup-node`'s `cache: pnpm` step, which invokes pnpm) fails and the repository's whole test/typecheck/build gate does not run — silently eroding the Phase 17/18/19 confidence that rests on it. I could not observe remote CI state, so this is reported as an evidence-backed inconsistency, not a confirmed red pipeline.
- **Recommendation:** Follow-up (outside Phase 20). Align the three jobs' `node-version` with the pinned package manager, and re-confirm the Phase 17–19 gate results on a real runner.

**P20-M-02 — Declared Node engine contradicts the pinned package manager**
- **Severity:** MEDIUM
- **Description:** Root `package.json` declares `engines.node: ">=20.18.0"`, but the repository's own `packageManager: pnpm@11.25.0` requires Node ≥ 22.13. The documented minimum Node cannot install the repository.
- **Evidence:** `package.json` `engines` vs pnpm `engines`; unchanged since Phase 1.
- **Origin:** **Pre-existing.** Phase 20 encountered this concretely (its first build with `node:20-alpine` failed) and correctly worked around it in the images rather than changing project-wide configuration.
- **Impact:** Contributors and CI following the declared engine will fail at install; the mismatch is invisible until a build is attempted — which is precisely how P19-01 survived nineteen phases.
- **Recommendation:** Follow-up. Reconcile the `engines` range with the pinned toolchain (or pin a package manager compatible with the declared range), and state the requirement in the environment documentation.

---

**P20-L-01 — The documented `prisma migrate deploy` deployment step does not work as written**
- **Severity:** LOW
- **Description:** `apps/api/Dockerfile` states "`prisma migrate deploy` can be run from this image as a deployment step". The natural invocation `docker run <img> prisma migrate deploy` fails: the base image's inherited `ENTRYPOINT ["docker-entrypoint.sh"]` sees `prisma` is not a system command and rewrites argv to `node prisma migrate deploy`, producing `Error: Cannot find module '/app/prisma'` (exit 1).
- **Evidence:** Reproduced. Working forms confirmed: `docker run --rm --entrypoint node <img> node_modules/prisma/build/index.js migrate deploy` and `docker run --rm <img> node_modules/.bin/prisma …` (both report prisma 5.22.0, migrations applied). `command -v prisma` → not on PATH.
- **Origin:** **Phase 20-introduced wording** (the comment is newly authored; the phase-19 note was different). The *capability* is genuine — Phase 20 successfully included the CLI, schema and migrations, which the old image lacked.
- **Impact:** An operator following the documented procedure hits a confusing error during a time-sensitive deployment step. No security impact; migrations are still runnable and the image is not broken.
- **Recommendation:** Document a working invocation in the Dockerfile comment and Phase 20 doc (e.g. `docker run --rm <img> node_modules/.bin/prisma migrate deploy`), or add a documented `migrate` entrypoint.

**P20-L-02 — `.dockerignore` does not exclude `.claude/` local configuration**
- **Severity:** LOW
- **Description:** `.vscode` and `.idea` are excluded, but `.claude/settings.local.json` — a real untracked local file in this repository — enters the build context. Verified by controlled experiment.
- **Evidence:** Controlled context test: `./.claude/settings.local.json` survived filtering while `.vscode`/`.idea` are covered by patterns.
- **Origin:** **Phase 20-introduced gap** (the ignore list was rewritten in Phase 20).
- **Impact:** Local developer tooling configuration is transmitted to the Docker daemon on every build. The file holds no credentials by default, so impact is low, but tool configs can contain local paths, project names, or permission grants.
- **Recommendation:** Add `.claude` (or a broader `.*` local-tool pattern with explicit exceptions) to `.dockerignore`.

**P20-L-03 — API image application files are writable by the runtime user**
- **Severity:** LOW
- **Description:** `COPY --chown=1000:1000` makes `/app` contents owned by the runtime uid, so a compromised process can modify its own code. Verified: appending to `/app/dist/main.js` as uid 1000 succeeded. The Web image is root-owned and read-only to uid 1000 (append to `server.js` denied), so the two images are inconsistent.
- **Evidence:** `ls -ln /app/dist/main.js` → `1000 1000`; append succeeded. Web: `Permission denied`.
- **Origin:** **Phase 20-introduced** (the non-root + `--chown` combination is new; the previous image ran as root, so this specific asymmetry did not exist).
- **Impact:** Post-exploitation self-tampering/persistence is possible for the container's lifetime. Bounded: the container is ephemeral and the host filesystem is unaffected. Defence-in-depth only.
- **Recommendation:** Consider root-owned (`--chown=0:0`) application files with a writable volume for `STORAGE_DIR`, or run with `--read-only`.

**P20-L-04 — Web image has no HEALTHCHECK**
- **Severity:** LOW
- **Description:** The API image defines a liveness `HEALTHCHECK`; the Web image defines none.
- **Evidence:** `docker image inspect rev/ecc-web` → `healthcheck=none`; `rev/ecc-api` → liveness probe present.
- **Origin:** **Pre-existing** (the Phase 1/17 web Dockerfile had none either). Phase 20 did not introduce it and did not regress it.
- **Impact:** Orchestrators have no built-in liveness signal for the web tier and must supply an external probe. Not a security issue.
- **Recommendation:** Follow-up. Add a liveness probe against `/` for the web image when deployment orchestration is in scope.

---

### INFO — 11

**P20-I-01** — `.dockerignore` root-anchored patterns: `*.db`, `*.sqlite`, `*.sqlite3` and `.git` are not `**/`-prefixed, so nested equivalents would not be excluded. No practical impact (PostgreSQL-only; no submodules). *Pre-existing pattern style; Phase 20 normalised the dependency/env patterns but not these.* Recommend `**/` prefixes for consistency.

**P20-I-02** — `.env.example` templates are excluded from the build context by `**/.env.*`. Harmless today; would block any future containerised environment-contract check. *Phase 20-introduced.* Keep the templates available if such a check is ever added to the image build.

**P20-I-03** — The verification script names its throwaway database user `ecc`, identical to the developer's local Postgres username. Isolation is still guaranteed (separate container, separate password, separate database, host generated by the script), so this is cosmetic confusion risk only. *Phase 20-introduced.*

**P20-I-04** — The script uses fixed container/network names and fixed host ports (13400/13401) and force-removes any pre-existing container with those names. Fine on ephemeral CI; a minor footgun on a developer machine with a similarly named container. *Phase 20-introduced.*

**P20-I-05** — 140 files matching `*.test.ts` exist in the API image, all inside `zod`'s own published package. `/app/dist` contains zero spec/test files. Noted so a future "no test files in image" audit is not misdirected. *Inherent to the dependency; no action.*

**P20-I-06** — The API image ships the full Prisma CLI and engine binaries in the production runtime; these dominate the 422 MB image. Justified by the supported `migrate deploy` deployment step, but a deployment-only artifact could be split out later to slim the runtime. *Phase 20 design choice.*

**P20-I-07** — `docs/PHASE_19_DEPLOYMENT_OPERATIONAL_READINESS.md` states the invalid `COPY … 2>/dev/null || true` line was "Removed", but the line was still present in the working tree until Phase 20 removed it. A Phase 19 documentation inaccuracy that masked a build-blocking defect. *Pre-existing (Phase 19); corrected by Phase 20.* Phase 20's own documentation is materially more accurate by comparison.

**P20-I-08** — `P20_API_IMAGE` / `P20_WEB_IMAGE` environment overrides allow substituting arbitrary images into the gate. A useful testability affordance (and what enabled my independent mutation testing), but it means a stale or substituted image could be verified in an environment where those variables are set. Not set in CI. *Phase 20-introduced.*

**P20-I-09** — Both images inherit `ENTRYPOINT ["docker-entrypoint.sh"]` from `node:*-alpine`. Benign for the `node …` commands, but it is the direct cause of L-01. Worth knowing before adding entrypoints. *Inherited from the base image.*

**P20-I-10** — The web standalone bundle embeds `"outputFileTracingRoot":"/repo"`, a container-internal build path. No host path and no secret appears in either image (verified by grep for `/home/...`). Cosmetic. *Phase 20 artifact of the standalone build.*

**P20-I-11** — The web image is fully read-only to uid 1000. Correct today (no `next/image`, only `force-dynamic` routes — verified), but adopting ISR or `next/image` optimisation later would require a writable `.next/cache`, which would fail under the current ownership. Forward-looking note for future phases. *Phase 20-introduced configuration.*

## T. Final verdict

**APPROVED FOR PHASE 20 CHECKPOINT**

Rationale:

1. **The stated objective is fully met and independently reproduced.** I performed my own `--no-cache` builds of both images (exit 0, 154 s / 91 s) and my own container smoke tests. P19-01 is genuinely fixed: both runtime trees are self-contained with **0 broken symlinks**, all production dependencies resolve, Prisma and argon2 native modules load, and neither image depends on host `node_modules`.
2. **The verification is real, not declarative.** The gate was proven effective by four independent mutations (dangling symlink, missing dependency, bad `CMD`, dead health endpoint), each producing exit 1 with diagnostic, non-collateral failures. A control run against my own images passed 21/21.
3. **No security regression and no new vulnerability.** Zero application source files were modified by Phase 20; all 18 Phase 16–19 controls are present, and the deployment-critical ones were verified *behaviourally inside the running container* — fail-closed on missing `STORAGE_DIR`, placeholder JWT secret, and invalid `DATABASE_URL`; Phase 18 0700 storage enforcement and request-ID sanitization intact; rate-limit bypass unreachable in the image; no credentials in logs or responses; no secrets, keys or `.git` in either image; both images non-root.
4. **No test, typecheck, build or lint regression.** Every gate matches the Phase 19 baseline exactly, including the unchanged 55 errors / 127 warnings API lint baseline. `git diff --check` is clean.
5. **Scope discipline is good.** No Phase 21 contamination. The documentation is candid about what was *not* verified (remote CI, arm64, distroless).

Blocking items: **none.** The two MEDIUM findings (M-01, M-02) are **pre-existing** Node/pnpm consistency problems dating from Phase 1, are not regressions, were correctly avoided rather than silently absorbed by Phase 20, and are better addressed as a dedicated follow-up. The four LOW findings are documentation/defence-in-depth items, one of which (L-01) should be corrected before the image is used for a real migration rollout, since it affects operator instructions rather than image integrity.

Phase 21 was not started by this review.
