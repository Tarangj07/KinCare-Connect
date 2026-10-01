# SECURITY_REVIEW_PHASE_42.md — Independent Review of Phase 41

**Subject:** Phase 41 (F-40-01, F-40-02) — advisory-visibility completeness contract and source-mutation coverage
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline reviewed:** `199877aef283eff36984114ecf486eaec1554c39` — `HEAD` == `origin/main`
**Reviewed work:** **uncommitted working-tree changes** (Phase 37 + Phase 38 + Phase 39 + Phase 41)
**Review date:** 2026-10-01
**Nature:** Review only. No application source, dependency manifest, lockfile, CI workflow, security policy, Prisma artefact, security gate or Phase 41 implementation artefact was modified. No fix was implemented. Nothing was committed, pushed, amended, rebased, reset or stashed.

> **NO PRODUCTION-READINESS, STAGING-READINESS OR RELEASE-READINESS CLAIM IS MADE IN THIS DOCUMENT.** No security score, rating or ranking is assigned, and none should be inferred. No security advisory is claimed to be suppressed, allow-listed, downgraded or remediated by this review.

---

## 0. Independence disclosure — read this first

**Implementation independence: I did not implement Phase 41.** This session began with a read-only baseline capture. Every artefact under review was found already present and uncommitted in the working tree, and all Phase 41 conclusions in this document were re-derived from the repository, the live dependency graph, the npm registry advisory database and the GitHub Actions API — **not** by reading `docs/PHASE_41_FINAL_REPORT.md` and endorsing it. I read that report only after my own measurements were complete, to compare its claims against what I had measured.

**Organizational independence: I do NOT have it, and this review cannot discharge an independent-review requirement.**

I am an independent verification pass *inside this repository*, on the same machine, with the same toolchain, the same git identity (`Tarangj07`), the same filesystem access and the same hosted-runner credentials as the implementation session. I cannot claim:

- separation of duties from the implementing agent;
- independence from the repository owner, who also commissions this review;
- an audit function distinct from the party under review; or
- independence in the sense an external auditor or a separate organisation would provide.

**This limitation is not new and is not closable from inside this chain.** `SECURITY_REVIEW_PHASE_40.md` §0 discloses the identical framing for Phase 39, and it in turn discloses that `SECURITY_REVIEW_PHASE_37.md` §2 does. Each link in the chain repeats the same disclosure, and each link correctly declines to treat it as satisfied. **I repeat it rather than close it. A reviewer requiring organizational independence must obtain a review from a party outside this repository and session. This review does not close that requirement for Phase 41.**

What this review does rest on, which a reader may weigh accordingly:

- I re-derived every material claim from primary sources.
- I attacked the control adversarially in throwaway mirrors and disposable git repositories, all outside the repository.
- I discarded and reran **two** of my own results where my reviewer harness was defective (§9.3, §11.2).
- No crash, syntax error or no-op is counted as a detection anywhere in this document.
- `mutate-container-gate.mjs` is recorded as **NOT TESTED** (§14).

---

## 1. Scope

**In scope.** Independent verification of Phase 41's F-40-01 claim (the census completeness contract) and F-40-02 claim (source-mutation coverage); the census oracle's actual semantics in real `pnpm audit` output; the `AUDIT_ARGV` self-check; `readCensus()` / `reconcileRecordsAgainstCensus()`; each of the 7 `M41-SRC-*` source mutants; the mutation harness's own machinery; the Phase 41 CI additions and parity registrations; CI-parity mutation testing; hosted-CI status; regression of the existing gates; the supply-chain boundary; and the review-gap history.

**Out of scope and untouched.** Remediation of anything. Container-image rebuilds. Dependency upgrades. The 44 sub-threshold advisories (counted, not adjudicated). The pre-existing parity `if:` gap (§11.3). Any change to the Phase 37–38 coordinated-edit trust boundary.

**Method constraint honoured.** All controlled attacks ran against the real gate binary in mirrors under `/tmp`. The real repository was read, never written. The one file this review creates is this document.

---

## 2. Baseline

| Item | Value |
|---|---|
| `HEAD` | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` | `199877aef283eff36984114ecf486eaec1554c39` (identical to HEAD) |
| Branch | `main` |
| Node / pnpm / git | v24.18.0 / 11.25.0 / 2.53.0 |
| Docker | 29.8.1 |
| Tracked modifications at baseline | `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`, `scripts/verify-dependency-security-floor.mjs`, `scripts/mutate-dependency-security-floor.mjs` |
| Staged changes | none |
| Untracked Phase 37–41 artefacts | `scripts/verify-dependency-{advisory-visibility,floor-policy}.mjs`, `scripts/mutate-dependency-{advisory-visibility,floor-policy}.mjs`, `security/`, `docs/PHASE_{37,38,39,41}_FINAL_REPORT.md`, `SECURITY_REVIEW_PHASE_{25,26,28,30,31,34,35,36,37,40}.md` |
| Pre-existing untracked review/report files | 24 untracked entries, all listed above plus Phase 27–33 reports |
| Temporary worktrees/mirrors at baseline | none (`git worktree list` showed only the primary) |

**Protected-artefact checksums (baseline, re-verified in §18):**

```
7fa75d7c2388114a96b45b3616bc01d4f005a469367d473ed2b2b34cb018b0a8  pnpm-lock.yaml
19fe8f43efb128f81b0cc192bf0c580521d093a944eb843a8add4c69a609a16c  pnpm-workspace.yaml
1f62d7c4e73088e642575cfa12dbd60e4ba3a031eba00cd53a5ae05134450698  package.json
860bd055fad2201d3ac7295e2ccb0ec95d6bb729c25a32606123fe62490bf5fb  .github/workflows/ci.yml
a11bf953dc833b0ee26279d845c839d24dee1904e970fef89faf3f684e21c198  scripts/verify-ci-parity.mjs
677b7bd0aef8dbe201fc18629ab2a17a1d48c5ae4ed4d9eb0eb19f790132c0b9  scripts/verify-dependency-advisory-visibility.mjs
b353fd2d178432bafd7d1e27c0491c824c1ed729382b7b40659a90380cc31d04  scripts/mutate-dependency-advisory-visibility.mjs
e9d61a1a017deee65755b05fc523e60b339748b45ed69a43d60068a9c29fa7f2  scripts/triage-vulnerabilities.mjs
a36fd3e7803a7adbbdd6ac77c0f2a51053899b98ee751d447664ea6ce1d1c9be  apps/api/prisma/schema.prisma
8cb99b3568b046a0bea11a69dfcd24726cf7bcdb443bc8eebf1e74239fb009d4  (aggregate of apps/api/prisma/migrations/**)
```

**Developer DB fingerprint:** `DATABASE_URL=postgresql://ecc:…@localhost:5433/ecc`; container `ecc-postgres` (uptime 16h, healthy); 37 tables in schema `public`; 2 rows in `_prisma_migrations`; databases present: `ecc`, `postgres`, `template0`, `template1`.

**Pre-existing containers at baseline:** `pg-pgtest` (Up 21h), `ecc-minio-bootstrap` (Exited 3w), `ecc-postgres` (Up 16h), `ecc-redis` (Up 16h), `ecc-minio` (Up 16h), `unruffled_aryabhata` (Exited 3mo).

**Cleanup trap** was authored before any temporary resource was created (`/tmp/opencode/ph42/cleanup.sh`), removing reviewer mirrors, reviewer worktrees, and any container matching the reviewer-only prefix `ecc-ph42-`. It never targets the repository.

**Advisory counts recorded at baseline (genuine live runs, §3):** full 92 records / census 92; `--audit-level=moderate` 84 / 92; `--audit-level=high` 48 / 92. Severity distribution `{info 0, low 8, moderate 36, high 44, critical 4}`.

---

## 3. F-40-01 reproduction — REPRODUCED, and closure CONFIRMED

I did not begin from `docs/PHASE_41_FINAL_REPORT.md`. I read the gate source first (`scripts/verify-dependency-advisory-visibility.mjs`, 587 lines), then produced genuine audits.

### 3.1 The census is real and untruncated by severity — INDEPENDENTLY VERIFIED

| invocation | records | census | census tiers |
|---|---|---|---|
| `pnpm audit --json` | **92** | **92** | `{info 0, low 8, moderate 36, high 44, critical 4}` |
| `pnpm audit --audit-level=moderate --json` | **84** | **92** | unchanged |
| `pnpm audit --audit-level=high --json` | **48** | **92** | unchanged |
| `pnpm audit --audit-level=critical --json` | 4 | 92 | unchanged |

On the full run the census matches the per-tier record distribution exactly, tier by tier — not merely in total. Phase 41's central empirical claim is correct.

### 3.2 Gate verdicts on those genuine reports — INDEPENDENTLY VERIFIED

| report | verdict | named failure |
|---|---|---|
| full | exit **0** | 8 checks, 0 failed |
| `--audit-level=moderate` | exit **1** | `MISSING from the records: low: 8 missing` |
| `--audit-level=high` | exit **1** | `MISSING: low: 8 missing; moderate: 36 missing` |
| `--audit-level=critical` | exit **1** | `MISSING: low: 8; moderate: 36; high: 44` |

### 3.3 The Phase 40 defect, reproduced in an isolated mirror — REPRODUCED

I built `/tmp/opencode/ph42/mirror-vuln`, a full copy of the tree outside the repository, and restored the pre-Phase-33 vulnerable floors in the **mirror's** `pnpm-workspace.yaml` only:

```
'brace-expansion@>=1.0.0 <1.1.21': 1.1.20     (was 1.1.21)
'brace-expansion@>=2.0.0 <2.1.7': 2.1.6       (was 2.1.7)
```

`pnpm install --lockfile-only` in the mirror resolved `brace-expansion@1.1.20` / `2.1.6`. **The real `pnpm-lock.yaml` was never touched** (checksum verified §18).

Genuine audit of the reproduced graph:

```
records 94   census {info 0, low 8, moderate 38, high 44, critical 4}
1240100  moderate  brace-expansion  vulnerable <1.1.21       RETURNED
1240101  moderate  brace-expansion  vulnerable >=2.0.0 <2.1.7 RETURNED
```

**Advisories 1240100 and 1240101 returned as WS1 requires.** — REPRODUCED

I then reconstructed the **Phase 40** gate in the mirror by deleting exactly the Phase 41 completeness block (`readCensus` call, census record, and `reconcileRecordsAgainstCensus` call), leaving the rest of the file intact, and confirmed the reconstructed file parses:

| gate | input | verdict |
|---|---|---|
| **Phase 40 (reconstructed)** | `--audit-level=high` report from the vulnerable graph | **exit 0 — PASSED**, while 1240100/1240101 were present in the real graph |
| **Phase 40 (reconstructed)** | `--audit-level=moderate` report from the vulnerable graph | exit 1 — but only because 1240100 was *present* in that report, i.e. detected by accident, not by completeness |
| **Phase 41 (current)** | full report from the vulnerable graph | **exit 1**, naming `1240100 (moderate) brace-expansion: vulnerable <1.1.21, patched >=1.1.21` |

**Conclusion: F-40-01 is genuinely closed.** The defect is real, I reproduced it, and the new control rejects the state by name. — FINDING resolved

---

## 4. Census-oracle verification (WS2) — the most important task

### 4.1 What `metadata.vulnerabilities` actually means — SOURCE-VERIFIED

I established its semantics empirically rather than accepting the report's characterisation, because that characterisation turned out to be **partly wrong**.

Established as true:

1. **Generated from the same registry population as the records.** On the full run, census per-tier equals record per-tier exactly.
2. **Not affected by a severity threshold.** `--audit-level` in any form leaves it at 92.
3. **Independent of `advisories`.** It is a separate object; deleting `advisories` leaves it intact.
4. **Stable under the relevant filter.** `--audit-level=high|moderate|critical` all yield census 92.
5. **Sufficient to establish completeness *against a severity filter*.** Per-tier reconciliation detects every severity-tier shortfall and excess I could construct.

Established as **false** — the material discovery of this review:

6. **It is NOT a census of "the repository". It is a census of whatever package set was submitted.** A dependency-**scope** filter reduces the census **coherently**, so records and census continue to agree:

| invocation | records | census total | agrees? |
|---|---|---|---|
| `pnpm audit --json` | 92 | 92 | yes |
| `pnpm audit --dev --json` | **22** | **22** | **yes — but only 22 were submitted** |
| `pnpm audit --prod --json` | **77** | **77** | **yes — but only 77 were submitted** |

The `--dev` report's own metadata confirms the mechanism: `dependencies: 734, devDependencies: 288, totalDependencies: 1022` — versus `1091 / 383 / 1494` for the full run. pnpm resolves and audits a *different graph* and the registry census faithfully describes *that* graph. The census is an authoritative witness to **the size of the population submitted**, not to the size of the population that exists.

The Phase 41 gate header states the census is "the registry's severity CENSUS of the FULL population". For `--audit-level` that is accurate. For a scope filter it is not, and the gate's PASS text — "No severity tier is missing, so no filter was applied to this report" — is **false** in the scope-filter case, because a filter *was* applied. See Finding **P42-01**.

### 4.2 Thirty-one controlled attacks — RESULTS

Run by a reviewer harness outside the repository. **DETECTED = gate exited non-zero with a named `[FAIL]` verdict. CRASH (never counted as detection) = non-zero exit with no verdict line. ACCEPTED = exit 0.**

| # | attack | records / census | outcome |
|---|---|---|---|
| 1 | full records + full census | 92 / 92 | ACCEPTED (legitimate baseline) |
| 2 | partial records + full census (`high`) | 48 / 92 | **DETECTED** |
| 3 | full records + census reduced by 1 | 92 / 91 | **DETECTED** `low: 1 more records than the census reports` |
| 4 | partial records + matching reduced census | 48 / 48 | ACCEPTED — coordinated-edit boundary |
| 5 | records reordered | 92 / 92 | ACCEPTED (order is not a security property) |
| 6 | advisory duplicated under a new id | 93 / 92 | **DETECTED** |
| 7 | advisory value overwritten in place (same count) | 92 / 92 | **DETECTED** |
| 8 | one record's `severity` deleted | 92 / 92 | **DETECTED** `no recognised severity tier` |
| 9 | one record's severity set to `spicy` | 92 / 92 | **DETECTED** |
| 10 | census drops the `low` key entirely | 92 / 84 | **DETECTED** (absent tier read as 0 → 8 excess) |
| 11 | census declares an invented tier `catastrophic` | 92 / 92 | **DETECTED** `unrecognised tier` |
| 12 | census `high` = 44.5 (non-integer) | 92 / 92.5 | **DETECTED** |
| 13 | census `low` = −1 (negative) | 92 / 83 | **DETECTED** |
| 13b | census `low` = `"NaN"` | — | **DETECTED** |
| 14 | total correct (92), distribution wrong (low −2 / moderate +2) | 92 / 92 | **DETECTED** — *proves per-tier, not just total* |
| 15 | distribution correct, total wrong (`high` +1) | 92 / 93 | **DETECTED** |
| 16 | one record's severity reassigned high→low | 92 / 92 | **DETECTED** |
| 17 | one advisory omitted, census intact | 91 / 92 | **DETECTED** |
| 18 | `metadata.vulnerabilities` deleted | 92 / — | **DETECTED** `carries the registry severity census` |
| 19 | entire report empty + self-consistent zero census | 0 / 0 | **DETECTED** `the audit report is not empty` |
| 20 | census replaced by an array | 92 / — | **DETECTED** |
| W4-a | exactly one **moderate** removed | 91 / 92 | **DETECTED** `moderate: 1 missing` |
| W4-b | exactly one **low** removed | 91 / 92 | **DETECTED** `low: 1 missing` |
| W4-c | exactly one **high** removed | 91 / 92 | **DETECTED** `high: 1 missing` |
| W4-d | exactly one **critical** removed | 91 / 92 | **DETECTED** `critical: 1 missing` |
| W4-e | all 8 **low** removed (the F-40-01 blind shape) | 84 / 92 | **DETECTED** `low: 8 missing` |
| W4-f | all 36 **moderate** removed | 56 / 92 | **DETECTED** `moderate: 36 missing` |
| W4-g | all low **and** all critical removed | 80 / 92 | **DETECTED** `low: 8 missing; critical: 4 missing` |
| W4-h | all low removed **and** `census.low` zeroed | 84 / 84 | ACCEPTED — see §4.3 |
| W5-a | genuinely clean repository (0 advisories, zero census) | 0 / 0 | **DETECTED** — §7 |
| W5-b | clean repo + one advisory against a floored package | 1 / 1 | **DETECTED** — floor assertion still fires |

**Totals: 27 DETECTED, 4 ACCEPTED (all justified), 0 CRASH, 0 false detections.** Every failure message named the correct discrepancy (§6).

**No legitimate current report was rejected on ordering or object shape.** Attacks 1 and 5 (reordered records) are accepted; attack 7 shows shape changes that alter the per-tier distribution are correctly rejected.

### 4.3 The disclosed boundary is understated — INFO

The gate header discloses: *"An actor who rewrites both `advisories` and `metadata` to agree with each other produces a coherent report this gate cannot refute… That actor is the same party who can rewrite this control, or the lockfile, or the floor policy."*

That framing implies the boundary requires rewriting the **gate source as well**. Attacks 4 and W4-h show it does not. Rewriting **only the report's `metadata`** — no source edit, no lockfile edit, no policy edit — produces a coherent report this gate accepts with exit 0. The gate cannot distinguish such a report from a genuine full audit.

This does not change the trust model materially, because an actor who can rewrite the committed audit fixture can generally rewrite the committed lockfile too. But the disclosure as written is **narrower than the truth**, and a reader assessing the census's authority from the header alone would over-estimate it. Recorded as **INFO**, not a control defect. See Finding **P42-03**.

### 4.4 Audit command fails but emits plausible stdout — LEGITIMATE ACCEPTANCE

Using a fake `pnpm` on `PATH` (outside the repo):

- exits 1 with a **filtered** report on stdout → gate **exit 1**, names the shortfall. Correct.
- exits 1 with the **full genuine** report on stdout → gate **exit 0**. This is **legitimate**: `pnpm audit` exits non-zero precisely *because* it found vulnerabilities, which is this repository's normal state. The gate reads `if (res.status !== 0 && !res.stdout?.trim())` — a non-zero exit *with* output is treated as a report, which is correct. Not a defect.

---

## 5. AUDIT_ARGV self-check verification (WS3) — FINDING

The self-check at `verify-dependency-advisory-visibility.mjs:337-348` matches tokens against `['--audit-level','--severity']`, including the `--flag=value` form.

### 5.1 Every severity-threshold form is DETECTED

All run **LIVE** (the gate's own `spawnSync` path) in a mirror:

| mutation | verdict | argv self-check |
|---|---|---|
| `['audit','--json','--audit-level','high']` | **DETECTED** exit 1 | FIRED |
| `['audit','--json','--severity=high']` | **DETECTED** exit 1 | FIRED |
| `['audit','--json','--severity','high']` | **DETECTED** exit 1 | FIRED |
| `['audit','--json','--audit-level=low','--audit-level=high']` (duplicate) | **DETECTED** exit 1 | FIRED |
| `['audit','--audit-level=high','--json']` (reordered) | **DETECTED** exit 1 | FIRED |
| `['audit','--json','--config.audit-level=high']` | **DETECTED** exit 1 | FIRED (by census) |
| argv built by `.concat([...])` | **DETECTED** exit 1 | FIRED |
| argv built by a helper function | **DETECTED** exit 1 | FIRED |
| argv built by spread of a separate constant | **DETECTED** exit 1 | FIRED |

The self-check evaluates the **runtime value** of `AUDIT_ARGV`, not its source text, so indirection does not evade it. That is a sound design and it holds. Note that in every case the census reconciliation **also** fired — the argv check is genuine defence in depth, not the sole barrier.

### 5.2 Scope filters are NOT detected — FINDING P42-01

| mutation | verdict | argv self-check |
|---|---|---|
| `['audit','--json','--dev']` | **ACCEPTED exit 0** | silent |
| `['audit','--json','--prod']` | **ACCEPTED exit 0** | silent |
| `['audit','--json','--optional']` | **ACCEPTED exit 0** | silent |
| `['audit','--json','--no-optional']` | **ACCEPTED exit 0** | silent |
| `['audit','--json','--ignore-registry-errors']` | **ACCEPTED exit 0** | silent |

**This is not a benign acceptance.** I proved it end to end on a real graph:

1. In `/tmp/opencode/ph42/mirror-undici`, I lowered `undici@<6.28.1` to `6.28.0` — reverting the Phase 33 remediation — and re-resolved the lockfile **in the mirror only**.
2. Genuine audit of that graph: **95 records**; `undici` carries advisories **1239934, 1240039, 1240042**. The floor is violated.
3. `pnpm audit --dev --json` on the **same** graph: **22 records**, census 22, **zero undici advisories**. `--dev` excludes the whole prod dependency subtree that carries `undici`.
4. The gate, fed that `--dev` report via `--audit-file`: **exit 0, all 8 checks OK**, printing *"the advisory records were reconciled tier-by-tier against the registry severity census, so the set was proven UNFILTERED"*.
5. The gate, fed the `--prod` report from the **same** graph: **exit 1**, correctly naming the `undici` floor violation.
6. **Live end-to-end:** mutating the mirror's `AUDIT_ARGV` to add `--dev`, then running the unmuted-logic gate against the genuinely vulnerable mirror, produced **exit 0, 9/9 checks OK** — with the argv self-check reporting it was satisfied.

So: a floored package's entire advisory set can be made invisible, the census will not notice, the argv self-check will not notice, and the gate will affirmatively print that the set was proven unfiltered. This is the **same defect class F-40-01 describes** — a filtered report accepted as complete — reached through a flag Phase 41 did not consider.

I confirmed `undici` is genuinely prod-only by checking every importer that reaches it in the lockfile. I also verified the environment and config vectors do **not** work, so this is not a broader exposure:

- `npm_config_audit_level=high` → 95 records / census 95 (ignored by pnpm)
- `.npmrc audit-level=high` → 95 / 95 (ignored)
- `.npmrc dev=true` → 95 / 95 (ignored)

**Severity assessment.** I am deliberately conservative here. `--dev`/`--prod` are not the realistic accidental regression that `--audit-level` was; they are a deliberate scope choice, and the census genuinely cannot refute one. But the gate's PASS text makes an unqualified claim ("proven UNFILTERED", "no filter was applied to this report") that is **demonstrably false** in this state, and the control's central security property — that a floored package carries no advisory at any severity — **does not hold** for prod-only floored packages under this invocation. That is a material bypass of the property the control exists to enforce. → **MEDIUM**, consistent with how F-40-01 itself was classified for the analogous `--audit-level` case.

---

## 6. Census/record reconciliation (WS4) — INDEPENDENTLY VERIFIED

`readCensus()` and `reconcileRecordsAgainstCensus()` account for all five canonical severities. Every per-tier removal produced a correctly-named diagnostic (§4.2, rows W4-a…W4-g). All of:

- one moderate / low / high / critical removed → correct tier named;
- all low removed → `low: 8 missing`;
- all moderate removed → `moderate: 36 missing`;
- multiple tiers removed → both tiers named in one message;
- advisory duplicated → excess reported;
- advisory reassigned to another severity → distribution change detected;
- advisory severity omitted → reported as unreconcilable, not silently bucketed.

Ordering and object shape do **not** cause false rejection (attacks 1, 5). `CANONICAL_SEVERITIES` is explicitly declared rather than inferred, so a report inventing a tier fails rather than redefining "complete". The per-tier comparison (not merely the total) is what makes attacks 14 and 15 detectable. This is a well-built check.

The one behaviour worth recording as intended rather than accidental: a census tier that is **absent** is read as zero (`raw[tier] ?? 0`), which is why attack 10 fails on 8 excess `low` records rather than on the absent key. That is a defensible design decision, stated in the source comment, and I classify it **ACCEPTED LIMITATION**.

---

## 7. The "a genuinely clean repository would fail this gate" limitation (WS5)

Phase 41 states this explicitly. **I am not converting it into a defect and I did not modify the gate.**

Tested minimally (attack W5-a): a report with `advisories: {}` and a self-consistent zero census is **DETECTED** at `the audit report is not empty`.

**Classification: ACCEPTED LIMITATION, deliberate invariant.** The reasoning is sound. The empty-report check exists precisely because a filtered report and a clean report are indistinguishable by count — that is F-40-01's root cause, stated in the gate's own header. Given that, "no advisories" cannot be read as success without reintroducing the exact defect class the control exists to end. The fail-closed choice is correct.

The practical consequence, which is a property of the design rather than a bug: this gate is a **floor-enforcement** control, not a "the repository is clean" control. It cannot pass on a repository with zero advisories. That is a genuine tension — a fully remediated repository would be blocked by it — and it is a real operational consideration for whoever eventually remediates all 44 sub-threshold advisories. Recorded as **INFO** for that reason only. See Finding **P42-04**.

---

## 8. F-40-02 source-mutation review (WS6) — INDEPENDENTLY VERIFIED, all 7

I did not trust the reported 7. I re-implemented each independently, in my own mirror builder, and checked per mutant: anchor occurs exactly once; mutation is not a no-op; mutated source parses (`node --check`); **the mutated gate did not crash**; the paired control rejects the identical input; the weakened source accepts it; polarity correct.

| mutant | anchor×1 | not no-op | parses | no crash | control REJECTS | weakened ACCEPTS | verdict |
|---|---|---|---|---|---|---|---|
| **M41-SRC-SEV-NARROW** | ✅ | ✅ | ✅ | ✅ | ✅ `no advisory exists against a package the security floor claims to remediate` | ✅ exit 0 | **VERIFIED** |
| **M41-SRC-PKGMATCH** | ✅ | ✅ | ✅ | ✅ | ✅ same named check | ✅ exit 0 | **VERIFIED** |
| **M41-SRC-CENSUS-OFF** | ✅ | ✅ | ✅ | ✅ | ✅ `…the report is UNFILTERED` | ✅ exit 0 | **VERIFIED** |
| **M41-SRC-CENSUS-ABSENT-OK** | ✅ | ✅ | ✅ | ✅ | ✅ `carries the registry severity census` | ✅ exit 0 | **VERIFIED** |
| **M41-SRC-EMPTY-TOLERATED** | ✅ | ✅ | ✅ | ✅ | ✅ `the audit report is not empty` | ✅ exit 0 | **VERIFIED** |
| **M41-SRC-LEVEL-ADDED** | ✅ | ✅ | ✅ | ✅ | ✅ control ACCEPTED the real clean repo | ✅ **failed closed** exit 1, argv self-check fired | **VERIFIED** |
| **M41-SRC-SEVCONST** | ✅ | ✅ | ✅ | ✅ | ✅ | n/a — asserted as documented-benign: narrowing `BELOW_THRESHOLD_SEVERITIES` does **not** weaken the assertion | **VERIFIED** |

**"Weakened" really means the security property was weakened** in all five cases where the harness uses that label: the identical input is rejected by the unmutated control and accepted by the mutated source, so the mutated line is demonstrably load-bearing. No mutant merely crashes; no mutant is a no-op; no syntax error was scored as a detection.

Two specific attentions the brief asked for:

- **M41-SRC-CENSUS-OFF** — genuinely consequential. With reconciliation stubbed, the genuine `--audit-level=high` report is accepted, restoring the F-40-01 defect exactly. Verified by running it.
- **M41-SRC-LEVEL-ADDED** — polarity is the **default** (must REJECT), not `weaken`. This is correct and the harness documents why: the argv self-check fires first, so reintroducing the flag makes the control **fail closed** rather than silently weaker. My first reviewer pass wrongly applied the `weaken` polarity to it and reported a false anomaly; I discarded that and reran it correctly (§9.3). The mutant does prove the argv self-check is load-bearing in the fail-closed direction.

**F-40-02 is genuinely closed.** The Phase 40 finding was correct: the harness previously mutated nothing in the gate's own source, and the Phase 39 docstring's claim that `M-LOW` proved protection against narrowing `BELOW_THRESHOLD_SEVERITIES` was false. Phase 41 both closed the coverage gap and replaced the false claim with a measured one (`M41-SRC-SEVCONST`).

Running the harness as shipped reproduces the reported tally exactly: **22 applied, 7 source mutants, 15 detected, 5 weakened, 2 tolerated, 0 escapes, 0 ineffective, 0 setup failures, 23 mirrors removed, all five protected files byte-identical.** The harness's own disclosed defects (the two-sided `m.apply` throw path leaving a mirror behind, the child-environment defect) are real but do not affect any scored result — the environment fix at line 311 (`{ ...process.env, CI: '1', FORCE_COLOR: '0' }`) is correct and necessary, since the Phase 41 live mutants do spawn `pnpm`.

---

## 9. Harness audit (WS7)

### 9.1 Machinery — sound

- **Change-signal** covers policy, gate, lock, workflow, parity, and (when written) the fixture. A mutant that changes nothing it claims is discarded as SETUP, not scored. Correct.
- **Source-mutation confirmation:** a mutant declaring `mutates: 'gate'` that did not actually change the gate is discarded. This is the F-40-02 guard itself, and it is real.
- **`isParseableJs()`** gates every gate-mutating mutant before scoring — a syntax error can never be reported as a detection. Correct, and I verified the mutant files parse.
- **Crash classification.** The `SETUP_SIGNATURES` list does **not** include `ReferenceError` or `TypeError`. I probed whether this could miscount a crash as a detection. It cannot, for two independent reasons: (a) for `weaken`-polarity mutants a non-zero exit is scored **INEFFECTIVE + failures+=1**, never a detection; (b) for `expected: 'fail'` mutants the `mustMention` assertion would almost certainly fail → **wrongReason + failures+=1**. I also confirmed by construction that a deliberately crash-inducing mutant is caught by the setup signatures (a `censusResult.censusTYPO_UNDEFINED` mutation matched `Cannot read propert` → discarded as SETUP, correctly). **No crash can be counted as a detection.**
- **Control run.** An unmutated control must pass before any mutant is scored, and a control with a setup signature aborts the whole campaign. Correct.
- **Post-condition** byte-identity assertion on all five protected files, with restore-on-mismatch. It reported all five unchanged after my run.
- **Mirror completeness:** copies `scripts/`, `security/`, `ci.yml`, `verify-ci-parity.mjs`, `pnpm-lock.yaml`, `apps/*/package.json`, `apps/api/scripts`, and symlinks `node_modules`. I verified a parity run inside such a mirror succeeds, so the copy set is sufficient.

### 9.2 Coverage gap — FINDING P42-02

**The harness has no mutant for a dependency-scope filter.** `captureFilteredAudit()` is called exactly twice, with `'high'` and `'moderate'`. Grep for any scope-filter mutant returns nothing.

This is the direct cause of Finding P42-01 escaping: the harness tests severity filters because severity filters are what F-40-01 was about, and never asks whether a *different* filter class reaches the same blind spot. The harness's own closing text asserts the census detects "a GENUINE severity-filtered report" — true, and narrower than the claim the gate's PASS text makes.

### 9.3 My own harness defects — disclosed, discarded, rerun

Per the review rules I disclose and discard reviewer-harness defects rather than counting them:

1. **`attack-census.mjs` destructuring bug.** Attack 16 crashed the harness (`Cannot set properties of undefined`) after 15 attacks had completed. I fixed the selector and **reran the entire campaign from scratch**; all 31 results in §4.2 come from the clean rerun.
2. **`review-source-mutants.mjs` polarity bug.** I applied the `weaken` polarity to `M41-SRC-LEVEL-ADDED`, which correctly carries the default polarity, and reported a false "REVIEW ATTENTION" anomaly. I discarded that mutant's result, corrected the harness to model both polarities explicitly, and reran. The corrected result is in §8.
3. **`attack-parity-retest.mjs` ESM `require` error.** `require is not defined in ES module scope`. Fixed with `createRequire`; the run was repeated in full.
4. **Parity attacks 09-11/09-12/09-15 initially reported as escapes.** All three were **my harness artifacts**, not parity gaps. I discarded them and re-attacked each correctly (§11.2): 09-11/09-12 injected a standalone `- if: false` list item producing an **invalid** Actions step, and 09-15 re-added the file I had just untracked. Corrected outcomes are in §11.2.

No discarded result is counted anywhere in this document.

---

## 10. CI integration (WS8) — INDEPENDENTLY VERIFIED

`.github/workflows/ci.yml` parsed structurally with the same `yaml@2.9.0` the parity contract uses.

**Gate step** (job `api`, step 19):

```yaml
- name: Supply chain — advisories the pipeline filters out are observed, and proven unfiltered (Phase 39 F-39-01, Phase 41 F-40-01)
  run: node scripts/verify-dependency-advisory-visibility.mjs
```

| property | value | verdict |
|---|---|---|
| exact command | `node scripts/verify-dependency-advisory-visibility.mjs` | matches parity `exactCommand` exactly |
| job | `api` | correct — has the install and the dependency gates |
| ordering | step 19 of 29, **after** `pnpm install --frozen-lockfile` (step 3) | correct |
| relative to other supply-chain gates | after `verify-dependency-audit` (13), triage (14), triage-verifier (15), `verify-dependency-security-floor` (17), `verify-dependency-floor-policy` (18) | correct |
| `if:` | none | verified — no `if: false`, no always-true `if` |
| `continue-on-error` | none | verified |
| `|| true` / `set +e` | none | verified (raw-text scan) |
| `working-directory` | none (defaults to workspace root, where `scripts/` and `security/` resolve) | correct |
| `env` overrides | none | correct |
| duplicate/shadow gate | none | verified |

**Harness step** (job `release`, step 20): `run: node scripts/mutate-dependency-advisory-visibility.mjs`, no `if`, no `continue-on-error`, after `pnpm install --frozen-lockfile` (step 3) and the CI-contract step (step 4). Correct.

The two `continue-on-error: true` entries in the workflow are at lines 226 (`API lint`) and 400 (`Mobile lint`) — pre-existing and unrelated.

**`scripts/verify-ci-parity.mjs`:**

- Both Phase 41 gates registered: `p39-advisory-visibility` (L460-468) and `p39-advisory-visibility-mutate` (L470-475). ✅
- `exactCommand` strings match the workflow exactly, and deliberately exclude `--json` and `--audit-file`. ✅
- Target resolution correct: `{ kind: 'file', file: 'scripts/…' }`. ✅
- Required-gate IDs present in the enforced list at L976. ✅
- Removal detected ✅, untracked target detected ✅ (§11.2).
- cwd-independent ✅ (parity from `cwd=/tmp` → exit 0).
- environment-independent ✅ (parity with `PATH=/usr/bin:/bin HOME=/tmp` → exit 0).

**The current untracked-target failure is NOT a Phase 41 bug.** The real tree reports 4 untracked-target problems: two Phase 37 (`verify-dependency-floor-policy.mjs`, `mutate-dependency-floor-policy.mjs`) and two Phase 41. The Phase 41 pair fails for exactly the same reason as the Phase 37 pair: the whole Phase 37–41 chain is uncommitted. In a fully-committed mirror of the identical tree, parity exits **0**. Phase 41 did not introduce the condition; it inherited an uncommitted tree. Recorded as a consequence of the uncommitted state (§12, §13), not a finding.

---

## 11. CI parity mutation testing (WS9)

### 11.1 Results — 17 attacks against a fully-committed mirror

| # | attack | outcome |
|---|---|---|
| 1 | remove the Phase 41 gate step | **DETECTED** `…is not wired into CI as a step command` |
| 2 | change the command (add `--json`) | **DETECTED** `invoked by a NON-EQUIVALENT command` |
| 3 | change the target to another script | **DETECTED** |
| 4 | rename the target file | **DETECTED** |
| 5 | remove both parity registrations | **DETECTED** `contract has 23 entries; 25 are required` + `no longer contains the gate` |
| 6 | alter the required-gate ID | **DETECTED** |
| 7 | add `continue-on-error: true` | **DETECTED** `only ever invoked by an advisory step` |
| 8 | append `|| true` | **DETECTED** |
| 9 | prefix with `set +e` | **DETECTED** |
| 10 | comment out the command in a `run: \|` block | **DETECTED** |
| 11 | hide behind `if: false` | **DETECTED** (corrected attack, §11.2) |
| 12 | hide behind an always-true `if:` | **DETECTED** (corrected attack, §11.2) |
| 13 | coordinated CI + parity rename | **DETECTED** — caught by resolvability: the script the step runs does not exist |
| 14 | step-**name**-only rename | **POSITIVE — correctly accepted** (parity matches commands, not labels) |
| 15 | untracked target (`git rm --cached`) | **DETECTED** (corrected attack, §11.2) |
| 16 | remove the Phase 41 harness step | **DETECTED** |
| 17 | comment out the parity-contract step itself | **DETECTED** `the gate verify-ci-parity.mjs is not wired into CI` |

Legitimate positive control correctly classified: **#14**. Adding a second, duplicate invocation of the gate is also correctly accepted — a duplicate is not a security regression.

### 11.2 Corrections to my first pass

Attacks 11, 12 and 15 initially appeared to escape. On re-attack:

- **11/12 (corrected):** I first inserted a *standalone* `- if: false` list item before the named step. Parsed, that is `{"if": false}` — a step with neither `run` nor `uses`, which is an **invalid Actions step**; GitHub rejects the workflow file. That is not a silent suppression, and not a parity gap. Re-attacked properly by putting `if:` **on the named step itself**, parity reports the step as advisory-only.
- **15 (corrected):** my helper re-ran `git add -A` after `git rm --cached`, re-tracking the file. Re-attacked without the re-add: `git ls-files` confirms untracked, and parity **DETECTED** it with the full untracked-target message.

### 11.3 The `if:` gap on a required step — PRE-EXISTING, not a Phase 41 finding

Attacking correctly — putting `if: ${{ false }}` **on the gate step itself** — parity **exits 0 and does not detect it**. `suppressionProblem()` (`verify-ci-parity.mjs:861-875`) checks `continueOnError`, `set +e`, `|| true`, `|| :`, `|| echo`, `&& exit 0` and `2>/dev/null || true`, but **never inspects `step.if`**.

**This is pre-existing and I am explicitly not attributing it to Phase 41.** Verified: `git show HEAD:scripts/verify-ci-parity.mjs | grep 'step\.if'` returns **0 matches** — the gap exists in the committed script, before any Phase 41 change. It affects **every** required gate in the repository equally, not the Phase 41 pair specifically, and Phase 41's own parity diff (+65 lines, all additions to gate registrations) did not touch this logic. Recorded as **INFO / PRE-EXISTING GAP**, outside Phase 41's scope, per the instruction not to report it as introduced.

---

## 12. Hosted CI status (WS10) — HOSTED CI UNVERIFIED

**Phase 41 has NOT executed on GitHub Actions.** Determined from primary evidence, not inferred:

| check | result |
|---|---|
| `scripts/verify-dependency-advisory-visibility.mjs` in commit `199877a`? | **ABSENT** |
| `scripts/mutate-dependency-advisory-visibility.mjs` in commit `199877a`? | **ABSENT** |
| `docs/PHASE_41_FINAL_REPORT.md` in commit `199877a`? | **ABSENT** |
| `advisory-visibility` occurrences in `199877a:.github/workflows/ci.yml`? | **0** |
| `advisory-visibility` mentions in the logs of run `36714434566`? | **0** |

Run `36714434566` is real and completed `success` — but it is for `headSha 199877aef283…`, which **predates and does not contain** any Phase 37/39/41 artefact. It is not evidence for Phase 41. There is no runner for the Phase 41 content because that content is uncommitted.

**HOSTED CI UNVERIFIED.** Local results in §13 are local results and are not presented as hosted-CI evidence. No Phase 41 gate step has ever run on a GitHub runner.

---

## 13. Regression results (WS11)

All against the **real working tree**. Exact counts recorded; nothing reinterpreted.

| Gate | Exit | Result |
|---|---|---|
| `verify-dependency-audit.mjs` | 0 | PASS |
| `verify-dependency-triage.mjs` | 0 | PASS |
| `verify-dependency-security-floor.mjs` | 0 | PASS — no resolved instance below its floor |
| `verify-dependency-floor-policy.mjs` | 0 | PASS — **16 checks, 16 passed, 0 failed** |
| `verify-dependency-advisory-visibility.mjs` (LIVE) | 0 | PASS — **9 checks, 9 passed, 0 failed** |
| `verify-ci-parity.mjs --list` | **1** | **FAIL — 4 untracked-target problems** (2 Phase 37, 2 Phase 41). Consequence of the uncommitted tree (§10), green when the identical tree is committed. |
| `mutate-dependency-advisory-visibility.mjs` | 0 | PASS — 22 applied / 7 source / 15 detected / 5 weakened / 2 tolerated / 0 escapes |
| `mutate-dependency-security-floor.mjs` | 0 | PASS |
| `mutate-dependency-floor-policy.mjs` | 0 | PASS |
| `mutate-config-contract.mjs` | 0 | PASS |
| `mutate-ci-integration.mjs` | 0 | PASS |
| `pnpm typecheck` | 0 | 11/11 tasks successful |
| `pnpm build` | 0 | 7/7 tasks successful |
| `verify-release-artifact.mjs` | 0 | PASS — API: 280 files byte-identical across two clean builds; Web: 2969 files checked, standalone tree, no baked secret |
| `pnpm --filter @ecc/api verify:storage:backup` | 0 | PASS |
| `pnpm --filter @ecc/api verify:ratelimit:n12:mutate` (N-12) | 0 | PASS — every protection load-bearing, negative control genuine |
| `bash scripts/verify-db-migrations.sh` | 0 | PASS — reproducible, idempotent, sufficient; only touched its own throwaway container on 127.0.0.1:55433 |
| `node scripts/run-db-suites.mjs` | 0 | PASS — e2e **8 files / 138 tests**; unit+integration **27 files / 348 tests** |
| `pnpm --filter @ecc/web test` | 0 | **1 file / 1 test passed** |
| `pnpm --filter @ecc/mobile test` | 0 | **6 files / 34 tests passed** |
| `pnpm lint` | **1** | **FAILING — reported as failing, not green.** Turbo: 8/11 tasks successful. `@ecc/mobile`: 18 problems (0 errors, 18 warnings), blocked by `--max-warnings 0`. `@ecc/api` and `@ecc/web` also exited non-zero. **Pre-existing** — `SECURITY_REVIEW_PHASE_40.md:562,570` records the identical pre-existing lint debt; Phase 41 touched no application source. CI marks `API lint` and `Mobile lint` `continue-on-error: true` (workflow lines 226, 400). |
| `verify-docker-images.mjs --skip-build` | 0 | PASS — runtime behaviour of existing images; **no rebuild performed** |

---

## 14. Docker status

`node scripts/verify-docker-images.mjs --skip-build` was run and passed: 404 on unknown routes, image-optimization endpoint returning 404 with the shipped manifest recording the optimizer disabled, clean SIGTERM shutdown with the API and web containers both draining and refusing connections afterwards.

**No image rebuild was performed** — not authorised for this phase.

**`mutate-container-gate.mjs`: NOT TESTED.** It was not executed. Per the review rules this is **not** recorded as a pass, and no result in this document depends on it.

---

## 15. Supply-chain boundary (WS12)

Phase 41 has **NOT**:

- upgraded or downgraded any dependency — `pnpm-lock.yaml` checksum `7fa75d7c…` **unchanged**; `pnpm-workspace.yaml` `19fe8f43…` **unchanged**; root `package.json` `1f62d7c4…` **unchanged**;
- changed the Phase 33 overrides (`brace-expansion` → 1.1.21 / 2.1.7, `undici` → 6.28.1), verified present and unmodified;
- suppressed an advisory — no `ignore-vulnerabilities`, `auditConfig`, `neverAuditDependencies`, `allowlist` or `npm audit --ignore` in any `package.json` or the workspace file;
- changed triage reachability policy — `scripts/triage-vulnerabilities.mjs` checksum `e9d61a1a…` **unchanged** from baseline;
- allow-listed any vulnerability;
- touched the Prisma schema or migrations (`a36fd3e7…` and `8cb99b35…` **unchanged**);
- touched application source — the only tracked modifications remain the four pre-existing Phase 37–39 files.

**The three concepts are distinct and this review keeps them distinct:**

- **Visibility** — *is the advisory present in the report at all?* Phase 41 improves this and materially so.
- **Reachability** — *can the vulnerable code be reached from a deployed path?* Adjudicated by `triage-vulnerabilities.mjs`, a **different** control, unchanged, still critical/high-filtered by design.
- **Remediation** — *has the dependency been fixed?* Achieved by the Phase 33 overrides, enforced by `verify-dependency-security-floor.mjs` + `verify-dependency-floor-policy.mjs`.

**About the 44 sub-threshold advisories (36 moderate, 8 low):** this review does **not** claim they are safe, and does **not** claim they are remediated. They are **counted and reported** by the gate and remain **open work**. Phase 39's own header records that remediating them requires dependency upgrades — including `next` 14.2.35 → 15.5.x — which needs a lockfile change and an authorisation this chain does not carry. Their existence is now visible rather than out of sight; that is the whole, and modest, claim.

---

## 16. Review-gap matrix (WS13)

Rebuilt from the artefacts actually present in the tree.

| Phase | Report | Review artifact | Did the reviewer implement the phase? | Classification |
|---|---|---|---|---|
| 22 | yes | **none** | — | **NO REVIEW ARTIFACT** |
| 23 | none | **none** | — | **NO REVIEW ARTIFACT** |
| 25 | yes | `…PHASE_25.md` | not stated | review exists; independence not established |
| 26 | yes | `…PHASE_26.md` | not stated (self-review language present) | review exists; **possible self-review** |
| 27 | yes | **none** | — | **NO REVIEW ARTIFACT** |
| 32 | yes | **none** | — | **NO REVIEW ARTIFACT** |
| 33 | yes | **none** | — | **NO REVIEW ARTIFACT** |
| 34 | none | `…PHASE_34.md` | not stated (self-review language present) | review exists; independence not established |
| 35 | none | `…PHASE_35.md` | not stated | review exists; independence not established |
| 36 | yes | `…PHASE_36.md` | not stated (self-review language present) | review exists; independence not established |
| 37 | yes | `…PHASE_37.md` | **disclosed: no** | review did not implement the phase; **NOT organisationally independent** (§0 discloses this itself) |
| 38 | yes | **none** | — | **NO REVIEW ARTIFACT** |
| 39 | yes | `…PHASE_40.md` | **disclosed: no** | review did not implement the phase; **NOT organisationally independent** (§0 discloses this itself) |
| 40 | n/a (review phase) | `…PHASE_40.md` | disclosed: no | review of 39; **NOT organisationally independent** |
| 41 | yes | **this document** | **disclosed: no** | review did not implement the phase; **NOT organisationally independent** (§0) |

**Observations.**

- Six phases (22, 23, 27, 32, 33, 38) have **no independent review artifact at all**. Those gaps cannot be closed retroactively and I do not claim to have closed them.
- For phases 25, 26, 34, 35 and 36 a review artifact exists but neither an explicit independence disclosure nor an organisational-independence claim could be established from the artefact. I classify these as **REVIEW GAP (independence unestablished)** rather than claiming they are sound or unsound.
- Phases 37, 39, 40 and 41 are the only ones with an explicit, honest non-implementation disclosure, and each correctly states it is **not** organisationally independent.
- **The organisational-independence gap is a single, continuous, unbroken condition across the entire chain.** Every link discloses it and none closes it. **I do not close it, and it cannot be closed from inside this repository.** A reviewer requiring organisational independence must obtain a review from a party outside this repository and session.

---

## 17. Findings

### P42-01 — MEDIUM — the census is not a census of the repository, so a dependency-scope filter yields a silent pass while the gate claims the set was proven unfiltered

`verify-dependency-advisory-visibility.mjs:214-312` (census contract), `:337-348` (argv self-check).

**Reproduced end to end on a real graph.** `pnpm audit --dev` submits a smaller package set, so `metadata.vulnerabilities` describes *that* set and agrees with its records. With `undici` reverted to a vulnerable `6.28.0` (in a mirror), the `--dev` report carries **zero** undici advisories, the census reconciliation **passes**, the argv self-check **passes**, and the gate exits **0** printing *"proven UNFILTERED … No severity tier is missing, so no filter was applied to this report."* The same graph under `--prod` correctly fails.

**Impact.** The gate's central property — a floored package carries no advisory at any severity — does not hold for a prod-only floored package under a scope-filtered invocation. `SEVERITY_FILTER_FLAGS` enumerates only severity flags; `--dev`, `--prod`, `--optional`, `--no-optional` are not severity filters and are not enumerated, and the census cannot catch them because they reduce it coherently.

**Why MEDIUM and not higher:** the trigger is a deliberate scope choice rather than the accidental `--audit-level` regression F-40-01 addressed; environment and `.npmrc` vectors do **not** work (verified); and the resulting report is at least internally coherent. It is MEDIUM for the same reason F-40-01 was: the control makes an affirmative completeness claim that is false in this state.

### P42-02 — MEDIUM — the mutation harness has no scope-filter mutant, which is why P42-01 was not caught

`mutate-dependency-advisory-visibility.mjs:188,202`.

`captureFilteredAudit()` is called only with `'high'` and `'moderate'`. No mutant varies dependency scope. The harness's closing summary claims the census detects "a GENUINE severity-filtered report" — accurate, but narrower than the gate's PASS text, and it gives false assurance that filter detection in general is proven. A one-line `captureFilteredAudit` extension with a scope flag plus a paired `AUDIT_ARGV` mutant would have surfaced P42-01.

### P42-03 — INFO — the coordinated-edit boundary is disclosed more narrowly than it is

`verify-dependency-advisory-visibility.mjs:122-130`.

The header implies refuting a coherent forged report requires rewriting the gate source, the lockfile, or the floor policy. Attacks 4 and W4-h show rewriting **only `metadata`** in the report suffices — no source, lockfile or policy edit. The trust model is unchanged in substance, but a reader assessing the census's authority from the header alone would over-estimate it.

### P42-04 — INFO — a fully remediated repository would be blocked by this gate

`verify-dependency-advisory-visibility.mjs:440-448`.

Correctly disclosed by Phase 41 and correctly classified by me as an **ACCEPTED LIMITATION / deliberate fail-closed invariant** (§7), not a defect. Recorded because it is a real operational consequence: this is a floor-enforcement control, not a cleanliness control, and whoever eventually remediates the 44 sub-threshold advisories will hit it. No gate modification is proposed here.

### P42-05 — INFO — documentation inconsistency: 42 vs 44 sub-threshold advisories

`verify-dependency-advisory-visibility.mjs:52,64` say "the other 42" / "the remaining 42"; line 554 and every measurement say **44** (36 moderate + 8 low). The 44 figure is correct; the two comments are stale. Documentation only — **not** inflated into a security finding.

### Pre-existing, NOT introduced by Phase 41

- **Parity `if:` gap** — `suppressionProblem()` never inspects `step.if`, so a required gate wrapped in `if: ${{ false }}` is not flagged. Present in `HEAD`, affects all gates equally, untouched by Phase 41's +65-line additive diff (§11.3). **PRE-EXISTING GAP**, out of Phase 41's scope.
- **The 4 untracked-target parity failures** — caused by the uncommitted Phase 37–41 working tree. Two are Phase 37's. The identical tree is green when committed (§10). **NOT a Phase 41 defect.**
- **`pnpm lint` exit 1** — pre-existing, documented in the Phase 40 review, no application source touched by Phase 41 (§13).

### No finding is claimed for

The 44 sub-threshold advisories; the lack of hosted-CI execution (that is §12's status, not a defect in the code); the disclosed coordinated-edit boundary; or the clean-repository limitation.

---

## 18. Integrity and cleanup (WS14)

| check | result |
|---|---|
| reviewer mirrors removed | ✅ all `/tmp/ecc-ph42-*`, `/tmp/ecc-p39-visibility-*`, `/tmp/ph42-mirror*` gone |
| temporary worktrees | ✅ `git worktree list` shows only the primary worktree |
| temporary databases | ✅ none left; the migration gate and `run-db-suites.mjs` each destroyed their own throwaway containers |
| throwaway containers | ✅ none remain; no container matching `ecc-ph42-` exists |
| pre-existing containers unchanged | ✅ all six present with identical creation timestamps (`pg-pgtest` 2026-09-30, `ecc-*` 2026-09-04, `unruffled_aryabhata` 2026-06-27) |
| unexpected processes | ✅ none left behind by any reviewer harness |
| developer DB fingerprint | ✅ `ecc-postgres` healthy, 37 tables in `public`, 2 rows in `_prisma_migrations`, databases `ecc`/`postgres`/`template0`/`template1` only — no stray database created |
| `pnpm-lock.yaml` | ✅ `7fa75d7c…` **unchanged** |
| `pnpm-workspace.yaml` | ✅ `19fe8f43…` **unchanged** |
| root `package.json` | ✅ `1f62d7c4…` **unchanged** |
| `.github/workflows/ci.yml` | ✅ `860bd055…` **unchanged** |
| `scripts/verify-ci-parity.mjs` | ✅ `a11bf953…` **unchanged** |
| `scripts/verify-dependency-advisory-visibility.mjs` | ✅ `677b7bd0…` **unchanged** |
| `scripts/mutate-dependency-advisory-visibility.mjs` | ✅ `b353fd2d…` **unchanged** |
| `scripts/triage-vulnerabilities.mjs` | ✅ `e9d61a1a…` **unchanged** |
| `scripts/verify-dependency-security-floor.mjs` | ✅ `29758b5c…` **unchanged** |
| `scripts/mutate-dependency-security-floor.mjs` | ✅ `70925818…` **unchanged** |
| `apps/api/prisma/schema.prisma` | ✅ `a36fd3e7…` **unchanged** |
| `apps/api/prisma/migrations/**` (aggregate) | ✅ `8cb99b35…` **unchanged** — confirmed by direct recomputation, per-file digests recorded |
| `git status` vs baseline | ✅ identical except this document, `SECURITY_REVIEW_PHASE_42.md` |
| commits / pushes / amends / rebases / resets / stashes | ✅ none |

`git status --porcelain` after review differs from baseline by exactly one new untracked entry: `?? SECURITY_REVIEW_PHASE_42.md`.

---

## 19. Final disposition

# REMEDIATION REQUIRED

**Rationale.** Phase 41's core defect, F-40-01, is genuinely closed — I reproduced the Phase 40 escape and verified the new control rejects it, and the census oracle is a real, untruncated, registry-derived witness that detects every severity-tier truncation I could construct. F-40-02 is also genuinely closed: all seven source mutants independently verified as non-no-op, syntactically valid, non-crashing, correctly-polarised, and demonstrably load-bearing. Both claims survive independent testing.

**But the advisory-visibility control has a material bypass.** P42-01 is a reproduced, end-to-end escape: a dependency-scope filter (`--dev`/`--prod`) that the census cannot detect because it reduces the census *coherently*, on a real graph with a genuinely reverted `undici` remediation, yields **exit 0** while the gate affirmatively prints that the advisory set was "proven UNFILTERED" and that "no filter was applied to this report". The control's central security property does not hold for a prod-only floored package under that invocation. P42-02 shows why it survived: the harness has no scope-filter mutant. P42-01 and P42-02 are the same defect seen from the implementation and its verification.

This is the F-40-01 defect class reached through a flag Phase 41 did not consider, on a control whose entire purpose is proving that no filter was applied. A completeness control that cannot see a filter and nonetheless asserts completeness is not merely incomplete — it is affirmatively misleading to whoever reads its output. That warrants REMEDIATION REQUIRED rather than APPROVED WITH FINDINGS.

**Not claimed.** No production, staging or release readiness. No security rating. That the 44 sub-threshold advisories are safe or remediated. That hosted CI has validated any of this — **HOSTED CI UNVERIFIED** (§12).

**Organizational independence — stated separately and not satisfied.** I did not implement Phase 41, and every conclusion here was re-derived from primary sources. I am, however, an in-repository verification pass sharing the implementer's machine, toolchain, git identity and credentials. **This review cannot discharge an independent-review requirement for Phase 41, and the same unbroken gap applies to phases 37, 39 and 40.** It must be closed by a party outside this repository and session. Nothing in this document should be read as closing it.

**Scope note.** This review fixed nothing. P42-01 through P42-05 are documented, not remediated.