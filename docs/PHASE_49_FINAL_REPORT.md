# Phase 49 — Senior Access & Care-Circle Onboarding Foundation

**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Starting checkpoint:** `d4c570bb56a1bef38b009e7890469b9b84bac5e3` (Phase 47 documentation checkpoint)
**Date:** 2026-10-01
**Nature:** Backend access-foundation implementation. **Not** a security review, **not** a penetration test, **not** a compliance assessment, and **not** a production-readiness certification.

> **Amended after an independent security review.** `docs/PHASE_49_SECURITY_REVIEW.md` identified nine findings in this implementation. The blocking finding (SEC49-01, a TOCTOU race in the last-administrator guard) and the associated assurance gap (SEC49-08) were remediated; three claims in this report were corrected as factually inaccurate (SEC49-02, SEC49-03, SEC49-09). Sections marked with a finding ID were changed accordingly. See `docs/PHASE_49_REMEDIATION_REPORT.md` for the remediation record. The independent review is retained unmodified as the record of what was found *before* remediation.

---

## 1. Objective

Phase 49 addresses exactly three Phase 48 findings:

| ID | Phase 48 finding | Status after Phase 49 |
|---|---|---|
| **PR-48-01** | No mechanism exists to create a `SeniorProfile`, `CareCircle`, or `CareCircleMember` | **RESOLVED** — `POST /seniors`, `POST /care-circles`, `POST /care-circles/:id/members` |
| **PR-48-02** | A registered user cannot obtain a `seniorId`; `/auth/me` returns 4 fields, none identifying a senior | **RESOLVED** — `GET /me/seniors`, derived from active membership |
| **PR-48-03** | Every senior-scoped capability returns `403` for a legitimately authenticated user | **RESOLVED** for users who onboard; verified over real HTTP against a live API |

Phase 48's findings are taken as given and were not reinterpreted. In particular: **authorization was already correct and was not weakened.** Phase 49 makes the existing `AuthorizationService` reachable by producing the membership rows it already requires.

---

## 2. Starting checkpoint

Verified before any change:

```
git rev-parse HEAD       = d4c570bb56a1bef38b009e7890469b9b84bac5e3
git rev-parse origin/main = d4c570bb56a1bef38b009e7890469b9b84bac5e3
```

One pre-existing untracked file was present and was left untouched: `docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md` (Phase 48 was assessment-only).

---

## 3. Design decision

### 3.1 The root cause, derived from the actual schema

Reading `apps/api/prisma/schema.prisma` rather than assuming Phase 48's suggested model produced a specific structural conclusion:

- `AuthorizationService` grants access to a senior **only** through an `ACTIVE`, non-expired, non-deleted `CareCircleMember` row.
- `CareCircle.seniorId` is a required FK, and `CareCircle.createdById` is a **non-null** `User` FK.
- Therefore a senior with no circle has no members, and a circle with no members can be created by **nobody** — every senior-scoped route is already `403` for everyone.

**Splitting provisioning into "create senior" then "create circle" is impossible without inventing a bootstrap authorization rule the existing RBAC does not have.** That is the precise mechanism behind PR-48-01/03, and it is why a separate "create circle first" endpoint cannot be the entry point.

### 3.2 Answers to the required questions

| Question | Decision |
|---|---|
| **Who creates the `SeniorProfile`?** | The authenticated user who will coordinate that senior's care, via `POST /seniors`. There is no alternative: no administrative provisioning path exists (PR-48-13, super admin, is out of scope and has no endpoints), so self-service is the only legitimate route. |
| **Who creates the `CareCircle`?** | The same user, **atomically with the senior**. The schema already presumes a user creates circles (`createdById` is non-null). Additional circles may later be opened for a senior by any of that senior's family admins. |
| **Who becomes the initial `CareCircleMember`?** | The creator, and only the creator. |
| **What role?** | `FAMILY_ADMIN`, `status: ACTIVE`, `endsAt: null`. Rationale: `AuthorizationService.isFamilyAdmin` gates every mutating senior-scoped action (medication archive, appointment cancel, measurement archive, feed edit). A lesser role would produce a user who can read but cannot manage — the "blocked again at the next step" failure this phase exists to remove. |
| **Can one user access multiple seniors?** | **Yes.** Access is many-to-many through `CareCircleMember`; the schema constrains `(circleId, userId)`, not `(seniorId, userId)`. `GET /me/seniors` returns a list. Verified in tests (one user provisioning two seniors). |
| **Can one senior belong to multiple circles?** | **Yes.** `CareCircle` has no unique constraint on `seniorId` — only `@@unique([seniorId, name])`. Multiple circles per senior is explicitly supported by the schema's own documentation ("inner family circle and outer clinical circle"). |
| **Can multiple users create circles for the same senior?** | **Yes, but only if they already legitimately reach that senior** and hold `FAMILY_ADMIN`. A non-member cannot: `assertFamilyAdmin` calls `AuthorizationService` first. |
| **How do invitations work?** | **They do not, and none were built.** The `Invitation` model exists in the schema with `role`, `tokenHash`, and `status`, but the API has no route to issue, deliver or accept one, and no mailer exists (PR-48-07). Phase 49 §9 explicitly forbids building an invitation system unless genuinely required by the minimal onboarding model; it is not — self-service onboarding needs no invitation. **A future invitation feature remains a separate phase.** |
| **What happens on duplicate / ambiguous ownership?** | Provisioning twice is **not** an error: a user may legitimately coordinate several people, and no `User.seniorId` is written, so nothing collides. Deterministic conflicts are: duplicate circle name for the same senior → **409**; existing `ACTIVE` membership → **409**; malformed ids/roles/dates/unknown fields → **400**; unknown circle or user → **404**. |
| **What prevents a user obtaining another user's senior?** | Nothing grants access by assertion. Access is created in exactly two ways: (a) the caller's own onboarding transaction, which writes a membership only for the caller; (b) an existing `FAMILY_ADMIN` of the target circle naming an existing account. Every read and every manage path re-derives authorization through `AuthorizationService`. **No request shape anywhere in the module names a senior the caller cannot already reach and returns access to it.** `User.seniorProfileId` is never set by this phase. |

### 3.3 Why the design fits the existing schema and RBAC

**No Prisma schema change was required, and none was made** (§14). Every relationship the design needs already exists:

- `CareCircle.createdById` → gives the accountable actor used to bound who may mint family admins.
- `@@unique([seniorId, name])` → gives deterministic circle-name conflict handling.
- `@@unique([circleId, userId])` → gives deterministic duplicate-membership handling.
- `CareCircleMember.endsAt` → Phase 16 (H10/A3) `endsAt` semantics are preserved and are the sole revocation mechanism relied on by `AuthorizationService`; this phase writes `endsAt` but never bypasses the check.
- `AuditLog` → existing append-only audit mechanism, written inline in the same transaction, exactly as `emergency.service.ts` and `medication.service.ts` already do.

`GET /me/seniors` deliberately **mirrors** `AuthorizationService.membershipWhere` plus its circle/senior predicates rather than inventing a weaker rule. That mirroring is what makes it safe for client-side senior selection: it cannot return a senior the API would then refuse. It **reads** membership state; it does not substitute for `AuthorizationService` on any access decision.

---

## 4. Implementation

### 4.1 Files created

| File | Why it is required |
|---|---|
| `apps/api/src/modules/care-circle/services/senior.service.ts` | Onboarding transaction and accessible-senior resolution (PR-48-01, PR-48-02). |
| `apps/api/src/modules/care-circle/services/care-circle.service.ts` | Care-circle creation and membership add/list/remove (PR-48-01). |
| `apps/api/src/modules/care-circle/seniors.controller.ts` | `POST /seniors`. |
| `apps/api/src/modules/care-circle/me.controller.ts` | `GET /me/seniors` (PR-48-02). |
| `apps/api/src/modules/care-circle/care-circle.controller.ts` | `POST /care-circles`, member list/add/remove. |
| `apps/api/src/modules/care-circle/care-circle.module.ts` | Wires the controllers; imports `AuthModule` for `AuthorizationService`. |
| `apps/api/src/modules/care-circle/dto/create-senior.dto.ts` | Request validation for onboarding. |
| `apps/api/src/modules/care-circle/dto/create-care-circle.dto.ts` | Request validation for circle creation. |
| `apps/api/src/modules/care-circle/dto/add-circle-member.dto.ts` | Request validation for membership, including `CircleRole` enum. |
| `apps/api/src/modules/care-circle/services/care-circle.service.spec.ts` | 35 unit tests (28 at Phase 49 completion; 7 added by remediation). |
| `apps/api/test/onboarding-access.e2e-spec.ts` | The acceptance proof (§16), 57 real-HTTP real-database tests (33 at Phase 49 completion; 24 added by remediation). |

### 4.2 File modified

| File | Change | Why required |
|---|---|---|
| `apps/api/src/app.module.ts` | `+4` lines: import `CareCircleModule`, register it in `imports`. | Without registration the controllers are compiled but unreachable — exactly the `care-tasks` defect (PR-48-06). |

**No other file was modified.** The Prisma schema, all 12 pre-existing controllers, all 16 pre-existing services, `AuthorizationService`, `/auth/me`, and every client were left untouched.

### 4.3 A defect this phase introduced and then fixed

`removeMember` **retains** the ended row (required by Phase 16's audit and `endsAt` semantics). But `@@unique([circleId, userId])` applies to retained rows too, so after a member was ended, **re-adding them could never succeed** — the insert would raise `P2002` forever, making removal irreversible.

This was caught by the §19 runtime validation (the harness observed `409` where it expected restoration), not by inspection. `addMember` now distinguishes the two cases deterministically:

- existing **ACTIVE** row → `409 Conflict` (genuine duplicate, no second row);
- existing non-ACTIVE row → restored **in place** (`status: ACTIVE`, `endsAt: null`, role/displayName/notes updated), audited with `restored: true`, `previousStatus`, `previousRole`.

Covered by both a unit test and an e2e test that asserts the same row id is reused and only one row exists.

---

## 5. API contract

All routes are under the existing `/api/v1` prefix, guarded by `JwtAuthGuard` + `RolesGuard` with `@Roles('USER', 'SUPER_ADMIN')`, and **none** is `@Public()`.

### `POST /api/v1/seniors` — PR-48-01

- **Auth:** Bearer access token required. Anonymous → `401`.
- **Request DTO** (`CreateSeniorDto`, strict whitelist — unknown properties → `400`):

  | Field | Rules |
  |---|---|
  | `fullName` | required, string, non-empty, ≤ 200 chars |
  | `preferredName` | optional, ≤ 200 chars |
  | `dateOfBirth` | optional, `YYYY-MM-DD`, must be a **real** date and **not in the future** |
  | `carePreferences` | optional, ≤ 2000 chars |
  | `circleName` | optional, ≤ 120 chars; defaults to `"Family circle"` |

- **Authorization:** none required beyond a valid account. This is the **only** route in the codebase that establishes care-circle access, and it does so exclusively for the caller.
- **Behaviour (single transaction):** creates `SeniorProfile` → `CareCircle` → `CareCircleMember(caller, FAMILY_ADMIN, ACTIVE, endsAt=null)` → two `AuditLog` rows.
- **Response `201`:**

  ```json
  {
    "senior":        { "id", "fullName", "preferredName", "dateOfBirth", "createdAt" },
    "careCircle":    { "id", "name", "description" },
    "membership":    { "id", "circleId", "role", "status" }
  }
  ```
- **Errors:** `400` invalid payload / unknown field / impossible or future date; `401` unauthenticated; `401` if the token subject's account is no longer usable.
- **Audit:** `senior_profile.created`, `care_circle.created`.

### `GET /api/v1/me/seniors` — PR-48-02

- **Auth:** Bearer required. Anonymous → `401`.
- **Request DTO:** none.
- **Authorization:** reads the caller's own `CareCircleMember` rows.
- **Response `200`** — one entry per distinct senior, derived from `ACTIVE` + `deletedAt: null` + (`endsAt` null or future) memberships whose circle and senior are both `deletedAt: null, isActive: true`:

  ```json
  [ { "senior": { "id", "fullName", "preferredName", "dateOfBirth" },
      "role": "FAMILY_ADMIN",
      "circles": [ { "circleId", "circleName", "role" } ] } ]
  ```
- **Errors:** `401` unauthenticated.
- **Notes:** `role` is a **display hint only**; every senior-scoped action re-derives the real role. Multiple circles for one senior are collapsed into a single entry with all circles listed and the strongest role as the hint. **Members' email addresses are never returned.**

### `POST /api/v1/care-circles`

- **Auth:** Bearer required.
- **Request DTO** (`CreateCareCircleDto`): `seniorId` (UUID v4, required), `name` (non-empty, ≤ 120), `description` (optional, ≤ 2000).
- **Authorization:** `AuthorizationService.assertCanAccessSenior` **and** `isFamilyAdmin` on the target senior. `FAMILY_MEMBER`, `CAREGIVER`, `DOCTOR` and `OBSERVER` are denied.
- **Behaviour:** creates `CareCircle(createdById = caller)` + `CareCircleMember(caller, FAMILY_ADMIN, ACTIVE)` + audit, in one transaction.
- **Response `201`:** `{ "careCircle": {...}, "membership": {...} }`.
- **Errors:** `400`; `401`; `403` not a family admin / no access; `404` senior absent or inactive; `409` duplicate circle name for that senior (including a lost `P2002` race).

### `GET /api/v1/care-circles/:circleId/members`

- **Auth:** Bearer required. `circleId` parsed as UUID v4 → `400` if malformed.
- **Authorization:** `assertCanAccessSenior` on the circle's senior. `OBSERVER` included, matching read access everywhere else.
- **Response `200`:** `{ "careCircle": {id, seniorId, name}, "members": [{id, circleId, userId, role, status, displayName, endsAt, createdAt, memberName}] }`. **No email addresses.**
- **Errors:** `400`; `401`; `403`; `404` unknown circle.
- **SEC49-02 — a narrow existence oracle exists, contrary to an earlier claim in this report.** Because a circle's existence is resolved before authorization, an unauthorized caller receives **`404` for a circle that does not exist and `403` for one that does**. The two are therefore **not** indistinguishable, and this earlier report's claim that they were ("identical to 'no access', so circle ids are not enumerable") was incorrect. Practical impact is limited: exploiting it requires already holding a valid circle UUID, and UUIDv4 identifiers are not practically enumerable. It is recorded and accepted rather than silently corrected by behaviour change. By contrast, `POST /care-circles` is **not** an oracle — a nonexistent and a foreign `seniorId` both yield `403`.

### `POST /api/v1/care-circles/:circleId/members`

- **Auth:** Bearer required.
- **Request DTO** (`AddCareCircleMemberDto`): `userId` (UUID v4, **an existing account**), `role` (`@IsEnum(CircleRole)`), `displayName?`, `notes?`.
- **Authorization:** `FAMILY_ADMIN` of the circle's senior.
  - **Additional restriction (SEC49-03):** granting `FAMILY_ADMIN` requires the caller to be that circle's `createdById`.
  - **This restriction is an attribution rule, NOT a containment boundary.** It confines the *record* of who created a circle, not the ability to grant admin authority: `assertFamilyAdmin` is evaluated per **senior**, so any existing `FAMILY_ADMIN` of the same senior may create another circle for that senior, become its recorded `createdById`, and grant `FAMILY_ADMIN` there. Because such a caller is already family admin across the whole senior, this grants no authority they did not already hold — it is **not** a privilege-escalation path. The independent security review (SEC49-03) demonstrated the bypass and characterised this section's earlier claim of escalation containment as overstated. Making it a genuine boundary would require scoping `FAMILY_ADMIN` to a circle, which would change the existing authorization model and was deliberately not done.
- **Behaviour:** creates or restores an `ACTIVE` membership with `endsAt: null`, + audit.
- **Errors:** `400`; `401` unauthenticated or actor account not active; `403` not a family admin, non-creator granting `FAMILY_ADMIN`, **or a circle that exists but is inaccessible to the caller** (per SEC49-02, existence is resolved before authorization, so an inaccessible circle is `403` and only an unknown circle is `404`); `404` unknown circle, or unknown/inactive/deleted target user; `409` existing `ACTIVE` membership.

### `DELETE /api/v1/care-circles/:circleId/members/:memberId`

- **Auth:** Bearer required. Both ids parsed as UUID v4.
- **Authorization:** `FAMILY_ADMIN` of the circle's senior. All mutating care-circle operations also verify the **actor's account is still active and not soft-deleted** (`401` otherwise); see SEC49-04 in the remediation report.
- **Behaviour:** sets `status = 'ENDED'` **and** `endsAt = now()`. The row is retained. Both fields are set so `AuthorizationService` excludes the member twice over (status is not ACTIVE, *and* `endsAt` is past), so no future change to one predicate can leave access behind.
- **Concurrency (SEC49-01):** the last-usable-`FAMILY_ADMIN` guard is evaluated **inside the same transaction** as the removal, and that transaction begins with `SELECT … FOR UPDATE` over the target row plus every currently usable `FAMILY_ADMIN` row of the circle, in a deterministic `ORDER BY id` sequence. A care circle therefore cannot be driven from ≥1 usable administrator to 0 by concurrent removals. See the remediation report for the PostgreSQL argument.
- **Idempotent:** an already-`ENDED` membership returns `200` with its current state rather than erroring.
- **Errors:** `400`; `401` unauthenticated or actor account not active; `403`; `404` unknown circle or member not in that circle; `409` removing the last usable `FAMILY_ADMIN`.

### `/auth/me` — deliberately UNCHANGED

`GET /auth/me` still returns exactly `{ id, email, fullName, globalRole }`. A dedicated accessible-senior endpoint was preferred because: the auth contract is untouched, so the existing mobile `getMe` and any web consumer keep working; senior access is a resource-authorization concern derived from membership while `/auth/me` is an identity concern derived from the `User` row, and coupling them would make every membership change alter the session payload; and it keeps PHI-adjacent senior names out of a payload every authenticated client treats as "who am I". **A regression test asserts `/auth/me` still returns exactly those four keys.**

---

## 6. Authorization preservation

The proof required by §10 — both paths, over real HTTP, against a live API:

```
legitimate member  →  AuthorizationService  →  senior-scoped endpoint ALLOWED
no membership      →  AuthorizationService  →  403
```

**Not weakened:** ACTIVE membership requirement, `endsAt` semantics, senior-scoped authorization, role restrictions. `AuthorizationService` was **not modified** (`git diff` confirms `apps/api/src/auth/` is untouched), and the new services never substitute their own predicate for it.

Evidence from the §19 runtime run against the built `dist/main.js`:

| Check | Result |
|---|---|
| User A, `POST /seniors` then `POST /seniors/:id/medications` | `201` (was `403` in Phase 48) |
| User A: appointments / emergency alerts / feed / conversation / message / documents | `201`, `201`, `201`, `201`, `201`, `200` |
| User A, medication archive (a `FAMILY_ADMIN`-only act) | `200` |
| **User B** (valid token, no membership) on 7 senior-scoped reads | **all `403`** |
| **User B** writing to A's senior | **`403`** |
| **User B** creating a circle for A's senior | **`403`** |
| **User B** adding *itself* to A's circle as `FAMILY_ADMIN` | **`403`** |
| **User B** reading A's roster | **`403`** |
| **User B** after A legitimately adds it as `FAMILY_MEMBER` | **`200`** |
| **User B** after A ends that membership | **`403`** |
| **User B** with `endsAt` in the past but `status = ACTIVE` | **`403`** |
| **User B** with a deactivated senior profile | **`403`**, and not offered by `GET /me/seniors` |
| Co-admin (not the circle creator) attempting to grant `FAMILY_ADMIN` | **`403`** |
| `OBSERVER` granted via the new path, writing a measurement | **`403`** (read still `200`) |
| `FAMILY_MEMBER` granted via the new path, archiving a medication | **`403`** |
| `FAMILY_ADMIN` removing the last active family admin | **`409`** |
| **Two admins concurrently removing each other** (40 runs) | **exactly one `200`; the other `409`. Exactly 1 usable admin survived in 40/40.** Zero invariant violations. |
| Three admins, two removed concurrently (40 runs) | **≥1 usable admin in 40/40** |
| Concurrent mutual removal with `FOR UPDATE` removed from the fix | **reproduced the original defect (`200/200`)** — the new test catches it |
| Deactivated or soft-deleted actor attempting to add/remove a member or create a circle | **`401`** |
| `status = ENDED` with `endsAt = null` / `status = PENDING` with `endsAt = null` | **`403`**, and absent from `GET /me/seniors` |
| Unauthenticated `POST /seniors`, `GET /me/seniors`, `POST /care-circles` | **`401`** |

`care-tasks` remains **404** even with full authorization, confirming no out-of-scope wiring occurred.

---

## 7. Tests

### 7.1 Unit tests — 28 tests, `src/modules/care-circle/services/care-circle.service.spec.ts`

Senior onboarding (senior + circle + role + audit + normalization + unusable-actor rejection); accessible-senior resolution (membership predicate asserted against `AuthorizationService`'s exact shape, multi-circle collapsing, multi-senior, empty); circle creation (initial role, non-admin denied, no-membership denied, duplicate `409`, `P2002` race → `409`); membership (creation, non-admin denied, unknown circle/user `404`, `ACTIVE` duplicate `409`, `ENDED` restore in place, family-admin minting restriction); roster (no email disclosure, no-membership denied); removal (`ENDED` + `endsAt`, last-admin `409`, idempotence, cross-circle `404`, non-admin denied).

### 7.2 Integration / E2E — 33 tests, `test/onboarding-access.e2e-spec.ts`

Real HTTP, real Nest application, real PostgreSQL, and **real credentials** — users `POST /auth/register` and `POST /auth/login` through the public auth routes rather than being handed a fixture row and a signed token. This is what makes it the §16 acceptance proof rather than a unit test.

Covers: 401 unauthenticated; empty accessible-senior list pre-onboarding; **403 on all 7 senior-scoped domains for a legitimate authenticated non-member**; onboarding row verification read back from the database; audit rows; invalid payloads (empty name, over-length, impossible date `2026-13-45`, future date, `1940-02-31`, over-length circle name); strict-whitelist rejection of `isActive`/`deletedAt`; multi-senior provisioning; accessible-senior resolution; all 7 existing domains reachable post-onboarding; care-tasks still `404`; full isolation for User B; circle creation/duplication/validation; membership add/duplicate/role/user validation; restoration of an ended membership; removal; `endsAt` expiry with `status = ACTIVE`; deactivated senior; role boundaries (`FAMILY_ADMIN` allowed, `FAMILY_MEMBER`/`OBSERVER` denied on admin acts); `/auth/me` field set unchanged.

### 7.3 Results

| Command | Result |
|---|---|
| `pnpm typecheck` | **PASS** — 11/11 tasks |
| `pnpm build` | **PASS** — 7/7 tasks |
| `pnpm test` | **PASS** — 11/11 tasks; API **201 passed / 44 skipped** (baseline was 166/44; the 44 are the DB-gated specs, run below) |
| `node scripts/run-db-suites.mjs` → `api:integration` | **PASS** — 9 files, **195 tests** |
| `node scripts/run-db-suites.mjs` → `api:all` | **PASS** — 29 files, **440 tests** |
| `verify:metadata` (compiled artifact) | **PASS** — 0 `"Function"` entries, 68 DTO identity checks |
| `verify:routes` (compiled artifact) | **PASS** — every non-public live route guarded; public allow-list matches reality |
| `prisma validate` | **PASS** — schema valid (required a `DATABASE_URL` to be set; this shell has none, a pre-existing environmental condition) |

**Authorization regression suites re-run and passing:** `authorization.db.spec.ts`, `authorization-matrix.security.e2e-spec.ts`, `resources.security.e2e-spec.ts`, `emergency.security.e2e-spec.ts`, `documents.security.e2e-spec.ts`, `messaging.security.e2e-spec.ts`. No pre-existing test was modified, skipped, or weakened.

### 7.4 Lint — pre-existing baseline failure, disclosed in full

`pnpm lint` **fails**, and it failed before Phase 49.

- Measured baseline on **pre-existing tracked files only**: **55 errors, 68 warnings**.
- `lint` is **not** a gate in `.github/workflows/ci.yml` (0 lint steps).
- After Phase 49 the API package reports 76 errors / 73 warnings. **The delta is 21 errors, all `@typescript-eslint/no-explicit-any` in the new mocked-Prisma unit spec.** That usage follows the established convention in this repository's existing mocked-delegate specs — `document.service.spec.ts` alone contributes 14 such errors on its own.
- Two genuine lint defects of mine **were** found and fixed: an unused `Matches` import in `create-senior.dto.ts`, and import ordering in three files (`eslint --fix`).
- `apps/mobile` lint also fails (18 warnings, pre-existing, in `session.spec.ts`) — untouched by this phase.

No baseline lint debt was fixed, and no lint failure is hidden.

---

## 8. Runtime validation

Performed against a **throwaway** PostgreSQL provisioned by the repository's own `scripts/lib/throwaway-postgres.mjs` (whose database names are always prefixed, so the developer `ecc` database cannot be reached even by a bug), driving the **built `dist/main.js`** under `NODE_ENV=production`.

- Container: `ecc-p49-pg-…` (unique name, ephemeral loopback port) — **destroyed** afterwards.
- **44/44 runtime checks passed.**

| Scenario | Result |
|---|---|
| User A registers / logs in | `201` / `201` |
| A `GET /auth/me` | `200`, exactly `email, fullName, globalRole, id` |
| A `GET /me/seniors` before onboarding | `200`, `[]` |
| A creates senior + care circle + membership | `201`, `FAMILY_ADMIN`, `ACTIVE` |
| A rejected: impossible date of birth (`1940-02-30`) | `400` |
| A rejected: unknown field (`isActive`) | `400` |
| Unauthenticated `POST /seniors` | `401` |
| A verifies membership exists | `200`, 1 member |
| **A resolves accessible senior** | `200`, `n=1`, `role=FAMILY_ADMIN` |
| **A calls existing senior-scoped domains** | medications `201`, appointments `201`, emergency alerts `201`, feed `201`, conversation `201`, message `201`, documents `200` |
| care-tasks (out of scope) | `404` — unchanged |
| **User B registers / logs in** | `201` / `201` |
| **B resolves no senior** | `200`, `[]` |
| **B reads A's senior (7 domains)** | **all `403`** |
| **B writes to A's senior** | **`403`** |
| **B creates a circle for A's senior** | **`403`** |
| **B adds itself to A's circle** | **`403`** |
| **B reads A's roster** | **`403`** |
| A adds B as `FAMILY_MEMBER` | `201`, `ACTIVE` |
| **B can now read A's medications** | **`200`** |
| duplicate membership | `409` |
| invalid role (`SUPER_ADMIN`) | `400` |
| duplicate circle name | `409` |
| A ends B's membership | `200`, `ENDED`, `endsAt` set |
| **B is `403` again after removal** | **`403`** |
| B no longer resolves A's senior | `n=0` |
| B restored (same row reused) | `201`, `ACTIVE`, `sameRow=true` |
| `endsAt` backdated, `status` still `ACTIVE` | **`403`** |
| expired senior not offered by `GET /me/seniors` | confirmed |
| Audit events for all four state changes | **none missing** |

Audit actions actually recorded: `senior_profile.created`, `care_circle.created`, `medication.created`, `appointment.created`, `emergency_alert.created`, `family_feed.post_created`, `messaging.conversation.created`, `messaging.message.created`, `care_circle.member.added`, `care_circle.member.ended`.

**Containment verified after the run:** pre-existing containers unchanged (identical creation timestamps — `pg-pgtest`, `ecc-postgres`, `ecc-redis`, `ecc-minio`); validation API port free; **developer database still 37 tables**; throwaway containers destroyed.

---

## 9. Out-of-scope findings — NOT implemented

Carried forward from Phase 48. None of these were touched:

- **PR-48-04** — web client is a shell (no login, no API client, no data). *OUT OF SCOPE — PHASE 49.*
- **PR-48-05** — mobile `documents` / `emergency` screens hardcode `seniorId = 00000000-0000-0000-0000-000000000001`. **Deliberately not fixed**, even though `GET /me/seniors` now makes it fixable. *OUT OF SCOPE — PHASE 49.*
- **PR-48-06** — `care-tasks` is dead code; no `.module.ts`, not registered. **Confirmed still `404` by test and at runtime**, so no silent wiring occurred. *OUT OF SCOPE — PHASE 49.*
- **PR-48-07** — no notification delivery (queue, push, email, SMS). *OUT OF SCOPE — PHASE 49.*
- **PR-48-08** — seeded users cannot log in (placeholder hash). Seed untouched. *OUT OF SCOPE — PHASE 49.*
- **PR-48-09** — `reset-password` returns success without changing the password. *OUT OF SCOPE — PHASE 49.*
- **PR-48-10** — `verify-email` returns success and does nothing. *OUT OF SCOPE — PHASE 49.*
- **PR-48-11** — `notification-preferences` persists nothing. *OUT OF SCOPE — PHASE 49.*
- **PR-48-12** — family-update `PATCH` is a stub. *OUT OF SCOPE — PHASE 49.*
- **PR-48-13** — no super-admin capability. *OUT OF SCOPE — PHASE 49.*
- **PR-48-14** — observer / senior-facing roles have enforcement but no consumer UI. *OUT OF SCOPE — PHASE 49.*
- **PR-48-15** — messaging has no mobile client. *OUT OF SCOPE — PHASE 49.*
- **PR-48-16** — 14 schema entities have no HTTP surface, incl. `Invitation`. *OUT OF SCOPE — PHASE 49.*
- **PR-48-17** — mobile has no retry/timeout/offline handling; `useAuth` masks auth expiry. *OUT OF SCOPE — PHASE 49.*
- **PR-48-18 … PR-48-24** — P2 polish (web test coverage, unguarded dashboards, measurement update, document download, component naming, accessibility verification, DB specs skipped by default). *OUT OF SCOPE — PHASE 49.*
- **PR-48-30** — README materially stale. *OUT OF SCOPE — PHASE 49.*

### Dependencies encountered and deliberately not expanded

- **Invitations.** `addMember` adds an **existing** platform account and is **not** an invitation system: no token, no acceptance, no delivery channel, and **the invitee's consent is not captured**. Recorded in §10 as a limitation.
- **A senior's own login account.** `User.seniorProfileId` is never set by this phase, and `AuthorizationService` authorizes on `CareCircleMember.userId`, so a senior who logs in does not thereby reach their own profile. Reaching it is possible if a family admin adds their user account to the circle. Extending the authorization model to cover self-access was out of scope. *OUT OF SCOPE — PHASE 49.*
- **Clients.** The mobile API layer is a single generic `apiFetch(path, options)` with no per-endpoint contract to extend, and the web client has no API client at all, so **no client contract change was required**. Phase 49 stops at the API boundary (§17); no UI was built.

---

## 10. Known limitations

Phase 49 establishes a backend access foundation. **It does not make this product production-ready, and no such claim is made.**

Limitations of this phase:

1. **No consent capture on membership grant.** A family admin can grant an existing user immediate `ACTIVE` access without any acceptance step. Inherent to the schema's absence of an invitation surface. Needs an invitation/consent phase.
2. **`FAMILY_ADMIN` is a broad grant.** It confers the ability to add further members and to perform every mutating senior-scoped action. The creator-only restriction on granting it is an **attribution rule, not a containment boundary** (SEC49-03): any `FAMILY_ADMIN` of the same senior can create another circle and thereby become its creator. It grants such a caller no authority they lacked.
3. **Membership restoration is implicit.** Restoring an ended member is `addMember` reactivating the retained row; there is no explicit "reactivate" route, and no audit event distinguishes a restore from a fresh add beyond the `restored` metadata field.
4. **`GET /me/seniors` role is a display hint.** A client that trusts it for UI gating is correct in practice only because every senior-scoped action re-checks server-side.
5. **`dateOfBirth` is `@db.Date` with no further domain constraints** (no plausibility window on age).
6. **Account liveness on write.** `onboardSenior` checks the actor's account is active, but access-token revocation on deactivation remains the deferred Phase 16 D-1 item.
7. **No client can consume this yet.** The web client is still a shell and mobile's two functional screens still target a non-existent senior. Senior selection is now *possible*; it is not *implemented*.
8. **Lint baseline fails** (§7.4) — pre-existing, not a CI gate.

Product-level limitations, unchanged and explicitly preserved:

- **Web client P0 (PR-48-04)** — still cannot perform any product function.
- **Mobile product gaps (PR-48-05, PR-48-15, PR-48-17)** — hardcoded senior id, no messaging screen, no network/auth-expiry handling.
- **Care-task P0 (PR-48-06)** — still dead code and still `404`.
- **Notifications (PR-48-07, PR-48-11)** — generation works only for emergency alerts; no delivery, no preferences persistence.
- **False-success stubs (PR-48-09, PR-48-10, PR-48-12)** — password reset, email verification and family-update editing still report success without doing the work. For an elderly-care product this is a trust problem, not a tidiness issue.
- **Remaining P1/P2 findings (PR-48-13 … PR-48-24)** — all still open.
- **Security posture unchanged** from the Phase 45 checkpoint (`9d810e3`, hosted run `36823191921`). This is **not** a security review, **not** a penetration test, and **not** a compliance assessment. Authorization was not weakened and no new public surface was introduced, but new endpoints mean new attack surface that has **not** been independently assessed.
- **Still no journey has end-to-end evidence through a client** (§16 proves the API path only, because no client can yet consume it).

---

## 11. Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Fresh user can legitimately establish/access a senior | **MET** — register → login → `POST /seniors` → `201`, verified live and in tests |
| 2 | Care-circle membership is created correctly | **MET** — same transaction, `FAMILY_ADMIN` / `ACTIVE` / `endsAt: null`, read back from the database |
| 3 | Accessible senior resolution works | **MET** — `GET /me/seniors`, derived from active unexpired membership, mirrors `AuthorizationService` predicates |
| 4 | Existing senior authorization remains enforced | **MET** — `AuthorizationService` unmodified; non-member `403` on all 7 domains; `OBSERVER`/`FAMILY_MEMBER` still denied admin acts |
| 5 | Legitimate user can reach existing senior-scoped APIs | **MET** — medications, appointments, measurements, documents, emergency alerts, feed, messaging all reachable post-onboarding |
| 6 | Unrelated user remains denied | **MET** — reads, writes, circle creation, self-add and roster reads all `403` |
| 7 | Relevant tests pass | **MET** — 35 unit; `api:integration` 195; `api:all` 440; runtime 44/44 plus remediation runs. **Lint fails on a pre-existing baseline (disclosed §7.4).** |
| 8 | Typecheck passes | **MET** — `pnpm typecheck` 11/11 |
| 9 | Build passes | **MET** — `pnpm build` 7/7; `verify:metadata` and `verify:routes` pass on the compiled artifact |
| 10 | No unrelated product scope implemented | **MET** — only `app.module.ts` modified plus the new module and its tests. Prisma schema untouched, `/auth/me` untouched, no client changes, no UI, `care-tasks` still `404` |

**No migration was created.** The existing schema fully supported the design (§3.3); `schema.prisma` and `prisma/migrations/` are byte-for-byte unchanged.

---

## 12. Git boundary

```
git status --short
 M apps/api/src/app.module.ts
?? apps/api/src/modules/care-circle/
?? apps/api/test/onboarding-access.e2e-spec.ts
?? docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md   (pre-existing, Phase 48's)

git diff --stat
 apps/api/src/app.module.ts | 4 ++++
 1 file changed, 4 insertions(+)
```

- Files modified: **1** (`apps/api/src/app.module.ts`, +4 lines).
- Files created: **11** (10 under `apps/api`, plus this report).
- Files created by Phase 49 outside `apps/api` and this report: **none**.
- **No commit created. No push. No amend. No reset, rebase, stash or force-push. The Phase 47 documentation checkpoint is untouched.**
- `HEAD` and `origin/main` both remain `d4c570bb56a1bef38b009e7890469b9b84bac5e3`.
- Prisma schema, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and root `package.json` unchanged.
- Runtime validation harness was written to `/tmp/opencode/`, **not** into the repository, to keep this boundary clean.

---

## 13. Explicit non-claims

- This is **not** a security review, penetration test, load test, soak test, or chaos test.
- This is **not** a compliance assessment.
- This is **not** a production-readiness certification, and no such claim is made.
- **No production readiness, security approval or complete product readiness is claimed.**
- **No overall score, percentage or ranking was assigned.**
- No production deployment or rehearsal was performed.
- No external users were contacted and no external service was altered.
- No production data was created or changed. All runtime validation used a disposable throwaway PostgreSQL container, since destroyed.
- The developer database was never a target (verified: 37 tables, unchanged); pre-existing containers are unchanged with identical creation timestamps.
- Documentation discrepancies recorded in Phase 48 (e.g. PR-48-30, the stale README) were **not** corrected.
- Pre-existing lint failures were **not** fixed and are **not** hidden.

**PHASE 49 IMPLEMENTATION COMPLETE**