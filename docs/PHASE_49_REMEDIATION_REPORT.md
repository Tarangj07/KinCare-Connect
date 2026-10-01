# Phase 49 Remediation Report

**Subject:** Targeted remediation of `docs/PHASE_49_SECURITY_REVIEW.md`
**Reviewer verdict addressed:** APPROVED WITH FINDINGS — 0 Critical, 0 High, 1 Medium, 4 Low, 4 Info
**Date:** 2026-10-01
**Nature:** **Remediation of security findings only.** Not a new product phase. Not a security review, not a penetration test, not a compliance assessment, not a production-readiness certification, and **not a security approval**.

---

## 1. Starting SHA and state

```
git rev-parse HEAD        = d4c570bb56a1bef38b009e7890469b9b84bac5e3
git rev-parse origin/main = d4c570bb56a1bef38b009e7890469b9b84bac5e3
```

Phase 49 remained **uncommitted** throughout. No reset, rebase, stash, amend or force-push was performed.

```
 M apps/api/src/app.module.ts
?? apps/api/src/modules/care-circle/
?? apps/api/test/onboarding-access.e2e-spec.ts
?? docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md
?? docs/PHASE_49_FINAL_REPORT.md
?? docs/PHASE_49_SECURITY_REVIEW.md
```

---

## 2. Findings addressed

| ID | Severity | Disposition |
|---|---|---|
| SEC49-01 | MEDIUM | **FIXED** — atomic, row-locked last-administrator guard |
| SEC49-02 | LOW | **CORRECTED** — documentation only; behaviour unchanged |
| SEC49-03 | LOW | **CORRECTED** — documentation only; authorization model unchanged |
| SEC49-04 | LOW | **FIXED (Phase 49-local)** — actor-liveness check on mutating operations |
| SEC49-05 | LOW | **ACCEPTED** — documented limitation |
| SEC49-06 | INFO | **ACCEPTED** — documented, no behaviour change |
| SEC49-07 | INFO | **DEFERRED** — data quality, out of scope |
| SEC49-08 | INFO | **FIXED** — independent status-predicate coverage added |
| SEC49-09 | INFO | **CORRECTED** — inaccurate claims corrected |

No finding was "fixed" by deleting or weakening a test.

---

## 3. SEC49-01 — root cause and remediation

### 3.1 Root cause

`removeMember` evaluated the last-usable-`FAMILY_ADMIN` guard with a `count()` executed **outside** the `$transaction` that performed the update. Under PostgreSQL's default isolation (**READ COMMITTED**, which Prisma's interactive transactions use), each statement takes a fresh snapshot, so two concurrent requests could both observe "one other admin remains" and both commit — driving the circle to **zero** usable administrators.

The review recorded `200 / 200` with zero survivors, plus a non-deterministic `409 / 200` variant on a repeat, which is itself characteristic of a race.

### 3.2 Approach chosen — explicit row lock (option A)

`removeMember` now performs, inside one transaction:

1. `SELECT … FOR UPDATE` as the **first** statement, over precisely the rows the decision depends on — the target member row, plus every currently usable `FAMILY_ADMIN` row of that circle — always in a deterministic `ORDER BY id` sequence;
2. a **re-read** of the target member under the lock;
3. the idempotency check (`status === 'ENDED'`);
4. the last-usable-admin `count`, now **inside** the transaction and after the lock;
5. the `ENDED` update;
6. the audit insert — in the same transaction.

### 3.3 Why moving the count alone would NOT have worked

Prisma's `$transaction` provides **atomicity of the commit**, not **serialisation of a read-modify-write**. At READ COMMITTED, two transactions can still each read a stale-but-committed admin set and both proceed. Row locking — not transaction nesting — is what closes the race. This was verified empirically: mutation **M7** (moving/keeping the count but removing `FOR UPDATE`) reproduces the original `200 / 200` defect, and the new test catches it.

### 3.4 Why it is safe under PostgreSQL concurrency

- `FOR UPDATE` takes a row-level exclusive lock held until commit.
- A concurrent transaction locking the same rows **blocks**.
- When the first commits, the blocked statement resumes and READ COMMITTED re-evaluates each row against its **newest** version (EvalPlanQual). A row the winner set to `ENDED` no longer matches the predicate and is **skipped**.
- The subsequent `count` therefore observes the winner's committed state, so the loser sees zero remaining admins and is refused.
- `ORDER BY id` forces one consistent lock-acquisition order for all callers, which makes deadlock between two concurrent removals **impossible** rather than merely unlikely.
- Lock scope is one circle's rows, so unrelated circles are not serialised.

### 3.5 Database safety

- **No Prisma schema or migration change.** `schema.prisma` and `prisma/migrations/` are untouched; the fix uses the existing `care_circle_members` indexes and columns.
- The lock uses Prisma's `$queryRaw` **tagged template**, so `circleId` and `memberId` are bound parameters. No value is interpolated into the SQL string; the only literals are static keywords (`FOR UPDATE`, `ORDER BY`, column names).
- Column names are quoted snake_case to match the physical table.

---

## 4. The concurrency invariant

> A care circle may not transition from ≥1 usable `FAMILY_ADMIN` to 0 usable `FAMILY_ADMIN` through concurrent member-removal requests.

**Acceptance criterion: zero runs may leave zero usable `FAMILY_ADMIN`.**

---

## 5. Concurrency test results

### 5.1 Permanent regression test

`apps/api/test/onboarding-access.e2e-spec.ts` — describe block `SEC49-01 — last-admin invariant under concurrency`. It issues **genuinely concurrent HTTP requests** (`Promise.all` against the same in-process Nest application, so the requests overlap on separate database connections exactly as two real clients would) and is **not** a sequential check.

- **Two admins removing each other concurrently**, repeated **8×** with fresh fixtures per iteration: asserts exactly one `200`, exactly one refusal, ≥1 surviving usable admin, and that the survivor can still read the roster.
- **Three admins, two removed concurrently**, repeated **4×**: asserts ≥1 surviving usable admin.
- **Audit integrity under the race**: asserts exactly one `care_circle.member.ended` row per *successful* removal and none for the refusal.

A companion describe block, `SEC49-01 — ordinary removal semantics preserved`, proves ordinary behaviour is unchanged: 2 admins → remove one `200` with one remaining; 1 admin → remove final `409`; already-`ENDED` → idempotent `200`; non-admin `403`; cross-circle member id `404`.

**Note on the refusal status.** The loser may legitimately receive **`409`** *or* **`403`**:
- `409` — it still held authorization when it checked, lost the lock race, and found itself the last usable admin;
- `403` — the winner had already committed, so the loser's membership was revoked before its authorization check completed.

`403` is the *stronger* answer (it discloses nothing about circle state), so the test asserts "exactly one success and one refusal" rather than a fixed code. The invariant is what is enforced, not the code.

### 5.2 Repeated runtime validation (§19)

Against the **built `dist/main.js`** under `NODE_ENV=production`, throwaway PostgreSQL, fresh isolated fixtures:

| Scenario | Iterations | Result |
|---|---|---|
| 2 admins, mutual concurrent removal | **40** | `both200 = 0`; `one200 + one409 = 40`; other = 0. **Survivor distribution `{1: 40}`.** |
| 3 admins, two removed concurrently | **40** | **Survivor distribution `{1: 40}`.** |
| Audit rows per successful removal | all | **always exactly 1** |
| **Invariant violations** | — | **2-admin = 0, 3-admin = 0** |

**ACCEPTANCE: PASS — zero runs left zero usable `FAMILY_ADMIN`.**

### 5.3 Proof the fix is load-bearing (mutation)

Performed on an isolated copy of the repository (since deleted); the working tree was never modified.

| Mutation | Expected detection | Actual |
|---|---|---|
| `M7` — drop the last-admin guard entirely | detected | **DETECTED** (unit + e2e) |
| `MLOCK` — keep the guard but remove `FOR UPDATE` from the lock | the concurrency test must catch the orphan | **DETECTED** — `AssertionError: iteration 0: statuses 200/200: expected 2 to be 1` |
| `M1` — widen `endsAt` to include past dates | detected | **DETECTED** |
| `M8` — removal stops setting `status = ENDED` | detected | **DETECTED** |
| `M2` — accept non-`ACTIVE` membership status | **was NOT detected before remediation** | **DETECTED** (see §7) |

The `MLOCK` result is the direct proof that the row lock — not merely the transaction — is what prevents the race, and that the new test genuinely guards the invariant.

---

## 6. Audit validation (§21)

Verified at runtime and in the permanent suite:

| Scenario | Expected | Result |
|---|---|---|
| Successful removal | exactly one `care_circle.member.ended` audit row | **1** |
| Concurrent refusal (`409` or `403`) | **no** audit row | **0** |
| Refused last-admin removal (`409`) | **no** audit row | **0** |
| Idempotent repeat removal | **no** additional audit row | **0** |
| Rejected removal after actor deactivation (`401`) | membership stays `ACTIVE`, no audit row | **`ACTIVE`, 0** |

Because the audit insert and the state change share one transaction, a rejected request can never leave a state/audit mismatch, and can never record a removal that did not happen.

---

## 7. SEC49-08 — coverage improvement

The review's mutation **M2** (removing `status: 'ACTIVE'` from `AuthorizationService.membershipWhere`) previously passed **every** suite, because all existing denial assertions falsify `endsAt` as well, making the two predicates redundant.

A new describe block, `SEC49-08 — status predicate is decisive independently of endsAt`, falsifies **`status` alone**:

| Case | `endsAt` | senior-scoped authorization | `GET /me/seniors` |
|---|---|---|---|
| `status = ACTIVE` | `null` | **200** | **listed** |
| `status = ENDED` | **`null`** | **403** | **hidden** |
| `status = PENDING` | **`null`** | **403** | **hidden** |

Each case asserts `endsAt` is genuinely `NULL` before asserting the denial, so the test cannot pass for the wrong reason. **`AuthorizationService` was not modified.** Re-running mutation M2 against the remediated suite: **DETECTED** (previously not detected). It is also verified at runtime against the built app (20/20 checks pass).

---

## 8. SEC49-02 — documentation correction (no behaviour change)

The report and an inline code comment claimed a nonexistent circle and an inaccessible circle produce the same response. **They do not.** Verified behaviour, unchanged by this remediation:

```
unauthorized caller, unknown circleId      -> 404
unauthorized caller, real inaccessible circleId -> 403
```

Corrected in:
- `apps/api/src/modules/care-circle/services/care-circle.service.ts` (`loadCircle` doc comment) — now states the oracle plainly and cross-references SEC49-02.
- `docs/PHASE_49_FINAL_REPORT.md` §5 (`GET /care-circles/:circleId/members` and `POST …/members` error rows).

The oracle is **accepted**, not closed: exploiting it requires already holding a valid UUIDv4, which is not practically enumerable, and closing it would require reordering authorization before existence resolution. `POST /care-circles` is not an oracle — nonexistent and foreign `seniorId` both yield `403`. Behaviour is deliberately unchanged so that the documentation, not the product, is corrected.

---

## 9. SEC49-03 — documentation correction (no model change)

The creator-only `FAMILY_ADMIN` grant rule was described as confining escalation. The review demonstrated the bypass: any `FAMILY_ADMIN` of a senior may `POST /care-circles`, become that circle's recorded `createdById`, and grant `FAMILY_ADMIN` there.

The rule is now documented accurately, in both the source comment and the report, as:

- an **attribution rule** on who may grant the role in a given circle — **not** a containment boundary;
- **not** a privilege-escalation path, because `assertFamilyAdmin` is senior-scoped, so any such caller is already family admin across the whole senior and grants nothing they lacked.

**The authorization model was not changed.** Making the rule a real boundary would require scoping `FAMILY_ADMIN` to a circle, which would alter the existing model and was explicitly out of scope.

---

## 10. SEC49-04 — decision

**FIXED, Phase 49-locally.** All three mutating care-circle operations (`createCircle`, `addMember`, `removeMember`) now perform the same actor-liveness check `SeniorService.onboardSenior` already used, returning `401` for an inactive or soft-deleted account. This was implemented cleanly — one small private method reusing the existing check — so it did not broaden scope.

**This is a mitigation, not a fix for Phase 16 D-1, and this report does not claim to close it.** It does **not** revoke an already-issued token, and it does **not** narrow what a stale token can read within the bounds the pre-existing domains already permit. Root-cause remediation remains deferred to the D-1 token-revocation/versioning work.

Verified at runtime and in the permanent suite: a deactivated actor receives `401` on add/remove/create; a soft-deleted actor likewise; a reactivated account can act again; and a refused removal leaves membership `ACTIVE` with **no** audit row.

---

## 11. SEC49-05 / SEC49-06 / SEC49-07 — disposition

| ID | Disposition | Rationale |
|---|---|---|
| **SEC49-05** | **ACCEPTED** | Platform-user existence oracle is reachable only by an already-authorized `FAMILY_ADMIN`; unauthorized callers receive `403` for both existing and nonexistent accounts (verified). UUIDv4 is not guessable, so bulk enumeration is impractical. Uniformising the response or restricting adds to known circle members would be a product decision. |
| **SEC49-06** | **ACCEPTED** | Ended members remain visible in the roster to senior-scoped members including `OBSERVER`. No email and no notes are disclosed (both verified absent). This is a **product privacy decision that is not defined in existing requirements**; inventing a policy here would be scope creep. Documented as accepted. |
| **SEC49-07** | **DEFERRED** | `dateOfBirth` accepts technically valid but implausibly old dates (`0000-01-01`, `0001-01-01`). Data quality, not security. Adding a plausibility window is domain-policy design and was deliberately not invented. |

---

## 12. Tests

| Suite | Before remediation | After remediation |
|---|---|---|
| `care-circle.service.spec.ts` (unit) | 28 | **35** (+7: lock ordering, count-inside-transaction, re-read under lock, no audit on refusal, liveness checks) |
| `onboarding-access.e2e-spec.ts` (DB, HTTP) | 33 | **57** (+24: concurrency invariant ×8 and ×4, audit-under-race, ordinary semantics, SEC49-08 ×4, SEC49-04) |
| `pnpm test` (API) | 194 passed / 44 skipped | **201 passed / 44 skipped** |
| `node scripts/run-db-suites.mjs` → `api:integration` | 183 | **195 passed** |
| `node scripts/run-db-suites.mjs` → `api:all` | 421 | **440 passed** |

**No existing security test was modified, skipped, weakened or deleted.** No existing authorization code was weakened. Existing suites re-run and passing unmodified: `authorization.db.spec.ts`, `authorization-matrix.security.e2e-spec.ts`, `resources.security.e2e-spec.ts`, `emergency.security.e2e-spec.ts`, `documents.security.e2e-spec.ts`, `messaging.security.e2e-spec.ts`.

---

## 13. Typecheck / build

| Command | Result |
|---|---|
| `pnpm typecheck` | **PASS** — 11/11 tasks |
| `pnpm build` | **PASS** — 7/7 tasks |
| `verify:metadata` | **PASS** — 0 `"Function"` entries |
| `verify:routes` | **PASS** — every non-public live route guarded |
| `prisma validate` | **PASS** — schema valid and unmodified |

`pnpm lint` continues to fail on the **pre-existing** baseline disclosed in the Phase 49 report §7.4 (55 errors / 68 warnings on pre-existing tracked files). Not in scope for this remediation; not hidden.

---

## 14. DB / runtime validation (§20)

- All runtime testing used **throwaway** PostgreSQL via `scripts/lib/throwaway-postgres.mjs` (`ecc-p49rem-*`, `ecc-p49rem2-*`, `ecc-p49mut-*`, `ecc-p28-*` from the repository's own driver). **The developer database was never a target.**
- The built `dist/main.js` was exercised under `NODE_ENV=production`.
- Runtime validation: **20/20** checks passed (SEC49-04 liveness, ordinary removal semantics, audit integrity, SEC49-08 runtime, SEC49-02 documented behaviour).
- Concurrency validation: **40 + 40** iterations, **0 invariant violations**.
- All throwaway containers **destroyed**.
- **Developer database verified unchanged: 37 tables.** Pre-existing containers untouched.
- All throwaway harnesses and the isolated mutant tree were deleted.

---

## 15. Files changed

| File | Change |
|---|---|
| `apps/api/src/modules/care-circle/services/care-circle.service.ts` | `removeMember`: row-locked, in-transaction last-admin guard; actor-liveness check on 3 mutating operations; corrected `loadCircle` and creator-rule comments (SEC49-02, SEC49-03) |
| `apps/api/src/modules/care-circle/services/care-circle.service.spec.ts` | +7 unit tests; mocks for `$queryRaw` and actor liveness |
| `apps/api/test/onboarding-access.e2e-spec.ts` | +24 tests: concurrency invariant, audit-under-race, ordinary removal semantics, SEC49-08, SEC49-04; `provision()` now also returns `memberId` (additive) |
| `docs/PHASE_49_FINAL_REPORT.md` | **Corrections only** (SEC49-02, SEC49-03, SEC49-09) + remediation annotations and updated counts |
| `docs/PHASE_49_REMEDIATION_REPORT.md` | This report (new) |

**Not changed:** `docs/PHASE_49_SECURITY_REVIEW.md` (immutable record), `docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md`, `apps/api/src/auth/**` (including `AuthorizationService`), the Prisma schema, migrations, all other modules, and all clients.

---

## 16. Remaining findings

- **SEC49-02** — accepted (narrow circle-existence oracle; needs a valid UUID to exploit).
- **SEC49-03** — accepted by documentation; the creator-only rule is attribution, not containment. Closing it properly requires a circle-scoped `FAMILY_ADMIN`, which would change the authorization model.
- **SEC49-05** — accepted (user-existence oracle for an authorized `FAMILY_ADMIN`).
- **SEC49-06** — accepted (ended members visible in the roster, including to `OBSERVER`; a product privacy decision).
- **SEC49-07** — deferred (implausibly old `dateOfBirth` accepted; data quality).
- **Phase 16 D-1** — still open: access tokens are not revoked on account deactivation. SEC49-04 mitigates the Phase 49 grant path only.
- **Pre-existing Phase 48 findings** — all still open and out of scope (web client, mobile, care tasks, notifications, false-success stubs, super admin, and the remainder).

---

## 17. Explicit non-claims

- This remediation does **not** constitute a security review, penetration test, compliance assessment, or security certification.
- **No security approval is claimed.** The independent re-review that follows is the next step; this phase is not a checkpoint commit.
- **No production readiness is claimed.**
- A passing concurrency run is evidence for **this** invariant under **this** test shape and scheduling; it is not a proof of the absence of all races.
- The row lock guarantees the last-administrator invariant. It does not make `removeMember` free of deadlocks in every conceivable multi-circle workload, though the deterministic lock order makes deadlock between concurrent removals on one circle impossible.
- No existing security test was weakened, and no failing check was suppressed to obtain a green run.
- The Phase 49 product surface remains subject to the unresolved Phase 45 security checkpoint and the open Phase 48 findings, none of which were re-assessed here.

---

## 18. Finding disposition (final)

| ID | Disposition |
|---|---|
| SEC49-01 | **FIXED** — 40+40 iterations, zero invariant violations; `FOR UPDATE` removal reproduces the defect and is caught by the new test |
| SEC49-02 | **CORRECTED** — documentation now states the real 404/403 behaviour; behaviour unchanged |
| SEC49-03 | **CORRECTED** — documentation now describes an attribution rule, not containment; model unchanged |
| SEC49-04 | **FIXED** — Phase 49-local actor-liveness check on mutating operations; D-1 remains open |
| SEC49-05 | **ACCEPTED** |
| SEC49-06 | **ACCEPTED** |
| SEC49-07 | **DEFERRED** |
| SEC49-08 | **FIXED** — M2 now detected |
| SEC49-09 | **CORRECTED** |

**PHASE 49 REMEDIATION COMPLETE**