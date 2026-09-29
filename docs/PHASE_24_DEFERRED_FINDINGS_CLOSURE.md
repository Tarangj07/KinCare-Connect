# Phase 24 — Deferred Findings Closure & Release Gap Analysis

**Status:** complete. Nothing committed, nothing pushed.
**Branch:** `main` · **Base commit:** `d0cd0dd` ("Complete Phase 17 testing CI and reliability")
**Standing of the working tree:** the Phase 18–23 changes were already uncommitted when this phase
began and remain uncommitted. Everything this phase added sits alongside them.
**Predecessor documents:** `docs/PHASE_23_PRODUCTION_SECURITY_RELEASE_ASSURITY.md`. There is no
`docs/PHASE_23_FINAL_REPORT.md` and no `SECURITY_REVIEW_PHASE_23.md` in the repository; the Phase 23
assurance document is the authoritative record of the nine deferred findings and is treated as such
here.

---

## 1. Scope

Phase 23 ended with nine findings recorded as **deferred** (D-1 … D-9) rather than fixed. Phase 24
does one thing: it re-evaluates each of them against the current codebase and gives each an
evidence-backed final disposition.

The objective is explicitly **not** "fix everything". For each finding the question is whether
remediation is justified, and the answer was allowed to be *defer*, *obsolete*, or *this is a
product decision*. Two findings were fixed, one was partially fixed, six remain deferred, and no
dependency was upgraded, no Prisma schema or migration was touched, no authentication architecture
was redesigned, and no gate was weakened.

Explicitly **not done**: deployment of any kind; Kubernetes, Terraform, Helm, cloud services; WebSockets,
realtime, push/SMS/email providers; AI/OCR, EHR, GPS, payments; dashboard redesign; mobile feature
work; Redis/MinIO/S3 migration; backup infrastructure; a Next.js major upgrade; a Prisma migration;
any change to `PROJECT_PLAN.md`, `PROJECT_PLAN-old.md` or any `SECURITY_REVIEW_*` artifact; any
commit, push, amend, reset, rebase or stash.

---

## 2. Starting state

Verified before any edit (`git log`, `git status`, `git diff --check`):

| Item | Value |
|---|---|
| HEAD | `d0cd0dd` |
| Modified tracked files | 30 |
| Untracked files/directories | 33 |
| Working tree | all Phase 18–23 work, uncommitted, and left that way |

Two defects in the *evidence base* rather than the product were found while re-deriving the baseline,
and both are reported here rather than quietly absorbed:

1. **The regression counts quoted in the Phase 24 brief do not match this tree.** The brief lists
   API unit 153, integration 60, all-with-DB 213, no-DB 109+104, mobile 32, web 1. Measured on this
   machine before any Phase 24 edit: API unit **139 passed / 44 skipped** (183 collected). Mobile 32
   and web 1 match exactly. The API figures do not correspond to any lane in the current
   configuration, so the brief's numbers are reported here as unverified, and every number below is
   a measurement taken during this phase. The delta attributable to Phase 24 is stated explicitly for
   each lane so the two sets can be reconciled by whoever holds the earlier record.
2. **`pnpm audit` is not a fixed input.** The advisory database has grown since Phase 23 ran. The
   current database reports 48 critical/high advisories (Phase 23 also reported 48, but not the same
   48: the `next` set has grown from 2 to 10 critical/high). Any "48 advisories" figure is a snapshot,
   not an invariant.

---

## 3. D-1 — deactivated / soft-deleted account keeps access for the life of its access token

**Still present: yes. Exploitable: yes, within a bounded window. Class: accepted design decision
with a documented window. Disposition: DEFER, with the window now pinned by tests.**

What the code actually does, read rather than recalled:

- `JwtAuthGuard` (`apps/api/src/auth/guards/auth.guard.ts`) verifies the signature, pins HS256,
  requires a non-empty `sub`, and — since Phase 24 (D-2) — bounds the token's age. It consults the
  database for nothing.
- `AuthService.login` refuses an inactive or soft-deleted account outright (`ForbiddenException`,
  audited as `auth.login.inactive`), so no *new* token can be obtained.
- `AuthService.refresh` re-reads the user with `isActive: true` and refuses a soft-deleted one, so a
  session cannot be *extended* after deactivation. `logout` and `changePassword` revoke the
  refresh-token rows; reuse detection revokes the whole rotation family.
- `AuthService.getProfile` (`GET /auth/me`) re-reads the user and returns 401 for an inactive or
  deleted account. The application therefore *reports* the account as dead immediately even though
  other routes still honour the token.

So the residual window is: **an access token issued before deactivation continues to authorise
non-`/auth/me` requests until it expires.** It cannot be refreshed afterwards.

Closing it requires one of: a database lookup per request, a revocation list consulted per request,
or a session version claim compared against the database — all of which are architecture changes, not
security fixes, and all of which replace a bounded window with a per-request dependency. That is the
reason Phase 23 gave, re-derived independently and accepted.

What Phase 24 changed is the *evidence*, because "≤15 minutes" is only a risk statement if the 15
minutes cannot move:

- `apps/api/test/auth-session.lifecycle.e2e-spec.ts` — a new test logs in, decodes the issued access
  token and asserts `exp - iat === 15 * 60` against a **literal**, not against the constant the
  application uses. The existing D-1 test in the authorization matrix asserts the gap exists; neither
  of them would have noticed the lifetime being raised, because both compared the token against
  itself. Widening the window now fails a test.
- The D-2 fix (below) makes the bound a property of *verification*, not of issuance: even a token
  whose `exp` claims ten years stops being honoured once it is 15 minutes old.

**Do not** add a per-request database query. **Do** re-open this if the product adds long-lived
sessions, or any authentication path that does not re-read the user.

---

## 4. D-2 — unbounded access-token lifetime

**Partly a real defect, not only "missing configurability". Disposition: FIXED.**

Phase 23 recorded this as "access-token lifetime is unbounded" and deferred it as a one-line
`maxAge`. Re-investigation found the precise shape, which is more precise than Phase 23's summary and
matters for what the fix means:

- **Issuance was already bounded.** `expiresIn: '15m'` appeared twice — `AppModule`'s `JwtModule`
  sign options and `AuthService.generateAccessToken`. No path produces a token without `exp`. So the
  original finding was *not* "tokens live forever"; it was "the verifier does not constrain how long
  a token may be honoured, independent of the `exp` claim".
- **Verification bounded nothing.** A correctly signed token with a ten-year `exp` was accepted, and
  would have been accepted for ten years. Reaching that requires the signing secret — an attacker
  holding the secret can already mint any claim — so this was defence in depth, exactly as Phase 23
  said.
- **It was also the mechanism that made D-1's window an assumption rather than a property.** The
  15-minute window was enforced by a literal appearing in two files, with nothing connecting it to
  the verifier.

The fix (`apps/api/src/config/security-config.ts`, `app.module.ts`, `auth.service.ts`,
`auth.guard.ts`):

- `ACCESS_TOKEN_TTL_SECONDS = 15 * 60` is now the single source of truth for issuance and for the new
  verification bound. One constant, three call sites; they cannot drift.
- `JwtAuthGuard` verifies with `maxAge: ACCESS_TOKEN_TTL_SECONDS`. A token with no `iat` is refused:
  `maxAge` is defined in terms of `iat`, so a token without one has no age to check, and every
  access token this service issues carries one.
- **Effective validity is now `min(exp, iat + 15m)` for any token**, so the `exp` claim alone decides
  nothing. HS256 pinning, the mandatory `sub`, the production fail-fast on
  `JWT_ACCESS_SECRET`, refresh rotation, reuse detection, logout, lockout, the inactive/deleted
  checks at login and refresh, membership checks and cookie flags are all untouched. No
  authentication architecture was redesigned; one option was added to an existing call and one
  duplicated constant was removed.

**An honest correction to my own first attempt.** The first test I wrote asserted that a
correctly signed ten-year token is *refused*. It failed — correctly. `maxAge` is evaluated against
`iat`, so a token minted a moment ago with a ten-year `exp` is still accepted; it simply stops being
accepted once it is 15 minutes old. The control is "how old is this token", not "what does it claim".
Both behaviours are now asserted, because either alone is unfalsifiable: a verifier that refused
everything would pass the "aged token is refused" assertion, and one without the bound would pass the
"fresh token is accepted" assertion.

**Known consequence, stated rather than hidden:** `maxAge` is measured against the *issuer's* clock.
A deployment whose API nodes disagree by more than 15 minutes will reject each other's tokens. Such a
deployment is already broken by `exp`, which is issued from the same clock — this adds no new class of
clock sensitivity, but it removes the last few minutes of slack.

---

## 5. D-3 — `CareTaskController` is compiled, guarded and unreachable

**Still present: yes. Disposition: DEFER — deliberately, and now pinned by a test.**

Facts established by reading the module graph, not by inference:

- No module in `apps/api/src` registers the controller. There is no `care-tasks.module.ts` at all;
  the directory contains only `care-tasks.controller.ts` and `services/care-task.service.ts`, and
  `CareTaskService` is referenced nowhere. `verify:routes` walks the graph from `AppModule` and
  reports `CareTaskController (5 handlers)` under "compiled but NOT registered … (unreachable — not
  a live surface)".
- All five handlers are placeholders that return `{ message: '… architecture ready for Phase 7.' }`
  and write nothing. The controller's own comments say Phase 7.
- `npm run verify:routes` reports **57 live routes** from 62 compiled handlers; the 5 unmounted ones
  are excluded from the live surface by construction.

Why it stays unmounted: **mounting it would add live attack surface**, not remove it. Five new
authenticated endpoints whose handlers do nothing is strictly worse than no endpoints. Deleting it is
a product decision about whether Phase 7 is still planned, and this phase is not entitled to make it.
The alternative — excluding it from `tsconfig.build.json` so it does not ship — was considered and
**rejected**: the release-artifact gate asserts dist is 1:1 with source, so the exclusion would have
to be mirrored there, and a change that alters what the artifact contains for no security gain is
not a security fix.

What was added: a behavioural pin in the authorization matrix that `GET`/`POST`/`PATCH`/`DELETE` on
`/seniors/:seniorId/tasks` answer **404** for a request made with a *fully authorised* member's token
— a member of the senior's own circle who would pass both guards and the care-circle check. That
matters: a tokenless request would be refused with 401 by the guard whether or not the route existed,
so 401 would prove nothing. A 404 for a request that would otherwise have succeeded is evidence of
absence, and if the controller is ever registered the test fails with a message that says the finding
has changed state.

---

## 6. D-4 — routes without a body DTO

**One genuinely unvalidated body-carrying route found, and it was worse than the two Phase 23 named.
Disposition: FIXED (both), plus a gate change so it cannot recur silently.**

Phase 23 named `POST /seniors/:id/conversations` and `PATCH /feed/:id` as DTO-less, and concluded the
security property held because identity comes from the token. Re-inventorying every `@Body` in every
controller found the following, and the distinction that matters is not "has a DTO" but **what the
compiled metatype of the body parameter actually is**.

Nest's `ValidationPipe.toValidate()` skips any parameter whose reflected type is one of
`[String, Boolean, Number, Array, Object, Buffer, Date]`. TypeScript emits `Object` for two constructs
that *look* like DTOs in source:

- `Partial<SomeDto>` — a mapped type, not a class;
- an inline type literal, `{ channel?: string }`.

Both therefore produce a route that is guarded, authorised, and completely unvalidated: no whitelist,
no `forbidNonWhitelisted`, no type or length constraint. The metadata gate from Phase 23 does **not**
catch this: it rejects `Function` in `design:paramtypes` (the elided-import fingerprint) and checks
class *identity* for class-typed parameters, and `Object` is neither. Measured against the compiled
artifact before the fix:

```
PATCH /feed/:updateId paramtypes: [ 'String', 'String', 'Object', 'Object' ]
POST  /feed           paramtypes: [ 'String', 'CreateFamilyUpdateDto', 'Object' ]
```

`PATCH /api/v1/notification-preferences` had the same shape, for the same reason.

Fixed, with the smallest change that restores the invariant:

- `apps/api/src/modules/feed/dto/update-update.dto.ts` (new) — `UpdateFamilyUpdateDto`, every field
  optional, every constraint copied verbatim from `CreateFamilyUpdateDto` so a PATCH cannot accept
  something the POST would refuse. `Partial<>` is exactly the construct that erases the runtime type,
  so the class is required; it is not optional style.
- `apps/api/src/modules/notifications/dto/update-preference.dto.ts` (new) —
  `UpdateNotificationPreferenceDto`, for the same reason on a live route that reflects the body back.
  This route is a Phase 8 stub whose body is not persisted, so it is not a data-integrity defect
  today; it is included because the invariant now enforced has no exception for stubs.

**Routes deliberately left body-less, with the reason recorded** (a route that binds no body cannot
be a validation hole; the property asserted for each is *why* it is safe):

| Route | Why no DTO is needed |
|---|---|
| `POST /seniors/:seniorId/conversations` | Declares no `@Body` parameter at all. Identity is derived from the token and verified in the database; Phase 23's matrix test proves a spoofed `userId` does not become a participant. Adding a DTO would be feature work on a stub. |
| `POST .../conversations/:id/read`, emergency `acknowledge`/`resolve`/`cancel`, `PATCH /notifications/:id/read|unread`, `PATCH /documents/:id/archive` | No body parameters. State transitions carry no caller-supplied structure. |
| `POST .../conversations/:id/participants` | Uses a keyed `@Body('targetUserId')`. The service validates the UUID format itself and re-derives care-circle access for the target. |
| `POST /auth/forgot-password`, `reset-password`, `verify-email` | Phase 4 stubs using keyed `@Body('field')` parameters whose values are not used. `forgot-password` returns a constant response, so there is no account enumeration to protect with a DTO. |
| `CareTaskController` (unmounted) | Not a live surface; the D-3 invariant is scoped to *mounted* routes deliberately, so dead code is not held to the standard of live code. |

---

## 7. D-5 — `multer` DoS advisories

**Still present in the dependency graph. Disposition: DEFER — verified not reachable, with the
reachability now derived rather than assumed.**

`multer@2.0.2` is a **production** dependency of the API image — not merely a devDependency — via
`@nestjs/platform-express`. It carries six high DoS advisories (fixes in `>= 2.3.0`). So the Phase 23
question "is it installed in the artifact?" answers *yes*, and the only real question is whether
anything invokes it.

Findings:

- No controller uses `FileInterceptor`, `FilesInterceptor`, `AnyFilesInterceptor`,
  `FileFieldsInterceptor` or `NoFilesInterceptor`. The API has exactly one upload route,
  `POST /seniors/:seniorId/documents`, and it accepts **base64 inside a JSON body**
  (`UploadDocumentDto.fileContent`) with a DTO ceiling of 20 MB and a `DocumentService` decoded
  ceiling of 10 MB — Phase 23's C-2 fix.
- Phase 23 verified against the running image that a multipart request to `/auth/login` and to a
  document route answers 400/401 without entering the multipart parser, and that the nested-field DoS
  payload answers 400 with liveness still answering in 9 ms.
- Nothing in Phase 24 changed the upload path, so that evidence still holds; the
  `verify:routes` gate re-ran green and the container gate re-ran 57/57.

Remediation would require a resolution override for a transitive dependency of a framework package,
to fix a code path this application does not contain. Doing it would be a lockfile change with real
upgrade risk and no reachable exposure. The triage gate re-checks for a multer-backed interceptor on
every run and will flip to `REACHABLE` the day one appears.

---

## 8. D-6 — `next` critical/high advisories

**Still present. Disposition: DEFER — no upgrade performed. The evidence behind the deferral was
rewritten, because the Phase 23 evidence did not support it.**

The installed version is `next@14.2.35` (a `^14.2.15` range in `apps/web/package.json`). Ten
critical/high advisories currently apply, not the two Phase 23 triaged. The two criticals are the
image-optimization AVIF RCE and the Windows-hosted RCE. All fixes are in `>= 15.5.24`.

**No upgrade was performed, and the reason is stronger than "a major upgrade is out of scope":** 14 →
15 is a major upgrade of the framework the web product is built on. It changes the router, the React
version floor, the caching defaults and the image pipeline. Doing that inside a findings-closure
phase, to a system with no CI run and no deployment, is exactly the kind of unrelated change this
phase is told not to make, and it would invalidate the web test/lint/build evidence gathered here.

**What Phase 24 did change is the triage rule, which was making a claim it could not support.**
Phase 23 gave `next` a single rule: if the app imports `next/image`, every `next` advisory is
reachable, otherwise none are. That is a *blanket* "not reachable" for a package that ships in a
production image, justified by evidence about one feature, and the advisory set had outgrown it.

`next` is now triaged **per advisory**, each rule naming the feature whose presence makes that
advisory reachable, with the check stated so a reviewer can repeat it:

| Required feature | Present? | How that was established |
|---|---|---|
| Image optimization (RCE, DoS, cache growth) | no | No `next/image` import, no `<Image>`, no `images:` key. Phase 23 additionally probed the running image: `/_next/image` answered 400 for a remote and a local `url`. |
| Windows hosting | no | `apps/web/Dockerfile` builds from `node:24-alpine`. |
| App Router **Server Function endpoint** (4 advisories: RSC deserialization DoS, Server-Components DoS ×2, Server-Actions DoS) | no | No `'use server'` directive in `apps/web/src` or in any `transpilePackages` workspace package — **and** the built artefact agrees: `.next/server/server-reference-manifest.json` is `{"node":{},"edge":{}}`, i.e. **zero registered server functions**, so the endpoint the advisories require does not exist. |
| Rewrites (SSRF, request smuggling) | no | No `rewrites`/`redirects` in `next.config.mjs`. |
| Middleware / proxy (cache poisoning, Pages-Router i18n bypass) | no | No `middleware.{ts,js}`, `src/middleware.ts` or `src/proxy.ts`. |
| Pages Router with i18n | no | No `i18n:` in the config and no `apps/web/pages` directory. |
| WebSocket upgrade handling (SSRF) | no | No WebSocket server, upgrade handler or client. |
| Custom server (SSRF in Server Actions) | no | No programmatic Next server; the runtime entry point is the `server.js` Next generates for `output: 'standalone'`, which dispatches to Next's own handler. |
| CSP nonces (XSS) | no | No nonce generated or used. |

**The rules were negative-tested, because a rule that cannot fail is a comment.** Four changes were
planted one at a time, the tree restored after each, and the gate re-run:

| Planted change | Gate result |
|---|---|
| A `'use server'` directive in a web page | 5 of 10 `next` advisories flip to `REACHABLE`, **exit 1** |
| A `next/image` import | 1 flips to `REACHABLE`, **exit 1** |
| A `rewrites()` function in `next.config.mjs` | 1 flips to `REACHABLE`, **exit 1** |
| A remote `@import url(...)` stylesheet (postcss rule) | postcss flips to `REACHABLE`, **exit 1** |

The first negative test initially **did not fire** — a false green in my own rule. The built
manifest was consulted before the source, so a planted `'use server'` was masked by a manifest from a
previous build. The precedence was inverted so the source wins and a stale manifest is reported as
such. Recorded here because it is the same class of error Phase 23 found twice.

**Escalation for the release decision, not for this phase.** `next@14.2.35` is two majors behind
current, carries 10 critical/high advisories, and is not reachable *today* purely because the app
declares no Server Actions, no middleware, no rewrites and no image optimization. That is a
fragile-sounding reason to be comfortable, and it is one `import 'use server'` away from changing.
The D-6 disposition is therefore: **not reachable now, re-checked automatically on every run, and a
scheduled Next 15 upgrade is recommended as product work.** If a Server Action, a `next/image` usage
or a `middleware.ts` is ever added, the gate turns red on the same run.

---

## 9. D-7 — devDependency / transitive advisories

**No upgrade performed. Two defects found in the classifier that produced the Phase 23
classification, both fixed, because the classification was partly wrong.**

Phase 23's verdict was "30-ish advisories are BUILD-TIME, none reachable". Re-deriving it found two
bugs in `scripts/triage-vulnerabilities.mjs` that made its *evidence* wrong even where its verdict
happened to be right:

1. **Workspace importer names were mis-decoded.** pnpm writes a workspace importer's directory with
   its separator doubled — `apps/web` is reported as `apps__web`. The script looked that string up as
   a directory, found nothing, and returned "not a production path" for **every** path through
   `apps/web` and `apps/mobile`. Concretely: it reported `next`, a production dependency, as having
   0 production paths, and reported the whole Expo toolchain as absent from any runtime artefact.
2. **Only the first finding of each advisory was read.** pnpm groups paths by installed version;
   reading `findings[0]` classified `multer` by whichever version was listed first — the
   devDependency path through `@nestjs/testing` — and so reported 0 of 4 production paths for a
   package that `@nestjs/platform-express` pulls in at runtime.

With both fixed, the honest picture is:

| Package | Severity | Classification | Evidence |
|---|---|---|---|
| `next@14.2.35` | 4 crit/high | NOT REACHABLE (per-advisory) | §8 |
| `multer@2.0.2` | 6 high | NOT REACHABLE | No multer-backed interceptor; multipart refused in the image. Installed in the API image as a production transitive — the reason this is a reachability question and not an absence. |
| `postcss@8.4.31/8.4.49` | 2 high | NOT REACHABLE | Reaches production through `next`, so "not installed" is not available as a defence. Checked instead whether the runtime can reach it: **no module under `next/dist/server` in the shipped standalone tree references postcss** (every file checked); every reference is build-time (`next/dist/build`, `next/dist/compiled`, `terser-webpack-plugin`), and the app imports no remote stylesheet. The vulnerable functions need a stylesheet an attacker influences. Fails closed if either changes. |
| `tar`, `@xmldom/xmldom`, `image-size`, `picomatch`, `glob`, `tmp`, `vite`, `turbo-stream` (via `expo`), `@nestjs/cli`, `vitest` | 36 crit/high | BUILD-TIME | These reach the tree through `expo`, which is a **production** dependency of `@ecc/mobile` — so Phase 23's stated reason ("every path runs through a devDependency") was wrong, and the new reason is the honest one: every production path continues into Expo's development/bundling toolchain (`@expo/cli`, `@expo/metro-config`, `@expo/config-plugins`, `@expo/server`, `metro`, `@remix-run/*`), which runs on a developer machine or a CI runner. A mobile app ships a JS bundle and assets; it contains no Node process that could execute these. |

No advisory was suppressed, and the audit configuration was not weakened to make the report green —
the opposite happened: a stricter rule was added that reports `REACHABLE (unclassified)` for any
critical/high advisory with no rule covering it, so an unexamined advisory fails the gate instead of
passing it.

**No upgrade.** `vitest` 2.1.9 → 3.x is a major test-runner change; the rest are owned by
`@nestjs/cli` and `expo` and would need resolution overrides plus lockfile changes. None of it is
present in a runtime image, and the container gate re-verifies that on every run. Routine maintenance,
not a release blocker — and the audit is a moving target, so the gate must be re-run at release time
rather than a stored number trusted.

---

## 10. D-8 — `--frozen-lockfile` is not hook-enforced

**Enforcement proven, not assumed. Disposition: DEFER — the gap is real, and closing it is out of
scope for this phase.**

Every point that can produce or verify a shipped artifact already enforces it. This was **proved by
introducing lockfile drift** (`class-validator` `^0.14.1` → `^0.14.2` in `apps/api/package.json`,
then restoring it) and observing each path refuse:

| Path | Command | Result with drift |
|---|---|---|
| CI, all four jobs | `pnpm install --frozen-lockfile` | **exit 1** — `ERR_PNPM_OUTDATED_LOCKFILE`, "specifiers in the lockfile don't match specifiers in package.json" |
| API image | `pnpm install --filter @ecc/api... --frozen-lockfile` (the exact Dockerfile layer, run in a throwaway container against a copy of the manifests) | **exit 1**, same error |
| Supply-chain gate | `node scripts/verify-dependency-audit.mjs` | **exit 1** |
| CI guard | `git diff --exit-code -- pnpm-lock.yaml` | fails on any uncommitted lockfile change |

There is **no** `--frozen-lockfile=false`, no `npm ci` bypass, and no other install path in the
repository (grep across `ci.yml`, both Dockerfiles and `docker-compose.yml`: four `--frozen-lockfile`
in CI, one in each Dockerfile, zero negations).

So drift cannot reach a build. What remains unenforced is a *developer's* local
`pnpm install` — which resolves the tree, does not touch the lockfile, and produces a node_modules
that CI will then reject. That is a real but low-impact gap, and the two ways to close it are both out
of scope: a commit hook needs a hook runner (a new devDependency and a lockfile change), and
`.npmrc` `frozen-lockfile=true` would make `pnpm add` fail for every developer. A committed
`core.hooksPath` script that nobody opts into is not enforcement, only the appearance of it. Deferred
with the above as the reason, and the enforcement points re-proved rather than restated.

---

## 11. D-9 — container-mutation harness disk cost

**Real, structural, and not safely fixable by pruning. Disposition: DEFER with a bounded
improvement, and two harness defects found on the way.**

Phase 23 recorded `/var/lib/docker` reaching 100% and deferred it as "a harness limitation, not a
product one". Re-investigation found the cause is structural: every mutant is built with
`--no-cache`, so each build writes a complete new layer set and six accumulate. Seven mutants now.

**The obvious fix was implemented, measured, and then removed.** Pruning the build cache between
mutants looked free — a `--no-cache` build reuses no *layers* from the previous mutant — but the
build cache also holds pnpm's package store. Pruning it forces every following mutant to re-download
~660 packages from the registry. Measured here: a mutant build after a prune spent its whole run in
`resolved 665, reused 0, downloaded 662` and then failed. Trading a disk-full failure for a
network-dependent verification harness is a bad trade, and a silent one.

What ships instead:

- free space is **reported after every mutant**, always;
- a **warning** fires when free space crosses the floor (default 20 GB, `--min-free-gb` to move it),
  naming the mitigation and its cost;
- `--prune-cache` enables the reclaim for an operator who wants the disk more than the store.

The peak is therefore **not** reduced by default. That is a recorded trade-off, not an oversight: the
remaining remedies are a larger volume or a smaller mutant set, and both are the operator's call. On
this machine the run peaked at ~10 GB free remaining.

Two harness defects were found and fixed while doing this, both of which had been producing
misleading results:

1. **A killed run could leave a mutant in the working tree.** The `finally` block restores the source
   when the harness exits normally or throws — but not when it is killed, and each mutant's
   `spawnSync` blocks the event loop, so no handler could fire mid-build anyway. This was not
   theoretical: an interrupted run left `USER 0:0` in the Dockerfile and the quadratic password regex
   in `password-policy.ts` — i.e. Phase 23's Critical C-1 fix silently reverted in the working tree,
   where every later conclusion would have been about a different codebase. The harness now tracks
   the mutated files and restores them on `SIGINT`/`SIGTERM`/`SIGHUP`. (`SIGKILL` cannot be caught;
   the tree was verified clean after each occurrence.)
2. **`spawnSync` without `maxBuffer` killed the `docker build` child.** Node's default buffer is 1 MB;
   a cold pnpm store makes the build print per-package progress past that, and Node then *kills* the
   child. The symptom is a buildkit `CANCELED: context canceled` on a perfectly good Dockerfile,
   which reads exactly like a failed mutant — and it appeared only once the store was cold, i.e. the
   worst possible moment. Fixed with an explicit 256 MB buffer, and `build.error` is now reported so
   this failure mode is diagnosable instead of looking like a defect in the code under test.

A third change makes the harness honest about attribution: when the gate fails but the check the
mutant targets is **not** among the reported failures, the gate's own output is now printed. Two
mutants were inconclusive for exactly this reason before that change (see §14).

---

## 12. Changes made

Production code (4 files):

| File | Change | Finding |
|---|---|---|
| `apps/api/src/config/security-config.ts` | `ACCESS_TOKEN_TTL_SECONDS = 15 * 60` added as the single source of truth for access-token lifetime | D-2 |
| `apps/api/src/auth/guards/auth.guard.ts` | `maxAge: ACCESS_TOKEN_TTL_SECONDS` on `verifyAsync`; a token without `iat` is refused | D-2 |
| `apps/api/src/app.module.ts` | sign options read the constant instead of `'15m'` | D-2 |
| `apps/api/src/auth/auth.service.ts` | `generateAccessToken` reads the constant instead of `'15m'` | D-2 |
| `apps/api/src/modules/feed/feed.controller.ts` | body parameter `Partial<CreateFamilyUpdateDto>` → `UpdateFamilyUpdateDto` | D-4 |
| `apps/api/src/modules/feed/dto/update-update.dto.ts` | **new** DTO | D-4 |
| `apps/api/src/modules/notifications/preference.controller.ts` | inline type literal → `UpdateNotificationPreferenceDto` | D-4 |
| `apps/api/src/modules/notifications/dto/update-preference.dto.ts` | **new** DTO | D-4 |

Tests (5 files): `auth.guard.spec.ts` (+5 cases incl. a block that signs real tokens with the real
`JwtService`), `auth-session.lifecycle.e2e-spec.ts` (+1), `authorization-matrix.security.e2e-spec.ts`
(+1, and 1 rewritten to use a body the route now accepts), `validation-boundary.security.e2e-spec.ts`
(+4), and the harness in `apps/api/scripts/verify-compiled-auth.mjs` (§15).

Two CI gates that could not test their own claims, found by running the three workflow steps that no
local gate had ever executed, and fixed (§17):

1. **"production contract is enforced fail-closed" could never demonstrate the property it asserts.**
   The step sets `STORAGE_DIR` at step level, and its second case is supposed to start the API
   *without* it — but it invoked `node dist/main.js` with a prefix assignment, so the variable was
   still in the environment, the API started, and the step took its own `::error::` branch. On the
   real runner this step **fails**; it does not silently pass, but it also never tested anything.
   Proved locally both ways: with the variable inherited the process starts (exit 124 under
   `timeout`); with `STORAGE_DIR=` it exits 1 naming the missing variable. Fixed by making the
   variable explicitly empty in that one invocation, and the corrected step passes verbatim.
2. **"authenticated round-trip" was green while asserting nothing about signatures.** The step
   assigns `JWT_ACCESS_SECRET` as a prefix on the `node dist/main.js` line, so the harness — a
   *separate* `node` invocation in the same shell — never saw it, printed `skipping the
   signature-based token assertions` and exited 0. The 13 token-defect cases and the token-lifetime
   assertions were all skipped. This is the same vacuous-green class Phase 23 recorded as P-1 and
   fixed in the suite driver; it was still live in this workflow step. Proved locally: without the
   export the assertions are skipped; with it they run and all pass. Fixed by moving the secret to
   the step's `env:` so the server and the harness share one value.

Gates and harnesses (4 files): `apps/api/scripts/verify-route-authorization.mjs` (new rule),
`apps/api/scripts/mutate-route-authorization.mjs` (+M4, +M5), `apps/api/scripts/mutate-token-lifetime.mjs`
(**new**), `apps/api/scripts/verify-compiled-auth.mjs`, `scripts/triage-vulnerabilities.mjs`
(per-advisory `next`, postcss rule, toolchain rule, two classifier fixes), `scripts/verify-docker-images.mjs`
(+1 image-level check), `scripts/mutate-container-gate.mjs` (+M7, disk reporting, signal restore,
maxBuffer), `scripts/verify-ci-parity.mjs` (+1 required gate), `.github/workflows/ci.yml` (+1 step, and the two
defect fixes above), `apps/api/package.json` (+1 script).

---

## 13. Findings intentionally deferred, with the reason

- **D-1** — accepted by design; closing it means a per-request database lookup or a revocation list,
  i.e. an architecture change that trades a bounded 15-minute window for a per-request dependency.
  The window is now pinned by a test and enforced at verification.
- **D-3** — mounting it would add live surface; deleting it is a product decision about Phase 7.
  Pinned by a 404 test made with an otherwise fully authorised request.
- **D-5** — not reachable; no multer-backed interceptor exists. Fixing would need a resolution
  override for a framework transitive, with no reachable exposure.
- **D-6** — not reachable now, and a Next 15 upgrade is a product change to a framework the product
  is built on, to be scheduled rather than smuggled into a findings-closure phase. Re-checked
  automatically, and the new rules are negative-tested.
- **D-7** — build-time only; upgrades are owned by `@nestjs/cli`/`expo`, are major-version changes,
  and would alter the lockfile for no reachable exposure.
- **D-8** — enforcement proven at every artifact-producing path; the residual is a developer's local
  install, and both remedies are out of scope.
- **D-9** — the peak is not reduced by default because the only available mechanism (cache pruning)
  makes the harness network-dependent. Reporting and an opt-in flag ship instead.

---

## 14. Tests executed

All on this machine, against a **throwaway** PostgreSQL container (`ecc-p24-pg`, database
`ecc_p24`, user `p24`, port 55440). The developer `ecc` database was never contacted.

| Lane | Result |
|---|---|
| API unit (`pnpm --filter @ecc/api test`) | **145 passed, 44 skipped** (189 collected) — 139 passed pre-edit, +6 from Phase 24 |
| API integration (`test:integration`, real PostgreSQL) | **126 passed** (7 files) |
| API all with DB (`test:all`) | **315 passed** (26 files) |
| API no-DB / CI shape (`test:all`, no `DATABASE_URL`) | **145 passed, 170 skipped** |
| Mobile | **32 passed** (6 files) |
| Web | **1 passed** |
| API typecheck | clean (3 projects) |
| Root `pnpm typecheck` | clean (turbo, 11 tasks) |
| Root `pnpm build` | clean (7/7 tasks) |
| `build:verify` (API build determinism) | **PASS** — clean, warm and stale-tsbuildinfo builds each emitted the entry point; 272 files, 0 spec/test files |
| API lint | **55 errors, 69 warnings** — exactly the Phase 22/23 baseline, unchanged |
| `git diff --check` | clean |

The four new integration tests: a valid feed PATCH is accepted (control), a PATCH with a smuggled
`userId`/`authorUserId` is refused with 400 **and** the post is unchanged in the database, a PATCH
with an undeclared property is refused, and a PATCH is refused for an invalid enum, a too-short body,
a non-string body, a non-UUID `relatedEntityId` and a non-string `kind`.

### Security gates

| Gate | Result |
|---|---|
| `verify:metadata` (decorator-metadata parity, compiled) | PASS — 68 source files, 212 typed parameters, 61 class-typed params (all value imports), 0 `Function` entries, 58 identity checks |
| `verify:auth:compiled` (full auth surface, built artifact, one production process per mode) | **all checks PASS** — liveness, readiness, a 2 MB body accepted, a 42 MB body → 413, no disclosure, the shared-signing-secret precondition, and all four modes (core, session, lockout, account) with their 13 token-defect cases each |
| `verify:routes` (authorization structure) | PASS — 57 live routes, 8 documented public, `CareTaskController` reported unreachable |
| `verify:config-contract` | PASS |
| `verify-env-contract` | PASS |
| `verify-dependency-audit` | PASS — lockfile-pinned, native modules load, argon2 computes |
| `triage-vulnerabilities` | PASS — 48 critical/high → 30 BUILD-TIME, 18 NOT REACHABLE, **0 reachable** |
| `verify-release-artifact` | PASS — 272 files, two clean builds byte-identical, web standalone 2969 files, no baked secret, `NEXT_PUBLIC_API_URL` not baked |
| `verify-db-migrations` (throwaway databases) | **15/15 PASS**, 0 FAIL — status on an empty database reports pending, `migrate deploy`, status after deploy, a repeated deploy applies zero migrations, a second empty database migrates identically, no unannotated destructive statement, enum migrations use the shadow-type idiom, the app boots and completes an authenticated round trip against the fresh schema |
| `verify-ci-parity` | PASS — **36 commands executed in workflow order, 0 failed**, 2 advisory (the two pre-existing lint baselines, real counts reported); 39 of 42 are locally runnable and 3 need the remote runner. Every gate is wired into the workflow, and the step this phase adds (`verify:lifetime:mutate`) is both present in `ci.yml` and *required* by the parity gate, so it cannot be deleted from CI without failing. The three "remote" steps were then run by hand against a CI-shaped throwaway database — see below. |
| container gate `verify-docker-images` | **57/57 PASS** (56 pre-existing + 1 new) |

---

## 15. Mutation testing

| Harness | Mutants | Result |
|---|---|---|
| `verify:metadata:mutate` | 2 (Phase 23) | **2/2 detected** |
| `verify:routes:mutate` | 5 (M1–M3 Phase 23, **M4–M5 new, D-4**) | **5/5 detected** |
| `verify:lifetime:mutate` (**new**, D-2) | 2 | **2/2 detected** |
| `mutate-config-contract` | 8 (Phase 23) | **8/8 detected** |
| `mutate-container-gate` | 7 (M1–M6 Phase 23, **M7 new, D-2**) | see §16 |
| negative tests of the new triage rules | 4 planted features | **4/4 turned the gate red** |

**D-4, new mutants.** M4 reverts the feed PATCH to `Partial<CreateFamilyUpdateDto>`; M5 reverts the
preference PATCH to an inline type literal. Both must be rejected by the new `verify:routes` rule.
Both were detected. M4 doubles as the cross-check on the hard-coded `RouteParamtypes.BODY` constant
the rule depends on: if that constant stopped identifying body parameters, M4 would go undetected.

**The D-4 gate rule found a false negative in itself, twice, and both are recorded.** First the rule
did not fire on either mutant; the metadata was being read from the method function, but
`@nestjs/common` 10 stores per-parameter metadata on the controller **class**, keyed by method name,
as a map whose keys are `"<paramtype>:<index>"`. Fixed, and both mutants detected. This is the third
time in this project that a check which could not distinguish "rejected for the right reason" from
"rejected for an unrelated reason" has turned out to be the defect.

**D-2, new harness.** `mutate-token-lifetime.mjs` applies two mutants to the source and requires the
guard's suite to fail: M1 deletes the `maxAge` line, M2 raises the lifetime to 24 hours. Both are
detected. M2 is the interesting one — it is the realistic regression ("temporarily increased for
debugging"), and it changes issuance and verification together so nothing looks inconsistent.

**And the D-2 harness found a false negative in my own tests.** M2 passed the suite on the first
attempt. The cause: every test in the block compared the bound against
`ACCESS_TOKEN_TTL_SECONDS` — the same constant the production code uses — so raising it moved the
tests with it. The tests were self-referential and proved nothing about the *value*. A policy
sentinel asserting the literal `15 * 60` was added, with a comment recording that 900 is the number
quoted as D-1's accepted residual risk, so the number is a deliberate edit rather than a silent one.
The same self-reference was removed from the D-1 e2e test.

**D-2 at image level (M7).** The container gate gained a check that mints two tokens with the real
secret against the running image: a fresh one (must be accepted) and a one-hour-old one with a
ten-year `exp` (must be refused). Mutant M7 removes `maxAge` from the guard, rebuilds the image
`--no-cache`, and requires that check to fail. It did — and it was the *first* reported failure,
which is what "fails on the check this mutant targets" should look like.

---

## 16. Regression results

| Item | Result |
|---|---|
| Full baseline | all lanes green — see §14 |
| Typecheck | clean (API 3 projects, root turbo 11 tasks) |
| Build | clean; `build:verify` PASS |
| Lint | 55 errors / 69 warnings — unchanged. An intermediate state measured 56/73; the extra error (a `no-unexpected-multiline` in the new D-3 test) and the extra warnings (import ordering on the lines I added) were fixed, not waived. |
| `git diff --check` | clean |
| Lockfile | **unchanged** — no dependency added, removed or upgraded |
| `verify-db-migrations` | see below |
| Container gate | 57/57 PASS against images built from this tree |
| Container mutation | 7 mutants: **7/7 detected** across two runs (M1, M5, M6, M7 in the first; M2, M3, M4 in the re-run), each failing on the check it targets |

### Database verification

Every database test used the throwaway container `ecc-p24-pg` (database `ecc_p24`, port 55440),
created for this phase and destroyed at the end. The developer `ecc` database was never used. One
operational note: the migration gate (`scripts/verify-db-migrations.sh`) creates its own container on
host port **55433**, which collided with the throwaway database I had chosen; mine was moved to 55440
and the gate re-run.

### Container verification

| Step | Result |
|---|---|
| Full build + runtime gate, images built from this tree | **57/57 PASS**, 0 FAIL |
| The three workflow steps CI-parity cannot run locally, run by hand against a CI-shaped throwaway PostgreSQL on port 5432 (`ecc`/`ecc-ci-secret`/`ecc_ci`, migrated) | all three pass — after the two fixes in §12; before them, one failed outright and one asserted nothing |
| `--skip-build` re-run against the same images | 55 PASS, 0 FAIL (the 2 build checks are skipped by design) |
| Container mutation, 7 mutants | see below |

**Container mutation run, in full, because two entries are not "detected":**

| Mutant | Outcome |
|---|---|
| M1 body-parser limit → 100 KB | detected, on the targeted check |
| M2 password policy → quadratic regex | **not run** — the anchor was absent because an earlier *killed* run of this same harness had left M2's mutation in the working tree (§11). Re-run after restoring the source: see below. |
| M3 error boundary disabled | gate exited non-zero, but the targeted check was **not** among the reported failures, so detection is **inconclusive** |
| M4 rate limiter disarmed | gate exited non-zero, targeted check not among the reported failures — **inconclusive** |
| M5 storage mode → 0644 | detected |
| M6 image runs as root | detected |
| M7 `maxAge` removed (new, D-2) | detected, as the first reported failure |
| Restored repository | gate passes again (55 checks) |

M3 and M4 being *inconclusive* rather than *detected* is the honest reading: the gate did fail, but
the harness could not show it failed for the reason the mutant claims, and the gate printed no
individual `FAIL` line to attribute it to. That is a gap in the evidence, not a pass, and it is
recorded as such rather than counted. The harness now prints the gate's own output in exactly this
case (§11), and M2/M3/M4 were re-run — result in §18.

---

## 17. Security regression status

Every Phase 16–23 control was re-verified in this phase; none was weakened, relaxed or made
conditional.

- **Authentication**: HS256 pinning, mandatory `sub`, production fail-fast on the signing secret,
  refresh rotation, reuse detection with family revocation, logout, lockout, inactive/deleted checks
  at login and refresh, `/auth/me` liveness re-check, cookie flags — all intact. One control was
  **added** (`maxAge`). The rate limiter is unchanged and the container gate still proves it is armed
  in the image; the test-only bypass remains inert outside `NODE_ENV=test`, and no test-only path was
  introduced into production code.
- **Authorization**: 57 live routes, every non-public one carrying `JwtAuthGuard`; the 34-case
  behavioural matrix passes, including the 8 boundary groups; D-1's gap is still asserted explicitly
  so it cannot close or widen silently.
- **Input validation**: the strict `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`) is unchanged, and now actually reaches every mounted body-carrying route (§6).
- **Error boundaries, body limits, password policy, storage modes, non-root containers, artifact
  hygiene, CI parity** — all re-verified green, see §14.

**Two CI gates were not asserting what they claimed, and both were found only by running the steps
rather than reading them** (§12). Neither is a weakness in the product: the fail-closed control
works, and the round-trip step now proves it. The significance is that a *green* CI badge would have
meant one of those controls was untested, and the other step would have failed on its first remote
run for a reason unrelated to the product.

**One regression this phase caused and then fixed:** the D-2 fix broke the compiled-auth harness,
which minted its test tokens with no `iat` and therefore relied on a token shape the application can
no longer issue — the SUPER_ADMIN-claim assertions failed. The harness was wrong, not the control;
every self-signed token there now carries an `iat`, and a new negative case asserts that a token
*without* one is refused, so the suite states the reason for each refusal rather than passing on a
coincidence.

---

## 18. Known limitations

- **M3 and M4 of the container mutation harness were inconclusive in the recorded run.** See §16 and
  the re-run below. They are not counted as detections.
- **`pnpm audit` is a moving input.** 48 critical/high today; the set changes without any change to
  this repository. Every advisory number in this document is a snapshot with a date, not an
  invariant, and the triage gate must be re-run at release time.
- **GitHub Actions has still never been executed.** Every workflow command was run locally, and the
  three steps the parity gate cannot run were run by hand against a CI-shaped throwaway database —
  which is how the two gate defects in §12 were found. The hosted runner, its service containers, its
  action versions and its timeouts remain unverified. A step executing correctly here is not the
  same claim as a green remote run.
- **No load, performance or penetration testing** was done, and nothing here replaces it.
- **The authorisation matrix is behavioural, not exhaustive.** It covers every boundary this phase
  identified; the structural gate covers guard *attachment* across all 57 live routes.
- **`ACCESS_TOKEN_TTL_SECONDS` is not configurable.** That is deliberate — a configurable token
  lifetime is how "unbounded" arrives — but it does mean the lifetime is a code change, not an
  operational one.
- **Clock skew**: the lifetime bound is measured against the issuer's clock (§4).
- **The postcss and Expo-toolchain reachability arguments are static arguments about code paths**,
  not proof of absence. Both are checks that fail closed when the code changes, which is the strongest
  available form of that claim short of a running exploit.
- **The D-6 deferral is fragile by construction**: "not reachable" rests on the app declaring no
  Server Actions, middleware, rewrites or image optimization.

---

## 19. Out-of-scope work

Not started, not attempted, not partially built: deployment; Kubernetes, Terraform, Helm; AWS or any
cloud; managed databases; monitoring; WebSockets, realtime, push/SMS/email providers; AI/LLM, OCR;
EHR integration; GPS; payments; Redis migration; MinIO/S3 migration; backup infrastructure; dashboard
redesign; mobile feature work; a Next.js major upgrade; any Prisma schema or migration change; any
modification of `PROJECT_PLAN.md`, `PROJECT_PLAN-old.md` or `SECURITY_REVIEW_*`; any commit, push,
amend, reset, rebase or stash.

---

## 20. Final disposition matrix

| Finding | Current state | Action | Reason | Tests/evidence |
|---|---|---|---|---|
| **D-1** deactivated-token window | Present; bounded at 15 min by issuance **and** now by verification; refresh refused; `/auth/me` re-reads the user | **DEFER** | Closing it means a per-request DB lookup or revocation list — an architecture change trading a bounded window for a per-request dependency. Window is now pinned and enforced, not assumed. | `auth-session.lifecycle.e2e-spec.ts` +1 (asserts `exp - iat === 900` against a literal; a wider lifetime fails); existing matrix D-1 assertion; `verify:lifetime:mutate` M2 detects a 24 h lifetime; container gate M7 |
| **D-2** unbounded token lifetime | **Closed.** Issuance bounded in 3 places from one constant; verification now bounded by `maxAge`; tokens without `iat` refused | **FIX** | The defect was that the verifier trusted `exp` alone; `min(exp, iat+TTL)` removes that, and makes D-1's window a property of verification. No auth architecture changed. | 5 new guard cases incl. real-`JwtService` boundary cases; `mutate-token-lifetime.mjs` 2/2; compiled-auth D-2 block rewritten (fresh accepted, 1 h-old refused); container-gate check + mutant M7 detected as the first failure |
| **D-3** unmounted `CareTaskController` | Present: compiled, guarded, unregistered; 5 Phase 7 placeholder handlers | **DEFER** | Mounting adds live surface; deleting is a product decision. Excluding it from the build changes the artifact for no security gain. | `verify:routes` reports it unreachable; new matrix test asserts 404 for a *fully authorised* request (401 would prove nothing) |
| **D-4** DTO-less routes | **One real defect found and fixed** (`PATCH /feed/:id` bound to `Object` via `Partial<>`, so entirely unvalidated; same on `PATCH /notification-preferences`). Phase 23's two named routes re-classified: `POST /conversations` is intentionally body-less | **FIX** | A `Partial<DTO>` or inline literal erases the runtime type, `Object` is on Nest's skip-list, and the global whitelist silently did not apply. Both Phase 23 gates passed on that build. | Compiled-artifact evidence of `Object` metatypes; 2 new DTOs; 4 new e2e tests (1 control + 3 negative) incl. DB assertion of no mutation; new `verify:routes` rule with M4/M5, 5/5 total |
| **D-5** multer DoS | Present in the dependency graph; a **production** transitive of `@nestjs/platform-express`; no interceptor exists; multipart refused in the image | **DEFER** | No reachable code path. Fixing needs a resolution override for a framework transitive with no exposure to fix. | Triage rule greps for every multer-backed interceptor and flips to REACHABLE if one appears; container gate multipart probes |
| **D-6** next critical RCE | `next@14.2.35`; 10 critical/high advisories; none reachable — no Server Functions (`server-reference-manifest.json` is empty), no image optimizer, no middleware, no rewrites, no WebSocket, no custom server, no i18n, no CSP nonces; not Windows | **DEFER** | A 14 → 15 major upgrade of the web framework is product work, not a findings fix, and would invalidate the web evidence gathered here. Fragile-but-checked: the gate re-derives reachability on every run. | Per-advisory rules replacing one blanket rule; **4 planted-feature negative tests all turned the gate red**; one false green in the new rule found and fixed (stale manifest masking live source) |
| **D-7** devDependency advisories | 36 build-time; 2 `postcss` high reach production through `next` but not the runtime; two classifier defects found and fixed (workspace importer decoding; first-finding-only) | **DEFER** | No upgrade: vitest 2 → 3 is a major runner change, the rest are owned by `@nestjs/cli`/`expo` and need overrides plus a lockfile change, for zero reachable exposure. Nothing suppressed; an uncovered advisory now fails the gate. | `pnpm audit` re-run: 48 crit/high → 30 BUILD-TIME / 18 NOT REACHABLE / 0 reachable; `postcss` decided by checking that **no** module under `next/dist/server` in the shipped tree references it; lockfile byte-identical |
| **D-8** frozen-lockfile not hook-enforced | Unenforced only for a developer's local install; enforced at all four artifact-producing paths | **DEFER** | Proved by introducing drift, not by reading. Both remedies are out of scope: a hook needs a new devDependency and a lockfile change; `.npmrc` would break `pnpm add`. A hooks path nobody opts into is not enforcement. | Drift test: `pnpm install --frozen-lockfile` exit 1; the exact Dockerfile install layer exit 1 in a throwaway container; `verify-dependency-audit` exit 1; all restored, audit green |
| **D-9** container-mutant disk cost | Cause structural (`--no-cache` per mutant); peak not reduced by default | **DEFER (bounded improvement)** | Pruning the build cache also drops pnpm's store: measured, it forces ~660 packages to be re-downloaded per mutant and failed a build. Trading disk for a network-dependent harness is worse. Reporting + warning + opt-in flag ship instead. | Free space reported per mutant (peaked at ~10 GB free); warning fired at the 20 GB floor; two harness defects fixed (interrupted runs leaving mutants in the tree; `spawnSync` 1 MB default buffer killing `docker build`) |

**Totals: 2 findings fixed (D-2, D-4), 0 obsolete, 7 deferred (D-1, D-3, D-5, D-6, D-7, D-8, D-9), 0
dependency upgrades, 0 Prisma changes, 0 authentication architecture changes, 0 weakened controls.**

**Beyond the nine findings**, three items were found that were needed to evaluate them honestly, and
all three were gates rather than product defects: a compiled-artifact rule that had a false negative
in its first form (the D-4 rule), a dependency classifier that under-reported production paths and
read only one finding per advisory (D-6/D-7), and two CI workflow steps that could not test their own
claims (§12). Each is described where it is fixed, with the before/after evidence.

### Re-run of the three inconclusive container mutants

Run after restoring `password-policy.ts` and after adding gate-output capture to the harness, with
`--only M2,M3,M4`, with no other harness running:

| Mutant | Outcome | Failures reported by the gate |
|---|---|---|
| M2 password policy → quadratic regex | **detected** | The password-policy check, first among the failures |
| M3 error boundary disabled | **detected** | Exactly one: "a malformed identifier in a path is 400, not a 500" |
| M4 rate limiter disarmed | **detected** | Exactly one: "the rate limiter is enforced in the image" |
| Restored repository | gate passes again (55 checks) | — |

So M2, M3 and M4 are detected, and the harness ends with `The container gate detects every defect
these mutants represent` — **7/7 across the two runs**. M3 and M4 failing *only* their targeted check
is the strongest form of the result: it rules out a pass for an unrelated reason, which is what the
first run could not show.

The first run's inconclusive entries were caused by my own operating error, not by a gate defect: two
harness instances were running concurrently (one of them a tool-timed-out invocation that kept
running), so their child gate runs collided over the gate's fixed container names, and one of them
was killed mid-mutant, which is what removed M2's anchor. Recorded because the tempting reading —
"the gate is flaky" — is wrong, and the difference between an environmental collision and a
decorative gate is exactly what this project's methodology exists to catch.

