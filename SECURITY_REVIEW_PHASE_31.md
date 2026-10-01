# SECURITY_REVIEW_PHASE_31.md

**Repository:** KinCare-Connect (`https://github.com/Tarangj07/KinCare-Connect.git`)
**Baseline under review:** `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` (`HEAD` == `origin/main`)
**Subject of review:** Phase 30 (documentation/reconciliation only) and the release-assurance
state it certifies
**Review date:** 2026-09-30
**Nature of this document:** independent adversarial verification. Read-only with respect to
application code, schema, migrations, CI, and historical artifacts.

**This document does not assert that the system is production ready, staging ready, or
release ready. It does not assign a security score, percentage, maturity rating, or ranking,
and none should be inferred from the number or severity of the findings below.**

---

## 1. Reviewer independence disclosure

### 1.1 What I am, and what I am not

| Question | Answer |
|---|---|
| Did I author any Phase 30 artifact? | **No.** I did not write or edit `docs/PHASE_30_SPEC.md`, `docs/PHASE_30_RECONCILIATION.md`, `docs/PHASE_30_FINAL_REPORT.md`, or `SECURITY_REVIEW_PHASE_30.md`. |
| Did I implement any code under review? | **No.** No application source, test, gate, schema, migration, workflow, or package manifest was authored or modified by me. |
| Am I independent of the Phase 30 implementer? | **Yes in attribution.** I did not participate in Phase 30's implementation, and I re-derived every material conclusion from primary sources rather than accepting Phase 30's quoted evidence. |
| Am I independent of Phase 31's own verification? | **No, and this must be stated plainly.** I am simultaneously the reviewer and the author of the verification recorded here. Nothing in this document has been checked by a second party. |
| Am I *organisationally* independent? | **No.** I am an AI agent operating inside the same repository and the same host as the implementer sessions. There is no separation of duties, no second signature, and no chain of custody external to this repository. |

### 1.2 The honest limit of this review

The repository's assurance model treats "independent review" as a distinct control, and
Phases 25 and 26 were correctly downgraded to *self-review* precisely because the reviewing
party had prior involvement. **The same reasoning applies to this document, and stronger.**

I am independent of the material I reviewed in the narrow sense that I did not write it. I am
**not** independent in the sense that matters for closing the open review gaps: I share an
environment, a working tree, and an unversioned set of credentials with the implementer
sessions. Therefore:

- This review **must not** be used to close the Phase 22, 23, 25, 26, or 27 review gaps
  (blocker `R-1`). It does not attempt to.
- This review **does not** constitute the independent adversarial assessment that a
  penetration test, an external security audit, or a compliance certification would provide.
  No such thing exists in this repository, and nothing here substitutes for one.

### 1.3 What I did

- Read every Phase 30 artifact, `docs/RELEASE_READINESS.md`, `README.md`, `PROJECT_PLAN.md`,
  `PROJECT_PLAN-old.md`, `docs/PHASE_29_FINAL_REPORT.md`, `SECURITY_REVIEW_PHASE_29.md`, and
  the Phase 22–28 reports and reviews, and re-derived their claims from primary sources.
- Inspected git state directly: `HEAD`, `origin/main`, `git status`, `git diff --cached`,
  `git stash list`, `git reflog`, `git ls-files`, `git cat-file -e <commit>:<path>`, and a
  read-only `git archive` extraction of the commit to a throwaway directory.
- Re-ran eleven existing verification gates, unmodified.
- **Queried the GitHub Actions API** using the `gh` CLI and credentials that were already
  present in the environment. I did not create, request, or supply any credential. This
  turned the Phase 30 CI question from *unverifiable* into *verifiable*, and it changed the
  central finding of this review (§7).

### 1.4 Limitations caused by access or infrastructure

- **GitHub API access was available.** This is the single largest difference between this
  review and Phase 30's, and it is why §7 reaches a firmer conclusion than Phase 30 could.
  Phase 30 recorded the hosted-CI question as externally unverifiable; that was accurate for
  Phase 30 and is not accurate for this review.
- **The `pnpm` registry is reachable** (`registry.npmjs.org` → HTTP 200), contradicting a
  stated rationale in Phase 30's own blocker registry (see `E-11`, §8).
- I have **no** access to staging, production, any certificate authority, any monitoring
  stack, or any external tester. Claims resting on those remain unverified by me and are
  marked `CONFIRMED WITH LIMITATION` or `UNVERIFIED` accordingly.
- Absence of infrastructure was established from repository documentation and from what is
  observable on this host, **not** by querying the hosting provider.
- All local execution evidence is from a single machine (Linux, Docker 29.8.1, pnpm 11.25.0,
  Node 24.18.0). Results are not portable to a GitHub runner except where I cite an actual
  hosted run.

---

## 2. Scope

### 2.1 In scope

| WS | Subject |
|----|---------|
| 1 | Independent re-verification of Phase 30's material conclusions |
| 2 | Direct verification of finding R-1 (Phase 27 independent review gap) |
| 3 | State of the five open independent-review gaps (Phases 22, 23, 25, 26, 27) |
| 4 | Phase 29 / hosted GitHub Actions assurance for the current `HEAD` |
| 5 | Revalidation of all 24 Phase 30 blockers |
| 6 | Security-control regression check using existing gates only |
| 7 | Repository integrity and contamination check |
| 8 | Release-readiness language audit |
| 9 | Reviewer independence disclosure (§1) |
| 10 | This artifact |

### 2.2 Explicitly out of scope, and not performed

- **No remediation.** No finding below was fixed. No gate was modified. No historical
  document was corrected, including documents this review found to be false.
- **No application change.** No controller, service, guard, DTO, test, dependency, or
  configuration was added or altered.
- **No schema or migration change.**
- **No commit, push, rebase, reset, amend, or stash.** Verified in §10.
- **No creation of `SECURITY_REVIEW_PHASE_27.md`.** Explicitly not authorised; the R-1 gap is
  preserved as an open blocker (§5).
- **No new categories of blocker or limitation** were invented. Where a classification is
  wrong, §8 records the correction and why.

---

## 3. Repository identity

| Item | Value | How established |
|------|-------|-----------------|
| Remote | `https://github.com/Tarangj07/KinCare-Connect.git` | `git remote -v` |
| Host checkout directory | `ElderlyCareCoordinationPlatform` (directory name is not the project name) | `pwd` |
| Branch | `main` | `git branch --show-current` |
| `HEAD` | `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` | `git rev-parse HEAD` |
| `origin/main` | `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` | `git rev-parse origin/main` |
| Divergence | `0 0` (`git rev-list --left-right --count origin/main...HEAD`) | — |
| `HEAD` subject | `phase(29): checkpoint CI integration and release assurance` | `git log -1` |
| Preceding commits | `f51614d`, `16dac73`, `61134d7`, `d9320ae`, `4449ee3` | `git log` |
| Branches | `main`; `remotes/origin/HEAD -> origin/main`; `remotes/origin/main` | `git branch -a` |
| Stash | empty | `git stash list` |
| Staged changes | none | `git diff --cached --stat` |
| Working tree | **10 tracked modifications, 16 untracked paths** | `git status --porcelain` |
| Prisma models | 36 | `grep -c '^model '` |

`HEAD` == `origin/main` is **CONFIRMED**. The working tree is **not** clean, and the
difference is material — see §7.3 and findings `P31-2` through `P31-4`.

---

## 4. Phase 30 claims independently verified

Every conclusion below was re-derived from a primary source. Phase 30's own quoted evidence
was treated as a claim to test, not as proof.

### 4.1 Checkpoint and byte-identity claims

| Phase 30 claim | Phase 31 disposition | Independent evidence |
|---|---|---|
| §2 Lockfile byte-identical to `HEAD` | **CONFIRMED** | `git diff HEAD -- pnpm-lock.yaml` → empty |
| §2 Schema/migrations byte-identical to `HEAD` | **CONFIRMED** | `git diff HEAD -- apps/api/prisma/` → empty |
| §2 Staged changes = 0 | **CONFIRMED** | `git diff --cached --stat` → empty |
| §2 Stash / rebase / merge in progress: none | **CONFIRMED** | `git stash list` empty; `git status` reports no operation in progress |
| §2 Working tree = 10 tracked modifications, 16 untracked | **CONFIRMED** | `git status --porcelain \| awk '{print $1}' \| sort \| uniq -c` → `16 ??`, `10 M` |
| §10 `ci.yml`, `verify-ci-parity.mjs`, `mutate-ci-integration.mjs` byte-identical to checkpoint | **CONFIRMED** | `git diff HEAD -- .github/workflows/ci.yml scripts/verify-ci-parity.mjs scripts/mutate-ci-integration.mjs` → empty |
| D-12 "36 models" | **CONFIRMED** | `grep -c '^model ' apps/api/prisma/schema.prisma` → 36 |
| §7.1 `BACKUP_RESTORE.md` §5 exists at line 205 | **CONFIRMED** | `grep -n '^## 5\.' docs/BACKUP_RESTORE.md` → `205:## 5. Restore command` |
| §7.1 `BACKUP_RESTORE.md` is committed | **CONFIRMED** | `git ls-files --error-unmatch` succeeds |

### 4.2 The "16 documentation discrepancies"

**Disposition: PARTIALLY CONFIRMED.**

The internal arithmetic is sound: `docs/PHASE_30_RECONCILIATION.md` §3 enumerates D-1…D-16
(16 rows) and reports "6 stale-or-false, 9 accurate, 1 accurate but time-scoped"
(6+9+1 = 16). Each of the 16 rows I sampled is individually accurate:

| D-row | Claim | Disposition | Evidence |
|---|---|---|---|
| D-1 | `README.md:30` "Phase 26 is the current milestone. Phase 27 has not started." | **CONFIRMED** | `docs/PHASE_27/28/29/30_*` all exist and are complete |
| D-2 | `README.md:26-29` "no staging environment and no CI run" + false reason | **CONFIRMED** | work is committed and pushed at `4ddc0b5` |
| D-3 | README "release blocker" pointing at uncommitted work | **CONFIRMED** | resolved by the Phase 29 checkpoint |
| D-4 | README §"Remaining release blockers" item 1 asserts a `main`/`origin/main` fork | **CONFIRMED FALSE** | `git rev-list --left-right --count origin/main...HEAD` → `0 0` |
| D-5…D-8 | `PROJECT_PLAN.md` front-matter and scheme block stop at Phase 26 | **CONFIRMED** | `PROJECT_PLAN.md:5,6,7,30` |
| D-9 | `PROJECT_PLAN.md:33` precedence rule | **CONFIRMED** | self-declared rule is present and does mitigate D-5…D-8 |
| D-10 | `PROJECT_PLAN-old.md` is a frozen pre-Phase-18 snapshot | **CONFIRMED** | file present; `README`/`PROJECT_PLAN` describe it correctly |
| D-11 | `README.md:18` "implemented and locally verified, not externally verified" | **CONFIRMED** | consistent with Phase 29 report and its review |
| D-13 | README "What is NOT verified" section | **CONFIRMED** | consistent with §8 of this review |
| D-14 | `README.md:213-214` "No backup or restore has been tested" | **CONFIRMED FALSE** | `docs/BACKUP_RESTORE.md` §14; Phase 27/28 reports |
| D-15 | `RELEASE_READINESS.md` §5 understates Phase 25 and omits Phase 27 | **CONFIRMED** | see §5 and §6 |
| D-16 | `RELEASE_READINESS.md` self-dates to `f51614d` | **CONFIRMED** | correct, and it is time-scoped drift, not a contradiction |

**However, the count of 16 materially understates the documentation defects, because the
survey scope was narrower than the conclusion implies.** Phase 30 examined `README.md`,
`PROJECT_PLAN.md`, and `docs/RELEASE_READINESS.md`. It did not examine `COMPLIANCE.md`,
`SECURITY.md`, or `ARCHITECTURE.md` — and those contain false current-state claims of the same
character, in a tracked file that three other documents point readers to for "exactly which
technical controls are evidenced". See `P31-8` (§12) and §11.

**Net:** the 16 rows Phase 30 recorded are real and correctly characterised. "16
documentation discrepancies" is an accurate count *of what was surveyed*, and an
undercount *of what exists*. Phase 30 does not disclose this scope limit anywhere in the
artifact, which is itself a gap in the reconciliation.

### 4.3 R-1 / the count of five unreviewed phases

| Claim | Disposition | Evidence |
|---|---|---|
| `SECURITY_REVIEW_PHASE_27.md` does not exist | **CONFIRMED** | absent from the filesystem; `git log --all --diff-filter=A -- 'SECURITY_REVIEW_PHASE_2*.md'` adds only `_20`, `_21`, `_24` (in `4449ee3`) and `_29` (in `4ddc0b5`); no commit in `--all` ever contained a Phase 27 review |
| No document claims a Phase 27 review exists | **CONFIRMED** | repo-wide search for "phase 27" across `*.md` returns 14 files; §5.3 below assesses each |
| Open set of unreviewed phases is **five**: 22, 23, 25, 26, 27 | **CONFIRMED** | see §6 matrix |
| Omission originated in `PHASE_30_SPEC.md` §5 WS2 and `SECURITY_REVIEW_PHASE_30.md` §5 | **CONFIRMED** | `SECURITY_REVIEW_PHASE_30.md:46` and `:89` both list "Independent reviews 22/23/25/26/29" without Phase 27 |
| R-1 severity "Informational" | **DISPUTED — understated** | see §12, `P31-13` |

### 4.4 The 24-blocker classification

| Claim | Disposition | Evidence |
|---|---|---|
| 24 items, split 11 EXTERNAL / 6 REPOSITORY-DEFERRED / 5 ACCEPTED-LIMITATION | **CONFIRMED** | §8 below; every identifier and every stated rationale reproduced and checked |
| "No classification was changed" from the specification review | **CONFIRMED** | §5.1–§5.3 of the reconciliation are internally consistent with the count |
| `E-6`, `E-7`, `E-8` carry explicit nuance notes | **CONFIRMED** | reconciliation lines 198–200; I concur that inventing a fourth category would be worse than documenting the ambiguity |
| `R-1`/`R-2`/`A-1`…`A-5` as blocker labels | **DEFECTIVE** | see `P31-11` |

### 4.5 The hosted CI run and its commit

| Claim | Disposition | Evidence |
|---|---|---|
| Run `36559541316`, commit `f51614d`, **SUCCESS**, 5/5 jobs | **CONFIRMED** (upgraded from "unverifiable") | GitHub API: `gh run list` → `36559541316  success  main push  3m5s  2026-09-29T11:05:04Z`, head commit `f51614d` "Record run 3 (36559104224) as the definitive green run at final SHA" |
| The run **pre-dates** the Phase 29 checkpoint `4ddc0b5` | **CONFIRMED** | `11:05:04Z` vs `4ddc0b5` run at `19:17:32Z` |
| `docs/RELEASE_READINESS.md:65` "This is the first and only line of evidence produced by a CI runner" | **CONTRADICTED** | five runs exist (see the table in §7.1); it is not the first and not the only |
| No hosted run has executed `4ddc0b5` | **CONTRADICTED** | run `36618193752` executed `4ddc0b5` and **failed** — see §7 |
| Phase 30 §6.4: `PHASE_29_FINAL_REPORT.md` §16 "No hosted run for the post-Phase-28/29 tree" — **"Accurate"** | **CONTRADICTED** | this is the single incorrect Phase 30 conclusion, and it is load-bearing (see `P31-1`) |

I also tested and **rejected** a hypothesis before recording it. Two run IDs appear in the
repository for a "definitive green run" — `36559104224` (tracked, `docs/RELEASE_CHECKPOINT_PHASE_26.md:295`,
commit `16dac73`) and `36559541316` (untracked, `f51614d`). I checked whether these conflict.
They do not: they are **two different, both-real, both-green runs on two different commits**,
and commit `f51614d`'s own message names the earlier one. Run IDs are monotonic, so
`36559541316` is the later run on `f51614d`. **There is no contradiction here, and I record
that I looked and found none.** The residual issue is narrower and is recorded as `P31-12`:
`36559541316` appears in **no tracked file in any commit**.

### 4.6 Backup/restore chronology

**Disposition: CONFIRMED.** Phase 30's chronology is the most defensible part of the
reconciliation, and the apparent contradiction it resolves is real and correctly resolved.

| Claim | Disposition | Evidence |
|---|---|---|
| Database half executed in Phase 27 | **CONFIRMED** | `docs/PHASE_27_FINAL_REPORT.md:38` "PASS (database only) … Full drop-and-restore on throwaway PG" |
| Database scale = 3 rows | **CONFIRMED** | same row, limitation column |
| Storage half executed in Phase 28 | **CONFIRMED** | `docs/PHASE_28_FINAL_REPORT.md` §1 WS2 "Executed on throwaway data" |
| Storage scale = 8 files, one local filesystem | **CONFIRMED** | `docs/PHASE_29_FINAL_REPORT.md` §16 |
| `RELEASE_READINESS.md` §7 "never executed" is time-scoped drift, not a contradiction | **CONFIRMED** | that document self-dates to `f51614d`, before Phase 28 ran |
| Automation / encryption / retention / off-host / production volume all NOT IMPLEMENTED or NOT VERIFIED | **CONFIRMED** | `docs/BACKUP_RESTORE.md` §11, §12, §14; reconciliation §7.5 |
| R-2 (storage at production volume) is a host scale limit, not a code limit | **CONFIRMED WITH LIMITATION** | I did not re-run the backup at any scale; I re-ran the Phase 28 gate at its existing scale and it passed (§9) |

I re-ran the Phase 28 storage gate myself (§9). It passed, and its own output is candid:
"NOT PROVEN BY THIS HARNESS: production-volume storage, off-host backup storage, backup
encryption, retention or rotation, scheduling or automation, a restore at scale…".

### 4.7 `RELEASE_READINESS.md` time-scoped claims

**Disposition: CONFIRMED as time-scoped, with one row stale in the opposite direction.**

Phase 30's D-16 correctly classifies this document as self-dated and self-scoped. That is
right. But `docs/RELEASE_READINESS.md:198` lists as an **open** blocker:

> "10. **Rate limiting returns HTTP 403, not 429** — see §10, **N-12**."

That is **accurate for `origin/main`** and **stale for the working tree**. The N-12 fix
exists only as an uncommitted modification. This is a trap in both directions and no document
in the repository states which tree it describes. See `P31-4`.

---

## 5. Phase 27 R-1 verification

**Disposition: CONFIRMED. The gap is real. It is preserved as an open blocker.**

### 5.1 Direct checks

| Check | Result |
|---|---|
| Does `SECURITY_REVIEW_PHASE_27.md` exist on disk? | **No** |
| Did it exist in any commit on any branch? | **No** — `git log --all --diff-filter=A` and a per-commit tree scan find no such path |
| Does `docs/PHASE_27_FINAL_REPORT.md` exist? | **Yes — and it is UNTRACKED** |
| Is the Phase 27 implementation report an independent review? | **No.** It is the implementer's own report, and it says so |

`docs/PHASE_27_FINAL_REPORT.md:14-16` records the implementer's own conclusion:

> "It attempted to close the independent-review and operational-validation gaps, and in doing
> so established that **two of them cannot be closed by the party that did the work** —
> including me."

### 5.2 Every candidate document assessed

A repo-wide search for Phase 27 material returns 14 Markdown files. Each was assessed as a
possible independent review:

| Candidate | Qualifies? | Why |
|---|---|---|
| `docs/PHASE_27_FINAL_REPORT.md` | **No** | It is the implementation report, self-authored |
| `SECURITY_REVIEW_PHASE_28.md` | **No** — partial coverage only | Claims genuine independence and re-derives Phase 27's claims rather than repeating them (`:597` "Phase 27 claimed a real DB backup/restore. I did not take that claim."), but it is neither titled nor scoped as a Phase 27 review, and it expressly declines to close prior blockers (`:1288-1294` "I am not closing them") |
| `docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md` | **No** — disclaims itself | `:3` "**This document is NOT a security review.**" `:5` "It is a briefing for a **genuinely independent** reviewer." |
| `docs/PHASE_28_FINAL_REPORT.md` | **No** — disclaims itself | `:13-15` "This phase does not constitute an independent security review, production deployment validation, penetration test, compliance certification, or production-readiness certification." |
| `SECURITY_REVIEW_PHASE_29.md` | **No** | `:5` scopes it to "Phase 29 work performed by a previous implementation session". No Phase 27 section. |
| `docs/PHASE_29_FINAL_REPORT.md` | **No** | Implementation report; its review-status row lists Phases 22 and 23 as absent and does not mention Phase 27 |
| `docs/RELEASE_READINESS.md`, `docs/RELEASE_CHECKPOINT_PHASE_26.md`, `docs/BACKUP_RESTORE.md`, `README.md`, `PROJECT_PLAN.md` | **No** | None is a Phase 27 review; the Phase 30 artifacts instead *record* the gap |
| `docs/PHASE_26_FINAL_REPORT.md` | **No** | Pre-dates Phase 27 |

### 5.3 Is the implementer/implementer distinction maintained?

Yes — and this is a point in the repository's favour. The distinction between an
implementation report and an independent review is stated explicitly and correctly in the
Phase 27, Phase 28, and Phase 30 artifacts, and `docs/PHASE_26_FINAL_REPORT.md:163` records
the principle directly: "**Reproduction by the implementer's successor is not independent
review.**" No document in the repository claims a Phase 27 independent review exists.

### 5.4 Conclusion

**Phase 27 delivered real work** — database backup/restore execution, bounded concurrency
testing, and a 13-gate regression — and **none of it has been independently reviewed.** The
gap is real, it is correctly diagnosed, and it is correctly left open.

`SECURITY_REVIEW_PHASE_27.md` was **not** created by this review. It was not authorised, and
creating it here would repeat exactly the failure mode this repository has been commendably
harsh about in Phases 25 and 26.

---

## 6. Five-phase independent-review matrix

No scores or rankings are assigned. "Independence" is assessed from each document's own
disclosure and provenance, never from its filename.

| Phase | Implementation report | Independent review | Reviewer independence | Findings | Findings remediated? | Artifact committed? | Evidence |
|---|---|---|---|---|---|---|---|
| **22** | `docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md` — **tracked** | **NONE** | n/a — no review | n/a | n/a | n/a | No `SECURITY_REVIEW_PHASE_22.md` in any commit; `docs/RELEASE_READINESS.md:193` "No independent review of Phases 22 or 23 at all." |
| **23** | `docs/PHASE_23_PRODUCTION_SECURITY_RELEASE_ASSURANCE.md` — **tracked**. No `PHASE_23_FINAL_REPORT.md` exists | **NONE** | n/a — no review | n/a | n/a | n/a | `docs/PHASE_24_DEFERRED_FINDINGS_CLOSURE.md:8` "there is no `docs/PHASE_23_FINAL_REPORT.md` and no `SECURITY_REVIEW_PHASE_23.md` in the repository" |
| **25** | `docs/PHASE_25_FINAL_REPORT.md` — **tracked** | `SECURITY_REVIEW_PHASE_25.md` exists | **NOT INDEPENDENT — self-disclosed** | N-1 LOW, N-2 MEDIUM, N-3 LOW, N-4 LOW, N-5 INFO. No Critical/High | N-1 addressed; N-2, N-3, N-4 **open by design**; N-5 open | **NO — UNTRACKED**, never in any commit | `:6` "Reviewer type: review agent"; `:16` "**This review is not fully independent, and a reader must weigh it accordingally.**"; `:22-25` discloses the reviewer previously **endorsed** F-1…F-5 by writing `PHASE_26_FINAL_REPORT.md`; `:355` "this document should not be treated as the closure of the Phase 25 review blocker on its own" |
| **26** | `docs/PHASE_26_FINAL_REPORT.md` — **tracked** | `SECURITY_REVIEW_PHASE_26.md` exists | **NOT INDEPENDENT — unambiguous self-authorship** | N-6 LOW, N-7 LOW, N-8 INFO, N-9 LOW, N-10 MEDIUM, N-11 LOW. No Critical/High | N-6, N-9 addressed; N-7, N-10, N-11 **open**; N-10 procedural mitigation only | **NO — UNTRACKED**, never in any commit | `:7` "Reviewer type: review agent"; `:16-17` "**This review is NOT independent. It is a self-review with adversarial method, and it must not be cited as independent assurance.**"; `:19` "**I implemented all three workstreams reviewed here.**"; `:315-317` "this document does **not** constitute independent review of Phase 26, because I wrote Phase 26" |
| **27** | `docs/PHASE_27_FINAL_REPORT.md` — **UNTRACKED** | **NONE** | n/a — no review | n/a (no review exists) | n/a | **NO — UNTRACKED** | See §5. The report is the only Phase 27 artifact and is the implementer's own. |
| *28 (context)* | `docs/PHASE_28_FINAL_REPORT.md` — **UNTRACKED** | `SECURITY_REVIEW_PHASE_28.md` exists | **Independent per its own disclosure**; reviewed Phase 27 work, not its own; declines to close prior blockers | F-1 Low, F-2 Medium, F-3 Low, F-4/5/6 Informational. **Nothing fixed** | F-1, F-2, F-6 closed in Phase 29; F-3 accepted with reason; F-4, F-5 unchanged | **NO — UNTRACKED** | `:3` "**Reviewer:** independent reviewer, engaged solely for adversarial verification"; `:29-30` "**I am a separate reviewer. I did not implement Phase 28…**"; `:38-45` records what was not relied on; `:1288-1294` "I am not closing them" |
| *29 (context)* | `docs/PHASE_29_FINAL_REPORT.md` — **tracked** | `SECURITY_REVIEW_PHASE_29.md` exists | **Independent per its own disclosure** | **None** — `:262` "**No finding.** No remediation required." | n/a; disposition `APPROVED WITH FINDINGS — none` | **YES — tracked in `4ddc0b5`** | `:5` "This is an independent, read-only review of Phase 29 work performed by a previous implementation session." **But see `P31-1`: this review did not detect that the reviewed tree fails hosted CI.** |

### 6.1 Two observations Phase 30 did not record

1. **Three of the four review artifacts that exist for Phases 25, 26, and 28 are untracked and
   have never been in any commit.** A reviewer who clones `origin/main` receives
   `SECURITY_REVIEW_PHASE_29.md` and the self-disclosures for 25/26 **do not reach them**.
   The disclosures that refute `README.md:254-255` (§11, `P31-9`) are precisely the documents
   that do not ship. This is recorded as `P31-14`.
2. **The Phase 29 independent review is a "no findings" review of a tree that fails hosted
   CI.** Its stated limitation "`SECURITY_REVIEW_PHASE_29.md` §13: No hosted GitHub Actions
   run" was true as a statement about *recorded* evidence at review time, and the run that
   exposes the defect was triggered by the `4ddc0b5` push. The review could not have caught
   it. That is a limitation of method, not misconduct, and it is recorded as `P31-1`.

---

## 7. Phase 29 / hosted-CI verification

This is the workstream where independent verification changed the answer. Phase 30 recorded
this question as externally unverifiable. Network egress and pre-existing `gh` credentials
were available, so I resolved it.

### 7.1 The complete hosted-run history for this repository

Source: `gh run list --repo Tarangj07/KinCare-Connect` (GitHub Actions API).

| Run ID | Commit | Subject | Conclusion | Duration | Started (UTC) |
|---|---|---|---|---|---|
| `36557892479` | `d9320ae` | Merge origin/main into main | **failure** | 2m30s | 2026-09-29T10:48:58Z |
| `36558509809` | `61134d7` | Fix release job step ordering | **success** | 4m14s | 2026-09-29T10:55:01Z |
| `36559104224` | `16dac73` | Add release checkpoint record for Phase 26 | **success** | 3m22s | 2026-09-29T11:00:49Z |
| `36559541316` | `f51614d` | Record run 3 (36559104224) as the definitive green run | **success** | 3m5s | 2026-09-29T11:05:04Z |
| **`36618193752`** | **`4ddc0b5`** | **phase(29): checkpoint CI integration and release assurance** | **FAILURE** | **2m35s** | **2026-09-29T19:17:32Z** |

`4ddc0b5` is the newest run in the repository. **No later commit supersedes it.**

### 7.2 The four questions, answered explicitly

1. **Has commit `4ddc0b5` itself run on GitHub Actions?**
   **YES.**

2. **Run ID and status?**
   **Run `36618193752` — FAILURE.** Started 2026-09-29T19:17:32Z, duration 2m35s.
   **2 of 5 jobs failed.** Job-level results:

   | Job | Conclusion |
   |---|---|
   | Mobile — typecheck and tests | success |
   | Web — typecheck, lint, tests, build | success |
   | Containers — build API and Web images | success |
   | **API — typecheck, tests, build** | **failure** |
   | **Release — migrations, release artifacts, security regression sweeps** | **failure** |

3. **Preserved as an assurance gap?**
   It is worse than a gap, and it must be preserved as a **known-failing state of
   `origin/main`**, not as an absence of evidence. See `P31-1`.

4. **Has any later commit superseded `4ddc0b5`?**
   **No.** `origin/main` == `HEAD` == `4ddc0b5`; the run list confirms no run against any
   later commit. Nothing was pushed by this review.

### 7.3 Root cause of the hosted failure — both root causes proven from run logs

This is the material content of Phase 31. Both failures are **deterministic consequences of
committing a workflow that references artifacts that were never committed.**

#### Root cause A — `release` job fails: workflow invokes an uncommitted script

Failed step: `Storage backup — STORAGE_DIR archive, destroy, restore, re-verify (Phase 28 WS2)`

```
[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a "verify:storage:backup" script
##[error]Process completed with exit code 1.
```

Independent structural confirmation:

```
$ git cat-file -e 4ddc0b5:scripts/verify-storage-backup-restore.mjs   → NOT IN COMMIT
$ git cat-file -e 4ddc0b5:scripts/mutate-rate-limit-n12.mjs          → NOT IN COMMIT
$ git cat-file -e 4ddc0b5:scripts/run-db-suites.mjs                  → NOT IN COMMIT
$ git cat-file -e 4ddc0b5:scripts/mutate-ci-integration.mjs          → IN COMMIT
$ git cat-file -e 4ddc0b5:scripts/verify-ci-parity.mjs               → IN COMMIT
```

`apps/api/package.json` at `4ddc0b5` contains **neither** `verify:storage:backup` **nor**
`verify:ratelimit:n12:mutate`; both entries exist only as uncommitted modifications.

**Therefore `origin/main` is structurally incapable of passing its own CI workflow.** Three
consequences, none recorded anywhere in the repository:

- The committed `release` job fails at the storage-backup step.
- Every step after it is **skipped** (13 steps show `-`), including the Phase 29 CI-contract
  check, the Phase 29 CI-integration mutation, the N-12 mutation, and the DB-suite driver.
- Had the missing artifacts been committed but the rate limiter left at 403, the N-12 mutation
  step would have failed instead. The commit cannot go green as it stands.

I confirmed pnpm's behaviour for an undefined script independently, in a throwaway
directory: `ERR_PNPM_NO_SCRIPT`, exit code 1.

#### Root cause B — `api` job fails: a committed gate is broken on any normal host

Failed step: `Configuration contract — env, ports, versions, secrets (Phase 23 W5)`

```
env vars read by code : DATABASE_URL, ECC_TEST_DISABLE_RATE_LIMIT, HOME, JWT_ACCESS_SECRET,
  NEXT_PUBLIC_API_URL, NODE_ENV, P20_API_IMAGE, P20_WEB_IMAGE, P23_ARTIFACT_DATABASE_URL,
  P23_AUTH_BASE_PORT, P23_CI_DATABASE_URL, PATH, PORT, STORAGE_DIR
FAILED — 2 configuration problem(s):
  - `PATH` is read by scripts/mutate-ci-integration.mjs but is documented in no template.
    An operator setting it from the documentation would be misled, and one not setting it
    gets a surprise.
  - `HOME` is read by scripts/mutate-ci-integration.mjs but is documented in no template.
```

`scripts/mutate-ci-integration.mjs` **is committed** (Phase 29). It reads `PATH` and `HOME`.
The committed `scripts/verify-config-contract.mjs` does not exempt them, and
`verify-config-contract.mjs:319` (`if (NOT_CONFIGURATION.has(name)) continue;`) causes any
non-exempted, undocumented variable to `fail()`.

The remedy — adding `PATH` and `HOME` to the `NOT_CONFIGURATION` allowlist — **exists in the
working tree as an uncommitted modification** and is not in the commit.

This is not host-specific. `PATH` and `HOME` are set on every GitHub runner and every
developer machine, so the committed gate fails wherever it is executed. I confirmed the
allowlist is load-bearing for the gate's pass result: both variables are set in the
environment where the gate passed for me (`verify-config-contract.mjs` → `EXIT=0`), and
`TERM` — the sole pre-existing entry in that allowlist — demonstrates the intended
classification.

#### Why the repository's own gates did not catch either defect

`verify-ci-parity.mjs --list` **passes** (`EXIT=0`) on the working tree, and it also passed on
the working tree at the time the `4ddc0b5` commit was made. It enforces step presence,
`REQUIRED_GATES`, the advisory/`|| true` rules, Node-version agreement, and the
containers-job check — and it does **not** verify that the `run:` targets of those steps
resolve to files or package scripts that exist. It validates the *shape* of the wiring, not
its *resolvability*.

This sharpens Phase 30's limitation `L-1` rather than replacing it. `L-1` correctly states
the contract "does **not** prove the step sits in a job whose environment can run it". The
Phase 31 observation is distinct and more basic: **it does not prove the step's command
resolves at all.** Recorded as `P31-5`; the gate was **not** modified.

### 7.4 Local parity and local mutation are not hosted CI

I record explicitly, as required, that none of the following is treated as equivalent to
hosted CI, and none of it is offered as evidence that `4ddc0b5` passes:

- `verify-ci-parity.mjs --list` — local structural check, exits 0, executes nothing
- `verify-ci-parity.mjs` (executing mode) — local re-execution of the same commands
- `mutate-ci-integration.mjs` — local, mutates throwaway copies, asserts real files unchanged
- `mutate-rate-limit-n12.mjs` — local, mutates source in place and restores it byte-identically
- The eleven gates in §9 — all local

Local green does not imply hosted green. **Here the converse is demonstrated: local green
coexisted with a red hosted run on the same commit.**

---

## 8. 24-blocker revalidation

No blocker is closed because a document says it is closed. No new category was created.
Classification vocabulary is unchanged: `EXTERNAL`, `REPOSITORY-DEFERRED`,
`ACCEPTED-LIMITATION`.

### 8.1 EXTERNAL — outside repository control

| # | Blocker | Phase 30 class | Phase 31 disposition | Independent evidence / note |
|---|---|---|---|---|
| E-1 | Staging deployment | EXTERNAL | **OPEN** — class correct | Absence established from `docs/RELEASE_READINESS.md` §4.3/§6 and the absence of any staging host on this machine. Not verified against a hosting provider |
| E-2 | TLS termination | EXTERNAL | **OPEN** — class correct | **Verified:** no `sslmode`, no TLS config, no certificate material in `apps/api/src`, `.env.example`, or `docker-compose.yml`. Matches `COMPLIANCE.md:74` "TLS / HTTPS termination — NOT IMPLEMENTED" |
| E-3 | Production deployment | EXTERNAL | **OPEN** — class correct | Not independently verifiable without a target; no deployment artifact exists in-repo |
| E-4 | Penetration testing | EXTERNAL | **OPEN** — class correct | No evidence of any engagement, internal or external, in any document |
| E-5 | Compliance certification | EXTERNAL | **OPEN** — class correct | `COMPLIANCE.md:11-14` "The ECC repository makes **no compliance claim**"; `:17-32` enumerates the absent certifications. The non-claim is accurate |
| E-6 | Managed PostgreSQL / object storage | EXTERNAL | **OPEN** — class correct, nuance retained | Phase 30's nuance (adopting them would be a design change) is sound. Note a developer `ecc-postgres` container is running locally; that is not the supported deployment model |
| E-7 | Observability / alerting / metrics / tracing | EXTERNAL | **OPEN** — class arguable, nuance retained | Instrumentation could be written in-repo; operating it cannot. Phase 30's split treatment is reasonable |
| E-8 | Backup scheduling / encryption / retention | EXTERNAL | **OPEN** — class arguable, nuance retained | A *script* is repository-deferrable; scheduling, key management, and retention policy are operational. Phase 30 documents the ambiguity rather than hiding it. Reasonable |
| **E-9** | **Hosted CI run for the current tree** | EXTERNAL | **CONTRADICTED — and reclassified** | **See §7.** Phase 30 recorded this as "NOT CLAIMED / no hosted run has occurred". In fact run `36618193752` executed `4ddc0b5` and **failed**. The blocker is no longer "a run is needed"; it is "the tree is known-red, with two proven root causes". The remaining external part (re-run after a fix is pushed) is still external; the **defect itself is repository-deferred**. Recorded as `P31-1`, `P31-2`, `P31-3` |
| E-10 | Load / concurrency / soak testing at production scale | EXTERNAL | **OPEN** — class correct | Bounded smoke exists and is labelled as such (`docs/PHASE_27_FINAL_REPORT.md:44` "NOT production capacity testing"). I did not re-run it |
| **E-11** | **Live dependency advisory set** | EXTERNAL | **OPEN — classification rationale CONTRADICTED** | Phase 30's stated reason is `docs/PHASE_29_FINAL_REPORT.md` §16 "not re-fetched; **no network egress**". **Network egress exists**: `registry.npmjs.org` → HTTP 200, and `gh` is authenticated. Refreshing the advisory set requires no external party and no new credential. This is `REPOSITORY-DEFERRED`, not `EXTERNAL`. Recorded as `P31-9` |

### 8.2 REPOSITORY-DEFERRED — addressable in-repo, deliberately not done

| # | Item | Phase 31 disposition | Independent evidence / note |
|---|---|---|---|
| R-1 | Independent reviews for Phases 22, 23, 25, 26, 27 | **OPEN** — confirmed, and **not closable by this review** | §5, §6. Per §1.2 this document must not be used to close it. The **label collides** with Phase 30 *finding* R-1 (`P31-11`) |
| R-2 | Backup storage half at production volume | **OPEN** — CONFIRMED WITH LIMITATION | 8 files, one local filesystem. I re-ran the Phase 28 gate at existing scale: PASS (§9). Production volume untested |
| R-3 | Web test coverage | **OPEN** — **verified** | `find apps/web/src -name '*.test.*' -o -name '*.spec.*'` → exactly **1** file (`api-base.test.ts`). Phase 30's claim is exact |
| R-4 | Mobile test coverage / device verification | **OPEN** — CONFIRMED WITH LIMITATION | Not re-run at device level. The Phase 28 N-12 change to `apps/mobile/src/services/api.ts` is itself **uncommitted** |
| R-5 | `mutate-container-gate.mjs` pre-run control | **OPEN** — class correct; **new note** | The harness file itself carries an **uncommitted 68-line modification**, so the artifact this blocker describes is not in the commit either |
| R-6 | Keyed `@Body('field')` on public stubs | **OPEN** — **verified, with a precision correction** | `apps/api/src/auth/auth.controller.ts` binds keyed body params on **3 public stubs / 4 parameters**: `forgotPassword(@Body('email'))` `:130`, `resetPassword(@Body('token'), @Body('newPassword'))` `:137`, `verifyEmail(@Body('token'))` `:143`. Phase 30's "3 Phase 4 public stubs" is right on stubs; a reviewer counting parameters will see 4 |

### 8.3 ACCEPTED-LIMITATION — known, disclosed, deliberately not fixed

| # | Item | Phase 31 disposition | Independent evidence / note |
|---|---|---|---|
| A-1 | Mobile client clears the session on any 403 | **OPEN** — **verified present** | `apps/mobile/src/services/api.ts:49` `await deleteAccessToken()` inside the `401 \|\| 403` branch. Phase 30's rationale (403 is also the session-revocation signal) is sound |
| A-2 | Lint baseline 55 errors / 69 warnings | **OPEN** — **verified exactly** | `pnpm --filter @ecc/api lint` → `✖ 124 problems (55 errors, 69 warnings)`. Baseline holds precisely |
| A-3 | `mutate-container-gate.mjs` has no pre-run control | **OPEN** — class correct | See R-5: the harness is uncommitted-modified |
| A-4 | CI contract does not prove correct job placement | **OPEN** — class correct, and **understated** | The contract also does not prove a step's command *resolves*. See `P31-5` and §7.3 |
| A-5 | Two advisory `continue-on-error` CI steps | **OPEN** — **verified** | `ci.yml:131` API lint "(advisory — 55 pre-existing errors…)"; `ci.yml:305` Mobile lint "(advisory — pre-existing warnings…)". Correctly excluded from the gates in every report |

### 8.4 Totals after revalidation

| Class | Phase 30 | Phase 31 | Movement |
|---|---|---|---|
| EXTERNAL | 11 | **10** | `E-11` reclassified to REPOSITORY-DEFERRED (egress exists) |
| REPOSITORY-DEFERRED | 6 | **8** | `E-11` in; plus the two **new** repository-deferred defects from `P31-2`/`P31-3` (committed workflow references uncommitted artifacts; committed config-contract gate fails on `PATH`/`HOME`) |
| ACCEPTED-LIMITATION | 5 | **5** | unchanged |
| **Total tracked** | **24** | **23 + 2 new** | 24 Phase 30 blockers all revalidated; 2 material new blockers added (§12) |

No Phase 30 blocker was closed. One classification was corrected, and the correction is
justified by direct evidence rather than by preference.

---

## 9. Security regression results

Twelve existing gates were re-run. **No gate was modified.** All were executed read-only with
respect to the repository; the two that mutate files (`mutate-rate-limit-n12.mjs`,
`mutate-ci-integration.mjs`) were run in their own designed mode and both self-asserted
byte-identical restoration.

| # | Gate | Command | Result | Note |
|---|---|---|---|---|
| 1 | Config contract | `node scripts/verify-config-contract.mjs` | **PASS** (exit 0) | Passes **only** because of the uncommitted `PATH`/`HOME` allowlist entries. Fails as committed — proven in §7.3 |
| 2 | Env contract | `node scripts/verify-env-contract.mjs` | **PASS** (exit 0) | Templates consistent with code |
| 3 | Dependency triage | `node scripts/verify-dependency-triage.mjs` | **PASS** (exit 0) | Fails closed on missing/unreadable audit report |
| 4 | Next.js config features | `node scripts/verify-next-config-features.mjs` | **PASS** (exit 0) | AST-based; comment-mention false positive correctly rejected |
| 5 | Decorator metadata | `pnpm --filter @ecc/api verify:metadata` | **PASS** (exit 0) | Source and compiled artifact; 59 DTO identity checks |
| 6 | Route authorization | `pnpm --filter @ecc/api verify:routes` | **PASS** (exit 0) | Every non-public live route guarded; public allow-list matches |
| 7 | Release artifact | `node scripts/verify-release-artifact.mjs` | **PASS** (exit 0) | 70 modules 1:1 with source; no test/credential material; byte-identical rebuilds; booted against its own throwaway DB, which it destroyed |
| 8 | DB migrations | `bash scripts/verify-db-migrations.sh` | **PASS** (exit 0) | Self-asserted it only ever targeted its own throwaway container on `127.0.0.1:55433` |
| 9 | CI parity (structural) | `node scripts/verify-ci-parity.mjs --list` | **PASS** (exit 0) | 47/50 commands local, 3 remote. **Did not detect the two hosted failures** — see `P31-5` |
| 10 | Phase 28 storage backup/restore | `pnpm --filter @ecc/api verify:storage:backup` | **PASS** (exit 0) | Archive → destroy → restore → re-verify; real compiled `StorageService`; traversal containment. Temp tree self-cleaned |
| 11 | Phase 28 N-12 rate-limit mutation | `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` | **PASS** (exit 0) | Every N-12 protection load-bearing; negative control genuinely blind; source restored byte-for-byte |
| 12 | Phase 29 CI-integration mutation | `node scripts/mutate-ci-integration.mjs` | **PASS** (exit 0) | All required Phase 28 gates enforced; contract unsatisfiable by comment or advisory step; six real files asserted unchanged |

### 9.1 Assessment

**No regression attributable to Phase 30 was detected.** Phase 30 was documentation-only, and
I confirmed that `ci.yml`, `verify-ci-parity.mjs`, `mutate-ci-integration.mjs`, `pnpm-lock.yaml`,
`apps/api/prisma/`, and both Dockerfiles are byte-identical to `4ddc0b5`.

**The two red hosted-CI results are not regressions introduced by Phase 30.** They were
present in `4ddc0b5` at the moment it was pushed (2026-09-29T19:17:32Z), before any Phase 30
artifact was written. They are pre-existing defects of the Phase 29 checkpoint, discovered
here for the first time.

### 9.2 Two gate observations, recorded rather than repaired

- **`P31-5`** — `verify-ci-parity.mjs --list` validates the shape of CI wiring but not the
  resolvability of what the steps invoke. It passed on a tree whose `release` job cannot run.
- **Gate hygiene** — four gate/harness files carry uncommitted modifications
  (`verify-config-contract.mjs`, `verify-docker-images.mjs`, `mutate-container-gate.mjs`,
  `verify-compiled-auth.mjs`). Two of these *tighten* assertions and are well-constructed —
  `verify-docker-images.mjs` now asserts `429` + `error.code === 'RATE_LIMITED'` + a positive
  integer `Retry-After`, and adds a converse check that a genuine authorization refusal is
  still `403 FORBIDDEN` with **no** `Retry-After`, which is the check that would catch a
  "fix" implemented by widening every 4xx. One *relaxes* a classification (`P31-6`). None
  was modified by this review.

---

## 10. Integrity / contamination results

### 10.1 Git state

| Check | Result |
|---|---|
| `HEAD` before → after | `4ddc0b5` → `4ddc0b5` — **unchanged** |
| `origin/main` before → after | `4ddc0b5` → `4ddc0b5` — **unchanged** |
| Working-tree fingerprint before → after | `f3e16251bc5e9d0a71759994d9b10fc7` → `f3e16251bc5e9d0a71759994d9b10fc7` — **identical** |
| Tracked modifications | 10 before, 10 after — **identical set** |
| Untracked paths | 16 before, 16 after — **identical set** (this review added exactly one file: this document) |
| `git diff --cached` | empty before and after — **no staged changes** |
| `git stash list` | empty before and after |
| `git reflog` | unchanged; no `commit`, `reset`, `rebase`, `amend`, or `merge` entry was created |
| **Any commit by this review** | **NO** |
| **Any push by this review** | **NO** |

The working-tree fingerprint is the strongest single control here: it is a hash of
`git status --porcelain`, recomputed after every gate that touches files. It is byte-identical
to the value captured before any gate ran.

### 10.2 Protected artifacts

| Artifact | State | Disposition |
|---|---|---|
| `pnpm-lock.yaml` | byte-identical to `HEAD` | **Untouched** |
| `apps/api/prisma/schema.prisma` | byte-identical to `HEAD`; 36 models | **Untouched** |
| `apps/api/prisma/migrations/` | byte-identical to `HEAD` | **Untouched** |
| Application source (`apps/api/src`, `apps/mobile/src`, `apps/web/src`) | unchanged by this review; the 10 pre-existing modifications are byte-identical to their pre-review state | **Untouched** |
| Dockerfiles, `docker-compose.yml` | byte-identical to `HEAD` | **Untouched** |
| `.github/workflows/ci.yml` | byte-identical to `HEAD` | **Untouched** |
| Historical phase reports | not edited | **Untouched** — including documents this review found false |
| `SECURITY_REVIEW_PHASE_*.md` (all) | not edited, none created | **Untouched** |
| `PROJECT_PLAN-old.md` | not edited | **Untouched** |

**No historical document was silently corrected.** Where this review found a false claim
(`README.md:213-214`, `README.md:222-224`, `COMPLIANCE.md:101-110`, …) the claim stands in
the tree and is recorded in §11 and §12. Correcting them is a separately authorised action
that would itself require review.

### 10.3 Developer database and infrastructure

| Item | Finding |
|---|---|
| Developer `ecc` database | **Not targeted.** `verify-db-migrations.sh` self-asserts "the script only ever targeted the container it created" on `127.0.0.1:55433`. `verify-release-artifact.mjs` reported its throwaway DB "destroyed". No gate in §9 connects to `localhost:5432/ecc` |
| Developer containers | `ecc-postgres`, `ecc-redis`, `ecc-minio` — **untouched**, up 15h throughout, same state before and after |
| Throwaway containers from this review | **none leaked.** `docker ps -a` after all runs shows no `ecc-*-pg-*`, artifact, or throwaway container |
| Throwaway volumes | No new anonymous volumes created by this review; the pre-existing anonymous volumes date from 2026-09-29 18:45–18:58 UTC, hours before this review |
| Throwaway filesystem trees | Storage gate reported `cleaned up /tmp/ecc-p28-storage-f6Q2IN: removed` |
| My own throwaway working directories | `/tmp/opencode/p31` (extracted commit) and `/tmp/opencode/pnpmtest` (pnpm behaviour probe) — **both removed** |

### 10.4 One unattributed artifact — disclosed, not removed

An empty PostgreSQL 16.15 server is running as container **`pg-pgtest`** on
`127.0.0.1:55432`, created `2026-09-30T04:01:35Z` (about 14 minutes before I inspected it).

I established the following and did **not** delete it:

- **It is not mine.** No script in this repository creates a container named `pg-pgtest`. The
  project's own throwaway provisioner uses the convention `ecc-${label}-pg-${runId}`
  (`scripts/lib/throwaway-postgres.mjs:58`). `verify-db-migrations.sh` is the only file in the
  repository that shells out to `docker run`, and it uses port `55433`.
- **It holds no application data.** `\l` inside it lists only `pgtest`, `postgres`,
  `template0`, `template1` — no `ecc_*` throwaway database, no Prisma schema, no application
  tables. The e2e suites I executed did not use it.
- **It matches a hazard the repository already documents.** `verify-ci-parity.mjs:31`,
  `throwaway-postgres.mjs:6`, and `verify-release-artifact.mjs:45` all describe an *orphaned*
  database at a hardcoded `127.0.0.1:55432/ecc_p23` that the gates could not confirm they had
  created, and the Phase 29 work deliberately moved off that port for exactly this reason.
- **I could not attribute its creation** to this review, to a prior session, or to a
  concurrent actor.

I left it running rather than risk destroying a database I cannot prove I own. Recorded as
`P31-10`. It should be removed by whoever owns it.

---

## 11. Release-readiness language audit

All 59 Markdown files outside `node_modules`, `.git`, `.turbo`, `.claude` were searched
case-insensitively for readiness, CI, verification, backup, review, and compliance claim
vocabulary. Documents were then checked against repository state.

**No document was rewritten.** The goal is to identify misleading current-state claims, not
to erase historical evidence.

### 11.1 A structural fact that colours everything below

The repository's most candid documents are untracked, and several of its tracked documents are
the stale ones.

| Document | Tracked? | Character |
|---|---|---|
| `README.md` | **tracked** | contains false current-state claims |
| `COMPLIANCE.md` | **tracked** | contains the densest cluster of false current-state claims |
| `SECURITY.md` | **tracked** | content stops at Phase 2, framed as "today" |
| `PROJECT_PLAN.md` | **tracked** | front-matter stale; has a self-declared precedence note at line 33 that mitigates |
| `docs/RELEASE_CHECKPOINT_PHASE_26.md` | **tracked** | accurate when written, hours out of date |
| `docs/BACKUP_RESTORE.md` | **tracked** | **model document** — self-dated, self-scoped, explicit "what was NOT tested" |
| `docs/RELEASE_READINESS.md` | **UNTRACKED** | candid, self-dated, but does not ship |
| `docs/PHASE_27_FINAL_REPORT.md` | **UNTRACKED** | candid |
| `SECURITY_REVIEW_PHASE_25.md` / `_26.md` / `_28.md` | **UNTRACKED** | contain the independence disclosures that refute `README.md:254` |
| `SECURITY_REVIEW_PHASE_29.md` | tracked | |

**A reviewer who clones `origin/main` receives the false claims and does not receive the
disclaimers.** Recorded as `P31-14`.

### 11.2 Current-state claims that are misleading or false (not corrected)

| Citation | Verbatim | Assessment |
|---|---|---|
| `README.md:254-255` | "`SECURITY_REVIEW_*` files are produced by independent reviewers, not by the implementer of the phase they review." | **False, and the highest-materiality claim Phase 30 did not catch.** Directly contradicted by `SECURITY_REVIEW_PHASE_25.md:16` ("not fully independent") and `SECURITY_REVIEW_PHASE_26.md:16-17` ("NOT independent … a self-review"). Compounded: both disclosing files are untracked, and both carry "Independent Review" in their H1. Unqualified present tense, no date anchor. See `P31-9` |
| `README.md:26-29`, `:204-207`, `:237` | "GitHub Actions has never executed against this repository" / "There is no run ID" / "(never yet executed)" | **False as a blanket.** Five runs exist, the newest of which is the failure of the current `HEAD` (§7.1). Phase 30 caught lines 26-29 (D-2) and 204-207 but **missed line 237**, a third repetition |
| `README.md:222-224` | "Phase 18–26 work is uncommitted on `main`; `origin/main` is at an earlier commit and lacks this work." | **False** (D-4). `origin/main` == `HEAD`; no divergence. Phase 30's characterisation — "Most misleading single claim in the repository" — is correct |
| `README.md:213-214` | "**No backup or restore has been tested.** Nothing in the repository performs one, and no claim to that effect should be made." | **False, and the instruction is wrong** (D-14). A real, executed, small-scale claim exists in `docs/BACKUP_RESTORE.md` §14 and *should* be made, accurately scoped |
| `COMPLIANCE.md:101` | "GitHub Actions workflow \| **Authored, never executed.** … **There is no run ID.**" | **False.** Five run IDs, three of them in the **tracked** `docs/RELEASE_CHECKPOINT_PHASE_26.md:180,198,279-295`. **Not examined by Phase 30** |
| `COMPLIANCE.md:105-106` | "Backup \| **NOT IMPLEMENTED and NOT TESTED.**" / "Restore \| … **No restore has ever been performed, not even locally**" | **False.** `docs/BACKUP_RESTORE.md` is tracked and 625 lines; §14 records two executed round trips. **Not examined by Phase 30** |
| `COMPLIANCE.md:110` | "Capacity / performance testing \| **NOT PERFORMED.** No load or soak test exists" | **Partly false.** A bounded 50-concurrent smoke test exists; a soak test genuinely does not |
| `COMPLIANCE.md:150` | "It does not mean verified on a GitHub-hosted runner. **That has never happened.**" | **False** |
| `COMPLIANCE.md:153-154` | "The reviews in `SECURITY_REVIEW_PHASE_*.md` are independent engineering reads" | **False** for Phases 25 and 26 |
| `COMPLIANCE.md:155-159` | "**Independent review of Phase 25 is outstanding** … and **`SECURITY_REVIEW_PHASE_26.md` does not exist.**" | The *blocker* is genuinely open; the stated *reason* ("does not exist") is false — both files exist as disclosed self-reviews |
| `COMPLIANCE.md:160-161` | "The Phase 16–26 work is **uncommitted** … not on any remote." | **False.** Committed (`4449ee3`) and pushed |
| `SECURITY.md:11-15` | "1. **Implementation status** — what the running code does *today*. … Items in part 1 are checked off only when the code that enforces them exists, has tests, and is exercised by CI." | **Misleading.** Part 1 ends at "Phase 2 — Database schema + Prisma". The promotion rule has not been executed for 27 phases, and "exercised by CI" is now known to be false for the current tree |
| `SECURITY.md:194-198` | "Every PR is reviewed by at least one other engineer." / "Security-sensitive PRs … require a second reviewer with the `security` label." | **Misleading.** `PROJECT_PLAN.md:3` states "Personal / side project". The repository has **no pull requests**; there is no `security` label; the two security-sensitive reviews that exist are self-disclosed self-reviews |
| `ARCHITECTURE.md:322-323` | "`COMPLIANCE.md` … documents: Technical controls we implement (**encryption in transit**, hashing, …)" | **Self-contradicted.** `COMPLIANCE.md:74` "TLS / HTTPS termination \| **NOT IMPLEMENTED.**" **Not examined by Phase 30** |
| `docs/PHASE_29_FINAL_REPORT.md:687-691` | "1. **No GitHub Actions run exists.** Every CI result here is a local execution of the same commands on this host." | **False as written**, and it is false about the report's own base commit: a run *did* occur at `f51614d` (`36559541316`, success). The §16 table row immediately above it is correctly scoped to "the post-Phase-28/29 tree"; the sentence appended to the heading defeats that scoping. **Phase 30 §6.4 assessed both as "Accurate"; I disagree** — see `P31-1` |
| `docs/RELEASE_CHECKPOINT_PHASE_26.md:317-318`, `:325-326`, `:368` | "**No restore has ever been performed**, not even locally." / "`SECURITY_REVIEW_PHASE_25.md` **does not exist**, and `SECURITY_REVIEW_PHASE_26.md` does not exist." / "3. **Backup/restore** — no procedure, no rehearsal." | **Historical and correctly dated** ("Checkpoint date: 2026-09-29"), but the same day saw Phases 27, 28, and 29 run. Both files now exist. **Tracked**, so a reviewer of `origin/main` receives it. Note this same document contains the repository's best refutation of `PROJECT_PLAN.md:768-771` — the correcting evidence is committed, it simply was not propagated |
| `PROJECT_PLAN.md:768-771` | "`origin/main` sits at `d06e6f8` … and it has *deleted* substantial Phase 16–25 security artefacts." | **Doubly false**, and the most serious sentence in the plan. `origin/main` is `4ddc0b5`, and the alleged deletion is disproved by the repository's own **tracked** record: `docs/RELEASE_CHECKPOINT_PHASE_26.md:39-52` "**Deletions it introduced \| NONE**" and `:54-57` "The security files are absent from `origin/main` because they were **never committed locally**, not because a remote commit removed them." |
| `PROJECT_PLAN.md:5-7`, `:30`, `:743-759`, `:765-777`, `:1092-1095`, `:1148-1156`, `:1170-1172` | 14 separate stale current-state assertions (milestone, "not committed", "no CI run", "no backup tested", "Phase 27 has not started", "Not yet implemented: any executed GitHub Actions run … Backup/recovery tooling") | **Confirmed stale** (D-5…D-8 and beyond). Materially mitigated by the self-declared precedence rule at `PROJECT_PLAN.md:33` — **except** for lines 5-7, which sit *above* that rule and are not covered by it |

### 11.3 Claims that are historical and properly scoped — endorsed

These are genuinely good, and the contrast is the point: this repository knows how to write
non-claims, and does so well in its most recent work.

| Citation | Verbatim |
|---|---|
| `docs/BACKUP_RESTORE.md:516-531`, `:574-592`, `:620-624` | "### 14.1 What was NOT tested (database) … **Restore at production data volume.** Tested at 3 rows." / "Backup automation, encryption, retention, production volume … remain unproven or absent." |
| `docs/PHASE_28_FINAL_REPORT.md:12-16` | "**This phase does not constitute an independent security review, production deployment validation, penetration test, compliance certification, or production-readiness certification.**" |
| `docs/PHASE_28_FINAL_REPORT.md:456` | "**Nothing in this phase converted "not tested" into "passed."**" |
| `docs/PHASE_29_FINAL_REPORT.md:720-741`, `:795-797` | "It does **not** prove GitHub Actions passes… It does **not** prove the system is production-ready… **The repository is not production-ready and is not staging-ready, and this phase does not change that.**" |
| `docs/PHASE_30_FINAL_REPORT.md:375-377`, `:404`; `docs/PHASE_30_RECONCILIATION.md:36-38`, `:419-421` | "It does **not** prove production readiness… **No production-readiness or staging-readiness claim is made.**" |
| `docs/RELEASE_READINESS.md:6-8` | "This document uses **evidence, not scores**. There is no security rating here and no claim that the system is "secure", "certified" or "production ready"." |
| `COMPLIANCE.md:11-14`, `:17-32` | "The ECC repository makes **no compliance claim**." |
| `SECURITY_REVIEW_PHASE_28.md:1145`, `:1296` | "**I do not state that this system is production ready**" / "**I do not assign a score, a percentage, a ranking, or a "production ready" [label]**" |

**Direction-of-error note.** Every false claim found in §11.2 is an **understatement** of
assurance. None overstates readiness. The `COMPLIANCE.md` cluster in particular tells a
deployer there is *less* evidence than exists. The risk is reputational and operational, not a
security over-claim — but it is the mirror image of the Phase 30 reconciliation's central
failure, which was an **overstatement of assurance** (§7).

---

## 12. Findings

Newly discovered by this review. **Kept strictly separate from the inherited/open findings
of §5, §6, and §8**, which are not restated here.

Severity is expressed as release-review materiality, not as a risk score.

### P31-1 — `origin/main` has a **failing** hosted CI run; Phase 30 recorded the opposite

**Severity: HIGH (release-assurance integrity). OPEN.**

`HEAD`/`origin/main` = `4ddc0b5` ran on GitHub Actions as run **`36618193752`** and
**FAILED** — 2 of 5 jobs red (`API`, `Release`), 2026-09-29T19:17:32Z. It is the newest run
in the repository; nothing supersedes it.

`docs/PHASE_30_RECONCILIATION.md` §6.2 and §6.4 record the current-tree CI state as "**NONE
CLAIMED**" / "No hosted run has occurred" and assess `PHASE_29_FINAL_REPORT.md` §16 on this
point as "**Accurate**". That conclusion is **incorrect**, and it is load-bearing: it caused
blocker `E-9` to be classified as an unfulfilled *external* dependency ("a hosted environment
is needed") when the actual position is a *known-red* repository with two root-caused
defects. A release reviewer reading Phase 30 would conclude that `origin/main` is merely
un-verified; it is in fact **verified-failing**.

The same error appears in `SECURITY_REVIEW_PHASE_29.md` §13 ("No hosted GitHub Actions run"),
which was the upstream source of the list, and in `README.md` and `COMPLIANCE.md`. No artifact
in the repository records the failure.

### P31-2 — The committed CI workflow invokes three uncommitted scripts and two uncommitted package scripts

**Severity: HIGH. OPEN.**

`.github/workflows/ci.yml` (committed) `release` job runs:

| Step | Target | In commit `4ddc0b5`? |
|---|---|---|
| `Storage backup … (Phase 28 WS2)` | `pnpm --filter @ecc/api verify:storage:backup` | script entry **absent** from committed `apps/api/package.json`; `scripts/verify-storage-backup-restore.mjs` **untracked** |
| `Mutation — the N-12 429 contract is load-bearing (Phase 28)` | `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` | script entry **absent**; `scripts/mutate-rate-limit-n12.mjs` **untracked** |
| `Database-backed suites … (Phase 28)` | `node scripts/run-db-suites.mjs` | file **untracked** |

Hosted evidence: `[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a
"verify:storage:backup" script`.

**`origin/main` therefore cannot pass its own CI workflow.** Thirteen subsequent steps are
skipped by this failure, including the entire Phase 29 CI-contract and CI-integration-mutation
assurance. This is a repository defect, not an external dependency.

### P31-3 — The committed config-contract gate fails on any host where `PATH`/`HOME` are set

**Severity: HIGH. OPEN.**

Committed `scripts/mutate-ci-integration.mjs` reads `PATH` and `HOME`; the committed
`scripts/verify-config-contract.mjs` does not exempt them, and `verify-config-contract.mjs:319`
fails any non-exempted undocumented variable. Hosted evidence:

```
FAILED — 2 configuration problem(s):
  - `PATH` is read by scripts/mutate-ci-integration.mjs but is documented in no template.
  - `HOME` is read by scripts/mutate-ci-integration.mjs but is documented in no template.
```

The remedy exists **only as an uncommitted modification** to `verify-config-contract.mjs`.
Because `PATH` and `HOME` are set on every GitHub runner, this is not host-specific: the
committed gate fails wherever it runs. I verified the modification is load-bearing for the
gate's pass result.

### P31-4 — The Phase 28 N-12 rate-limit fix is uncommitted; the repository has two different rate-limiting behaviours

**Severity: MEDIUM. OPEN.**

`origin/main` throws `ForbiddenException` (**403**):
`git show 4ddc0b5:apps/api/src/auth/guards/rate-limit.guard.ts:76`.
The working tree throws `RateLimitExceededException` (**429** + `Retry-After`), and
`apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts` is untracked.

Consequences:

- `docs/RELEASE_READINESS.md:198` lists "Rate limiting returns HTTP 403, not 429 — N-12" as an
  **open** blocker. Accurate for `origin/main`; stale for the working tree.
- `THREAT_MODEL.md` §3.17 describes the mitigation as "structured 429 with `Retry-After`" —
  true of the working tree, **false of `origin/main`**.
- No document states which tree it describes.
- The fix itself is **good and mutation-proven** (§9, gate 11): the guard derives `Retry-After`
  from the real window with a floor of 1 and ceiling rounding, the e2e spec explicitly removes
  the test opt-out so the 429 path is genuinely exercised, and the mobile client no longer
  deletes the session on throttling. The defect is that none of it is in the commit.

### P31-5 — `verify-ci-parity.mjs --list` does not verify that CI steps' commands resolve

**Severity: MEDIUM. OPEN (gate defect recorded, not repaired).**

The contract enforces step presence, `REQUIRED_GATES`, advisory/`|| true` rules, Node-version
agreement, and the containers-job check. It does **not** resolve what each step's `run:`
target actually invokes. It exits 0 on a working tree whose `release` job provably cannot run.

This extends Phase 30's `A-4`/`L-1` rather than contradicting them: `L-1` says the contract
does not prove correct *job placement*; this is the more basic failure that it does not prove
*resolvability*. The gate was not modified, per instructions.

### P31-6 — Phase 30 materially understates the significance of the uncommitted working tree

**Severity: MEDIUM. OPEN (documentation).**

`docs/PHASE_30_RECONCILIATION.md:62-65` states:

> "The pre-existing working-tree state (10 tracked modifications, 16 untracked Phase 25–29
> artifacts) is **unrelated to Phase 30** … Those artifacts are earlier-phase deliverables
> that predate the Phase 29 checkpoint and are outside Phase 30's scope."

The first clause is true and creditably candid. The characterisation is not. Those artifacts
are **the implementations of gates that the committed CI workflow requires**, plus an
application behaviour change. They are not incidental. A release reviewer reading §2 would
reasonably conclude the working tree is cosmetically ahead of the commit, when in fact the
commit is **non-functional** and the working tree is the only place the system is coherent.
`docs/PHASE_30_FINAL_REPORT.md:39` repeats the characterisation.

### P31-7 — Phase 30's three artifacts give three different counts for the same fact

**Severity: LOW. OPEN (documentation).**

| Artifact | Tracked modifications | Untracked |
|---|---|---|
| `docs/PHASE_30_SPEC.md:23` | 11 | 15 |
| `docs/PHASE_30_RECONCILIATION.md:62` | 10 | 16 |
| `docs/PHASE_30_FINAL_REPORT.md:35` | — | 17 |
| **Measured by this review** | **10** | **16** |

The reconciliation's figures are correct; the spec and final report are not, and the three
disagree with each other. The specification's own baseline table — the document a
specification review is supposed to be checked against — is stale by one entry.

### P31-8 — The "16 documentation discrepancies" survey scope is undisclosed and materially narrow

**Severity: MEDIUM. OPEN (documentation).**

Phase 30 audited `README.md`, `PROJECT_PLAN.md`, and `docs/RELEASE_READINESS.md`. It did not
audit `COMPLIANCE.md`, `SECURITY.md`, or `ARCHITECTURE.md`, and the artifact nowhere discloses
this scope limit. `COMPLIANCE.md` — a **tracked** file that `ARCHITECTURE.md:320`,
`README.md:216`, and `PROJECT_PLAN.md:1175` all direct readers to for "exactly which technical
controls are evidenced" — contains at least **nine** false current-state claims (§11.2),
including "There is no run ID" and "No restore has ever been performed, not even locally".
`README.md:254-255` (false provenance guarantee) and `README.md:237` (third repetition of the
CI claim) were also missed. The count of 16 is accurate for what was surveyed and an
undercount of what exists.

### P31-9 — E-11's classification rests on a contradicted rationale

**Severity: LOW. OPEN (classification correction).**

`E-11` is classified `EXTERNAL` on the stated basis that the advisory set was "not re-fetched;
**no network egress**". Egress exists: `registry.npmjs.org` → HTTP 200, and `gh` is
authenticated. Refreshing the advisory set requires no external party and no new credential.
Reclassified `REPOSITORY-DEFERRED`. The underlying gap (advisory freshness) is real and
remains open; only its classification was wrong.

### P31-10 — Unattributed empty PostgreSQL server on `127.0.0.1:55432`

**Severity: INFORMATIONAL. OPEN (environment hygiene).**

Container `pg-pgtest` (`POSTGRES_DB/USER/PASSWORD = pgtest`), bound to `127.0.0.1:55432`,
created `2026-09-30T04:01:35Z`. Contains only the four default databases — no application
schema, no `ecc_*` throwaway database. No repository script creates a container with this name
(`throwaway-postgres.mjs:58` uses `ecc-${label}-pg-${runId}`; `verify-db-migrations.sh` uses
port 55433). Not created by this review; not attributable by this review; therefore not removed
by this review. It matches the orphan-database hazard the Phase 29 work documented and
deliberately moved away from. See §10.4.

### P31-11 — The label `R-1` denotes two different items in `docs/PHASE_30_RECONCILIATION.md`

**Severity: LOW. OPEN (documentation).**

§4 "**Finding R-1**" = "Phase 27 has no independent security review". §5.2 "**R-1**" = the
blocker "Independent reviews for Phases 22, 23, 25, 26, 27". A reviewer tracking `R-1` across
the document gets two unrelated items, and Phase 30's own §10 references "R-1" meaning the
finding while its blocker table means the blocker.

### P31-12 — The entire Phase 27–30 evidence chain is untracked

**Severity: MEDIUM. OPEN (assurance integrity).**

`git log --all --diff-filter=A` shows `SECURITY_REVIEW_PHASE_29.md` and
`docs/PHASE_29_FINAL_REPORT.md` were committed in `4ddc0b5`, and that **no** `SECURITY_REVIEW_PHASE_22/23/25/26/27/28.md`
was ever added in any commit on any branch. Untracked today: `SECURITY_REVIEW_PHASE_25.md`,
`_26.md`, `_28.md`, `_30.md`, `docs/PHASE_27_FINAL_REPORT.md`, `PHASE_28_FINAL_REPORT.md`,
`PHASE_28_RELEASE_REVIEW_HANDOFF.md`, all three Phase 30 artifacts, and `docs/RELEASE_READINESS.md`.

This compounds every §11.2 finding: the independent-review *registry* that identified the
25/26 self-reviews, and the document that records the Phase 27 gap, are themselves unavailable
to anyone reviewing `origin/main`. Run ID `36559541316` appears in **no tracked file in any
commit** (§4.5).

### P31-13 — Phase 30 grades R-1 "Informational"; the severity is understated

**Severity: LOW (classification disagreement). OPEN.**

`docs/PHASE_30_RECONCILIATION.md:137` assigns R-1 severity "Informational (review-process gap,
not a code defect)". The reasoning is right that it is not a code defect. But it sits
alongside `E-4` (no penetration test, EXTERNAL) and `E-5` (no compliance certification,
EXTERNAL), which are *also* process gaps and are **not** graded "Informational". A reviewer
cannot reconcile one unreviewed phase being informational while five unreviewed phases
collectively drive blocker `R-1`. No re-grade is proposed here — the point is that the
grading is internally inconsistent, and inconsistency in severity is what causes an item to be
deprioritised.

### P31-14 — Tracked documents carry the false claims; untracked documents carry the disclaimers

**Severity: MEDIUM. OPEN (assurance integrity).**

Synthesising §11.1 and `P31-12`: a cold reviewer of `origin/main` receives `README.md:254-255`
("reviews are produced by independent reviewers"), `COMPLIANCE.md:153-154`, and
`PROJECT_PLAN.md:768-771`'s data-loss allegation — and does **not** receive
`SECURITY_REVIEW_PHASE_25.md:16`, `SECURITY_REVIEW_PHASE_26.md:16-17`, or
`docs/RELEASE_READINESS.md`. The evidence that would let a reader form an accurate picture is
systematically the evidence that does not ship. This is a structural assurance finding, not a
documentation nit, and it is the direct cause of the `README.md:254-255` misstatement being
believable.

---

## 13. Confirmed limitations of this review

Stated so that no reader over-reads §7, §8, or §12.

| # | Limitation |
|---|---|
| L-P31-1 | **Not organisationally independent.** No separation of duties, no second reviewer, no external party. Cannot close blocker `R-1`. |
| L-P31-2 | **Single-host evidence.** All local results come from one machine. Not portable to a GitHub runner except where an actual hosted run is cited. |
| L-P31-3 | **Hosted CI verified only for the run history that exists.** Five runs, all on `main` pushes. Workflows other than `CI` were not enumerated, and no run for a pull request exists because no pull request exists. |
| L-P31-4 | **Absence of external infrastructure is documentary.** Staging, production, TLS, observability, and penetration testing were confirmed absent from the repository and unobservable on this host — not confirmed absent from the hosting provider's account. |
| L-P31-5 | **No gate was re-run at production scale.** Backup (8 files), storage volume, and concurrency (50 × 5) were not exercised beyond their designed scale. |
| L-P31-6 | **`pg-pgtest` could not be attributed.** Its existence and contents are documented; its origin is not established. |
| L-P31-7 | **Phase 22 and Phase 23 have no review, so there is nothing to review.** This review can confirm the *absence* of assurance for those phases; it cannot assess the quality of work that was never independently examined, and does not attempt to. |
| L-P31-8 | **Phase 30's specification review was not re-litigated on its merits.** `SECURITY_REVIEW_PHASE_30.md` approved the *specification*. I verified the specification's factual claims and found §6.4 wanting (§7.2); I did not re-derive its full WS1–WS5 plan. |
| L-P31-9 | **No finding below was fixed, by instruction.** This includes the two root-caused CI failures, which are recorded and left open. |

---

## 14. Exact evidence index

Every material assertion in this document traces to one of the following. Reproduced verbatim
where quoted.

### 14.1 Git and repository state

```
$ git rev-parse HEAD                                  → 4ddc0b5fda231761d0708fe6dd3083a08952ca3b
$ git rev-parse origin/main                           → 4ddc0b5fda231761d0708fe6dd3083a08952ca3b
$ git rev-list --left-right --count origin/main...HEAD → 0  0
$ git status --porcelain | awk '{print $1}' | sort | uniq -c
                                                     → 16 ??    10 M
$ git status --porcelain | md5sum                     → f3e16251bc5e9d0a71759994d9b10fc7   (identical pre/post)
$ git diff --cached --stat                            → (empty)
$ git stash list                                      → (empty)
$ git diff HEAD --stat -- pnpm-lock.yaml apps/api/prisma/                       → (empty)
$ git diff HEAD --stat -- .github/workflows/ci.yml scripts/verify-ci-parity.mjs \
      scripts/mutate-ci-integration.mjs                                        → (empty)
$ git diff HEAD --stat -- '*Dockerfile*' docker-compose.yml                     → (empty)
$ grep -c '^model ' apps/api/prisma/schema.prisma    → 36
```

### 14.2 The failing hosted run

```
$ gh run list --repo Tarangj07/KinCare-Connect --limit 20
completed  failure   phase(29): checkpoint CI integration and release assurance  CI main push 36618193752 2m35s 2026-09-29T19:17:32Z
completed  success   Record run 3 (36559104224) as the definitive green run …  CI main push 36559541316 3m5s  2026-09-29T11:05:04Z
completed  success   Add release checkpoint record for Phase 26                CI main push 36559104224 3m22s 2026-09-29T11:00:49Z
completed  success   Fix release job step ordering: build before the migration CI main push 36558509809 4m14s 2026-09-29T10:55:01Z
completed  failure   Merge origin/main into main                               CI main push 36557892479 2m30s 2026-09-29T10:48:58Z

$ gh run view 36618193752 --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"'
failure   Release — migrations, release artifacts, security regression sweeps
success   Mobile — typecheck and tests
failure   API — typecheck, tests (unit + PostgreSQL integration), build
success   Web — typecheck, lint, tests, build
success   Containers — build API and Web images, verify they run
```

Root cause A — `gh api repos/Tarangj07/KinCare-Connect/actions/jobs/109576524201/logs`:
```
[ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT] None of the selected packages has a "verify:storage:backup" script
##[error]Process completed with exit code 1.
```

Root cause B — `gh api repos/Tarangj07/KinCare-Connect/actions/jobs/109576524624/logs`:
```
env vars read by code : DATABASE_URL, ECC_TEST_DISABLE_RATE_LIMIT, HOME, JWT_ACCESS_SECRET,
  NEXT_PUBLIC_API_URL, NODE_ENV, P20_API_IMAGE, P20_WEB_IMAGE, P23_ARTIFACT_DATABASE_URL,
  P23_AUTH_BASE_PORT, P23_CI_DATABASE_URL, PATH, PORT, STORAGE_DIR
FAILED — 2 configuration problem(s):
  - `PATH` is read by scripts/mutate-ci-integration.mjs but is documented in no template. …
  - `HOME` is read by scripts/mutate-ci-integration.mjs but is documented in no template. …
```

Structural corroboration of Root cause A:
```
$ git cat-file -e 4ddc0b5:scripts/verify-storage-backup-restore.mjs   → NOT IN COMMIT
$ git cat-file -e 4ddc0b5:scripts/mutate-rate-limit-n12.mjs          → NOT IN COMMIT
$ git cat-file -e 4ddc0b5:scripts/run-db-suites.mjs                  → NOT IN COMMIT
$ git show 4ddc0b5:apps/api/package.json | grep -E 'verify:storage:backup|verify:ratelimit:n12:mutate'
                                                                     → (no match)
$ git show 4ddc0b5:apps/api/src/auth/guards/rate-limit.guard.ts | grep -n ForbiddenException
2:import { ForbiddenException,Injectable } from '@nestjs/common';
76:      throw new ForbiddenException('Rate limit exceeded. Try again later.');
$ git cat-file -e 4ddc0b5:apps/api/src/common/exceptions/rate-limit-exceeded.exception.ts → NOT IN COMMIT
```

### 14.3 Independent reviewer-independence evidence

```
SECURITY_REVIEW_PHASE_25.md:16   "**This review is not fully independent, and a reader must weigh it accordingally.**"
SECURITY_REVIEW_PHASE_25.md:22-25 reviewer previously wrote docs/PHASE_26_FINAL_REPORT.md endorsing F-1…F-5
SECURITY_REVIEW_PHASE_26.md:16-17 "**This review is NOT independent. It is a self-review with adversarial method, and it must not be cited as independent assurance.**"
SECURITY_REVIEW_PHASE_26.md:19   "**I implemented all three workstreams reviewed here.**"
SECURITY_REVIEW_PHASE_26.md:315-317 "this document does **not** constitute independent review of Phase 26, because I wrote Phase 26"
SECURITY_REVIEW_PHASE_28.md:3    "**Reviewer:** independent reviewer, engaged solely for adversarial verification"
SECURITY_REVIEW_PHASE_28.md:29-30 "**I am a separate reviewer. I did not implement Phase 28…**"
SECURITY_REVIEW_PHASE_28.md:1288-1294 "**Do the evidence support closing any previous blocker?** **No — not by itself, and I am not closing them.**"
SECURITY_REVIEW_PHASE_29.md:5    "This is an independent, read-only review of Phase 29 work performed by a previous implementation session."
SECURITY_REVIEW_PHASE_29.md:262  "**No finding.** No remediation required."
docs/PHASE_27_FINAL_REPORT.md:14-16 "…established that **two of them cannot be closed by the party that did the work** — including me."
docs/PHASE_28_RELEASE_REVIEW_HANDOFF.md:3 "**This document is NOT a security review.**"
docs/PHASE_26_FINAL_REPORT.md:163 "**Reproduction by the implementer's successor is not independent review.**"
```

### 14.4 Gate results (§9, all unmodified)

```
node scripts/verify-ci-parity.mjs --list                                  → EXIT=0
node scripts/verify-config-contract.mjs                                   → EXIT=0
node scripts/verify-env-contract.mjs                                      → EXIT=0
node scripts/verify-dependency-triage.mjs                                 → EXIT=0
node scripts/verify-next-config-features.mjs                              → EXIT=0
pnpm --filter @ecc/api verify:metadata                                    → EXIT=0
pnpm --filter @ecc/api verify:routes                                      → EXIT=0
node scripts/verify-release-artifact.mjs                                  → EXIT=0
bash scripts/verify-db-migrations.sh                                      → EXIT=0
pnpm --filter @ecc/api verify:storage:backup                              → EXIT=0
pnpm --filter @ecc/api verify:ratelimit:n12:mutate                        → EXIT=0
node scripts/mutate-ci-integration.mjs                                    → EXIT=0
pnpm --filter @ecc/api lint     → ✖ 124 problems (55 errors, 69 warnings)   [A-2 baseline holds exactly]
```

### 14.5 Environment and infrastructure

```
$ curl -o /dev/null -w '%{http_code}' https://api.github.com              → 200
$ curl -o /dev/null -w '%{http_code}' https://registry.npmjs.org/         → 200
$ gh auth status  → ✓ Logged in to github.com account Tarangj07 (keyring)
$ docker info     → 29.8.1 / driver=overlayfs
$ docker ps -a    → pg-pgtest (Up, 127.0.0.1:55432, POSTGRES_*=pgtest, created 2026-09-30T04:01:35Z)
                    ecc-postgres / ecc-redis / ecc-minio (Up 15h, untouched)
$ docker exec pg-pgtest psql -U pgtest -d pgtest -c '\l'
                  → pgtest, postgres, template0, template1  (no application schema, no ecc_* database)
$ docker ps -a | grep -E '^ecc-.*-pg-|artifact|throwaway'                 → (none; nothing leaked)
```

### 14.6 Documentation evidence

```
README.md:254-255            "SECURITY_REVIEW_* files are produced by independent reviewers, not by the implementer…"
README.md:213-214            "No backup or restore has been tested… no claim to that effect should be made."
README.md:222-224            "Phase 18–26 work is uncommitted on `main`; `origin/main` is at an earlier commit…"
README.md:237                "`.github/`  CI workflow (never yet executed)"
COMPLIANCE.md:101            "Authored, never executed.… There is no run ID."
COMPLIANCE.md:105-106        "Backup NOT IMPLEMENTED and NOT TESTED." / "No restore has ever been performed, not even locally"
COMPLIANCE.md:74             "TLS / HTTPS termination | NOT IMPLEMENTED."
ARCHITECTURE.md:322-323      "Technical controls we implement (encryption in transit, …)"
SECURITY.md:11-15            "Implementation status — what the running code does *today*… exercised by CI"
SECURITY.md:194-198          "Every PR is reviewed by at least one other engineer."
PROJECT_PLAN.md:3            "Project type: Personal / side project"
PROJECT_PLAN.md:33           "The `docs/PHASE_*.md` reports are authoritative for Phases 18+."
PROJECT_PLAN.md:768-771      "origin/main … has *deleted* substantial Phase 16–25 security artefacts."
PROJECT_PLAN.md:5-7          "Current milestone: Phase 26 … Not committed, not pushed, no CI run…"
docs/RELEASE_CHECKPOINT_PHASE_26.md:39-52  "Deletions it introduced | NONE"
docs/RELEASE_CHECKPOINT_PHASE_26.md:54-57  "absent from origin/main because they were never committed locally, not because a remote commit removed them"
docs/RELEASE_CHECKPOINT_PHASE_26.md:293-295 runs 36557892479/failure, 36558509809/success, 36559104224/success
docs/RELEASE_READINESS.md:65  "Run `36559541316`, commit `f51614d`, SUCCESS, 5/5 jobs… first and only line of evidence"
docs/RELEASE_READINESS.md:165 "`STORAGE_DIR` backup/restore | Command documented; never executed"
docs/RELEASE_READINESS.md:190-193 "No independent review of Phases 22 or 23 at all."
docs/RELEASE_READINESS.md:198  "10. Rate limiting returns HTTP 403, not 429 — see §10, N-12."
docs/BACKUP_RESTORE.md:205    "## 5. Restore command"
docs/BACKUP_RESTORE.md:516-531, 574-592, 620-624  "What was NOT tested"; "Tested at 3 rows"; "8 files"
docs/PHASE_27_FINAL_REPORT.md:32,38  run 36559541316; "PASS (database only)… 3 rows"
docs/PHASE_28_FINAL_REPORT.md:12-16,456  non-claims
docs/PHASE_29_FINAL_REPORT.md:660,687-691  "No hosted GitHub Actions run exists"; §16 "NOT CLAIMED"
docs/PHASE_30_SPEC.md:23      "11 tracked modifications…; 15 untracked artifacts"
docs/PHASE_30_SPEC.md:34      CI run reconciliation
docs/PHASE_30_RECONCILIATION.md:62-65  "10 tracked modifications, 16 untracked… unrelated to Phase 30"
docs/PHASE_30_RECONCILIATION.md:93-98  "16 discrepancies examined; 6 stale-or-false, 9 accurate, 1 time-scoped"
docs/PHASE_30_RECONCILIATION.md:135-157  Finding R-1
docs/PHASE_30_RECONCILIATION.md:209,213  blocker R-1 and R-5  (label collision with finding R-1)
docs/PHASE_30_RECONCILIATION.md:243,280,423  run 36559541316 @ f51614d
docs/PHASE_30_RECONCILIATION.md:255,281  "NONE CLAIMED"; "**Accurate.**"   ← contradicted, see P31-1
docs/PHASE_30_FINAL_REPORT.md:35,39  "17 (untracked)"; "earlier-phase" characterisation
SECURITY_REVIEW_PHASE_30.md:46,89  "Independent reviews 22/23/25/26/29"  (Phase 27 omitted → R-1)
SECURITY_REVIEW_PHASE_30.md:154  "cannot be independently verified by this review (requires GitHub API access)"  ← superseded, see §1.4
apps/api/src/auth/auth.controller.ts:130,137,143  keyed @Body on 3 public stubs / 4 params
apps/mobile/src/services/api.ts:49  await deleteAccessToken()  (inside `401 || 403`)
scripts/verify-config-contract.mjs:319  if (NOT_CONFIGURATION.has(name)) continue;
scripts/lib/throwaway-postgres.mjs:58  const container = `ecc-${label}-pg-${runId}`;
.github/workflows/ci.yml:131,305  advisory lint steps
.github/workflows/ci.yml:418,453,483  storage backup / N-12 mutation / DB-suite steps
```

---

## 15. Final disposition

### 15.1 Disposition of Phase 30

**PARTIALLY CONFIRMED, WITH ONE MATERIAL CONTRADICTION.**

Phase 30 is a careful, largely accurate document. Its inventory of blocker classifications is
sound, its backup/restore chronology is correct and its resolution of the apparent
`RELEASE_READINESS` contradiction is right, its treatment of the Phase 25/26 self-reviews is
candid and correct, its decision to preserve rather than silently correct historical documents
was right and was honoured, and it correctly declined to close any review gap. Its "what this
does not prove" section is exemplary.

It is **not** fully accurate. Its central CI conclusion — that no hosted run has occurred for
the current tree, and that the Phase 29 report is accurate on that point — is wrong, and the
error runs in the reassuring direction. It did not disclose the narrow scope of its
documentation survey, and it materially understated the significance of the uncommitted working
tree. Three of its own artifacts disagree with each other on basic counts.

**Phase 30 is not a false assurance document.** It is a document whose central external
dependency turned out to be answerable, and whose answering materially changes the picture.
That is a limitation of available evidence at the time, not misconduct. It should be corrected,
not distrusted wholesale.

### 15.2 Disposition of Phase 30's claims, in one table

| Material claim | Disposition |
|---|---|
| `HEAD` == `origin/main` == `4ddc0b5` | **CONFIRMED** |
| Lockfile / schema / migrations / `ci.yml` byte-identical to checkpoint | **CONFIRMED** |
| Working tree = 10 modified, 16 untracked | **CONFIRMED** |
| 16 documentation discrepancies, individually accurate | **PARTIALLY CONFIRMED** — accurate for the audited scope, an undercount overall (`P31-8`) |
| R-1: Phase 27 has no independent review | **CONFIRMED** — severity understated (`P31-13`) |
| Open set of unreviewed phases is five: 22, 23, 25, 26, 27 | **CONFIRMED** |
| 24 blockers: 11 EXTERNAL / 6 REPOSITORY-DEFERRED / 5 ACCEPTED-LIMITATION | **CONFIRMED** as an inventory; **one classification corrected** (`E-11` → REPOSITORY-DEFERRED) |
| No Phase 30 blocker was closed by this review | **CONFIRMED** |
| Hosted run `36559541316` @ `f51614d`, SUCCESS | **CONFIRMED** (independently verified via GitHub API) |
| No hosted run has executed `4ddc0b5` | **CONTRADICTED** — run `36618193752` exists and **failed** (`P31-1`) |
| `PHASE_29_FINAL_REPORT.md` §16 assessed as "Accurate" on CI | **CONTRADICTED** (`P31-1`) |
| Backup/restore chronology; automation/encryption/retention absent | **CONFIRMED** |
| `RELEASE_READINESS.md` time-scoped claims | **CONFIRMED** as time-scoped; one row (`:198`) stale in the opposite direction (`P31-4`) |
| "No production-readiness or staging-readiness claim is made" | **CONFIRMED** — no such claim was made, and none is made here |

### 15.3 What Phase 31 changes

1. **The repository's CI is red on `origin/main`, and this was knowable.** Two root causes,
   both proven from run logs, both with the remedy already present in the working tree and
   uncommitted. This converts blocker `E-9` from "awaiting an external environment" to "a
   known-failing repository with two repository-fixable defects".
2. **The five independent-review gaps are confirmed open**, and this review cannot close any
   of them (§1.2). R-1 is real and preserved.
3. **`verify-ci-parity.mjs` has a recorded defect** — it cannot detect the failure mode it was
   built to guard against. Recorded, not repaired.
4. **The most important release-review evidence is untracked**, so the documents that would
   let a cold reviewer see the truth are precisely the documents that do not ship.

### 15.4 What Phase 31 does not do

- It does not claim, imply, or support any conclusion that this system is production ready,
  staging ready, or release ready. **It is not.**
- It assigns no score, percentage, rating, or ranking.
- It fixes nothing. `P31-1` through `P31-3` are red CI failures that remain red.
- It creates no independent review of any phase, and closes no review gap.
- It was not checked by anyone. Per §1.2 it cannot substitute for an independent party.

### 15.5 Open-item summary

| Category | Count | Detail |
|---|---|---|
| Newly discovered findings (this review) | **14** | `P31-1` … `P31-14`; 3 HIGH, 5 MEDIUM, 4 LOW, 2 INFORMATIONAL |
| — of which are CI/release-blocking | **3** | `P31-1`, `P31-2`, `P31-3` |
| Inherited Phase 30 blockers revalidated | **24** | none closed |
| Independent-review gaps remaining | **5** | Phases 22, 23, 25, 26, 27 — not closable by this review |
| External blockers remaining | **10** | E-1…E-8, E-10, plus the re-run half of E-9 |
| Repository-deferred blockers remaining | **8** | R-1…R-6, E-11 (reclassified), plus the two new CI defects |
| Accepted limitations remaining | **5** | A-1…A-5, with A-4 extended by `P31-5` |
| Hosted CI status of current `HEAD` | **FAILURE** | run `36618193752`, 2/5 jobs red, 2026-09-29T19:17:32Z |
| Local gate status | **12/12 PASS** | all unmodified; local green coexists with hosted red |
| Commit or push by this review | **NONE** | working-tree fingerprint identical before and after |

### 15.6 Should Phase 32 begin?

**Not as a further documentation or reconciliation phase.** The pattern is now clear and it is
diagnostic rather than incidental: three consecutive documentation-centric phases have
reconciled a repository state in which a *committed CI workflow references uncommitted
artifacts* and *the committed tree is verifiably red*. Documentation about the gap did not
close the gap, and on the evidence in §7 it obscured it.

Phase 32 should be scoped by the maintainer, and the following constraints follow from this
review:

1. **Nothing in this document authorises a commit, a push, a rebase, a reset, or an amend.**
   Authorisation is a maintainer decision that this review does not make.
2. **If Phase 32 proceeds, the three HIGH findings should be addressed first**, because they
   are the only findings that change what a release reviewer can conclude. `P31-2` and
   `P31-3` are commit-and-verify operations, not design work — but committing them is a
   decision about what `origin/main` asserts, and that decision is not mine.
3. **`P31-5` should be recorded as a known gate limitation at minimum.** Widening
   `verify-ci-parity.mjs` to check resolvability would give the contract the property the
   repository believes it already has. That is a design decision for the maintainer.
4. **`P31-1` and `P31-8` are documentation corrections in a tracked file.** They are recorded
   here and were deliberately **not** made, per instruction and per the repository's own
   preservation rule. Correcting them is separately authorised work that would itself want
   review.
5. **The five review gaps cannot be closed by further work in this repository.** They require
   an independent party, and §1.2 sets out why this review is not one.

### 15.7 Closing statement

The Phase 30 reconciliation is substantially honest work with one material error, and this
review records both findings without softening either. The repository's disclosure discipline
in its Phase 27–30 artifacts is genuinely good and was not in question here. The finding that
matters is narrow, factual and verifiable: **`origin/main` is red, the failure is
root-caused, the fix already exists uncommitted, and no document in the repository says so.**

No production-readiness, staging-readiness, or release-readiness claim is made by this
document, and none should be inferred from it.

---

*Phase 31 verification performed against `4ddc0b5fda231761d0708fe6dd3083a08952ca3b` with
network access to the GitHub Actions API and the npm registry. No application source, schema,
migration, CI configuration, gate, historical document, or `SECURITY_REVIEW_*` artifact was
modified. No commit, push, rebase, reset, amend, or stash occurred. No independent review
gap was closed. This document was not reviewed by any second party, and does not represent
organisational independence.*
