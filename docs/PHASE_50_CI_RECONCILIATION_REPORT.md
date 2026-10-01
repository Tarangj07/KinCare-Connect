# Phase 50 — CI Reconciliation Report

**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Nature:** CI-contract reconciliation only. **Not** a security review, **not** security-approved, **not** a penetration test, **not** a compliance assessment, and **not** Phase 51.

---

## 1. Starting commit

```
HEAD        = 7c21509127e7c696de65d3a8c857ff8cd4e4dd40
origin/main = 7c21509127e7c696de65d3a8c857ff8cd4e4dd40
branch      = main
parent      = d3679ec0c6cc77c537e286be1174573eb33e4152
working tree= clean (verified before any change)
```

Preflight was performed after `git fetch origin`. No reset, rebase, force-push or history rewrite was performed at any point.

## 2. Hosted CI run analyzed

Run `36913477213` against `7c21509127e7c696de65d3a8c857ff8cd4e4dd40`, reported as FAILURE across four gates:

| Job | Step |
|---|---|
| API | Configuration contract — env, ports, versions, secrets (Phase 23 W5) |
| Release | Mutation — the configuration audit detects drift (Phase 23 W5) |
| Web | Web runtime — the Image Optimization endpoint is unreachable (Phase 36 P35-1) |
| Containers | Build images and verify container runtime behaviour |

## 3. Reproduced failures

Every failure was reproduced on this machine by executing the repository's own scripts, not by reading the hosted log. All four reproduced **identically**.

| # | Command | Result |
|---|---|---|
| 1 | `node scripts/verify-config-contract.mjs` | **exit 1** — `` `API_INTERNAL_URL` is read by apps/web/src/lib/api-client.test.ts but is documented in no template `` |
| 2 | `node scripts/mutate-config-contract.mjs` | **exit 1** — 2 failed checks; baseline mutant M0 and the post-condition "the repository is unchanged by the harness" both failed for the same single reason as (1) |
| 3 | `node scripts/verify-next-image-optimizer.mjs` | **exit 1** — 1 failed check: ``FAIL  / still answers 200 (the app was not broken to close the endpoint)  status=307`` |
| 4 | `node scripts/verify-docker-images.mjs` | **exit 1** — 1 failed check: ``FAIL  home page renders 200 → home page did not render the expected content`` |

Every other check in (3) and (4) passed at the checkpoint, including all image-optimizer, container-hardening and API authorization checks.

## 4. Root cause 1 — `API_INTERNAL_URL` is undocumented

### Trace of every use

| Location | Use |
|---|---|
| `apps/web/src/lib/api-client.ts:34` | `apiBaseUrl()`: `process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL` |
| `apps/web/src/lib/api-client.test.ts:31-35` | test sets/restores it |
| `apps/web/src/lib/security-boundary.test.ts:4` | doc comment naming it as the reason `api-client.ts` is server-only |

Findings:

- **Where it is read:** one production site — `apiBaseUrl()`, used by every BFF route handler and every Server Component that fetches.
- **Server-only:** yes, by construction. `api-client.ts` has no `'use client'`; its importers are 6 route handlers, `api/_session.ts` and `lib/shell-data.ts` — all server modules. The only three `'use client'` modules (`providers.tsx`, `login/login-form.tsx`, `(authenticated)/seniors/senior-preference.tsx`) import none of them, and `security-boundary.test.ts` fails the build if that ever changes.
- **Intentionally distinct from `NEXT_PUBLIC_API_URL`:** yes. `NEXT_PUBLIC_*` is substituted into the client bundle **at build time**; a non-prefixed name is read on the server **at request time**. The BFF needs the *server-to-server* address, which need not be the *browser-facing* one. The name is load-bearing for that property.
- **Required at runtime:** no. It falls back to `NEXT_PUBLIC_API_URL`, then to `http://localhost:3000`. It is an **optional** deployment variable, not a hard requirement, and no gate treats it as one.
- **Must it be present in production?** No, but a deployment whose public and internal API addresses differ must set it, and today no template says so.
- **Is the environment-contract gate correct to require it?** Yes, and it was **not** weakened. `verify-config-contract.mjs` fails any variable read under `apps/*/src/` that appears in no template. That rule is exactly what surfaced the omission, and it continues to apply: after the fix, mutant **M1** ("a code-read variable removed from the templates is detected") still passes, which proves the new documentation is load-bearing rather than silencing the gate.

### Change made

`API_INTERNAL_URL` added to the two environment templates that describe `apps/web`, documented as optional, server-only, and non-secret, with an explicit warning against a `NEXT_PUBLIC_` rename. No value that resembles a credential was added.

**One hazard found and avoided during the change.** The root template instructs operators to export with `env $(grep -v '^#' .env | xargs)`. An empty assignment (`API_INTERNAL_URL=`) is *not* `undefined`, so `??` would not fall through and `apiBaseUrl()` would return `''`, producing a relative URL. The template therefore ships a real value (`http://localhost:3000`, identical to the existing fallback, so behaviour is unchanged) and states that **absent ≠ empty**. This is a documentation decision only; no application code was changed.

## 5. Root cause 2 — stale root-route assumptions

### Determination: the gates are obsolete (option B), not a broken contract (option A)

Evidence:

1. **What `/` was.** At the parent commit, `apps/web/src/app/page.tsx` was a **public placeholder landing page** — "Phase 1 · Foundation", heading "Elderly Care Coordination", linking to `/dashboard`. Both failing assertions were written against exactly that content.
2. **What `/` is now.** `apps/web/src/app/page.tsx` is a `force-dynamic` Server Component that calls `readIdentity()` and issues `redirect(user ? '/dashboard' : '/login')`. Measured against the real production standalone server and against the real container: anonymous `GET /` → **307**, `Location: /login`.
3. **This was intended, documented and reported.** `docs/PHASE_50_FINAL_REPORT.md` §8 (Layer 1 server guard, 307, no protected markup), §16 (runtime verification: unauthenticated `/` → 307 to `/login`), §19 (the change is listed), and the Phase 48 finding it closes (**PR-48-19**, "role dashboards reachable without authentication").
4. **No application defect.** The redirect works, the guard in `apps/web/src/app/(authenticated)/layout.tsx:32` works, `/dashboard` and `/seniors` also return 307 to `/login`, and the web typecheck, lint, 62 unit tests, build and all 19 image-optimizer checks pass.
5. **The placeholder is gone from the tree.** `Elderly Care Coordination` survives in the repository only in `README.md`, older docs, the Prisma schema comment, and the one stale assertion being replaced.

Therefore **the application was not changed**. Restoring placeholder content, or making `/` publicly render, would have re-opened PR-48-19. The gates were updated instead.

### A third, unreported staleness found in the same area

`verify-docker-images.mjs`'s `dashboard route renders` check was asserting `200` and **passing** — because `fetch` follows redirects by default, so it saw the `/login` page and reported `HTTP 200`. It was asserting nothing about the dashboard. This is the same root cause and is fixed in the same place.

## 6. Exact changes made

Four files. No application source, no backend, no schema, no lockfile, no CI workflow.

### `.env.example`, `apps/web/.env.example`
Documentation of `API_INTERNAL_URL` only (§4).

### `scripts/verify-next-image-optimizer.mjs` — layer 4 only
Layers 1-3 (config / build manifest / runtime image-optimizer probes) are **untouched**. Only the *non-regression* layer changed. It previously asserted `/` == 200 and `/health` == 200. It now asserts the contract:

| Check | Assertion |
|---|---|
| 4a | `GET /` is 3xx **and** `Location` starts with `/login` |
| 4b | `GET /login` is 200 **and** contains `signin-heading` (the `aria-labelledby` target of the sign-in card) |
| 4c | the `/` body contains no `shell_shell__` CSS-module class and sets no `ecc_at` cookie |
| 4d | `GET /dashboard` is 3xx to `/login`, contains no `shell_shell__`, sets no `ecc_at` |
| 4e | `GET /health` is 200 — **unchanged from before** |

Supporting change: `rawProbe()` now also returns the `Location` header, the header block and the body text, because the contract cannot be expressed in a status code alone.

### `scripts/verify-docker-images.mjs` — web section only
| Was | Now |
|---|---|
| `home page renders 200` + `Elderly Care Coordination` body match | `the root route redirects an anonymous caller to /login (no public landing page)` — `redirect: 'manual'`, 3xx, `Location` `/login`, no `shell_shell__`, no `ecc_at` |
| `dashboard route renders` (passed via redirect-following) | `an authenticated route also redirects an anonymous caller and serves no protected content` — same four assertions on `/dashboard` |
| — | **new** `the login route the redirect points at is reachable in the shipped image` — `/login` 200 with the sign-in form |
| — | **new** `the server-only API_INTERNAL_URL never reaches anything the browser receives` — the variable is asserted **set inside the container** (positive control), then its internal address is asserted absent from `/`, `/login` and `/health` |
| `static assets are served` fetched `/` (silently followed the redirect) | fetches `/login`, the page an anonymous caller actually reaches |

`waitForHttp()` gained an optional `redirect` passthrough and returns `headers`. All 51 API-container checks and all image/hygiene/shutdown checks are unchanged.

## 7. Why the changes preserve the Phase 50 security architecture

- **The authentication boundary is untouched.** `apps/web/src/app/page.tsx` and `apps/web/src/app/(authenticated)/layout.tsx` are not in the diff. Verified by source read after the change.
- **The BFF is untouched.** No route handler, no upstream mapping, no proxy surface.
- **`API_INTERNAL_URL` is not exposed to the browser.** It has no `NEXT_PUBLIC_` prefix, so Next.js substitutes it server-side only. This is now *asserted at runtime against the shipped image*, not merely asserted in a comment (§6). The positive control means the check cannot pass by the variable simply being absent.
- **No token handling was touched.** No `localStorage`, `sessionStorage` or `document.cookie` anywhere in `apps/web/src` (the only match is the regex inside `security-boundary.test.ts` that forbids them). No access token reaches the browser; `/auth/me` revalidation is untouched.
- **No gate was disabled, skipped or made advisory.** `.github/workflows/ci.yml` is byte-identical to the checkpoint. `continue-on-error` appears twice, both pre-existing advisory lint steps. `verify-config-contract.mjs`, `verify-env-contract.mjs` and `verify-ci-parity.mjs` are byte-identical and all pass.

## 8. Existing gate contracts preserved

| Gate | Status |
|---|---|
| P35-1 layers 1-3 (image optimizer) | **unchanged** — every assertion identical |
| P35-1 layer 4 `/health` | **unchanged** |
| Phase 23 W5 configuration audit | **unchanged**, still fails an undocumented read; mutant M1 still proves it |
| Phase 19 env-template contract | **unchanged** |
| Phase 32 CI parity | **unchanged**, passes |
| All 12 container API/image/hygiene/shutdown checks | **unchanged** |
| `mutate-next-image-optimizer.mjs` | **unchanged**, all 9 mutants behave as before, real files byte-identical afterwards |
| Every assertion unrelated to the root-route contract | **unchanged** |

## 9. Assertions that had to change, and why

Only three, all in the root-route contract:

1. `verify-next-image-optimizer.mjs`: `` `/` still answers 200 `` → the four contract checks in §6.
2. `verify-docker-images.mjs`: `home page renders 200` (+ placeholder-copy match) → the redirect contract.
3. `verify-docker-images.mjs`: `dashboard route renders` (200, satisfied by redirect-following) → the same redirect contract on `/dashboard`.

Both old assertions encoded a public `/` that Phase 50 deliberately removed. Neither could be satisfied by the intended behaviour; each was replaced with a *strictly stronger* check, not a loosened one.

### Proof that the new assertions are strictly stronger — executed negative controls

Each was run against a throwaway `mkdtemp` mirror of the built `.next` tree. The repository was never written to.

| Mutant applied to the mirror | Old assertion (`200`) | Bare `307` assertion | **New contract assertions** |
|---|---|---|---|
| `/` renders a public 200 page (pre-Phase-50 shape) | would **PASS** — the security regression goes undetected | FAIL | **FAIL** — `status=200 location=(none)` |
| `/` redirects to a dead page instead of `/login` | FAIL | would **PASS** | **FAIL** — `status=307 location=/nope-does-not-exist` |
| The server-side guard in `(authenticated)/layout.tsx` is **deleted** from the built chunk | PASS | PASS | **FAIL** — `status=200 shell-marker=PRESENT (protected content rendered)` |

The third is the significant one: **no pre-existing gate detected removal of the Phase 50 authentication guard.** The new `/dashboard` probe does.

## 10. Local verification results

Exact CI commands, run locally on Node 24.18.0 / pnpm 11.25.0.

### API job
| Step | Result |
|---|---|
| `prisma validate` / `generate` / `migrate deploy` | PASS (throwaway PostgreSQL) |
| `pnpm --filter @ecc/api typecheck` | PASS |
| `pnpm --filter @ecc/api build` | PASS |
| `pnpm --filter @ecc/api build:verify` | PASS (clean + warm + stale tsbuildinfo) |
| `verify:metadata` (W1) | PASS — 68 DTO identity checks |
| `verify:routes` (W3) | PASS |
| `verify-config-contract.mjs` (W5) | **PASS (was FAIL)** |
| `verify-dependency-audit.mjs` (W6) | PASS |
| `triage-vulnerabilities.mjs` (W6) | PASS |
| `verify-dependency-triage.mjs` (F-5) | PASS |
| `verify-next-config-features.mjs` (F-4) | PASS |
| `verify-dependency-security-floor.mjs` (P34-1) | PASS — 3 instances, 0 below floor |
| `verify-dependency-floor-policy.mjs` (R36-03) | PASS — 16/16 |
| `verify-dependency-advisory-visibility.mjs` (F-39-01/F-40-01/P42-01) | PASS |
| API unit tests | **PASS — 20 files / 245 tests** |
| API integration tests | **PASS — 9 files / 195 tests** |
| `verify-env-contract.mjs` | PASS |
| production contract fail-closed + startup smoke | PASS (valid accepted, missing `STORAGE_DIR` refused by name, liveness/readiness ok, graceful SIGTERM) |
| `verify-compiled-auth-suite.mjs` (W2) | PASS |
| `verify-compiled-auth.mjs` (Phase 22) | PASS |
| artifact sanity | PASS |
| API `lint` | exit 1 — **78 errors / 69 warnings, `continue-on-error: true` advisory step**. Pre-existing debt in a tree byte-identical to the checkpoint; not introduced here. (The step's comment cites "55 pre-existing errors"; the count has drifted since Phase 16. Recorded, not addressed.) |

### Web job
| Step | Result |
|---|---|
| `pnpm --filter @ecc/web typecheck` | PASS |
| `pnpm --filter @ecc/web lint` | **PASS — 0 errors, 0 warnings** (baseline preserved) |
| `pnpm --filter @ecc/web test` | **PASS — 4 files / 62 tests** |
| `pnpm --filter @ecc/web build` | PASS — 13 routes (clean rebuild from an empty `.next`) |
| `verify-next-image-optimizer.mjs` (P35-1) | **PASS — 19 checks, 0 fail (was FAIL)** |

### Release job
| Step | Result |
|---|---|
| `verify-ci-parity.mjs --list` (Phase 32) | PASS — 56/59 locally runnable, 3 runner-only |
| `verify-db-migrations.sh` (W9) | PASS |
| `verify-release-artifact.mjs` (W10) | **PASS — 13/13** (316 API files 1:1; two builds byte-identical; 2961 standalone files; no baked secret; `NEXT_PUBLIC_API_URL` runtime-read) |
| `verify:storage:backup` (WS2) | PASS |
| `mutate-config-contract.mjs` | **PASS — 17 checks (was FAIL)** |
| `verify:metadata:mutate` (W1) | PASS |
| `verify:routes:mutate` (W3) | PASS |
| `verify:lifetime:mutate` (D-2) | PASS |
| `verify:ratelimit:n12:mutate` (Phase 28) | PASS |
| `mutate-next-config-rewrites.mjs` (F-4) | PASS |
| `mutate-next-image-optimizer.mjs` (P36) | **PASS — 9 mutants, real files byte-identical** |
| `mutate-dependency-security-floor.mjs` (P34-1) | PASS |
| `mutate-dependency-floor-policy.mjs` (R36-03) | PASS |
| `mutate-dependency-advisory-visibility.mjs` | PASS |
| `run-db-suites.mjs` (Phase 28) | PASS — e2e **195/195**, `test:all` **440/440** |
| `mutate-ci-integration.mjs` (Phase 29) | PASS |
| `git diff --exit-code -- pnpm-lock.yaml` | PASS |

### Mobile job
| Step | Result |
|---|---|
| `pnpm --filter @ecc/mobile typecheck` | PASS |
| `pnpm --filter @ecc/mobile test` | **PASS — 6 files / 34 tests** |
| `pnpm --filter @ecc/mobile lint` | exit 1 — 18 warnings, `continue-on-error: true` advisory step. Pre-existing, unchanged. |

### Repository
| Step | Result |
|---|---|
| `pnpm typecheck` | PASS — 11/11 |
| `pnpm build` | PASS — 7/7 |

### Containers job
| Step | Result |
|---|---|
| `node scripts/verify-docker-images.mjs` (full, with image build) | **PASS — 60 checks, 0 fail (was FAIL)** |

## 11. Files changed

| File | Lines | Nature |
|---|---|---|
| `.env.example` | +23 | environment template documentation |
| `apps/web/.env.example` | +8 | environment template documentation |
| `scripts/verify-next-image-optimizer.mjs` | +154 / −25 | layer-4 non-regression contract; probe extended |
| `verify-docker-images.mjs` (header comment + web section + `waitForHttp`) | +141 / −19 | web-container contract; leak check with positive control |

`git status --porcelain` shows exactly these four files. `git diff --name-only -- apps/api apps/mobile packages pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json .github docker-compose.yml apps/web/src apps/web/next.config.mjs apps/web/Dockerfile apps/web/package.json security/` is **empty**.

## 12. Explicit nonchanges

- **No application source changed.** Not one line of `apps/web/src` — the BFF, the guard, the login flow and the client are exactly as Phase 50 delivered them.
- **No backend change.** `apps/api` is byte-identical to the checkpoint.
- **No Prisma schema or migration change.** No new migration, no edited schema, no `migrate` behaviour change.
- **No authorization change.** `AuthorizationService` untouched; no senior-scoped read re-examined.
- **No dependency change.** No `package.json`, no `pnpm-lock.yaml`, no new package, no version bump.
- **No CI workflow change.** `.github/workflows/ci.yml` byte-identical: no step added, removed, reordered, made advisory, or given `continue-on-error`.
- **No security gate disabled, bypassed or weakened.** Not `verify-config-contract.mjs`, not `verify-env-contract.mjs`, not `verify-ci-parity.mjs`, not any dependency floor or triage gate.
- **No gate weakened by loosening a threshold.** Every replacement assertion is *tighter* than what it replaced (§9).
- **No placeholder content restored** and **no public route added**.
- **No unrelated refactoring.** The API lint debt, the `triage-vulnerabilities` postcss disposition and the `continue-on-error` lint steps are all recorded, not touched.
- **No Phase 50 security review, and no Phase 51 work.**

## 13. Remaining limitations

1. **The reconciliation is not a security review.** Nothing here assesses whether the Phase 50 design is sound. That is the separate, independent phase that follows.
2. **`apiBaseUrl()` treats an empty string as set.** `process.env.API_INTERNAL_URL ?? …` does not fall through on `API_INTERNAL_URL=`, which yields a relative URL. Mitigated in the templates by shipping a real value and by stating that *absent ≠ empty*, but the code path itself is unhardened. **Left unchanged deliberately**: it is application code, no gate fails, and it is outside this reconciliation's scope. Recorded for the security review.
3. **`shell_shell__` is a build-output class name.** It is Next's CSS-module class for `apps/web/src/app/(authenticated)/shell.module.css`. It is stable across any renaming of the module's exported class names, but it would change if the stylesheet were renamed. A rename would make checks 4c/4d *weaker* (they would degrade to the `Location`/`Set-Cookie` halves), never weaker than the assertions they replaced.
4. **`signin-heading` is a DOM id in the login page.** Renaming that id would fail 4b and the container login check loudly, not silently. That is the intended direction of failure.
5. **`mutate-next-image-optimizer.mjs` does not yet mutation-test the new layer-4 checks.** The three negative controls in §9 were executed by hand against throwaway mirrors and are recorded here, not encoded in the harness. Automating them is a reasonable follow-up but was not authorised in this phase.
6. **No browser-automated evidence.** All evidence is HTTP-level against the real standalone server and the real container. No rendered-DOM or hydration evidence, unchanged from the Phase 50 baseline.
7. **API and mobile lint still fail** as advisory steps, at 78 errors and 18 warnings respectively. Pre-existing, in trees this change does not touch.
8. **Hosted CI was not observed to be green by this document.** §14 records the run; only the hosted result can establish that.

## 14. Is the repository ready for a new hosted CI run?

Yes, with respect to the four gates that failed. Every CI-relevant local gate listed in §10 passes, including all three mutation harnesses that cover the changed gates, and the diff is four files with no backend, schema, dependency or workflow change.

The single determination this phase cannot make on its own is the hosted result. That is recorded in §15 after the push.