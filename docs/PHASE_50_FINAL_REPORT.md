# Phase 50 — Web Client Foundation — Final Report

**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Starting checkpoint:** `d3679ec0c6cc77c537e286be1174573eb33e4152` (Phase 49 checkpoint)
**Date:** 2026-10-02
**Nature:** Implementation phase. **Not** a security review, **not** security-approved, **not** production-ready, **not** penetration-tested, and **not** a compliance assessment.

---

## 1. Objective

Turn the placeholder Next.js application into a real, authenticated, senior-aware web client that consumes the Phase 49 backend access foundation.

Addresses: **PR-48-04** (web client cannot function), **PR-48-C01** (no login/API client/data fetching), **PR-48-C03** (no client consuming the senior-resolution endpoint), **PR-48-C04** (fake per-role dashboards), **PR-48-C05** (vacuous web test coverage), **PR-48-19** (role dashboards reachable unauthenticated).

The Phase 49 backend was **not** modified. Verified: a 159-file SHA-256 manifest covering `apps/api/src`, `apps/api/prisma`, `apps/api/test` and `docs/*.md` recorded before implementation was re-verified after: **0 changed**.

---

## 2. Starting checkpoint

```
HEAD        = d3679ec0c6cc77c537e286be1174573eb33e4152
origin/main = d3679ec0c6cc77c537e286be1174573eb33e4152
branch      = main
parent      = d4c570bb56a1bef38b009e7890469b9b84bac5e3
working tree= clean
```

---

## 3. Preflight findings

| Area | Finding |
|---|---|
| Web stack | Next.js **14.2.35** (App Router), React 18, TypeScript, `output: 'standalone'` |
| Web routes | `/`, `/dashboard`, `/dashboard/{family,caregiver,admin,org,senior}`, `/health` — 15 files total |
| Authentication | **None.** No login page, session, token handling or cookies |
| API client | **None.** Only `api-base.ts` exporting a base-URL string |
| State management | `providers.tsx` was a passthrough fragment |
| Tests | **1 file, 1 test** asserting `typeof API_BASE_URL === 'string'` (vacuous — PR-48-C05) |
| `/dashboard` | 5 cards, **all `href` targets 404** (no emergency/health/medications/documents/appointments routes exist) |
| Role dashboards | All 5 are **11-line static text**, reachable without authentication |
| Environment | `NEXT_PUBLIC_API_URL` only |

### Baseline gates (before implementation)

| Gate | Baseline |
|---|---|
| web typecheck | **PASS** |
| web lint | **PASS — 0 errors, 0 warnings** |
| web test | **PASS — 1 file / 1 vacuous test** |
| web build | **PASS — 7 routes** |

Because lint was clean, **any new lint error is a Phase 50 regression.**

### Architectural constraint discovered

**The NestJS API enables `helmet` but NOT CORS** (verified: no `enableCors` anywhere in `apps/api/src`). A browser at `localhost:3001` therefore cannot read responses from `localhost:3000/api/v1/*` — a naive client-fetch web app would not work at all against the existing backend.

---

## 4. Architecture decision: Next.js BFF

```
Browser  ──same-origin──▶  Next.js Route Handler (BFF)  ──server-to-server──▶  NestJS API
                            │                                                    │
                            └─ HTTP-only cookie holds the access token          └─ AuthorizationService
```

Consequences:

- **No backend CORS was added** (§5).
- **The browser never receives the access token.** Login returns only public identity fields; the token is re-emitted as an HTTP-only cookie.
- **No generic proxy.** Every BFF route forwards to a **fixed, code-defined** upstream path.

---

## 5. Why backend CORS was not added

CORS is a backend change to an authorization-adjacent surface and is explicitly out of Phase 50's scope. Adding it would also have widened the API's cross-origin surface without need. The BFF removes the requirement entirely: the browser talks only to its own origin, and the Next server calls the API server-to-server where CORS does not apply. **`apps/api` is byte-identical to the checkpoint.**

---

## 6. Authentication implementation

`POST /api/auth/login` (BFF) → `POST /api/v1/auth/login` (API).

The BFF takes the access token from the API's login response body, **never returns it to the browser**, and re-emits it as `ecc_at` with `HttpOnly`, `sameSite=lax`, `secure` in production. The API's own `refresh` cookie is captured from `Set-Cookie` and re-emitted as `ecc_rt` (also HTTP-only) for future renewal.

A failed login returns the backend's real status (**401**), sets **no** cookie, and the UI shows an error. There is no code path in which a rejected sign-in produces an authenticated-looking state.

`POST /api/auth/logout` revokes server-side via the existing `POST /api/v1/auth/logout` and then clears `ecc_at`, `ecc_rt` and `ecc_senior`. **A local session is destroyed even if revocation fails.**

---

## 7. Session / cookie handling

| Cookie | HTTP-only | Purpose |
|---|---|---|
| `ecc_at` | **yes** | Access token; read server-side only |
| `ecc_rt` | **yes** | API refresh token; server-side only |
| `ecc_senior` | no | Active-senior **UI preference** only — never an authorization source |

**Cookie presence is never treated as proof of authentication.** Every authenticated request re-verifies the token against `GET /auth/me` (`readIdentity`). A forged, expired or revoked token fails verification and the session is reported unauthenticated. Verified at runtime: a forged `a.b.c` cookie produced `401` and a redirect from `/dashboard`.

A 5xx is reported as an **error** state, never silently downgraded to "unauthenticated" — so a service outage is not misreported as an auth problem.

---

## 8. Route protection — and exactly what is protected

**Layer 1 — Next.js server guard** (`app/(authenticated)/layout.tsx`): a Server Component that redirects to `/login` **during server rendering**. An unauthenticated request to `/dashboard`, `/seniors` or `/` receives a **307** and **no protected markup**. This is server-side, not a client-side redirect after hydration, and not merely hidden navigation.

**Layer 2 — BFF authentication**: every `/api/*` route returns **401** without a valid session cookie.

**Layer 3 — NestJS authorization**: unchanged `AuthorizationService`. Every senior-scoped read is re-authorized server-side.

**What this phase does NOT claim:** Layer 1 is an authentication boundary, not an authorization boundary. It does not decide which seniors a user may see — that is `GET /me/seniors` plus `AuthorizationService`. No frontend role check replaces backend authorization.

---

## 9. BFF endpoints

Explicit, typed, fixed-upstream routes only:

| Route | Upstream |
|---|---|
| `POST /api/auth/login` | `POST /api/v1/auth/login` |
| `POST /api/auth/logout` | `POST /api/v1/auth/logout` |
| `GET /api/auth/session` | `GET /api/v1/auth/me` |
| `GET /api/me/seniors` | `GET /api/v1/me/seniors` |
| `POST /api/me/senior` | *none — preference cookie only* |
| `GET /api/seniors/:seniorId/medications` | `GET /api/v1/seniors/:seniorId/medications` |
| `GET /api/seniors/:seniorId/appointments` | `GET /api/v1/seniors/:seniorId/appointments` |
| `GET /api/seniors/:seniorId/care-circle` | `/me/seniors` → `GET /api/v1/care-circles/:id/members` |

Status semantics are preserved end to end. `401` stays `401`, `403` stays `403`, and a `403` is **never** converted into an empty list. A `404`/failure from the backend is never turned into a successful empty state.

`seniorId` path parameters are validated as UUID v4 before use (**400** otherwise). No route reads an upstream URL from the request.

---

## 10. `/auth/me` integration

Consumed through the BFF with the **existing, unmodified contract**: `{ id, email, fullName, globalRole }`. **No `seniorId` was added** and the backend response was not changed. Verified at runtime: the rendered login/dashboard flow uses exactly these fields.

---

## 11. `/me/seniors` integration and active-senior selection

The **only** source of an active senior is the backend's `GET /api/v1/me/seniors` response.

`resolveActiveSenior(seniors, preferredId)` — a pure, tested function:

| Situation | Behaviour |
|---|---|
| Zero seniors | explicit empty/onboarding state |
| One senior | selected automatically |
| Multiple seniors | explicit selector, nothing auto-selected |
| Preference still authorized | honoured |
| **Preference not in the backend list** | **discarded** (stale) |

A senior id from a URL, cookie or constant is a **preference hint only** and is discarded when absent from the server list. `applyExplicitSelection` returns `null` for any id not in that list, so a tampered selection cannot enter application state.

**Frontend selection is UX, not a security control.** The backend re-authorizes every senior-scoped request. Verified at runtime: user B received **403** on all three of user A's senior-scoped resources using A's real, valid senior id.

`?senior=<id>` is honoured per-request when the backend authorizes it. A Server Component cannot write cookies in Next 14 (`cookies().set()` throws — observed as an HTTP 500 during verification), so persistence goes through `POST /api/me/senior`, which stores a preference **without** calling the API and **cannot** authorize anything.

---

## 12. Application shell

Replaced the static dashboard. The shell renders: brand, **real signed-in name and email**, active senior with role and care-circle names, senior switcher, sign-out, main content, and an explicit **"Not available yet"** list (care tasks, notifications, messaging, document upload, family feed, emergency contacts).

Where a role allows something, the shell does not pretend it does. Frontend role handling is UX; backend authorization is untouched.

The five fake role dashboards were **removed** (PR-48-C04), as were the five dead-link cards (PR-48-19). The misleading experience is replaced by a coherent authenticated shell rather than wrapped in an auth check.

---

## 13. Dashboard

Shows only what the backend returned for the selected senior: name, date of birth, care circles, membership role, plus real medication and appointment lists with **real lengths from real API responses**. No metric is estimated or hardcoded. Panels distinguish *unavailable*, *error* (with a 403-specific message), *empty* and *populated*, and state that medication/appointment **management** is not available yet.

---

## 14. Error semantics

| Condition | Behaviour |
|---|---|
| 401 | session/auth failure; redirects to login |
| 403 | authenticated but not permitted — **distinct message**, never an empty list |
| 404 | resource not found |
| 400 / non-UUID id | validation error |
| 5xx / network | error state with a message that **does not leak the internal API URL** |

No silent fall-back to a cached identity after an arbitrary API failure; a backend outage renders an error, not a false dashboard.

---

## 15. Tests

**62 tests across 4 files** (was 1 file / 1 vacuous test). The vacuous `api-base.test.ts` was removed.

| File | Tests | Covers |
|---|---|---|
| `seniors.test.ts` | 19 | zero/one/multiple seniors, switching, **stale rejection**, fabricated id refusal, UUID shape |
| `session.test.ts` | 20 | status classification, 401≠403, 5xx ≠ unauthenticated, cookie parsing, `Set-Cookie` extraction |
| `api-client.test.ts` | 14 | Bearer attachment, no body on GET, `no-store`, **403 is not an empty list**, network failure, rejected login throws |
| `security-boundary.test.ts` | 9 | **no client component imports the server-only modules**, no browser storage, no hardcoded UUID, no token logging, no arbitrary-upstream route, UUID validation before forwarding |

The security-boundary suite is a **source-scan** guard: it fails if a future refactor makes `api-client` reachable from `'use client'`, or reintroduces a hardcoded senior id. No new test dependencies were added.

All required behaviours are covered: unauthenticated→login decision, authenticated→allowed, failed login establishes nothing, logout clears state, `/me/seniors` drives selection, zero/one/multiple, stale rejection, arbitrary id refused, 401 / 403 / 5xx distinct, and no token in browser storage.

---

## 16. Runtime verification

Real API (`dist/main.js`, `NODE_ENV=production`) against a **throwaway** PostgreSQL, plus the real Next.js standalone server, driven with a cookie jar (browser-shaped HTTP; **no browser automation was available, so no browser-rendering evidence is claimed**).

**69 checks passed, 0 failed.**

- Unauthenticated `/dashboard`, `/seniors`, `/` → **307 to `/login`**, with **no protected content** in the body
- Failed login → **401**, **no cookie**, session stays unauthenticated
- Successful login → **200**, identity contract returned, **no JWT in the body**, `ecc_at` set with **`HttpOnly`**
- Zero seniors → explicit empty state; two seniors → both listed; zero fabricated content
- Senior selection and switching work; medications/appointments/care-circle return **200** with real data
- Fabricated senior id → **not** rendered as active; senior-scoped calls → **403**; non-UUID → **400**
- Cross-user: user B gets **403** on all three of A's senior-scoped resources using A's **real** id; sees zero seniors; cannot view A's senior detail
- Forged/garbage cookie → **401**, protected route still redirects
- Logout → cookie cleared, session unauthenticated, protected page redirects, BFF refuses
- No JWT in rendered HTML or in `/api/auth/session`

*One diagnostic note:* the caller's own fabricated id does appear in the HTML — but only inside Next's RSC `urlParts`/searchParams payload, i.e. the caller's own query string being echoed back. It is **not** rendered as the active senior, and no unauthorized senior data accompanies it. Verified by inspecting each occurrence in context.

---

## 17. Typecheck / lint / build

| Gate | Result |
|---|---|
| web typecheck | **PASS** |
| web lint | **PASS — 0 errors, 0 warnings** |
| web test | **PASS — 4 files / 62 tests** |
| web build | **PASS** — 13 routes (7 BFF + `/login`, `/dashboard`, `/seniors`, `/health`, `/`) |
| repo `pnpm typecheck` | **PASS — 11/11** |
| repo `pnpm build` | **PASS — 7/7** |
| `run-db-suites.mjs` (API untouched) | **PASS — 195 integration, 440 all** |

**Lint regression delta: ZERO.** The baseline was 0 errors / 0 warnings and it remains so.

---

## 18. Security-sensitive source checks

| Check | Result |
|---|---|
| `localStorage` / `sessionStorage` / `document.cookie` | **NONE** |
| Hardcoded senior UUID outside tests | **NONE** |
| `DEFAULT_SENIOR_ID` / `SENIOR_ID =` | **NONE** |
| Token/secret logging (`console.*`) | **NONE** |
| Arbitrary upstream proxy (`?url=`) | **NONE** |
| Client component importing `api-client` or `_session` | **NONE** (enforced by test) |
| Direct cross-origin API calls from the browser | **NONE** — only two `'use client'` modules, neither reaching server code |
| Browser-reachable secrets | **NONE** — only `NEXT_PUBLIC_API_URL` (public by design) and `NODE_ENV` |

---

## 19. Exact changed files

**Modified (4):**
- `apps/web/src/app/layout.tsx` — metadata
- `apps/web/src/app/page.tsx` — server-side redirect to `/login` or `/dashboard`
- `apps/web/src/app/providers.tsx` — documented minimal
- `apps/web/src/app/globals.css` — real styling, focus-visible

**Deleted (9):** the 5 static role dashboards, the old `page.module.css` placeholder, the vacuous `api-base.test.ts`, and the now-orphaned `api-base.ts` (its constant had zero remaining references; `/health` reads the env var directly).

**Created (20):** `lib/{types,api-error,api-client,session,seniors,shell-data}.ts`; 8 BFF route handlers; `_session.ts`; `/login` (page, form, css); `(authenticated)/{layout,layout-shell,dashboard,seniors}` + css + `senior-preference.tsx`; 4 test files.

**Nothing outside `apps/web` changed.** No backend, schema, migration, CI, dependency or lockfile change. Not staged.

---

## 20. Phase 48 findings closed

- **PR-48-04** — web client can now authenticate, discover seniors, select a senior and read real senior-scoped data.
- **PR-48-C01** — login page, real API client, real data fetching.
- **PR-48-C03** — a client now consumes `GET /me/seniors`.
- **PR-48-C04** — fake role dashboards removed.
- **PR-48-C05** — vacuous test replaced with 62 behavioural tests.
- **PR-48-19** — authenticated routes now redirect unauthenticated users.

## 21. Phase 48 findings remaining open

**PR-48-05, PR-48-06, PR-48-07, PR-48-08, PR-48-09, PR-48-10, PR-48-11, PR-48-12, PR-48-13, PR-48-14, PR-48-15, PR-48-16, PR-48-17, PR-48-18, PR-48-19, PR-48-20 … PR-48-24, PR-48-31, PR-48-32** — all remain open. Also still open from earlier phases: the **Phase 45** security baseline and **Phase 16 D-1** (access tokens not revoked on deactivation).

---

## 22. Explicit out-of-scope work

Care tasks · notification delivery and push · messaging UI · appointment UI beyond the read-only list · medication UI beyond the read-only list · health-management features · super-admin · invitations · organization/subscription · any backend authorization change · Prisma schema/migrations · mobile · production deployment/observability · load testing · security certification / penetration testing · Phase 51.

---

## 23. Known limitations

1. **No browser-automated verification.** Runtime evidence is HTTP-level against the real production server. No JS-executed or rendered-DOM evidence; no hydration or client-navigation behaviour was exercised.
2. **No registration UI.** Account creation is backend-only; the login page states this implicitly. A user with no account has no web path to obtain one.
3. **No self-service senior onboarding in the UI.** With zero seniors the user sees an explicit empty state explaining care-circle access. `POST /api/v1/seniors` is available but no web form is offered.
4. **No silent token refresh.** When `ecc_at` expires the user is redirected to `/login`. `ecc_rt` is stored and forwarded on logout, but no background renewal is implemented.
5. **Client-side data fetching is limited.** Panels are server-rendered; there is no client cache layer (deliberately — no new state dependency).
6. **Role-based navigation is informational.** It reflects the backend's role hint and does not gate anything; the backend does.
7. **`GET /health` is unchanged** and still performs a direct server-side probe.
8. **The RSC payload echoes the caller's own query string**, so a supplied senior id appears in the HTML payload. It is never treated as authorized.
9. **No automated a11y verification** beyond semantic markup and `:focus-visible`.
10. **Repository-wide lint debt outside `apps/web` is untouched.**

---

## 24. Git boundary

```
git status --short   -> apps/web only (see §19)
git diff --stat      -> apps/web only
git diff --name-only -> apps/web only
HEAD                 = d3679ec0c6cc77c537e286be1174573eb33e4152
origin/main          = d3679ec0c6cc77c537e286be1174573eb33e4152
```

**No commit. No push. No amend/rebase/reset. Nothing staged.** No file outside the intended Phase 50 boundary changed. Developer database verified unchanged (**37 tables**); all throwaway containers destroyed.
