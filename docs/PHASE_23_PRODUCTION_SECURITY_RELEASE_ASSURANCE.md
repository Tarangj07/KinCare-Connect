# Phase 23 — Production Security & Release Assurance

**Status:** complete. Nothing committed, nothing pushed.
**Branch:** `main` · **Base commit:** `d0cd0dd` ("Complete Phase 17 testing CI and reliability")
**Standing of the working tree:** the Phase 18–22 changes were already uncommitted when this
phase began and remain uncommitted. Everything this phase added sits alongside them.

---

## 1. Scope

Phase 22 proved that the system which is *tested* is not necessarily the system which *ships*: a
Critical authentication defect reached a production image while 213 source-level tests, the
build-determinism check and a 37-check container gate were all green. The cause was that every test
suite runs TypeScript source through vitest/SWC, while the shipped artifact is produced by `tsc`,
and the two emit **different** `design:paramtypes` metadata.

Phase 23 therefore does not add features. It asks one question across twelve workstreams and
answers it with evidence:

> Is what is tested materially the same as what will run — and if not, what else is different?

Explicitly **out of scope and not done**: deployment of any kind, Kubernetes, Terraform, Helm, cloud
services, managed databases, monitoring platforms, WebSockets, push/SMS/email providers, AI/OCR,
EHR integration, GPS, payments, dashboard redesign, mobile feature work, Redis rate-limiter
migration, MinIO/S3 migration, backup infrastructure, unrelated dependency upgrades, Prisma schema
redesign, and any Phase 24 work. `PROJECT_PLAN.md`, `PROJECT_PLAN-old.md` and every
`SECURITY_REVIEW_*` artifact are unmodified.

---

## 2. Methodology

Five rules governed every change:

1. **Inspect before changing.** Every finding below was reproduced against the running system
   before any code was edited, and the reproduction is described so it can be repeated.
2. **Do not trust a reported fix.** Claims inherited from Phases 16–22 were re-proved independently
   — the HS256-pinning assertions in particular turned out to be *vacuous* (finding **P-1**).
3. **Prefer behavioural tests over source-string assertions.** Where a claim is about a deployed
   artefact, it is tested against the built artefact, in a container where that is possible.
4. **Mutation-test every new gate.** A gate that has never been shown to fail is a convention. Each
   new gate has a harness that introduces the defect it claims to detect and proves the gate rejects
   it. Three of these harnesses found bugs *in the harnesses themselves* during this phase, which is
   recorded rather than quietly fixed.
5. **Weaken nothing.** No security control was removed, relaxed, or made conditional to get a green
   result. Where a check could not be run honestly without weakening something, the check was
   restructured rather than the control relaxed — see the rate-limiter design note in §5.2.

---

## 3. Findings

Classification used throughout:

- **Pre-existing** — present at the start of Phase 23, in code that shipped before this phase.
- **Phase 23 regression** — introduced by a change made in this phase. (There is one; see **P-0**.)
- **Phase 23 fix** — fixed in this phase.
- **Deferred** — real, documented, deliberately not fixed here. See §11.

### 3.1 Critical

| ID | Finding | Class | Disposition |
|----|---------|-------|-------------|
| **C-1** | **Quadratic password regex → unauthenticated event-loop denial of service.** `RegisterDto.password` was validated with `/(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*\|…/`. Unanchored, with a `.*` inside every lookahead and a trailing `.*`. Measured in-process: 8 KB → 240 ms, 64 KB → 15 s, **256 KB → 240 s**. `POST /api/v1/auth/register` is public, so one unauthenticated request pinned the Node event loop for minutes — during which the process served nothing at all, including `/health` and `/health/ready`. An orchestrator would see an unhealthy container. | Pre-existing | **Fixed** (§5.1) |
| **C-2** | **The declared document-upload contract was unreachable.** `UploadDocumentDto` accepts 20 MB of base64 and `DocumentService` enforces a 10 MB decoded ceiling, but `body-parser`'s default limit is 100 KB. Every document larger than ~75 KB was rejected by the parser *before the DTO ran* — and because `PayloadTooLargeError` is a plain `Error`, not an `HttpException`, it surfaced as **HTTP 500**. Confirmed against the running application: a 1 MB PDF returned 500. | Pre-existing | **Fixed** (§5.1) |

### 3.2 High

| ID | Finding | Class | Disposition |
|----|---------|-------|-------------|
| **H-1** | **Client input reported as a server fault.** Three distinct request-caused failures all produced HTTP 500 with a stack in the operator log: (a) any body over the parser limit; (b) a non-UUID path segment, which Prisma rejects as `P2023 Inconsistent column data`; (c) a syntactically well-formed but semantically impossible date such as `2026-13-45T99:99:99.000Z`, which the DTO's shape-only regex accepted, turned into `new Date("Invalid Date")`, and which Prisma then raised as a client-validation error. | Pre-existing | **Fixed** (§5.1) |
| **H-2** | **Impossible calendar dates were accepted and silently changed.** `new Date('2026-02-30T10:00:00.000Z')` is 2 March in JavaScript, and `Date.parse` returns a valid number. A caller asking for 30 February got 2 March persisted. The DTOs validated the *shape* of a timestamp, never that it denoted a real instant. | Pre-existing | **Fixed** (§5.1) |
| **H-3** | **The test application did not mirror production.** `createTestApp()` omitted `RequestIdMiddleware` and the body-parser configuration, so every HTTP-level spec ran with `requestId: "unknown"` in the error envelope and with body-parser's 100 KB default while production ran with neither. A spec could assert on the error envelope and never see the production value. | Pre-existing | **Fixed** (§5.1) |
| **H-4** | **`REDIS_URL` documented but read by nothing** in `apps/api/.env.example`. An operator setting it would believe it took effect. | Pre-existing | **Fixed** (§5.1) |
| **H-5** | **Published migration command was wrong for the image.** The operator quick reference in `docs/PHASE_19_…` gave `npx prisma migrate deploy`. In the production image `prisma` is not on PATH, the inherited `node` entrypoint rewrites argv to `node prisma …`, and `/app/prisma` is the migration *directory*. The command fails with `Cannot find module '/app/prisma'`. The API Dockerfile had already documented this exact trap; the documentation had not been updated. | Pre-existing | **Fixed** (§5.1) |

### 3.3 Medium / Low

| ID | Finding | Class | Disposition |
|----|---------|-------|-------------|
| **M-1** | **Access-token lifetime is unbounded.** `JwtAuthGuard` pins the algorithm and requires a non-empty `sub`, but does not bound *how long* a token may be valid. A correctly signed token with a ten-year `exp` is accepted. Not exploitable without the signing secret — an attacker holding the secret can already mint any claim — but it is missing defence in depth and the fix is a one-line `maxAge`. | Pre-existing | **Deferred D-2** |
| **M-2** | **A deactivated or soft-deleted account keeps access for the remaining life of its access token.** The guard verifies the signature and the presence of a subject and consults nothing else. `/auth/me` is the exception: it re-reads the user and returns 401. Bounded by the 15-minute access-token lifetime. | Pre-existing | **Deferred D-1** |
| **L-1** | **`CareTaskController` compiles, carries guards, and is unreachable** — no module registers it. Five handlers of dead authorization surface. | Pre-existing | **Deferred D-3** |
| **L-2** | **`POST /seniors/:id/conversations` and `PATCH /feed/:id` declare no body DTO**, so `forbidNonWhitelisted` does not apply and a body-supplied identity field is silently ignored rather than refused. The security property holds (identity comes from the token, verified in the database); the strict-whitelist guarantee simply does not extend to those routes. | Pre-existing | **Deferred D-4** |
| **L-3** | **`multer@2.0.2` carries five high DoS advisories** as a transitive dependency of `@nestjs/platform-express`. Reachable only through a multer-backed interceptor, of which the API has none. | Pre-existing | **Deferred D-5** (verified not reachable) |
| **L-4** | **`next@14.2.35` carries two critical RCE advisories** (image optimization; Windows-hosted `next start`). Every fix is in `>= 15.5.24` — a **major** upgrade. | Pre-existing | **Deferred D-6** (verified not reachable) |

### 3.4 Phase 23 regressions and self-findings

These were introduced *by this phase* and are listed separately because they were caught by the
phase's own methods rather than inherited.

| ID | Finding | Disposition |
|----|---------|-------------|
| **P-0** | The first version of the container-gate ReDoS check was satisfiable by a build that still had the quadratic pattern, because `MAX_PASSWORD_LENGTH` short-circuits before any regex runs. The check was a false pass. | Fixed; the mutant now removes **both** barriers, and the reasoning is recorded in the harness. |
| **P-1** | The compiled-auth harness's twelve token-defect cases were **vacuous**. The suite driver set `JWT_ACCESS_SECRET` for the server process but not for the harness, so every self-signed token failed signature verification — and "fails signature verification" is indistinguishable from "correctly rejected for a bad algorithm" when both produce 401. The suite reported green on assertions it had not earned. This is the same class as the Phase 22 defect: a check that cannot distinguish success from the wrong kind of failure. | Fixed: one secret for both, plus an explicit precondition check that a token the harness signs is accepted, run *before* any signature-based assertion. |
| **P-2** | Two mutation mutants failed to compile (`if (false && …)` defeated TypeScript's narrowing; `if (true) return true` broke it in the rest of the method), so the gate was never exercised. | Fixed: the mutants now mutate the compared constant and the raised budget — the realistic regressions. |
| **P-3** | One mutation wrote a regex literal spanning four lines, which does not compile. | Fixed. |
| **P-4** | The first configuration audit flagged `dev-secret-change-me`, which is the Phase 16 *rejection list* — a value the code refuses to use. Flagging a control as a leak. | Fixed: the rejection list is recognised for what it is. |
| **P-5** | The first dependency audit failed every caret-range dependency. A caret range is the ecosystem norm and `--frozen-lockfile` makes the lockfile the pin; the check detected nothing while flagging every correctly-managed project. | Fixed: only sources outside the registry fail. |

---

## 4. What was *not* found

Stated explicitly, because "no findings" and "not looked" are different things:

- No credential is committed, baked into an image, or present in any build artifact. Verified over
  all 264 API dist files and the entire web `.next` tree.
- No `import type` on a class used as a controller parameter, anywhere. 59 class-typed parameters
  across 66 compiled source files, all value imports; 56 of them additionally checked for class
  identity in the emitted `design:paramtypes`.
- No route outside the documented public allow-list lacks `JwtAuthGuard`. 57 live routes; 8 public.
- No Prisma migration contains a `DROP TABLE`/`DROP DATABASE`/`DROP SCHEMA`, a `TRUNCATE`, or an
  unguarded `DELETE`.
- No error response leaks a database host, port or database name, SQL, a filesystem path, a stack
  frame, a password, a token or a signing secret.
- The lockfile is byte-identical to its pre-phase state. No dependency was added, removed or
  upgraded.

---

## 5. Fixes

Five production-code changes. Each is listed with why it was necessary and what would break if it
were reverted.

### 5.1 `apps/api/src/auth/password-policy.ts` (new) — fixes C-1

`RegisterDto.password` no longer uses a regular expression. The policy is a single pass with bounded
state, plus an explicit length cap. Two independent barriers:

- **Linear-time check** — the character classes are counted in one pass; no backtracking, so cost is
  linear in the input.
- **`MAX_PASSWORD_LENGTH = 1024`** — a caller cannot choose the size of the input to an Argon2 hash.

**Equivalence.** Within the length cap the policy accepts and rejects **exactly** what the old
pattern did. This is not asserted from a source read: `password-policy.spec.ts` enumerates a
4-symbol alphabet exhaustively to length 5 (1 364 inputs) plus realistic pools, and compares against
the original pattern verbatim. Zero disagreements. The single intentional difference — the length
cap — is asserted explicitly rather than left implicit.

**Why reverting breaks the product:** an unauthenticated request blocks the event loop for minutes.

### 5.2 `apps/api/src/config/body-limit.ts` (new) + `main.ts` — fixes C-2

`MAX_JSON_BODY_BYTES = 24 MB`, applied with `useBodyParser` after `bodyParser: false`. It sits
immediately above the largest payload the application *declares* it accepts (20 MB of base64 plus
envelope), so the parser and the DTO agree instead of one silently overriding the other. It remains
a hard ceiling: a larger body is refused with 413 before any allocation proportional to its size is
retained, which is what stops a large limit from becoming a DoS vector.

The constant lives in its own module because `createTestApp` must apply the *identical* limit — that
divergence was finding H-3.

**Why reverting breaks the product:** every document over ~75 KB is unusable.

### 5.3 `apps/api/src/common/filters/client-input-errors.ts` (new) + `global-exception.filter.ts` — fixes H-1

Three request-caused failures are now reported as the 4xx they are:

| Failure | Status | Code |
|---|---|---|
| body over the parser limit | 413 | `PAYLOAD_TOO_LARGE` |
| non-UUID where a `@db.Uuid` column is compared (`P2023`) | 400 | `INVALID_IDENTIFIER` |
| Prisma argument-validation error | 400 | `INVALID_VALUE` |

**Every other Prisma failure stays a 500** — a connection that cannot be made, a constraint violated
by correct input, a deadlock. An outage is never disguised as a client mistake. The classification
is a separate module so it can be unit-tested against synthetic errors without a database, and
`client-input-errors.spec.ts` asserts eight server-fault classes that must *not* be reclassified.

The returned message is always a fixed string written in that module. No text from the underlying
error is ever copied into a response, so driver messages (which carry column names, argument values
and sometimes the query) cannot leak through this path.

### 5.4 `apps/api/src/common/validation/is-iso-instant.ts` (new) — fixes H-2

`IsIsoInstant` requires the pinned `…Z` shape **and** re-checks the calendar components, because
`Date.parse` accepts and silently rolls forward a day that does not exist. The shape-only regex is
kept as the first half of the check, so a caller still cannot omit the timezone. Applied to
`CreateAppointmentDto.startsAt/endsAt`, `UpdateAppointmentDto.startsAt/endsAt` and
`CreateHealthMeasurementDto.measuredAt`.

The `from`/`to` filters on `HealthMeasurementFilterDto` were also anchored — `/^\d{4}-\d{2}-\d{2}$/`
rather than an unanchored `/^\d{4}-\d{2}-\d{2}/`, which accepted `2026-01-01junk`.

### 5.5 `apps/api/.env.example`, `docs/PHASE_19_…` — fixes H-4, H-5

`REDIS_URL` removed from the API template (nothing reads it); the migration command in the operator
quick reference corrected to the two forms that are actually verified to work from the image.

### 5.6 Not changed, and why

- **The rate limiter was not weakened.** The compiled-auth suite needs more than the ten requests per
  IP per fifteen minutes the production limiter allows. Rather than disable it — which would mean
  proving a weakened system — the suite runs each mode against a **freshly started production
  process**, so every mode gets its own budget and the limiter runs throughout. No test-only code
  path, flag or environment variable was introduced. The container gate separately proves the
  limiter is armed in the image (where the test bypass is inert).
- **No dependency was upgraded.** The reachable-advisory analysis (§8) concluded that no critical or
  high advisory is reachable from a deployed code path. The two that would be reachable require a
  Next.js **major** upgrade, which is precisely the "unrelated dependency upgrade" this phase is
  told not to perform, and which changes far more than the advisory.

---

## 6. New verification gates

Nine new gates, each with a mutation harness proving it detects the defect it claims to detect.

| Gate | Command | What it proves |
|---|---|---|
| Decorator-metadata parity | `pnpm --filter @ecc/api verify:metadata` | Every class-typed parameter reaches `design:paramtypes` as the real class in the **compiled** output; no `Function` anywhere in dist |
| Authorization structure | `pnpm --filter @ecc/api verify:routes` | Every live route outside a closed public allow-list carries `JwtAuthGuard`; the allow-list has not rotted |
| Configuration contract | `node scripts/verify-config-contract.mjs` | Read/documented/CI/image/compose variable sets correspond; ports, Node, pnpm and secrets are consistent |
| Supply chain | `node scripts/verify-dependency-audit.mjs` | Lockfile satisfies every manifest; native modules load; Prisma client and CLI match |
| Advisory triage | `node scripts/triage-vulnerabilities.mjs` | No critical/high advisory is reachable from a deployed code path, with evidence recorded |
| Compiled auth suite | `pnpm --filter @ecc/api verify:auth:compiled` | The whole authentication surface against a built artifact in production configuration |
| Migration safety | `bash scripts/verify-db-migrations.sh` | Migrations are valid, reproducible, idempotent, non-destructive and sufficient for the app |
| Release artifact | `node scripts/verify-release-artifact.mjs` | The artifact contains what the source claims, boots, and holds no secret or test material |
| CI parity | `node scripts/verify-ci-parity.mjs` | Every gate is wired into CI, every advisory step says so, no check is neutralised |

### 6.1 The metadata gate

Two halves against two different artefacts.

**Part A — source**, via the TypeScript compiler API. For every member that TypeScript will actually
decorate (any decorated method, every constructor) in every file `tsconfig.build.json` compiles, for
every parameter whose declared type resolves to a *class declaration*: the class must have reached
the file through a value import. `import type` and inline `type X` specifiers are violations.

Deliberately **not** a blanket "no `import type`" rule. `Request`/`Response` from express,
`ExecutionContext`/`CanActivate` from `@nestjs/common` and Prisma's generated enum types are
interfaces or type-only constructs with no runtime identity to preserve; requiring a value import
for them would be wrong. Only class declarations are enforced.

**Part B — compiled output**, loading `dist/*.js` and reading reflected metadata. Two invariants:

1. No `design:paramtypes` entry anywhere in dist is `Function`. `Function` in that metadata is the
   fingerprint of an elided import and is never legitimate.
2. For every class-typed parameter Part A identified, the class object actually present in the
   shipped array is **identical** (`===`) to the class exported by the corresponding compiled DTO
   module. Identity, not a name: a stub, an `Object`, or a different class with the right name all
   fail.

The gate handles both metadata shapes TypeScript emits — constructors attach to the class, decorated
methods are keyed by property name — because missing one would silently halve the coverage.

### 6.2 Mutation coverage

| Harness | Mutants | Result |
|---|---|---|
| `apps/api/scripts/mutate-decorator-metadata.mjs` | M1 `import type` on a controller DTO; M2 a DTO replaced by a bare interface | 2/2 detected |
| `apps/api/scripts/mutate-route-authorization.mjs` | M1 guards removed; M2 guards swapped for a non-authenticating guard; M3 `@Public()` added to a protected route | 3/3 detected |
| `scripts/mutate-config-contract.mjs` | M1 undocumented read; M2 documented-but-unread; M3 template ships an acceptable secret; M4 CI Node drift; M5 pnpm drift; M6 baked credential; M7 wrong health port; M8 weakened rate-limit guard | 8/8 detected |
| `scripts/mutate-container-gate.mjs` | M1 parser limit; M2 password policy; M3 error boundary; M4 rate limiter; M5 storage mode; M6 root user | 6/6 detected |

The container harness rebuilds the API image with `--no-cache` for each mutant and requires the gate
to fail **on the check that mutant targets** — a gate that fails for some other reason is reported
as a pass-for-the-wrong-reason, which is how P-0 was caught. It then re-runs the gate on the
restored tree and requires green.

### 6.3 The authorization matrix

`verify:routes` walks the Nest module graph from `AppModule` and reports only controllers a module
actually registers — a route table that cannot distinguish "guarded but not mounted" from "live" is
worse than no route table. `CareTaskController` is compiled, guarded and unreachable, and is reported
separately as such (finding L-1) rather than being counted as live surface.

The structural gate complements rather than duplicates the behavioural one: structure proves a guard
is *attached*; behaviour proves it *works*.

---

## 7. Authentication verification

All against a **built** artifact in a **production** configuration
(`NODE_ENV=production`, real `ValidationPipe`, real `JwtAuthGuard`, real rate limiter). No
test-only code path, flag or environment variable.

### 7.1 Round trips

`register → login → authenticated endpoint → refresh → authenticated endpoint`, proven for the
**core**, **session**, **lockout** and **account** modes, each against a freshly started process.

### 7.2 Negative cases

Fourteen token-defect cases, each with its own assertion and its own stated reason for being wrong:

HS384 signed with the real secret · HS512 signed with the real secret · HS256 signed with the wrong
secret · empty signature · no `sub` · empty `sub` · non-string `sub` · expired an hour ago · `exp`
ten years out · `role: SUPER_ADMIN` asserted · `alg=none` · `not-a-jwt` · three-segment garbage ·
empty bearer.

Plus: absent token, access token presented as a refresh token, garbage refresh token, correct
password for a locked account, deactivated account, soft-deleted account, a valid token for a
user that does not exist, malformed JSON, a token for a non-existent user.

**Every positive assertion is paired with its negative.** A `verify` that always returned true would
pass the "login works" assertion and fail "wrong password is refused".

### 7.3 What the role claim can and cannot do

A correctly signed token claiming `SUPER_ADMIN` **is accepted** — `RolesGuard` matches the claim,
and the server is the only party that can produce a valid signature. Treating that as a defect would
require removing role-based routing, which is the design.

The security property is that the claim confers nothing, and both halves are proven:

- `/auth/me` reports the role from the **database**, not from the claim, so a self-asserted role
  cannot change what the application believes about the account.
- The claim does not open a single resource outside the account's own care circle — verified over
  real HTTP on medications, documents and measurements, because `AuthorizationService` re-derives
  access from care-circle membership.

### 7.4 No leakage

Every response the script receives is scanned. The refresh token, the plaintext password, the stored
hash and the signing secret must not appear in any body. The access token is deliberately *not* on
that list, because `/auth/login` and `/auth/refresh` are supposed to return one; instead a JWT-shaped
value appearing in any **other** endpoint's body is a failure. Cookie flags are asserted:
`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth/refresh`, and no refresh token in any
response body.

The refresh cookie is `Secure` in production — which means it will not be sent over plain HTTP. That
is correct and is a deployment consequence, not a defect.

---

## 8. Authorization verification

`test/authorization-matrix.security.e2e-spec.ts` — 34 behavioural tests over real HTTP and a real
database, organised by boundary:

1. **Authentication** — one representative route per controller refuses a tokenless request with
   401 `UNAUTHENTICATED`; the health probes return an exact allow-listed field set and no connection
   string or host.
2. **Senior ownership** — a circle-B admin is refused every read *and every write* on circle A; a
   deleted senior is inaccessible even to a member of its own circle; a soft-deleted circle grants
   nothing.
3. **Membership status and `endsAt`** — PENDING and ENDED are refused, and **restoring the status
   restores access**; a past `endsAt` is refused while the row is still `ACTIVE`, and **clearing only
   `endsAt`** restores access. Without that second half, "denied" proves nothing about why.
4. **Care-circle role** — medication write is `FAMILY_ADMIN`/`DOCTOR` and `CAREGIVER`/`OBSERVER` are
   refused, while reading is open to every active member *including* `OBSERVER`; `OBSERVER` cannot
   record PHI while `CAREGIVER` can; the `CAREGIVER` who recorded a measurement cannot delete it but a
   steward can delete the very record they were refused; `OBSERVER` cannot post to the feed; a PRIVATE
   post is 404 for `FAMILY_ADMIN` and every other role, 200 only for its author.
5. **Document authorization** — a bare member cannot read or download an ungranted document while the
   uploader can; a grant opens it and revoking closes it; an expired grant opens nothing; a grant
   cannot be issued outside the circle; only a steward or the uploader can enumerate who a document is
   shared with; responses never carry `storageKey` or `contentHash`.
6. **Identity originates from the token** — a message cannot declare its own sender; a conversation's
   participant is derived from the token, verified in the database; a cross-senior conversation is
   unreachable; a non-participant circle member is refused; notifications are strictly per-user for
   list, read, mark and delete.
7. **Account liveness** — a deactivated account cannot log in and **reactivating restores login**; a
   soft-deleted account cannot; and the known gap (D-1) is asserted explicitly so it cannot close or
   widen silently.
8. **Global role** — a body field cannot set a role at registration, and registration always assigns
   `USER`, verified in the database; a member of no circle is refused both read and write.
9. **No cross-member escalation** — a member cannot edit another member's post, verified against the
   database rather than a status code the stub is free to choose.

---

## 9. Input validation and error boundaries

`test/validation-boundary.security.e2e-spec.ts` — 26 tests plus unit coverage of the two new
modules. Every response is scanned for a connection string, `password_hash`, `prisma`, `node_modules`,
a stack frame, an absolute host path or SQL text; and every ≥400 response is asserted to carry an
error code and a requestId and to carry no stack.

Covered: the error envelope; request-id sanitization in both directions; unknown routes; malformed
JSON on eight body-carrying routes (all 4xx, none 5xx); a JSON array where an object is expected; a
256 KB body (parsed, then rejected by the DTO — formerly a 500); a 2 MB document accepted (formerly
impossible); a document past the DTO ceiling rejected *by the DTO*, not the parser; unexpected
properties on writes; a PATCH unable to smuggle a field the POST rejects; invalid enums; invalid and
impossible dates; non-UUID and missing UUIDs; out-of-range numbers; pagination input; a download whose
stored bytes were removed behind the application's back; BigInt serialization; and that no auth
response ever carries a password or an Argon2 hash.

One finding is recorded as **not** a failure: `POST /conversations` accepts a body it does not bind.
Asserting a 400 there would assert behaviour the code does not have. Instead the test asserts the
property that matters — the spoofed `userId` does not become a conversation participant, verified
against the database.

---

## 10. Configuration, supply chain, container, database, artifact, CI

### 10.1 Configuration

12 variables read by code (of which one is a build-tool flag), 8 set by CI, 3 baked into
Dockerfiles, 17 documented, 10 interpolated by compose — all reconciled. No committed `.env`, no credential-shaped `ENV` in a Dockerfile, no
template secret the production validator would accept, no variable read but undocumented, none
documented but unread. Ports, Node majors, pnpm pins and the web health-page fallback all agree.

### 10.2 Supply chain

Lockfile byte-identical and satisfying every manifest; one package manager; five dependencies
execute code at install time (listed with what they do, so the set is reviewed rather than assumed);
the Prisma query engine loads lazily and the client/CLI versions match; argon2 loads and **computes**
correctly (hash → verify true → wrong password false).

**Advisory triage: 48 critical/high advisories → 0 reachable.** Each disposition carries its
evidence, and the two most consequential were verified against the *running image* rather than
reasoned about:

- `next` image-optimization RCE: `GET /_next/image` with both a remote and a local `url` returns 400
  against the built image, because the app uses no `next/image` and there is no loader to invoke.
- `multer` DoS: a multipart request to `/auth/login` and to a document route returns 400/401 without
  entering the multipart parser; the nested-field DoS payload returns 400 with liveness still
  answering in 9 ms.

The `dev-secret-change-me` literal in the built API is the Phase 16 *rejection list* — the control
working, not a leak, and the artifact check was corrected to say so.

### 10.3 Container

The existing Phase 20/21/22 gate, unweakened, now **56 checks** (was 49). The seven new ones cover
the Phase 23 fixes against the running image: a 512 KB body parsed rather than refused; a 32 MB body
→ 413 with the standard envelope; a non-UUID path → 400 `INVALID_IDENTIFIER`; a validation failure →
400 with no driver detail; the password policy rejecting 64 KB in single-digit milliseconds **and**
still refusing a weak password; liveness still answering in milliseconds after the stress probes; and
**the rate limiter armed in the image**, which no source-level suite can prove because those run
with the bypass deliberately enabled.

### 10.4 Database

16 checks on throwaway databases created and destroyed by the script. `prisma validate`; status on an
empty database reports pending and does **not** claim up-to-date; `migrate deploy`; status afterwards;
every migration recorded as applied; a repeated deploy is a no-op applying **zero** migrations; a
second empty database migrates to an identical schema; no unannotated destructive statement; enum
migrations use the shadow-type idiom with explicit value mapping; the application boots against the
freshly migrated schema and completes an authenticated round trip; and an assertion that every URL
targeted the throwaway container's port, so it cannot touch a developer database even by accident.

The developer `ecc` database was never used.

### 10.5 Release artifact

13 checks. Clean, warm and stale-tsbuildinfo builds each emit the entry point; dist is 1:1 with
source (66 modules, no extras); no test, spec, fixture or raw TypeScript; no credential or connection
string across 264 files; **every non-relative `require()` resolves** — an unresolved specifier is a
crash on the first request that reaches it, and a cold path the container gate cannot see; the
artifact boots and drains; **two clean builds of identical sources are byte-identical across all 264
files**; the web build emits a standalone tree with no `.env`, source or spec, no baked secret, and a
`NEXT_PUBLIC_API_URL` proven *not* baked at build time.

### 10.6 CI parity

**GitHub Actions has not been run.** No remote result is claimed. What was done instead: every
command in the workflow was extracted with a real YAML parser and executed locally in workflow
order — **35 executed, 0 failed**, 2 advisory (the two pre-existing lint baselines, whose real
counts are reported rather than suppressed), 3 executed deliberately as standalone verifications
rather than re-run, and each of the remaining 14 Actions/expression steps listed with why it needs
the runner.

Three real workflow defects were found and fixed by this audit: none of the Phase 23 gates were
wired into CI (a gate that only runs on a laptop is a convention); three CI steps hardcoded
`localhost:5432` and the service credentials instead of the job `env`, making them unrunnable
outside the runner that hosts that exact service; and the container job was checked for being a real
job rather than a stub. The `release` job is new and carries the migration, artifact and
mutation gates.

Two observations recorded rather than fixed: `apps/api/.env.example` does not document
`ECC_TEST_DISABLE_RATE_LIMIT` (correctly — it is test-only and documenting it would be misleading),
and three workspace packages declare no `engines.node`, so the root value applies.

---

## 11. Deferred issues

| ID | Issue | Why deferred |
|---|---|---|
| **D-1** | A deactivated or soft-deleted account keeps access for the remaining life of its access token (≤15 min). | Closing it means a per-request database lookup or a revocation list. Both are architecture changes, not security fixes, and would trade a bounded 15-minute window for a per-request dependency the liveness design currently avoids. Asserted in the matrix so it cannot close or widen silently. |
| **D-2** | Access-token lifetime is unbounded. | One-line `maxAge` on `verifyAsync`, but it changes token-validation behaviour for every request and belongs with a deliberate token-lifetime policy rather than an audit. Not exploitable without the signing secret. |
| **D-3** | `CareTaskController` is compiled, guarded and unreachable. | Registering it would **add** a live surface; deleting it is a product decision about whether Phase 7 is still planned. The route gate reports it explicitly so it cannot be mistaken for live surface. |
| **D-4** | Routes without a body DTO accept and ignore a body. | Adding a DTO to a stub endpoint is feature work. The security property (identity from the token) is proven against the database. |
| **D-5** | `multer` DoS advisories. | Verified not reachable — no multer-backed interceptor exists. Fixing requires a resolution override for a transitive dependency. |
| **D-6** | `next` critical RCE advisories. | Verified not reachable — no `next/image`, no image optimizer. Every fix is in `>= 15.5.24`, a **major** upgrade, which is the "unrelated dependency upgrade" this phase is told not to perform. If a `next/image` usage is ever added, this becomes reachable and the upgrade is then required. |
| **D-7** | The whole 48-advisory set in devDependencies (`vitest` UI RCE, `tar`, `postcss`, `@xmldom/xmldom`, `picomatch`, `image-size`, `vite`, `tmp`, `glob`). | Build-time only; not present in either runtime image, which the container gate verifies. Upgrading the owning devDependencies is routine maintenance, not a release blocker. |
| **D-8** | `pnpm install --frozen-lockfile` is not enforced by a hook; CI enforces it. | A pre-commit hook would be a workflow change beyond this phase. |
| **D-9** | The container-gate mutation harness fills `/var/lib/docker` (it reached 100 % on this machine). | A harness limitation, not a product one. The build cache was pruned; the harness is run deliberately rather than in CI for this reason. |

---

## 12. Limitations of this phase

- **GitHub Actions has never been executed.** Every command was run locally, but the hosted runner,
  its service containers, its action versions and its 15-minute/30-minute/45-minute timeouts are
  unverified.
- **No load, performance or concurrency testing** was done. The ReDoS finding was found by
  measurement, not by a load test, which suggests the value of doing one.
- **No penetration testing** was done, and none of these gates replaces it.
- **The authorization matrix is behavioural, not exhaustive.** It covers every boundary the phase
  identified; it is not proof that no untested route has an authorization defect. The structural gate
  covers the *attachment* of guards across all 57 live routes; the behavioural tests cover the
  *correctness* of the guards the phase reasoned about.
- **The `expiresAt` grant comparison uses `gte`**, so a grant expiring at exactly the current instant
  is honoured. Noted, not changed: it is a boundary of negligible security consequence and altering
  it without a decision about the intended semantics would be a guess.
- **Container mutation testing is expensive** (~1 minute per `--no-cache` image build) and is run
  deliberately rather than in CI.

---

## 13. Phase 24

**Phase 24 has not started.** No Phase 24 work is present in this change set. The deferred items in
§11 are candidates for it, not commitments.

**No commit was created and nothing was pushed.** The working tree holds the intentional Phase 18–22
changes plus this phase's, all uncommitted, exactly as instructed.

The final state is ready for an independent security and reliability review of Phase 23.
