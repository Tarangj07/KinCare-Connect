# Phase 49 Independent Security Re-Review

**Subject:** Independent re-review of Phase 49 after targeted remediation of `docs/PHASE_49_SECURITY_REVIEW.md`
**Date:** 2026-10-01
**Nature:** **Independent security re-review only.** Not a penetration test, not a compliance assessment, not a security certification, and **not a security approval**.

> **No overall security score, percentage, ranking, or "best" label is assigned.**

---

## 1. Starting SHA / state

Independently verified before any activity (not taken from the remediation report):

```
git rev-parse HEAD        = d4c570bb56a1bef38b009e7890469b9b84bac5e3
git rev-parse origin/main = d4c570bb56a1bef38b009e7890469b9b84bac5e3

git status --short
 M apps/api/src/app.module.ts
?? apps/api/src/modules/care-circle/
?? apps/api/test/onboarding-access.e2e-spec.ts
?? docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md
?? docs/PHASE_49_FINAL_REPORT.md
?? docs/PHASE_49_REMEDIATION_REPORT.md
?? docs/PHASE_49_SECURITY_REVIEW.md

git diff --stat
 apps/api/src/app.module.ts | 4 ++++
```

Phase 49 implementation + remediation remain **uncommitted**. A 158-file SHA-256 manifest was recorded at the start and re-verified at the end (§13).

**Read in the prescribed order:** `PHASE_49_SECURITY_REVIEW.md` → `PHASE_49_FINAL_REPORT.md` → `PHASE_49_REMEDIATION_REPORT.md` → **the actual implementation source** → the tests. Claims were treated as claims.

---

## 2. Exact scope

Determine independently whether the remediation closes **SEC49-01**, and whether the other eight claimed dispositions are supported. Specifically re-derive the security properties from source, real PostgreSQL behaviour and tests.

**Explicitly not done:** no source, test, schema, migration, CI or workflow was modified. No fix was implemented. No authorization model was redesigned. No lint baseline fixed. No Phase 16 D-1 work. No checkpoint commit. No push.

---

## 3. Source inspection performed

| Area | Detail |
|---|---|
| `care-circle.service.ts` | `removeMember` read line-by-line; `assertActorUsable`, `assertFamilyAdmin`, `loadCircle`, `createCircle`, `addMember`, `mapMember` |
| Membership write paths | `grep careCircleMember.(update|create|delete|upsert)` across the whole app |
| Compiled artifact | `FOR UPDATE` confirmed present in `dist/…/care-circle.service.js` (line 242) |
| Lock predicate | compared field-by-field against `AuthorizationService.membershipWhere` |
| Tests | `care-circle.service.spec.ts`, `onboarding-access.e2e-spec.ts` (new blocks), existing security specs |
| Docs | all four Phase 49 documents, cross-checked against observed behaviour |

### 3.1 SEC49-01 — item-by-item verification (A–J)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| A | Decision and transition in the same DB transaction | **PASS** | `count`, `update` and `auditLog.create` are all inside one `$transaction`; `count` no longer runs outside it |
| B | Decision rows locked **before** the decision | **PASS** | `SELECT … FOR UPDATE` is the first statement in the transaction |
| C | Lock covers target row + every usable `FAMILY_ADMIN` of that circle | **PASS** | predicate is `deleted_at IS NULL AND ( id = $target OR (circle_id = $circle AND role='FAMILY_ADMIN' AND status='ACTIVE' AND (ends_at IS NULL OR ends_at > now())) )` |
| D | Usable-admin predicate matches authorization semantics | **PASS** | lock and count both require `role='FAMILY_ADMIN'`, `status='ACTIVE'`, `deletedAt IS NULL`, `endsAt IS NULL OR > now()` — identical to `AuthorizationService.membershipWhere` |
| E | `FOR UPDATE` actually executed by PostgreSQL, not mocked | **PASS** | proven live (§5): a conflicting write to a locked admin row **blocked**; present in the compiled artifact |
| F | Deterministic `ORDER BY id` lock ordering | **PASS** | present in source; forces one consistent acquisition order |
| G | Target re-read after locking | **PASS** | second `findFirst` inside the transaction, after the lock |
| H | Count after the lock, against current state | **PASS** | ordering asserted by unit test: `['lock','count','update']` |
| I | Update and audit in the same transaction | **PASS** | single `$transaction` |
| J | No alternative path can remove a `FAMILY_ADMIN` bypassing the invariant | **PASS** | the only `status='ENDED'` write in the entire application is `removeMember` (line 501). `addMember`'s restore only ever sets `ACTIVE` (increases the admin count). `emergency.service` only reads. |

**Independent conclusion on the mechanism.** The remediation's claim that "moving the count into `$transaction` alone would not fix it" is **correct and load-bearing**. Prisma's interactive transactions run at PostgreSQL's default READ COMMITTED, where each statement takes a fresh snapshot; without row locking, two transactions can still both read a valid admin set. The load-bearing element is `SELECT … FOR UPDATE`, and §6 proves it by removing it and reproducing the original defect.

---

## 4. SEC49-01 verdict

**GENUINELY CLOSED — not blocking.**

The invariant *a care circle may not transition from ≥1 usable `FAMILY_ADMIN` to 0 through concurrent member removal* is enforced by a database-backed row lock, verified to be executed by real PostgreSQL, and guarded by a regression test proven to fail when the lock is removed.

---

## 5. Concurrency reproduction results (§2)

Disposable PostgreSQL via `scripts/lib/throwaway-postgres.mjs`; built `dist/main.js` under `NODE_ENV=production`; **genuinely concurrent** `Promise.all` HTTP requests against the live server (separate database connections), fresh isolated fixtures per iteration.

| Scenario | Iterations | Result |
|---|---|---|
| 2 usable admins, each removes the other | **40** | `both200 = 0`; exactly one success in **40/40**; refusals `409 ×39`, `403 ×1`; **survivors `{1: 40}`** |
| 3 usable admins, two removed concurrently | **40** | `200 ×80`; **survivors `{1: 40}`** |

- Never both requests succeeded: **confirmed**.
- Never zero usable `FAMILY_ADMIN` remained: **confirmed**.
- Exactly one succeeded and the other was refused: **confirmed**.
- Survivor remained usable: **confirmed** (survivor could still read the roster).

**Note on the `403` refusal.** When the winner commits before the loser's authorization check, the loser receives `403` rather than `409`. This is a *stronger* denial (it discloses nothing about circle state) and is a legitimate refusal. The permanent test asserts "exactly one success and one refusal" rather than a fixed code — which is the correct invariant to assert.

**No sequential-only testing was relied upon**: every run above used concurrent requests.

---

## 6. `FOR UPDATE` negative control (§3)

Performed in an isolated copy at `/tmp/opencode/p49rr/mut` (deleted afterwards). The real working tree was never modified.

| Mutation | Expected | Actual |
|---|---|---|
| **Remove `FOR UPDATE`, keep the guard** | concurrency regression must fail, reproducing `200/200` | **DETECTED** — `2 failed / 55 passed`; assertion: `iteration 0: statuses 200/200: expected 2 to be 1` |
| Remove `status='ACTIVE'` (SEC49-08) | SEC49-08 regression must fail | **DETECTED** — assertion: `expected 200 to be 403` |
| Remove the last-admin guard entirely | last-admin regression must fail | **DETECTED** — `4 failed`; `statuses 200/200` and `expected 200 to be 409` |

Baseline before mutation: `57 passed`. After restoring all mutations: `57 passed`.

The first result is the decisive one: removing `FOR UPDATE` **reproduces the original `200/200` defect**, confirming both that the row lock is load-bearing and that the permanent test genuinely guards the invariant rather than passing incidentally.

**Additional live proof that the lock is real** (not simulated): with the lock held on one connection, a conflicting write to the locked admin row **blocked**, while a concurrent `addMember` for a *different* member succeeded (`201`) — confirming the lock is both effective and correctly scoped, and that unrelated membership work is not serialised.

---

## 7. SEC49-08 verdict

Independently verified that authorization requires `ACTIVE` status and that the tests do **not** accidentally falsify `endsAt`:

| Case | `endsAt` verified NULL | senior-scoped authorization | `GET /me/seniors` |
|---|---|---|---|
| `ACTIVE` | yes | **200 authorized** | **listed** |
| `ENDED` | yes | **403 denied** | **hidden** |
| `PENDING` | yes | **403 denied** | **hidden** |

Mutation removing `status='ACTIVE'` from the authorization predicate **fails** the regression (`expected 200 to be 403`). **`AuthorizationService` was not modified.** **FIXED.**

---

## 8. SEC49-04 verdict

All three mutating care-circle operations verified independently:

| Case | `createCircle` | `addMember` | `removeMember` |
|---|---|---|---|
| Active actor | **201** | **201** | **200** |
| Deactivated actor | **401** | **401** | **401** |
| Soft-deleted actor | — | **401** | — |
| Reactivated actor | — | **201** | — |

A refused removal left the membership `ACTIVE` and wrote no audit row.

**Explicit distinction, as required:**

- This is a **Phase 49-local mitigation**. It blocks the three Phase 49 mutating endpoints for an account that is inactive or soft-deleted.
- It is **NOT** closure of **Phase 16 D-1**. It does **not** revoke an already-issued token, does **not** invalidate existing access tokens, and does **not** narrow what a stale token can *read* — read endpoints remain ungated, exactly as in the pre-existing domains. Root-cause remediation remains deferred.

The remediation report states this correctly ("a mitigation, not a fix for Phase 16 D-1, and this report does not claim to close it"). **Documentation accurate. Disposition accepted.**

---

## 9. SEC49-02 — circle existence oracle

**The oracle is still present. It is NOT fixed, and this review does not call it fixed.**

Independently observed for an unauthorized caller:

| Case | Result |
|---|---|
| Nonexistent circle UUID | **404** |
| Existing but inaccessible circle UUID | **403** |
| `POST /care-circles` with nonexistent `seniorId` | **403** |
| `POST /care-circles` with foreign `seniorId` | **403** (not an oracle) |

**Documentation accuracy:** the Phase 49 final report §5 now states the real behaviour plainly, including an explicit correction of its earlier incorrect claim. The inline `loadCircle` comment likewise. `docs/PHASE_49_SECURITY_REVIEW.md` is unchanged (immutable).

**Residual impact assessment:** LOW and correctly accepted. Exploitation requires already holding a valid circle UUIDv4; identifiers are not practically enumerable, and no circle data is disclosed. **Disposition ACCEPTED / documented.**

### 9.1 New documentation discrepancy found (SEC49-RR-01, INFO)

The remediation introduced a **new, factually incorrect** statement in `docs/PHASE_49_FINAL_REPORT.md`, line 190 (`POST /api/v1/care-circles/:circleId/members`, Errors row):

> "`404` unknown circle (see the SEC49-02 note above — **`404` here also covers a circle that exists but is inaccessible**)"

**This is wrong.** Verified at runtime: for an existing but inaccessible circle, `addMember` returns **403**, not 404. It appears the remediation's edit over-corrected while fixing SEC49-02. The equivalent rows for `GET …/members` and `DELETE …/members/:memberId` are accurate.

**Recorded, not silently edited** (per §12). It is a documentation defect only; no behaviour is affected, and it does not weaken any control. Severity **INFO**.

---

## 10. SEC49-03 — creator-only `FAMILY_ADMIN` rule

Independently confirmed the actual authorization model:

| Step | Observed |
|---|---|
| Non-creator `FAMILY_ADMIN` grants `FAMILY_ADMIN` in the owner's circle | **403** |
| Any `FAMILY_ADMIN` creates another circle for the same senior | **201** |
| That caller then grants `FAMILY_ADMIN` in it | **201** |
| That caller could already add members in a circle it did not create | **201** |

`FAMILY_ADMIN` authority is **senior-scoped, not circle-scoped** (`AuthorizationService.isFamilyAdmin(userId, seniorId)`). The creator-only rule is therefore **attribution, not containment** — and because the caller is already family admin across the whole senior, the chain confers **no authority they did not already hold**. It is **not privilege escalation**.

Documentation in the final report now characterises it exactly this way. **CORRECTED and accurate. Disposition ACCEPTED.** The authorization model was not changed, correctly.

---

## 11. SEC49-05 / SEC49-06 / SEC49-07

| ID | Independently observed | Disposition reasonable? |
|---|---|---|
| **SEC49-05** | Authorized `FAMILY_ADMIN`: existing user **201**, nonexistent **404** — oracle present. An **unauthorized** caller receives **403 for both** an existing and a nonexistent user, so the oracle is **not** reachable without senior-level admin. | **Yes — ACCEPTED.** Realistically limited to targeted confirmation; UUIDv4 not guessable. |
| **SEC49-06** | Ended members remain visible in the roster to an `OBSERVER` (`status: 'ENDED'` visible = true). Neither `email` nor `notes` is disclosed (verified absent). | **Yes — ACCEPTED.** This is a product privacy decision not defined in existing requirements; inventing one here would be scope creep. |
| **SEC49-07** | `dateOfBirth: '0001-01-01'` still accepted (**201**). | **Yes — DEFERRED.** Data quality, not security. No plausibility window was invented. |

No new product or privacy requirement was introduced by this review.

---

## 12. IDOR / authorization regression (§9)

All verified against the running application.

- **Cross-senior reads by an unrelated authenticated user:** medications, appointments, measurements, documents, emergency alerts, feed, conversations — **all 403**.
- **Cross-circle manipulation:** roster read **403**, member add **403**, member delete **403**, circle creation for a foreign senior **403**.
- **IDOR by id substitution:** valid `memberId` under a foreign circle → **404**; foreign `memberId` under the caller's own circle → **403**.
- **Caller-controlled identity:** `POST /seniors` rejects injected `userId`, `createdById`, `id`, `role`, `status`, `endsAt`, `deletedAt`, `isActive`, `globalRole` — **all 400**.
- **Onboarding identity binding:** `membership.userId === JWT subject` and `circle.createdById === JWT subject` — **verified by reading the rows back**.
- **Stale/ended state:** expired `endsAt` **403**; inactive senior **403**; inactive circle **403**.
- **Role boundaries via the new path:** `FAMILY_MEMBER` and `OBSERVER` — add **403**, remove **403**, create circle **403**, read **200**.
- **Membership lifecycle:** duplicate while `ACTIVE` → **409** and the stored role is **not** mutated; removal → `ENDED` + `endsAt` and access lost; restoration → **201 reusing the same row**, `ACTIVE`, `endsAt` null, role updated, access regained; duplicate after restore → **409**; exactly **1** row throughout.
- **Malformed UUID** → **400**.
- **`GET /me/seniors` alignment:** verified semantically aligned with `AuthorizationService` — ACTIVE/ENDED/PENDING and inactive-senior/circle cases agree in both directions.

**No authorization regression detected.**

---

## 13. Transaction / audit integrity (§10)

| Scenario | Expected | Observed |
|---|---|---|
| Successful removal of one of two admins | `200` + exactly one audit row | **200**, **1** audit row |
| Sole admin removing itself | `409`, row untouched | **409**, row still `ACTIVE`, `endsAt` null, senior still reachable (200) |
| Refused last-admin removal | no audit row | **0** audit rows |
| Refused removal after deactivation | membership unchanged, no audit | `ACTIVE`, **0** |
| Refused concurrent removal (race) | no audit row for the refusal | audits written == number of successes (exactly 1) |
| Restoration | no duplicate row | same row id, exactly **1** row |
| Existing `ACTIVE` membership | protected by uniqueness + `409` | **409**, role unchanged |

State and audit commit or roll back together. **No state/audit mismatch path found.**

---

## 14. Test integrity (§11)

- **No existing security test was weakened, deleted or skipped.** The only `describe.skip` occurrences are the pre-existing `const describeDb = DB_URL ? describe : describe.skip;` guards (9 files), which are original.
- **Concurrency tests are genuinely concurrent** — `Promise.all` of live HTTP requests, not sequential.
- **Tests assert the invariant, not just status codes:** survivor count, successful-removal count, refusal count, and audit-row count are all asserted independently of which code is returned.
- **Not dependent on a fixed race ordering:** the test accepts `409` **or** `403` for the loser, so it cannot pass by luck of scheduling, and cannot fail spuriously because a different interleaving won the race.
- **Mocks do not replace the critical PostgreSQL behaviour.** The unit spec asserts *ordering* (`lock → count → update`); the invariant itself is proven only against real PostgreSQL in the DB-backed e2e suite, which is where the negative control operates.

### Results

| Command | Result |
|---|---|
| `pnpm typecheck` | **PASS** — 11/11 |
| `pnpm build` | **PASS** — 7/7 |
| `pnpm test` | **PASS** — API **201 passed / 44 skipped**; web 1/1; mobile 34/34 |
| `node scripts/run-db-suites.mjs` → `api:integration` | **PASS** — 9 files, **195 tests** |
| `node scripts/run-db-suites.mjs` → `api:all` | **PASS** — 29 files, **440 tests** |
| `verify:metadata` | **PASS** — 0 `"Function"` entries |
| `verify:routes` | **PASS** — every non-public live route guarded |
| `prisma validate` | **PASS** — schema valid, unmodified |

Existing security suites re-run and passing unmodified: `authorization.db.spec.ts`, `authorization-matrix.security.e2e-spec.ts`, `resources.security.e2e-spec.ts`, `emergency.security.e2e-spec.ts`, `documents.security.e2e-spec.ts`, `messaging.security.e2e-spec.ts`.

**Lint baseline disclosed, not treated as new:** `pnpm lint` still fails on the pre-existing baseline documented in the Phase 49 report §7.4. This review introduced **no** new lint regression and did not attempt to fix the baseline.

---

## 15. Documentation consistency (§12)

| Check | Result |
|---|---|
| `PHASE_49_SECURITY_REVIEW.md` unchanged | **CONFIRMED** — 461 lines, SHA-256 `bbf339bb…`, only ever read |
| `PHASE_49_FINAL_REPORT.md` reflects implementation | **MOSTLY ACCURATE** — one new inaccuracy recorded as SEC49-RR-01 (§9.1) |
| `PHASE_49_REMEDIATION_REPORT.md` describes what was done | **ACCURATE** — independently confirmed SEC49-01, SEC49-08, SEC49-04 claims |
| No report claims security approval | **CONFIRMED** — all occurrences are explicit negations |
| No report claims production readiness | **CONFIRMED** — all occurrences are explicit negations |
| No report claims D-1 closed | **CONFIRMED** — D-1 stated as still open in three places |
| SEC49-02 accurately characterised | **CONFIRMED**, except the new inaccuracy in SEC49-RR-01 |
| SEC49-03 accurately characterised | **CONFIRMED** |
| Remaining Phase 48 findings explicitly out of scope | **CONFIRMED** (remediation report §16, §17) |

---

## 16. Environment safety (§13)

- **Throwaway PostgreSQL only** (`ecc-p49rr-*`, `ecc-p49rf-*`, `ecc-p49neg-*`, `ecc-p28-*`), provisioned by the repository's own `scripts/lib/throwaway-postgres.mjs`.
- **Developer database never targeted** — verified **37 tables** before and after.
- **Pre-existing containers not intentionally modified.** `pg-pgtest` and the three compose containers were observed running throughout; no container command was issued against them.
- **Every throwaway container destroyed.**
- **Isolated mutation tree and all temporary harnesses deleted.**
- **Repository integrity:** the 158-file SHA-256 manifest recorded at the start was re-verified at the end (§19).

**Anomaly recorded:** during the *earlier* security-review phase, heavy parallel worker use coincided with a Docker daemon restart (compose containers reported "Up N minutes", and pre-existing `pg-pgtest` logged `exit=0, oom=false`). That phase was re-run single-fork afterwards. **No anomaly occurred during this re-review**; this review used sequential execution and recorded no environment disturbance.

---

## 17. Newly discovered findings

| ID | Severity | Title |
|---|---|---|
| **SEC49-RR-01** | **INFO** | Documentation: `PHASE_49_FINAL_REPORT.md` line 190 incorrectly states that `POST /care-circles/:circleId/members` returns `404` for a circle that exists but is inaccessible. Verified actual behaviour is **403**. Introduced by the remediation while correcting SEC49-02. Documentation only; no behaviour or control affected. |

**No Critical, High or Medium findings were discovered.** No new security weakness, no authorization regression, and no transaction or audit defect was found.

---

## 18. Severity summary

| Severity | Count |
|---|---|
| Critical | **0** |
| High | **0** |
| Medium | **0** |
| Low | **0** (open; the four original Lows are dispositioned below) |
| Info | **1** (SEC49-RR-01, documentation only) |

Original findings, current disposition:

| ID | Original severity | Re-review disposition |
|---|---|---|
| SEC49-01 | MEDIUM | **CLOSED** — independently verified, no longer blocking |
| SEC49-02 | LOW | **ACCEPTED** — oracle remains, documentation now accurate |
| SEC49-03 | LOW | **ACCEPTED** — documentation accurate, no escalation |
| SEC49-04 | LOW | **ACCEPTED** as Phase 49-local mitigation; **D-1 still open** |
| SEC49-05 | LOW | **ACCEPTED** |
| SEC49-06 | INFO | **ACCEPTED** |
| SEC49-07 | INFO | **DEFERRED** |
| SEC49-08 | INFO | **CLOSED** |
| SEC49-09 | INFO | **CLOSED** |

---

## 19. Explicit statement: does SEC49-01 remain blocking?

**No. SEC49-01 is no longer blocking.**

This was not accepted on the strength of the remediation report. The closure rests on four independent legs:

1. **Static** — the decision and the transition share one transaction; the decision rows are locked first, with a predicate matching `AuthorizationService` exactly; the target is re-read under the lock; no other code path in the application can end a `FAMILY_ADMIN` membership.
2. **Live database** — `FOR UPDATE` was observed to genuinely block a conflicting write while permitting unrelated membership work.
3. **Repeated concurrency** — 40 + 40 genuinely concurrent iterations with **zero** invariant violations and exactly one survivor every time.
4. **Negative control** — removing `FOR UPDATE` reproduces the original `200/200` defect and the permanent regression catches it.

---

## 20. Git boundary (final)

```
git status --short
 M apps/api/src/app.module.ts
?? apps/api/src/modules/care-circle/
?? apps/api/test/onboarding-access.e2e-spec.ts
?? docs/PHASE_48_PRODUCT_READINESS_ASSESSMENT.md
?? docs/PHASE_49_FINAL_REPORT.md
?? docs/PHASE_49_REMEDIATION_REPORT.md
?? docs/PHASE_49_SECURITY_REVIEW.md
?? docs/PHASE_49_SECURITY_RE_REVIEW.md

git diff --stat
 apps/api/src/app.module.ts | 4 ++++
 1 file changed, 4 insertions(+)

HEAD        = d4c570bb56a1bef38b009e7890469b9b84bac5e3
origin/main = d4c570bb56a1bef38b009e7890469b9b84bac5e3
```

**The only repository change made by this re-review is the creation of this report.** No commit, push, amend, reset, rebase or stash. The implementation, the remediation, and all prior reports are untouched — `docs/PHASE_49_SECURITY_REVIEW.md` verified byte-identical, and the 158-file manifest re-verified with **0 non-matching files**.

---

## 21. Final verdict

# APPROVED FOR PHASE 49 CHECKPOINT

Justification, per the stated criterion: **no Critical, High or Medium finding remains, and SEC49-01 is genuinely closed.**

Qualifications that must travel with this approval:

- **No security approval and no production readiness is claimed.** This verdict covers the Phase 49 access-foundation surface only.
- The pre-existing **Phase 45 security checkpoint** stands, unre-assessed.
- **Phase 16 D-1 remains open**: access tokens are not revoked on deactivation. SEC49-04 mitigates only the three Phase 49 mutating endpoints.
- The five accepted/deferred findings (SEC49-02, SEC49-03, SEC49-05, SEC49-06, SEC49-07) remain open and are **not** closed by this approval.
- **SEC49-RR-01** (documentation inaccuracy) is recorded and unfixed; it should be corrected in documentation but is not blocking.
- All **Phase 48 product findings** (web client, mobile, care tasks, notifications, false-success stubs, super admin, and the remainder) remain open and out of scope.
- Evidence is test-shape dependent: the concurrency result demonstrates the invariant under the tested interleavings and is supported by the negative control, not by exhaustive proof of all possible schedules.

**The next step is a decision for the phase owner, not an automatic checkpoint.**