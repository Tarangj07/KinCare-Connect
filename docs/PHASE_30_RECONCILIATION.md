# PHASE 30 RECONCILIATION

**Phase:** 30 — Release-Readiness Reconciliation and Independent-Review Boundary
**Type:** Documentation / reconciliation only. No application implementation.
**Baseline checkpoint:** `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` (`HEAD` == `origin/main`)
**Specification:** `docs/PHASE_30_SPEC.md`
**Specification review:** `SECURITY_REVIEW_PHASE_30.md` — APPROVED WITH FINDINGS (none material)
**Date:** 2026-09-30

---

## 1. Scope

This artifact reconciles the repository's **documented** state against its **actual**
post-Phase-29 state at `4ddc0b5`, and formally records the open independent-review
gaps, external blockers, hosted-CI verification status, and backup/restore evidence
status.

It covers the five workstreams defined in `docs/PHASE_30_SPEC.md` §5:

| WS | Subject |
|----|---------|
| WS1 | Documentation-state reconciliation |
| WS2 | Independent-review gap registry |
| WS3 | External-blocker registry |
| WS4 | CI verification reconciliation |
| WS5 | Backup/restore evidence reconciliation |

**What Phase 30 does NOT do** (stated up front, restated in §10):

- Phase 30 does **not** implement application features.
- Phase 30 does **not** modify CI.
- Phase 30 does **not** modify schema or migrations.
- Phase 30 does **not** implement deployment.
- Phase 30 does **not** provide independent security reviews.
- Phase 30 does **not** prove production readiness.
- Phase 30 does **not** prove staging readiness.
- Phase 30 does **not** provide compliance certification.

**Preservation rule.** Historical and current documents that contain stale information
(`README.md`, `PROJECT_PLAN.md`, historical phase reports, historical security reviews)
are **intentionally preserved as written**. Phase 30 records discrepancies; it does not
silently correct them. Rewriting them would destroy the audit trail this phase exists
to establish.

---

## 2. Checkpoint baseline

| Item | Value | Evidence |
|------|-------|----------|
| Branch | `main` | `git branch --show-current` |
| `HEAD` | `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` | `git rev-parse HEAD` |
| `origin/main` | `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` | `git rev-parse origin/main` |
| Phase 29 checkpoint commit | `4ddc0b5` "phase(29): checkpoint CI integration and release assurance" | `git log -1 --oneline` |
| Phase 29 files committed | 6 files, 2885 insertions | `git show --stat --oneline HEAD` |
| Stash / rebase / merge in progress | none | `git status` |
| Staged changes | 0 | `git diff --cached --stat` (empty) |
| Lockfile | byte-identical to `HEAD` | `git diff HEAD -- pnpm-lock.yaml` (empty) |
| Schema / migrations | byte-identical to `HEAD` | `git diff HEAD -- apps/api/prisma/` (empty) |

The pre-existing working-tree state (10 tracked modifications, 16 untracked Phase 25–29
artifacts) is **unrelated to Phase 30** and was neither modified nor removed by Phase 30.
Those artifacts are earlier-phase deliverables that predate the Phase 29 checkpoint and
are outside Phase 30's scope.

---

## 3. Documentation-state reconciliation (WS1)

Each row states what a document **claims**, what the repository **actually** is, and the
status of the difference. No document was edited.

| # | Document | Claim (verbatim where practical) | Actual evidence | Status | Impact |
|---|----------|--------------------------------|-----------------|--------|--------|
| D-1 | `README.md` line 30 | "Phase 26 is the current milestone. Phase 27 has not started." | `4ddc0b5` is the Phase 29 checkpoint; `docs/PHASE_27_FINAL_REPORT.md`, `docs/PHASE_28_FINAL_REPORT.md`, `docs/PHASE_29_FINAL_REPORT.md` all exist and are complete; `SECURITY_REVIEW_PHASE_29.md` exists | **STALE** | Reader is told the project is three phases behind reality. Misleads planning. |
| D-2 | `README.md` lines 26–28 | "There is **no staging environment and no CI run**. GitHub Actions has never executed against this repository, because the security and release work after `Phase 17` has not been committed or pushed." | The stated *reason* is now false: that work **is** committed and pushed at `4ddc0b5`. A hosted run **is** recorded in repository documents at `f51614d` (see §6) | **STALE + PARTIALLY FALSE** | Conflates two different claims ("no CI run ever" vs "no CI run for the current tree"). Only the second is true. |
| D-3 | `README.md` line 29 | "This is a release blocker, recorded in `docs/PHASE_26_FINAL_REPORT.md`." | The blocker it describes (uncommitted work) was resolved by the Phase 29 checkpoint | **RESOLVED, not reflected** | Suggests an open blocker that no longer exists. |
| D-4 | `README.md` §"Remaining release blockers" item 1 | "Phase 18–26 work is uncommitted on `main`; `origin/main` is at an earlier commit and lacks this work." | `HEAD` == `origin/main` == `4ddc0b5`; Phases 27–29 are committed and pushed | **FALSE** | Most misleading single claim in the repository: asserts a fork/divergence that does not exist. |
| D-5 | `PROJECT_PLAN.md` line 5 | "**Current milestone:** Phase 26 — Release-Candidate Assurance (in progress)" | Phases 27, 28, 29 are complete; Phase 30 is being reconciled | **STALE** | Plan-of-record no longer describes the project. |
| D-6 | `PROJECT_PLAN.md` line 6 | "**Current state:** ... All verified **locally**. Not committed, not pushed, no CI run, no staging." | Committed and pushed at `4ddc0b5`; a hosted run is recorded at `f51614d` | **STALE + PARTIALLY FALSE** | Same conflation as D-2. |
| D-7 | `PROJECT_PLAN.md` line 7 | "**Next milestone:** None. Phase 27 has not started and is not authorised until the release blockers below are cleared." | Phases 27, 28, 29 all executed; Phase 30 in progress | **STALE** | Understates progress by three phases. |
| D-8 | `PROJECT_PLAN.md` line 30 (Scheme B block) | "Phase 26  Release-Candidate Assurance  ← current" | Post-Phase-29 | **STALE** | The plan's own numbering summary stops at 26. |
| D-9 | `PROJECT_PLAN.md` line 33 | "**The `docs/PHASE_*.md` reports are authoritative for Phases 18+.**" | Still true and still the correct reading rule | **ACCURATE** | This self-declared precedence rule is what makes D-5…D-8 reconcilable rather than contradictory. |
| D-10 | `PROJECT_PLAN.md` line 35 | "A pre-Phase-18 snapshot of this plan is preserved verbatim as `PROJECT_PLAN-old.md` and is not maintained." | `PROJECT_PLAN-old.md` exists, last modified 2026-09-04 (pre-Phase-18) | **ACCURATE** | Correctly scoped as a frozen snapshot. |
| D-11 | `README.md` line 18 | "The platform is **implemented and locally verified, not externally verified**." | Consistent with `docs/PHASE_29_FINAL_REPORT.md` §16–§18 and `SECURITY_REVIEW_PHASE_29.md` §13 | **ACCURATE** | The top-level status claim is the most accurate statement in `README.md`. |
| D-12 | `README.md` line 22 | "a Prisma schema of 36 models" | `docs/RELEASE_READINESS.md` §2 also states 36 models; consistent | **ACCURATE** | No drift. |
| D-13 | `README.md` §"What is NOT verified" | Staging absent, no deployment, no pen test, no load testing, no compliance certification, lint baseline 55/69 | Consistent with `docs/PHASE_29_FINAL_REPORT.md` §16 and `docs/RELEASE_READINESS.md` §6–§8 | **ACCURATE** | The "not verified" section is the healthiest part of the README. |
| D-14 | `README.md` line 213–214 | "**No backup or restore has been tested.** Nothing in the repository performs one" | `docs/PHASE_27_FINAL_REPORT.md` §2 records a database backup/restore PASS; `docs/PHASE_28_FINAL_REPORT.md` §1 records a `STORAGE_DIR` backup/restore execution; `docs/BACKUP_RESTORE.md` §14 records what was tested | **FALSE / superseded** | The strongest single understatement in the repository: backup/restore **was** executed (see §7), though never at production volume. |
| D-15 | `docs/RELEASE_READINESS.md` §5 | "What is actually independently reviewed: Phases 13–14, 16–21 and 24. Phases 22, 23 and 25 have no review at all." | `SECURITY_REVIEW_PHASE_25.md` **exists** but is a disclosed self-review. Phases 27 also has no review artifact (see §4). | **INCOMPLETE** | "No review at all" understates Phase 25 (a non-independent review exists) and omits Phase 27 entirely. |
| D-16 | `docs/RELEASE_READINESS.md` line 3–4 | Header: "Written 2026-09-29, at `f51614d`" | Self-dated and self-scoped; still accurate **as of its own date** | **ACCURATE (time-scoped)** | Not drift — the document correctly anchors itself. Flagged only so readers do not treat it as current. |

**WS1 result.** 16 discrepancies examined; **6 stale-or-false** (D-1…D-4, D-14, and the
incomplete D-15), **9 accurate**, **1 accurate but time-scoped** (D-16). The two most
consequential are **D-4** (asserts a `main`/`origin/main` divergence that does not exist)
and **D-14** (asserts backup/restore was never tested, when it was executed twice). Both
are in `README.md`. Neither is a security defect: both are documentation drift. Neither
was corrected.

**Pattern worth noting.** Drift is not uniform. `README.md`'s *status* framing is
careful ("implemented and locally verified, not externally verified") while its
*milestone and blocker* sections are two to three phases stale. `PROJECT_PLAN.md`
self-declares that `docs/PHASE_*.md` is authoritative for Phase 18+ (D-9), so a reader who
follows that rule is not misled. The practical risk is concentrated in `README.md`, which
carries no such precedence note.

---

## 4. Independent-review gap registry (WS2)

Independence is determined **only** from each document's own disclosure and provenance.
A filename is not evidence of independence.

| Phase | Review artifact | Status | Evidence (source of truth) |
|-------|-----------------|--------|---------------------------|
| 22 | **none found** | **OPEN — no review** | `SECURITY_REVIEW_PHASE_22.md` absent from repository. Corroborated by `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` §0: "Independent review of Phases 22, 23 \| **OPEN.** No review exists at all." |
| 23 | **none found** | **OPEN — no review** | `SECURITY_REVIEW_PHASE_23.md` absent. Corroborated by the same handoff §0. |
| 24 | `SECURITY_REVIEW_PHASE_24.md` | **INDEPENDENT** | Line 1 "# Security Review — Phase 24 (Independent)"; line 6 "**Reviewer:** independent review; the Phase 24 implementation report was treated as claims to verify, not evidence." No self-authorship disclosed. |
| 25 | `SECURITY_REVIEW_PHASE_25.md` | **SELF-REVIEW / NOT INDEPENDENT** | §0 heading "Independence disclosure — read this first"; line 16 "**This review is not fully independent, and a reader must weigh it**"; lines 22–24 record that the reviewer wrote `docs/PHASE_26_FINAL_REPORT.md` endorsing the findings **before** reviewing them. |
| 26 | `SECURITY_REVIEW_PHASE_26.md` | **SELF-REVIEW / NOT INDEPENDENT** | §0 heading "Independence disclosure — read this before relying on this document"; lines 16–17 "**This review is NOT independent. It is a self-review with adversarial method, and it must not be cited as independent assurance.**"; line 19 "**I implemented all three workstreams reviewed here.**" |
| 27 | **none found** | **OPEN — no review** | `SECURITY_REVIEW_PHASE_27.md` absent from repository. No document claims otherwise. **See finding R-1.** |
| 28 | `SECURITY_REVIEW_PHASE_28.md` | **INDEPENDENT** | No self-authorship claim; the document reviews Phase 27 work, not its own. Reviewed at `f51614d`. |
| 29 | `SECURITY_REVIEW_PHASE_29.md` | **INDEPENDENT** | §1: "This is an independent, read-only review of Phase 29 work performed by a previous implementation session. I did not implement Phase 29, did not author any of the code under review, and did not rely on `docs/PHASE_29_FINAL_REPORT.md` as proof." Disposition: APPROVED WITH FINDINGS — none. |

**Earlier phases (context, not in the Phase 30 window):** Phases 13, 14, 16, 17, 18, 19, 20
and 21 each carry an explicit independent-reviewer stance in their own text (e.g.
`SECURITY_REVIEW_PHASE_17.md` line 6 "**Reviewer stance:** Independent";
`SECURITY_REVIEW_PHASE_20.md` line 1 "=== INDEPENDENT SECURITY & RELIABILITY REVIEW —
PHASE 20 ==="). `SECURITY_REVIEW_PHASE_13.md` carries three companion files
(`_FINAL.md`, `_FINAL_RECHECK.md`) but no comparably explicit independence preamble in
its first lines; it is treated as independent on the basis of
`docs/RELEASE_READINESS.md` §5, which records it as such. **This is a weaker evidence
basis than the others and is recorded here rather than smoothed over.**

### Finding R-1 — Phase 27 has no independent security review, and no document records this gap

- **Severity:** Informational (review-process gap, not a code defect)
- **Exact claim under challenge:** `docs/PHASE_30_SPEC.md` §5 WS2 and
  `SECURITY_REVIEW_PHASE_30.md` §5 both enumerate the review gaps as *Phases 22, 23, 25,
  26* (plus 29 pre-review). Neither lists Phase 27.
- **Evidence:** `SECURITY_REVIEW_PHASE_27.md` does not exist. `docs/PHASE_29_FINAL_REPORT.md`
  §16 lists "Independent reviews for Phases 22 and 23 \| still absent" and does **not**
  list Phase 27. `docs/RELEASE_READINESS.md` §5 (written at `f51614d`, i.e. before Phase 27
  completed) lists Phases 22, 23, 25 and could not yet have covered 27.
- **Interpretation:** The omission propagated: the Phase 30 spec was written from the
  Phase 29 report's list rather than from a fresh file inventory, and the specification
  review then accepted that list. Phase 27 (`docs/PHASE_27_FINAL_REPORT.md`) delivered
  backup/restore execution, bounded concurrency testing, and a 13-gate regression — real
  work with **no independent review of any kind**.
- **Impact:** The open set of unreviewed phases is **five**, not four: 22, 23, 25, 26, 27.
  Any future release-readiness statement that repeats "22, 23, 25, 26" understates the gap.
- **Disposition:** **Recorded, not remediated.** Phase 30 does not produce security
  reviews, and commissioning one is an external, separately-authorized action. The
  correction to the registry is made here, in the Phase 30 artifact, as the
  specification intended.
- **Not a finding against Phase 29 or Phase 30's implementer:** the Phase 29 report
  predates nothing — Phase 27 review simply did not exist at that time either.

### Explicit non-closure statement

**The Phase 29 independent review does not close any of these gaps.** It reviewed Phase
29 only, and `SECURITY_REVIEW_PHASE_29.md` §1 scopes itself to "Phase 29 work performed
by a previous implementation session". A review of one phase cannot retroactively
independently review another. The open set after Phase 30 is therefore:

| Phase | Gap | Closable by repository work alone? |
|-------|-----|-----------------------------------|
| 22 | No review | No — requires an independent party |
| 23 | No review | No — requires an independent party |
| 25 | Self-review only | No — requires an independent party |
| 26 | Self-review only | No — requires an independent party |
| 27 | No review | No — requires an independent party |

**No external review is claimed or manufactured for any of these.** Absence of an artifact
in this repository is recorded as absence; it is not evidence that no review occurred
anywhere else, and it is not evidence that one did.

---

## 5. External-blocker registry (WS3)

Classifications are exactly one of `EXTERNAL`, `REPOSITORY-DEFERRED`, or
`ACCEPTED-LIMITATION`. Classifications are carried forward from the Phase 30
specification review, which verified each against
`docs/PHASE_29_FINAL_REPORT.md` §16 and `docs/RELEASE_READINESS.md` §8. **No
classification was changed.** Where nuance is required it is noted, not folded into a
new category.

### 5.1 EXTERNAL — outside repository control

| # | Blocker | Evidence | Note |
|---|---------|----------|------|
| E-1 | Staging deployment | `docs/PHASE_29_FINAL_REPORT.md` §16 "Staging deployment \| does not exist"; `docs/RELEASE_READINESS.md` §6 "No GitHub environments (`0`), no repository secrets, no staging host, no cluster" | Requires infrastructure that does not exist. |
| E-2 | TLS termination | `docs/PHASE_29_FINAL_REPORT.md` §16 "TLS \| not externally verified"; `docs/RELEASE_READINESS.md` §7 "No certificate, no proxy config, no `sslmode` in the repo" | Requires a domain and certificate authority. |
| E-3 | Production deployment | `docs/RELEASE_READINESS.md` §7 "Any deployment to any environment \| Nothing has ever been deployed" | Requires a target. |
| E-4 | Penetration testing | `docs/PHASE_29_FINAL_REPORT.md` §16 "not performed" | Requires an external testing party and scope agreement. |
| E-5 | Compliance certification | `docs/PHASE_29_FINAL_REPORT.md` §16 "not performed"; `COMPLIANCE.md` | Legal/organisational, not engineering. |
| E-6 | Managed PostgreSQL / object storage | `README.md` §"About Redis and MinIO": "**Neither is used by the application.** ... They are legacy scaffold, not part of the supported deployment model" | Nuance: adopting them would be a *design change*, not merely infrastructure. Classified EXTERNAL because the supported model does not require them. |
| E-7 | Monitoring / alerting / metrics / tracing | `docs/PHASE_29_FINAL_REPORT.md` §16 "Production observability \| not verified"; `docs/PHASE_27_FINAL_REPORT.md` §2 "Observability \| **NOT IMPLEMENTED** \| No metrics/alerting/tracing/log aggregation" | Nuance: instrumentation code *could* be written in-repo, but operating it requires infrastructure. Treated as EXTERNAL for the operational half. |
| E-8 | Backup scheduling / encryption / retention | `docs/PHASE_29_FINAL_REPORT.md` §16 "Backup automation / encryption / retention \| **not implemented**" | Nuance: a *script* could be written in-repo, but scheduling, key management and retention policy are operational decisions. Treated as EXTERNAL. |
| E-9 | Hosted CI run for the current tree | `docs/PHASE_29_FINAL_REPORT.md` §16 "GitHub Actions run for the post-Phase-28/29 tree \| **NOT CLAIMED.**" | See §6. |
| E-10 | Load / concurrency / soak testing at production scale | `docs/PHASE_29_FINAL_REPORT.md` §16 "not performed"; `docs/PHASE_27_FINAL_REPORT.md` §2 "Load / concurrency \| **PASS (bounded smoke)** \| 50 concurrent × 5 classes \| **NOT production capacity testing**" | A bounded smoke test exists and is reported as such. Production-scale testing needs a production-shaped environment. |
| E-11 | Live dependency advisory set | `docs/PHASE_29_FINAL_REPORT.md` §16 "not re-fetched; no network egress. The 48-advisory classification is only as current as its last run" | Requires registry access. |

### 5.2 REPOSITORY-DEFERRED — addressable in-repo, deliberately not done

| # | Item | Evidence | Why deferred |
|---|------|----------|--------------|
| R-1 | Independent reviews for Phases 22, 23, 25, 26, 27 | §4 registry | Requires an independent party, not repository work. Listed here because the *commissioning* is a repository decision. |
| R-2 | Backup storage half at production volume | `docs/RELEASE_READINESS.md` §7 "`STORAGE_DIR` backup/restore \| Command documented; **never executed**"; `docs/PHASE_29_FINAL_REPORT.md` §16 "Production-volume backup/restore \| not verified (8 files, one local filesystem)" | The 8-file/3-row local result is a scale limit of the test host, not a code limit. |
| R-3 | Web test coverage | `docs/PHASE_29_FINAL_REPORT.md` §17.6 "The `web` application has one test. It is effectively untested." Confirmed: `apps/web/src/lib/api-base.test.ts` is the only test file under `apps/web/src`. | Not started. |
| R-4 | Mobile test coverage / device verification | `docs/PHASE_29_FINAL_REPORT.md` §17.7 "verified by unit test only — no device, no real network stack, no real `expo-secure-store`" | Device/emulator testing not performed. |
| R-5 | `mutate-container-gate.mjs` pre-run control | `docs/PHASE_29_FINAL_REPORT.md` §9 and §16 "recorded, §9" | See §8. Carried here and in §8 because it is both addressable and accepted. |
| R-6 | Keyed `@Body('field')` coverage on public stubs | `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` §3 F-3 row: "3 Phase 4 public stubs still bind keyed body params" (`forgot-password`, `reset-password` in `apps/api/src/auth/auth.controller.ts`) | Recorded as open by the Phase 28 handoff. Not re-verified in Phase 30; carried forward unchanged. |

### 5.3 ACCEPTED-LIMITATION — known, disclosed, deliberately not fixed

| # | Item | Evidence | Why accepted |
|---|------|----------|--------------|
| A-1 | F-3 — mobile client clears the session on any 403 | `docs/PHASE_29_FINAL_REPORT.md` §8 "ACCEPTED / INHERITED. No code change."; `SECURITY_REVIEW_PHASE_29.md` §8.2 "ACCEPTED / INHERITED — SOURCE-TRACED" | 403 is also this API's session-family revocation signal (`auth.service.ts:199`, `:229`). Removing it would retain revoked tokens. Fixing it properly is an API-contract change, out of scope. |
| A-2 | Lint baseline 55 errors / 69 warnings | `docs/PHASE_29_FINAL_REPORT.md` §12 "baseline held exactly"; enforced as an advisory CI step (`docs/RELEASE_READINESS.md` §4.1) | Carried since the Phase 16 checkpoint; advisory by design so it cannot block unrelated work. |
| A-3 | `mutate-container-gate.mjs` has no pre-run control | `docs/PHASE_29_FINAL_REPORT.md` §9 "**Honest caveat**" | Post-run control exists; modifying the harness was judged outside Phase 29's remit. |
| A-4 | CI contract does not prove correct job placement | `docs/PHASE_29_FINAL_REPORT.md` §18 "It does **not** prove the new CI steps are correctly *placed*" | Bounded limitation of the contract design, disclosed in the Phase 29 report and accepted by the Phase 29 review (§4.3). |
| A-5 | Two advisory `continue-on-error` CI steps | `docs/RELEASE_READINESS.md` §4.1: API lint and Mobile lint "**not** counted as passing gates" | Long-standing, disclosed, and consistent across phases. |

**WS3 result.** 24 items classified: **11 EXTERNAL**, **6 REPOSITORY-DEFERRED**,
**5 ACCEPTED-LIMITATION**. No classification was altered from the specification review.
Three items (E-6, E-7, E-8) carry explicit nuance notes where the boundary between
"infrastructure" and "code" is genuinely arguable; the nuance is documented rather than
resolved by inventing a new category.

---

## 6. CI verification reconciliation (WS4)

This section exists to prevent one specific misreading: that a real, successful hosted
CI run implies the current checkpoint has one.

### 6.1 The recorded hosted run

| Field | Value | Source |
|-------|-------|--------|
| Run ID | `36559541316` | `docs/RELEASE_READINESS.md` §4.1; `docs/PHASE_27_FINAL_REPORT.md` §2 |
| Commit | `f51614d` | Same sources |
| Result as recorded | **SUCCESS**, 5/5 jobs | `docs/RELEASE_READINESS.md` §4.1 |
| Jobs | API, Web, Mobile, Containers, Release — all "success" | `docs/RELEASE_READINESS.md` §4.1 table |
| Advisory steps excluded | API lint, Mobile lint (`continue-on-error`) | `docs/RELEASE_READINESS.md` §4.1 |
| Relationship to Phase 29 | **Pre-dates it.** `f51614d` is the commit immediately *before* the Phase 29 checkpoint `4ddc0b5`. | `git log --oneline -2` |

### 6.2 The current checkpoint

| Field | Value | Source |
|-------|-------|--------|
| Checkpoint | `4ddc0b5` | `git rev-parse HEAD` |
| Hosted run for `4ddc0b5` | **NONE CLAIMED** | `docs/PHASE_29_FINAL_REPORT.md` §16: "GitHub Actions run for the post-Phase-28/29 tree \| **NOT CLAIMED.** No hosted run has occurred." |
| Parity script's own standing statement | `node scripts/verify-ci-parity.mjs --list` prints on every invocation: "GitHub Actions has NOT been executed against this workflow; no remote result is claimed." | Verified by running the command. |

### 6.3 What the `f51614d` run does and does not establish

**Establishes:** that the Phase 23–27-era tree at `f51614d` built, tested, containerised
and passed its release gates on GitHub-hosted runners on a clean checkout.

**Does NOT establish:**

- that `4ddc0b5` has been executed by hosted GitHub Actions;
- that the five steps added in Phase 29 (storage backup, N-12 mutation, DB suites, CI
  parity, CI-integration mutation) have ever run on a hosted runner — they were added
  to `ci.yml` at `4ddc0b5` and had not existed at `f51614d`;
- anything about staging, deployment, or production behaviour.

This is the distinction `docs/PHASE_29_FINAL_REPORT.md` §17.2 makes explicitly: "**The
new CI steps have never run on a GitHub runner.**"

### 6.4 Documentation drift affecting CI claims

| Document | CI claim | Assessment |
|----------|----------|------------|
| `README.md` lines 26–28 | "GitHub Actions has never executed against this repository" | **False as a blanket statement** — contradicted by `docs/RELEASE_READINESS.md` §4.1. **True** for the current tree. Recorded as D-2; not corrected. |
| `PROJECT_PLAN.md` line 6 | "no CI run" | Same character as D-6. Recorded; not corrected. |
| `docs/RELEASE_READINESS.md` §4.1 | Run `36559541316` at `f51614d`, SUCCESS | **Accurate as recorded**, and correctly self-dated to `f51614d`. It does not claim to cover later phases. |
| `docs/PHASE_29_FINAL_REPORT.md` §16 | No hosted run for the post-Phase-28/29 tree | **Accurate.** Correctly scoped to the current tree. |
| `SECURITY_REVIEW_PHASE_29.md` §13 | "**No hosted GitHub Actions run**" as a limitation | **Accurate** for the reviewed tree. |

**WS4 result.** The two apparently contradictory CI claims are **not** in fact
contradictory once scoped: one is about a specific earlier commit, the other about the
current tree. The genuine defect is in `README.md`, which states the blanket claim
("never executed against this repository") and thereby contradicts a documented run. That
is recorded as D-2 and left uncorrected.

**No claim is made that `4ddc0b5` passed hosted CI.** No workflow configuration was
modified, and no CI command was altered in Phase 30.

---

## 7. Backup/restore evidence reconciliation (WS5)

### 7.1 The document

| Property | Value | Evidence |
|----------|-------|----------|
| Path | `docs/BACKUP_RESTORE.md` | Exists; committed at `4ddc0b5` (Phase 29 WS3) |
| Top-level sections | `## 0` through `## 14`, continuous, no gaps | Section headings enumerated from the file |
| §5 | **Exists** — "## 5. Restore command" at line 205 | This was F-1 from the Phase 28 review: §5 had been dropped and two cross-references dangled |
| F-1 status | Closed in Phase 29 WS3; independently verified by `SECURITY_REVIEW_PHASE_29.md` §7 | Both broken references (§0 D-1 row, §9 RTO row) now resolve |
| Production claims | None. §11 (encryption), §12 (retention) state expectations, not implementations. | `SECURITY_REVIEW_PHASE_29.md` §7.2 confirms no false capability claims |

### 7.2 DATABASE half

| Property | Value | Evidence |
|----------|-------|----------|
| Executed? | **Yes** | `docs/PHASE_27_FINAL_REPORT.md` §2: "**Backup / restore** \| **PASS (database only)** \| Full drop-and-restore on throwaway PG" |
| Environment | Local, throwaway PostgreSQL | Same row |
| What was verified | Migrations applied, data dropped, dump restored, application ran against the restored database | `docs/BACKUP_RESTORE.md` §14 |
| Scale | **3 rows** | `docs/PHASE_27_FINAL_REPORT.md` §2 limitation column |
| Developer DB safety | `ecc` never targeted; throwaway DBs use per-run prefixed names | `docs/PHASE_29_FINAL_REPORT.md` §14 |
| Limitations | Tiny volume; single host; RPO/RTO remain engineering estimates; §5 of the runbook was documented, not executed end-to-end by Phase 29 | `docs/PHASE_29_FINAL_REPORT.md` §17.5 |

### 7.3 STORAGE half

| Property | Value | Evidence |
|----------|-------|----------|
| Executed? | **Yes** | `docs/PHASE_28_FINAL_REPORT.md` §1 WS2: "`STORAGE_DIR` backup/restore \| **Executed** on throwaway data; the runbook it came from was defective and was corrected" |
| What was verified | 22 checks: archive → destroy → restore → byte-identity re-verify, plus the **real compiled** `StorageService` against the restored tree, plus traversal containment | `docs/PHASE_29_FINAL_REPORT.md` §4 and §10 row 14 |
| Scale | **8 files, one local filesystem** | `docs/PHASE_29_FINAL_REPORT.md` §16 |
| Corroboration | `docs/RELEASE_READINESS.md` §4.2 "Backup + restore (Phase 27) — PASS on throwaway PostgreSQL" (database) — note this row covers the **database** half | Read carefully: this is the source of the apparent contradiction below |

### 7.4 Resolving an apparent contradiction

`docs/RELEASE_READINESS.md` §7 states: "`STORAGE_DIR` backup/restore \| Command
documented; **never executed**". `docs/PHASE_28_FINAL_REPORT.md` §1 states it **was**
executed. Both are repository documents.

**Resolution:** `docs/RELEASE_READINESS.md` is dated at `f51614d` (its own header, line
4) — **before** Phase 28 ran. The storage execution is Phase 28 work. The
`RELEASE_READINESS.md` statement was accurate when written and was **not updated after
Phase 28**. This is ordinary time-scoped drift, not a factual contradiction between
contemporaneous claims.

`docs/RELEASE_READINESS.md` was **not modified** by Phase 30. Recorded here.

### 7.5 PRODUCTION readiness

| Capability | Status | Evidence |
|------------|--------|----------|
| Production-volume backup/restore | **NOT VERIFIED** | `docs/PHASE_29_FINAL_REPORT.md` §16: "not verified (8 files, one local filesystem)" |
| Backup automation / scheduling | **NOT IMPLEMENTED** | `docs/PHASE_29_FINAL_REPORT.md` §16; `docs/PHASE_27_FINAL_REPORT.md` §2 "no automation, encryption, retention or scheduling" |
| Encryption at rest | **NOT IMPLEMENTED** | Same sources; `docs/BACKUP_RESTORE.md` §11 states expectations only |
| Retention policy | **NOT IMPLEMENTED** | Same sources; `docs/BACKUP_RESTORE.md` §12 states expectations only |
| Off-host storage | **NOT IMPLEMENTED** | `docs/PHASE_29_FINAL_REPORT.md` §18 |
| Restore drill (realistic) | **NOT PERFORMED** | `docs/PHASE_29_FINAL_REPORT.md` §18: "It does not prove the RTO or RPO in §9 of the runbook. They remain estimates" |

**WS5 result.** Backup/restore has been **executed twice** — database (Phase 27, 3 rows)
and storage (Phase 28, 8 files) — both on throwaway local infrastructure, both at trivial
scale. `README.md`'s claim that backup/restore "has **never** been tested" is therefore
**false** (recorded as D-14, not corrected). The claims that production backup
automation, encryption, retention, and production-volume restore are **not implemented
and not verified** are accurate and are restated here without weakening.

**No backup infrastructure was modified, and no backup automation was implemented.**

---

## 8. Accepted limitations

Recorded separately from §5.3 because these are *technical properties of the
verification system* rather than product or infrastructure gaps. They are restated here
so that no future summary mistakes them for closed items.

| # | Limitation | Evidence | Consequence |
|---|------------|----------|-------------|
| L-1 | The CI contract proves a required gate *exists and is not advisory*; it does **not** prove the step sits in a job whose environment can run it | `docs/PHASE_29_FINAL_REPORT.md` §18; `SECURITY_REVIEW_PHASE_29.md` §4.3 "It does **not** prove the step is placed in a job whose environment can actually execute it" | A future edit could move a step to an unsuited job; the contract would not catch it. |
| L-2 | `mutate-container-gate.mjs` has a post-run control but no pre-run control | `docs/PHASE_29_FINAL_REPORT.md` §9 | A mutant result is not preceded by a baseline proving the gate was green beforehand. |
| L-3 | `verify-release-artifact.mjs` and `verify-db-migrations.sh` both delete and rebuild `apps/api/dist` | `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` §4 "Known open (N-10)" | Running them concurrently can break one. Mitigated procedurally only. |
| L-4 | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` is not asserted against an absolute literal | `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` §3 "Known trap (N-1)" | A *coordinated* change to the constant and its specs stays green. |
| L-5 | The Next.js rewrites detector reads `next.config.mjs` only | `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` §3 F-4 row "known residual N-2" | A plugin or sibling `next.config.js` injecting rewrites would be invisible. |
| L-6 | The developer-DB fingerprint is schema-and-row-count, not a byte-level dump comparison | `docs/PHASE_29_FINAL_REPORT.md` §17.8 | Strong enough to show schema/data unchanged; not a full-content hash. |
| L-7 | Two of Phase 29's own harnesses were defective on first run (incomplete mirror; misaligned comment mask) | `docs/PHASE_29_FINAL_REPORT.md` §6, §17.9 | Five mutants initially passed for the wrong reason. Fixed and re-run before results were recorded; disclosed because a harness that hides its own false negatives cannot be trusted with anyone else's. |

**L-4, L-5 and L-6 were not re-verified by Phase 30.** They are carried forward from the
Phase 28 handoff and the Phase 29 report as disclosed limitations, and are recorded here
so they are not lost. Re-verifying them is out of Phase 30's scope.

---

## 9. External dependencies

The following cannot be satisfied by any amount of repository work. They are listed
separately so that no future phase mistakes them for backlog.

| Dependency | What is blocked without it | What remains possible without it |
|------------|---------------------------|-----------------------------------|
| A hosted environment for the current tree | Any claim that `4ddc0b5` passed CI; any statement about runner behaviour of the five Phase 29 steps | All local gates, all mutation harnesses, the CI contract itself |
| A staging environment | Any deployment validation; any statement about a running system | Container and migration verification, explicitly labelled LOCAL |
| A domain + certificate | TLS verification | Everything non-transport |
| A production-shaped data set | Production-volume backup/restore; realistic load testing | 8-file storage and 3-row database round trips, explicitly labelled as such |
| An independent reviewer or organisation | Closing the Phase 22, 23, 25, 26, 27 review gaps | All repository-side verification and all self-disclosed limitations |
| A penetration-testing engagement | Any independent adversarial assessment | Local mutation testing, which is not a substitute |
| Compliance/legal review | Any certification claim | The technical control inventory in `COMPLIANCE.md` |
| Network egress to the package registry | Refreshing the advisory classification | The existing lockfile-pinned audit result, correctly labelled as a snapshot |

---

## 10. What this reconciliation does not prove

Stated plainly, so that a green Phase 30 cannot be read as more than it is.

- Phase 30 does **not** implement application features. No endpoint, controller, service,
  guard, DTO, test, dependency, or configuration was added or changed.
- Phase 30 does **not** modify CI. `.github/workflows/ci.yml`,
  `scripts/verify-ci-parity.mjs`, and `scripts/mutate-ci-integration.mjs` are byte-identical
  to the `4ddc0b5` checkpoint.
- Phase 30 does **not** modify schema or migrations. `apps/api/prisma/` is byte-identical
  to the checkpoint.
- Phase 30 does **not** implement deployment. Nothing was deployed, rehearsed, or
  validated as a deployment.
- Phase 30 does **not** provide independent security reviews. The gaps for Phases 22, 23,
  25, 26 and **27** (see R-1) all remain open. `SECURITY_REVIEW_PHASE_30.md` reviews the
  Phase 30 *specification* only and is not a review of a Phase 30 implementation.
- Phase 30 does **not** prove production readiness. No production-readiness claim is made.
- Phase 30 does **not** prove staging readiness. No staging environment exists.
- Phase 30 does **not** provide compliance certification. None is claimed.
- Phase 30 does **not** establish that `4ddc0b5` passed hosted GitHub Actions. The
  recorded run `36559541316` is for `f51614d`, a different commit.
- Phase 30 does **not** correct the documentation drift recorded in §3. Historical and
  current documents are preserved deliberately; correcting them would require a separate
  authorization and would itself need review.
- Phase 30 does **not** close, reopen, or reinterpret any Phase 28 or Phase 29 finding.
- Phase 30 does **not** verify the limitations listed in §8. They are carried forward as
  disclosed, not re-tested.
- Phase 30 does **not** constitute a security review of Phase 30's reconciliation. A
  separate independent review is required, as was the case for Phase 29.

---

*Reconciliation performed against `4ddc0b5fda231761d0708fe6dd3083a08952ca3b`. No
historical document, application source, CI file, schema, migration, lockfile, or
dependency was modified. Phase 30 is documentation/reconciliation only.*
