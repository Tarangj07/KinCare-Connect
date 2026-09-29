# SECURITY_REVIEW_PHASE_19.md — Independent Security, Reliability & Deployment-Readiness Review

**Subject:** Phase 19 (Deployment & Operational Readiness)
**Baseline:** `d0cd0dd` (unchanged). Phase 19 is uncommitted, layered on the uncommitted-but-approved Phase 18 tree.
**Review mode:** READ-ONLY. No implementation file was modified, committed, or pushed. The only file this review creates is this artifact. Scratch database `p19_review` and all `/tmp` scripts/logs were removed; build artifacts (`dist`, `.next`, `uploads`, `*.tsbuildinfo`) were removed (all gitignored) to restore the pre-review working tree.
**Reviewer stance:** Independent. Every implementation claim was re-derived from the repository and re-executed; the report was not taken at face value.

---

## 1. Files actually reviewed (A)

**Phase 19 — created (5, all verified present):**
- `apps/api/src/config/runtime-config.ts` (131 lines, read in full)
- `apps/api/src/config/runtime-config.spec.ts` (read)
- `scripts/verify-env-contract.mjs` (read; run; negative control run)
- `docs/PHASE_19_DEPLOYMENT_OPERATIONAL_READINESS.md` (read)
- `apps/web/public/.gitkeep` (exists, empty, not gitignored)

**Phase 19 — modified (11, each read/diffed):**
`.env.example` · `.github/workflows/ci.yml` · `apps/api/Dockerfile` · `apps/web/Dockerfile` · `apps/api/src/main.ts` · `apps/api/src/modules/health/health.controller.ts` · `apps/api/src/modules/health/health.controller.spec.ts` · `apps/api/src/storage/storage.service.ts` · `apps/api/src/storage/storage.service.spec.ts` · `apps/web/src/app/health/page.tsx` · `apps/mobile/.env.example`

**Surrounding code inspected:** `apps/api/prisma/schema.prisma` (env source), `apps/api/src/config/security-config.ts`, `apps/api/src/auth/guards/{auth.guard,roles.guard,rate-limit.guard}.ts`, `apps/api/src/auth/{auth.service,authorization.service}.ts`, `apps/api/src/common/middleware/request-id.middleware.ts`, `apps/api/src/database/prisma.service.ts`, `apps/api/src/modules/documents/services/document.service.ts`, `apps/api/src/modules/emergency/services/emergency.service.ts`, `apps/api/src/testing/setup-env.ts`, `apps/web/next.config.mjs`, `apps/web/package.json`, `apps/mobile/app.json`, `apps/mobile/src/lib/api-base.ts`, `turbo.json`, `docker-compose.yml`, `pnpm-workspace.yaml`, `pnpm` symlink layout under `apps/*/node_modules`.

## 2. Git / diff scope verification (B)

- **HEAD:** `d0cd0dd2f175ae881bd201eb26d7e74a0c4158be` — "Complete Phase 17 testing CI and reliability". **Unchanged.** No commit exists above the baseline (`git diff d0cd0dd..HEAD` empty). Stash empty. Nothing pushed.
- `git diff --check`: **clean** (no whitespace/conflict damage).
- **Working tree** contains three layers: (1) pre-existing user changes (never modified by Phase 19), (2) uncommitted-but-approved **Phase 18 + cleanup** (never modified by Phase 19), and (3) **Phase 19**. The pre-existing files are correctly preserved: `PROJECT_PLAN.md` (M, mtime 2026-09-26 16:32), `PROJECT_PLAN-old.md`, `SECURITY_REVIEW_PHASE_16/17/18.md` (all untracked, 2026-09-26).
- **Phase 18 vs Phase 19 separation** was established by mtime (Phase 18 wrote 01:02–01:42; Phase 19 wrote 01:51–02:25 on 2026-09-28). Every file reported as a Phase 19 creation/modification carries a Phase 19 timestamp; every Phase 18 file retains its earlier timestamp. **The implementation report's 16-file list is complete and accurate** — no undisclosed Phase 19 files.
- **No auth/authorization/guard/Prisma file was modified by Phase 19.** `auth.guard.ts`, `auth.service.ts`, `authorization.service.ts`, `roles.guard.ts`, `security-config.ts` all retain 2026-09-26 12:47; `schema.prisma` retains 2026-09-16. `docker-compose.yml` unchanged (2026-09-04).

## 3. Environment contract findings (C)

**Independently enumerated every environment read** across `apps/api/src` (bracket *and* dot notation), `apps/api/prisma` (`env()` in schema), `apps/api/scripts`, `apps/api/package.json`, `apps/web`, `apps/mobile`, root `scripts/`, `turbo.json`, CI, both Dockerfiles, `docker-compose.yml`, and all `.env.example` files. Result:

| Variable | Actually read by | Required? | Classification |
|---|---|---|---|
| `DATABASE_URL` | Prisma datasource (`schema.prisma`); also validated in `runtime-config.ts` | All environments | Correct |
| `JWT_ACCESS_SECRET` | `security-config.resolveJwtAccessSecret`; validated in `runtime-config.ts` | Production | Correct |
| `STORAGE_DIR` | `storage.service.ts`; validated in `runtime-config.ts` | Production | Correct |
| `NODE_ENV` | security-config, cookie, rate-limit guard, storage, runtime-config | Optional (`production` activates prod behaviour) | Correct |
| `PORT` | `main.ts` | Optional (default 3000) | Correct |
| `NEXT_PUBLIC_API_URL` | `apps/web` (2 sites) | Optional (build-time, browser-visible, no secret) | Correct |
| `expo.extra.apiBaseUrl` | `apps/mobile` via `app.json` (`Constants.expoConfig.extra`) — **not** an env var | Optional | Correct; mobile `.env.example` now documents this accurately |
| `ECC_TEST_DISABLE_RATE_LIMIT` | test harness only (`setup-env.ts`); inert unless `NODE_ENV=test`, and **inert when `NODE_ENV=production`** | Test-only | Correct; root template labels it test-only and warns against deployment use |

**Stale variables:** I re-ran the search for the three the Phase 18 review flagged. `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `LOG_LEVEL` are now **absent from all three templates** and read nowhere in code (only hardcoded `expiresIn: '15m'` in `app.module.ts`/`auth.module.ts`/`auth.service.ts` and `maxAge: 30*24*60*60*1000` in `auth.controller.ts` govern lifetimes). The other 9 previously-stale names (API_BASE_URL, JWT_REFRESH_SECRET, WEB_ALLOWED_ORIGINS, EXPO_PUBLIC_API_URL, S3_*) are also gone from the templates and read nowhere. `NEXT_PUBLIC_API_URL` default `http://localhost:3000` **does** exist (code falls back to it) and is documented as optional — accurate. **Verdict: the Phase 18 documentation defect is genuinely resolved, and no stale variable remains in any template.**

**Live-bug fix independently confirmed:** the root `DATABASE_URL` previously pointed at `localhost:5432` while `docker-compose.yml` publishes the container's 5432 on host `5433`; Phase 19 corrected the template to `5433` and documented why.

**Guard script (`scripts/verify-env-contract.mjs`):** verified to exit 0 on the current tree and to **exit 1 when a stale variable is injected** (read-only injection test on a copy; the repo file was not modified). It dynamically checks required vars and the known-stale list; the stale list is hardcoded (a *new* dead variable would not be auto-detected) — an acceptable, documented limitation (INFO).

**Env findings:** accurate contract; no stale vars remain; the CI env-contract step's `pnpm --filter @ecc/api exec node ../../scripts/…` path **resolves and passes locally** (RC=0).

## 4. Startup validation findings (D)

- **Execution point:** `assertRuntimeConfig()` is the **first statement of `bootstrap()`**, before `NestFactory.create` (main.ts:18 vs 20) — it runs in the real bootstrap path, not only tests (confirmed by import + call site, no test-only gating).
- **Fail-closed behaviour, verified live against the built app** (not only unit tests):

| Scenario (NODE_ENV=production) | Observed | Contract |
|---|---|---|
| No `STORAGE_DIR` | refused, "STORAGE_DIR is required…" | fail-closed ✓ |
| `JWT_ACCESS_SECRET=TOPSECRET123` (12 chars) | refused, "must be at least 32 characters" — **value not echoed** | fail-closed ✓ |
| `DATABASE_URL=mysql://…` | refused, "must be postgres…" | fail-closed ✓ |
| `STORAGE_DIR` at 0755 | refused, "must not be accessible to group or other" | fail-closed ✓ |
| `STORAGE_DIR` = a file | refused, "exists but is not a directory" | fail-closed ✓ |
| `NODE_ENV=development`, no `STORAGE_DIR` | **starts** (logs listening) | prod-only req; dev not broken ✓ |

- **No secret disclosure:** none of the error messages contain the secret value, DB host, port, or connection string. The JWT rule is delegated to the existing `resolveJwtAccessSecret` (single source of truth); the `STORAGE_DIR`-presence rule mirrors Phase 18 without weakening it.
- **Fail-closed cannot be trivially bypassed via NODE_ENV:** setting `NODE_ENV` to a non-production value relaxes only the *presence* requirements; a short-but-present secret still throws (delegated rule), and the storage permission check is fatal only in production. **A real production deployment mislabelled `NODE_ENV=development`** would run with an ephemeral JWT key and non-secure cookies — but this is a **pre-existing** consequence of the app's global security-posture-by-`NODE_ENV` model (documented in Phase 16/18). Phase 19 did not create it; it partially mitigates it with explicit warnings in `.env.example`. Recorded as pre-existing/LOW (see findings).
- **Minor code observation:** `classifyDatabaseUrl` computes `hasCredentials` which is never used (dead field). Cosmetic, no impact (INFO).
- CI's fail-closed step (a) accepts a valid production config, (b) refuses an invalid one and greps for "STORAGE_DIR is required" — **reproduced locally; both assertions hold**.

## 5. Health / readiness findings (E)

- **Routes:** `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (readiness). The controller has **no `@UseGuards`** — both are unauthenticated by design (a health probe cannot authenticate). Neither returns user/senior/document data; readiness performs only `SELECT 1`. **Not an authorization or data-access bypass.**
- **Liveness does not touch the database.** Live: liveness returns `200 {"status":"ok","service":"api"}`; the unit test additionally asserts `$queryRaw` is *not* called.
- **Readiness genuinely checks the DB and returns 503 on failure.** Verified live by starting the app through a controllable TCP proxy and then cutting the DB:
  - DB up: readiness `200 {"status":"ok","service":"api","database":{"status":"ok"}}`
  - DB down after start: readiness `503 {"status":"degraded","service":"api","database":{"status":"error"}}`, **liveness stays 200**
  - Body grep: **no host, port, DB name, credentials, SQL, stack, or Prisma text leaked.**
- **Prior disclosure fixed:** the old single endpoint returned `database.detail` = raw driver error (could expose host/port/db name) on a public route. That is now removed and pinned by a test asserting a realistic driver message never appears.
- **Response shape:** stale `phase: 2` removed; the web health page updated to match. The `web` page's `HealthPayload` type no longer references `phase`.
- **No other consumer** of the old shape exists in the repo (grep clean).

## 6. Shutdown findings (F)

- `app.enableShutdownHooks()` is present (main.ts:45) and runs **before** `app.listen` (48). `PrismaService` implements `onModuleDestroy → $disconnect` (pre-existing); with shutdown hooks enabled, Nest invokes it on SIGTERM/SIGINT.
- **Live SIGTERM verified:** launched the built API, confirmed `/health` 200, sent SIGTERM, and the process **exited cleanly** (kill -0 confirmed gone; listening port released — `ss` shows 4222/4223 free). No new long-lived resource was introduced; there are no queues/workers in the codebase.

## 7. Storage findings (G)

- **Phase 18 hardening preserved, not weakened:** `STORAGE_DIR_MODE=0o700` (dirs) and `STORAGE_FILE_MODE=0o600` (files) are unchanged; the production `STORAGE_DIR`-required rule is unchanged; path containment (`resolveContainment`) is unchanged; `storageKey`/`contentHash` stripping is unchanged.
- **Phase 19 is genuinely additive ("verified, not duplicated"):** the new code only (a) stats the resolved directory, (b) throws if it is not a directory, (c) throws in production if group/other permission bits are set (warn-only in dev), and (d) **never chmods** an existing directory. Confirmed by diff and by a test asserting a `0750` dir stays `0750` after a refusal (no silent widening).
- **Tests exercise real behaviour** (13 in the storage spec, incl. the 6 new Phase 19 ones): a `0755`/`0777` dir must throw in production, `0700` must pass, dev warns-not-throws, file-not-dir throws, and traversal (`../../etc/passwd`, `/etc/passwd`) is still rejected. These would fail if the permission check were removed.
- **Live:** production refuses a 0755 dir (verified). Upload/download still pass in the 12/12 documents e2e suite (temp `STORAGE_DIR`, NODE_ENV=test → permission check is warn-only, so e2e unaffected).
- **Operational note (not a defect):** the permission check reads the *mode bits* and requires group/other = 0. A production volume mounted root-owned `0755` (root can still write) would be **refused**; the operator must `chmod 700`. This is stricter-than-necessary for a root-runner container but is fail-safe and documented. INFO.

## 8. Database findings (H)

- `prisma validate` → **valid**. Fresh disposable DB `migrate deploy` → **both migrations applied**. `migrate status` → **"Database schema is up to date!"**. Application starts against the migrated schema (live probes 200).
- **No Prisma schema or migration change** in the Phase 19 diff (`schema.prisma` untouched, mtime 2026-09-16; `git diff d0cd0dd` lists no `prisma/schema.prisma` or `migrations/`). **No schema change was required or introduced.**
- The dev database `ecc` was never read or written; all DB work used `p19_review` (now dropped).

## 9. CI findings (I)

- **YAML valid** (PyYAML). Triggers `push:main` + `pull_request`; concurrency cancel — unchanged, sane.
- **New commands exist and run locally:** `verify-env-contract.mjs` (RC=0), the fail-closed startup assertion (valid passes / invalid refuses+names the var), artifact sanity (`dist/main.js`, `prisma/schema.prisma`, `prisma/migrations` present; no `*.spec.js`/`*.test.js`; no `dist/testing`), and the SIGTERM-exit assertion (the build:verify smoke path is proven by the live SIGTERM test).
- **No secrets echoed:** CI uses only the pre-existing ephemeral throwaway DB password and a CI-only 32+ char secret; the new steps add no new credential and print no secret value.
- **Test-mode config cannot weaken production in CI:** the new smoke steps set `NODE_ENV=production` in a subshell (overriding the job-level `NODE_ENV=test`); the rate-limit opt-out is never set in those steps and is inert in production regardless. The only production-secret handling is the throwaway CI value.
- **No credentials hardcoded beyond the pre-existing ephemeral CI service secret; no cloud secrets; CI does not deploy** (validation only; no publish/login/cloud steps).
- **Minor CI-robustness observation (INFO):** the fail-closed step runs `node dist/main.js` expecting a quick non-zero exit. If that guard ever regressed to allow startup, the process would listen indefinitely and hang the step (the `api` job has no explicit `timeout-minutes`, so it would run to GitHub's default). A regression would still be *noticed* (job hangs → fails at limit) rather than passing silently, so this is not a correctness risk, only a slow-failure nicety.

## 10. Docker findings (J)

**Not built (BLOCKED BY ENVIRONMENT — the environment lacks the network/workspace install to run `docker build`; I did not run it and do not claim an image build passed).** Static analysis only:

- **Both images previously copied `apps/<app>/node_modules` into the runtime stage.** With pnpm's default isolated linker, every entry in `apps/api/node_modules` (and `apps/web/node_modules`) is a **relative symlink into the ROOT virtual store** `node_modules/.pnpm` (verified: `apps/api/node_modules/@nestjs/common -> ../../../../node_modules/.pnpm/…`). The runtime stage (`WORKDIR /app`) copies only the app's `node_modules`, **not** the root `/repo/node_modules/.pnpm`. Therefore, in the built image every transitive dependency resolves to a non-existent path and `require()` fails at container start. **Neither the api nor the web image would start as written.** This is a **genuine, blocking-for-deployment defect.** It is **pre-existing since Phase 1** (the `COPY … node_modules` lines date to `d42dcd2`) and **not introduced by Phase 19**; Phase 19 edited both files (correcting a broken `COPY`/`public`/`npx`) and its "Dockerfile correctness" workstream did not detect or address it. Severity **MEDIUM** (deployment-readiness/reliability, not a security vuln). Remediation: add a root-store copy or use `pnpm deploy`/hoisted install (see findings).
- **`--frozen-lockfile=false` in both build stages** — can resolve versions beyond the lockfile (supply-chain). Pre-existing (Phase 1); the report acknowledges it as a limitation.
- **Runtime `node_modules` includes devDependencies** (the install is not `--prod`); the api image intentionally ships `prisma/` so `migrate deploy` can run in-container, which needs the Prisma CLI (a devDependency). Pre-existing shape, low impact.
- **Invalid COPY fixed by Phase 19 (verified):** the api `COPY --from=build /repo/packages ./node_modules/@ecc 2>/dev/null || true` (invalid shell in COPY; `COPY` has no shell) is gone. The web `COPY … public` now has a target (`apps/web/public/.gitkeep` exists, not gitignored).
- **No secrets/env baked into layers:** no `ARG`/`ENV` carrying secrets; `ENV NODE_ENV=production` only. `EXPOSE` ports (3000/3001) are correct. `HEALTHCHECK` uses Node's built-in `http` against `/api/v1/health` (liveness) — correct per the liveness/readiness split.
- **`CMD ["node_modules/.bin/next", …]`** — `apps/web/node_modules/.bin/next` exists and `next.config.mjs` has no `output: 'standalone'`, so shipping `.next` + `node_modules` and running the binary is internally consistent (though subject to the pnpm-store issue above).

## 11. Web / mobile findings (K)

- **`NEXT_PUBLIC_API_URL`** is the only web env var; it is a URL, browser-visible by design, **carries no secret**, and is not a `NEXT_PUBLIC_*` secret. No `NEXT_PUBLIC_SECRET`-style leakage. The only credential-like vars in the tree are server-side (`JWT_ACCESS_SECRET`, DB URL) and are never referenced from `apps/web/src`.
- **Web health page** now reports a generic "API is unreachable" / "API returned HTTP N" instead of the raw fetch error (which could disclose the internal API host) — correct hardening. The `phase` reference was removed consistently with the API change. **Production build passes** (verified).
- **No localhost-only production behavior introduced:** the `http://localhost:3000` default is pre-existing, documented as optional, and is a *developer default*, not a production lock — a deployment sets `NEXT_PUBLIC_API_URL` (documented in the root template).
- **Mobile:** only `.env.example` changed; it now correctly documents `app.json` `extra.apiBaseUrl` as the real mechanism and warns that `EXPO_PUBLIC_*` values are bundled/visible. No mobile source or functionality was touched (mtime confirms only the template changed).

## 12. Security regression findings (L)

Phase 19 did **not** modify any auth, authorization, guard, or Prisma file (mtime + `git diff` confirm). All Phase 16–18 controls re-verified present in current source:

| Control | Status |
|---|---|
| JWT HS256 pinning (`algorithms: ['HS256']`) | intact |
| mandatory JWT `sub` | intact |
| JWT fail-fast (≥32, placeholder, production) | intact; `runtime-config` delegates to the same function |
| refresh rotation / reuse detection | intact (auth.service untouched) |
| account lockout | intact |
| `isActive` / `deletedAt` checks | intact |
| CareCircle ACL / `endsAt` enforcement | intact |
| document authorization (incl. `listGrants` steward/uploader) | intact (Phase 18) |
| storage 0600/0700 + containment + prod `STORAGE_DIR` | intact, only *verified* further |
| `storageKey`/`contentHash` stripping | intact |
| emergency authorization + P2025 race mapping | intact |
| messaging / notification authorization | intact (untouched) |
| request-ID sanitization | intact |
| rate-limit production bypass protection (`NODE_ENV!=='test'`) | intact, untouched |
| Phase 17 test infra / Phase 18 build determinism | intact (`build:verify` passes) |

**No new security regression introduced by Phase 19.** The Phase 19 additions are: startup fail-closed validation, health split (disclosure *removed*), shutdown hooks, storage *verification*, env/docs, Docker corrections, CI validation — none weaken an existing control. No client-side privilege decisions, no path-traversal change, no insecure permissions.

## 13. Phase 20 contamination check (M)

Scanned the 16 Phase 19 files for realtime/WebSocket/socket.io, AI/LLM/OpenAI/Anthropic, SMS/email/push/FCM/APNs, payments/subscriptions/billing, cloud deployment automation (Kubernetes/Terraform/Helm/k8s), and new product features. **Only matches:** the Phase 19 doc's explicit "NOT started / out of scope / deferred" lists, and `main.ts` matching "helm" via the pre-existing `helmet` import. Both are **false positives** per the review's own guidance. `docker-compose.yml` is unchanged (no new services). **No Phase 20 contamination.**

## 14. Test results (N)

Fresh isolated DB `p19_review` (migrated via `prisma migrate deploy`, then dropped). Dev DB `ecc` untouched.

| Lane | Result |
|---|---|
| API unit | **PASS — 16 files / 153** |
| API integration | **PASS — 5 files / 60** (documents 12, emergency 10, resources 18, messaging 13, auth-session 7) |
| API all (DB) | **PASS — 21 files / 213**, 0 failed, 0 skipped |
| API all (no `DATABASE_URL`) | **PASS — 109 passed / 104 DB-gated skipped / 0 failed** |
| Mobile | **PASS — 6 files / 32** |
| Web | **PASS — 1** |
| Root `pnpm test` / `test:integration` / `test:all` | **PASS — 11/11 tasks** |
| Env contract guard | **PASS (exit 0)**; **exit 1** on injected stale var (negative control) |
| `prisma validate` / `migrate deploy` / `migrate status` | **PASS / PASS / up-to-date** |
| Live startup fail-closed (6 scenarios) | **PASS** (incl. no-secret-leak) |
| Live liveness / readiness / readiness-503 / SIGTERM | **PASS** (200 / 200 / 503-safe / clean exit) |

**Test quality (independent assessment):**
- Placeholder scan (`expect(true)`, `expect(false)`, bare `toBeTruthy()`, `toBeDefined()`) across the three Phase 19 specs: **none found.**
- **Would the tests fail if the control were removed?**
  - *Startup fail-closed:* runtime-config spec asserts each production rule rejects; live boot tests confirm the real process aborts. Removing a check → spec and boot both fail.
  - *Health split:* liveness test asserts `$queryRaw` not called (fails if liveness re-adds a DB check); readiness-503 test asserts `res.status(503)` called (fails if status removed); **leak test** serializes the body and asserts a realistic driver message (`db.internal`, `5432`, `connection refused`) is absent and no `detail` key exists (fails if `detail` is reintroduced).
  - *Storage permissions:* new tests `chmodSync` a dir to 0755/0777 and assert the constructor throws in production (fails if the check is removed); the 0750 no-chmod test fails if a silent chmod is added; traversal tests (pre-existing) fail if containment is weakened.
  - *Env contract guard:* exits 1 on injected stale variable (negative control run).
- These are behavioural and tightly bound to the controls, not tautologies. **No Phase 19 test is a placeholder or status-only smoke.**

## 15. Typecheck / build / lint results (O)

| Gate | Result |
|---|---|
| API typecheck (main + seed + test) | **PASS — 0 errors** |
| Mobile typecheck | **PASS — 0 errors** |
| Web typecheck | **PASS — 0 errors** |
| API build — clean & warm | **PASS**, `dist/main.js` present both times |
| API `build:verify` | **PASS** |
| Web production build | **PASS** |
| API lint | **55 errors / 127 warnings — identical to the Phase 18 baseline** (no new errors; the one warning the implementer introduced via import order was auto-fixed) |
| Mobile lint | 0 errors / 18 warnings (pre-existing; only the template changed) |
| Web lint | **PASS — 0 problems** |
| `git diff --check` | **clean** |

The 55 pre-existing API lint errors were neither hidden nor fixed.

## 16. Findings table (P)

| ID | Sev | Type | File(s) | Issue | Impact | Introduced by P19? | Remediation |
|---|---|---|---|---|---|---|---|
| **P19-01** | **MEDIUM** | Reliability / deployment blocker | `apps/api/Dockerfile`, `apps/web/Dockerfile` | Both runtime stages copy only `apps/<app>/node_modules`, but with pnpm's isolated linker every entry is a symlink into the **root** `node_modules/.pnpm`, which is never copied. Every transitive dependency resolves to a missing path at container start. | Neither production image can start as written — the deployment-ready state the phase targets is not actually achieved. | **No** — pre-existing since Phase 1 (`d42dcd2`). Phase 19 edited both files for other reasons and its "Dockerfile correctness" workstream missed it. | Copy the root pnpm store into the image, or build with `pnpm deploy` / `--node-linker=hoisted`, or run the workspace-root install and copy root `node_modules`. Validate with an actual `docker build` + `docker run` healthcheck. |
| **P19-02** | LOW | Pre-existing security-posture model | `security-config.ts`, `rate-limit.guard.ts`, `storage.service.ts` (via `NODE_ENV`) | Security posture (ephemeral JWT key, non-secure cookie, storage-fallback, rate-limit bypass) is gated purely on `NODE_ENV`. A mislabelled production deployment (`NODE_ENV=development`) degrades silently. | If someone runs a real deployment with the wrong `NODE_ENV`, security defaults weaken. Requires operator misconfiguration (not remote-exploitable). | **No** — pre-existing since Phase 16/18; Phase 19 mitigates with explicit warnings in `.env.example` and the operator quick-reference. | Consider a production guard independent of `NODE_ENV` (e.g. require a real secret always, or an explicit `ALLOW_INSECURE_DEFAULTS` opt-in that is impossible to set accidentally). Documented as a known limitation. |
| **P19-03** | LOW | Reliability (operational) | `storage.service.ts` (permission check) | The storage permission check reads mode bits and rejects any group/other bit. A production volume legitimately mounted root-owned `0755` (where root can still write) is refused. | Stricter than strictly necessary for a root-runner container; an operator must `chmod 700` a working volume. Fail-safe, not a security hole. | Partially — the *check* is new in Phase 19 (the modes are Phase 18). | Documented in the phase doc (chmod 700). Optionally relax to a warning for root, or check effective access rather than mode bits. |
| **P19-04** | LOW | Reliability (CI) | `.github/workflows/ci.yml` (fail-closed step) | The step runs `node dist/main.js` expecting a quick non-zero exit; a guard regression that allowed startup would hang the step until the job's default timeout (no `timeout-minutes`). | A regression would still fail the job (hang → limit), just slowly. Not a pass-silently risk. | **Yes** (new step). | Add `timeout-minutes` to the job or wrap the command in `timeout 30 …`. |
| **P19-05** | INFO | Code quality | `runtime-config.ts` `classifyDatabaseUrl` | Returns `hasCredentials` which is never used. | None (dead field). | Yes | Remove or use the field. |
| **P19-06** | INFO | Documentation | `verify-env-contract.mjs` diagnostic; Phase 19 doc | (a) The guard's "variables read by code" print omits `JWT_ACCESS_SECRET` (read via an `env` parameter, not `process.env[...]`); assertions still cover it. (b) The stale list is hardcoded, so a brand-new dead variable is not auto-detected. (c) Phase 19 doc §15 states mobile lint has "8 warnings"; actual is 18 (8 is the autofixable count). | Diagnostic/doc accuracy only; no functional/security impact. | Yes | Broaden the code-read scan to include `env[...]` parameter reads; make the doc's lint figure precise. |
| **P19-07** | INFO | Environment limitation | Docker images | `docker build` not run (no network/workspace install). Image correctness is **statically verified** only; P19-01 is deduced from the on-disk pnpm symlink layout, not from a live image. | Confidence in the Docker conclusions is high (symlink evidence is decisive) but not proven by an actual build. | N/A | Run `docker build` + `docker run` healthcheck in a networked environment. |
| **P19-08** | INFO | False positive (recorded to be explicit) | `main.ts`; Phase 19 doc | Searches match "helm"/"WebSocket"/"LLM" in the helmet import and the doc's out-of-scope lists. | None. | N/A | No action. |

**No CRITICAL or HIGH findings.** No finding is an exploitable vulnerability: P19-01 is a build/deployment blocker (not remote-exploitable), P19-02/03/04 are LOW, and the rest are informational.

## 17. Known limitations of this review (Q)

- Docker images were **not built** (environment limitation). Docker conclusions are static, with P19-01 evidenced by the on-disk pnpm symlink layout.
- The remote GitHub Actions workflow was **not executed** (repo not pushed); CI steps were validated by running their equivalent commands locally.
- The "DB down after startup" readiness-503 path was reproduced via a local TCP proxy (deterministic, matching the documented failure mode); the direct "Prisma refuses to connect at boot" path was also observed.
- Lint baselines are compared against the recorded Phase 18 numbers; no new lint debt was introduced (confirmed 55/127 unchanged).

## 18. Final verdict (R)

# APPROVED FOR PHASE 19 CHECKPOINT

**Rationale.** Phase 19's in-scope objectives were independently verified as genuinely met and, critically, as **not weakening any Phase 16–18 security control** (no auth/authz/guard/Prisma file was touched; every control re-confirmed present). The env contract is now accurate with no stale variables (the Phase 18 finding is resolved); production startup is fail-closed with secret-free errors (verified live, not just in tests); liveness/readiness are correctly separated with a real disclosure *removed*; SIGTERM drains cleanly; storage hardening is preserved and only *verified*; the database workflow is clean with no schema change; CI adds validation that does not deploy or weaken production; web/mobile configuration is correct.

The one **MEDIUM** finding (P19-01, the pnpm virtual-store / `node_modules` copy defect in both Dockerfiles) is a **pre-existing, non-security deployment blocker that Phase 19 did not introduce** and that would have existed identically before this phase. It is a genuine gap against the phase's stated Dockerfile-correctness goal and should be fixed (and the images actually built) before relying on the container images in a real environment — but it does not undermine the security posture, the correctness of the applied changes, or the code-level deployment readiness, and it is not a blocker for checkpointing the code.

Approval requires: no Critical/High ✓, no Phase 16 regression ✓, meaningful tests for every new control (each verified to fail if its control were removed) ✓, scope verified ✓, no Phase 20 contamination ✓, no unintended completed-phase modification ✓. The MEDIUM Docker finding is documented, non-security, pre-existing, and does not meet the bar for "REMEDIATION REQUIRED" at the code level; it is carried forward as the top item to fix (with an actual `docker build`) before any real deployment.

## 19. Exact repository state at review end (S)

- **HEAD:** `d0cd0dd2f175ae881bd201eb26d7e74a0c4158be` — "Complete Phase 17 testing CI and reliability" (**unchanged**).
- **Commit created:** **No.** `git diff --name-only d0cd0dd..HEAD` is empty; stash empty; nothing pushed.
- **Phase 20 started:** **No.**
- **git status --short:** identical to the pre-review state, with the single addition of `?? SECURITY_REVIEW_PHASE_19.md`. Specifically the working tree still shows: modified `PROJECT_PLAN.md` (pre-existing), the untracked `PROJECT_PLAN-old.md` and `SECURITY_REVIEW_PHASE_16/17/18.md` (pre-existing), and the Phase 18 + Phase 19 modified/untracked files — all unchanged. `git diff --check` clean.
- **Files modified by this review:** **only `SECURITY_REVIEW_PHASE_19.md`** (this artifact). No implementation, test, configuration, documentation, or project-plan file was altered.
- **Cleanup:** scratch database `p19_review` dropped (only the pre-existing dev `ecc` remains); `/tmp` proxy/scripts/logs removed; gitignored build artifacts (`dist/`, `.next/`, `*.tsbuildinfo`, `apps/api/uploads`) removed to restore the pre-review working tree.
