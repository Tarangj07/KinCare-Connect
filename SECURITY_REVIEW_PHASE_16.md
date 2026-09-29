# SECURITY_REVIEW_PHASE_16.md — Phase 16 Security Hardening: Independent Read-Only Audit

**Date:** 2026-09-26
**Scope:** Entire repository (backend, Prisma/DB, mobile, web, storage, authN/authZ, configuration, dependencies, Docker, logging, tests), compared against `PROJECT_PLAN.md`, `ARCHITECTURE.md`, `THREAT_MODEL.md`, `SECURITY.md`, and phase docs (12–15).
**Method:** Read-only review of every source file in `apps/api`, `apps/mobile`, `apps/web`, `packages/*`, Prisma schema + migrations, Dockerfiles, compose, env templates. Read-only verification commands were executed: `tsc --noEmit -p tsconfig.build.json`, `pnpm --filter api build`, `pnpm --filter api test`, `pnpm --filter mobile typecheck|test`, `pnpm --filter web typecheck|lint|test`, `pnpm audit --prod`, git-history checks for secret exposure. **No files were modified.**

---

## 0. Executive Summary

| Severity | Count | Summary |
|---|---|---|
| Critical | 2 | Predictable refresh tokens; silent default-secret JWT signing |
| High | 10 | Feed PRIVATE-post leak; broken refresh-reuse detection; O(n) argon2 refresh DoS; disabled-account login; guard bypass path; stale membership access; measurement deletion by OBSERVER; unbootable API; mobile auth token never delivered; critical dependency CVEs |
| Medium | 16 | Audit integrity, enumeration, CORS/CSRF/cookie drift, retention, PHI-in-audit-log, rate limiting design, storage gaps, Docker defaults, etc. |
| Low / Quality / Scope | 18+ | Stubs, dead code, claim-vs-reality drift, build/test hygiene |

**Headline:** The application **does not compile** (47 TypeScript errors, broken imports, name mismatches), so *none* of the reviewed security controls are executable as-is, and three claimed "verified" test suites fail to even load. Beyond that, there are two Critical token-security defects, several real authorization weaknesses, and the Phase 8/11/13/15 "verified" claims do not match current code. **NOT APPROVED** for checkpoint until Criticals/Highs are remediated and the build/tests are restored and re-verified.

Findings are separated into **(A) genuine vulnerabilities** and **(B) quality/process/scope findings** as requested.

---

# PART A — GENUINE VULNERABILITIES

## A1. CRITICAL — Refresh tokens and jti generated with non-CSPRNG `Math.random()`

**Location:** `apps/api/src/auth/auth.service.ts:163-168`

```ts
const jti = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const rawToken = Array.from({ length: 64 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
```

**Why Critical:** `Math.random()` is a seeded 53-bit V8 xorshift generator; its state is recoverable from a handful of outputs. The 64-hex-char refresh token ("random 256-bit secret" per `ARCHITECTURE.md` §4.6) is actually derived from ~a few dozen bits of real entropy and is predictable to an attacker who can observe any tokens (e.g., their own login + timing). The jti (`Date.now()` + `Math.random`) is also collision-prone against the `@@unique` jti column, which would throw and abort logins.

**Impact:** Full account takeover — refresh tokens are the long-lived (30-day) credential stored in an httpOnly cookie and accepted from request bodies. Prediction ⇒ silent session persistence independent of password changes (see A10: change password does not revoke anything… it *would*, but see A11: the feature isn't even exposed).

**Verification:**
```bash
grep -n "Math.random" apps/api/src/auth/auth.service.ts
```
Node test of generator bias (read-only): tokens are built from `Math.random()`, not `crypto.randomBytes` as the storage key generation at `storage.service.ts:44` correctly does.

**Fix direction:** `crypto.randomBytes(32).toString('hex')` for the token; `crypto.randomUUID()`/`randomBytes` for jti.

---

## A2. CRITICAL — JWT secret silently falls back to a repository-public value; no startup validation

**Location:**
- `apps/api/src/app.module.ts:20` — `secret: process.env['JWT_ACCESS_SECRET'] ?? 'dev-secret-change-me'`
- `apps/api/src/auth/auth.module.ts:23` — same
- `apps/api/src/auth/auth.service.ts:160` — same fallback on `sign`
- `apps/api/src/auth/guards/auth.guard.ts:27` — same fallback on `verify`

**Why Critical:** `JWT_ACCESS_SECRET` is the only thing standing between an anonymous attacker and every senior's PHI (authorization is keyed on `payload.sub`, so a forged token with any UUID grants that user's entire care-circle access). If the variable is missing/typo'd in any deployment, the app boots happily and signs/verifies with `'dev-secret-change-me'`, a string published in this repository. There is no fail-fast check anywhere (see also `prisma.service.ts` comment: "inject a `DATABASE_URL` validator at startup (Phase 3+)" — never done). `.env` currently ships the placeholder `replace-me-with-a-64-character-random-string-aaaa…` (fine for local, but nothing prevents it reaching a deploy).

Additionally, `verifyAsync` does not pin `algorithms: ['HS256']` (low-probability algorithm-confusion hardening gap).

**Verification:**
```bash
grep -rn "dev-secret-change-me" apps/api/src
```
Boot the API with `JWT_ACCESS_SECRET` unset and confirm tokens verify with the public secret (only possible once A-C1 build is fixed — itself evidence the check is absent at compile/boot time).

**Fix direction:** throw at bootstrap unless `JWT_ACCESS_SECRET` is set and ≥32 chars and not a known placeholder; pin HS256; move to ConfigService with validation (Phase 16 planned scope).

---

## A3. HIGH — Care-circle membership `endsAt` is never enforced → stale/expired members retain full PHI access

**Location:** `apps/api/src/auth/authorization.service.ts:9-54` (both `canAccessSenior` and `getMemberRole` filter only `status: 'ACTIVE', deletedAt: null`) vs. `schema.prisma:484` (`endsAt` "When the relationship ends. Null = currently active") and `docs/DATABASE.md`/`PROJECT_PLAN.md` §3.2 which present membership as the authoritative ACL.

**Impact:** A caregiver whose engagement ends (`endsAt` in the past, status left `ACTIVE`) — or any membership that ends without an explicit status flip — keeps read/write access to medications, appointments, documents metadata, feed, conversations list, measurements, and emergency alerts for that senior, forever. Also `CareCircleMember` rows with a `seniorId` instead of `userId` return `userId: null` and are silently skipped as `findFirst` selects any first row; recipient loops (`emergency.service.ts:84-86`) guard `if (m.userId)` but the membership query itself is unordered/`findFirst` (see A9).

**Verification:** code inspection; a membership with `status=ACTIVE, endsAt=<past>, userId=<attacker>` passes `assertCanAccessSenior`.

---

## A4. HIGH — Feed: `PRIVATE` (and `ORGANIZATION`) visibility posts are returned to every circle member including OBSERVERs

**Location:**
- `apps/api/src/modules/feed/services/feed.service.ts:46-55` — `where = { seniorId, deletedAt: null }`; visibility is applied **only if the client asks for it**
- `feed.service.ts:57-65` — `findOne` returns any post with no visibility filter at all

`PostVisibility` includes `PRIVATE` (`schema.prisma:111-115`), and `docs`/`PROJECT_PLAN.md` Phase 10 claim "permission-aware access". In reality `GET /api/v1/seniors/:id/feed` dumps private posts (which may contain health details, e.g. "Mom's hospice conversation — private") to all circle members. A user can also *write* `visibility:'PRIVATE'` believing it is enforced (`CreateFamilyUpdateDto` accepts it, `feed.service.ts:26`).

**Impact:** PHI/privacy leak across roles and to observers; broken data-sharing promise (HIPAA-adjacent).

**Verification:** create an update with `visibility:'PRIVATE'` as a FAMILY_MEMBER, list feed as an OBSERVER of the same circle → visible. (Blocked today only by the broken build; see B1.)

---

## A5. HIGH — Refresh-token reuse detection is non-functional (references a field that does not exist)

**Location:** `apps/api/src/auth/auth.service.ts:110-118`

```ts
const newer = family.some((t) => t.id !== found.id && t.updatedAt > found.updatedAt);
```

The `RefreshToken` model has **no `updatedAt` field** (`schema.prisma:266-294`) — confirmed by compile errors TS2339 at lines 111 and the `createdAt` ordering at line 125 (TS2353). Against a real Prisma client, `t.updatedAt` is `undefined`; `undefined > undefined` is `false`, so `newer` is always false and the family-wide revocation branch is dead. A stolen-and-rotated refresh token can be replayed indefinitely: the "reuse → revoke family" control documented in `PROJECT_PLAN.md` Phase 3 / `ARCHITECTURE.md` §4.6 does not exist at runtime. (Line 125 additionally performs a re-query by `tokenHash` that will never match a *newly* created row's ordering field — rotation-chain bookkeeping is broken too.)

**Verification:**
```bash
cd apps/api && npx tsc -p tsconfig.build.json --noEmit | grep updatedAt   # TS2339 x2
grep -n "updatedAt" prisma/schema.prisma | grep -A2 -B2 refresh   # absent in RefreshToken
```

**Fix direction:** add `updatedAt` (or compare `issuedAt`/use monotonic rotation chain via `replacedById`) and test with a real DB, not mocks.

---

## A6. HIGH — Refresh/logout perform full-table scans of argon2-verified tokens (CPU-DoS amplification)

**Location:** `apps/api/src/auth/auth.service.ts:97-104` (refresh) and `:130-140` (logout)

```ts
const rows = await this.prisma.refreshToken.findMany({ where: { revokedAt: null, expiresAt: { gt: now } } });
for (const r of rows) { if (await this.verifyHash(r.tokenHash, tokenString)) {...} }
```

Every `/auth/refresh` and `/auth/logout` call runs **Argon2id (m=65,536, t=3, p=1 ≈ ~100 ms CPU) once per active unexpired token in the entire system**. With N active sessions, one refresh costs ~N×100 ms of server CPU. The endpoint is `@Public()` with only a 10-per-15-min per-IP guard, and the attacker controls nothing — just time: a few authenticated-but-idle accounts accumulate into a login-rate-triggered cluster paralysis; conversely an attacker with any valid token can re-trigger rotation cheaply while legitimate rotation load scales with total user base. The root cause: the refresh token is an opaque string with no embedded key ID (`jti` is stored but never encoded in the token, `generateRefreshToken` returns `rawToken` only), so O(1) lookup is impossible.

**Fix direction:** embed `jti` in the token (e.g., `jti.secret` format or signed JWT), store SHA-256 with fast compare, keep Argon2 only where needed — or verify with a cheap hash given 256-bit entropy.

---

## A7. HIGH — Login ignores `isActive`/`deletedAt`; account lockout is dead code; failed logins un-audited

**Location:** `apps/api/src/auth/auth.service.ts:58-70`

- `login` fetches the user with `findUnique({ where: { email } })` and **never checks `isActive` or `deletedAt`** — deactivated or soft-deleted accounts continue to authenticate and receive fresh 15-min access tokens and refresh tokens (revocation exists only in `refresh()` at line 107, i.e. *after* an active user's access token expires).
- Lines 65-70 check `user.failedLoginCount >= 10 && user.lockedUntil > now`, but **nothing in the codebase ever increments `failedLoginCount` or sets `lockedUntil`** (verified by exhaustive grep — only these two reads). The brute-force lockout promised by the schema comment ("Lockout bookkeeping for brute-force protection") is unreachable.
- Failed-password attempts are not logged to `AuditLog` (only success and locked events), so credential-stuffing is invisible to the "security event" controls claimed in Phase 3 / SECURITY.md.

**Verification:**
```bash
grep -rn "failedLoginCount\|lockedUntil" apps/api/src   # reads only, no writes
```

---

## A8. HIGH — `JwtAuthGuard` returns `true` (bypass) when no Bearer token is present but any `refresh` cookie exists, without setting `req.user`

**Location:** `apps/api/src/auth/guards/auth.guard.ts:15-23`

```ts
} else if (req.cookies?.refresh) {
  // Refresh endpoint handles cookie refresh; return true
  return true;
}
```

Any request carrying a `refresh` cookie (an attacker-supplied value from any prior interaction, or a victim's cookie replayed by a browser) **passes the authentication guard with `req.user === undefined`**. Today the damage is blunted only because every business controller re-reads `user?.sub` and throws 403; but:

- `RolesGuard` (`roles.guard.ts:19`) defaults `userRole` to `'USER'` when `user` is undefined, so all `@Roles('USER', 'SUPER_ADMIN')` routes (medications, appointments, emergency at class level) pass RBAC unauthenticated — the second layer of the claimed "defense in depth" (§3.4) silently degrades to the controller's manual sub-check. Any future route that trusts `CurrentUser` without a `sub` guard is fully exposed.
- The `/auth/me` POST twin (`auth.controller.ts:68-72`) is `@Public()` **and** unguarded, returning an empty-user object with `globalRole:'USER'` for anonymous callers, which mobile `useAuth`/`isAuthenticated` paths consume as truthy-shaped data.

**Fix direction:** remove the cookie branch entirely (the refresh endpoint has its own `@Public` controller and does not need the guard), and enforce authentication globally via `APP_GUARD` (see B12).

---

## A9. HIGH — Health measurement archive: any circle member (including OBSERVER) can soft-delete PHI

**Location:** `apps/api/src/modules/health/measurement.controller.ts:68-77` → `apps/api/src/modules/health/services/measurement.service.ts:82-102` — only `assertCanAccessSenior`, **no role check**, while every comparable destructive op (medication archive → FAMILY_ADMIN; document archive → FAMILY_ADMIN/DOCTOR; appointment cancel → FAMILY_ADMIN/DOCTOR; emergency resolve/cancel → restricted list) enforces roles. An OBSERVER — read-only in feed (`feed.service.ts:18` excludes OBSERVER), excluded from emergency creation (`emergency.service.ts:44`) — can permanently archive the senior's blood-pressure/glucose history. Likewise `measurement.service.ts:16-21` explicitly allows OBSERVER to *write* new measurements, contradicting the role model in `PROJECT_PLAN.md` Phase 4.

`create`/`update` elsewhere correctly bind resource→senior via compound `where`; measurements follow that pattern (no cross-circle IDOR found for appointments/medications/documents/emergency/messages — `seniorId` is bound in every read/update, and notification read is `userId`-scoped).

---

## A10. MEDIUM — Logout / password change do not invalidate issued access tokens; changePassword endpoint missing

**Location:** `auth.service.ts:130-157`; no controller references `changePassword` or `revokeAllRefreshTokens` (verified: zero call sites).

Access JWTs (15 min) survive logout and password change; no denylist exists. And because the two service methods are unexposed, users *cannot* change their own password or revoke sessions — a security *capability* gap for a PHI platform (also a phase-scope gap vs. Phase 3 "Logout… token/session handling" claims). Logout also only revokes the single token matched from the cookie; mobile (no cookie jar) can never log the refresh token out server-side.

---

## A11. MEDIUM — PHI and identity data written into audit-log metadata and exposed via grant listing

- `document.service.ts:182` audit metadata stores document `title` (clinical titles = PHI) violating the schema's own rule (`schema.prisma:1264` "Do not place PHI or secrets here").
- `document.service.ts:349-358` `listGrants` requires only senior access (any role incl. OBSERVER) and returns `user: { fullName, email }` of every grantee — a contact/PII enumeration surface disproportionate to the read.
- `feed.service.ts:53/61` and `messaging.service.ts:153/161` include author/grantee **email** in feed/message payloads — email is not needed for these UIs (least-privilege/data-minimization failure for a HIPAA-flavored system per THREAT_MODEL.md).

---

## A12. MEDIUM — Notifications persist (with senior context) after circle removal; notification payloads are never re-authorized

**Location:** `notification.service.ts:20-31`; recipients materialized at `emergency.service.ts:98-106`.

`findForUser` filters only on `userId`. When a user is removed from a care circle, their `emergency.alert.created` rows (with `seniorId`, type, severity) remain queryable indefinitely; there is no membership re-check on the read path. Combined with A15 (retention), deleted/archived seniors keep leaking via stored notification JSON.

---

## A13. MEDIUM — Rate limiting is per-process, in-memory, IP-only, and proxy-hostile

**Location:** `rate-limit.guard.ts` (whole file); `main.ts` (no `app.set('trust proxy', …)`).

Map-based store: resets on restart, not shared across replicas (horizontal scaling ⇒ ×N effective budget), keyed on `req.ip` only — behind any reverse proxy (the documented Docker deployment path) *every* client shares one bucket (mass lockout) or the limit is trivially evaded by rotating upstream peers if `trust proxy` is later enabled naively. No per-account limit for `login`/`register` (credential stuffing per account is unthrottled beyond global IP). Returns 403 with no `Retry-After` instead of 429. The window also *slides* (line 24) so sustained attempts lock an IP out indefinitely. Redis (docker-compose provisioned, `ARCHITECTURE.md` §"rate-limit counters") is unused. Registration has no distinct stricter limit than login (both 10/15m — too loose for both, no 429 semantics).

---

## A14. MEDIUM — Password policy is self-contradicting and weak; enumeration differences

**Location:** `auth.dto.ts:13-16`: the alternation permits 8-char passwords missing *any* of the three classes (e.g., only letters+digits, or only uppercase+special), with no maximum length (argon2 is DoS-tolerant but 10 MB passwords pass through `verify`), no breach-list check, and `register` discloses `403 'Email already registered'` (enumeration oracle) while login returns a different 401/403 shape than locked accounts (`auth.service.ts:69` — 403 "Account temporarily locked" also enables targeted account-state probing; rate-limited only by A13's weak guard).

---

## A15. MEDIUM — Data-retention gaps: archived documents/files never purged; soft-delete leaks via list; BigInt list serialization 500s

- `archiveDocument` (`document.service.ts:252-276`) sets `deletedAt` but the binary remains in `uploads/` forever with no hard-delete/purge path (schema comment: "hard delete requires an explicit admin action" — none exists). PHI retention beyond purpose (GDPR/HIPAA-style minimization).
- `listDocuments` (`:188-205`) selects `deletedAt: true` but Prisma `where` already excludes it — fine; however `getDocument` returns the raw row including `contentHash`/`storageKey` (`:212-217`), internal storage identifiers exposed to clients (minor, but aids targeted probing of `storageKey` uniqueness).
- `listDocuments`/`getDocument` return `sizeBytes` as a Prisma `BigInt` → `JSON.stringify` throws → both endpoints 500 at runtime (verified type: `schema.prisma:932`). Not a vulnerability per se, but means document *access auditing* paths error out; `downloadDocument` correctly converts, `getDocument` does not.

---

## A16. MEDIUM — Mobile: tokens are never delivered, and default transport is plaintext HTTP

**Locations:** `auth.controller.ts:28-41` (login returns only `{ user }` — `result.access` is computed but omitted from the response); `apps/mobile/src/services/auth.ts:53-55` (stores `data.access` — always `undefined`); `apps/mobile/src/lib/api-base.ts:7-8` and `apps/mobile/app.json` (`"apiBaseUrl": "http://localhost:3000"` baked as default).

Net effect: mobile logins "succeed" but no access token exists; every subsequent authenticated call 401s (then `api.ts:35-38` clears the non-existent session). The refresh path (`auth.ts:60-71`) POSTs without cookie or body → always 401 → null. So Phase 14's claim of a working SecureStore token flow (`PROJECT_PLAN.md`: "Secure token storage… verified") is **not true of the shipped code** — SecureStore writes/reads exist but the token never arrives. Security consequence: no bearer token is ever stored (good accident), but the app cannot enforce session expiry at all once any workaround lands; and `API_BASE_URL` defaulting to `http://` means a production build that forgets to override `extra.apiBaseUrl` would transmit credentials + PHI + 15-min JWTs over cleartext with no TLS enforcement anywhere (React Native Android permits cleartext by default).

**Verification:** `pnpm --filter mobile test` runs *no tests* (script is `echo … && exit 0`) — see B10.

---

## A17. MEDIUM — Web refresh-cookie design conflicts with documented web origin; CSRF posture undocumented

**Locations:** `auth.controller.ts:33-39`: cookie `sameSite:'strict'`, `path:'/api/v1/auth/refresh'`, `secure` only when `NODE_ENV=production`. `PROJECT_PLAN.md`/`ARCHITECTURE.md` describe the web app on a different origin (`localhost:3001` → API `:3000`, and cross-domain in production). Different *registrable domains* in production ⇒ SameSite=Strict cookie never sent to `/auth/refresh` ⇒ silent session death; same-site-but-different-origin (subdomain) is fine but **no CORS is configured at all** (see A18) so the browser blocks the cross-origin fetch, making the entire cookie flow untestable against the real web app. Conversely, if someone later loosens CORS without revisiting cookies, `SameSite=Strict` is the *only* CSRF defense on `/auth/logout` (state-changing POST relying on guard+cookie) — that reliance is nowhere documented in SECURITY.md.

---

## A18. MEDIUM — CORS never configured despite `WEB_ALLOWED_ORIGINS` env and docs

**Locations:** `main.ts` (no `app.enableCors`); `.env:50-53` documents a control that is not implemented (grep: `WEB_ALLOWED_ORIGINS` referenced nowhere in code). Today this "fails closed" (browsers block cross-origin reads), so it is not directly exploitable, but it means: (a) the documented web-app session model cannot function, (b) an implementer following the env file may later reflect `Origin` naively, (c) audit findings in Phase 13/14 that assumed configured CORS are moot. Also `helmet` is mounted with **defaults only** — no explicit CSP/HSTS tuning per ARCHITECTURE §"Tightening lands in Phase 16" — acceptable for a JSON API, but the web app (`apps/web`, `next.config.mjs`) ships **no CSP at all**, and it is the user-facing HTML surface.

---

## A19. MEDIUM — Docker/deployment defaults are unsafe if reused outside local dev

**Locations:** `docker-compose.yml:21,53-54,75`: fallback secrets `change-me-in-real-use`/`minioadmin` baked in; Postgres/Redis/MinIO + console (9001) published on **all interfaces** with no `127.0.0.1:` binding; Redis has no `requirepass`; MinIO bucket is created but `mc anonymous set none` protects only the default bucket. `apps/api/Dockerfile`: `pnpm install --frozen-lockfile=false` (non-reproducible, supply-chain drift), no `USER` (runs as root), no HEALTHCHECK; `COPY ... 2>/dev/null || true` masks failures. `apps/web/Dockerfile` same root/frozen-lockfile issues. No API Dockerfile exists for a production network policy. These match the "development infrastructure" self-description, but there is no separate production compose file, so the *only* deployment artifact has dev defaults.

**Verified NOT an issue:** `.env` is not committed and has zero history (`git log --all -- .env` empty; `.gitignore` covers it); `.dockerignore` excludes `.env`; no real secrets exist anywhere in tracked files (only placeholders).

---

## A20. MEDIUM — Dependency risk: 76 advisories incl. 2–3 Critical in the web runtime

**Verification:** `pnpm audit --prod` (2026-09-26):

```
76 vulnerabilities — 5 low | 28 moderate | 40 high | 3 critical
critical: next  >=10.0.0 <15.5.24  "Unauthenticated Remote Code Execution in Image Optimization API" (web app pinned 14.2.35)
critical: next  windows-hosted RCE variant
critical: tar   <=7.5.18  decompression DoS (build tooling)
high: next DoS/SSRF/middleware-bypass (several), multer DoS ×5 (transitive via platform-express; multipart is unused but still loaded), postcss, image-size, @xmldom/xmldom, turbo-stream
```

The web `Dockerfile` runs `next start` on the RCE-affected 14.x line, and Next's image optimizer is exposed by default. The API pulls vulnerable `multer`/`body-parser` transitively (unused endpoints, but present in the process). No lockfile pinning gate (`--frozen-lockfile=false`), no Dependabot/Renovate, no CI to fail on criticals (no `.github/` exists). **Fix direction:** upgrade Next (15.5.24+), prune/override multer via resolutions, add audit gate to CI as part of Phase 16 scope.

---

## A21. MEDIUM — Audit-log integrity guarantees documented but absent; context fields never populated

**Locations:** `schema.prisma:1244-1246` ("application role has no UPDATE/DELETE… enforced in the database grant script in Phase 16") — **no grant script exists** (migrations contain zero GRANT/REVOKE statements; the API connects as table owner `ecc` anyway), so `audit_logs` is trivially UPDATE/DELETE-able by the app's own DB role; the only append-only claim in the whole stack is unenforced. Additionally every `auditLog.create` omits the available `requestId`/`ipAddress`/`userAgent` columns (0 of N call sites populate them — verified by grep), so audit records cannot be correlated to requests or sessions despite `request-id.middleware.ts` generating ids and the schema reserving the columns. Auth events (`auth.login`) carry no IP — a stolen-credential investigation would have no source data.

---

## A22. LOW/MEDIUM — Messaging: participant addition is un-gated by role; notifications self-addressed; odd date predicate

- `messaging.controller.ts:101-113` + `messaging.service.ts:49-83`: **any** participant can add **any** active circle member (including OBSERVER or a different household's FAMILY_MEMBER) into what may be a private family conversation — only circle membership is checked. No admin/consent policy exists; conversation privacy promised in Phase 11 ("two independent boundaries") is weaker in the *write* direction than the *read* direction.
- `messaging.service.ts:132-140`: the new-message notification is created with `userId` = the **sender** — recipients are never notified (functional bug in the notification boundary; also proves the "notification generation boundary" was never integration-tested against a DB).
- `messaging.service.ts:17`: `createdAt: { gt: '1970-01-01' }` string-in-date-filter hack (works, but silently relies on coercion; participants created "now" always pass — meaningless, remove).
- `markRead`/`getConversation` correctly bind `conversationId+seniorId+participant` — no cross-conversation IDOR found. Good.

---

## A23. LOW — Misc authentic weaknesses

1. **`GET /auth/me` returns JWT-derived stub when `user` missing** (`auth.controller.ts:74-78`): with A8's bypass a cookie-only request reaches this guarded route? No — `JwtAuthGuard` verifies first; but when it passes via the cookie branch, `getMe` returns `{id:'', globalRole:'USER'}` with HTTP 200, which `useAuth.tsx:39-46` treats as a real user. Unauthenticated 200 "me" is an auth-semantics bug.
2. **Email-never-required:** `emailVerified:false` users log in freely (`auth.service.ts:58-95`); the registration message ("Email verification pending") documents a control that doesn't gate anything.
3. **`x-request-id` log injection:** inbound header ≤200 arbitrary chars is logged (`global-exception.filter.ts:49-51`) and echoed to the client (header + `error.requestId`) — attacker-controlled content in logs/response.
4. **Unbounded lists:** `findAlerts` (`emergency.service.ts:111-117`), `findBySenior` (medication/appointment/feed/measurements), `listDocuments`, `listGrants` have no pagination — cheap amplification for large circles; `notification.controller.ts:46` loads *all* of a user's notifications to serve one by id.
5. **JWT claims carry email** (`auth.service.ts:160`) — unnecessary PII in every bearer token / any downstream log that captures tokens.
6. **Refresh accepts token from request body** (`auth.controller.ts:50-51`) — body-supplied long-lived credentials land in server request logs/middleware far more often than cookies; documented "mobile SDK compatibility" but mobile never sends it (A16).
7. **`grantAccess` accepts past `expiresAt`** (`document.service.ts:321`) — grants instantly-dead records, noise in the ACL (minor).
8. **`register` race:** find-then-create on `email` without catching P2002 → 500 + possible double-audit under concurrent signup (schema unique does protect integrity).
9. **`documents.controller.ts:44`** decodes `fileContent` to `fileBuffer` and discards it (double memory cost of the 20 MB base64 path).
10. **Body-size ceiling drift:** DTO allows 20 MB base64 (`upload-document.dto.ts:14`), service allows 10 MB decoded, but Express's default JSON body limit (100 kB) silently rejects any real upload — when someone raises it to match the DTO, the pre-decode guard at `document.service.ts:35` correctly rejects >~10 MB *before* decode (good), but the 20 MB string is still fully buffered first (memory DoS ×20 concurrent ≈ 400 MB).

---

# PART B — QUALITY / PROCESS / SCOPE FINDINGS (not directly exploitable)

## B1. CRITICAL process blocker — The API does not build or boot (47 TS errors)

**Verification:** `pnpm --filter api build` → **exit 1, 47 errors**; `pnpm --filter api test` → **3 of 7 suites fail to even load**. Root causes (all current tree):

| Error | Location |
|---|---|
| `Cannot find module './modules/medications/medication.module'` | `app.module.ts:10` — **file does not exist** (`ls` confirms: only controller + dto + services) → `AppModule` unresolvable → entire app cannot start |
| `Cannot find module '../auth/auth.module'` / `'../database/prisma.module'` | 7 files in `modules/*/*.module.ts` and services use **one-level-too-shallow relative imports** (`../` should be `../../`) — appointments, documents, emergency, feed, health, messaging, notifications |
| `'MeasurementService'` does not exist (named `HealthMeasurementService`) | `health.module.ts:4`, `measurement.controller.ts:11` |
| `CreateFeedUpdateDto` not exported (export is `CreateFamilyUpdateDto`) | `feed.controller.ts:10` |
| `markAsUnread` not on service | `notification.controller.ts:67` |
| `RefreshToken.updatedAt/createdAt` missing | `auth.service.ts:111,125` (= A5) |
| `channel: string` not assignable to enum | `notification.service.ts:26` |
| `data.isTelehealth === true` impossible comparison | `appointment.service.ts:27` |
| `'CARETAKER'` is not a `CircleRole` | `care-task.service.ts:16,74,108,132` (= B4) |

Every security control reviewed in Part A is therefore currently **inert** (uncompilable/unstartable). The PROJECT_PLAN claims "TypeScript compilation" and phase checkpoints passed; they cannot have run on this tree. This is the single most important Phase-16 finding: fix the build, wire it into CI (B11), then re-run all security tests against a real database.

## B2. Care tasks: Phase 7 "COMPLETE" is fiction. `CareTaskController` endpoints return canned `"architecture ready"` JSON objects (never touch `CareTaskService`); the service is instantiated nowhere (dead code), uses the nonexistent `CARETAKER` role, and `create` echoes the client body back. `PROJECT_PLAN.md` Phase 7 claims task creation/assignment/lifecycle "implemented".

## B3. Medication doses/schedules: `DoseRecordingService`, `DoseGenerationService`, `MedicationScheduleService` are referenced by **no controller and no module provider** (verified by grep) — Phase 5 "dose recording/schedule management implemented" is only half-true (services exist, no surface). Their authorization is mostly correct (`recordTaken` binds `dose.seniorId !== seniorId` check at `dose-recording.service.ts:21`; `schedule.service.ts` binds via `medication.seniorId`) **except** `recordSkipped` (`:38-47`) and `recordSnoozed` (`:56-66`) verify `findUnique` then update **without re-checking `dose.seniorId === seniorId`** — if the module is wired as-is, a circle member of senior A could skip/snooze senior B's doses by guessing dose ids (latent IDOR; currently unreachable).

## B4. Phase 8 claims: no BullMQ, no `@nestjs/bullmq`, no socket.io in `apps/api/package.json` (grep verified); Redis exists only in docker-compose; "Queue-oriented architecture using BullMQ/Redis" and `ARCHITECTURE.md` §4.11 Socket.IO sections describe unbuilt systems. `NotificationService` writes rows synchronously; preferences endpoints are stubs. Should be marked planned, not complete.

## B5. Auth-surface scope gaps vs. Phase 3/4 claims: no endpoints for `changePassword`/`revokeAllRefreshTokens` (A10); forgot/reset/verify-email are message-returning stubs (`auth.controller.ts:80-99`) — fine as documented stubs, but nothing prevents them from shipping to production silently (no 501). No user/profile update endpoint exists (users can never edit `fullName` etc.). No admin surface despite `SUPER_ADMIN` role and `@Roles('USER','SUPER_ADMIN')` gating everything (the marker is effectively inert).

## B6. `@Public()` / `PUBLIC_KEY` decorator is read nowhere (no global guard consumes it) — decorative security vocabulary (see B12 for the inverse problem).

## B7. Test-coverage integrity: `pnpm --filter api test` currently: 37 passed but the auth controller, documents controller, and messaging controller security suites **fail to load** (B1). All existing specs exercise mocked Prisma — none of the reuse-detection (A5), conditional-update state machine (Phase 13 claim), or Argon2 refresh lookup (A6) behavior is validated against a real DB, which is precisely why these defects survived three "security review" rounds. `vitest.config.e2e.ts` targets `test/**/*.e2e-spec.ts` — directory does not exist; zero e2e coverage.

## B8. Mobile: `pnpm --filter mobile test` executes `echo "(mobile vitest pipeline lands in Phase 14…)" && exit 0` — **the "mobile tests" checkpointed in Phase 14 never run**; `pnpm --filter mobile typecheck` fails (tsconfig includes `*.spec.ts` with `vi` namespace/module errors). The spec files exist (`src/app/*/integration.spec.ts`, `src/navigation/security.spec.ts`, etc.) but are unrunnable in CI-terms. Mobile `session.ts` stores tokens without `SecureStore` availability checks (`isAvailableAsync`) — minor.

## B9. Seed: placeholder argon2 string `'$argon2id$…$SEED$PLACEHOLDER'` (`seed.ts:135`) — `argon2.verify` on it *throws* (invalid hash) → seeded users login → unhandled 500 path instead of a clean rejection (also, an unauth'd attacker can probe which emails exist via error-type differences if the filter's 500 message differs — currently it maps to generic 500, so only DoS-ish noise). Deterministic demo senior id `000…001` is hardcoded in 3 mobile screens (documented limitation, but the *documented* limitation understates it: emergency list/detail and documents screens all pin it, so a real multi-senior user cannot use the app at all).

## B10. Web: dashboards are static (consistent with Phase 15 claim — fine), but `DASHBOARD_CARDS` link to `/dashboard/emergency|medications|documents|appointments` routes that **do not exist** → 404s; `/dashboard/admin` renders role text only. No leak found (`PROJECT_PLAN` claim holds). `next.config.mjs` disables ESLint during builds (`eslint.ignoreDuringBuilds: true`) — gate erosion; no CSP (A18). `API_BASE_URL` default `http://localhost:3000` baked.

## B11. No CI/CD at all (no `.github/`, no pipeline files). All "verified" gates (lint/typecheck/test/build) are manual and — as demonstrated by B1 — not currently green. Recommend the Phase 16/19 boundary include a CI that runs the full `pnpm build lint typecheck test` matrix + `pnpm audit --audit-level=high` + secret scanning (`gitleaks`) so this state cannot recur.

## B12. Architecture drift worth logging: no global `APP_GUARD` for `JwtAuthGuard` (authentication is opt-in per controller — the `@Public` vocabulary implies an opt-out model that doesn't exist; a new controller that forgets `@UseGuards` is silently unauthenticated, satisfying neither posture). `ARCHITECTURE.md` §4.6 describes JWT claims `roles`/`csc` (circle-membership array) that aren't used — current server-side re-derivation is *safer*; docs should be corrected. `ARCHITECTURE.md` §4.10's S3/MinIO `PresignService` is unimplemented; `StorageService` is local-FS only and the S3_* envs are unused (PHI at rest: filesystem, unencrypted). `@nestjs/jwt` `^12` with `@nestjs/*` `^10` — mismatched major lineage in `package.json`.

---

# C. Items checked and found SOUND (so they don't need re-auditing)

- No SQL injection surface: 100% Prisma; single `$queryRaw` is `SELECT 1` health check (`health.controller.ts:33`).
- No cross-circle IDOR in appointments/medications/documents/emergency/measurements/messages: every find/update binds `seniorId` compound + JWT-derived sub; actor id never accepted from bodies (`@Roles` on bodies absent; `whitelist+forbidNonWhitelisted` validation pipe active, `forbidNonWhitelisted: true` blocks mass-assignment of e.g. `globalRole` at register).
- Registration cannot self-assign privileged roles (globalRole hardcoded `'USER'`, DTO has no such field).
- Refresh rotation *storage* model is sound (hash-at-rest, family chain, revoke-on-family); only the detection logic (A5) and lookup cost (A6) are broken.
- Cookie flags are correct in intent (httpOnly, path-scoped to refresh, Secure in prod, SameSite=Strict).
- Emergency state machine: transitions guarded by conditional `update({where:{id, seniorId, status}})` — valid on Prisma ≥4.7 GA `extendedWhereUnique`; terminal states protected; audit in same transaction; notification payload contains ids/severity only, no free-text message (isolation claim holds); resolve/cancel field separation correct.
- Documents: magic-byte + allow-listed content types + pre/post-decode size guards + path-containment `resolveContainment` (absolute/traversal rejected, baseDir prefix check) + randomized storage keys (CSPRNG) + filename regex rejecting `..`/separators + grant existence/UUID/circle checks + P2002 handling. `verifyDocumentAccess` is fail-closed (uploader-or-grant) — stricter than list (see A4's mirror problem on the feed side; note the *inconsistency* between list-all-metadata vs get-one-requires-grant is itself a design flaw, but not an access *grant* leak of file bytes).
- Global exception filter never leaks stack traces to clients; request-id correlation present (mid-way).
- Argon2id params (`m=64MB,t=3,p=1`) meet OWASP; access-token TTL 15m; refresh persisted as Argon2 hash (see A6 re-efficiency).
- Git history: no secret ever committed (`.env` history empty; only `.env.example` with placeholders tracked).
- Prisma schema: FKs + cascades + unique constraints consistent with the authz model; `@@unique([documentId,userId])`, `@@unique([conversationId,userId])`, `@@unique([medicationId,scheduledAt])` (dose-generation race handled with try/catch) are correct.
- No XSS-capable server rendering (`text/plain` docs only; API is JSON-only; web app has zero `dangerouslySetInnerHTML`/user-rendered HTML in tracked sources).
- MinIO bootstrap sets bucket `anonymous none` (no public object read).
- Prettier/eslint configs consistent; web typecheck+lint pass.

---

# D. Remediation order (for when Phase 16 implementation is authorized)

1. **Restore the build** (B1) and stand up CI (B11) — prerequisite for every other fix to be verifiable.
2. A2 (secret fail-fast), A1 (CSPRNG), A5 (reuse detection — schema + logic), A6 (jti-indexed lookup) — token layer.
3. A8 (guard bypass) + B12 (global `APP_GUARD` honoring `@Public`) + A7 (isActive check, write lockout counters, audit failed logins).
4. A3 (endsAt enforcement), A4 (feed visibility), A9 (measurement role policy), A22 (participant-add policy) — authorization layer, each with a real-DB test.
5. A16 (deliver `access` in login response / design mobile refresh), A17/A18 (CORS + cookie story for web), A19–A20 (prod compose, Next upgrade, CI audit gate).
6. A11–A15, A21, A23, Part B documentation corrections (mark phases 7/8 partial; correct ARCHITECTURE).

---

# E. Verdict

**NOT APPROVED.**

Two Critical token-generation/secret-handling vulnerabilities, ten High findings (including an auth-bypass guard path, non-functional session-revocation detection, PHI-visibility and role-enforcement gaps, and an API that cannot compile), and a pattern of previously "verified" controls that exist only against mocks. No repository changes were made; awaiting explicit instruction before Phase 16 remediation or Phase 17 work begins.
