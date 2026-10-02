# Phase 50 Independent Security Review

## 1. Scope

- Phase 50 web client / BFF implementation (`apps/web/src`).
- Authentication, cookie/token handling, BFF route authorization, server/client boundary, route protection, RSC/query-string behavior, cache isolation, container/deployment boundaries, and security-gate quality.
- Explicitly out of scope: backend authorization changes (none made), Prisma schema, mobile, production deployment/observability, penetration testing, browser-level automation.

## 2. Starting Commit

- HEAD: `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- `origin/main`: `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- Parent: `7c21509127e7c696de65d3a8c857ff8cd4e4dd40`
- Previous Phase 49 checkpoint: `d3679ec0c6cc77c537e286be1174573eb33e4152`
- Working tree clean; no tracked modifications except the final report.

## 3. Review Methodology

1. Checkpoint verification (`git rev-parse`, `git status`, `git log -2 --oneline`).
2. Read both Phase 50 reports (`docs/PHASE_50_FINAL_REPORT.md`, `docs/PHASE_50_CI_RECONCILIATION_REPORT.md`).
3. Source inspection of every BFF route, cookie/session module, server/client boundary, and security-boundary test.
4. HTTP-level reproduction against the live standalone server (`localhost:3170`) backed by the running API (`localhost:3171`) using temporary throwaway scripts in `/tmp/opencode/` (not committed).
5. Cookie manipulation tests (forged, expired, wrong secret, empty, duplicate).
6. Authorization boundary tests (valid session + random/arbitrary UUID senior IDs).
7. Route-guard verification (anonymous `/`, `/dashboard`, protected content absence).
8. CSRF assessment (cross-site POST simulation, cookie absence on anonymous state-changing requests).
9. `API_INTERNAL_URL` exposure and behavior tests (empty string, valid, malformed, browser output inspection).
10. Security-gate code review (`verify-next-image-optimizer.mjs`, `verify-docker-images.mjs`) with runtime execution.
11. All throwaway files deleted after use; repository untouched.

## 4. Security Architecture Reviewed

- Browser -> same-origin Next.js server (port 3170) -> `API_INTERNAL_URL` (port 3171, server-to-server).
- `ecc_at` (access token, HttpOnly), `ecc_rt` (refresh token, HttpOnly), `ecc_senior` (client-readable preference, not authorization).
- Every protected route verified by server-side `readIdentity()` against `/api/v1/auth/me` (`GET /api/auth/session`). Cookie presence alone is never treated as authentication.
- Fixed upstream paths only; no arbitrary proxy.
- `SameSite=lax`; `Secure` enabled in production (`NODE_ENV=production`).

## 5. Authentication Findings

**No Critical/High/Medium defects found.**

Reproduced behaviors:
- Unauthenticated `GET /` -> `307` to `/login` (`Location: /login`), body 4169 bytes, no protected markup.
- Unauthenticated `GET /dashboard` -> `307` to `/login`, body 5526 bytes, no `shell_shell__` CSS marker, no `ecc_at` cookie.
- `POST /api/auth/login` with bad credentials -> `401`, `Set-Cookie` absent.
- `POST /api/auth/login` with valid credentials -> `200`, body contains `user` object only (no JWT), `Set-Cookie: ecc_at=...; HttpOnly; Secure; SameSite=lax`, `ecc_rt=...; HttpOnly; Secure; SameSite=lax`.
- `GET /api/auth/session` with no cookie -> `200` (`authenticated: false`).
- `GET /api/auth/session` with forged cookie (`a.b.c`) -> `401` (`authenticated: false`, `error: unauthenticated`).
- `GET /api/auth/session` with valid cookie -> `200` (`authenticated: true`, user identity, no token in body).
- `POST /api/auth/logout` with valid cookie -> `200`, cookies cleared (`Max-Age=0`), session invalidated.
- After logout, `GET /api/auth/session` with old cookie -> `200` (`authenticated: false`).

No authentication bypass, no false success after failure, no silent downgrade of 5xx to unauthenticated.

## 6. Cookie / Token Findings

- `ecc_at`: `HttpOnly`, `Secure` (production), `SameSite=lax`, `Path=/`, `Max-Age=900`.
- `ecc_rt`: same flags, `Max-Age=2592000`.
- `ecc_senior`: intentionally NOT `HttpOnly` (`SameSite=lax`, `Secure`, `Path=/`, `Max-Age=2592000`).
- No authentication token appears in HTML, JSON response bodies, RSC payloads, error messages, or cookie values exposed to browser JS.
- Logout clears all three cookies even if upstream revocation fails.

## 7. CSRF Findings

- `POST /api/auth/login`: state-changing but does not rely on an existing session cookie; `SameSite=lax` does not prevent cross-site form submission, but the endpoint creates a new session only with correct credentials; no meaningful attacker-controlled state change without credentials.
- `POST /api/auth/logout`: state-changing; cross-site POST without cookie header (simulated) returns `200` with empty cookie clear, but does not affect an authenticated session because the cookie is absent (browser would not send it under `SameSite=lax` for a non-safe method). The server does not treat cookie absence as an error; it clears nothing, which is safe.
- `POST /api/me/senior`: state-changing (sets preference cookie); cross-site POST without cookie returns `200` and sets `ecc_senior`. The cookie has no authorization effect; the backend re-authorizes every senior-scoped request. Impact is minimal (UI preference only).
- No CSRF tokens exist; `SameSite=lax` is the primary defense. No high-impact CSRF vector demonstrated within the current feature set.

## 8. Authorization / Senior-Scoped Findings

- Every senior-scoped BFF route (`/api/seniors/:seniorId/medications`, `/appointments`, `/care-circle`) validates `seniorId` as UUID v4 shape (`looksLikeUuid`) before forwarding (`400` otherwise).
- `GET /api/seniors/<random-uuid>/medications` with valid session -> `403` (`error: forbidden`, message: "Access denied: no authorized care-circle membership for this senior.").
- `GET /api/seniors/<arbitrary-valid-uuid>/medications` with valid session -> `403`.
- `GET /api/seniors/000...` (non-authorized UUID) -> `403` (not `404` or empty list).
- `POST /api/me/senior` stores the preference cookie but does not call the upstream API; `resolveActiveSenior` validates the cookie value against `GET /me/seniors` before use; stale preferences are discarded.
- Cross-user authorization preserved: backend `AuthorizationService` remains authoritative.

## 9. BFF / SSRF Findings

- Every upstream URL is constructed by fixed `apiUrl()` with a hardcoded path (`/api/v1/auth/login`, `/api/v1/auth/me`, `/api/v1/me/seniors`, `/api/v1/seniors/${validatedUuid}/medications`, etc.).
- No request parameter (`?url=`, `?target=`, `searchParams.get('url')`) influences upstream routing.
- `apiBaseUrl()` reads `process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'`. No attacker-controlled input reaches it.
- No protocol-relative URL (`//attacker`) or URL-credential (`http://user@host`) injection possible because the base URL is a server-side constant.
- Path traversal (`../`) does not escape the host because the full upstream URL is assembled with a fixed base and a validated UUID or fixed string.

## 10. RSC / Server-Component Findings

- `?senior=<id>` is echoed in the RSC payload (`urlParts`/searchParams) as the caller's own query string. This is documented in Phase 50 reports (§11, §23 limitation 8).
- It is never treated as authorized; `resolveActiveSenior` filters it against the backend list.
- No XSS possibility demonstrated from this reflection; output is HTML-encoded by React/Next.
- No authorization bypass or information disclosure from the echo.

## 11. Cache / Isolation Findings

- `force-dynamic` is set on all BFF routes (`route.ts`) and protected page routes (`page.tsx`, layout).
- `cache: 'no-store'` on all `fetch()` calls in `api-client.ts`.
- `loadAppShell()` calls `readIdentity()` server-side; no shared cached state between users.
- No evidence of cross-user data leakage through server-rendered output or static caching: anonymous requests receive `307` redirects with no protected data; authenticated requests receive their own user/senior data only.
- `next.config.mjs` sets `images.unoptimized: true`; `.next/images-manifest.json` confirms.

## 12. API_INTERNAL_URL Findings

**P50-SEC-02 (LOW)** — `API_INTERNAL_URL=''` yields a relative URL (`''`) rather than falling back to `NEXT_PUBLIC_API_URL`, because the `??` operator only catches `null`/`undefined`, not empty strings. This is a configuration footgun documented in the reconciliation report (§4, §267). In practice:
- With `''`, `apiBaseUrl()` returns `''`; `apiUrl('/api/v1/auth/login')` returns `/api/v1/auth/login` (relative); `fetch()` without `base` throws (TypeError: absolute URL required) in Node/undici. The server would return `502` or `500` rather than making an arbitrary upstream request.
- There is no SSRF path from this behavior.
- The variable is never exposed to browser output (`NEXT_PUBLIC_` only reaches `NEXT_PUBLIC_API_URL`). No browser exposure confirmed against running server (`/`, `/login`, `/health` responses contain no internal address).
- Positive control in `verify-docker-images.mjs` asserts `API_INTERNAL_URL` is set inside the container and absent from served pages.

## 13. Route-Guard Findings

- `app/page.tsx`: `force-dynamic`, `readIdentity()` -> redirect to `/dashboard` (authenticated) or `/login` (anonymous). No landing markup produced.
- `app/(authenticated)/layout.tsx`: server-side `readIdentity()` -> `redirect('/login')` if unauthenticated; `ShellLayout` only rendered if user exists.
- `app/login/page.tsx`: server-side `readIdentity()` -> redirect to `/dashboard` if signed in; sign-in form only for anonymous.
- No protected content (`shell_shell__`, user data, senior data) leaks through HTTP body, headers, RSC payload, redirects, or error pages for anonymous callers.

## 14. Error-Handling Findings

- `401` stays `401`, `403` stays `403`, `404` stays `404`, `400` stays `400`, `429` stays `429`, `5xx` stays `5xx` or `502` (network/proxy failure).
- `500` from upstream is never converted to `401` or empty list.
- `ApiError` never leaks internal URL, token, cookie value, database details, or stack trace in user-facing messages (`defaultMessageForKind`).
- `toSafeMessage()` converts unknown errors to safe strings.

## 15. Container / Deployment Findings

- `API_INTERNAL_URL` is present in the container environment (`env` inspection) but absent from all browser-delivered HTML/headers (`/`, `/login`, `/health` tested against standalone image).
- `ecc_at` cookie is never set for anonymous callers and never exposed in HTML.
- `next.config.mjs` has `images.unoptimized: true`.
- No `.env` file, `.git` directory, or test sources present in standalone build (`.next/standalone/`).
- Security gate (`verify-docker-images.mjs`) passes and includes stricter redirect-contract assertions than before.

## 16. Security-Gate Review

**P50-SEC-03 (LOW / INFO — test-quality)** — The new layer-4 assertions in `verify-next-image-optimizer.mjs` rely on brittle DOM markers (`signin-heading`) and CSS-module class names (`shell_shell__`). These markers are stable under source changes but would break if the page or stylesheet were renamed. The failure mode is loud (test fails), not silent (test passes incorrectly), so this is a maintenance-quality issue rather than a false-negative vulnerability. The negative controls documented in the reconciliation report (§9, table) were executed by hand against throwaway build mirrors and confirm that:
- A public 200 landing page would FAIL the new contract (`location=/login` missing, `shell_shell__` present).
- A redirect to a dead page (`/nope`) would FAIL (`location=/nope` mismatched).
- Removal of the server-side guard (`(authenticated)/layout.tsx` deleted) would FAIL (`status=200`, `shell_shell__` present).

These are stronger than the previous `200` assertions. No gate false negatives that would hide a security regression were demonstrated.

## 17. Reproduced Findings

| ID | Description | Severity | Evidence |
|---|---|---|---|
| P50-SEC-01 | Anonymous `POST /api/me/senior` sets `ecc_senior` cookie without authentication. By design (UI preference only); no authorization impact. | LOW | `POST /api/me/senior` (anon) -> `200`, `Set-Cookie: ecc_senior=...`; cookie validated against backend before use; `resolveActiveSenior` discards stale values; backend `403` on unauthorized senior reads. |
| P50-SEC-02 | `API_INTERNAL_URL=''` yields relative URL (`''`) due to `??` behavior, rather than falling back. Configuration footgun only; does not lead to SSRF or exposure. | LOW | Source inspection (`api-client.ts:34`); empty-string test yields relative URL; `fetch()` throws rather than connecting to attacker host; variable not exposed to browser. |
| P50-SEC-03 | Security-gate layer-4 uses brittle DOM/CSS markers (`signin-heading`, `shell_shell__`). Failure is loud, not silent. | LOW / INFO | Source inspection of `scripts/verify-next-image-optimizer.mjs` and `scripts/verify-docker-images.mjs`; runtime execution passes; negative controls documented in reconciliation (§9). |
| P50-SEC-04 | No browser-level automation performed; evidence is HTTP-level only. No vulnerability implied, but evidence scope is noted. | INFO | Runtime verification section of `docs/PHASE_50_FINAL_REPORT.md` (§16, §23 limitation 1); this review uses only `curl`/Node `http` probes. |
| P50-SEC-05 | `?senior=<id>` appears in RSC payload (`urlParts`). Documented limitation; never treated as authorized; no XSS/injection demonstrated. | INFO | Source inspection (`seniors/page.tsx`); RSC payload reflection verified by HTML response inspection; no authorization bypass from manipulated value. |

No Critical, High, or Medium findings were reproduced.

## 18. Findings by Severity

- **Critical:** 0
- **High:** 0
- **Medium:** 0
- **Low:** 3 (P50-SEC-01, P50-SEC-02, P50-SEC-03)
- **Info:** 2 (P50-SEC-04, P50-SEC-05)

Note: P50-SEC-03 is classified as LOW/INFO; it does not represent an exploitable vulnerability but is a test-quality observation. P50-SEC-01 is a LOW design observation (anonymous cookie write) with no security impact because authorization is enforced by the backend independently of the cookie value.

Documentation correction: the severity-count table was reconciled with the five findings listed in §17 (P50-SEC-03 is counted under Low, consistent with its LOW/INFO classification). No finding classification, evidence, verdict, or implementation was changed.

## 19. Existing Controls That Were Independently Verified

- `security-boundary.test.ts`: passes; no `'use client'` module imports server-only modules (`api-client.ts`, `app/api/_session.ts`); only 3 expected client components exist; no `localStorage`/`document.cookie` usage; no hardcoded UUID; no token logging; no arbitrary upstream proxy.
- `api-client.ts`: server-only; no browser bundle exposure.
- `session.ts`: cookie flags correct; `isUsableAccessTokenShape` checks JWT shape only (not authorization); `shouldRedirectToLogin` excludes `error` state.
- `readIdentity()` / `readSession()`: re-verify cookie against `/auth/me` before reporting authentication.
- `resolveActiveSenior()` / `applyExplicitSelection()`: discard unauthorized/stale senior IDs.
- `POST /api/auth/login`: never returns access token in response body; captures upstream `Set-Cookie` for refresh.
- `POST /api/auth/logout`: clears cookies locally regardless of upstream revocation result.
- `GET /api/seniors/:seniorId/*`: validates UUID shape, requires `readAccessToken()`, forwards to fixed upstream path.
- Route guard (`(authenticated)/layout.tsx`): server-side redirect; no protected markup for anonymous.
- `force-dynamic` and `cache: 'no-store'` on protected routes and BFF endpoints.
- `next.config.mjs`: `images.unoptimized: true`; manifest confirms.
- CI gates (`verify-next-image-optimizer.mjs`, `verify-docker-images.mjs`) pass; no false-negative evidence found.

## 20. Known Limitations

- No browser-level automation (HTTP-level only). Documented in Phase 50 report (§23).
- No self-service senior onboarding UI; zero seniors shows explicit empty state.
- No silent token refresh; `ecc_at` expiration redirects to `/login`.
- RSC payload echoes caller's `?senior=` query parameter (harmless, documented).
- `POST /api/me/senior` does not validate authorization (by design: preference only); authorization enforced by backend on every senior-scoped read.

## 21. Deferred / Out-of-Scope Items

- Browser-rendered hydration behavior (not tested with automation).
- Cross-origin request scenarios that rely on browser-level cookie policies beyond `SameSite=lax` (assessed at protocol level only).
- Load-testing or denial-of-service resilience (not a security review scope).
- Mobile security review (Phase 50 scope excludes mobile).
- Remediation of P50-SEC-01/P50-SEC-02 (review only; no source edited).

## 22. Overall Security Review Verdict

**APPROVED WITH FINDINGS**

No Critical, High, or Medium security defects were reproduced within the tested Phase 50 scope. The BFF architecture preserves upstream authorization semantics, cookies are handled correctly, authentication is verified server-side before granting access, protected routes redirect unauthenticated users without leaking content, no token disclosure was observed, no arbitrary proxy or SSRF path exists, and the security gates are stricter than their previous versions. The LOW/INFO findings (anonymous preference cookie, empty-string config footgun, test-quality gate brittleness, RSC reflection, no browser automation) do not block approval but are documented for transparency.

No remediation was performed. No application source, tests, CI gates, Dockerfiles, package manifests, Prisma schema, or migrations were modified. No commits or pushes were made.

## 23. Exact Commands and Evidence

All reproduction was performed with temporary scripts in `/tmp/opencode/` (not tracked). Key commands:

- `git rev-parse HEAD` -> `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- `git rev-parse origin/main` -> `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- `git status --short` -> clean (only untracked `docs/PHASE_50_SECURITY_REVIEW.md` created at end).
- `node /tmp/opencode/security_repro.js` -> anonymous redirects (`307`), no cookies on anonymous session, `401` on bad login.
- `node /tmp/opencode/security_repro_full.js` -> cookie flags (`HttpOnly`, `Secure`, `SameSite=lax`), no JWT in body, `200` login, cookies cleared on logout, no protected content in `/` or `/dashboard`, no token in login HTML.
- `node /tmp/opencode/security_repro_cross.js` -> `403` on unauthorized senior UUID; cookie manipulation (`ecc_senior`) does not grant authorization; `401` on forged cookie.
- `node /tmp/opencode/security_repro_csrf.js` -> anonymous `POST /api/auth/logout` returns `200` without session impact; anonymous `POST /api/me/senior` sets preference cookie only.
- `node scripts/verify-next-image-optimizer.mjs` -> PASS.
- `curl -I http://localhost:3170/` -> `307 Location: /login`, no `ecc_at` cookie.
- `curl -I http://localhost:3170/dashboard` -> `307 Location: /login`, body has no `shell_shell__`.
- `curl -v http://localhost:3170/api/auth/session` (no cookie) -> `200` (`authenticated: false`).
- `curl -v -b 'ecc_at=...' http://localhost:3170/api/auth/session` (valid cookie) -> `200` (`authenticated: true`), body contains identity only, no access token value.
- `curl -v -b 'ecc_at=fake' ...` -> `401` (`authenticated: false`).
- `curl -v -b 'ecc_at=...' -X POST -H 'Content-Type: application/json' -d '{"email":"bad","password":"bad"}' http://localhost:3170/api/auth/login` -> `401`, no `Set-Cookie`.
- `curl -v -b 'ecc_at=valid' http://localhost:3170/api/seniors/111.../medications` -> `403` (`forbidden`).
- `curl -v -b 'ecc_at=valid' 'http://localhost:3170/seniors?senior=000...'` -> `200`, preference cookie set, no authorization change.
- `node /tmp/opencode/security_repro_full.js` confirms `POST /api/me/senior` (anonymous) -> `200` with `Set-Cookie: ecc_senior=...`.
- Source inspection confirms `apiBaseUrl()` uses `API_INTERNAL_URL ?? NEXT_PUBLIC_API_URL`. Empty string yields `''` rather than fallback.
- `cat /proc/<pid>/environ` shows `API_INTERNAL_URL=http://127.0.0.1:3171` (server-only, not `NEXT_PUBLIC_`); no internal URL appears in `/`, `/login`, or `/health` HTML responses.
- Security-boundary test (`pnpm --filter @ecc/web test`) passes (4 files, 62 tests).

No other tracked files changed (`git diff --name-only` = `docs/PHASE_50_SECURITY_REVIEW.md` only after creation). No commit or push performed.
