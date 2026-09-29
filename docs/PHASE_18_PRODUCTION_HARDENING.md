# Phase 18 — Production Hardening & Reliability

**Checkpoint base:** `d0cd0dd` — Complete Phase 17 testing CI and reliability
**Status:** Implementation and verification complete. **No commit created.**
**Scope:** Production/reliability hardening only. No product features. Phase 19 NOT started.

---

## 1. Objective

Resolve the five verified findings left open by the Phase 17 independent
security/reliability review (M-01, L-01, L-02, L-03, L-04), give each one
behavioural regression coverage, make the production build deterministic, and
perform a focused production-hardening review of application configuration —
without introducing any application feature.

## 2. Starting checkpoint

```text
HEAD: d0cd0dd  Complete Phase 17 testing CI and reliability
Parent: c615e2b  Complete Phase 16 security remediation
Working tree at start:
  M PROJECT_PLAN.md            (pre-existing user edit — NOT touched in Phase 18)
 ?? PROJECT_PLAN-old.md        (pre-existing, untracked)
 ?? SECURITY_REVIEW_PHASE_16.md (pre-existing, untracked)
 ?? SECURITY_REVIEW_PHASE_17.md (pre-existing, untracked)
```

Each finding was **re-verified on the current HEAD before any change was made**;
all five were confirmed present. No history was rewritten: no reset, rebase,
amend, or force-push was performed.

## 3. Findings addressed

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| M-01 | MEDIUM | Warm `tsbuildinfo` can make `nest build` exit 0 while emitting nothing | **FIXED** |
| L-01 | LOW | Document upload response exposes internal `storageKey` | **FIXED** |
| L-02 | LOW | OBSERVER (and any non-granted member) can list document grants | **FIXED** |
| L-03 | LOW | Rate-limit bypass driven by a broad, production-readable env var | **FIXED** |
| L-04 | LOW | Concurrent emergency transition surfaces 500 to the losing request | **FIXED** |

Plus three findings of my own from the Workstream 6 review (H-1…H-3, §14).

## 4–6. Root cause, remediation, and security effect

### M-01 — silent zero-emit production build

**Root cause.** `packages/config/tsconfig.base.json` sets `"incremental": true`,
inherited by `apps/api/tsconfig.build.json`. `apps/api/nest-cli.json` sets
`deleteOutDir: true`, so `nest build` deletes `dist/` *before* compiling. On a
second build with unchanged sources, tsc consulted `tsconfig.build.tsbuildinfo`,
concluded every output file was already up to date, and emitted nothing —
leaving `dist/` empty while the command still exited 0.

**Reproduced on the current HEAD before fixing:**

```text
BUILD 1 (clean): rc=0  main.js: PRESENT
BUILD 2 (warm) : rc=0  main.js: MISSING   dist entries: 0
```

**Remediation.** `apps/api/tsconfig.build.json` now sets
`"incremental": false`, making every production build a full emit.

Type-checking strength is **unchanged** — `incremental` only controls whether
tsc may *skip re-emitting* unchanged files, never whether it type checks them.
`tsconfig.json` (used by `tsc --noEmit`) and `tsconfig.test.json` deliberately
keep incremental compilation, which is safe because `--noEmit` produces no
output that could be deleted underneath tsc.

**Security/reliability effect.** A build can no longer report success without
producing a runnable artifact. Previously a release or CI step trusting the
exit code could ship or run a build with no `dist/main.js` at all.

### L-01 — internal storage key in the upload response

**Root cause.** Three response paths sanitized independently.
`getDocument` destructured away `storageKey`/`contentHash`; `listDocuments`
avoided them via a Prisma `select`; but `createDocument` returned the raw row
spread — `return { ...document, sizeBytes: Number(...) }` — where `document` is
a full `healthDocument.create()` result. The 201 upload body therefore carried
`storageKey` (the internal storage path) and `contentHash` (SHA-256 of the
stored bytes) even though no client-side use exists for either.

**Remediation.** Introduced a single module-level serializer
`toPublicDocument()` in `document.service.ts` and routed **all three** paths
through it, so the invariant is single-sourced and cannot drift again. It
enforces both properties: BigInt → JSON number, and strip `storageKey` +
`contentHash`.

**Security effect.** Internal storage implementation details are no longer
disclosed to clients. Server-side use of `doc.storageKey` for retrieval is
untouched, so download behaviour is unchanged.

### L-02 — grant listing readable by any circle member

**Root cause.** Phase 16 finding **A11** identified `listGrants` as requiring
"senior access (any role incl. OBSERVER)". The Phase 16 remediation removed the
*grantee PII* (the `user: { fullName, email }` include) but left the
*authorization level* untouched, so the residual L-02 remained:
`listGrants` called only `assertCanAccessSenior` and did not even call
`verifyDocumentAccess`. Any active member — including OBSERVER, and including
members with no grant at all — could enumerate who holds access to which
document, and until when.

**Intended matrix.** Derived from the existing implementation, not invented:
- grant **management** (`grantAccess`/`revokeGrant`) and `archiveDocument`
  require `FAMILY_ADMIN` or `DOCTOR`;
- document **content** access (`getDocument`/`downloadDocument`) is the
  Phase 16 two-layer model: uploader **or** an active grant;
- `listDocuments` (metadata listing) is open to any active member.

Grant listing is **access-control metadata**, so it belongs with the
management tier, plus the uploader, who is already privileged for their own
document in `verifyDocumentAccess`. The Phase 12 doc predates the Phase 16
two-layer model and recorded "JWT + active circle"; the current code and
Phase 16 A11 supersede it.

**Remediation.** `listGrants` now requires `FAMILY_ADMIN`, `DOCTOR`, **or** the
document's uploader, enforced **in the service layer** (not only the
controller) via the existing `AuthorizationService.getMemberRole`. No new
authorization model was introduced; the same helper the other grant operations
use is reused.

**Security effect.** Access-topology metadata is no longer disclosed to roles
that cannot open the document. A member who *has* been granted the document
can still read it, but cannot enumerate the grant list — a grant confers
document access, not steward rights.

### L-03 — environment-variable rate-limit bypass

**Root cause.** Phase 17 bypassed the limiter with:

```ts
if (process.env['NODE_ENV'] === 'test') return true;
```

`NODE_ENV` is a broad, generic, production-readable variable. It is set to
`test` by many CI images, container base images and PaaS templates — including
**this repository's own CI job**, which sets `NODE_ENV: test` at job level. Any
deployment running with `NODE_ENV=test` would silently lose rate limiting on
every rate-limited route (all of `auth.controller.ts`) while still reporting
healthy. No client can influence it (it is a server process variable), but the
failure mode is a silent security downgrade, not an exploit.

**Remediation.** The bypass now requires **both** conditions:

1. `NODE_ENV === 'test'` — an unambiguous test environment, and
2. `ECC_TEST_DISABLE_RATE_LIMIT=1` — a dedicated, test-only variable.

Resulting matrix:

| Environment | Limiter |
| --- | --- |
| production / staging / development | **always enforced** |
| `NODE_ENV=test`, flag absent | enforced (`NODE_ENV=test` alone no longer disables anything) |
| `NODE_ENV=test`, flag=`1` | bypassed (deterministic suites) |

`src/testing/setup-env.ts` sets the flag so the HTTP suites stay deterministic.

**Security effect.** Rate limiting can no longer be disabled in production by
any environment setting short of the deliberate test-runner combination. It is
strictly stronger than Phase 17: previously `NODE_ENV=test` alone was enough in
*any* environment; now it is not enough in production, staging, or development.

### L-04 — 500 on a lost emergency-transition race

**Root cause.** Each transition performs a race-safe conditional update
(`where: { id, seniorId, status: <expected> }`) inside a transaction that also
writes the audit row. That mechanism is correct and was **not** changed. The
defect was purely in error mapping: when a concurrent writer won the race, the
conditional update matched no row and Prisma raised **P2025** ("record to
update not found"). P2025 is not an `HttpException`, so `GlobalExceptionFilter`
mapped it to **500 INTERNAL_ERROR** — a server fault for what is an expected,
legitimate client-visible outcome.

The identical pattern existed in all three transitions (`acknowledgeAlert`,
`resolveAlert`, `cancelAlert`), not only the acknowledged one.

**Remediation.** Added `rethrowTransitionLoss()`, attached to all three
transactions. It maps **only** P2025 to the same `ForbiddenException` the
pre-check already raises for an ordinary invalid transition, and re-reads the
alert's real status so the message distinguishes already-`ACKNOWLEDGED` /
already-`RESOLVED` / already-`CANCELLED`. Any other error keeps its original
handling, so genuine database failures are not mislabelled.

**Security/reliability effect.** The state machine is not weakened: the
conditional `status` predicate still guarantees exactly one transition, and
because the audit insert is in the same transaction a losing writer rolls back
and produces **no** audit row. A lost race is now an intentional, documented
403 rather than a 500. The four failure modes are cleanly distinguished:

| Case | Response |
| --- | --- |
| successful transition | `201` with the new state |
| already acknowledged/resolved/cancelled | `403` `FORBIDDEN`, "Invalid transition: cannot … from &lt;STATE&gt;." |
| unauthorized role | `403`, without an "Invalid transition" message |
| nonexistent / cross-senior | `403` (route senior mismatch) or `404` (resource absent) |

## 7. Files changed

**Created (4)**

- `apps/api/scripts/verify-build-determinism.mjs` — M-01 behavioural guard
- `apps/api/src/config/build-config.spec.ts` — M-01 config invariant (6 tests)
- `apps/api/src/storage/storage.service.spec.ts` — H-1/H-2 (7 tests)
- `apps/api/src/common/middleware/request-id.middleware.spec.ts` — H-3 (9 tests)

**Modified (13)**

- `apps/api/tsconfig.build.json` — M-01 fix
- `apps/api/package.json` — added `build:verify` script
- `.github/workflows/ci.yml` — added the build-determinism gate
- `apps/api/src/modules/documents/services/document.service.ts` — L-01, L-02
- `apps/api/src/modules/emergency/services/emergency.service.ts` — L-04
- `apps/api/src/auth/guards/rate-limit.guard.ts` — L-03
- `apps/api/src/auth/guards/rate-limit.guard.spec.ts` — L-03 tests (4 → 10)
- `apps/api/src/testing/setup-env.ts` — set the L-03 opt-out flag
- `apps/api/src/storage/storage.service.ts` — H-1, H-2
- `apps/api/src/common/middleware/request-id.middleware.ts` — H-3
- `apps/api/.env.example` — document `STORAGE_DIR`; correct stale entries
- `apps/api/test/documents.security.e2e-spec.ts` — L-01/L-02 tests (9 → 12)
- `apps/api/test/emergency.security.e2e-spec.ts` — L-04 tests (8 → 10)

**Deleted:** none.

## 8. Tests added / changed

All behavioural; no placeholder assertions. Suites: **157 → 190** (+33).

| Location | Change |
| --- | --- |
| `src/config/build-config.spec.ts` | **+6** — build config invariant for M-01 (incremental disabled, no composite, strict flags intact, exclusions intact, dev configs keep incremental) |
| `src/storage/storage.service.spec.ts` | **+7** — 0700 dir, 0600 files, nested dir perms, production requires `STORAGE_DIR`, traversal still rejected |
| `src/common/middleware/request-id.middleware.spec.ts` | **+9** — valid ids honoured; injection/log-forging/markup/over-length values replaced by a UUID; array header ignored; 64-char boundary |
| `src/auth/guards/rate-limit.guard.spec.ts` | 4 → **10** — budget/per-IP behaviour; production enforces budget; production refuses the flag; `NODE_ENV=test` alone no longer bypasses; flag alone in dev does not bypass; wrong flag value does not bypass; test+flag bypasses |
| `test/documents.security.e2e-spec.ts` | 9 → **12** — upload response has no `storageKey`/`contentHash`, `sizeBytes` is a number, values absent from body but still present in the DB row; grant responses leak no storage internals; L-02 role matrix (permitted admin/doctor/uploader; denied OBSERVER/member/caregiver/expired/outsider; cross-senior 404; granted-member can read but not enumerate) |
| `test/emergency.security.e2e-spec.ts` | 8 → **10** — strengthened double-ack to assert the loser is exactly `403 FORBIDDEN` with "Invalid transition" + real state (replacing `status >= 400`); new race sweep across ack/resolve/cancel asserting one winner, one loser, one audit row, correct final state; new four-failure-mode distinction test |

**Negative controls (proving the tests really detect the defects):**
- Re-enabling `"incremental": true` makes `build:verify` **exit 1** with
  `dist/main.js` missing.
- Removing the L-02 authorization block makes the L-02 test **fail** (OBSERVED).

## 9. Test results

All run against a **fresh, isolated PostgreSQL database** (`ecc_p18`) created
in the repo's running `postgres:16-alpine` container, populated with
`prisma migrate deploy`. The development database was not used.

| Lane | Result |
| --- | --- |
| API unit (`test`) | **PASS** — 15 files / **130 passed** |
| API integration (`test:integration`) | **PASS** — 5 files / **60 passed** |
| API all (`test:all`, with DB) | **PASS** — 20 files / **190 passed**, 0 failed, 0 skipped |
| API all (no `DATABASE_URL`, CI shape) | **PASS** — 9 files / 86 passed / 104 DB-gated skipped / 0 failed |
| Mobile (`@ecc/mobile test`) | **PASS** — 6 files / **32 passed** |
| Web (`@ecc/web test`) | **PASS** — **1 passed** |
| Root `pnpm test` (turbo) | **PASS** — 11/11 tasks |

## 10. Typecheck results

| Target | Result |
| --- | --- |
| API — `tsconfig.json` + `tsconfig.seed.json` + `tsconfig.test.json` | **PASS — 0 errors** |
| Mobile — `tsc --noEmit` | **PASS — 0 errors** |
| Web — `tsc --noEmit` | **PASS — 0 errors** |

An intermediate failure was caught and fixed during this phase: the first
`build-config.spec.ts` used `import.meta.url`, which vitest tolerated but `tsc`
correctly rejects under the API's CommonJS module setting. Resolved via
`process.cwd()` with an explicit existence check.

## 11. Build results

| Check | Result |
| --- | --- |
| API build — clean state | **PASS** — `dist/main.js` present |
| API build — warm, unchanged sources (the M-01 case) | **PASS** — `dist/main.js` present |
| API build — warm, 3rd consecutive run | **PASS** — `dist/main.js` present |
| API build — stale/hostile `tsconfig.build.tsbuildinfo` present | **PASS** — `dist/main.js` present (state ignored) |
| `build:verify` (clean + warm + stale, with hygiene assertions) | **PASS** |
| Test helpers excluded from `dist` | **PASS** — 0 spec files, no `dist/testing`, `buildCareFixture` not present |
| Web production build (`next build`) | **PASS** — static pages prerendered |

## 12. Lint results

| Target | Result |
| --- | --- |
| API lint | **55 errors / 128 warnings — identical to the Phase 17 checkpoint** |
| Phase 18 authored/modified files | **0 errors, 0 new warnings** |
| Mobile lint | 0 errors / 8 warnings — **pre-existing**, unchanged (Phase 18 made zero mobile changes) |
| Web lint | **PASS** — 0 problems |
| `git diff --check` | **clean** |

No lint rule was disabled and no existing debt was hidden. The 55 API errors
are all pre-existing `no-explicit-any` in untouched legacy code
(`document.service.ts` ×4, `emergency.service.ts` ×7, and others), confirmed
against the `d0cd0dd` blobs. Seven warnings introduced in my own new code during
the first pass were removed (unused imports, inline `import()` type
annotations, import ordering), returning the project to exactly the baseline
55/128.

## 13. Database / migration status

**No Prisma schema or migration changes were required.**

`prisma/schema.prisma` and `prisma/migrations/` are untouched. Every Phase 18
change is confined to application code, build configuration, test
infrastructure, and the CI workflow. `prisma validate` and
`prisma migrate deploy` both pass against a fresh database.

## 14. Production-hardening review results (Workstream 6)

Read-only review of application configuration. Three issues were found and
remediated because they were both in scope and evidence-backed:

**H-1 — Document files written with default (world-readable) permissions.**
`storage.service.ts` called `fs.mkdirSync(baseDir, { recursive: true })` and
`fs.writeFileSync(target, buffer)` with no explicit mode, so permissions came
from the process umask — commonly 0755 for directories and **0644 for files**,
leaving medical records readable by every other account on the host.
*Remediation:* directories created `0o700`, files written `0o600`.

**H-2 — Development storage fallback could activate in production.**
`baseDir = process.env['STORAGE_DIR'] ?? path.resolve(process.cwd(), 'uploads')`
silently wrote protected health information into the application directory,
where it risks being baked into a container image, exposed by any static file
handler, or permission-dependent. *Remediation:* `STORAGE_DIR` is now
**required** when `NODE_ENV=production` and the process refuses to start
otherwise — mirroring the existing fail-fast treatment of `JWT_ACCESS_SECRET`
in `security-config.ts`. The development fallback is retained.

**H-3 — Inbound `x-request-id` echoed verbatim into responses and logs.**
The value was accepted as any string ≤200 chars and then echoed into the
response header, the JSON error body, and prefixed onto server log lines — a
log-forging / response-injection vector. (Node's HTTP parser already rejects
raw CR/LF in header values, so newline injection was not reachable, but
arbitrary text was accepted.) *Remediation:* inbound ids are honoured only if
they match `/^[A-Za-z0-9._:-]{1,64}$/`; otherwise a UUID is minted. Genuine
correlation (UUIDs, trace ids) is unaffected.

**Also corrected:** `apps/api/.env.example` did not mention `STORAGE_DIR` at
all, and still advertised `JWT_REFRESH_SECRET` (no such variable exists —
refresh tokens are CSPRNG secrets) and `WEB_ALLOWED_ORIGINS` (no CORS
configuration exists in the codebase). Both were verified unused by grep and
the file was rewritten to document the real mandatory production variables.

**Reviewed and found already sound (no change):** JWT secret fail-fast
(`security-config.ts`); refresh cookie `httpOnly` + `sameSite: strict` +
`secure` in production + path-scoped to `/api/v1/auth/refresh`; HS256 pinning
and mandatory `sub` in `JwtAuthGuard`; account lockout; `isActive` checks on
refresh; `GlobalExceptionFilter` returns no stack traces or internal messages;
storage path-traversal containment (absolute paths, `../`, and resolved
containment all rejected); audit metadata free of message bodies and storage
keys.

**Deferred — documented, not implemented (out of Phase 18 scope):**

| Item | Why deferred |
| --- | --- |
| CORS is not configured | Nest's default is same-origin only, which is the *secure* default; it is a functional prerequisite for the web dashboards, belonging to a web-integration phase, not a hardening phase |
| No centralized production env-var validation module | Only `JWT_ACCESS_SECRET` (and now `STORAGE_DIR`) fail fast. A full config-validation module is deployment work |
| Rate limiter is still an in-process placeholder (audit A13) | Not shared across replicas; a real limiter belongs with deployment/scaling decisions |
| Storage is local filesystem only (no S3/MinIO adapter) | Single-node is sufficient today; an object-storage adapter is a deployment concern. MinIO sits unused in `docker-compose.yml` |
| `LOG_LEVEL` is read from env but unused by the logger | Structured logging is observability work for a later phase |
| `docker-compose` service DB credentials and CI secrets are literals | Ephemeral, single-use, scoped to CI/dev containers; rotation is a deployment concern |

## 15. Known limitations

- The new `build:verify` script takes ~30s (three full compiles) and runs in
  CI only; developers get the fast `build:verify`-free `pnpm build`, which is
  now correct in both clean and warm states.
- The storage permission fix applies to directories and files the service
  creates. A pre-existing `uploads/` tree created before this phase keeps
  whatever mode it already had and should be tightened by an operator.
- `rethrowTransitionLoss` performs one extra read to produce an accurate
  message. That is on a rare path only.
- L-02 narrows grant listing. No legitimate consumer of that endpoint exists in
  the repository (the web app has no document UI), so no first-party consumer
  is affected.
- The review database used here (`ecc_p18`) and the built `dist/` are ephemeral
  local artifacts, not committed.
- The remote GitHub Actions workflow has still not been executed (no push). The
  added `build:verify` step is the one CI change that cannot be validated
  remotely until then; its command was executed locally and passed.

## 16. Deferred findings / future-phase items

Recorded here rather than implemented, per the phase boundary:

- **Product/functional (needs a product phase, not hardening):** there is no
  endpoint to create a senior or manage a care circle, so a newly registered
  user has no senior context and every `seniors/:seniorId/*` route is
  unreachable; the mobile app hardcodes a senior UUID that does not exist in
  the seed; the web app has no authentication and its role dashboards are
  static stubs.
- **Deployment phase:** containerization of the apps, staging environment,
  HTTPS/domain, backups, migration-on-deploy, rate-limit replacement, S3
  storage adapter, CORS for the web client.
- **Observability phase:** structured JSON logging with PHI redaction, metrics,
  error tracking, alerting.

## 17. Phase 19 was NOT started

No deployment/operations work, realtime architecture, WebSockets, push/SMS/email
providers, AI/LLM, OCR, EHR integration, GPS, new dashboard or mobile product
features, new emergency or document features, care-management features,
payment/subscription systems, broad refactoring, UI redesign, or unrelated
dependency upgrades were implemented. No placeholder or stub implementation
for any future phase was created. `PROJECT_PLAN.md` and
`PROJECT_PLAN-old.md` were **not** modified. No `SECURITY_REVIEW_*` artifact was
modified or deleted. **No Git commit was created.**

---

## 18. Post-review cleanup (P18-01, P18-02)

The independent Phase 18 review returned
**APPROVED FOR PHASE 18 CHECKPOINT** (Critical 0, High 0, Medium 0, Low 2,
Info 3). Its two Low findings were then addressed in a narrowly scoped
follow-up. **No production logic, authorization decision, token lifetime, or
runtime behaviour was changed** — the two edits are documentation accuracy and
regression coverage only.

**P18-01 — stale environment variables (documentation).** `JWT_ACCESS_TTL`,
`JWT_REFRESH_TTL` and `LOG_LEVEL` were confirmed by grep to be read nowhere in
the application (their only occurrence was the `apps/api/.env.example` line
itself). Access-token lifetime (`15m`, hardcoded in `app.module.ts`,
`auth.module.ts`, `auth.service.ts`) and refresh-cookie lifetime (30d, hardcoded
in `auth.controller.ts`) are unchanged. The three variables were removed from
`.env.example` and replaced with a comment stating that the lifetimes are
fixed in code and intentionally not environment-configurable.

**P18-02 — L-02 uploader-branch coverage (tests).** The reviewer correctly
observed that every "permitted" case in the L-02 test coincided with a steward
role, so the `isUploader` allowance was never exercised on its own, and one
assertion was a duplicate request. The test now includes a decisive contrast
pair using `CAREGIVER` — a non-steward role that *is* permitted to upload:

- CAREGIVER lists grants on the document **it uploaded** → `200`, with
  `uploadedByUserId` read back from the database to confirm the identity
  premise. Because `CAREGIVER` is neither `FAMILY_ADMIN` nor `DOCTOR`, a `200`
  is reachable only through the uploader allowance.
- The **same user**, on the **same endpoint**, against a document it did **not**
  upload → `403` "Not permitted", proving the allowance keys on uploader
  identity rather than generalizing to circle members.

The steward-role branch is now also exercised without role/uploader overlap
(FAMILY_ADMIN reading the DOCTOR's document and vice versa), the duplicate
request was removed, a dead `doctorDoc` assignment (uploaded but never
referenced) was replaced with a real assertion, and all previously covered
denials (OBSERVER, FAMILY_MEMBER, expired membership, outsider, cross-senior
`404`, granted-member) are retained. The `listGrants` implementation was not
modified.

**Post-cleanup verification:** API unit 130/130 · API integration 60/60 · API
all 190/190 (with DB) and 86 pass + 104 DB-gated skipped (no DB) · mobile
32/32 · web 1/1 · API/mobile/web typecheck 0 errors · API build clean + warm
(`dist/main.js` present, no test artifacts) · `build:verify` PASS · web build
PASS · API lint 55 errors / 127 warnings (errors unchanged; one warning fewer
because the dead variable was removed) · `git diff --check` clean.

---

**Status:** implementation, tests, verification, and the post-review cleanup
are complete. Awaiting the confirmatory independent Phase 18 review.
