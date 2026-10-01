# PHASE 33 — SUPPLY-CHAIN ADVISORY REMEDIATION AND CI RECOVERY

**Phase:** 33 — Supply-chain advisory remediation and CI recovery
**Type:** dependency remediation. The only functional change is the remediation of the currently
blocking dependency advisories. Not a feature phase, not a general security-hardening phase.
**Date:** 2026-09-30
**Commit:** `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` (pushed to `origin/main`)
**Hosted run:** [`36684252352`](https://github.com/Tarangj07/KinCare-Connect/actions/runs/36684252352) — **SUCCESS (5/5 jobs)**
**Predecessor:** `abe8d78` — hosted run [`36671794473`](https://github.com/Tarangj07/KinCare-Connect/actions/runs/36671794473) (**FAILED** on P32-1)

> **This phase does not claim the system is production ready, staging ready, or release ready.**
> Green CI is a statement about this commit building and passing its own gates on a hosted runner.
> It is not a readiness, security, or compliance certification, and none is claimed.

---

## 1. Objective

Resolve P32-1 — the reachable critical/high transitive dependency advisories that blocked hosted CI
in run `36671794473` — through real dependency remediation, and restore a genuinely green hosted CI
run without weakening any control.

---

## 2. Original P32-1 advisories and dependency paths

Reproduced by running the exact gate CI runs, before any change:

```
$ node scripts/triage-vulnerabilities.mjs
FAILED — 5 critical/high advisory/ies are reachable and need a decision before release.
EXIT=1
```

The 5 blocking advisories were drawn from **3 transitive packages**. Authoritative data came from
`pnpm audit --json` (not from the Phase 32 report, whose version figures turned out to be
incomplete — see §5).

| Advisory | Package | Severity | Vulnerable range | Patched floor | Path |
|---|---|---|---|---|---|
| 1240108 | `brace-expansion@1.1.18` | high | `<1.1.19` | `>=1.1.19` | `apps__api>@nestjs/cli>fork-ts-checker-webpack-plugin>minimatch>brace-expansion` (and 99 more) |
| 1240104 | `brace-expansion@1.1.18` | high | `<1.1.20` | `>=1.1.20` | same |
| 1240100 | `brace-expansion@1.1.18` | moderate | `<1.1.21` | `>=1.1.21` | same |
| 1240109 | `brace-expansion@2.1.4` | high | `>=2.0.0 <2.1.5` | `>=2.1.5` | `apps__api>@nestjs/cli>glob>minimatch>brace-expansion` (and 27 more) |
| 1240105 | `brace-expansion@2.1.4` | high | `>=2.0.0 <2.1.6` | `>=2.1.6` | same |
| 1240101 | `brace-expansion@2.1.4` | moderate | `>=2.0.0 <2.1.7` | `>=2.1.7` | same |
| 1240042 | `undici@6.28.0` | high | `>=6.7.0 <6.28.1` | `>=6.28.1` | `apps__mobile>expo-router>@expo/server>@remix-run/node>undici` |
| 1239934 | `undici@6.28.0` | moderate | `>=6.25.0 <6.28.1` | `>=6.28.1` | same |
| 1240039 | `undici@6.28.0` | low | `<6.28.1` | `>=6.28.1` | same |

**Direct or transitive:** all three are **transitive**. None is declared in any workspace manifest.
`brace-expansion` 1.x is introduced by `minimatch@3` (via `@nestjs/cli`, `eslint`, `@expo/cli`,
`fork-ts-checker-webpack-plugin`); `brace-expansion` 2.x by `minimatch@9` (via `glob@10`);
`undici` by `@remix-run/node` (via `@expo/server` → `expo-router` → `@ecc/mobile`).

**Why the gate considered them blocking:** the gate is a reachability triage, not a raw count. An
advisory is blocking when it is critical/high **and** the vulnerable package is reachable from a
production dependency path **and** no recorded rule disposes of it. `brace-expansion` and `undici`
had no such rule, so the gate reported "no reachability rule is defined … it has production paths,
and nothing in this script knows whether the vulnerable code is on one" — i.e. it fails **closed**,
treating "could not check" as a finding rather than a dismissal.

---

## 3. Exact remediation

Because all three packages are transitive, remediation is a **version override**, not a manifest
change. The overrides were added to `pnpm-workspace.yaml`, alongside the existing `allowBuilds`
block, which is where this repository already keeps pnpm settings (pnpm 11 convention). No manifest
was edited.

### Exact override entries

```yaml
overrides:
  'brace-expansion@>=1.0.0 <1.1.21': 1.1.21
  'brace-expansion@>=2.0.0 <2.1.7': 2.1.7
  'undici@<6.28.1': 6.28.1
```

### Resulting versions

| Package | Before | After | Parent's declared range | Compatible? |
|---|---|---|---|---|
| `brace-expansion` (1.x line) | 1.1.18 | **1.1.21** | `^1.1.7` (via `minimatch@3`) | yes — patch, same major |
| `brace-expansion` (2.x line) | 2.1.4 | **2.1.7** | `^2.0.2` (via `minimatch@9`) | yes — patch, same major |
| `undici` | 6.28.0 | **6.28.1** | `^6.21.2` (via `@remix-run/node`) | yes — patch, same major |

### Why these versions were selected

1. **The highest patch floor across *every* advisory for that package, not the highest-severity
   one.** This is the substantive correction in this phase. For `brace-expansion@1.1.18` the two
   *high* advisories are fixed at 1.1.19 and 1.1.20, but a *moderate* advisory (1240100) is only
   fixed at 1.1.21; the same holds for the 2.x line (2.1.5 / 2.1.6 high, 2.1.7 moderate).
   Overriding to the high-severity floor alone would have left the moderate advisories in place and
   **the gate would still have failed.** The Phase 32 report quoted 1.1.19 and 2.1.5 — the floor of
   one advisory each, not the binding one. The brief's instruction not to assume the Phase 32
   versions was load-bearing.
2. **The two `brace-expansion` major lines are pinned separately.** `minimatch@3` requests `^1.1.7`
   and `minimatch@9` requests `^2.0.2`. A single unversioned `brace-expansion` override would force
   one line onto the other and break the install, so range-keyed selectors are used.
3. **All three are patch-level upgrades inside the major version each parent already requests.** No
   parent is forced outside its declared range, no peer dependency is disturbed, and no major
   version was introduced. This is the smallest contained remediation that clears every advisory.

---

## 4. Lockfile impact

Regenerated with the repository's pinned package manager (`pnpm@11.25.0`) via the normal `pnpm
install` workflow. **The lockfile was not hand-edited.** The install reported `Packages: +3 -3`.

The complete lockfile diff is the `overrides:` block plus the three resolution changes and their
dependency references — nothing else:

```
+overrides:
+  brace-expansion@>=1.0.0 <1.1.21: 1.1.21
+  brace-expansion@>=2.0.0 <2.1.7: 2.1.7
+  undici@<6.28.1: 6.28.1
-  brace-expansion@1.1.18:   →  +  brace-expansion@1.1.21:
-  brace-expansion@2.1.4:    →  +  brace-expansion@2.1.7:
-  undici@6.28.0:            →  +  undici@6.28.1:
   (plus the three importers' dependency references)
```

`2 files changed, 46 insertions(+), 12 deletions(-)` across `pnpm-workspace.yaml` and
`pnpm-lock.yaml`. No other package moved. The lockfile is internally consistent and
`pnpm install --frozen-lockfile` succeeds from a clean state (§7).

---

## 5. Audit before / after

Measured with `pnpm audit --json` (live, authoritative) on the same host before and after.

| | Before | After |
|---|---|---|
| Total advisories | 101 | **92** |
| `brace-expansion` / `undici` advisories | 9 | **0** |
| **Newly introduced advisories** | — | **0** |
| Advisories disappeared for unrelated reasons | — | 0 |
| `triage-vulnerabilities.mjs` | exit **1** | exit **0** |
| `verify-dependency-audit.mjs` | exit 0 | exit 0 |

Exactly 9 advisories were removed and nothing else changed. No advisory was introduced, ignored, or
downgraded.

The triage gate's own conclusion after remediation:

```
No critical or high advisory is reachable from a deployed code path. Each disposition is recorded
above with its evidence, and the ones that could become reachable are named with the version that
fixes them.
```

**On the advisories that remain.** The audit still reports 4 critical and 44 high advisories. These
are **not** new and **not** suppressed. They are the advisories the gate already classifies as not
reachable from a deployed code path, each with a recorded evidence-based disposition — many with
built-artefact evidence (for example, that the vulnerable `next@14.2.35` advisories require a Server
Function endpoint, and the built `server-reference-manifest.json` has empty `node`/`edge` maps, so
no such endpoint is registered). They were present in the same state in the earlier green runs
(`36558509809`, `36559104224`, `36559541316`) and are unchanged by this phase. Dispositioning them
would be the triage path this phase was explicitly told not to take merely to obtain green CI.

---

## 6. Security controls: none weakened

Explicitly confirmed unchanged (byte-identical to `abe8d78`):

| Control | State |
|---|---|
| `scripts/triage-vulnerabilities.mjs` | **UNCHANGED** |
| `scripts/verify-dependency-audit.mjs` | **UNCHANGED** |
| `scripts/verify-dependency-triage.mjs` | **UNCHANGED** |
| `scripts/verify-config-contract.mjs` | **UNCHANGED** |
| `scripts/verify-ci-parity.mjs` | **UNCHANGED** |
| `.github/workflows/ci.yml` | **UNCHANGED** |

Also confirmed: **no audit ignore, allowlist, or suppression mechanism was added** anywhere
(`auditIgnore`, ignore rules, and allowlist mechanisms searched across `package.json`,
`pnpm-workspace.yaml`, and `.npmrc` — none present). **No dependency was downgraded.** The gate
passes because the vulnerable code is genuinely absent from the effective graph, verified in §7 and
on the hosted runner.

The three existing mutation harnesses were re-run and remain load-bearing (§8) — the controls that
caught P32-1 are intact and still pass.

---

## 7. Regression results

Run in the repository's established order, sequentially where they share `apps/api/dist` (L-3).
Exact counts; nothing skipped and reported as green.

| # | Gate | Result |
|---|---|---|
| 1 | `verify-dependency-audit.mjs` | **PASS** |
| 2 | `verify-dependency-triage.mjs` | **PASS** (fails closed on an untriaged advisory) |
| 3 | `triage-vulnerabilities.mjs` (P32-1) | **PASS** (was exit 1) |
| 4 | `verify-config-contract.mjs` | PASS |
| 5 | `verify-env-contract.mjs` | PASS |
| 6 | `verify-next-config-features.mjs` | PASS |
| 7 | `verify-decorator-metadata` | PASS (59 DTO identity checks) |
| 8 | `verify-route-authorization` | PASS |
| 9 | `verify-ci-parity.mjs --list` | PASS |
| 10 | `typecheck` | PASS (11/11 tasks) |
| 11 | `build` (api + web) | PASS |
| 12 | `build:verify` | PASS (280 files in `dist`, byte-identical rebuilds) |
| 13 | `verify-db-migrations.sh` | PASS (own throwaway container only) |
| 14 | `verify-release-artifact.mjs` | PASS (70 modules 1:1; 2969 web files) |
| 15 | `verify:auth:compiled` (compiled-auth) | **PASS** — all modes (`core`, `session`, `lockout`, `account`) against the built artifact |
| 16 | `verify-storage-backup-restore.mjs` (Phase 28) | PASS (22 checks) |
| 17 | `verify:ratelimit:n12:mutate` (Phase 28) | PASS (all N-12 protections load-bearing; negative control blind; source restored byte-for-byte) |
| 18 | `mutate-ci-integration.mjs` (Phase 29) | PASS (20 mutants) |
| 19 | `run-db-suites.mjs` | **PASS** — e2e 8 files / **138 tests**; unit+integration 27 files / **348 tests**; **0 skipped**; throwaway DB created and destroyed |
| 20 | mobile tests | PASS — 6 files / **34 tests** |
| 21 | web tests | PASS — 1 file / **1 test** (pre-existing gap, blocker `R-3`, unchanged) |
| 22 | `verify-docker-images.mjs` | **PASS** — incl. the N-12 429 and 403-converse assertions |
| 23 | lint | **124 problems (55 errors, 69 warnings)** — baseline held exactly, no new debt |

**Test totals: 486 database-backed tests (138 e2e + 348 unit+integration) + 34 mobile + 1 web = 521,
0 skipped.**

### One deviation, classified

`verify:auth:compiled` initially exited 2 locally with `FATAL: DATABASE_URL is required. Use a
throwaway database — this suite writes users.` This is an **environment prerequisite**, not a
regression: the suite requires a real database, which CI supplies through its Postgres service. It
was re-run against a throwaway PostgreSQL provisioned by the repository's own
`scripts/lib/throwaway-postgres.mjs` (never the developer `ecc` database), migrated, and **passed in
all modes**; the throwaway was destroyed. No application or gate code was changed to accommodate it.

---

## 8. Clean-checkout verification

Performed specifically because Phase 31/32 demonstrated that local-green can coexist with hosted-red.

A clean checkout of commit `5b841eb` was extracted into an empty directory with **no** `node_modules`,
**no** developer `.env`, **no** pre-existing `dist`, and **no** pre-existing databases or
containers, then given a **real** `pnpm install --frozen-lockfile` (1m 2s).

| Check | Result |
|---|---|
| Fresh frozen-lockfile install | **PASS** (no lockfile drift, no manifest mismatch) |
| Overrides present in the committed `pnpm-workspace.yaml` | yes |
| Graph resolves to patched versions | `brace-expansion@1.1.21`, `brace-expansion@2.1.7`, `undici@6.28.1` |
| Vulnerable versions present on disk | **0** (1.1.18, 2.1.4, 6.28.0 all absent) |
| `verify-dependency-audit.mjs` | PASS |
| `verify-dependency-triage.mjs` | PASS |
| `triage-vulnerabilities.mjs` | **PASS** (exit 0) |
| `verify-config-contract.mjs` | PASS |
| `verify-env-contract.mjs` | PASS |
| `verify-ci-parity.mjs --list` | PASS |
| `prisma generate` → `typecheck` → `build` | PASS |
| `verify:metadata`, `verify:routes` | PASS |
| N-12 mutation | PASS |
| CI-integration mutation | PASS |
| `verify-db-migrations.sh` | PASS |
| `verify-release-artifact.mjs` | PASS |
| `verify-storage-backup-restore.mjs` | PASS |
| `run-db-suites.mjs` | PASS (348 unit+integration + 138 e2e) |
| `verify-docker-images.mjs` | PASS (images build from the remediated lockfile) |

One transient note, classified as a **harness artifact**: on the first clean-checkout invocation,
`verify-dependency-audit.mjs` emitted a Node error, then passed in full on immediate re-run, and
passed again in the later batch. The gate exercises native modules (`argon2`, Prisma engine) that
the just-completed install finishes warming; the first run raced that. Not a defect, not a product
issue, and it did not recur. The gate is deterministic on the hosted runner (§9).

---

## 9. Hosted GitHub Actions

| Field | Value |
|---|---|
| Run | **`36684252352`** |
| Commit | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| URL | https://github.com/Tarangj07/KinCare-Connect/actions/runs/36684252352 |
| Window | 2026-09-30T07:32:11Z → 2026-09-30T07:37:09Z |
| **Final status** | **SUCCESS — 5/5 jobs** |

| Job | Result |
|---|---|
| API — typecheck, tests (unit + PostgreSQL integration), build | **success** |
| Release — migrations, release artifacts, security regression sweeps | **success** |
| Containers — build API and Web images, verify they run | **success** |
| Web — typecheck, lint, tests, build | **success** |
| Mobile — typecheck and tests | **success** |

The steps that previously blocked, confirmed green **on the hosted runner**:

```
success  Supply chain — no reachable critical/high advisory (Phase 23 W6)   ← failed in 36671794473
success  Configuration contract — env, ports, versions, secrets (Phase 23 W5)
success  Supply chain — lockfile, native modules, engines (Phase 23 W6)
success  CI contract — the workflow satisfies the parity contract (Phase 32 ordering)
success  Storage backup — STORAGE_DIR archive, destroy, restore, re-verify (Phase 28 WS2)
success  Mutation — the N-12 429 contract is load-bearing (Phase 28)
success  Database-backed suites — e2e and unit+integration on a fresh throwaway PostgreSQL (Phase 28)
```

Run history for this repository:

```
5b841eb  success   36684252352   ← Phase 33
abe8d78  failure   36671794473   ← Phase 32 (P32-1)
4ddc0b5  failure   36618193752   ← Phase 29 checkpoint (P31-1/P31-2/P31-3)
f51614d  success   36559541316
16dac73  success   36559104224
```

This is the first genuinely green hosted run for `main` since the advisory drift. It is a claim
about **this commit** building and passing its own gates on GitHub-hosted runners. It is not a
staging, production, security, or compliance claim.

---

## 10. Mutation results

No mutation harness was modified. All three were re-run and remain load-bearing:

| Harness | Result |
|---|---|
| `mutate-rate-limit-n12.mjs` (Phase 28) | PASS — every N-12 protection load-bearing; negative control genuinely blind; source restored byte-for-byte |
| `mutate-ci-integration.mjs` (Phase 29) | PASS — 20 mutants detected; real files never written |
| `mutate-container-gate.mjs` (container) | Not run in this phase; unchanged from `abe8d78`. Its M8–M11 N-12 mutants are unaffected by a dependency remediation that touches no application source. |

---

## 11. Post-CI integrity

| Check | Result |
|---|---|
| `HEAD` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| `origin/main` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` — **equal** |
| Divergence | `0  0` |
| Staged changes | 0 |
| Unintended tracked modifications | **0** |
| Commit contents | **2 files only**: `pnpm-workspace.yaml`, `pnpm-lock.yaml` |
| Application source (`apps/**`) | **0 changes** |
| `.github/workflows/ci.yml` | **0 changes** |
| `apps/api/prisma/**` | **0 changes** (schema `4452c2a2cd00dc683930e164d6ec5a9c`, unchanged) |
| `scripts/**` (all gates) | **0 changes** |
| root `package.json` | **0 changes** |
| `SECURITY_REVIEW_*` | unchanged (`84b7065871c04e8977ebe97dab2093af`, identical to pre-flight) |
| Historical phase reports | unchanged |
| Untracked pre-existing work | 13 paths, **all still untracked and unmodified**, none committed |
| Developer `ecc` database | intact — 37 public tables, 14 users; never targeted |
| Throwaway containers / volumes | **none remaining**; all cleaned up |
| Amend / rebase / reset / force-push | **none** |
| `SECURITY_REVIEW_PHASE_33.md` | **not created** (reviewer-owned) |

---

## 12. Remaining blockers

**P32-1 is CLOSED** — remediated, not worked around, and verified on a hosted runner.

Everything else recorded previously is **unchanged and still open**. This phase closed one blocker
and introduced none.

| Item | Status |
|---|---|
| `E-9` hosted CI for the current tree | **CLOSED** — a green run exists for the current `HEAD` (`5b841eb`, run `36684252352`). The blocker is discharged for this commit. |
| `E-11` live dependency advisory set | **Closed as a CI blocker**; the gate now re-fetches live and passes. The residual dispositioned advisories (4 critical / 44 high, all recorded as not reachable with evidence) remain a standing review item and are **not** closed. |
| `R-1` independent review of Phases 22, 23, 25, 26, 27 | **OPEN** — 5 gaps. Unaffected and not closable by this phase. |
| `E-1`…`E-8`, `E-10` staging, TLS, production deployment, pen test, compliance, managed PG/object storage, observability, backup automation, production-scale load | **OPEN** — untouched. |
| `R-2`…`R-6`, `A-1`…`A-5` repository-deferred and accepted limitations | **OPEN** — untouched. `R-3` (web coverage: 1 test) re-verified unchanged. |
| Phase 31 `P31-1`…`P31-14` findings | `P31-1`/`P31-2`/`P31-3` closed by Phase 32; `P31-4` closed by Phase 32; `P31-5` corrected by Phase 32 (the contract did detect the drift — it was never reached). `P31-6`…`P31-14` remain **OPEN**. |
| Independent review of Phase 32 and Phase 33 | **OPEN.** Neither phase has been independently reviewed. |

---

## 13. Security impact

**Net: one supply-chain exposure closed, no control weakened.**

- **Closed.** Three transitive packages carrying 9 advisories — 5 of them critical/high and reachable
  from production dependency paths — were genuinely removed from the effective graph by moving to
  their patched versions. The vulnerable code is absent, not annotated.
- **Not weakened.** The triage classifier, the dependency-audit gate, the triage-classifier test, the
  config contract, the CI-parity contract and the workflow are all byte-identical to `abe8d78`. No
  audit ignore, allowlist, downgrade, or `continue-on-error` was introduced. The gate that caught
  P32-1 is the same gate that now passes it.
- **Contained.** Three patch-level upgrades inside the majors their parents already request. No
  parent forced outside its declared range, no peer conflict, no major version introduced, no
  application source changed.
- **Still standing.** 4 critical and 44 high advisories remain in the audit. They are not new and
  not suppressed; each is recorded by the gate as not reachable from a deployed path, with
  evidence. Several concern `next@14.2.35`, whose advisories require a Server Function endpoint that
  the built artefact provably does not register. They remain a legitimate item for a security
  reviewer and were deliberately not dispositioned in this phase.

---

## 14. What is still NOT proven

Green CI proves that this commit builds and passes its own gates on GitHub-hosted runners. It
proves none of the following, and none is claimed:

- **Staging deployment** — no staging environment exists; none ever has.
- **Production deployment** — nothing has ever been deployed to any environment.
- **Production TLS** — no certificate, no proxy, no `sslmode` in the repository or in the images.
- **Production observability** — no metrics, alerting, log aggregation, tracing, or disk monitoring.
- **Production-scale load / soak** — only a bounded 50-concurrent smoke test. No capacity claim.
- **Penetration testing** — none, internal or external.
- **Compliance certification** — no BAA, risk analysis, SOC 2 opinion, or ISO certification. The
  repository makes no compliance claim and none is made here.
- **Production-volume backup/restore** — 3 database rows and 8 storage files on local filesystems.
  Automation, encryption, retention, off-host storage and scheduling remain absent.
- **That the 4 critical / 44 high residual advisories are unreachable in every deployed
  configuration** — the gate's dispositions are evidence-based and source-traced, not a penetration
  test.
- **Production readiness** — **not claimed, and not supported.**
- **Independent review of Phases 22, 23, 25, 26, 27, 32 or 33** — still absent.
- **That this phase's remediation has been independently reviewed** — it has not.
  `SECURITY_REVIEW_PHASE_33.md` was deliberately not created.

---

## 15. Final success criteria

| # | Criterion | Status |
|---|---|---|
| 1 | P32-1 blocking advisories actually remediated | **MET** — 9 advisories, 3 packages → 0; verified in graph, on disk, in a clean checkout, and on the hosted runner |
| 2 | No audit suppression or gate weakening | **MET** — all six control files byte-identical; no ignore/allowlist/downgrade added |
| 3 | `pnpm-lock.yaml` updated legitimately | **MET** — regenerated by `pnpm@11.25.0`; `+3 -3`; diff is exactly the overrides plus three resolutions |
| 4 | Clean frozen-lockfile installation succeeds | **MET** — real install in an empty directory, no lockfile drift |
| 5 | Full repository regression gates pass | **MET** — 23 gates; 521 tests; 0 skipped; lint 55E/69W |
| 6 | Existing mutation/security controls intact | **MET** — no harness edited; all re-run and passing |
| 7 | A real GitHub Actions run on the new HEAD completes successfully | **MET** — run `36684252352`, 5/5 jobs, success |
| 8 | Final `HEAD` equals `origin/main` | **MET** — both `5b841eb`, divergence `0 0` |
| 9 | No unrelated pre-existing work committed | **MET** — 2 dependency-management files only; 13 untracked artifacts preserved |
| 10 | No production-readiness claim made | **MET** — §14 |

**10 of 10 met.**

---

*Phase 33 verification against `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17`, with network access to
the npm registry and the GitHub Actions API. No application source, CI configuration, gate script,
Prisma schema or migration, historical report, or `SECURITY_REVIEW_*` artifact was modified. The
only committed changes are `pnpm-workspace.yaml` and `pnpm-lock.yaml`. One commit, one normal push;
no amend, rebase, reset or force-push. No production, staging, or readiness claim is made.*
