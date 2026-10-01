# SECURITY_REVIEW_PHASE_40.md — Independent Review of Phase 39

**Subject:** Phase 39 (F-39-01) — the dependency advisory-visibility gate
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline reviewed:** `199877aef283eff36984114ecf486eaec1554c39` — `HEAD` == `origin/main`
**Reviewed work:** **uncommitted working-tree changes** implementing Phase 37 + Phase 38 + Phase 39
**Review date:** 2026-10-01
**Nature:** Review only. No production code, dependency manifest, lockfile, CI workflow, security policy, Prisma artefact or existing report was modified. No fix was implemented. Nothing was committed, pushed, amended, rebased, reset or stashed.
**Authorisation:** Explicitly granted by the user for this phase, with a standing instruction to stop and report at any authorisation boundary.

> **NO PRODUCTION-READINESS, STAGING-READINESS, RELEASE-READINESS OR COMPLIANCE CLAIM IS MADE IN THIS DOCUMENT.** No security score, rating or ranking is assigned, and none should be inferred. No security advisory is claimed to be suppressed, allow-listed, downgraded or remediated by this review.

---

## 0. Independence disclosure — read this first

**I did not implement Phase 39.** This session began with a read-only baseline capture; I have no record of authoring any Phase 39 file, and every artefact under review was found already present and uncommitted in the working tree. All Phase 39 conclusions in this document were re-derived from the repository, the live dependency graph, the npm registry advisory database and the GitHub Actions API — **not** by reading `docs/PHASE_39_FINAL_REPORT.md` and endorsing it. I read that report only afterwards, to compare its claims against what I had already measured.

**I am nevertheless NOT organisationally independent, and this review cannot discharge an independent-review requirement.**

I am an independent verification pass *inside this repository*, on the same machine, with the same toolchain, the same git identity (`Tarangj07`), the same filesystem access and the same hosted-runner credentials as the implementation session. I cannot claim:

- separation of duties from the implementing agent;
- independence from the repository owner, who also commissions this review;
- an audit function distinct from the party under review; or
- independence in the sense an external auditor or a separate organisation would provide.

What this review *does* rest on, and what a reader may weigh accordingly:

- I did not implement Phase 39 and made no repository modification whatsoever — verified by SHA-256 comparison of every protected artefact before and after (§15).
- I re-derived the finding from primary sources rather than from any prior report.
- I attacked the controls adversarially in throwaway mirrors and disposable git repositories, all outside the repository.
- I discarded every result whose failure reason was unrelated to the security property under test, and I discarded one of my own results and reran it (§6.2, §7.2).
- **The prior review chain has the same limitation.** `SECURITY_REVIEW_PHASE_37.md` §2 discloses the identical framing. A reviewer requiring organisational independence must obtain a review from a party outside this repository and session. **This review does not close that requirement for Phase 39, and I am not going to describe it as though it did.**

---

## 1. Scope and authorisation

**In scope.** Independent verification of Phase 39's F-39-01 claim; the new `verify-dependency-advisory-visibility.mjs` control; the new `mutate-dependency-advisory-visibility.mjs` harness; the Phase 39 CI additions in `.github/workflows/ci.yml`; the Phase 39 parity registrations in `scripts/verify-ci-parity.mjs`; the supply-chain boundary Phase 39 asserts and declines to assert; the relationship to `next@14.2.35` and the Phase 35/36 image-optimizer mitigation; regression of the existing gates; hosted-CI status; and the review-gap history.

**Out of scope and untouched.** Container-image rebuilds. R36-01, R36-02, R36-04 (Phase 36 findings not remediated by Phase 37). Remediation of any dependency advisory, including the 44 below the triage threshold. Any upgrade of `next`. Any change to the four-file dependency-floor trust boundary documented in Phases 37–38.

**Protected artefacts checksummed before and after.** `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json`, `apps/api/package.json`, `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`, `scripts/triage-vulnerabilities.mjs`, `scripts/verify-dependency-security-floor.mjs`, `scripts/verify-dependency-floor-policy.mjs`, `security/dependency-security-floor.json`, all 21 `SECURITY_REVIEW_*.md` files, all 37 `docs/PHASE_*` files, `apps/api/src/**`, `apps/web/**` (excluding `node_modules`, `.next`), `apps/mobile/**`, `packages/**` (excluding `node_modules`, `dist`), `apps/api/prisma/**` (schema, migrations, seed), and `security/**`. **263 files. All byte-identical after review** (§15).

---

## 2. Baseline repository state

| Item | Observed |
|---|---|
| Branch | `main` |
| `HEAD` | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` — **identical to HEAD** |
| Newest commit | `199877a phase(36): record the final report` |
| Modified (unstaged) | `.github/workflows/ci.yml`, `scripts/mutate-dependency-security-floor.mjs`, `scripts/verify-ci-parity.mjs`, `scripts/verify-dependency-security-floor.mjs` |
| Untracked | 10 `SECURITY_REVIEW_*.md`, 12 `docs/PHASE_*`, `scripts/verify-dependency-advisory-visibility.mjs`, `scripts/mutate-dependency-advisory-visibility.mjs`, `scripts/verify-dependency-floor-policy.mjs`, `scripts/mutate-dependency-floor-policy.mjs`, `security/` |
| Node / pnpm / git | v24.18.0 / 11.25.0 / 2.53.0 |

**Load-bearing baseline fact: the entire Phase 37 + Phase 39 change set is uncommitted, and `HEAD` equals `origin/main`.** Phase 39 has therefore never been on a runner, and the gates it registers cannot resolve on a clean checkout. This is not a defect introduced by Phase 39 — it is the state of the tree — but it is the single most consequential fact in this report and it is self-detected by the repository's own parity gate (§8.3).

**Developer database state (recorded, not modified).** `DATABASE_URL` → `ecc-postgres` container, user/db `ecc`. Fingerprint: **37 tables** in `public`, content hash **`461d1a250b11449a2d9ebb153128528c`**, **2** `_prisma_migrations` rows, latest `2026-09-14 20:26:22.709031+00`, all tables empty. Port 5432 is not published to the host; access was read-only via `docker exec … psql`. Re-verified unchanged at §15.

**Throwaway infrastructure already present before this review (not created by me).** `pg-pgtest` (postgres:16-alpine, up 13h at baseline), plus the developer stack `ecc-postgres` / `ecc-redis` / `ecc-minio` (up 7–8h). No throwaway worktree or mirror existed at baseline; `git worktree list` showed only the primary working tree.

**Cleanup trap.** Established before any temporary resource was created: `/tmp/opencode/p40/cleanup-trap.sh`, which removes every `mirror-*` / `wt-*` directory under the review scratch root, runs `git worktree prune`, and is idempotent. Executed at §15.

**Advisory counts by severity at baseline.** `pnpm audit --json` → **92** advisories: **4 critical, 44 high, 36 moderate, 8 low** (info 0). `pnpm audit --audit-level=high --json` → **48** (44 high + 4 critical).

---

## 3. F-39-01 reproduction

I reproduced the finding from the repository and the live dependency graph. The numbers below are mine, measured before I read the Phase 39 report.

### 3.1 The two filters, located in source

1. `scripts/triage-vulnerabilities.mjs:831` — `spawnSync('pnpm', ['audit', '--audit-level=high', '--json'], …)`. The severity threshold is applied by the **package manager**, so sub-threshold advisories are absent from the JSON document before the triage script reads it.
2. `scripts/triage-vulnerabilities.mjs:846` — `.filter((a) => a.severity === 'critical' || a.severity === 'high')`.

### 3.2 Measured counts

| Query | Result |
|---|---|
| `pnpm audit --json` | **92** advisories — 4 critical, 44 high, 36 moderate, 8 low |
| `pnpm audit --audit-level=high --json` | **48** advisories — 44 high, 4 critical |
| Advisories hidden by the `--audit-level=high` filter | **44** — exactly 36 moderate + 8 low |
| `scripts/triage-vulnerabilities.mjs` on the current graph | exit **0**; reports "advisories reported by pnpm audit : 48", "critical or high : 48" |

**F-39-01's headline claim reproduces exactly:** 44 of 92 advisories reach no gate because of two independent severity filters.

### 3.3 Advisories 1240100 / 1240101 — verified independently

Neither advisory appears in the current audit at all, because Phase 33's overrides have already excluded them. I therefore verified their existence and severity against the **npm registry bulk advisory endpoint**, not against any repository file:

```
POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
{"brace-expansion":["1.1.20","2.1.6"],"undici":["6.28.0","2.1.6"]}
```

| ID | Module | Severity | CVSS | CWE | Vulnerable range |
|---|---|---|---|---|---|
| 1240100 | `brace-expansion` | **moderate** | 5.3 | CWE-400, CWE-407 | `<1.1.21` |
| 1240101 | `brace-expansion` | **moderate** | 5.3 | CWE-400, CWE-407 | `>=2.0.0 <2.1.7` |

Both are **moderate**, both are algorithmic-complexity / ReDoS, and both therefore sit **below both filters**. Phase 39's central factual premise is correct and independently confirmed.

### 3.4 Does lowering the floor to the Phase-34 versions bring them back? — Yes

In an isolated mirror (throwaway copy of the tree, `node_modules` symlinked read-only, real repository untouched), I lowered the two `brace-expansion` overrides in `pnpm-workspace.yaml` to `1.1.20` / `2.1.6` and regenerated the lockfile with `pnpm install --lockfile-only`:

- `pnpm-lock.yaml` resolved `brace-expansion@1.1.20` and `brace-expansion@2.1.6` (confirmed in the lockfile `overrides:` and package sections).
- `pnpm audit --json` → **94** advisories: 4 critical, 44 high, **38 moderate**, 8 low.
- **1240100 and 1240101 are present, both moderate — and neither appears in the `--audit-level=high` report.**
- `grep` of the triage output for `brace-expansion` → **0 occurrences**. For `1240100|1240101` → **0 occurrences**.

This is the decisive proof: in the reproduced R36-03 graph the two advisories Phase 33 deliberately remediated are present in the resolved graph and appear in the output of no gate.

### 3.5 Reviewer-harness limitation, disclosed

In my mirror, `triage-vulnerabilities.mjs` exited **1**, not 0. Cause: two `postcss` advisories were classified "REACHABLE (untraced)" with the evidence string *"neither the built standalone tree nor the installed `next` package was available"*. My mirror excludes `dist/` and `.next/`. **This is an artefact of my harness, not a security signal**, and I discard it rather than counting it. Consequently I verified the "all six dependency gates exit 0" sub-claim only for the gates I could exercise cleanly — see §5.2 — and I mark the full six-gate claim **PARTIALLY VERIFIED**.

---

## 4. The new advisory-visibility gate — unmodified run

Unmodified `scripts/verify-dependency-advisory-visibility.mjs` against the current graph:

```
EXIT=0
6 check(s): 5 passed, 1 failed → 0 failed
```

All six checks pass. The gate reports that the full advisory set was observed (92), that **no advisory exists against `brace-expansion` or `undici`**, and it enumerates the 44 sub-threshold advisories by package as recorded-not-suppressed. **The control passes on the current graph, as claimed.**

---

## 5. R36-03 reproduction against the gate

### 5.1 Scenario V1 — overrides lowered only

Lockfile resolves `brace-expansion@1.1.20` / `2.1.6`; floor policy untouched.

| Gate | Exit | Correct? |
|---|---|---|
| `verify-dependency-security-floor.mjs` | 1 | yes — 2 resolved instances below floor |
| `verify-dependency-floor-policy.mjs` | 1 | yes — 2 floors no longer justified |
| `verify-dependency-advisory-visibility.mjs` | **1** | yes — names **1240100 (moderate) brace-expansion** and **1240101 (moderate) brace-expansion** |

### 5.2 Scenario V2 — the coordinated R36-03 edit (the real condition)

Policy floors **and** workspace overrides **and** lockfile lowered together, which is the documented Phase 37–38 boundary:

| Gate | Exit | Note |
|---|---|---|
| `verify-dependency-security-floor.mjs` | **0** | green |
| `verify-dependency-floor-policy.mjs` | **0** | green |
| `verify-dependency-advisory-visibility.mjs` | **1** | fails, naming 1240100 and 1240101 |
| `triage-vulnerabilities.mjs` | 1\* | \*mirror artefact (§3.5); emits **zero** rows for `brace-expansion` and **zero** occurrences of either advisory id |

### 5.3 What this establishes — a genuinely new independent oracle

**This is the strongest verified result in the review.** In the full coordinated edit that Phases 37–38 measured as an accepted trust boundary, the two Phase-37 gates are green and the new Phase-39 gate is red, naming the exact floored package and advisory. The gate's failure is not an artefact of the audit command failing: the same invocation observes 94 advisories and reports 5 of 6 checks OK.

**This attack did not reproduce from the audit command failing** — verified by the gate's own output, which parses and reports the advisory set before asserting.

**Caveat, and it matters.** This new oracle holds only while the gate's own `pnpm audit` invocation is unfiltered *and* unmutated. §6 and §7 show that (a) a partial severity filter defeats it, and (b) no mutation test protects it. The contribution is real but its own integrity is currently unguarded.

---

## 6. Filtering / fail-closed attacks (WS3)

**Reviewer harness:** `/tmp/opencode/p40/ws3-harness.mjs` — written independently, outside the repository, sharing no code with the Phase 39 harness. It builds a throwaway mirror per test, changes **one** property per test, and classifies each outcome. A test whose output matches a setup signature (crash, missing module, ENOENT) is `SETUP-DISCARDED` and is **never** counted as a detection.

**Result: 19 tests — 12 DETECTED, 5 correctly TOLERATED, 2 genuine ESCAPES.**

| ID | Attack | Expected | Result |
|---|---|---|---|
| W3-00 | control: real advisories, none against a floored package | pass | TOLERATED |
| W3-01 | empty advisory report | fail | **DETECTED** ("not empty" / "zero advisories") |
| W3-02 | missing `advisories` field | fail | **DETECTED** ("advisory set") |
| W3-03 | missing `severity` on a floored-package advisory | fail | **DETECTED** (still reported) |
| **W3-04** | **moderate advisories removed from the report (partial trim)** | fail | **ESCAPE** — see F-40-01 |
| W3-05 | critical/high advisories removed | pass | TOLERATED |
| W3-06 | report containing only high/critical | pass | TOLERATED |
| W3-07 | report containing unrelated packages | pass | TOLERATED |
| **W3-08** | **floored package present but advisory omitted** | fail | **ESCAPE** — see F-40-04 |
| W3-09 | floored package + moderate advisory | fail | **DETECTED** (names 1240100-class id) |
| W3-10 | floored package + low advisory | fail | **DETECTED** (names the id) |
| W3-11 | multiple floored packages hit at once | fail | **DETECTED** (names both ids) |
| W3-12 | duplicate advisory ids | fail | **DETECTED** |
| W3-13 | duplicate floor entries in the policy | pass | TOLERATED (de-duplicated by `Set`) |
| W3-14 | malformed structure (`advisories` is a string) | fail | **DETECTED** |
| W3-15 | non-zero audit exit with syntactically valid output | fail | **DETECTED** (adjudicates rather than bailing) |
| **W3-16** | **audit failure, empty stdout** | fail | **DETECTED** — after harness fix, see §6.2 |
| **W3-17** | **audit failure, stale/garbage stdout** | fail | **DETECTED** — after harness fix, see §6.2 |
| W3-18 | unexpected severity values (`"SEVERE"`, numeric `7`) | fail | **DETECTED** (both ids named) |

**W3-18 is worth stating explicitly:** the gate treats severity as opaque when *matching*, so a floored-package advisory is reported regardless of severity value. That is the correct fail-closed behaviour and it is the property F-39-01 depends on.

### 6.1 The two escapes

**W3-04 — partial severity filter (F-40-01).** Removing all 36 moderate advisories leaves 56 non-empty advisories, and the gate **passes**. I then narrowed this to the realistic case: a filter that drops only the `low` tier, i.e. `--audit-level=moderate`, yielding **84 of 92** advisories — also non-empty, also **passing**. Control: the same filtered report *plus* a `low` advisory against floored `undici` correctly **fails** and names it. So the gate detects a `low` advisory it can see, and is blind to one a partial filter removed.

**W3-08 — floored package present, advisory omitted (F-40-04).** `verify-dependency-advisory-visibility.mjs:197-201` checks only `existsSync(lockPath)`; the lockfile's contents are **never read**. The check therefore cannot corroborate anything, and the gate passes vacuously when a floored package is absent from the graph. Mitigating: `verify-dependency-security-floor.mjs` *does* parse the lockfile and records an absent floored package as a deliberate `REMOVED` end state. This is defence-in-depth, not a control break.

### 6.2 Reviewer-harness defects — disclosed, evidence discarded, rerun

Two defects in **my own** harness, both corrected and both affected results discarded and rerun:

1. **W3-16 / W3-17 first attempt scored WRONG-REASON.** I asserted the substring `parseable`, which belongs to the *live*-`pnpm audit` code path. Under `--audit-file` the gate correctly fails closed via `the audit report is readable`. The gate was right and my expectation was wrong. Fixed and rerun: both **DETECTED**.
2. **WS4 `R-PARSE-SWALLOWED` first attempt did not exercise the parse path.** I wrote the fixture via `JSON.stringify(null)` = `null`, which parses successfully, so the mutated branch was never reached; the observed pass was meaningless and is discarded. Corrected to write genuinely unparseable bytes (`<<NOT JSON AT ALL>>`): exit **1**, caught by the empty-advisory-set check — i.e. the parse-error path is defended in depth by a second layer.

**No finding in this document rests on a discarded result.**

---

## 7. Mutation-harness audit (WS4)

### 7.1 Phase 39 harness, as shipped

`node scripts/mutate-dependency-advisory-visibility.mjs` → **EXIT 0**. 11 throwaway mirrors removed. Reported tally: **10 applied, 9 detected, 1 correctly tolerated, 0 escapes, 0 discarded**. Post-condition: all five protected files byte-identical. I independently reproduced this result.

**I do not accept the reported count as evidence of coverage.** I verified what the harness actually varies: it writes only to the audit fixture, the floor policy and the workflow file. **No mutant writes to the gate's own source** (`scripts/verify-dependency-advisory-visibility.mjs`). Confirmed by inspection of every mutation site. The `isParseableJs` guard at line 459 is dead code for this harness — nothing ever mutates the gate, so there is nothing to guard. Consequently every code path that *decides* the property under test is untested by it.

### 7.2 My own mutations of the gate source

`/tmp/opencode/p40/ws4-harness.mjs` — 11 mutations, each with a uniqueness-checked single anchor, each discarded if it merely crashes the gate.

| ID | Attack on the gate source | Result | Meaning |
|---|---|---|---|
| R-SEV-CONST | narrow `BELOW_THRESHOLD_SEVERITIES` to `['moderate']` | TOLERATED | **The docstring's stated coverage is false** — F-40-02 |
| **R-SEV-ASSERT** | **restrict the assertion to `critical`/`high`** | **ESCAPE** | **the original blind spot, unguarded** — F-40-02 |
| **R-SEV-ASSERT-HIGH** | **exclude `moderate`/`low` from the assertion** | **ESCAPE** | same, second form — F-40-02 |
| **R-PKGMATCH** | **corrupt the package-name comparison** | **ESCAPE** | package matching unguarded — F-40-02 |
| R-PKG-STARTSWITH | loosen matching to `startsWith` | REJECTED (exit 1) | confirms shipped matching is **exact** |
| R-FLOOR-IGNORE | drop the floor-set filter | REJECTED (exit 1) | confirms the floor filter is load-bearing |
| R-EMPTY-TOLERATED | tolerate an empty advisory set | ESCAPE (expected) | confirms empty-report guard is load-bearing |
| R-NOADV-TOLERATED | tolerate a missing `advisories` key | crash (TypeError) | fails closed, but by **crash**, not a recorded finding |
| R-PARSE-SWALLOWED | swallow a JSON parse error | **DETECTED** (2nd layer) | corrected; parse path defended in depth |
| R-NOFLOOR-TOLERATED | tolerate an empty floor policy | ESCAPE (expected) | confirms vacuous-contract guard is load-bearing |
| R-COUNT-NOTCHECKED | partial severity filter | TOLERATED | **confirms F-40-01** |

**Unintended escapes: 3** (R-SEV-ASSERT, R-SEV-ASSERT-HIGH, R-PKGMATCH). **Expected escapes: 2.** **Rejections confirming load-bearing guards: 2.** **Fail-closed-by-crash: 1.**

**The critical observation:** R-SEV-ASSERT and R-SEV-ASSERT-HIGH re-introduce *precisely* the defect F-39-01 was raised to close — a critical/high-only severity filter inside the assertion — and the control passes. No shipped mutation test detects either. The one property this gate exists to protect is the one property with no mutation coverage.

---

## 8. CI integration and parity verification (WS5)

### 8.1 Structural verification — parsed YAML, not grep

`.github/workflows/ci.yml` parsed with the same `yaml@2.9.0` the parity contract uses:

- **Exactly one** CI step invokes the visibility gate: job `api`, step index 19.
  - `run`: `node scripts/verify-dependency-advisory-visibility.mjs` — exact, and **deliberately without `--audit-file`** (a CI step using the fixture flag would assert against a saved document instead of the live graph).
  - `if`: **absent**. `continue-on-error`: **absent**. `working-directory`: **absent** (resolves to repo root — correct).
  - `env`: **absent**. The gate needs none of the job's `DATABASE_URL` / `JWT_ACCESS_SECRET` / `NODE_ENV`.
  - No `|| true`, no `set +e`, no `&& exit 0`, no `2>/dev/null || true` on this step.
- **Job placement and ordering:** `actions/setup-node@v4` at step 2, `pnpm install --frozen-lockfile` at step 3, gate at step 19 — the dependency install **precedes** the gate, so it cannot be skipped by an install failure.
- **No duplicate or shadow gate.** The only other reference is `node scripts/mutate-dependency-advisory-visibility.mjs` in the `release` job at index 20.
- No workflow-level `defaults.run.shell` or job-level conditional wraps the gate.

**Pre-existing suppressions in the same job, unrelated to Phase 39 and reported for completeness:** `API lint` carries `continue-on-error: true`; two storage-probe steps contain `|| true`. Neither touches the visibility gate.

### 8.2 Parity contract

`node scripts/verify-ci-parity.mjs --list` → **EXIT 1**, four problems, all untracked-target findings:

- `scripts/verify-dependency-floor-policy.mjs` (Phase 37) — not tracked
- **`scripts/verify-dependency-advisory-visibility.mjs` (Phase 39) — not tracked**
- `scripts/mutate-dependency-floor-policy.mjs` (Phase 37) — not tracked
- **`scripts/mutate-dependency-advisory-visibility.mjs` (Phase 39) — not tracked**

The contract states the consequence precisely: *"A clean checkout — which is what a CI runner sees — will not contain it, so this step cannot work there even though it works in this working tree."* **This finding was correctly detected and correctly not suppressed.** I did not suppress it, and I am not reporting the gate as green.

### 8.3 Hosted CI vs local — the distinction this phase requires

| Claim | Status |
|---|---|
| Phase 39 gates pass on the current graph, locally | **LOCAL PASS — verified** (§4) |
| Phase 39 gates have executed on a GitHub Actions runner | **HOSTED CI UNVERIFIED** (§12) |

---

## 9. CI / parity mutation testing (WS6)

**Reviewer harness:** `/tmp/opencode/p40/ws6-harness.mjs` — 17 attacks, each in a **throwaway git repository** (so `untrackedTargetProblem()` exercises its real code path rather than erroring on a non-repo). The real repository was never written to.

**Result: 11 DETECTED, 2 correctly TOLERATED, 3 ESCAPE, 1 SETUP-DISCARDED (rerun separately, §9.2).**

| ID | Attack | Result |
|---|---|---|
| P00 | unmutated committed mirror | TOLERATED (parity exit 0) — positive control |
| P01 | delete the CI gate step | **DETECTED** |
| P02 | append `--json` to the command (command drift) | **DETECTED** |
| P03 | rename the **step name** only | ESCAPE — **legitimate positive control** (see §9.3) |
| P04 | point the command at a nonexistent script | **DETECTED** |
| P05 | replace the command with a different existing script | **DETECTED** |
| P06 | remove the p39 parity registration | SETUP-DISCARDED → rerun, §9.2 |
| P07 | alter `REQUIRED_GATE_IDS` | **DETECTED** (length mismatch) |
| P08 | **coordinated** CI + parity edit | TOLERATED — **legitimate positive control**, §9.4 |
| P09 | implementation script present but untracked | **DETECTED** ("NOT tracked by git") |
| P10 | command commented out, name kept in a comment | **DETECTED** |
| **P11** | **command hidden behind `if: false`** | **ESCAPE** — F-40-05 |
| **P12** | **command hidden behind an always-true condition** | **ESCAPE** — F-40-05 |
| P13 | `continue-on-error: true` on the gate step | **DETECTED** |
| P14 | `\|\| true` appended | **DETECTED** |
| P15 | `set +e` before the gate | **DETECTED** |
| P16 | remove the mutation-harness CI step | **DETECTED** |

### 9.1 Pre-existing scope of the `if:` gap

I confirmed F-40-05 is **not introduced by Phase 39**: wrapping the Phase-28-era `verify-ci-parity.mjs --list` step in `if: false` also leaves parity **exit 0**. The parity contract checks `continue-on-error`, `set +e`, `\|\| true`, `\|\| :`, `\|\| echo`, `&& exit 0` and `2>/dev/null \|\| true` — but has **no `if:` check at all**. The shipped Phase 39 step has no conditional (§8.1), so there is **no current exposure**; this is a latent gap in the parity contract itself.

### 9.2 P06 rerun — dropping the parity registration

My first attempt sliced the file badly (a syntax error), correctly classified `SETUP-DISCARDED` and **not** counted. Rerun cleanly: removing **both** p39 registration objects **and** both p39 IDs from `REQUIRED_GATE_IDS` leaves parity **exit 0**, because the internal length-consistency check compares the two lists to each other and both were shortened together. This is R36-02's documented shape — a coordinated edit of both required-gate lists — recorded as an accepted limitation in Phases 37–38. **Preserved as a trust boundary, not reported as a new defect.**

### 9.3 P03 — step-name rename is not a defect

I checked the p39 gate entries: the contract fields are `id`, `gate`, `why`, `target`, `exactCommand`. There is no `name` field. Parity matches on `step.run`. **Step names are documentation, not the security property**, so tolerating a rename is correct. My initial expectation was wrong; reclassified as a positive control.

### 9.4 P08 — coordinated CI + parity edit

Renaming the command in **both** ci.yml and parity keeps parity green. This is exactly the Phases 37–38 four-file coordinated-edit trust boundary, which this review is instructed to preserve. **Correct behaviour of a contract that cannot be self-protecting.**

---

## 10. Supply-chain / policy boundary (WS7)

I classified each layer the review brief names, and tested that Phase 39 does not overreach into any of them.

| Layer | What it establishes | Phase 39's relationship |
|---|---|---|
| 1. Advisory visibility | an advisory exists and is observable | **ADDRESSED.** This is the whole of the gate's purpose. |
| 2. Floor enforcement | resolved version ≥ declared floor for floored packages | **NOT re-implemented.** Phase 39 reads the same `security/dependency-security-floor.json` but does not adjudicate versions. |
| 3. Reachability triage | a vulnerable code path is reachable from a deployed entry point | **NOT touched.** `triage-vulnerabilities.mjs` remains critical/high-only. |
| 4. Actual dependency remediation | the vulnerable package is upgraded | **NOT claimed, NOT done.** |
| 5. Lockfile modification | the resolved graph changed | **NOT performed by this review.** |

**Verified: Phase 39 does not claim to remediate anything.** The gate's own code comments and the Phase 39 report both state the remainder is recorded, not adjudicated. The gate emits exactly one `FAIL`-capable assertion — "no advisory exists against a package the security floor claims to remediate" — and the sub-threshold count is always recorded as `OK`, never as a pass claim. **I found no false claim that moderate, high or critical advisories have been remediated.**

**Reproduced, as instructed, without performing them.** The 44 sub-threshold advisories (36 moderate + 8 low) sit outside every floor. Phase 39 records that remediating them requires dependency upgrades — including `next` 14.2.35 → 15.5.x — and therefore a lockfile change. My own measurement corroborates the scale: 19 reachable sub-threshold advisories across 11 packages appear in the gate's own report. **I performed no upgrade and modified no lockfile.** The real `pnpm-lock.yaml` checksum is unchanged (§15).

**One boundary statement deserves challenge.** The gate's PASS text and the CI comment both say it "observes the FULL advisory set". Per F-40-01 that is **stronger than what is enforced**. It observes whatever the package manager returns; it cannot detect a filter applied upstream of it.

---

## 11. Next / image-optimizer relationship (WS8)

I verified the five claims the brief requires be kept separate.

| Claim | Established by | Verified here |
|---|---|---|
| **Advisory existence** | `pnpm audit --json` | **Yes.** `next@14.2.35` carries **23** advisories: 2 critical, 8 high, 11 moderate, 2 low. |
| **Package presence** | `pnpm-lock.yaml` | **Yes.** `next@14.2.35` resolved (lockfile lines 5012, 12541). |
| **Reachability** | `triage-vulnerabilities.mjs` | **Partially.** The critical image-optimizer RCE (1193733) is dispositioned *not reachable* with cited evidence. |
| **Endpoint exposure** | runtime probe | **Yes.** The image-optimization endpoint returns **404** for both a local and a remote URL; the shipped image records the optimizer as disabled. |
| **Runtime mitigation** | `apps/web/next.config.mjs:48-49` | **Yes.** `images.unoptimized: true`. |

**Critical separation, confirmed:** `next` is **not** under any dependency-security floor (floored packages are `brace-expansion` and `undici` only). The Phase 39 gate therefore **does not adjudicate any of the 23 `next` advisories**, and its M-PASS positive control explicitly tolerates a moderate `next` advisory. Meanwhile the Phase 35/36 control mitigates the **image-optimizer endpoint specifically** — one advisory (1193733), by runtime configuration, **not by remediation**.

**"Advisory visible" is not collapsed into "vulnerability exploitable" anywhere in Phase 39.** The gate counts `next`'s 13 moderate/low advisories as recorded open work; the Phase 36 gate proves the optimizer endpoint is unreachable. Neither claims the other. The remaining 22 `next` advisories — including 1 further critical (1193677, Windows-hosted RCE) and 8 high — are **not** covered by the image-optimizer mitigation and remain open, unadjudicated at sub-threshold and triaged at high. I did not upgrade `next`.

---

## 12. Hosted-CI status (WS11)

`gh` 2.46.0 present and authenticated as `Tarangj07` with scopes `gist, read:org, repo, workflow`.

**A real GitHub Actions run exists for the exact HEAD:**

| Field | Value |
|---|---|
| Run ID | **36714434566** |
| Workflow | `CI` |
| headSha | `199877aef283eff36984114ecf486eaec1554c39` — **exactly HEAD** |
| Event | `push` |
| Created / updated | 2026-09-30T12:23:43Z / 12:29:42Z |
| Conclusion | **success** (all 5 jobs) |

**But it does not cover Phase 39.** I enumerated every step of every job. The API job's last supply-chain step is #20 *"Supply chain — the dependency security floor is enforced (Phase 36 P34-1)"*, then #21 API unit tests. The Release job's last dependency mutation is #21 *"Mutation — the dependency floor detects a lowered remediation (Phase 36)"*. **There is no Phase 37 floor-policy step and no Phase 39 advisory-visibility step in either job** — because the run predates the uncommitted working tree.

**Distinguishing the two states, as required:**

- **HOSTED CI VERIFIED** — for `199877a` as committed: the Phase 36 gate set, 5/5 jobs green, every listed step `success`, no skipped Phase 36 steps.
- **HOSTED CI UNVERIFIED** — for Phase 39. No runner has ever executed `verify-dependency-advisory-visibility.mjs` or `mutate-dependency-advisory-visibility.mjs`. **I do not call CI green for Phase 39, and local parity success is not substituted for it.** Log inspection was performed on the step list; no Phase 39 step exists to inspect.

---

## 13. Review-gap status (WS12)

### 13.1 Existence matrix

| Phase | `SECURITY_REVIEW_PHASE_*.md` | `docs/PHASE_*_FINAL_REPORT.md` | Independently reviewed? |
|---|---|---|---|
| 22 | **ABSENT** | present | **GAP — no review exists** |
| 23 | **ABSENT** | absent | **GAP — no review exists** |
| 25 | present | present | **Qualified** — author states *"not fully independent"* (did not implement Phase 25, but did implement Phase 26 and asserted F-1…F-5 during it) |
| 26 | present | present | **SELF-REVIEWED** — own text says *"NOT independent"* / *"self-review"* |
| 27 | **ABSENT** | present (untracked) | **GAP — no review exists** |
| 32 | **ABSENT** | present | **SELF-REVIEWED** — via `SECURITY_REVIEW_PHASE_34.md`, whose header states *"THIS DOCUMENT IS NOT AN INDEPENDENT REVIEW … the reviewer of this document is the same agent that implemented Phases 32 and 33"* |
| 33 | **ABSENT** | present | **SELF-REVIEWED** — same document, same self-disclosure |
| 34 | present | absent | Reviewed (self-review of Phase 34's own work disclosed) |
| 35 | present | absent | Reviewed; *"not fully independent"*, because the author implemented Phase 32 |
| 36 | present | present | Reviewed; *"I did not implement Phase 36"*; itself lists Phase 32 as **SELF-REVIEWED** |
| 37 | present | present | Reviewed; *"not fully independent"* on the §2 grounds I have reproduced in §0 |
| 38 | **ABSENT** | present | **GAP — no review exists** |
| 39 | **this document** | present | Reviewed, **not organisationally independent** (§0) |

### 13.2 Gaps I am explicitly not closing

- **Phase 26, 32, 33** remain open. A self-review cannot close a review gap, however thorough. I have not re-classified any of them as covered.
- **Phases 22, 23, 27, 38** have **no review document at all**. Absence of a review is a gap, not a pass.
- **Every review in this chain, including this one, is non-independent in the organisational sense.** The Phase 37 framing — same repository, machine, toolchain, git identity and runner credentials — applies unchanged to Phase 40.
- **Structural cause, stated plainly:** the gaps are not incidental. They are what happens when the same party implements a phase and reviews it, with no CODEOWNERS, no branch protection and no required independent approval in place. Closing them requires a reviewer external to this session, which is outside my authority.

---

## 14. Findings

Severity is assigned from evidence only. No score or rating is implied.

### F-40-01 — MEDIUM — a partial severity filter defeats the new gate, which advertises full-set visibility

**Evidence.** W3-04; WS4 `R-COUNT-NOTCHECKED`; and a two-sided control run against a fixture equal to `pnpm audit --audit-level=moderate`:

| Fixture | Advisories | Gate exit |
|---|---|---|
| partial filter, no floored-package advisory | 84 of 92 | **0 — PASS**, printing *"the FULL advisory set was observed"* |
| same filter **plus** a `low` advisory against floored `undici` | 84 | **1 — FAIL**, naming `9000020 (low) undici` |

The gate detects only a **total** filter (an empty report, W3-01). A **partial** filter leaves the report non-empty and passes. A `low`-severity advisory against a floored package, removed by such a filter, is invisible.

**Contradicted claims.** `scripts/verify-dependency-advisory-visibility.mjs` lines 133-137 ("If `--audit-level` is ever reintroduced here … this is the check that notices"), lines 218-221, the `PASSED —` text at 323-327 ("the full advisory set was observed"); the CI comment ("observes the FULL advisory set"); and the Phase 39 report.

**Severity rationale — MEDIUM, not HIGH.** No current vulnerability exists: the current graph carries zero advisories against `brace-expansion` or `undici`, and all six dependency gates pass. Exploiting this additionally requires lowering a floor so that a sub-filtered advisory applies — a coordinated multi-file edit. It is **not** LOW because the gate's central anti-regression property is materially weaker than documented, and because that weakness silently restores the exact defect class F-39-01 was raised to close.

**Not remediated by this review.**

### F-40-02 — MEDIUM — the property F-39-01 exists to protect has no mutation coverage

**Evidence.** No Phase 39 mutant writes to the gate source (§7.1). My own source mutations: **R-SEV-ASSERT ESCAPE** (restrict the assertion to `critical`/`high`), **R-SEV-ASSERT-HIGH ESCAPE** (exclude `moderate`/`low`), **R-PKGMATCH ESCAPE** (corrupt the package comparison).

**A false statement in the shipped source.** Lines 100-103 assert:

> *"If someone narrows it to `['moderate']`, the 8 low advisories go back to being invisible — and the mutation harness M-LOW proves that, because a low-severity advisory against a floored package must be reported."*

**This is not true.** `R-SEV-CONST` narrows `BELOW_THRESHOLD_SEVERITIES` to `['moderate']` and the gate **still passes**. M-LOW passes for a different reason — the assertion ignores severity entirely — and would keep passing after the list was narrowed. The docstring attributes coverage to a constant that the assertion does not depend on.

**Severity rationale — MEDIUM.** The harness's own tally (10 applied / 9 detected / 0 escapes) is accurate for what it tests; the *docstring* overstates, and the untested property is the central one. A future edit narrowing the assertion's severity handling would pass every existing test.

### F-40-03 — LOW — "A count that changes is surfaced, not silently accepted" is not implemented

**Evidence.** The gate's line 66 states *"A count that changes is surfaced, not silently accepted."* No advisory-count baseline exists in the gate or in `security/dependency-security-floor.json` — searched for `expectedCount`, `baseline`, `expectedAdvisories`, `advisoryCount`: none. The gate prints the observed count but compares it to nothing.

This is the root cause of F-40-01: a count regression check would have detected the partial filter immediately.

### F-40-04 — LOW — the lockfile check is decorative and its message overstates what it does

**Evidence.** `verify-dependency-advisory-visibility.mjs:197-201` calls `existsSync(lockPath)` only; the lockfile's contents are never read (confirmed: `readFileSync(lockPath` does not occur in the file). The failure message nonetheless reads *"the resolved graph cannot be read, so the graph cannot be corroborated."* W3-08: with a floored package absent from the graph the gate passes vacuously.

**Mitigation.** `verify-dependency-security-floor.mjs` parses the lockfile and records an absent floored package as a deliberate `REMOVED` end state. Defence-in-depth only; the shipped message is inaccurate.

### F-40-05 — LOW — the parity contract does not detect a required gate hidden behind `if:`

**Evidence.** WS6 P11 (`if: false`) and P12 (always-true condition) both leave parity **exit 0**. `verify-ci-parity.mjs` checks `continue-on-error`, `set +e`, `\|\| true`, `\|\| :`, `\|\| echo`, `&& exit 0`, `2>/dev/null \|\| true` — and has no `if:` check. **Confirmed pre-existing and not introduced by Phase 39**: the same attack against the Phase-28-era parity step also passes. The shipped Phase 39 step carries no conditional (verified structurally), so there is **no current exposure**.

### F-40-06 — INFORMATIONAL — M-PASS2 is mislabelled as a positive control

`scripts/mutate-dependency-advisory-visibility.mjs` labels M-PASS2 *"POSITIVE CONTROL"* while declaring `expected: 'fail'` and requiring detection. It is functionally a duplicate of M-LOW (a `low` advisory against floored `undici`, id `1999005` vs `1999001`). The tally correctly reports **1** correctly-tolerated positive control; only the label and the surrounding comment are wrong. No security effect.

### F-40-07 — INFORMATIONAL — state of the repository, correctly self-detected

The whole Phase 37 + Phase 39 change set is uncommitted while `ci.yml` and the parity contract reference it. `verify-ci-parity.mjs --list` exits 1 with four untracked-target findings, two of them Phase 39's. **The repository detects this itself and the finding was not suppressed.** Recorded because until it is committed, Phase 39's gates cannot run on any runner.

---

## 15. Integrity and cleanup verification (WS13)

| Check | Result |
|---|---|
| Cleanup trap executed | `cleanup-trap.sh` run; all mirrors removed |
| Temporary mirrors / worktrees | none remain (`/tmp/ecc-p39-visibility-*`, `/tmp/p40-ws3-*`, `/tmp/p40-ws4-*`, `/tmp/p40-ws6*`, `/tmp/p40-p06-*`, `/tmp/p40-parse-*` all absent) |
| `git worktree list` | primary working tree only — unchanged from baseline |
| Throwaway containers / volumes | none created by this review; `run-db-suites.mjs` destroyed its own `ecc-p28-pg-14rpj06920e56`; no `p28-pg-*` residue |
| Pre-existing containers untouched | `pg-pgtest`, `ecc-postgres`, `ecc-redis`, `ecc-minio` — same identities, no new containers |
| Temporary databases | none remain |
| Unexpected processes | none |
| **Developer DB fingerprint** | **UNCHANGED** — 37 tables, hash `461d1a250b11449a2d9ebb153128528c`, 2 migrations, latest `2026-09-14 20:26:22.709031+00`. Byte-identical to the §2 baseline. |
| Protected-artifact checksums | **263 files, all byte-identical.** `pnpm-lock.yaml`, `pnpm-workspace.yaml`, both `package.json`, `ci.yml`, all four control scripts, `security/**`, all `SECURITY_REVIEW_*.md`, all `docs/PHASE_*`, `apps/api/src/**`, `apps/web/**`, `apps/mobile/**`, `packages/**`, `apps/api/prisma/**` |
| `git status --porcelain` | **byte-identical to the §2 baseline** |
| Files created or modified by this review | **`SECURITY_REVIEW_PHASE_40.md` only** |
| Commit / push / amend / rebase / reset / stash | **none** |

*Method note:* one checksum pass initially appeared to show `apps/api/prisma/seed.ts` as new. That was an artefact of my own differing `find` predicates (the baseline matched only `*.prisma` and `*migrations*`). `seed.ts` is tracked and unmodified against HEAD (`git diff HEAD -- apps/api/prisma/` empty). No repository file changed; no evidence was discarded on this point.

---

## 16. Regression results (WS10)

All gates run against the unmodified working tree. Exact counts as observed.

### 16.1 Dependency gates — 6/6 pass on the current graph

| Gate | Exit |
|---|---|
| `verify-dependency-audit.mjs` | **0** |
| `triage-vulnerabilities.mjs` | **0** |
| `verify-dependency-triage.mjs` | **0** |
| `verify-dependency-security-floor.mjs` | **0** |
| `verify-dependency-floor-policy.mjs` | **0** |
| `verify-dependency-advisory-visibility.mjs` | **0** |

### 16.2 Mutation harnesses

| Harness | Exit | Reported tally |
|---|---|---|
| `mutate-dependency-advisory-visibility.mjs` | 0 | 10 applied, 9 detected, 1 tolerated, 0 escapes, 0 setup-discarded |
| `mutate-dependency-floor-policy.mjs` | 0 | 23 applied, 18 detected by evaluation, 4 correctly tolerated, **1 confirmed trust-boundary escape**, 0 setup-discarded |
| `mutate-dependency-security-floor.mjs` | 0 | pass |
| `mutate-next-image-optimizer.mjs` | 0 | pass |
| `mutate-ci-integration.mjs` | 0 | pass |
| `mutate-container-gate.mjs` | — | **NOT TESTED — preserved as such** (requires container rebuilds, outside authorisation) |

The floor-policy harness's **1 confirmed trust-boundary escape is the documented Phase 37–38 boundary, preserved.** Not converted to a pass.

### 16.3 Build, typecheck, artifacts, storage

| Gate | Exit |
|---|---|
| `pnpm --filter @ecc/api typecheck` | 0 |
| `pnpm --filter @ecc/web typecheck` | 0 |
| `pnpm --filter @ecc/mobile typecheck` | 0 |
| `pnpm --filter @ecc/api build` | 0 |
| `pnpm --filter @ecc/api build:verify` | 0 |
| `pnpm --filter @ecc/web build` | 0 |
| `verify-release-artifact.mjs` | 0 |
| `pnpm --filter @ecc/api verify:storage:backup` | 0 |
| `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` (N-12) | 0 |
| `verify-config-contract.mjs` | 0 |
| `verify-next-config-features.mjs` | 0 |
| `pnpm --filter @ecc/api verify:metadata` | 0 |
| `pnpm --filter @ecc/api verify:routes` | 0 |
| `verify-next-image-optimizer.mjs` | 0 |

### 16.4 Database-backed suites — throwaway PostgreSQL only

`run-db-suites.mjs` → **exit 0**. It provisioned `ecc-p28-pg-14rpj06920e56` (database `ecc_p28_14rpj06920e56`), migrated it, ran the suites, and **destroyed it**. Its own output: *"the developer `ecc` database is not involved in this run."*

| Suite | Files | Tests | Result |
|---|---|---|---|
| `api:integration` (e2e + security) | 8 passed | **138 passed** | PASS |
| `api:all` (unit + integration) | 27 passed | **348 passed** | PASS |

**486 tests, 35 files, 0 failed, 0 skipped.**

### 16.5 Lint — reported exactly as observed; NOT reinterpreted as green

`pnpm lint` (`turbo run lint`) → **EXIT 1**. Turbo: 8 successful of 11 tasks, 5 cached; run aborted on failure.

| Package | Standalone exit | Observed |
|---|---|---|
| `@ecc/api` | **1** | **124 problems (55 errors, 69 warnings)**, `--max-warnings 0`. The CI comment *"55 pre-existing errors carried from the Phase 16 checkpoint"* is **accurate**. |
| `@ecc/mobile` | **1** | **18 problems (0 errors, 18 warnings)**, `--max-warnings 0`; 8 auto-fixable |
| `@ecc/web` | **0** | *"No ESLint warnings or errors"* standalone, yet `[ELIFECYCLE] Command failed` under turbo concurrency. **Observed discrepancy, not reinterpreted.** |

Both `api` and `mobile` lint are `continue-on-error: true` in CI. **All lint debt is pre-existing and confined to `apps/api` and `apps/mobile`; Phase 39 touched only `scripts/`, `.github/workflows/ci.yml`, `security/` and `docs/`, so none of it is attributable to Phase 39.** Lint is reported as **FAILING**, not green.

### 16.6 Docker

`verify-docker-images.mjs --skip-build` → **EXIT 0**, **58 PASS, 0 FAIL**. Verified against the **pre-existing** images built ~7h before this review; **I did not rebuild any image.** Notable passes: rate-limit refusal inside the image, authorization refusals are 403 not 429, no application path writable by uid 1000, tamper probes left no trace, `STORAGE_DIR` 0600/0700 enforced, SIGTERM graceful shutdown for API and web, home page 200, and — relevant to WS8 — the image-optimization endpoint returns 404 and the shipped image records the optimizer as disabled. `mutate-container-gate.mjs` remains **NOT TESTED**.

### 16.7 CI parity

`verify-ci-parity.mjs --list` → **EXIT 1** — four untracked-target findings (2 Phase 37, 2 Phase 39). Correctly detected, correctly not suppressed. See §8.2 and F-40-07.

---

## 17. Disposition

**Phase 39's central factual claim is confirmed.** F-39-01 reproduces exactly — 44 of 92 advisories reach no gate, and advisories 1240100/1240101 are genuinely moderate and genuinely invisible to a critical/high-only pipeline. Independently verified against the npm registry, not against any report. The gate correctly passes on the current graph, and **in the full coordinated R36-03 edit it fails while both Phase-37 gates pass, naming the exact floored package and advisory — a genuinely new independent oracle against the documented four-file trust boundary.** CI integration is structurally clean and honestly self-detecting.

**But the review does not clear Phase 39.** Three MEDIUM/LOW items bear directly on the control's central claim:

- **F-40-01** — the gate advertises full-set visibility it cannot enforce; a partial severity filter passes undetected.
- **F-40-02** — the exact property F-39-01 exists to protect has **no mutation coverage**, and the shipped docstring makes a coverage claim that is demonstrably false.
- **F-40-03** — the count-regression check the docstring describes does not exist.

Categorised, as required:

| Category | Items |
|---|---|
| **Control failure** | **F-40-01**, **F-40-02** — the gate's stated anti-regression property is weaker than documented and unprotected against source regression. The *core* assertion is sound and demonstrably works (§5.3); the defect is in the surrounding claim and its coverage. |
| **Documentation issue** | **F-40-03**, **F-40-04**, **F-40-06** — untrue or overstated claims in the gate's own comments, the CI comment and one mutation label. No runtime security effect. |
| **Accepted limitation** | 44 sub-threshold advisories remain unremediated; the four-file coordinated-edit trust boundary (Phases 37–38), re-confirmed at §9.4; `next` 14.2.35's 23 advisories, of which 22 are outside the image-optimizer mitigation. |
| **External blocker** | **Hosted CI** — Phase 39 has never run on a runner (§12). Closing this requires an authorisation to commit and push, which this phase does not carry. |
| **Repository-deferred item** | **F-40-07** — the Phase 37 + Phase 39 change set is uncommitted; the repository's own parity gate detects it. **F-40-05** — the parity contract's missing `if:` check (pre-existing, not a Phase 39 regression). |
| **Review / independence gap** | **Phases 26, 32, 33** are self-reviewed and remain open. **Phases 22, 23, 27, 38** have no review at all. **Every review in this chain, including this one, is non-independent in the organisational sense** (§0, §13.2). |

**Nothing was fixed.** No dependency was upgraded. No lockfile, CI control, security policy or application source was modified. No commit or push was made.

**Claims explicitly NOT made:** that CI is green for Phase 39 (no hosted run exists); that any of the 44 sub-threshold advisories is harmless; that any advisory has been remediated by this phase; that container-mutation coverage exists; that the four-file dependency-floor boundary is closed; that Phase 39 is approved, production-ready, staging-ready or release-ready; and that this review discharges an organisational independence requirement — **it does not.**

**Recommended next step, in order:** commit the Phase 37 + Phase 39 change set so the gates can resolve on a runner and obtain a hosted run; then remediate F-40-01/02/03 — minimally by storing an expected advisory count and comparing it, which closes both F-40-01 and F-40-03 at once, and by adding source-level mutants for the assertion's severity handling and package matching, which closes F-40-02.
