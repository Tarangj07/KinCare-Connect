# Phase 25 — Final Report

Adversarial re-review of the Phase 24 work, plus closure of the five findings
the Phase 24 independent review raised (F-1, F-4, F-2, F-3, F-5).

- **HEAD at start and at end:** `d0cd0dd2f175ae881bd201eb26d7e74a0c4158be` (unchanged)
- **Commits / pushes / amends / resets / rebases / stashes:** none
- **Phase 26 or later work:** none started
- **Database used:** throwaway only (`ecc_p25` in a disposable `postgres:16-alpine`
  container on `127.0.0.1:55433`, plus the migration gate's own disposable
  containers). The developer `ecc` database was never targeted.

---

## A. Scope

Exactly the five findings, nothing else.

| Finding | Severity | What it claimed | Status |
|---|---|---|---|
| F-1 | MEDIUM | A future-dated `iat` defeats the Phase 24 (D-2) access-token bound | **Confirmed**, fixed, proved live |
| F-4 | MEDIUM | The D-6 `rewrites` triage rule reads the config as text and misses the supported form | **Confirmed**, fixed, mutation-tested |
| F-2 | LOW | The compiled-artifact DTO gate checks metatype, not validation | **Confirmed**, fixed, mutation-tested |
| F-3 | LOW | Keyed `@Body('field')` escapes DTO coverage | **Confirmed** (5 live instances), fixed, mutation-tested |
| F-5 | LOW | The dependency classifier's generic fallback fails open | **Confirmed**, fixed, mutation-tested |

The reviewer was right on all five. None was a false alarm, and none was
mitigated by an existing control.

Two further defects were found *while making the gates provable* and were
fixed because the required verification is impossible without them. Both are
recorded in full below (§F-2.4 and §F-4.5); neither expands product scope.

No dependency was upgraded. No Prisma schema or migration was changed. No
authentication design was redesigned. No product feature was added. No mobile
functionality was modified. No Docker architecture was changed. No cloud,
Kubernetes, Terraform, Helm, Redis, MinIO, S3, monitoring, WebSocket, realtime
or AI/LLM/OCR work was started.

---

## B. F-1 — FUTURE-DATED `iat` DEFEATS THE D-2 BOUND

### B.1 Reproduced before the fix

**Against the compiled artifact** (`apps/api/dist/auth/guards/auth.guard.js`),
loading the real `JwtAuthGuard` and driving `canActivate`:

```
  ACCEPTED  normal token (iat=now, exp=now+15m)
  REJECTED  old token (iat=now-3600, exp=now+10y)  (Access token invalid or expired.)
  ACCEPTED  FUTURE iat +5m, exp=now+5m
  ACCEPTED  FUTURE iat+10y AND FUTURE exp+10y
  ACCEPTED  FUTURE iat+10y, no exp
```

**Against a live `NODE_ENV=production` process** (`dist/main.js`, real
PostgreSQL, real `JwtAuthGuard`, real `ValidationPipe`, real rate limiter),
registering a real user, logging in, and re-signing its access token with the
production secret:

```
register -> HTTP 201
login    -> HTTP 200, real sub=6259b19a-6994-4d96-aca4-af094e3779d0

  HTTP 200  normal token (iat=now, exp=now+15m)  <-- ACCEPTED
  HTTP 401  old token (iat=now-1h, exp=now+10y)
  HTTP 200  FUTURE iat +5m, exp=now+5m           <-- ACCEPTED
  HTTP 200  FUTURE iat+10y AND FUTURE exp+10y    <-- ACCEPTED
  HTTP 200  FUTURE iat+10y, no exp at all        <-- ACCEPTED
```

The reviewer is also right that this needs the signing secret, so it is
defense-in-depth rather than a new unauthenticated exposure. It is not
harmless, though: the Phase 24 report stated "effective validity is
`min(exp, iat + 15m)`" as the accepted residual risk behind deferred D-1, and
that claim was false for exactly the tokens the bound was added to constrain.

### B.2 Root cause

`jsonwebtoken@9.0.3` evaluates `maxAge` as (`verify.js:242`):

```js
const maxAgeTimestamp = timespan(options.maxAge, payload.iat);  // iat + maxAge
if (clockTimestamp >= maxAgeTimestamp + (options.clockTolerance || 0)) { ... }
```

`maxAge` is therefore an **upper bound on validity only if `iat` is not itself
in the future**. For a future-dated `iat`, `maxAgeTimestamp` is in the future
and the inequality is false for its whole duration — for ten years, if `iat` is
ten years out.

There is no option for this. The library offers `clockTolerance`, which only
*widens* `exp` and `nbf`; it cannot create a future-`iat` bound. The check
therefore has to be the application's, and the Phase 24 work added none.

`verify.js:238` also shows a second, latent path: a token carrying no `exp` at
all is never expiry-checked, and a future `iat` with no `exp` is accepted
indefinitely. Reproduced above.

### B.3 Fix

One shared rule, in `apps/api/src/config/security-config.ts` next to the
lifetime constant it complements — the same place `ACCESS_TOKEN_TTL_SECONDS`
already lives, so issuance and verification cannot drift:

```ts
export const ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS = 5;

export function isAccessTokenIssuedInThePast(
  iat: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false;
  return iat <= nowSeconds + ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS;
}
```

and one call site, in `JwtAuthGuard.canActivate` immediately after
`verifyAsync`:

```ts
if (!isAccessTokenIssuedInThePast(payload.iat)) {
  throw new UnauthorizedException('Access token invalid or expired.');
}
```

The 5-second window is a constant, for the same reason the lifetime is: token
lifetime and clock tolerance are security policy, not deployment knobs. It is
wide enough for ordinary clock jitter between the instances that mint and the
instances that verify, and small enough that the extra life it buys is
negligible next to the 15-minute lifetime.

**Nothing else changed.** The `maxAge: ACCESS_TOKEN_TTL_SECONDS` bound, the
`algorithms: ['HS256']` pin, the `sub` identity guarantee, the signature check,
the signing secret, the rate limiter, refresh rotation and reuse detection,
lockout, and the inactive/deleted-account checks are all untouched.

### B.4 Tests added

`apps/api/src/auth/guards/auth.guard.spec.ts` — a new `describe` block
(9 cases) plus 1 case added to the mocked-verifier block. Every case signs a
real token with the real secret through the real `jsonwebtoken` verifier, or
builds a correctly-signed HS256 token by hand with `createHmac` (the whole
point of the attack is tokens the normal signer would not produce):

| Case | Expected |
|---|---|
| the tolerated future-`iat` window is 5 seconds (literal, not self-referential) | assertion |
| normal token (`iat = now`) | 200 |
| old token beyond the allowed age (`iat = now − 16m`, `exp` ten years out) | 401 |
| future `iat` five minutes ahead, `exp` still in the future | 401 |
| **future `iat` + future `exp` ten years out** (the review payload) | 401 |
| future `iat` with **no `exp` at all** | 401 |
| future `iat` just past the tolerated window | 401 |
| `iat` inside the tolerated window (`now + 2`) | 200 |
| hand-crafted non-numeric `iat` (a string) | 401 |
| hand-crafted `iat: Infinity` / `NaN` / `null` | 401 |
| the predicate itself, over a fixed `now` | unit |
| mocked-verifier case: `verifyAsync` resolving a future-dated payload | 401 |

**Honest note on two cases.** The non-numeric-`iat` and
`Infinity`/`NaN`/`null` cases pass **with the guard's check removed as well** —
`jsonwebtoken`'s own `maxAge` branch already refuses them
(`verify.js:238`: `if (typeof payload.iat !== 'number') return error`). They
are kept because they are regression tests on a library behaviour the fix must
not depend on, not because the F-1 control is what stops them. The five cases
that *do* require the new control are the future-`iat` ones, and those are
listed separately in §B.5.

The compiled-auth suite (`apps/api/scripts/verify-compiled-auth.mjs`) gains
three live cases in `core` mode, run against the built artifact in a
production process: future `iat` +5m → 401, future `iat` + `exp` ten years out
→ 401, and — last, so it cannot be satisfied by a verifier that refuses
everything — an ordinary fresh token → 200. These use a **throwing** assertion
rather than the harness's recording `assert`, because that helper keeps running
after a failure and a later `ok` line then prints the opposite of what happened.

### B.5 Mutation testing

`apps/api/scripts/mutate-token-lifetime.mjs` gains **M3** and **M4**, applied
to the live source files the guard imports (not a copy, not an unloaded
module) and run against `auth.guard.spec.ts`:

| Mutant | Result |
|---|---|
| M1 — `maxAge` removed from `verifyAsync` (pre-existing) | **detected** |
| M2 — lifetime raised 15m → 24h (pre-existing) | **detected** |
| **M3 — the future-`iat` check deleted from the guard** | **detected — 5 tests fail** |
| **M4 — the window widened 5s → 1h** | **detected** |
| restored repository | **suite passes again** |

M3's raw failure, captured before the permanent tests existed:

```
× rejects a verified token whose `iat` is in the future, even from a stubbed verifier
× refuses a future `iat` (5 minutes ahead) whose `exp` is still in the future
× refuses a future `iat` AND a future `exp` ten years out — the Phase 25 review payload
× refuses a future `iat` even when the token carries no `exp` at all
× refuses a future `iat` that is only just past the tolerated window
      Tests  5 failed | 19 passed (24)
```

**A mutation against the COMPILED artifact**, because the unit suite alone only
proves the source. The check was deleted from
`dist/auth/guards/auth.guard.js`, a fresh production process was booted against
it, and the harness was run:

```
  ok    a ten-year-exp token issued now is accepted (validity is bounded by its age, not its exp)
  ok    a one-hour-old token with a ten-year exp -> 401 (D-2 closed: lifetime is bounded)
Error: a correctly signed token whose `iat` is five minutes in the future was accepted;
  jsonwebtoken's `maxAge` defers to `iat + TTL`, so a future-dated `iat` unbounds the access
  token again. This is Phase 25 finding F-1 reopening. (HTTP 200, expected 401)
EXIT=1
```

`dist` was then restored by a clean rebuild and the full suite re-run green.

### B.6 Live production verification, after the fix

A fresh `NODE_ENV=production` process on the final build, real PostgreSQL:

```
register -> HTTP 201
login    -> HTTP 200, real sub=6259b19a-6994-4d96-aca4-af094e3779d0

  HTTP 200  normal token (iat=now, exp=now+15m)  <-- ACCEPTED
  HTTP 401  old token (iat=now-1h, exp=now+10y)
  HTTP 401  FUTURE iat +5m, exp=now+5m
  HTTP 401  FUTURE iat+10y AND FUTURE exp+10y
  HTTP 401  FUTURE iat+10y, no exp at all
```

And no existing JWT control was weakened, checked against the same live
process:

```
  OK   HTTP 401  signature: HS384 with the REAL secret -> refused
  OK   HTTP 401  signature: HS512 with the REAL secret -> refused
  OK   HTTP 401  signature: alg=none -> refused
  OK   HTTP 401  secret: signed with the WRONG secret -> refused
  OK   HTTP 401  sub: empty string -> refused
  OK   HTTP 401  sub: absent -> refused
  OK   HTTP 401  sub: object -> refused
  OK   HTTP 401  exp: already past -> refused
  OK   HTTP 401  iat: absent (noTimestamp) -> refused
  OK   HTTP 200  baseline: ordinary fresh token -> ACCEPTED

rate limiter: 401 401 403 403 403 403 403 403 403 403 403 403 403   (engaged, never disabled)
```

---

## C. F-4 — THE NEXT.JS `rewrites` TRIAGE RULE IS WRONG

### C.1 Reproduced before the fix

`async rewrites() { return [{ source: '/api-proxy/:path*', destination: 'http://attacker.invalid/:path*' }] }`
planted in the real `apps/web/next.config.mjs`, then the real triage script
run:

```
    [critical] next@14.2.35
      Next.js: ... open redirect via rewrites ...
      evidence: this advisory requires the rewrites, which the web app does not have:
        next.config.mjs declares no `rewrites` and no `redirects`, so no request is ever
        re-dispatched to an attacker-chosen destination.
EXIT=0
```

The gate was green, on a config that re-dispatches requests to an
attacker-chosen destination. The planted rewrite was removed and the file
restored byte-for-byte afterwards (asserted by the mutation harness in §C.5).

### C.2 Root cause

The rule was a regex over the config file's **text**:

```js
const config = /\brewrites\s*:/.test(readIfPresent(webNextConfig));
```

`rewrites` in Next.js is a **function** on the exported config that returns the
rule array, not an object property. The supported forms are all missed:

```js
{ async rewrites() { return [...] } }              // the documented form
{ rewrites: async () => [...] }                     // equivalent
{ rewrites: async function () { return [...] } }
export default async (phase, {defaultConfig}) => { return { rewrites() {...} } }
```

The same weakness applied to the sibling `images` and `i18n` rules, which used
the same shape of regex, and in the opposite direction: those regexes also
fire on the word inside a comment or a string, and on an unrelated object's
`images:` property.

### C.3 Fix

A new shared AST analyser, `scripts/lib/next-config-features.mjs` (265 lines).
The TypeScript compiler is already a repository devDependency and parses
JavaScript directly, so there is no new parser dependency — and the config is
never *evaluated*, because evaluating it would import arbitrary third-party
code into a security gate.

It resolves the exported config object through every form Next.js accepts
(object literal, identifier alias, `export default function`, arrow with a
block body, arrow with a concise body, `Object.assign`, `module.exports`), then
reads that object's **own top-level** keys. It answers three questions, and
the third is what keeps it honest: if the config has a shape it cannot read,
or declares `plugins` (a list of functions that may inject any key), it returns
`analysable: false`, and every rule that consults it treats the feature as
**present**. "I could not check this" is a finding, not a dismissal — the same
rule the triage script already applies to an advisory it has no rule for.

`scripts/triage-vulnerabilities.mjs` now routes the `rewrites`, `redirects`,
`image optimization` and `i18n` rules through it, each stating its evidence
from what the analyser actually read. A new `redirects` rule was added because
the old `rewrites` evidence sentence claimed "no `rewrites` **and no
`redirects`**" while never checking `redirects` at all.

### C.4 Tests added

`scripts/verify-next-config-features.mjs` (215 lines) — 27 assertions in
fixtures, deliberately split into a *detection* family and a *no-false-positive*
family, because a suite with only one of them is a comment with a test runner
around it.

- **Detection** — all eight `rewrites` forms above, including the exact planted
  shape, inside the documented function-form config, and behind `Object.assign`.
- **No false positives** — a comment saying `` rewrites: ``, a string literal
  containing `rewrites:`, a `rewrites` key nested in an *unrelated* object, a
  key named `rewritesEnabled`, and the **real** `apps/web/next.config.mjs`.
- **Fail closed** — `plugins: [...]`, a spread of another module, a computed
  key, no export at all, an empty file, an export the analyser does not follow,
  and an assertion that a `plugins` config is reported unreadable *and* names
  the offending key.
- **The real config** — analysable, declares none of the triaged features, and
  was resolved through its `export default nextConfig` identifier alias.

The suite is not vacuously green: when the analyser was first written it failed
5 of its own assertions (a named default-export function was not followed, a
computed key was not detected, and the `form` label was wrong), and each was a
real gap that was fixed.

### C.5 Mutation testing

`scripts/mutate-next-config-rewrites.mjs` (194 lines) mutates the **real files**
— `apps/web/next.config.mjs` and the analyser — restores them, and re-runs the
real triage script (each run re-executes `pnpm audit`):

| Mutant | Expected | Result |
|---|---|---|
| M1 — a working `async rewrites()` **method** planted (the Phase 24 defect) | REACHABLE | **detected — verdict flipped** |
| M2 — `rewrites: async () => [...]` planted | REACHABLE | **detected — verdict flipped** |
| M3 — rewrite planted **and** the analyser neutered so it never reports a feature | NOT REACHABLE | **detected — a neutered analyser misses a planted rewrite, so the verdict comes from the analysis, not from the word** |
| restored repository | NOT REACHABLE | **detected — returns to NOT REACHABLE** |
| `next.config.mjs` restored byte-for-byte | exact | **asserted in the harness** |

M3's direction is deliberate. A rule reading text would survive M3 — the word
`rewrites` is still in the file and the rule is still present — so M3 is the
mutant that a substring-based test cannot see. Expecting M3 to report
NOT REACHABLE is what proves the verdict is structural.

### C.6 Two defects found while making the gate provable

**C.6.1 — `--json` output was silently truncated.** `triage-vulnerabilities.mjs`
ended with `process.exit(...)` immediately after a `console.log` of a ~146 KB
JSON report. To a pipe, `process.exit` tears the process down before the write
completes: a consumer received unterminated JSON, and `JSON.parse` failed. CI
only ever ran the human-readable form, so nothing was reading this output and
the bug was invisible until a gate had to assert on a verdict from it. Fixed
by setting `process.exitCode` from the write callback and letting node flush on
its own way out; the exit code still reflects reachability.

**C.6.2 — the Next-config surface is not fully provable.** A third-party
Next.js *plugin* can inject `rewrites` at load time and nothing in the config
text reveals it. Rather than claim otherwise, the analyser reports
`analysable: false` whenever `plugins` is declared, and the rules fail closed.
This is a deliberate over-report: it would produce a REACHABLE verdict for a
config this app does not have. See §K.

---

## D. F-2 — THE DTO GATE CHECKS METATYPE, NOT VALIDATION

### D.1 Reproduced before the fix

`LoginDto` stripped to two bare fields, project rebuilt, gate run:

```
export class LoginDto {
  // F-2 MUTATION: validation constraints stripped; the class survives as a metatype.
  email!: string;
  password!: string;
}
```

```
$ node scripts/verify-route-authorization.mjs
  ...
Every non-public live route is guarded; the public allow-list matches reality.
GATE_EXIT=0
```

Green. The route accepted any body shape at all. The reviewer is correct that
`metatype === DTO/class` is not evidence of validation. Source restored and
rebuilt.

### D.2 Root cause

The Phase 24 (D-4) rule asked *"is the body parameter's metatype a class
`ValidationPipe` will validate?"*. Both halves of that are necessary and
neither is sufficient: what the pipe actually runs is the metadata the
decorators registered at import time, and a class can carry none.

### D.3 Fix

`apps/api/scripts/verify-route-authorization.mjs` now reads
**class-validator's own metadata storage** — the same registry
`ValidationPipe` executes from, reached through the same module resolution so
there is only one registry:

```js
const classValidator = require_('class-validator');
const metadataStorage = classValidator.getMetadataStorage();
metadataStorage.getTargetValidationMetadatas(metatype, metatype, false)
```

Constraints of type `conditionalValidation` (`@IsOptional`, `@ValidateIf`) are
counted separately: they register metadata but enforce nothing on their own, so
a DTO whose properties carry *only* those is as unvalidated as one with no
metadata at all. The gate requires **at least one effective constraint** on
every whole-body DTO, and reports the effective-constraint and property counts
for every body route so the numbers are visible rather than asserted.

The counts are read from the artifact, not from source filenames or DTO naming
conventions, and inherited constraints count (the lookup walks the prototype
chain), so subclassed and nested DTOs work.

Every legitimate DTO passes with margin — the full report from the gate:

```
POST /api/v1/auth/register        @Body() -> `RegisterDto` (5 constraints on 3 properties)
POST /api/v1/auth/login           @Body() -> `LoginDto` (3 constraints on 2 properties)
POST .../documents                @Body() -> `UploadDocumentDto` (20 constraints on 6 properties)
POST .../medications              @Body() -> `CreateMedicationDto` (11 constraints on 9 properties)
PATCH .../appointments/:id        @Body() -> `UpdateAppointmentDto` (8 constraints on 8 properties)
POST .../emergency-alerts         @Body() -> `CreateEmergencyAlertDto` (6 constraints on 4 properties)
```

Optional fields, enums, arrays, nested objects and `Partial`-style update DTOs
(`UpdateFamilyUpdateDto`: 7 effective over 12 total, the difference being
`@IsOptional`/`@ValidateIf`) all remain valid. The global `ValidationPipe`
configuration is untouched.

### D.4 An additional hole found in the Phase 24 gate, and fixed

The three body rules sat **after** `if (publicReason) continue;`, so
`POST /auth/login` and `POST /auth/register` — the two routes an unauthenticated
caller reaches first, and the two with the richest DTOs — were exempt from
every body check. This is why the `LoginDto` mutation passed even after the
F-2 rule was written. Authentication and validation are separate questions: a
route may be public *and* still have to validate its body. The three body rules
now run for every mounted route; the guard rules still skip documented public
routes. With the public-route exemption in place, the mutated `LoginDto`
produced:

```
FAILED — 1 authorization-structure problem(s):
  - POST /api/v1/auth/login (AuthController.login) binds its body to `LoginDto` at
    parameter #0, and that class carries 0 validation constraint(s) in the built artefact
    — none at all. The metatype being a class is not a validation contract...
```

### D.5 Mutation testing

`apps/api/scripts/mutate-route-authorization.mjs` gains two mutants, built in a
scratch tree, compiled, and run through the real gate:

| Mutant | Result |
|---|---|
| **M6 — every validation decorator stripped from `LoginDto`** (the reviewer's mutation) | **detected — gate fails naming the 0-constraint DTO** |
| **M7 — a DTO reduced to `@IsOptional()` alone** (metadata still registered, nothing enforced) | **detected — gate fails naming the conditional-only constraints** |
| M1–M5 (pre-existing) | **still detected** |
| baseline | **gate passes on the unmodified repository** |

M7 exists because a gate that counted *metadata entries* rather than
*effective* constraints would pass it.

---

## E. F-3 — KEYED `@Body('field')` ESCAPES DTO COVERAGE

### E.1 Reproduced before the fix

Enumerating the compiled artifact the way the gate sees it:

```
  KEYED  auth.forgotPassword                    @Body('email')        index=0
  KEYED  auth.resetPassword                      @Body('newPassword')  index=1
  KEYED  auth.resetPassword                      @Body('token')        index=0
  KEYED  auth.verifyEmail                       @Body('token')        index=0
  KEYED  seniors/:seniorId/conversations.addParticipant  @Body('targetUserId')  index=2
  total keyed body parameters the current gate ignores: 5
```

### E.2 Root cause

`unvalidatedWholeBody()` had `if (arg?.data !== undefined) continue;` — it
returned `null` for every keyed binding, so the route looked like it had no
body input at all. The comment above it asserted that a keyed field "is a
deliberate, per-field choice"; nothing checked whether it was deliberate.

A keyed body parameter is genuinely different: Nest extracts the one property
from the request body *before* the DTO pipeline runs, so the whole-object
`whitelist` and `forbidNonWhitelisted` never see the rest of the object, and
the named field is validated only by whatever check the handler happens to
write.

### E.3 Audit and policy decision

All five instances, classified against the project's existing validation
contract:

| Route | Live? | Body used? | Disposition |
|---|---|---|---|
| `POST /auth/forgot-password` | yes | no (`_email`, constant response) | `@Public`, on the documented allow-list |
| `POST /auth/reset-password` | yes | no (`_token`, `_newPassword`) | `@Public`, on the documented allow-list |
| `POST /auth/verify-email` | yes | no (`_token`) | `@Public`, on the documented allow-list |
| `POST /seniors/:seniorId/conversations/:conversationId/participants` | **yes, guarded, state-changing** | **yes — `targetUserId` selects a participant to add** | **must be brought under the DTO contract** |

The first three are Phase 4 public stubs that ignore their input and return a
constant, on routes already exempted for a written reason. The fourth is the
real gap: a live, authenticated, state-changing route reading a body field with
no whitelist and no edge validation. Its only checks were
`typeof targetUserId !== 'string'` in the controller and a UUID regex in the
service — the right checks, in the wrong place, with the rest of the object
unwhitelisted.

**Policy adopted, stated so a reviewer can disagree with it:** a keyed
`@Body('field')` is permitted **only** on routes that are already on the
documented `PUBLIC_ROUTES` allow-list, where the body is a courtesy input and
the response is a constant. Every other route binds the body to a DTO. The
exemption is `PUBLIC_ROUTES` itself — not a second list — so it cannot be
widened by editing one more file, and every entry in it already carries a
written justification.

### E.4 Fix

**Gate** — `verify-route-authorization.mjs` now enumerates *every* body
parameter and reports any keyed binding on a route that is not on the public
allow-list:

```
FAILED — 1 authorization-structure problem(s):
  - POST /api/v1/seniors/:seniorId/conversations/:conversationId/participants
    (MessagingController.addParticipant) binds a KEYED body field `@Body('targetUserId')`
    at parameter #2. A keyed body parameter is taken out of the request body before
    ValidationPipe runs, so the rest of the object is never whitelisted and the named
    field is validated only by whatever check the handler writes itself...
```

**Application** — one handler, brought under the contract every other body
route already uses. New
`apps/api/src/modules/messaging/dto/add-participant.dto.ts`:

```ts
export class AddConversationParticipantDto {
  @IsString({ message: 'Target userId is required.' })
  @IsNotEmpty({ message: 'Target userId cannot be empty.' })
  @IsUUID('4', { message: 'Invalid UUID for userId.' })
  targetUserId!: string;
}
```

modelled on the existing `CreateAccessGrantDto`, which has the same field
semantics and message style. The controller now takes `@Body() dto:
AddConversationParticipantDto`. The UUID requirement is unchanged from what
`MessagingService.addParticipant` already enforced downstream; the change moves
it to the edge, where it also makes an unexpected property in the body a 400
rather than a silent no-op. The three Phase 4 public stubs are **not** touched.

This is the only production behaviour change in Phase 25, and it is the change
the security contract requires: the gate would otherwise have to be weakened
to accommodate a real gap.

### E.5 Mutation testing

| Mutant | Result |
|---|---|
| **M8 — a keyed `@Body('field')` introduced on a live route** (the pre-Phase-25 form of `addParticipant`, re-introduced on the documents controller so the check is not keyed to one file) | **detected — gate fails naming the keyed body field** |
| M1–M7 | **still detected** |
| baseline | **gate passes** |

---

## F. F-5 — THE DEPENDENCY TRIAGE FALLBACK FAILS OPEN

### F.1 Reproduced before the fix

The generic fallback was:

```js
verdict: devOnly ? 'BUILD-TIME' : 'REACHABLE (unclassified)'
```

`devOnly` means *"every path pnpm reported runs through a devDependency"*. That
is a statement about where the package is **installed**, not about whether the
vulnerable function is **invoked**. An advisory nobody had read was therefore
filed as build-time the moment its paths happened to be dev-only, and the
report called that a disposition. Proven by a fixture, driven through the real
classifier:

```
  FAIL  an unknown dev-only advisory is REACHABLE (unclassified), not BUILD-TIME
        verdict=BUILD-TIME
  FAIL  the gate exits non-zero for it
        status=0
```

The reviewer is right that this is latent: all twelve modules with
critical/high advisories today hit an explicit rule, and all 48 advisories
classified identically before and after the fix. A gate that is right by
accident is not a gate.

### F.2 Fix

`scripts/triage-vulnerabilities.mjs` now fails closed for any package with no
rule:

```js
const explicit = EXPLICIT_BUILD_TIME_PACKAGES.get(name);
if (explicit) { /* BUILD-TIME, with the recorded reason quoted in the evidence */ }

return { verdict: 'REACHABLE (unclassified)', /* …evidence explains why the
         dev/prod split is not a disposition… */ };
```

`EXPLICIT_BUILD_TIME_PACKAGES` is a `Map` of package → written reason and it is
**empty by design**. Every package that legitimately needs a BUILD-TIME verdict
without a full reachability rule has to say so, in writing, in that table.
That is what "fails closed" costs, and it is why the cost is worth paying.
The evidence for an unknown package now states the distinction explicitly:
*"says nothing about whether the vulnerable function is invoked — a build-time
tool with a remotely reachable entry point is exactly the case a raw dev/prod
split misses."*

A `--audit-file <path>` flag was added so the classifier can be exercised
against advisories that do not exist in this repository's dependency set
today. With no flag the real audit runs, so the production path is unchanged.

### F.3 Tests added

`scripts/verify-dependency-triage.mjs` (275 lines) drives the **real**
classifier through the real script — not a re-implementation — with hand-written
`pnpm audit --json` fixtures:

- an **unknown package reachable only through a devDependency** → REACHABLE
  (unclassified), with evidence explaining the distinction, gate exit 1
- an unknown package with production paths → REACHABLE (unclassified), exit 1
- **all twelve currently triaged packages** keep their exact prior verdicts
  (vitest/multer/next/postcss/tar/picomatch/glob/image-size/vite/xmldom/tmp/
  turbo-stream), using their real audit paths
- a `moderate` advisory is still out of scope for this triage
- an **unreadable**, a **missing** and a **flag-with-no-path** audit report all
  exit 2 rather than reporting success

### F.4 Mutation testing

Restoring the Phase 24 fallback (`verdict: devOnly ? 'BUILD-TIME' : …`) in the
live script:

```
  PASS  the fixture produced a classified row
  FAIL  an unknown dev-only advisory is REACHABLE (unclassified), not BUILD-TIME
        verdict=BUILD-TIME
  FAIL  the gate exits non-zero for it
        status=0
  ... all other assertions still PASS
EXIT=1
```

The known-package assertions stayed green under the mutation, which is the
point: the mutant changes only the uncovered case, and the suite catches
exactly that.

---

## G. Files changed

### Created (6)

| File | Lines | Finding |
|---|---|---|
| `apps/api/src/modules/messaging/dto/add-participant.dto.ts` | 26 | F-3 |
| `scripts/lib/next-config-features.mjs` | 265 | F-4 |
| `scripts/verify-next-config-features.mjs` | 215 | F-4 |
| `scripts/mutate-next-config-rewrites.mjs` | 194 | F-4 |
| `scripts/verify-dependency-triage.mjs` | 275 | F-5 |
| `docs/PHASE_25_FINAL_REPORT.md` | this file | — |

### Modified (10)

| File | Change |
|---|---|
| `apps/api/src/config/security-config.ts` | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` + `isAccessTokenIssuedInThePast()` (F-1) |
| `apps/api/src/auth/guards/auth.guard.ts` | the future-`iat` check, one call site, `iat` on the payload type (F-1) |
| `apps/api/src/auth/guards/auth.guard.spec.ts` | 302 lines: a new F-1 block + a mocked-verifier case + an `iat` on two existing mocks (F-1) |
| `apps/api/src/modules/messaging/messaging.controller.ts` | `@Body('targetUserId')` → `@Body() dto: AddConversationParticipantDto` (F-3) |
| `apps/api/scripts/verify-route-authorization.mjs` | class-validator metadata gate (F-2), keyed-body policy (F-3), body rules moved ahead of the public-route `continue` (F-2.4) |
| `apps/api/scripts/mutate-route-authorization.mjs` | M6, M7, M8 (F-2, F-3) |
| `apps/api/scripts/mutate-token-lifetime.mjs` | M3, M4 (F-1) |
| `apps/api/scripts/verify-compiled-auth.mjs` | 3 live future-`iat` cases + the corrected D-2 claim (F-1) |
| `scripts/triage-vulnerabilities.mjs` | AST-based config rules, fail-closed fallback, `--audit-file`, exit-code flush fix (F-4, F-5, §C.6) |
| `.github/workflows/ci.yml` | 3 new CI steps: the F-5 gate, the F-4 gate, the F-4 mutation |

### Verified unmodified

`PROJECT_PLAN.md`, `PROJECT_PLAN-old.md` and every `SECURITY_REVIEW_*` artifact
are byte-identical to their pre-session state. `apps/web/next.config.mjs` and
`apps/api/src/auth/dto/auth.dto.ts` were edited during reproduction and
restored byte-for-byte; the harness asserts the former, and the diff of the
latter is unchanged from the Phase 18–24 baseline.

No file outside this list was modified. All 41 tracked files already modified
by Phases 18–24 remain modified with their Phase 18–24 content intact; the
complete `git status -uall` set is unchanged apart from the six files above.

---

## H. Complete regression results

All run in this session, on the final tree.

| Lane | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | **PASS** — 11/11 turbo tasks |
| Build | `pnpm build` | **PASS** — 7/7 |
| Build determinism | `pnpm --filter @ecc/api build:verify` | **PASS** — cold + warm, 276 files, no spec/testing material in `dist` |
| API unit | `pnpm --filter @ecc/api test` | **PASS** — 157 passed, 44 skipped (201) |
| API integration (real PostgreSQL) | `pnpm test:integration` | **PASS** — 126 passed |
| API all, with DB | `pnpm --filter @ecc/api test:all` | **PASS** — 327 passed (26 files) |
| API all, without DB (CI shape) | `env -u DATABASE_URL pnpm --filter @ecc/api test:all` | **PASS** — 157 passed, 170 skipped |
| Mobile | `pnpm --filter @ecc/mobile test` | **PASS** — 32 passed |
| Web | `pnpm --filter @ecc/web test` | **PASS** — 1 passed |
| Turbo test lane | `pnpm test` | **PASS** — 11/11 |
| Lint | `pnpm lint` | **see below** |

### Lint

`pnpm lint` exits 1 — **the same as the Phase 24 baseline, unchanged.** API lint
reports **55 errors / 69 warnings**, exactly the Phase 22/23/24 figure recorded
in `docs/PHASE_24_FINAL_REPORT.md:109`; mobile reports 18 pre-existing
warnings; web passes clean. ESLint was run per-file against every file this
phase touched:

```
src/auth/guards/auth.guard.ts                        errors 0  warnings 0
src/auth/guards/auth.guard.spec.ts                   errors 0  warnings 0
src/config/security-config.ts                        errors 0  warnings 0
src/modules/messaging/dto/add-participant.dto.ts     errors 0  warnings 0   <- new file, clean
src/modules/messaging/messaging.controller.ts        errors 0  warnings 2   <- both pre-existing
```

The two warnings on `messaging.controller.ts` (import sort, unused
`NotFoundException`) are on lines this phase did not touch, in a file the
Phase 18–24 work did not modify. **Phase 25 adds no lint debt.** The CI lint
step is `continue-on-error: true` with the baseline documented in the workflow.

### Security gates

| Gate | Result |
|---|---|
| Decorator-metadata parity | **PASS** |
| Route authorization (compiled artifact) | **PASS** — 57 live routes, every body DTO carrying constraints |
| Configuration contract | **PASS** |
| Dependency audit / supply chain | **PASS** |
| Vulnerability triage (live `pnpm audit`) | **PASS** — 48 advisories, BUILD-TIME 30 / NOT REACHABLE 18, 0 reachable |
| **Dependency triage fails closed (new, F-5)** | **PASS** — 24 assertions |
| **Next-config AST feature detection (new, F-4)** | **PASS** — 27 assertions |
| Env contract | **PASS** |
| CI parity | **PASS** |
| Release artifact | **PASS** |
| Database / migration gate | **PASS** — 2 migrations, idempotent, second DB identical, app boots and authenticates |
| Container build and runtime gate | **PASS** — 57 checks |

### Mutation harnesses

| Harness | Result |
|---|---|
| `verify:metadata:mutate` (Phase 23 W1) | **PASS** |
| `verify:routes:mutate` (M1–M8) | **PASS** — 9/9 |
| `verify:lifetime:mutate` (M1–M4) | **PASS** — 5/5 |
| `mutate-config-contract.mjs` (Phase 23 W5) | **PASS** |
| **`mutate-next-config-rewrites.mjs` (new, F-4)** | **PASS** — 4/4 |

---

## I. Compiled / live production verification

- **Compiled artifact**: `apps/api/dist` rebuilt from source; the F-1 control
  is present in `dist/auth/guards/auth.guard.js`; the F-2/F-3 controls read
  the compiled `dist` and not the source; `build:verify` proves the artefact is
  what ships and carries no test material.
- **Live `NODE_ENV=production`**: the F-1 reproduction was run before and after
  the fix against a real process with a real PostgreSQL database and a real
  user, and is reported verbatim in §B.1 and §B.6.
- **Compiled-artifact mutation**: the F-1 control was deleted from `dist` and
  the live harness caught it (§B.5).
- **Container gate**: both images rebuilt from scratch (prior verification
  images removed and the Docker build cache pruned, so the build is a genuine
  clean build). All 57 checks pass, including the pre-existing
  non-root / immutable-filesystem / `STORAGE_DIR` controls:

```
  PASS  API image runs as a non-root user — 1000
  PASS  Web image runs as a non-root user — 1000
  PASS  no application path is writable by the runtime user — uid=1000 denied every write under /app
  PASS  STORAGE_DIR is writable by the runtime user — wrote and read back under /app/storage as uid 1000
  PASS  Phase 18 0600/0700 storage modes are still enforced in the image — file=600 dir=700 roundtrip=ok
  PASS  liveness answers 200 / readiness answers 200 with a reachable database
  PASS  Docker HEALTHCHECK reports the container healthy — healthy
  PASS  SIGTERM drains and exits cleanly — exit 0 in 0.3s
  PASS  the persisted credential is a real Argon2id hash — $argon2id$, 97 chars
  PASS  the documented migration command applies every migration to a clean database
  PASS  the access token lifetime is bounded in the image (Phase 24 D-2)
  PASS  the API image ships no test or source material
  PASS  Web image ships no application source — clean
```

`STORAGE_DIR` remains the only intended writable application location, and no
Dockerfile or container architecture was changed.

---

## J. Database isolation evidence

- A disposable container `ecc-p25-pg` (`postgres:16-alpine`, port **55433**,
  database **`ecc_p25`**) was created for the F-1 live reproduction and the
  DB-backed test lanes, and **removed** at the end.
- The migration gate and the container gate create and destroy their own
  containers; the migration gate asserts this itself
  (`PASS  the script only ever targeted the container it created`).
- The migration gate initially failed with `port is already allocated` because
  my throwaway container held 55433; the container was stopped and the gate
  re-run clean rather than the port being reassigned.
- **The developer `ecc` database was never targeted.** No `DATABASE_URL` used
  in this session references port 5433 or database `ecc`. The only
  interactions with the `ecc-postgres` container were two read-only `SELECT`
  queries for isolation evidence (`select datname from pg_database`, `select
  count(*) from users` → 14). Nothing was written, created, migrated or
  dropped there.
- No schema or migration was changed in this phase; the migration gate confirms
  the same 2 migrations and 37 tables as before.

---

## K. Limitations and deferred observations

1. **The `plugins` over-report (F-4).** A third-party Next.js plugin can inject
   `rewrites` at load time and nothing in the config text reveals it. The
   analyser therefore reports `analysable: false` when `plugins` is declared, and
   the rules fail closed. This app has no `plugins` key, so the triage is
   unaffected today, but a legitimate future `plugins` array would produce a
   REACHABLE verdict for every config-driven advisory. The remedy is a
   `plugins`-aware analyser (parse the plugin source, or evaluate the config in
   a sandbox); the remedy chosen here is the honest one.
2. **`redirection`/`headers` are detected, not dispositioned.** The new
   `redirects` rule mirrors `rewrites`; no current advisory requires it, so no
   advisory is currently routed to it.
3. **F-1 residual: a token with no `exp` at all.** Reproduced and now covered by
   the new rule (a future `iat` with no `exp` → 401), but a *present* `iat` and
   an absent `exp` is still accepted until `iat + 15m`. That is bounded and
   intended by the D-2 design; requiring `exp` at verification would be a
   stronger contract and is not in scope for this phase.
4. **F-1 residual: knowledge of the signing secret is still required.** The new
   control is defense-in-depth, exactly as the reviewer noted. It does not close
   a new unauthenticated exposure; it makes the stated guarantee true.
5. **F-2 bar: "at least one effective constraint" per DTO.** A DTO with twenty
   fields and one constraint still passes. Class properties are not observable
   at runtime, so a per-property rule is not enforceable from the artifact
   without TypeScript AST analysis; the achievable bar is stated plainly rather
   than over-claimed, and the per-route counts are printed so a reviewer can
   see the real number for every route.
6. **F-3 residual: the three Phase 4 public stubs still bind keyed body
   parameters.** They are exempted by being on the documented public allow-list,
   they ignore their input, and they are `@RateLimit`ed where the threat model
   needs it. This is a deliberate, visible exemption, not an ignored case.
7. **Lint remains red at the Phase 24 baseline** (55 API errors, 18 mobile
   warnings). Phase 25 adds none of them, but it does not fix them either.
8. **Remote GitHub Actions remains unverified.** Every gate in §H was run
   locally. Nothing was committed or pushed, so no CI run exists. The three new
   CI steps are unexecuted in CI.
9. **`PROJECT_PLAN.md` was not updated** and no Phase 25 entry was added to it,
   per the scope instruction not to modify it.
10. **Mutation coverage is not exhaustive.** Each control has a mutant chosen to
    break it, not a mutation-testing tool over every line. The five gates each
    have 1–3 mutants; the API code changes have mutants only for the guard
    (M3, M4).

### Observations recorded, not fixed (out of scope)

- `triage-vulnerabilities.mjs` reports `patched: >= >=15.5.24` — a doubled
  operator, because the advisory's own `patched_versions` string is
  `>=15.5.24` and the template prepends `>= `. Cosmetic, pre-existing, and
  touching it would change a report line a reviewer has been reading.
- `pnpm --filter @ecc/web lint` prints a clean result but the turbo lane still
  reported `[ELIFECYCLE] Command failed` for it in the aggregate run. The
  per-package command exits 0; this looks like turbo's own exit-code handling
  for a `continue-on-error` lane. Pre-existing and not investigated further,
  because investigating it means changing CI plumbing.
- `CareTaskController` is compiled but registered in no module (5 handlers,
  unreachable). The gate reports it as information. Pre-existing.

---

## L. Confirmations

- **Nothing was committed.** `git log --oneline -3` is unchanged; `git stash list`
  is empty; there is no `.git/rebase-merge` or `.git/rebase-apply`.
- **Nothing was pushed.** No remote operation was attempted.
- **No amend, reset, rebase or stash** was performed.
- **HEAD is unchanged**: `d0cd0dd2f175ae881bd201eb26d7e74a0c4158be` at the start
  and at the end of this session.
- **No unrelated file was modified.** The Phase 18–24 uncommitted work is
  preserved in full; the only additions to the working tree are the six files
  in §G.
- **Phase 26 was not started.** No WebSockets or realtime, no AI/LLM/OCR, no
  cloud/Kubernetes/Terraform/Helm, no Redis/MinIO/S3, no monitoring, metrics or
  tracing, no dependency upgrades, no Prisma schema or migration changes, no
  mobile functionality change, no authorization redesign, and no product
  features.
- **`SECURITY_REVIEW_PHASE_25.md` was not created** — that file belongs to the
  independent reviewer.
- `/tmp/opencode` contains pre-existing artifacts from earlier work. The files
  this session created there are ad-hoc reproduction harnesses and build logs,
  not deliverables; nothing in the repository depends on them.
