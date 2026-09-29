# Security Review — Phase 24 (Independent)

**Review date:** 2026-09-29
**Repository:** ElderlyCareCoordinationPlatform (ECC)
**HEAD under review:** `d0cd0dd2f175ae881bd201eb26d7e74a0c4158be` — "Complete Phase 17 testing CI and reliability"
**Reviewer:** independent review; the Phase 24 implementation report was treated as claims to verify, not evidence.
**Artifact reviewed:** `docs/PHASE_24_DEFERRED_FINDINGS_CLOSURE.md`, `docs/PHASE_24_FINAL_REPORT.md`, and the uncommitted Phase 18–24 working tree.

---

## 1. Executive summary

Phase 24's two claimed fixes are **real and effective**, and I reproduced both against the compiled
artifact and a live process rather than against a report:

- **D-2** (`maxAge` on `verifyAsync`, one shared `ACCESS_TOKEN_TTL_SECONDS`) genuinely bounds the
  lifetime of any *correctly signed* access token, and I confirmed enforcement on a real login token
  over real HTTP. Two independent mutation tests (removal and widening) both produce meaningful
  failures. The test is not self-referential — the policy value is asserted against a literal.
- **D-4** (two DTOs replacing `Partial<>` / inline type literals) genuinely restores validation on
  both routes, and the new compiled-artifact rule detects the defect class on *any* mounted
  body-carrying route, not just the two Phase 24 fixed.

I also confirmed the four verification-method defects Phase 24 claims to have found, and I found
**two new defects in the same class** that Phase 24 did not catch:

1. **A forward-dated `iat` defeats the entire D-2 bound.** `maxAge` is evaluated as
   `clockTimestamp >= iat + maxAge`. A token with `iat` 10 years in the future and `exp` 10 years
   ahead is **accepted**. This is the exact threat model D-2 was raised for (an attacker holding the
   signing secret minting a long-lived token), so the fix does not close what Phase 23 deferred —
   it narrows it. (Medium)
2. **The D-6 `rewrites` triage rule has a false negative.** The rule matches `/\brewrites\s*:/`,
   which matches the object-property form but **not** `async rewrites() { … }` — the only form
   Next.js actually accepts. A planted, functioning rewrites rule left the gate green. (Medium,
   gate-only; the current build genuinely has no rewrites, so the D-6 disposition is unaffected
   today)

I also found two gate blind spots: the D-4 rule is scoped to *metatype* and does not verify that the
`ValidationPipe` strictness flags are still enabled, nor that the DTO carries any constraint; and
converting a whole-body route to a keyed `@Body('field')` silently removes it from the rule's scope.
(Low, gate-only.)

The three CI workflow defects Phase 24 claims to have fixed are **genuinely fixed and I proved both
ways**: with the secret absent from the step environment the compiled-auth harness prints
"skipping the signature-based token assertions" and **exits 0** (vacuous green); with it present, all
13 token-defect cases and the D-2 lifetime assertions run. The `STORAGE_DIR=` fix likewise: the
step now refuses correctly and names the variable.

**Remote CI remains unverified.** GitHub Actions has still never run. No remote result is claimed.

**Verdict: APPROVED WITH FINDINGS.** No Critical or High defect was found. The two Medium findings
are (a) a genuine incompleteness in a Phase 24 fix and (b) a false negative in a Phase 24 gate; both
are defence-in-depth boundaries that require the signing secret or a code change to matter, and
neither invalidates a claim the phase document makes about the *current* build. They should be
carried forward, not silently dropped.

---

## 2. Exact scope reviewed

| Item | Detail |
|---|---|
| Base commit | `d0cd0dd` (unchanged by Phase 24 and by this review) |
| Working tree | 40 modified tracked files + 35 untracked entries = 75, all uncommitted (Phase 18–24) |
| Phase 24 production changes | `security-config.ts`, `auth.guard.ts`, `app.module.ts`, `auth.service.ts`, `feed.controller.ts`, `preference.controller.ts` |
| Phase 24 new production files | `feed/dto/update-update.dto.ts`, `notifications/dto/update-preference.dto.ts` |
| Phase 24 new harness | `apps/api/scripts/mutate-token-lifetime.mjs` |
| Phase 24 new tests | 5 cases in `auth.guard.spec.ts`, 1 in `auth-session.lifecycle.e2e-spec.ts`, 1 in `authorization-matrix.security.e2e-spec.ts`, 4 in `validation-boundary.security.e2e-spec.ts` |
| Phase 24 gate/harness edits | `verify-route-authorization.mjs`, `mutate-route-authorization.mjs` (+M4/M5), `verify-compiled-auth.mjs`, `triage-vulnerabilities.mjs`, `verify-docker-images.mjs`, `mutate-container-gate.mjs` (+M7), `verify-ci-parity.mjs`, `.github/workflows/ci.yml`, `apps/api/package.json` |
| Phase 24 documents | `docs/PHASE_24_DEFERRED_FINDINGS_CLOSURE.md`, `docs/PHASE_24_FINAL_REPORT.md` |
| Not reviewed in depth | Phases 18–23 product code, except where Phase 24's changes or gates depend on it |

### 2.1 Phase 24 file attribution

The Phase 24 report's file list was checked against the actual diff and matches. The D-2 change is
3 production files + 1 guard change, and the D-4 change is 2 controllers + 2 new DTOs, exactly as
claimed. The pre-existing Phase 18–23 work is intact and unmodified by Phase 24.

### 2.2 A note on repository state during this review

While probing the D-6 `rewrites` rule I ran `git checkout apps/web/next.config.mjs` to undo a planted
edit. That file is part of the **uncommitted** Phase 20 work, so the checkout reverted it to `HEAD`.
I detected this immediately and restored the file byte-for-byte; `git diff apps/web/next.config.mjs`
now shows exactly the Phase 20 `output: 'standalone'` change it showed at the start of this review, and
`git status` is identical to the session-start capture (75 entries, 40 modified files, 2906
insertions / 465 deletions). **No net change to the repository resulted.** It is recorded here because
it is a real risk of reviewing an uncommitted tree with git-restore commands, and the reviewer
verified the recovery rather than assuming it.

---

## 3. D-1 … D-9 disposition verification

### D-1 — deactivated-token window — **DEFER (confirmed correct)**

**Verified by reading code and by live request.**

`apps/api/src/auth/guards/auth.guard.ts` consults the database for nothing — verified: no `prisma`,
`findUnique`, `isActive` or `deletedAt` reference in the file. The window is real and deliberate:

- `AuthService.login` refuses `!user.isActive || deletedAt !== null` (auth.service.ts:134)
- `AuthService.refresh` re-reads with `isActive: true` (auth.service.ts:204) — a session cannot be
  extended after deactivation
- `AuthService.getProfile` re-reads and 401s an inactive/deleted account (auth.service.ts:279)
- No path other than `/auth/me` re-checks liveness

**The window is a deliberate architectural trade-off, not an accidental bypass:** it requires a
per-request database lookup or a revocation list, and the phase document states that reasoning. I
found no code path that would extend the window.

**The pin is load-bearing — independently mutation-tested.** I raised
`ACCESS_TOKEN_TTL_SECONDS` to 24 h and ran the D-1 e2e pin:

```
AssertionError: the access token lives for 86400s. The accepted D-1 residual risk is
stated as at most 15 minutes …: expected 86400 to be 900
  Tests  1 failed | 7 skipped (8)
```

The assertion compares against a literal `15 * 60`, not against the constant, so it is not
self-referential. **Confirmed.**

**Caveat carried forward (see F-1):** the *verification-side* half of the D-1 window is subject to
the forward-`iat` gap. A 15-minute window is only a true statement about the normal issuance path.

**Disposition: accepted.** No Phase 24 regression.

---

### D-2 — unbounded token lifetime — **FIXED, but incompletely (see F-1)**

**Independently verified against the COMPILED `dist` and a live production-mode process.**

Live probe against `node dist/main.js` in `NODE_ENV=production` with a real register → login flow:

| Case | Expected | Actual |
|---|---|---|
| issued token, `exp - iat == 900` | ACCEPT | **200** |
| fresh token, `exp = +10 years` | ACCEPT | **200** |
| **1 h-old token, `exp = +10 years`** | **REJECT** | **401 UNAUTHENTICATED** |
| `iat` 16 min old, `exp` +10 y | REJECT | **401** |
| `iat` 899 s old, `exp` +10 y | ACCEPT | **200** |
| expired `exp` | REJECT | **401** |
| no `iat` (`noTimestamp`) | REJECT | **401** |
| HS512 with the real secret | REJECT | **401** |
| `alg=none` | REJECT | **401** |
| no `sub` | REJECT | **401** |
| **wrong secret** | REJECT | **401** |

The "wrong secret → REJECT" control is what rules out the possibility that the rejection is a
signature failure rather than a lifetime failure. **Verified.**

**Mutation-tested both ways (harness run independently, not taken on report):**

- `M1` (`maxAge` line deleted) — suite fails on a lifetime assertion
- `M2` (`ACCESS_TOKEN_TTL_SECONDS` → 24 h) — suite fails on a lifetime assertion
- The suite passes again on the restored tree

I also mutation-tested the D-1 e2e pin against the same 24 h change (above) — it fails, so the
window cannot widen silently.

**The self-referential-test defect Phase 24 claims to have fixed is real and fixed:**
`auth.guard.spec.ts:106` asserts `expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60)` against a literal,
and its own comment records that the first version compared against the same constant the code uses.
I confirmed the mutant M2 (which raises the constant) fails.

**Container-level enforcement independently re-verified:** the image built from this tree carries the
bound (`docker run … grep maxAge /app/dist/auth/guards/auth.guard.js` → present), the container gate
check *"the access token lifetime is bounded in the image"* passes, and container mutant **M7**
(remove `maxAge`, rebuild `--no-cache`) fails **on exactly that check**:

```
PASS  M7: the access-token lifetime bound removed from the guard (Phase 24 D-2)
      gate failed, and the expected check is among the failures: the access token
      lifetime is bounded in the image (Phase 24 D-2)
PASS  the gate passes again on the restored repository
```

**Finding F-1 (Medium) — see §4.**

---

### D-3 — unmounted `CareTaskController` — **DEFER (confirmed correct)**

**Verified three ways.**

1. **Module graph:** `grep` finds `CareTaskController` referenced by no module. There is no
   `care-tasks.module.ts`. `verify-route-authorization.mjs` walks the graph from `AppModule` and
   reports `CareTaskController (5 handlers)` under "compiled but NOT registered (unreachable)".
   `verify:routes` reports **57 live routes from 62 compiled handlers**.
2. **Live HTTP with a real token.** All five routes with an authenticated access token:
   `GET/POST/PATCH/DELETE/GET :id` on `/seniors/{uuid}/tasks` → **404** each. Control: the same route
   **without** a token also → **404**, not 401. **This is the important control** — a 401 would have
   proven only that authentication failed.
3. **The pin is load-bearing — independently mutation-tested.** I created a module that registers the
   controller, imported it into `AppModule`, rebuilt, and re-ran both the gate and the e2e test:

```
verify:routes exit=1  (62 live routes, CareTaskController listed as live)
D-3 e2e pin: vitest exit=1
  × the care-task surface is still unmounted …
    → GET /api/v1/seniors/<uuid>/tasks answered 200; the care-task controller appears
      to be MOUNTED. Deferred finding D-3 has changed state …: expected 200 to be 404
```

The mount produced a genuine **200** for the fully-authorised member, so the 404 in the real build is
**evidence of absence, not a masked authentication failure**. This is the strongest form of the
D-3 evidence and it holds. The gate additionally caught the mounted controller's two `Object`-metatype
bodies, which is the D-4 rule working as designed.

**Reachability through another registration path:** none found. Nest registers controllers only via
`@Module({ controllers: [...] })`; there is no `forRoot`/dynamic module, no `useFactory` controller
construction, and no glob-based module discovery in this project. The controller is reachable only by
adding a module — which the D-3 pin and `verify:routes` both catch on the same run.

**Disposition: accepted.** No Phase 24 regression.

---

### D-4 — DTO-less routes — **FIXED (confirmed effective); gate has blind spots (F-2, F-3)**

**Full independent body-route inventory built from the compiled `dist`** (my own script, not the
project gate), walking `__routeArguments__` + `design:paramtypes` on the registered module graph:

```
MOUNTED body params: 19   UNVALIDATED whole-body: 0
LIVE OK   PATCH /api/v1/notification-preferences                      -> UpdateNotificationPreferenceDto
LIVE OK   PATCH /api/v1/seniors/:seniorId/appointments/:appointmentId  -> UpdateAppointmentDto
LIVE OK   PATCH /api/v1/seniors/:seniorId/feed/:updateId               -> UpdateFamilyUpdateDto
LIVE OK   PATCH /api/v1/seniors/:seniorId/medications/:medicationId    -> UpdateMedicationDto
LIVE OK   POST  /api/v1/auth/login                                    -> LoginDto
LIVE OK   POST  /api/v1/auth/register                                 -> RegisterDto
LIVE OK   POST  /api/v1/seniors/:seniorId/appointments                -> CreateAppointmentDto
LIVE OK   POST  /api/v1/seniors/:seniorId/conversations/:id/messages   -> CreateMessageDto
LIVE OK   POST  /api/v1/seniors/:seniorId/documents                   -> UploadDocumentDto
LIVE OK   POST  /api/v1/seniors/:seniorId/documents/:id/access         -> CreateAccessGrantDto
LIVE OK   POST  /api/v1/seniors/:seniorId/emergency-alerts             -> CreateEmergencyAlertDto
LIVE OK   POST  /api/v1/seniors/:seniorId/feed                        -> CreateFamilyUpdateDto
LIVE OK   POST  /api/v1/seniors/:seniorId/measurements                -> CreateHealthMeasurementDto
LIVE OK   POST  /api/v1/seniors/:seniorId/medications                 -> CreateMedicationDto
LIVE ---- POST  /api/v1/auth/forgot-password                          keyed(email)  -> String
LIVE ---- POST  /api/v1/auth/reset-password                           keyed(token), keyed(newPassword) -> String
LIVE ---- POST  /api/v1/auth/verify-email                            keyed(token) -> String
LIVE ---- POST  …/conversations/:id/participants                      keyed(targetUserId) -> String
DEAD ---- POST  /api/v1/seniors/:seniorId/tasks                       CareTaskController, Object (unmounted)
DEAD ---- PATCH /api/v1/seniors/:seniorId/tasks/:taskId               CareTaskController, Object (unmounted)
```

**Every mounted whole-body route binds a real validated DTO.** No `PUT` route exists in the codebase.
The four `Object`-metatype mounted body params are all keyed `@Body('field')`, which the rule
deliberately exempts; each is a Phase 4 stub or a single field the service re-validates, as the
phase document records. I verified those service paths.

**Both fixed routes validated end-to-end** (315/315 e2e, including the four new cases in
`validation-boundary.security.e2e-spec.ts`, which assert a smuggled `userId`/`authorUserId` is
refused with 400 **and** the post is unchanged in the database).

**Mutation-tested the new rule with 8 mutants of my own** (5 of Phase 24's, 3 new shapes I invented):

| Mutant | Rule fires? |
|---|---|
| M4 `Partial<CreateFamilyUpdateDto>` on feed PATCH (Phase 24's) | **DETECTED** |
| M5 inline type literal on preference PATCH (Phase 24's) | **DETECTED** |
| R1 `@Body() dto: any` on a route Phase 24 never touched | **DETECTED** |
| R2 `Record<string, unknown>` body on messaging | **DETECTED** |
| R6 a brand-new live route with an untyped body | **DETECTED** |
| R3 DTO retyped via `import type` (→ `Function` metatype) | rule does **not** fire — but `verify:metadata` **does** |
| R4b DTO class present, every constraint stripped | rule does **not** fire (F-2) |
| R7 whole-body route converted to keyed `@Body('body')` | rule does **not** fire (F-3, documented exemption) |

So the rule is not keyed to the two files Phase 24 fixed, and it is not defeated by the `Object`
shape it was written for. R3 confirms the two gates are complementary rather than redundant.

**Finding F-2 (Low), F-3 (Low) — see §4.**

---

### D-5 — multer DoS — **DEFER (confirmed correct)**

- `multer@2.0.2` **is** a production transitive of `@nestjs/platform-express` (confirmed from the
  installed manifest), so "not installed" is not available as a defence.
- `grep` for `FileInterceptor|FilesInterceptor|AnyFilesInterceptor|FileFieldsInterceptor|NoFilesInterceptor|multer|multipart`
  across `apps/api/src`, `apps/web/src` and `packages`: **zero hits**. `grep -rl multer apps/api/dist`:
  **zero hits**.
- **Live probe against the running compiled app in `NODE_ENV=production`:**
  - `POST /auth/login` with `multipart/form-data` → **400**
  - `POST …/documents` with a file part and a token → **401 UNAUTHENTICATED** (rejected before the
    body is read)
  - the nested-field DoS payload → **400**, liveness still **200**
- Only upload route is `POST /seniors/:seniorId/documents`, base64-in-JSON
  (`UploadDocumentDto.fileContent`).

**Disposition: accepted.** Correctly deferred; the triage rule would flip to `REACHABLE` the moment
a multer-backed interceptor appears (I confirmed this by planting one — see §9).

---

### D-6 — Next.js advisories — **DEFER (correct today), but a gate false negative exists (F-4)**

**Independently re-derived, 2026-09-29.** Installed: `next@14.2.35` (`^14.2.15` in
`apps/web/package.json`). `pnpm audit --json` in this tree: **92 advisories total, 4 critical,
44 high = 48 critical/high**, of which **23 are `next`**. The 10 `next` critical/high are the two
criticals (AVIF image-optimizer RCE, Windows-hosted RCE) and eight highs. All fixes are in
`>= 15.5.24`. I fetched the current advisories from the GitHub Advisory API
(`api.github.com/advisories?ecosystem=npm&affects=next@14.2.35`, retrieved 2026-09-29) to confirm
severity, affected range and required feature rather than asserting from memory.

Reachability, by the four-way split the brief asks for:

| Class | Advisories | Basis |
|---|---|---|
| **A. Currently unreachable** | most of the 23 | The required feature is absent, verified in both source and the built artifact |
| **B. Unreachable because of current build configuration** | the Server-Function set | `.next/server/server-reference-manifest.json` is `{"node":{},"edge":{}}` — **zero registered server functions**, so the Server-Function endpoint those 4 advisories require does not exist. This depends on the build, not only on source. |
| **C. Not reachable without future product/code change** | the image-optimizer, middleware, rewrites, i18n, WebSocket, custom-server, CSP-nonce set | Each is one `import` or one config key away. Verified absent: no `next/image`/`<Image`/getImageProps anywhere; no `middleware.{ts,js}`/`src/middleware.ts`/`src/proxy.ts`; no `rewrites`/`redirects`/`i18n` in `next.config.mjs`; no `apps/web/pages`; no `WebSocketServer`/`handleUpgrade`; no `nonce`; runtime entry is Next's generated standalone `server.js`; image is `node:24-alpine` (Linux), so the Windows RCE path does not exist |
| **D. Vulnerable dependency remains present** | **all 23** | `next@14.2.35` is in the shipped web image. The deferral removes no vulnerable code |

I probed the two criticals specifically rather than accepting the blanket rule:
- **AVIF image-optimizer RCE (GHSA-2xp9-vwfh-vxw4, CVSS 4.0 9.5):** requires the image-optimization
  API. No `next/image` import, no `<Image>`, no `images:` key. Not reachable.
- **Windows-hosted RCE (GHSA-p293-qw3h-jr36, CVE-2026-75604, CVSS 3.1 9.0):** advisory text is
  explicit — "when the server is hosted on machines using a Windows filesystem". `apps/web/Dockerfile`
  is `FROM node:24-alpine`. Not reachable.

**Verdict on the claim "no reachable Server Functions": CONFIRMED** for this build, and it is
correctly established from *both* source and the built artifact rather than from the manifest alone
— the rule checks source first and treats a stale manifest as reported-stale (the precedence fix
Phase 24 describes).

**The claim is nonetheless fragile, exactly as the phase document admits.** One `'use server'`
directive changes it. I verified the gate detects that (5 of 10 flip to REACHABLE, exit 1).

**Finding F-4 (Medium) — see §4: the `rewrites` rule has a false negative.**

---

### D-7 — devDependency / transitive advisories — **DEFER (correct), classifier has one latent fail-open (F-5)**

- **The classifier fixes Phase 24 claims are real.** I instrumented the classifier and confirmed
  `next` is now reported with **1 production path** (not 0) and `@xmldom/xmldom` with **82/82**,
  matching the two-decoder fix described.
- Current result: **48 critical/high → 30 BUILD-TIME, 18 NOT REACHABLE, 0 REACHABLE**, exit 0.
- The two `postcss` highs genuinely reach production (17/17 prod paths) through `next`; the
  classifier's argument is the interesting one — it checks whether any module under `next/dist/server`
  references postcss, in the standalone tree *or* the installed package, and finds none. The
  build-order defect Phase 24 describes (depending on a web build that has not happened in the `api`
  job) is fixed: the installed-package fallback is always present.

**Independent negative tests of the classifier — 8 planted conditions, each restored afterwards:**

| Planted condition | Gate | Correct? |
|---|---|---|
| `'use server'` in a web page | exit 1, 5 flip to REACHABLE | ✔ |
| a multer-backed `FileInterceptor` | exit 1, multer → REACHABLE (6 entries) | ✔ |
| `next/image` import | exit 1, 1 flips | ✔ |
| `middleware.ts` | exit 1, 1 flips | ✔ |
| remote `@import url(...)` stylesheet | exit 1, postcss → REACHABLE (2 entries) | ✔ |
| all `NEXT_FEATURES` rules disabled (unclassified condition) | exit 1, **10 × `REACHABLE (unclassified)`** | ✔ |
| **async `rewrites()` in next.config.mjs** | **exit 0 — GATE STAYED GREEN** | ✘ **F-4** |
| object-form `rewrites: {...}` in next.config.mjs | exit 1, 1 flips | ✔ |

**Fail-closed on an ambiguous condition: confirmed** (the unclassified case produces 10
`REACHABLE (unclassified)` and a non-zero exit).

**No advisory is silently discarded as dev-only in the current tree:** I instrumented the classifier
and confirmed all 14 distinct packages currently reach an *explicit* rule — none falls through to
the generic fallback. The lockfile is byte-identical
(`md5 5af2c8991d97ce696fba011c12d9d3ce` before and after all of this review).

**Finding F-5 (Low) — see §4: a latent fail-open in the generic fallback.**

---

### D-8 — frozen-lockfile — **DEFER (confirmed correct; the gate is stronger than claimed)**

**Reproduced the drift, not read about it.** I changed `apps/api/package.json`
`class-validator ^0.14.1` → `^0.14.2` (leaving the lockfile alone) and exercised each path:

| Path | Command | Result |
|---|---|---|
| Supply-chain gate | `node scripts/verify-dependency-audit.mjs` | **exit 1** — `[ERR_PNPM_OUTDATED_LOCKFILE] … specifiers in the lockfile don't match specifiers in package.json` |
| API image install layer | `pnpm install --filter @ecc/api... --frozen-lockfile` in a throwaway `node:24-alpine` against a copy of the manifests | **build failure** — same error, naming `class-validator (lockfile: ^0.14.1, manifest: ^0.14.2)` |
| CI (all four jobs) | `pnpm install --frozen-lockfile` ×4 | present; `ERR_PNPM_OUTDATED_LOCKFILE` per the gate's own report |
| CI guard | `git diff --exit-code -- pnpm-lock.yaml` | present |

`grep` confirms **four `--frozen-lockfile` in CI, one in each Dockerfile, zero negations**, and no
`npm ci` or `--no-frozen-lockfile` anywhere. All edits restored; `verify-dependency-audit.mjs`
returns to exit 0.

**The residual gap is exactly and only a developer's local install.** I agree with the deferral and
specifically with the reasoning that both remedies are out of scope: a commit hook needs a hook
runner (a new devDependency **and** a lockfile change, which the phase correctly refuses), and
`.npmrc frozen-lockfile=true` would break `pnpm add`. **I am not recommending additional enforcement**
— the demonstrated enforcement is sufficient at every artifact-producing path.

**One observation, not a recommendation:** `verify-dependency-audit.mjs` is a *stronger* control
than the phase document credits. It is not merely reading the lockfile; it runs the frozen install
and fails on the mismatch. That is the right shape.

---

### D-9 — container-mutant disk cost — **DEFER (correct), harness improvements verified**

- **Default is safe:** `PRUNE_CACHE` is `false` unless `--prune-cache` is passed. Verified in a real
  run — the header printed "the floor is 20.0G and --prune-cache is off".
- **The low-space warning fires and is honest** — my run printed it verbatim at 6.6 G free, naming
  both the mitigation and its cost (pnpm store loss → network-dependent harness).
- **Pruning cannot remove unrelated resources.** It is `docker builder prune -f` (build cache only),
  gated on `free < MIN_FREE_BYTES && PRUNE_CACHE`. It does not touch images, containers or volumes.
  `verify-docker-images.mjs` operates only on namespaced resources: `p20-verify-postgres`,
  `p20-verify-storage`, `p20-verify-net`, `ecc-api:p20-verify`, `ecc-web:p20-verify`. The mutation
  harness removes only its own `ecc-api:p24-mutant-<id>` tag. **After my M7 run, no mutant image and
  no gate container remained.**
- **Signal handling verified by reading:** `restoreNow` is wired to `SIGINT`/`SIGTERM`/`SIGHUP` and
  restores every mutated file; the `finally` restores on normal exit and throw; and the harness
  re-runs the gate on the restored tree at the end. I confirmed the restored-tree run passes
  (`PASS the gate passes again on the restored repository`) and that `auth.guard.ts` still contains
  `maxAge` and `git status` is unchanged afterwards.
- **`maxBuffer: 256 MB` on the `docker build` spawn** is present with a comment explaining the
  child-kill failure mode it prevents. Correct and non-obvious.

**Disposition: accepted.** The phase document's own note that the peak is *not* reduced by default is
honest and correct.

---

## 4. Defects found during this review

### F-1 — Medium — A forward-dated `iat` defeats the entire D-2 bound (Phase-24-introduced incompleteness)

**Location:** `apps/api/src/auth/guards/auth.guard.ts:52` (`maxAge: ACCESS_TOKEN_TTL_SECONDS`);
`jsonwebtoken@9.0.3` `verify.js:246`.

**Evidence.** `jsonwebtoken` implements `maxAge` as:

```js
if (options.maxAge) {
  if (typeof payload.iat !== 'number') return done(new JsonWebTokenError('iat required when maxAge is specified'));
  const maxAgeTimestamp = timespan(options.maxAge, payload.iat);
  if (clockTimestamp >= maxAgeTimestamp + (options.clockTolerance || 0)) ...
}
```

The comparison is `now >= iat + maxAge`. Nothing constrains `iat` from the future, and there is no
`clockTolerance` and no `nbf` check that would catch it. **Reproduction, live against the running
production-mode process, signed with the real signing secret:**

```
OBSERVED: iat = now + 10 years, exp = now + 10 years + 600  ->  ACCEPTED (200)
```

and the same against the compiled guard directly:

```
PASS  iat = now + 1d,    exp = now + 1d   -> ACCEPT
PASS  iat = now + 30d,   exp = now + 30d  -> ACCEPT
PASS  iat = now + 365d,  exp = now + 365d -> ACCEPT
PASS  iat = now + 3650d, exp = now + 3650d-> ACCEPT
```

**Why this matters.** D-2 was raised for exactly this threat model: Phase 23's own framing was
"a correctly signed token with a ten-year `exp` … would have been accepted for ten years. Reaching
that requires the signing secret". The Phase 24 fix closes the *naive* version of that attack and
leaves a one-claim variant open. The phase document states the guarantee as
`min(exp, iat + 15m) for any token` and the guard comment as "the oldest access token this process
will accept is ACCESS_TOKEN_TTL_SECONDS old, whatever its `exp` claims". **Both statements are
inaccurate for a forward-dated `iat`,** and the guarantee is also what D-1's window is stated in
terms of.

**Severity assessment — Medium, not High.** An attacker who holds the signing secret can already mint
any claim; this does not give them anything they did not have. It is a defence-in-depth control that
does not defend as deeply as documented, and the documentation overstates it. It is not a new
exposure (the pre-Phase-24 verifier was strictly worse).

**Suggested remediation (not applied — out of scope for a review):** reject a payload whose `iat` is
in the future beyond a small tolerance, e.g. after verification add
`if (payload.iat !== undefined && payload.iat > Math.floor(Date.now()/1000) + CLOCK_SKEW_TOLERANCE) reject`.
That converts a forward-dated token into a refusal while leaving the existing tests green. The
literal in `auth.guard.spec.ts:106` should then also cover the forward-`iat` case.

---

### F-2 — Low — the D-4 gate verifies the DTO's *metatype*, not that it validates anything (Phase-24-introduced gate limitation)

**Location:** `apps/api/scripts/verify-route-authorization.mjs:101–118`.

**Evidence.** The rule's condition is "the reflected metatype is a function and is not on Nest's
skip-list". I stripped every constraint from the Phase 24 DTO (`UpdateFamilyUpdateDto` reduced to
`@IsOptional()` fields, then the class body emptied) and the gate stayed **green** in both cases:

```
*PASSED* R4b  DTO class present but constraints stripped  <-  verify-route-authorization.mjs
*PASSED* R5   DTO class emptied of all decorators         <-  verify-route-authorization.mjs
```

The route would then accept any value of any declared field. This is the same *class* of gap the
phase document correctly identifies for `import type` (metatype `Function`, caught by the sibling
gate), and the same gap the phase correctly closed for `Object`. It is the third instance of the
pattern: **the gate checks the shape of the DTO reference, not the substance of the DTO.**

**Severity: Low.** It requires a deliberate edit that removes decorators, and the container gate's
behavioural probes ("a validation failure is a 400 with no driver detail", "an undeclared role field
is rejected") would catch the practical outcome. Gate-only, not a product defect.

---

### F-3 — Low — converting a whole-body route to a keyed `@Body('field')` silently removes it from the DTO rule's scope (Phase-24-introduced gate limitation, documented exemption)

**Location:** `apps/api/scripts/verify-route-authorization.mjs:110` (`if (arg?.data !== undefined) continue;`).

**Evidence.** I converted a real, sensitive, live route —
`POST /seniors/:seniorId/conversations/:conversationId/messages` — from
`@Body() dto: CreateMessageDto` to `@Body('body') body: string`. Both gates stayed green:

```
*PASSED* R7  live body route converted to keyed @Body  <-  verify-route-authorization.mjs
*PASSED* R7  live body route converted to keyed @Body  <-  verify-decorator-metadata.mjs
```

The route is now outside the D-4 rule's scope entirely, and the D-2 rule's rationale for the
exemption ("a `@Body('field')` is a deliberate, per-field choice") is a statement of *intent*, not
something any gate can verify. The exemption is reasonable and Phase 24 documented the four current
instances, so this is a boundary, not a bug — but it is a boundary a reader could mistake for
coverage.

**Severity: Low.** Gate-only, documented.

---

### F-4 — Medium — the D-6 `rewrites` triage rule has a false negative: it cannot detect a working Next.js `rewrites()` (Phase-24-introduced gate defect)

**Location:** `scripts/triage-vulnerabilities.mjs:276`.

**Evidence.**

```js
const config = /\brewrites\s*:/.test(readIfPresent(webNextConfig));
```

Next.js accepts rewrites **only** as a function — `async rewrites() { return [...] }`. The regex
matches the object-property spelling `rewrites: [...]` (which Next does not honour) and does **not**
match the function spelling. Direct check:

```
method form  async rewrites() {...}  matched by /\brewrites\s*:/ => false
object form  rewrites: [...]          matched                    => true
redirects    async redirects() {...}  matched                    => false
```

I planted a real, functioning rule into `next.config.mjs` and ran the gate:

```
**BAD (green)**  rewrites: GATE PASSED (exit 0); REACHABLE entries=0
```

versus the object form, which does fire:

```
rewrites: { beforeFiles: [] }  ->  NOT REACHABLE 17 / REACHABLE 1 / FAILED (exit 1)
```

The advisory it was written for — **GHSA-p9j2-gv94-2wf4 (CVE-2026-64645), HIGH, SSRF via
attacker-controlled rewrite destination** — is one of the eight `next` highs, and the rule is the only
thing standing between it and a silent green.

Two aggravating details:
1. The same rule's *evidence string* claims it also checks `redirects`, but the regex contains
   neither `redirect` nor `:` for the function form — so `async redirects() { … }` (the open-redirect
   half of the same advisory) is equally invisible.
2. The phase document reports "**4 planted-feature negative tests all turned the gate red**". The
   rewrites negative test could only have passed by planting the object spelling. The claimed 4/4 is
   therefore **not reproducible in the form that matters**, and the corresponding row in the final
   report overstates the evidence.

**Severity: Medium (gate-only).** No reachable exposure today — I independently confirmed
`next.config.mjs` declares no `rewrites` and no `redirects`. The impact is that a future
configuration change that makes two HIGH advisories reachable would not turn the gate red, which is
the opposite of the property Phase 24 says it established.

**Remediation (not applied):** match the function *and* property forms, and add `redirects`:
`/\b(rewrites?|redirects)\s*[:(]/`.

---

### F-5 — Low — the triage classifier's generic fallback fails **open** for an uncovered dev-only advisory (Phase-24-introduced, latent)

**Location:** `scripts/triage-vulnerabilities.mjs:496`.

```js
verdict: devOnly ? 'BUILD-TIME' : 'REACHABLE (unclassified)',
evidence: 'no reachability rule is defined for this package in this script. Triage it by hand before release.',
```

The final report states: *"an advisory with no rule reports `REACHABLE (unclassified)` and fails the
gate … so an unexamined advisory fails the gate instead of passing it."* That is true only when the
advisory has at least one production path. An advisory with **no rule and no production path** is
classified `BUILD-TIME` — a silent pass — with evidence text that itself says "triage it by hand".
The gate counts it green.

**Evidence.** I instrumented the classifier and confirmed the current tree never reaches this line
(all 14 distinct packages hit an explicit rule — `glob`, `picomatch`, `tmp`, `vite`, `vitest` at 0
prod paths included; each has a dedicated rule). So this is **latent, not active**, and the
Phase 24 claim "0 reachable / 48 accounted for" is not affected today.

**Severity: Low.** The current tree is fully covered and the gate is green for the right reasons; a
future advisory on an uncovered, dev-only package would pass silently. The stated claim is
over-broad.

---

### F-6 — Info — Phase 24 report's working-tree entry count does not match the tree

The final report (§V) states "73 now" changed/untracked entries. The tree at review time has **75**
(40 modified + 35 untracked) — the same figure I recorded at the start of this review, with the
Phase 18–23 and Phase 24 sets intact. Purely a bookkeeping discrepancy in a documentation section;
no security impact. Recorded because the report presents the number as a measured value.

---

### F-7 — Info — the Phase 24 report's own "brief counts do not match this tree" caveat is correct and worth carrying forward

The report notes the brief's regression figures (153/60/213/109+104) do not correspond to any lane
in this codebase, and re-measured. **I independently confirm this**: the real numbers are
unit 145 passed/44 skipped, integration 126, all-with-DB 315, no-DB 145/170, mobile 32, web 1. The
report's numbers are correct; the brief's are not. Credit for catching it.

---

## 5. Tests executed by this review

Every test below was run by this reviewer, against a throwaway database, on the working tree as
found. Reported test counts from the phase document were not accepted without re-execution.

| Item | Command | Result |
|---|---|---|
| API unit | `pnpm --filter @ecc/api test` (DB present) | **189 passed** (19 files) |
| API integration | `pnpm --filter @ecc/api test:integration` | **126 passed** (7 files) |
| API all, with DB | `pnpm --filter @ecc/api test:all` | **315 passed** (26 files) |
| API no-DB (CI shape) | `env -u DATABASE_URL pnpm --filter @ecc/api test:all` | **145 passed / 170 skipped** |
| Mobile | `pnpm --filter @ecc/mobile test` | **32 passed** (6 files) |
| Web | `pnpm --filter @ecc/web test` | **1 passed** |
| Root typecheck | `pnpm typecheck` | **11/11 tasks** |
| Root build | `pnpm build` | **7/7 tasks** |
| Build determinism | `pnpm --filter @ecc/api build:verify` | **PASS** (272 files, 0 spec/test in dist) |
| Lint | `pnpm --filter @ecc/api lint` | **124 problems, 55 errors, 69 warnings** — exactly the claimed baseline |
| `git diff --check` | | clean |
| `verify:routes` | `node apps/api/scripts/verify-route-authorization.mjs` | PASS — 57 live / 62 compiled, 8 public |
| `verify:metadata` | | PASS |
| `verify-config-contract` | | PASS |
| `verify-env-contract` | | PASS |
| `verify-dependency-audit` | | PASS (also exit 1 under injected drift) |
| `triage-vulnerabilities` | | PASS — 48 crit/high → 30 BUILD-TIME / 18 NOT REACHABLE / **0 REACHABLE** |
| `verify-db-migrations` | `bash scripts/verify-db-migrations.sh` | **15 PASS, 0 FAIL** |
| `verify-release-artifact` | | PASS (2969 standalone files, no baked secret) |
| `verify-ci-parity` | | PASS — **36 commands executed in workflow order, 0 failed**, 2 advisory |
| Container gate | `node scripts/verify-docker-images.mjs --skip-build` | **55 PASS, 0 FAIL** |
| Compiled-auth suite | `node apps/api/scripts/verify-compiled-auth-suite.mjs` | PASS — all 4 modes, plus the shared-secret precondition |
| `mutate-config-contract` | | **9/9** (8 mutants + unchanged-tree check) |

### Mutation tests executed

| Harness | Mutants | Result |
|---|---|---|
| `verify:lifetime:mutate` (D-2) | 2 | **2/2 detected** |
| `verify:routes:mutate` (D-4) | 5 | **5/5 detected** |
| **My own D-4 gate mutants** | 8 | 5 detected, 3 not (documented in D-4 / F-2 / F-3) |
| **My D-3 mount mutant** | 1 | detected — gate reports 62 live routes; e2e pin fails with 200 vs 404 |
| **My D-1 pin mutant** (TTL → 24 h) | 1 | detected — `expected 86400 to be 900` |
| **My triage negative tests** | 8 | 7 correctly red, 1 green (**F-4**) |
| `mutate-container-gate --only M7` (D-2) | 1 | **detected on exactly the targeted check** |
| `verify-ci-parity` mutation (remove the lifetime step) | 1 | detected — "not wired into CI" |

Not re-run: container mutants M1–M6 (Phase 23, expensive `--no-cache` builds, and Phase 24 recorded
7/7 across two runs with per-check attribution for M2–M4). I verified the harness's *mechanism*
(detection requires the targeted check to be among the reported failures, otherwise it prints the
gate output and counts the result inconclusive) by reading it and by M7, which is the Phase 24
addition. I document that M1–M6 were not independently re-executed.

### Direct probes I wrote (scratch files, since removed)

- **Body-route inventory from the compiled `dist`** — 21 body params, 19 mounted, **0 unvalidated
  whole-body**, 5 keyed exemptions listed with reason.
- **Token-lifetime matrix** against the compiled guard — 14 cases including adversarial future `iat`.
- **Live HTTP probe** of the compiled app in `NODE_ENV=production`: register, login, real token,
  6 token-lifetime cases, and the 5 care-task routes with and without a token.

---

## 6. Database isolation evidence

**The developer `ecc` database was never contacted.** The repository `.env` contains
`postgresql://ecc:***@localhost:5432/ecc`; no command in this review used it, and every
`DATABASE_URL` I set explicitly named a throwaway database.

| Resource | Purpose | Fate |
|---|---|---|
| `ecc-rv24-pg` (user `rv24`, db `rv24`, host port 55450) | API unit/integration/all lanes, the D-1/D-3 mutants, the compiled-auth suite | **destroyed** |
| `ecc-rv24-ci-pg` (user `ecc`, db `ecc_rv24`, host port 55470) | CI-shaped replicas of the two CI steps parity cannot run | **destroyed** |
| `p20-verify-postgres` / `p20-verify-storage` / `p20-verify-net` | created and destroyed by `verify-docker-images.mjs` itself | **destroyed by the gate; verified absent** |

Port 55433 was left free because `verify-db-migrations.sh` provisions its own container there
(it asserts both URLs target 127.0.0.1:55433 — I confirmed that assertion fires). The `p24`/`p23`
throwaway databases named in the phase documents were not reused; I created new ones with a `rv24`
prefix and the `rv` user so the two cannot be confused.

Post-review cleanup verified: no `ecc-rv24-*` containers, no `p20-verify-*` containers, no
`p24-mutant` images, no `node dist/main.js` processes, no scratch files in `apps/api/scripts/` or
`scripts/`, and `git status` identical to the session-start capture (75 entries).

---

## 7. CI parity results

`node scripts/verify-ci-parity.mjs`: **36 commands executed in workflow order, 0 failed**; 2 advisory
(API lint 55 errors, mobile lint 0 errors/18 warnings, both `continue-on-error` and both reported
honestly); 39 of 42 locally runnable; 3 need the hosted runner.

**The three CI steps parity cannot run were executed by hand** against a CI-shaped throwaway
PostgreSQL, reproducing the workflow's own commands:

1. **"production contract is enforced fail-closed"** — valid production config accepted; and with
   the Phase 24 `STORAGE_DIR=` fix, the API **refuses and names the variable**
   (`PASS: refused and named the variable`). **Phase 24's fix is real and necessary**: I confirmed
   the harness prints "skipping the signature-based token assertions" and **exits 0** without the
   secret, so the pre-fix step was a vacuous green.
2. **"Deployment smoke"** — liveness `{"status":"ok","service":"api"}`, readiness with database ok,
   clean SIGTERM drain. PASS.
3. **"authenticated round-trip"** — with the Phase 24 `JWT_ACCESS_SECRET` moved to the step `env:`,
   all assertions run and pass, including:
   - `ok 13 token-defect cases all -> 401`
   - `ok a ten-year-exp token issued now is accepted`
   - `ok a one-hour-old token with a ten-year exp -> 401 (D-2 closed: lifetime is bounded)`
   - `ok access token at /auth/refresh -> 401`

**Both Phase 24 CI fixes are therefore genuinely load-bearing and correctly placed**, and I proved
the failure direction, not just the success direction.

**I mutation-tested the CI-parity gate itself:** removing the `verify:lifetime:mutate` step from
`ci.yml` makes it fail with *"the gate `verify:lifetime:mutate` is not wired into CI"*. So the new
step cannot be deleted from CI without the gate noticing. `ci.yml` restored byte-identically
(`md5 44262da29764aa1fd42331b4b6ae63d0`).

**Shell-masking scan:** no `set +e`, no bare `|| true` on a check line, no `--warnings`,
`allow-failure`, or pipeline-masked assertions in the gates. The two `|| true` occurrences are both
inside the standard `trap 'kill -TERM $PID 2>/dev/null || true' EXIT` cleanup, which the parity gate
correctly exempts. Hardcoded `localhost:5432` credentials are confined to the CI service-container
steps and are correctly reported by parity as not-runnable-locally.

**Remote CI remains unverified.** GitHub Actions has still never run. The hosted runner, its service
containers, its action versions, its timeouts and the `30-minute`/`45-minute` job limits are all
unexercised. **This review claims no remote result and none exists.**

---

## 8. Security regression results (Phases 16–23)

| Control | Status | Evidence |
|---|---|---|
| HS256 pinning | **intact** | `algorithms: ['HS256']`; HS512 and `alg=none` both 401 (live + container gate) |
| Mandatory JWT `sub` | **intact** | no-`sub` token → 401; `sub: ''` and `sub: {$ne:null}` in the 13-case matrix |
| Production JWT fail-fast | **intact** | container gate: placeholder secret refused, exit 1; `resolveJwtAccessSecret` throws on `NODE_ENV=production` |
| Refresh rotation + reuse detection | **intact** | compiled-auth session mode; atomic conditional revoke; family revocation |
| Lockout | **intact** | 10 failures lock the account; `lockout` mode passes |
| Inactive / deleted account checks | **intact** | login, refresh and `/auth/me` all re-read |
| Membership status | **intact** | `AuthorizationService` filters `deletedAt: null, isActive: true` |
| `endsAt` | **intact** | present in the access-grant check; behaviour matrix green |
| OBSERVER restrictions | **intact** | role matrices in the 34-case authorization matrix |
| Document authorization / uploader branch | **intact** | `isUploader` check present; matrix green |
| `storageKey` stripping | **intact** | shared serializer destructures it out; "stored hash"/`storageKey` absent from responses |
| 0600 / 0700 | **intact** | container gate: `file=600 dir=700 roundtrip=ok`; group/other-readable `STORAGE_DIR` refused |
| `STORAGE_DIR` requirement | **intact** | production without it → exit 1 naming the variable |
| Path traversal containment | **intact** | `resolveContainment` rejects absolute, `../`, `..\`, and re-checks the resolved prefix |
| Request-ID sanitization | **intact** | `/^[A-Za-z0-9._:-]{1,64}$/`, otherwise a minted UUID |
| Production rate limiting | **intact, and not weakened** | bypass needs `NODE_ENV=test` **and** `ECC_TEST_DISABLE_RATE_LIMIT=1`; container gate proves it is armed in the image; config-contract mutant M8 proves losing the `NODE_ENV` guard is detected |
| Liveness / readiness | **intact** | liveness has no DB check; readiness is `SELECT 1`; both disclose only `status`/`service`/`database.status` |
| Graceful shutdown | **intact** | container gate: SIGTERM drains in 0.3 s, then connection refused |
| Immutable image filesystem | **intact** | container gate: `uid=1000 denied every write under /app`; tamper probes leave no trace |
| Non-root runtime | **intact** | both images run as uid 1000 |
| Migration behaviour | **intact** | 15/15 on throwaway databases; no unannotated destructive statement; enum shadow-type idiom |
| Compiled-artifact auth/DTO metadata | **intact** | `verify:metadata` PASS; `verify:routes` PASS; mutants M4/M5 and my R1/R2/R6 all detected |
| Bounded token verification lifetime | **effective for normal issuance; see F-1** | `maxAge` present and enforced; M7 detects its removal on the correct check |

**No control was weakened, relaxed or made conditional by Phase 24.** One control was *added*
(`maxAge`). The rate limiter's test bypass is unchanged and remains inert outside
`NODE_ENV=test` + the dedicated flag. No new test-only path, flag or environment variable was
introduced into production code by Phase 24.

---

## 9. Phase 25 contamination scan

Scanned `apps/api/src`, `apps/web/src`, `apps/mobile/src`, `packages/*/src` and the workflow for:
WebSockets/realtime, AI/LLM/OCR, notifications/push/SMS/email, GPS/EHR, payments/subscriptions,
dashboard redesign, cloud/Kubernetes/Terraform/Helm, Redis/MinIO/S3, backup infrastructure.

**Result: NONE.** Four keyword hits, all substring false positives:

| Hit | Actual match |
|---|---|
| `LLM` ×2 | `vi.clearAllMocks()` in mobile specs |
| `OCR` ×1 | `docResult` in a document-service spec |
| `sms` ×2 | the `'SMS'` channel enum value in the pre-existing notification DTOs |
| `helm` ×1 | `import helmet from 'helmet'` in `main.ts` |

**No new product feature, no new dependency, no new configuration, and no new Prisma schema or
migration.** `PROJECT_PLAN.md` and `PROJECT_PLAN-old.md` are in the same state Phase 24 left them
(Phase 24 states it did not touch them; `PROJECT_PLAN.md`'s diff is 1272 lines and contains no
reference to Phase 24 or Phase 25 — it is Phase 18–23 work). No `SECURITY_REVIEW_PHASE_24.md` or
other review artifact was modified by this review; the only file this review creates is this one.

**Phase 25 has not started.**

---

## 10. Known limitations of this review

- **Remote CI is unverified.** Everything was run locally on Node 24.18.0 / pnpm 11.25.0 /
  Docker 29.8.1. The hosted runner, its service containers, its action versions and its job
  timeouts are unexercised. **No remote result is claimed.**
- **Container mutants M1–M6 were not re-run.** I ran M7 (the Phase 24 addition) and verified the
  harness's attribution mechanism by reading it. M1–M6 are Phase 23's; Phase 24 recorded 7/7
  across two runs with per-check attribution for M2–M4, including an honest record of two
  inconclusive entries in the first run. I did not independently reproduce that.
- **The container gate was run with `--skip-build`** against images built from this tree (verified:
  the image's `dist` carries `maxAge`), which is the 55-check shape. The 2 build checks and the
  57/57 full-build figure were not re-measured by me; free disk (6.6 G at the time, below the
  harness's own 20 G floor) made a from-scratch image build impractical.
- **`pnpm audit` is a moving input.** My figures are a 2026-09-29 snapshot: 92 advisories, 4
  critical + 44 high = 48 critical/high, of which 23 are `next`. Phase 24 recorded 48 crit/high
  too, but "not the same 48". Advisory counts must be re-derived at release, not stored.
- **The postcss and Expo-toolchain reachability arguments are static arguments about code paths**,
  not proof of absence. They do fail closed when the code changes.
- **The D-6 deferral is fragile by construction** — "not reachable" rests on the app declaring no
  Server Actions, middleware, rewrites or image optimization. F-4 makes the *rewrites* half of that
  tripwire currently unreliable.
- **No load, performance, penetration or fuzz testing** was performed, and nothing here replaces
  it.
- **A forward-dated `iat` is the one place I found where the D-2 control does not behave as
  documented**; I did not attempt to enumerate other `jsonwebtoken` verification subtleties beyond
  the cases listed in §D-2.

---

## 11. Final checkpoint verdict

**No Critical or High defect was found.** No Phase 24 fix was found to be ineffective as claimed:
both D-2 and D-4 are real, and both are proven load-bearing by independent mutation testing against
the compiled artifact, a live production-mode process, and a rebuilt image. All seven deferrals are
individually justified and none is an accidental bypass. The three CI workflow defects Phase 24
claims to have fixed are genuinely fixed, and I demonstrated the failure direction for two of them.
Four of Phase 24's own reported verification defects reproduce as described and are genuinely
repaired.

Against that, the D-4 gate has a metatype-only blind spot (F-2) and a keyed-`@Body` scoping
boundary (F-3); the CI-parity gate and the container gate are both genuinely load-bearing (I
mutation-tested both); and the "4/4 negative tests" row in the phase report is **not reproducible for
`rewrites`** in the form that matters (F-4). None of these is a product exposure today.

**VERDICT: APPROVED WITH FINDINGS.**
- No Critical, High, or Medium product defect.
- Two Medium findings requiring follow-up: **F-1** (the D-2 bound does not hold against a
  forward-dated `iat`, and two documented guarantees overstate it) and **F-4** (the D-6 `rewrites`
  triage rule cannot detect a working Next.js `rewrites()`).
- F-1 should be closed before the D-2 finding is described as closed anywhere a reader might act on
  it, and the `min(exp, iat + 15m)` / "oldest token … is ACCESS_TOKEN_TTL_SECONDS old" wording
  should be corrected.
- F-4 should be closed before the next release, because it silently disarms two HIGH-advisory
  tripwires.
- Three Low and four Info findings are non-blocking and accurately recorded above.
- **The checkpoint may be accepted** on the strength of the two real fixes; the Medium findings are
  carried forward, not waived.

**No remote CI success is claimed. No Phase 25 work was started. Nothing was committed, amended,
reset, rebased, stashed or pushed.**
