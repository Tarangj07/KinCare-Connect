# PHASE 22 — FINAL REPORT

**Phase:** 22 — Production CI and container verification completion
**Base commit:** `d0cd0dd` — "Complete Phase 17 testing CI and reliability"
**Status:** implementation and local verification complete. Independent review required.
**Commit:** none. Nothing pushed. Phase 23 not started.

---

## A. Exact scope implemented

Five workstreams, all delivered. One of them surfaced a **Critical pre-existing production
defect** that had been shipping since Phase 1.

| # | Workstream | Delivered |
| --- | --- | --- |
| 1 | Strengthen container verification | 10 authenticated round-trip checks + 1 escaping-symlink check (× 2 images) → gate 37 → **49 checks**; new `apps/api/scripts/verify-compiled-auth.mjs` |
| 2 | Resolve Node/pnpm CI mismatch | requirements verified from the packages themselves, then all four CI jobs aligned to Node 24; root `engines` corrected |
| 3 | Remote CI validation | workflow prepared and validated locally end to end; **remote execution not performed** (§Q) |
| 4 | Deployment runbook | `docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md`, 571 lines, 19 sections |
| 5 | Regression verification | full matrix re-run, every count matching baseline |

### A.1 F-01 (CRITICAL) — registration and login were completely non-functional in the production image

The first `POST /api/v1/auth/register` against the freshly built image returned **400**. So
did `POST /api/v1/auth/login`.

**Cause:** `apps/api/src/auth/auth.controller.ts:9` imported its DTOs with `import type`.

```
  import type { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
```

`import type` is fully elided at compile time, so `emitDecoratorMetadata` has no runtime
symbol to reference for a `@Body() dto: RegisterDto` parameter. TypeScript emits a degraded
paramtype — and for a method parameter it emits **`Function`**, which is *not* in Nest's
`ValidationPipe.toValidate()` skip list (`[String, Boolean, Number, Array, Object, Buffer,
Date]`). The pipe therefore ran class-validator against a constructor carrying none of the
DTO's constraints, and `forbidNonWhitelisted: true` rejected every supplied field.

Runtime metadata read from the compiled `dist`, before and after:

```
  BEFORE   register ["Function"]              login ["Function","Object","Object"]
  AFTER    register ["RegisterDto"]           login ["LoginDto","Object","Object"]
```

In the shipped container, before the fix:

```
POST /api/v1/auth/register -> 400 {"error":{"code":"BAD_REQUEST","message":"An unexpected error occurred."}}
POST /api/v1/auth/login    -> 400 {"error":{"code":"BAD_REQUEST","message":"An unexpected error occurred."}}
```

**Impact: no user could register, and no user could obtain an access token. The production
image was unusable for authentication while booting cleanly, serving health checks, passing
`build:verify`, and passing the Phase 21 gate with 37/37 PASS.**

Blast radius: `auth.controller.ts` is the **only** file in the repository that imports a DTO
with `import type`; `register` and `login` are the affected endpoints. `refresh` was already
degrading to `Object` and was being skipped by the pipe, so the cookie path happened to
survive. No controller was silently emitting `Function` after the fix — I read
`design:paramtypes` for every compiled controller.

**Why the 213 tests never caught it.** The two toolchains disagree:

| pipeline | emitted | `toValidate()` | result |
| --- | --- | --- | --- |
| vitest + SWC (**all 213 tests**) | `typeof RegisterDto === "undefined" ? Object : RegisterDto` | `Object` **is** skipped | body passes through → **201** |
| `nest build` / tsc (**what ships**) | `[Function]` | not skipped | validates against a bare constructor → **400** |

Confirmed directly, not inferred: a probe spec read
`Reflect.getMetadata('design:paramtypes', AuthController.prototype, 'register')` inside the
vitest environment and got `["Object"]`; the same read against `dist/` got `["Function"]`.
**The test toolchain and the shipping toolchain produced different metadata for the same
source file, and only the second one ships.**

**Why the 37-check container gate never caught it.** Every Phase 21 check either read `/app`
file modes or made unauthenticated requests to health endpoints. Not one sent a request body.
Quantified in §P: the F-01 mutant image **passes all 35 pre-existing checks** and fails only
the 6 new ones.

**The fix** — one line plus a root-cause comment:

```diff
-import type { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
+import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
```

This is not a redesign and not a workaround. It restores what the DTO decorators always
declared: input validation now actually runs. Nothing is weakened — `IsEmail`,
`MinLength(8)` and the complexity `Matches` were unreachable before and are enforced now.

I fixed rather than merely reported because Workstream 1 explicitly requires the gate to fail
on a semantically broken authentication path, and shipping a permanently red gate would be
worse than shipping a one-line corrective fix with full evidence.

### A.2 F-01b — the lint rule that recommended the defect is now disabled for NestJS

`@typescript-eslint/consistent-type-imports` **recommended the exact change that caused F-01**
and reported **59 warnings across 29 files** in the API workspace, including every controller
with a DTO. Running `eslint --fix` would have converted all of them to `import type` and
broken **every** request carrying a body, in production, silently.

The rule is now `'off'` in `packages/config/eslint.node.cjs` (NestJS only), with the
`emitDecoratorMetadata` rationale in a comment. It remains **enabled** in
`eslint.base.cjs` for mobile and web, which have no decorator metadata. Side effect: API
warnings drop 58 (55 errors unchanged, as instructed).

---

## B. Files created

| File | Lines | Purpose |
| --- | --- | --- |
| `apps/api/scripts/verify-compiled-auth.mjs` | 329 | Compiled-build authentication round-trip. Drives the **compiled** `dist` through the real auth flow with no bypass. Run by the `api` CI job. |
| `docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md` | 571 | Deployment runbook for the model that is actually supported. |

## C. Files modified

| File | Change |
| --- | --- |
| `apps/api/src/auth/auth.controller.ts` | DTO import `import type` → value import, + root-cause comment. **The only application source file Phase 22 touched.** |
| `scripts/verify-docker-images.mjs` | +`createHmac`; +`escapingLinkCheck`; +10 authenticated round-trip checks; header comment. 733 → 994 lines. |
| `.github/workflows/ci.yml` | `api`/`mobile`/`web` Node 20 → **24** with the rationale inline; new `api` step "Compiled build — authenticated round-trip (Phase 22)"; `containers` gained a Docker preflight. |
| `package.json` | root `engines.node` `">=20.18.0"` → `">=22.13.0"`. Lockfile unchanged; `--frozen-lockfile` verified. |
| `packages/config/eslint.node.cjs` | `consistent-type-imports: 'off'` for the NestJS workspace, with the security rationale. |

## D. Existing files deliberately untouched

`PROJECT_PLAN.md`, `PROJECT_PLAN-old.md`, all `SECURITY_REVIEW_PHASE_*.md` (13–21),
`docker-compose.yml`, `pnpm-lock.yaml`, both Dockerfiles' build logic, `prisma/schema.prisma`,
`prisma/migrations/**`, `apps/api/package.json`, `turbo.json`, all `tsconfig*.json`, and
`packages/{types,ui,validation}`. Content of the Phase 21 documents verified unchanged.

**Not implemented** (out of bounds, not started): WebSockets/realtime, AI/LLM, OCR, EHR, GPS,
payments, push/SMS/email, new dashboards, major mobile features, Redis rate limiting,
MinIO/S3, Kubernetes, Terraform, AWS, database schema changes, Prisma migrations,
authentication/authorization redesign, UI redesign, dependency upgrades.

---

## E. Container verification changes

`scripts/verify-docker-images.mjs`: **37 → 49 checks.**

### E.1 New: authenticated round-trip (10 checks, #26–35)

Against the **live** production API container: `NODE_ENV=production`, a throwaway PostgreSQL
the script creates and destroys, a real `0700 uid 1000` `STORAGE_DIR` volume, real public
endpoints. **No authentication bypass, no test-only code path, no flag, no environment
variable added to the image.** The token is obtained by registering a throwaway account and
logging in, exactly as a client does.

| # | Check | Assertion |
| --- | --- | --- |
| 26 | registration through the real auth endpoint succeeds | `POST /auth/register` → **201**, user id, echoed email |
| 27 | the DTO validation declared in source actually runs | weak password → **400**. Paired with 26: 201-for-good **and** 400-for-weak can only both hold if the pipe validates against the real DTO |
| 28 | registration cannot assign a privileged role | undeclared `globalRole: SUPER_ADMIN` → **400**, and **no user row created** (SQL-checked); the real account's stored role is `USER` |
| 29 | the persisted credential is a real Argon2id hash | from SQL: starts `$argon2id$`, not the plaintext, >40 chars |
| 30 | login rejects a wrong password | `POST /auth/login` → **401** |
| 31 | login issues a usable access token | **201**, three-segment JWT, `user.id` matching registration |
| 32 | a protected endpoint refuses an unauthenticated request | `GET /auth/me` no token → **401 UNAUTHENTICATED**. Without this, 33 could pass against an unguarded route |
| 33 | **an authenticated request against a protected endpoint succeeds** | `GET /auth/me` with the Bearer token → **200**, `id`/`email`/`globalRole` all matching |
| 34 | a protected endpoint refuses a forged access token | HS384 signed with the **real secret** → **401**; `alg=none` → **401** |
| 35 | the access token is not reusable as a refresh token | access token at `POST /auth/refresh` → **401** |

Every mechanism is asserted in **both** directions, which is what gives the negatives teeth: a
`verify` that always returned true passes 31 and fails 30; an unguarded route passes 33 and
fails 32.

Rate-limit budget: 7 requests to `@RateLimit()` endpoints against a budget of 10 per IP per
15 minutes. Idempotent — a `403 "Email already registered"` is tolerated, a `400` is not,
because 400 is the F-01 signature.

### E.2 New: escaping-symlink check (2 executions, #4 and #7)

Closes Phase 21 finding **P21-02**. The old walk only flagged a symlink whose target did not
resolve; one that resolved cleanly but pointed **outside** `/app` passed.

```js
let target;
try { target = fs.realpathSync(f); }
catch { target = p.resolve(p.dirname(f), fs.readlinkSync(f)); }
if (target !== "/app" && !target.startsWith("/app/")) bad.push(...)
```

`realpathSync` resolves the whole chain, so a link that leaves `/app` and returns is also
caught; lexical resolution is the fallback for dangling links. Legitimate internal links —
pnpm's relative `node_modules/.bin/*` shims and `.pnpm` store links — resolve inside `/app`
and are not flagged. The shipped images have 418 API symlinks, all internal; both real images
pass.

### E.3 Deliberately unchanged

The dangling-symlink check, the broken-symlink walk, all migration checks, all fail-closed
configuration checks, all filesystem/immutability checks, all storage-mode checks, all web
checks and all shutdown checks. **Phase 21's 37 checks are all still present and still pass.**

---

## F. CI changes

| Job | Before | After |
| --- | --- | --- |
| `api` | Node **20**, 14 steps | Node **24**, 18 steps (+1) |
| `mobile` | Node **20** | Node **24** |
| `web` | Node **20** | Node **24** |
| `containers` | Node 24, 3 steps | Node 24, 4 steps (+1 preflight) |

New `api` step, **"Compiled build — authenticated round-trip (Phase 22)"**: starts
`node dist/main.js` on port 3124 with production configuration and runs
`verify-compiled-auth.mjs`. Catches F-01 in about a minute instead of after a full Docker
build — defence in depth, since `containers` is the slow job.

New `containers` step, **"Docker is available and responding"**: `docker version && docker
info`, so a runner that cannot pull base images fails legibly rather than mid-build.

Nothing weakened. `continue-on-error: true` remains on exactly the two advisory lint steps it
was on before, still labelled advisory. No gate loosened. YAML verified to parse; all four
jobs confirmed at `node-version: 24`.

---

## G. Node/pnpm compatibility findings

Requirements read from the packages themselves, not assumed.

| Source | Value |
| --- | --- |
| `packageManager` | `pnpm@11.25.0` |
| pnpm 11.25.0's own `engines.node` | **`>=22.13`** (read from the published tarball) |
| root `engines.node` before Phase 22 | `>=20.18.0` ← **contradicts the package manager** |
| Dockerfiles | `node:24-alpine` (Node 24, chosen in Phase 20 for the same pnpm reason) |
| local verified toolchain | Node v24.18.0 |

| Package | Version | `engines.node` | Node 24? |
| --- | --- | --- | --- |
| prisma / @prisma/client | 5.22.0 | `>=16.13` | yes |
| @nestjs/common / core | 10.4.22 | *(none)* | yes |
| next | 14.2.35 | `>=18.17.0` | yes |
| argon2 | 0.45.1 | `>=16.17.0` | yes |
| @swc/core | 1.16.2 | `>=10` | yes |
| vitest | 2.1.9 | `^18.0.0 \|\| >=20.0.0` | yes |
| expo | 51.0.39 | *(none)* | yes |
| react-native | 0.74.5 | `>=18` | yes |
| typescript | 5.7.2 / 5.9.3 | `>=14.17` | yes |
| eslint | 8.57.1 | `^12.22 \|\| ^14.17 \|\| >=16` | yes |

**Decision: Node 24 everywhere.** It is the only option that satisfies pnpm's `>=22.13`
floor, matches the Node major the images actually ship, and is the version under which the
whole suite was verified green. Node 22 would satisfy pnpm but would mean CI tests a runtime
the images do not use.

**Why the mismatch was invisible:** pnpm only *warns* about an unsatisfied `engines` field
unless `engine-strict` is set, and this repository has **no `.npmrc`**. Node 20 ran,
installed, tested and passed while being unable to run the declared package manager. This
closes P20-M-01 and P20-M-02. No dependency was upgraded or downgraded; `pnpm-lock.yaml` is
byte-identical.

---

## H. Deployment runbook

`docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md` — 571 lines, 19 sections covering the 18 required
topics: environment contract, required secrets, `STORAGE_DIR` requirements, database
requirements, building each image, running migrations, starting each container, health
checks, readiness checks, shutdown/restart, storage permissions, the container filesystem
model, CI verification, failure diagnosis, rollback, and explicitly unsupported mechanisms.

Every command was executed during Phase 22. Migration is documented by path
(`node_modules/.bin/prisma migrate deploy`) with an explicit "do not use the bare form"
warning and the reason. §18 lists as **not implemented**: Kubernetes, Helm, Terraform,
AWS/GCP/Azure, registry publishing, image signing, SBOM/CVE scanning, TLS termination,
`docker compose` deployment (the Phase 1 compose file targets the pre-Phase-20 layout and is
flagged unverified), autoscaling, distributed rate limiting, S3/MinIO, blue/green rollout,
backup automation, metrics/tracing/structured logging, and the Phase 23 feature backlog.

It also records the in-process rate limiter as a **scaling limitation** (§16) and warns that a
"rollback" dropping `NODE_ENV=production` is a security regression, not a recovery (§15).

---

## I. Exact test counts

Every figure matches the Phase 21/20/19 baseline. **No count changed.**

| Gate | Baseline | Phase 22 | Match |
| --- | --- | --- | --- |
| API unit | 16 files, **153** | 16 files, **153 passed** | yes |
| API integration (real PostgreSQL) | 5 files, **60** | 5 files, **60 passed** | yes |
| API all, with DB | 21 files, **213** | 21 files, **213 passed** | yes |
| API all, **no DB / CI shape** | **109 passed + 104 skipped** (213) | 10 passed + 11 skipped files; **109 passed \| 104 skipped (213)** | yes |
| Mobile | 6 files, **32** | 6 files, **32 passed** | yes |
| Web | 1 file, **1** | 1 file, **1 passed** | yes |
| Root `pnpm test` | 11/11 | `Tasks: 11 successful, 11 total` | yes |
| Root `pnpm test:integration` | 5/5 | 5 total, all successful | yes |
| Root `pnpm test:all` | 5/5 | 5 total, all successful | yes |

The no-DB shape was run explicitly with `DATABASE_URL` unset; the 11 skipped files are the
database-backed suites, and 109 + 104 = 213 reconciles exactly with the with-DB total.

## J. Typecheck results

| Target | Result |
| --- | --- |
| Root `pnpm typecheck` (API main + seed + test projects, mobile, web, packages) | `Tasks: 11 successful, 11 total` |
| API `typecheck` (3 tsconfig projects) | clean |
| Mobile `typecheck` | clean |
| Web `typecheck` | clean |

## K. Build results

| Target | Result |
| --- | --- |
| Root `pnpm build` | `Tasks: 7 successful, 7 total` |
| API `build` | clean (`nest build`) |
| API `build:verify` | **PASSED** — 248 files in dist, 0 spec/test files, 0 `dist/testing` helpers, every build emitted `main.js`/`main.d.ts`/`app.module.js` (clean, warm, stale-tsbuildinfo) |
| Web production build | succeeded; static prerender and dynamic routes emitted |
| `pnpm install --frozen-lockfile` | exit 0, lockfile unchanged |

## L. Lint results

| Target | Baseline | Phase 22 | Note |
| --- | --- | --- | --- |
| API | 55 errors / 127 warnings | **55 errors / 69 warnings** | errors unchanged; warnings −58, being the 59 `consistent-type-imports` warnings disabled in §A.2 |
| Mobile | 0 errors / 18 warnings | 0 errors / 18 warnings | unchanged |
| Web | clean | clean | unchanged |

The 55 pre-existing API errors were **not** touched, as instructed, and no new error was
introduced. `pnpm format:check` still fails on 101 pre-existing Markdown files — unchanged
and not a regression.

## M. Docker results

```
docker build --no-cache -f apps/api/Dockerfile -t …    exit 0
docker build --no-cache -f apps/web/Dockerfile -t …    exit 0

node scripts/verify-docker-images.mjs
  49 PASS, 0 FAIL
All container build and runtime checks passed.
GATE_EXIT=0
```

`--skip-build` re-run against those images: **47 PASS, 0 FAIL, exit 0** (47 = 49 − 2 build
checks). No secret appears anywhere in the gate output (0 occurrences of the throwaway
database password).

| Property | API | Web |
| --- | --- | --- |
| user | `1000:1000` | `1000:1000` |
| `/app` | `0555 root:root`, 0 non-root-owned, 0 group/other-writable | root-owned, no source/test material |
| broken symlinks | 0 (418 symlinks) | 0 |
| **symlinks escaping `/app`** | **0** | **0** |
| `.env` / `.git` / keys | none | none |
| liveness / readiness | `200 {"status":"ok","service":"api"}` / `200 …"database":{"status":"ok"}` | `/`, `/dashboard`, static asset, `/health` all 200; unknown route 404 |
| fail-closed starts | missing `STORAGE_DIR`, placeholder JWT, non-postgres `DATABASE_URL`, `0755 STORAGE_DIR` — all exit 1 | — |
| **authenticated round-trip** | register 201 → login 201 → `GET /auth/me` **200**; unauthenticated 401; HS384 401; `alg=none` 401; wrong password 401; access token at `/auth/refresh` 401 | — |
| `SIGTERM` | exit **0** in ~0.2 s, `OOMKilled=false`, 0 DB connections remaining | exit **0**, then connection refused |
| web → API → PostgreSQL | `/health` reported `ok` while API readiness reported `database: ok` | — |

`STORAGE_DIR` write behaviour re-confirmed: the 0700 volume is writable by uid 1000, and the
application's own `StorageService` inside the read-only image produces `file=600 dir=700`
with a byte-identical round-trip.

## N. Database results

| Check | Result |
| --- | --- |
| fresh PostgreSQL | dedicated `postgres:16-alpine` container, port 13822, created for Phase 22 |
| `prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `prisma migrate deploy` (fresh DB) | `All migrations have been successfully applied.` |
| `prisma migrate status` | `Database schema is up to date!` |
| tables created | **37** |
| schema/migrations modified | **none** |
| **developer database `ecc`** | **never connected to, migrated, or modified.** Verified before and after: `ecc-postgres` contains exactly `ecc`, `postgres`, `template0`, `template1` |
| gate's own database | created and destroyed by the gate; verified absent afterwards |

## O. Security regression results

Every Phase 16–21 control re-confirmed. None modified.

| Control | Where | Status |
| --- | --- | --- |
| HS256 pinning | `auth.guard.ts:36` | unchanged, and now also re-proved **inside the image** (HS384 + `alg=none` → 401, check 34) |
| Mandatory JWT `sub` | `auth.guard.ts:39` | unchanged |
| Production JWT fail-fast | `security-config.ts:34,43` | container-verified, exit 1 |
| Refresh rotation / reuse detection | `auth.service.ts` (2 sites) | unchanged; access token at `/auth/refresh` → 401 (check 35) |
| Account lockout | `auth.service.ts` (3 sites) | unchanged; wrong password → 401 (check 30) |
| Inactive / deleted account | `auth.service.ts:134,204,279` | unchanged |
| Membership `endsAt` | `emergency.service.ts:96` | unchanged |
| OBSERVER restrictions | `emergency.service.ts:59` | unchanged |
| Document authorization | `document.service.ts` | unchanged; e2e passes |
| `storageKey` stripping | `document.service.ts:38-41` | unchanged |
| 0600/0700 storage permissions | `storage.service.ts:20-21` | container-verified `file=600 dir=700` |
| `STORAGE_DIR` production requirement | `storage.service.ts:37,75` | container-verified, exit 1 |
| Path-traversal containment | `storage.service.ts` (5 sites) | unchanged, spec passes |
| Request-ID sanitization | `request-id.middleware.ts:23` | unchanged, spec passes |
| Production rate limiting | `rate-limit.guard.ts:61` | unchanged, and **observed live**: repeated local runs tripped the 10-per-15-min limit in a production-mode container |
| Liveness/readiness separation | `health.controller.ts` | unchanged; both verified |
| Graceful shutdown | `main.ts:45` | container-verified exit 0 + pool release |
| Docker runtime hardening | `Dockerfile:114,117` | unchanged; all write attempts still denied |
| Test-mode bypass unreachable in production | — | no test-only code path added |

**Security rules honoured:** authentication never disabled for tests against the production
image; no test-mode bypass introduced; JWT validation unchanged; authorization unchanged;
storage permissions unchanged; no secrets copied into an image; no `.env` in a build context
or image; still runs as uid 1000; `/app` still not writable; all fail-closed startup checks
intact; Prisma schema and migrations untouched.

## P. Mutation-test results

Every new guard was attacked with a real image and a real gate run.

| # | Mutation | Result | Exit | Detected |
| --- | --- | --- | --- | --- |
| — | **Control** — shipped images | **47 PASS, 0 FAIL** | **0** | — |
| **M1** | **F-01 reverted**: full `--no-cache` build from a tree with `import type { …Dto }` restored | **6 FAIL** | **1** | yes |
| **M2** | **Escaping symlinks**: `ln -sf /etc/passwd …/escape` and `ln -sf ../../../../../../etc/hostname …/escape2` | **1 FAIL** | **1** | yes |
| **M3** | **argon2 loads but computes wrong**: patched `argon2.cjs` so `hash()` returns a non-argon2 string and `verify()` returns `true` for any input | **2 FAIL** | **1** | yes |

**M1** — the decisive one. The broken image passed **all 35 pre-existing checks** and failed
only the new ones:

```
FAIL  registration through the real auth endpoint succeeds
        expected 201 from /auth/register, got 400: {"error":{"code":"BAD_REQUEST",…}}
FAIL  registration cannot assign a privileged role
        registered user's global_role is , expected USER
FAIL  the persisted credential is a real Argon2id hash, not the password
        password_hash is not an argon2id hash:
FAIL  login rejects a wrong password
        a wrong password was accepted (HTTP 400)
FAIL  login issues a usable access token
        expected 201 from /auth/login, got 400: {"error":{"code":"BAD_REQUEST",…}}
FAIL  an authenticated request against a protected endpoint succeeds
        expected 200 from /auth/me, got 401
41 PASS, 6 FAIL
```

`verify-compiled-auth.mjs` independently caught the same image (3 assertions, exit 1), so
**both** the fast CI check and the slow container check fail on it.

**M2** — the new check reported exactly the two injected links and none of the 418
legitimate ones:

```
FAIL  API image has no symlink escaping /app
        /app/node_modules/escape  -> /etc/passwd                    (resolves to /etc/passwd)
        /app/node_modules/escape2 -> ../../../../../../etc/hostname (resolves to /etc/hostname)
```

Both the absolute and the relative-but-escaping link were caught, exercising the
`realpathSync` + lexical-fallback logic.

**M3** — Phase 21 finding **P21-01**, now closed. The Phase 21 gate reported **35 PASS, 0
FAIL, exit 0** on exactly this image. The Phase 22 gate reports:

```
FAIL  the persisted credential is a real Argon2id hash, not the password
        password_hash is not an argon2id hash: stub:1c2791aec81840a880eca27fb1fb23cb44b
FAIL  login rejects a wrong password
        a wrong password was accepted (HTTP 201)
45 PASS, 2 FAIL
```

`login issues a usable access token` **still passed** — which is exactly why the
wrong-password check exists. The paired positive/negative design is what gives the negative
case its teeth.

**Methodology correction worth recording.** My first two M3 attempts patched
`node_modules/argon2/index.js`, which argon2's `package.json` never resolves (its `main` is
`argon2.cjs`). Those mutants were **no-ops**, so the Phase 21 observation that such a mutation
passed the gate was not sound evidence. I discarded both, found the real entry point, and
rebuilt the mutant against `argon2.cjs`; the corrected mutant is what is reported above and
it does pass the Phase 21 gate. The Phase 21 **finding** is confirmed; its **evidence** was
weaker than it appeared.

## Q. Remote CI result — explicit reason it could not run

**The workflow was NOT executed on GitHub Actions. No remote run was performed.**

Reason, stated plainly: nothing from Phases 18–22 is committed, and the phase instructions
prohibit creating a commit or pushing. GitHub Actions runs on pushed refs, so remote
validation is unreachable without first committing and pushing — which I was explicitly
instructed not to do. **I am not claiming the hosted run passes.** It must be triggered by
the session/user workflow once committing is authorised.

| Aspect | Status |
| --- | --- |
| `api` job steps (typecheck, build, `build:verify`, 153 unit, 60 integration, env contract, deployment smoke, compiled-auth round-trip) | executed and passing locally |
| `mobile` / `web` job steps | executed and passing locally |
| `containers` job (both builds + 49 checks) | executed in full including both `--no-cache` builds, exit 0 |
| PostgreSQL service wiring for `api` | equivalent DB-backed run performed locally; the workflow's `services:` block itself is unexecuted |
| **`containers` job on a GitHub-hosted runner** | **never run remotely** — the Phase 21 review recorded the same limitation and it remains true |
| **Node 24 as resolved by `actions/setup-node` on a hosted runner** | not observed remotely; the suite is green locally on Node v24.18.0 |
| **`timeout-minutes: 30` headroom for the larger gate** | not measured on hosted hardware. Locally the two builds plus 49 checks complete comfortably; the 12 new checks are sub-second HTTP/SQL calls, so risk is low but unverified |

## R. Known limitations

1. **No remote CI execution** (§Q). The most important open item.
2. **The `containers` job has still never run on GitHub Actions.** Validated end to end
   locally only; the hosted-run result is unverified and is not claimed.
3. **F-01 was shipped and undetected for the whole of Phases 16–21.** The fix is verified, but
   the *systemic* lesson — tests running from source while production runs compiled output —
   is only partially addressed. A future phase should consider making the compiled `dist` the
   subject of the test suite, or adding a build-output conformance test over every
   controller's `design:paramtypes`, so the same class cannot recur in a file nobody
   exercises.
4. **The escaping-symlink check trusts symlinks whose target does not exist** (lexical
   fallback). Such links are already reported as dangling, so coverage is complete in
   combination, but a link that is both dangling and escaping is reported only as dangling.
5. **The rate limiter is per-process, in-memory.** With multiple replicas the effective limit
   is per replica, not global. Unchanged, and now documented in the runbook §16.
6. **The gate's `STORAGE_DIR` fixture is a Docker volume, not a host bind mount.** A real
   `-v /host/dir:/app/storage` deployment is covered only by the runbook's human procedure.
7. **Single platform.** `linux/amd64` only; arm64 not built.
8. **No SCA / SBOM / CVE scan** of the shipped dependency set. Phase 22 makes no statement
   about known CVEs in the images.
9. **`docker-compose.yml` remains from Phase 1 and targets the pre-Phase-20 image layout.** It
   is unverified and explicitly flagged as unsupported in runbook §18.
10. **`pnpm format:check` still fails** on 101 pre-existing Markdown files. Pre-existing, not
    a regression, not touched.
11. **The gate's authenticated block needs 7 of the 10 available rate-limit requests.** A
    future check added to that block could trip the limiter; the budget is documented in the
    script and in `verify-compiled-auth.mjs`.
12. **`verify-compiled-auth.mjs` skips the stored-hash assertion when `psql` is not on
    `PATH`.** It skips with a visible warning, and the container gate asserts the same thing
    via `docker exec`, so the control is not lost.

## S. Phase 23 confirmation

**Phase 23 was not started.** No Phase 23 file, branch, script, test, dependency, migration or
infrastructure exists. The only files with a Phase 22 mtime are the five modified files, the
two new files, and build artifacts. Nothing in the prohibited list was implemented, and no
Phase 22 work was deferred into it.

## T. Git status

| Assertion | Result |
| --- | --- |
| `HEAD` | **`d0cd0dd`** — unchanged |
| staged files | **0** |
| stash entries | **0** |
| unpushed commits | 2, both pre-existing (`c615e2b` Phase 16, `d0cd0dd` Phase 17) |
| reflog | newest entry is the pre-existing `d0cd0dd` commit; no `rebase`, `merge`, `pull` or `amend` |
| `git diff --check` | clean, exit 0 |
| Phase 18–21 uncommitted work | **preserved intact**, not reset, cleaned, or stashed |
| `PROJECT_PLAN.md` / `PROJECT_PLAN-old.md` | untouched |
| `SECURITY_REVIEW_PHASE_*.md` | untouched |
| `pnpm-lock.yaml` | byte-identical |
| dependency changes | **none** |

Tracked modifications total: `.dockerignore`, `.env.example`, `.github/workflows/ci.yml`,
`PROJECT_PLAN.md` (pre-existing), `apps/api/.env.example`, `apps/api/Dockerfile`,
`apps/api/package.json`, `apps/api/src/auth/auth.controller.ts` **(Phase 22)**, plus the
Phase 18–20 files, `apps/mobile/.env.example`, `apps/web/Dockerfile`,
`apps/web/next.config.mjs`, `apps/web/src/app/health/page.tsx`, `package.json` **(Phase 22)**,
`packages/config/eslint.node.cjs` **(Phase 22)**.

Phase 22 added exactly 5 tracked-file modifications and 2 new files.

## U. Commit status

**No commit was created. Nothing was pushed. No force-push. No history rewrite.**

All Phase 22 work is uncommitted in the working tree alongside the pre-existing Phase 18–21
changes, ready for the independent Phase 22 review. Cleanup performed: all Phase 22 review
containers, networks, volumes, images, the temporary mutated-Dockerfile tree, and scratch
files were destroyed; the developer database `ecc` was never touched; the pre-existing
`ecc-api:p20-verify` / `ecc-web:p20-verify` images were left intact.

**Next step: independent Phase 22 security/reliability review.**
