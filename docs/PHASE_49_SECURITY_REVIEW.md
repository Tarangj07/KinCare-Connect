# Phase 49 Independent Security Review

**Subject:** Phase 49 — Senior Access & Care-Circle Onboarding Foundation
**Reviewer:** Independent review (no participation in the Phase 49 implementation)
**Date:** 2026-10-01
**Nature:** **Independent security review only.** This is **not** a penetration test, a compliance assessment, a load/soak test, or a production-readiness certification.

---

## 1. Scope

This review independently attempts to break the Phase 49 senior-access and care-circle-onboarding guarantees. It treats `docs/PHASE_49_FINAL_REPORT.md` as **evidence to inspect, not an authority**, and independently re-derived the authorization model from the Prisma schema, `AuthorizationService`, the new services/controllers/DTOs, and existing senior-scoped services.

The primary property tested:

> A user may obtain access to a senior only through a legitimate `CareCircleMember` relationship, and a user without a valid active membership must not gain senior access.

**No source code, test, Prisma schema, migration, or existing documentation was modified.** All runtime testing used disposable throwaway PostgreSQL instances. Section 31 records the verified git boundary.

---

## 2. Starting state

```
git rev-parse HEAD        = d4c570bb56a1bef38b009e7890469b9b84bac5e3
git rev-parse origin/main = d4c570bb56a1bef38b009e7890469b9b84bac5e3
git status --short
 M apps/api/src/app.module.ts
?? apps/api/src/modules/care-circle/
?? apps/api/test/onboarding-access.e2e-spec.ts
?? docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md
?? docs/PHASE_49_FINAL_REPORT.md
git diff --stat
 apps/api/src/app.module.ts | 4 ++++
git diff --name-only
 apps/api/src/app.module.ts
```

State matched the expected Phase 49 working tree. A SHA-256 manifest of **156** files (`apps/api/src`, `apps/api/prisma`, `apps/api/test`, `docs/*.md`) was recorded before any review activity and re-verified at the end (§31): **all 156 files byte-identical.**

---

## 3. Components reviewed

| Component | Files | Notes |
|---|---|---|
| New controllers | `care-circle/seniors.controller.ts`, `me.controller.ts`, `care-circle.controller.ts` | 6 routes, all `JwtAuthGuard` + `RolesGuard`, none `@Public()` |
| New services | `care-circle/services/senior.service.ts`, `care-circle.service.ts` | Onboarding + resolution + circle/membership mutation |
| New DTOs | `dto/create-senior.dto.ts`, `create-care-circle.dto.ts`, `add-circle-member.dto.ts` | strict whitelist via global `ValidationPipe` |
| New module | `care-circle/care-circle.module.ts`, `app.module.ts` (+4 lines) | registration |
| Authorization | `auth/authorization.service.ts` | **verified byte-identical to the checkpoint** (`4c1b8995…`) |
| Guards | `auth/guards/auth.guard.ts`, `roles.guard.ts`, `rate-limit.guard.ts` | |
| Prisma schema | `apps/api/prisma/schema.prisma` + `prisma/migrations/` | **verified unmodified** |
| Existing senior-scoped services | medications, appointments, emergency, documents, messaging, feed, health/measurements | to derive the pre-existing role policy independently |
| Audit | `auditLog.create` call sites (inline, inside `$transaction`) | |
| Compiled artifact | `verify:routes`, `verify:metadata` on `dist/` | |
| Tests | `authorization.db.spec.ts`, `authorization-matrix.security.e2e-spec.ts`, `resources.security.e2e-spec.ts`, `emergency.security.e2e-spec.ts`, `documents.security.e2e-spec.ts`, `messaging.security.e2e-spec.ts`, `onboarding-access.e2e-spec.ts` | |
| Runtime | built `dist/main.js` under `NODE_ENV=production` against throwaway PostgreSQL | two harnesses, ~130 assertions |

### 3.1 Authorization model as independently derived

`AuthorizationService` grants access only via `careCircleMember` rows matching **all** of:

| Predicate | Source |
|---|---|
| `userId === caller` | `membershipWhere(userId, …)` |
| `status === 'ACTIVE'` | `membershipWhere` |
| `deletedAt === null` (membership) | `membershipWhere` |
| `endsAt === null \|\| endsAt > now` | `membershipWhere` (Phase 16 H10/A3) |
| circle `deletedAt === null` **and** `isActive === true` | `canAccessSenior` circle lookup |
| senior `deletedAt === null` **and** `isActive === true` | `canAccessSenior` senior lookup |

`role` is **not** an access predicate — it gates specific actions. Senior-scoped actions I confirmed from source (not from the report), e.g. medication create = `FAMILY_ADMIN`/`DOCTOR` only; emergency create excludes `OBSERVER`.

---

## 4. Threat model

IDOR across seniors/circles/members · privilege escalation and `FAMILY_MEMBER → FAMILY_ADMIN` · unauthorized membership manufacture · role confusion · `endsAt` and `ENDED`-status bypass · deleted/inactive senior or circle bypass · senior, circle, member and platform-user enumeration · mass assignment / DTO injection · transaction partial state · race conditions on membership and circle mutation · audit-log manipulation or spoofing · divergence between `GET /me/seniors` and the real authorization decision · deactivation/deletion of actors · token-lifetime semantics.

---

## 5. Positive security controls (verified)

Approximately **130 assertions passed**. Highlights:

**Identity binding**
- All 12 mass-assignment payloads rejected with `400`: `userId`, `createdById`, `id`, `role`, `status`, `endsAt`, `deletedAt`, `isActive`, `globalRole`, `seniorProfileId`, `careCircles[]`, `careCircleMembers[]`, `seniorId`.
- Onboarding writes `CareCircle.createdById` and `CareCircleMember.userId` **only** from the verified JWT subject — verified by reading the row back after the call. There is no request field from which a target identity can be supplied.
- `JwtAuthGuard` populates `req.user` from a verified HS256 token; no `@Public()` on any new route; `verify:routes` confirms all 6 new routes carry guards and bind constrained DTO classes in the **compiled** artifact.

**IDOR / isolation** — 14 vectors, all denied `403` for an unrelated authenticated user: roster read, member add, member delete, circle create for a foreign senior, and read/write across medications, appointments, measurements, documents, emergency alerts, feed, conversations. Cross-circle member-id substitution: valid `memberId` under a foreign circle → `404`; foreign `memberId` under a caller's own circle → `403`. Valid-but-foreign senior/circle pairs → `403`/`403`.

**`GET /me/seniors` ↔ `AuthorizationService` predicate parity** — ten state-mutation scenarios, asserting `listed === authorized` every time:

| Scenario | listed | authorized |
|---|---|---|
| baseline ACTIVE | true | true |
| `endsAt` in the past | false | false |
| `status = ENDED` | false | false |
| `status = PENDING` | false | false |
| membership `deletedAt` set | false | false |
| `endsAt === now` exactly | false | false |
| circle `deletedAt` set | false | false |
| circle `isActive = false` | false | false |
| senior `deletedAt` set | false | false |
| senior `isActive = false` | false | false |

**No predicate drift found.** A `seniorId`-only participation row (`userId = null`) grants nothing to anyone.

**Role matrix** — `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR`, `OBSERVER` all: read senior `200`, read roster `200`, create circle `403`, grant `FAMILY_ADMIN` `403`, remove member `403`. `OBSERVER` medication create `403`. Matches the pre-existing model derived from source.

**Atomicity** — fault injection into the *transaction client* of the unmodified compiled service:

| Injected failure | Result |
|---|---|
| onboarding: `auditLog.create` | senior/circle/member deltas **0/0/0** |
| onboarding: `careCircleMember.create` | no orphan senior/circle |
| onboarding: `careCircle.create` | no orphan senior |
| `addMember`: `auditLog.create` | membership rolled back, **no row left behind** |
| `createCircle`: `auditLog.create` | circle rolled back |
| `removeMember`: `auditLog.create` | status `ACTIVE → ACTIVE` (unchanged) |

State change and audit write always commit or roll back together. **No silent audit failure path exists.**

**Races** — concurrent duplicate circle creation → exactly one circle (`409,409,409,409,201,409`); concurrent member add → exactly one row; 8 concurrent onboardings → 8 seniors, **0 orphan seniors, 0 circles without members, 8 admin memberships**; concurrent restores converge to one ACTIVE row.

**Membership lifecycle**
- Duplicate ACTIVE add → `409`, and the stored role is **not** mutated by a duplicate attempt carrying an elevated role.
- Restoration reuses the **same row id** (no duplicate), clears `endsAt`, sets `ACTIVE`.
- Non-creator cannot restore-with-elevation to `FAMILY_ADMIN` (`403`).
- Soft-deleted / inactive **user** cannot be added or restored (`404`).
- Sequential removal of the last active `FAMILY_ADMIN` → `409`; senior remains reachable afterwards.
- Repeat removal idempotent; `ENDED` member and `ACTIVE`+past-`endsAt` member both `403` on senior-scoped reads and both absent from `/me/seniors`.

**Other**
- `/auth/me` returns exactly `email, fullName, globalRole, id`; contains no seniorId, no circleId, no membership keys.
- Roster discloses **no** email and **no** notes.
- Malformed UUID path → `400` (not 500). All six routes `401` unauthenticated.
- `auditLog.actorUserId` always equals the JWT subject; audit fields not injectable via body.

---

## 6. Findings

### SEC49-01 — MEDIUM — TOCTOU in the last-active-FAMILY_ADMIN guard can leave a care circle with no usable administrator

- **Affected:** `apps/api/src/modules/care-circle/services/care-circle.service.ts:363-380` (the `count` guard) and `:382-401` (the update transaction)
- **Preconditions:** a circle with exactly **two** ACTIVE, unexpired `FAMILY_ADMIN` members; two concurrent `DELETE /care-circles/:circleId/members/:memberId` requests, each removing the other.
- **Attack scenario:** a family admin adds a colluding or unwitting co-admin (permitted — the creator may grant `FAMILY_ADMIN`), then races the two removals.
- **Exact reproduction** (harness 2, isolated fixture):
  ```js
  const s   = await onboardHTTP(A, 'Race3 Senior', 'Race3 Circle');
  const a2  = await mkUser('race3admin2');
  await call('POST', `/care-circles/${s.circleId}/members`,
             { token: A.token, body: { userId: a2.id, role: 'FAMILY_ADMIN' } });
  await Promise.all([
    call('DELETE', `/care-circles/${s.circleId}/members/${row2.id}`, { token: A.token }),
    call('DELETE', `/care-circles/${s.circleId}/members/${rowA.id}`, { token: a2.token }),
  ]);
  // -> statuses 200 / 200 ; surviving ACTIVE FAMILY_ADMINs = 0
  ```
  A first attempt with identical setup produced the non-deterministic variant `409 / 200` with 1 survivor — itself evidence of the race.
- **Expected behaviour:** at least one request refused with `409`, leaving one usable administrator.
- **Actual behaviour:** both requests return `200`. The circle ends with **zero** ACTIVE, unexpired `FAMILY_ADMIN`. Every subsequent `assertFamilyAdmin` fails for every user, so no one can ever add or remove members for that senior through any of its circles again.
- **Security impact:** integrity and availability, not confidentiality. **No unauthorized access is gained and no privilege is escalated** — the actor already held `FAMILY_ADMIN`. In an elderly-care product the consequence is that a senior's care circle can be permanently stripped of its ability to manage membership, which can leave care coordination unmanageable with no in-product recovery path.
- **Evidence:** harness 2 §2c; non-deterministic variant in harness 1 §I.1.
- **Root cause:** the guard is a read (`count`) performed **outside** the write transaction, and the subsequent `update` is not conditioned on that count. There is no row lock, no serializable isolation, and no database constraint that encodes "a circle keeps at least one usable admin."
- **Recommended remediation direction (not implemented):** evaluate the admin count and perform the end transition inside one transaction with the candidate admin rows locked (`SELECT … FOR UPDATE`), or make the update conditional on the guard in a single statement, or introduce an explicit invariant + recovery path. Do **not** simply delete the guard.

---

### SEC49-02 — LOW — Circle-existence enumeration oracle (`404` vs `403`)

- **Affected:** `care-circle.service.ts:130-137` (`loadCircle`), invoked **before** authorization at `:218`, `:241`, `:351`
- **Preconditions:** any authenticated user; knowledge of a circle UUID.
- **Exact reproduction:**
  ```
  B: GET /care-circles/99999999-9999-4999-8999-999999999999/members  -> 404
  B: GET /care-circles/<A's real circleId>/members                  -> 403
  ```
- **Expected behaviour:** indistinguishable. The inline comment at `care-circle.service.ts:124-128` asserts exactly this: *"A circle the caller cannot see and a circle that does not exist are the same response, so this is not an enumeration oracle."*
- **Actual behaviour:** the two cases are distinguishable by status code.
- **Security impact:** confirms the existence of a specific care circle. Requires already holding a valid UUIDv4, which is not practically enumerable, and no body data is disclosed. By contrast `POST /care-circles` is **not** an oracle (missing and foreign seniors both return `403`).
- **Root cause:** existence is resolved before authorization is evaluated, so the authorization result is only reached for rows that exist.
- **Recommended remediation direction:** resolve the circle within the authorization query, or collapse "no access" and "not found" into one response.
- **Assurance note:** this **contradicts** an explicit claim in the Phase 49 report and in the source comment. See SEC49-09.

---

### SEC49-03 — LOW — The creator-only `FAMILY_ADMIN` grant rule is not an effective containment control

- **Affected:** `care-circle.service.ts:247-251`
- **Preconditions:** the caller is any `FAMILY_ADMIN` of the target senior, but not the `createdById` of the circle in question.
- **Exact reproduction:**
  ```js
  // co-admin of senior via a different circle
  POST /care-circles {seniorId, name:'Co Circle'}            -> 201   (co-admin becomes createdById)
  POST /care-circles/<Co Circle>/members {userId, role:'FAMILY_ADMIN'} -> 201
  ```
- **Expected behaviour:** if the rule is intended to bound who may mint administrators, it should hold.
- **Actual behaviour:** the chain succeeds for any `FAMILY_ADMIN`.
- **Security impact:** **no privilege escalation.** `isFamilyAdmin` is evaluated per **senior**, not per circle, so the actor already held authority over every circle of that senior; minted admins inherit nothing they did not already possess. The finding is that the control does not deliver the containment the report describes, i.e. an assurance-accuracy defect rather than a vulnerability.
- **Root cause:** the rule is enforced against `CareCircle.createdById`, an attribute the same caller can trivially obtain by creating a circle.
- **Recommended remediation direction:** either make `FAMILY_ADMIN` authority circle-scoped so the rule becomes meaningful, or drop/relabel the rule and document accurately that any family admin may grant any role.

---

### SEC49-04 — LOW — A deactivated or soft-deleted account retains membership-grant capability for the lifetime of its access token

- **Affected:** `care-circle.service.ts` — `createCircle`, `addMember`, `removeMember`, `listMembers` perform **no actor-liveness check**. Contrast `senior.service.ts:105` (`assertActorUsable`), which does.
- **Preconditions:** an account is deactivated (`isActive = false`) or soft-deleted (`deletedAt` set) while it still holds an unexpired access token.
- **Exact reproduction:** onboard as `U`; set `U.isActive = false` in the database; using `U`'s still-valid token → `POST /care-circles/:id/members` → **`201`**. Same for `deletedAt`. (`POST /seniors` correctly returns `401` in the same state.)
- **Expected behaviour:** a deactivated account should not be able to grant access to third-party accounts.
- **Actual behaviour:** it can, until the token expires.
- **Security impact:** bounded by `ACCESS_TOKEN_TTL_SECONDS` (15 minutes) and the verifier's `maxAge`. The root cause is **pre-existing** (Phase 16 D-1: access tokens are not revoked on deactivation) and is shared by every senior-scoped domain — no other service performs an actor-liveness check either. Phase 49 nonetheless **extends the blast radius** qualitatively: previously a stale token permitted acting on data the caller already reached; it now permits **granting access to other accounts**, which is a different class of capability.
- **Root cause:** token validity is decoupled from account state; authorization is membership-based only.
- **Recommended remediation direction:** perform the actor-liveness check already present in `SeniorService` inside the care-circle service as well, and/or implement the deferred token-revocation/versioning work.

---

### SEC49-05 — LOW — Platform-user existence oracle for an authorized `FAMILY_ADMIN`

- **Affected:** `care-circle.service.ts:253-259`
- **Preconditions:** caller is a `FAMILY_ADMIN` of the target senior.
- **Exact reproduction:** existing user → `201`; nonexistent → `404`; inactive → `404`; soft-deleted → `404`.
- **Expected / actual:** an oracle exists for the authorized caller and is **not** available to unauthorized callers (both cases return `403` — verified).
- **Security impact:** a legitimate family admin can confirm whether an arbitrary platform UUID is a usable account. UUIDv4 is not guessable, so bulk enumeration is impractical; the realistic risk is targeted confirmation of a specific known identifier.
- **Root cause:** `user.findUnique` existence is mapped to a distinct `404` inside an already-authorized flow.
- **Recommended remediation direction:** acceptable for an admin-only endpoint; if a uniform response is preferred, restrict member-add to users already known to the circle.

---

### SEC49-06 — INFO — Care-circle roster discloses ended members to every senior-scoped member, including `OBSERVER`

- **Affected:** `care-circle.service.ts:223-227` filters `deletedAt: null` only.
- **Evidence:** after a member is ended, an `OBSERVER` roster read still returns that member's `id`, `userId`, `memberName` (full name), `role`, `status: 'ENDED'` and `endsAt`.
- **Impact:** identifiers and names of removed participants persist to all circle members including read-only observers. No email and no notes are disclosed (both verified absent).
- **Recommended remediation direction:** decide whether ended members should remain visible to non-admin roles; if not, filter or redact for `OBSERVER`.

---

### SEC49-07 — INFO — `dateOfBirth` accepts implausible dates

- **Affected:** `dto/create-senior.dto.ts` → `isRealPastOrPresentDate`
- **Evidence:** `0000-01-01` and `0001-01-01` are accepted (`201`) and persisted faithfully to the `@db.Date` column. `2026-02-30`, `2026-13-45`, `2999-01-01`, `1940-02-31`, `2026-1-1` and `not-a-date` are all correctly rejected; the genuine leap date `1940-02-29` is accepted **and persisted without silent day-rollover**.
- **Impact:** data quality only; no security consequence.
- **Recommended remediation direction:** add a plausible lower bound (e.g. reject dates more than ~120 years ago).

---

### SEC49-08 — INFO — The `status: 'ACTIVE'` membership predicate is not independently covered; a mutation removing it passes every suite

- **Affected:** test strength, not production code. `AuthorizationService.membershipWhere`'s `status: 'ACTIVE'` clause.
- **Evidence:** mutation **M2** changed `status: 'ACTIVE'` to accept `ACTIVE | PENDING | ENDED` in the isolated mutant copy. Result: **NOT DETECTED** — `test/onboarding-access.e2e-spec.ts` and `care-circle.service.spec.ts` both passed (baseline `45 passed` / `28 passed`).
- **Root cause:** every existing test that asserts denial does so through `endsAt`, so the two predicates are always falsified together and either one alone is sufficient to produce the expected `403`.
- **Impact:** **no live vulnerability** — the predicate is present and correct today. This is an assurance gap: a future refactor could drop the `ACTIVE` check without any suite failing.
- **Recommended remediation direction:** add a test that sets `status` to a non-ACTIVE value while leaving `endsAt` null.

---

### SEC49-09 — INFO — Report and code-comment claims not supported by evidence

Three specific assertions were checked and **contradicted**:

| Claim | Location | Verdict |
|---|---|---|
| "A circle the caller cannot see and a circle that does not exist are the same response, so this is not an enumeration oracle" | `care-circle.service.ts:124-128` (code comment) | **False** — SEC49-02 |
| "Unknown circle behaves as 404 / no enumeration" | Phase 49 report §5, §6 | **False** — SEC49-02 |
| Creator-only `FAMILY_ADMIN` rule bounds who may mint administrators | Phase 49 report §4.2 / §5 | **Overstated** — SEC49-03 |

Claims that were **verified true**:

| Claim | Evidence |
|---|---|
| "AuthorizationService was not modified" | SHA-256 of the file identical to `d4c570bb` (`4c1b8995…`); `git diff HEAD -- apps/api/src/auth/` empty |
| "No Prisma migration was required" | `schema.prisma` and `prisma/migrations/` unmodified; `prisma validate` passes |
| "No client changes were required" | `apps/mobile/src/services/api.ts` is a single generic `apiFetch`; `apps/web` has no API client |
| "Transaction failure leaves no partial state" | six fault-injection cases, all clean rollbacks (§5) |
| `/auth/me` contract unchanged | exactly four keys; no senior/circle/membership leakage |
| Pre-existing lint baseline disclosed (55 errors / 68 warnings) | measured on pre-existing tracked files |

**Impact:** an assurance/traceability defect. A reviewer relying on the report's enumeration claim would not test for the oracle in SEC49-02.
**Recommended remediation direction:** correct the inline comment and the report's §5/§6 wording, or implement the behaviour the comment claims.

---

## 7. Attack evidence

Environment: throwaway PostgreSQL per run (`ecc-p49sec-*`, `ecc-p49sec2-*`, `ecc-p49mut-*`), each created by the repository's own `scripts/lib/throwaway-postgres.mjs`, driven against the **built** `dist/main.js` under `NODE_ENV=production`, then destroyed. Harnesses lived in `/tmp/opencode/p49sec/` and have been deleted.

Representative transcripts:

```
# identity binding
OK  POST /seniors rejects injected field(s): userId, createdById, id, role, status,
    endsAt, deletedAt, isActive, globalRole, seniorProfileId, careCircles, careCircleMembers  [HTTP 400]
OK  onboarding membership userId === JWT subject
OK  onboarding circle createdById === JWT subject
OK  onboarding role/status/endsAt  [FAMILY_ADMIN/ACTIVE/null]

# /me/seniors vs AuthorizationService (invariant: listed === authorized)
OK  drift check: membership endsAt in the past        [listed=false authzAllows=false]
OK  drift check: membership status ENDED              [listed=false authzAllows=false]
OK  drift check: circle isActive=false                [listed=false authzAllows=false]
OK  drift check: senior isActive=false                [listed=false authzAllows=false]

# IDOR (unrelated authenticated user)
OK  B GET /seniors/<A>/medications|appointments|measurements|documents|
    emergency-alerts|feed|conversations               [all HTTP 403]
OK  B POST /care-circles/<A circle>/members            [HTTP 403]
OK  A memberId under B circle -> 404 ; B memberId under A circle -> 403

# enumeration
ATTN  unknown circle vs inaccessible circle            [missing=404 existing=403]   <- SEC49-02
OK    POST /care-circles: missing vs foreign senior    [missing=403 foreign=403]
      user enumeration (authorized admin)              [exists=201 missing=404 inactive=404 softdeleted=404]  <- SEC49-05
OK    unauthorized caller cannot distinguish user existence [403 vs 403]

# races
OK    concurrent duplicate circle -> exactly one circle    [1 rows]
OK    concurrent member add -> exactly one row            [1]
ATTN  mutual last-admin removal                          [200/200 surviving ACTIVE admins=0]  <- SEC49-01
OK    concurrent onboarding leaves no partial state       [0 orphan senior / 0 circle-without-member]

# atomicity (fault injection into the transaction client)
OK  onboarding: audit-write failure rolls back senior+circle+membership  [0/0/0]
OK  addMember:    audit-write failure rolls back membership            [0]
OK  removeMember: audit-write failure rolls back the removal            [ACTIVE->ACTIVE]
```

---

## 8. Authorization matrix

Tested against a single senior with a caller holding each role. No score or ranking is assigned.

| Role | read senior | read roster | create circle | add member | grant `FAMILY_ADMIN` | remove member | create medication |
|---|---|---|---|---|---|---|---|
| `FAMILY_ADMIN` (creator) | 200 | 200 | 201 | 201 | 201 | 200 | 201 |
| `FAMILY_ADMIN` (co-admin, not creator) | 200 | 200 | 201 | 201 | **403** | 200 | 201 |
| `FAMILY_MEMBER` | 200 | 200 | **403** | **403** | **403** | **403** | **403** |
| `CAREGIVER` | 200 | 200 | **403** | **403** | **403** | **403** | **403** |
| `DOCTOR` | 200 | 200 | **403** | **403** | **403** | **403** | 201 |
| `OBSERVER` | 200 | 200 | **403** | **403** | **403** | **403** | **403** |
| no membership | **403** | **403** | **403** | **403** | **403** | **403** | **403** |
| ended membership | **403** | **403** | **403** | **403** | **403** | **403** | **403** |
| expired `endsAt` | **403** | **403** | **403** | **403** | **403** | **403** | **403** |

Observations, stated as facts rather than policy judgements:
- `FAMILY_MEMBER` cannot create a medication. Verified against `medication.service.ts:16-17` (`FAMILY_ADMIN`/`DOCTOR` only) — this is the **pre-existing** policy, unchanged by Phase 49.
- A co-admin of the senior can add and remove members in a circle it does not belong to, because `assertFamilyAdmin` is senior-scoped. No privilege is gained: the caller is already family admin for that senior. This is the same scoping that makes SEC49-03 ineffective.
- Read-only roles can read the roster, including `OBSERVER`.

---

## 9. Transaction / consistency results

| Operation | Guard inside transaction? | Result |
|---|---|---|
| onboarding (senior+circle+membership+2 audits) | single `$transaction` | atomic; 3 fault-injection cases all rolled back completely; no orphan senior, no circle without membership |
| `createCircle` | circle + membership + audit in one `$transaction` | atomic; audit failure rolls back the circle |
| `addMember` (create) | membership + audit in one `$transaction` | atomic; audit failure leaves no row |
| `addMember` (restore) | update + audit in one `$transaction` | atomic; reuses the same row |
| `removeMember` | update + audit in one `$transaction` | atomic; audit failure leaves status unchanged |
| `removeMember` last-admin guard | **count performed OUTSIDE the transaction** | **not atomic → SEC49-01** |

Concurrent behaviour: duplicate circle name → exactly one circle; duplicate member add → exactly one row; 8 concurrent onboardings → no partial state; concurrent restores → one ACTIVE row; mutual last-admin removal → orphaned circle.

---

## 10. Regression results

Existing suites were run unmodified, against throwaway PostgreSQL, via the repository's own `node scripts/run-db-suites.mjs`:

```
api:integration (e2e + security)   PASS   Test Files  9 passed (9) | Tests  183 passed (183)
api:all (unit + integration)       PASS   Test Files 29 passed (29) | Tests  421 passed (421)
```

Also verified: `pnpm typecheck` (11/11), `pnpm build` (7/7), `verify:metadata` (0 `"Function"` entries), `verify:routes` (every non-public live route guarded; all 6 new routes carry guards and constrained DTO classes), `prisma validate`.

**Authorization regression suites specifically inspected and passing:** `authorization.db.spec.ts`, `authorization-matrix.security.e2e-spec.ts`, `resources.security.e2e-spec.ts`, `emergency.security.e2e-spec.ts`, `documents.security.e2e-spec.ts`, `messaging.security.e2e-spec.ts`, plus the Phase 49 `onboarding-access.e2e-spec.ts`. No existing test was modified, skipped or weakened.

---

## 11. Mutation / adversarial results

Performed on an **isolated copy** of the repository (`/tmp/opencode/p49sec/mutant`, since deleted). The real working tree was never modified; the 156-file SHA-256 manifest confirms this. Question asked of each: *do the existing tests detect meaningful authorization weakening?*

| ID | Mutation | Weakens | Unit | E2E | Detected |
|---|---|---|---|---|---|
| M1 | `AuthorizationService`: widen `endsAt` to include past dates | expired membership would authorize | pass | **fail** | **YES** |
| M2 | `AuthorizationService`: accept `ACTIVE\|PENDING\|ENDED` | ended/pending membership would authorize | pass | pass | **NO — see SEC49-08** |
| M3 | `addMember`: remove creator-only `FAMILY_ADMIN` rule | any family admin could mint admins | **fail** | **fail** | **YES** |
| M4 | `addMember`: replace `FAMILY_ADMIN` requirement with plain membership | any member incl. `OBSERVER` could add members | **fail** | **fail** | **YES** |
| M6 | `/me/seniors`: drop circle + senior activity predicates | deleted/inactive senior still listed (drift) | **fail** | **fail** | **YES** |
| M7 | `removeMember`: drop the last-active-admin guard | circle could be left with no admin | **fail** | **fail** | **YES** |

Baseline before mutation: `45 passed` (E2E), `28 passed` (unit). After restoring all mutations: `45 passed`. **Five of six meaningful weakenings were detected; one (M2) was not.**

M7 being detected is worth noting: removing the guard fails the *sequential* last-admin test. It does **not** detect the concurrency defect in SEC49-01, which is precisely why the race survived.

---

## 12. Severity summary

| Severity | Count | IDs |
|---|---|---|
| Critical | **0** | — |
| High | **0** | — |
| Medium | **1** | SEC49-01 |
| Low | **4** | SEC49-02, SEC49-03, SEC49-04, SEC49-05 |
| Info | **4** | SEC49-06, SEC49-07, SEC49-08, SEC49-09 |

**No overall security score, rating or ranking is assigned.**

Notably **not** found: no authorization bypass, no IDOR into another user's senior, no membership manufacture, no privilege escalation beyond existing authority, no `endsAt`/`ENDED` bypass, no deleted/inactive senior or circle exposure, no audit spoofing, no mass-assignment vector, no transaction partial state, no `/me/seniors` ↔ `AuthorizationService` drift.

---

## 13. Required remediation (not implemented)

| ID | What needs to be addressed |
|---|---|
| **SEC49-01** | Make the last-active-`FAMILY_ADMIN` guard atomic with the write — evaluate the count and apply the transition in one transaction with the candidate admin rows locked, or make the update conditional on the guard in a single statement. Consider whether a recovery path (super-admin reassignment) is needed. **This is the only finding that should block the Phase 49 checkpoint.** |
| **SEC49-02** | Either make circle resolution part of the authorization query, or map "no access" and "not found" to a single indistinguishable response. |
| **SEC49-03** | Make `FAMILY_ADMIN` authority circle-scoped so the creator-only rule is meaningful, **or** relabel the rule as non-security and correct the report's characterisation of it. |
| **SEC49-04** | Apply the existing `assertActorUsable` check inside the care-circle service, and/or close the deferred token-revocation gap (Phase 16 D-1) so a deactivated account cannot grant access to others. |
| **SEC49-05** | Optional: uniformise the target-user response, or restrict member-add to users already known to the circle. |
| **SEC49-06** | Decide whether ended members should remain visible to non-admin roles; filter or redact if not. |
| **SEC49-07** | Add a plausible lower bound to `dateOfBirth`. |
| **SEC49-08** | Add a test that falsifies `status` alone while leaving `endsAt` null, so the `ACTIVE` predicate is independently covered. |
| **SEC49-09** | Correct the enumeration claim in the Phase 49 report and in the `care-circle.service.ts` inline comment (or implement the claimed behaviour). |

**None of the above was implemented in this review.** No source, test, schema, migration or existing documentation was modified.

---

## 14. Environment note (disclosed)

During the first, full-suite mutation run, heavy parallel worker usage coincided with the Docker daemon restarting: the compose containers `ecc-postgres`/`ecc-redis`/`ecc-minio` restarted (reported by Docker as "Up N minutes" against unchanged creation timestamps), and the pre-existing container `pg-pgtest` recorded `finishedAt=2026-10-01T09:50:59Z`, `exit=0`, `oom=false`, restart policy `no`. `pg-pgtest` was subsequently observed running again, indicating external management of that container outside this review's commands.

- The developer database was **verified intact throughout and at the end: 37 tables.**
- Every throwaway container created by this review was destroyed.
- Mutation testing was re-run in a single-fork, no-file-parallelism configuration after this, with results in §11.
- I cannot definitively attribute the `pg-pgtest` exit to this review's activity; every container command issued was name-targeted at an `ecc-p49*` throwaway container, never at `pg-pgtest`. It is recorded here rather than dismissed.

---

## 15. Review conclusion

# APPROVED WITH FINDINGS

**REMEDIATION REQUIRED BEFORE PHASE 49 CHECKPOINT** — one Medium finding (SEC49-01) is reproducible and should be fixed before Phase 49 is checkpointed.

Phase 49's central claim is supported by evidence: a legitimate user obtains access **only** through a legitimate `CareCircleMember` relationship, onboarding is atomic and always binds the membership to the verified JWT subject, `GET /me/seniors` does not drift from `AuthorizationService` across ten state mutations, and the pre-existing authorization layer remains authoritative and unmodified. Approximately 130 adversarial assertions found no authorization bypass, no IDOR, no privilege escalation beyond existing authority, and no transaction partial state.

The one substantive defect is a concurrency weakness in the last-administrator guard, which affects care-circle integrity and availability rather than confidentiality. Three Low findings and four Info findings — including one test-coverage gap (SEC49-08) and three claims in the Phase 49 report that the evidence contradicts (SEC49-09) — should also be addressed.

**Explicit non-claims.** This review does **not** state that the implementation is fully secure, production-ready, or approved for deployment. It does not constitute a penetration test, a compliance assessment, or a security certification. It covers the Phase 49 access-path surface only; the pre-existing product carries the unresolved Phase 45 security checkpoint and the open Phase 48 findings, none of which were re-assessed here. New endpoints represent new attack surface that has now been probed but not exhaustively assessed.