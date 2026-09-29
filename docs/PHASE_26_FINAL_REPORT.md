# Phase 26 — Final Report

**Phase:** 26 — Release-Candidate Assurance
**Repository:** Elderly Care Coordination Platform (`KinCare-Connect`)
**HEAD at start and end of phase:** `d0cd0dd2f175ae881bd201eb26d7e74a0c4158be` — "Complete Phase 17 testing CI and reliability"
**Branch:** `main` (uncommitted Phase 18–25 work preserved throughout)
**Toolchain:** Node v24.18.0 · pnpm 11.25.0 · Docker 29.8.1 · `pnpm-lock.yaml` SHA256 `bc20d17e…4ec3b8`
**Phase 27:** not started.

---

## A. Implemented

Four workstreams were actionable. Two were blocked by missing external
infrastructure and are recorded as blocked, not worked around.

| WS | Workstream | Outcome |
| -- | ---------- | ------- |
| WS1 | ValidationPipe strictness gate | **Implemented and mutation-tested.** Extended `scripts/verify-config-contract.mjs` §8 rather than adding a new gate |
| WS2 | Phase 25 independent review | **Not performed** — see §F. Deliberately left to a reviewer |
| WS3 | Staging | **Blocked** — see §E |
| WS4 | GitHub Actions | **Blocked** — see §E. `ci.yml` modified locally only |
| WS5 | Documentation alignment | **Implemented** — `README.md`, `PROJECT_PLAN.md`, `COMPLIANCE.md` |
| WS6 | Gate determinism | **Implemented and negative-tested.** Extends to `verify-ci-parity.mjs`, which had the same defect |

### WS1 — ValidationPipe strictness

The gap: nothing asserted that the global `ValidationPipe` still carries
`transform`, `whitelist` and `forbidNonWhitelisted`. Deleting any one of them
would leave every gate green while unrecognised request properties began being
accepted.

Rather than create a new gate, section 8 was added to the existing source-level
configuration audit, which already asserted other invariants of the same kind
(notably the rate-limit bypass's `NODE_ENV=test` guard). Reusing it keeps the
assertion in the same place as the rest of the configuration contract and
inherits its existing mutation harness.

The assertion is **AST-based**, using the `typescript` package already in the
dependency graph — no dependency was added. A regular expression would have
accepted `transform: !!1`, `transform: process.env.X`, or a property inside a
nested object; the AST check reads the flag's literal value and rejects
anything that is not the literal `true`.

It is asserted at **two** sites, both required to pass:

- `apps/api/src/main.ts` — the production bootstrap
- `apps/api/src/testing/create-test-app.ts` — the e2e harness

The second is included because the harness deliberately mirrors the production
pipeline. A divergence there means a spec asserts behaviour production does not
have — the exact tested-system/shipped-system gap Phase 22 proved
load-bearing. It also fails if no global pipe is registered at all, or if a
pipe is registered from an identifier whose options cannot be verified
statically, rather than passing silently in either case.

**No application source was changed.** The gate reads `apps/api/src/**` and
does not modify it.

### WS6 — gate determinism

`scripts/verify-release-artifact.mjs` and `scripts/verify-ci-parity.mjs` both
defaulted to `127.0.0.1:55432/ecc_p23`, a database neither created. Fixed by
extracting `scripts/lib/throwaway-postgres.mjs` and having both gates call it.

Properties of the shared implementation, each chosen because its absence is a
way to produce a *wrong answer* rather than an error:

- unique container name **and** unique database name per run
- host port allocated by the Docker daemon (a hardcoded port is precisely what
  let one gate connect to another's database), published on loopback only
- real readiness: a successful query, then a settle, then a second query — the
  official image runs a temporary server during init and restarts, so one
  probe can succeed and be followed by "the database system is shutting down"
- `migrate deploy` applied before any check boots the application
- idempotent destruction, safe from a `finally`, an `exit` handler and a
  signal handler simultaneously
- database name always prefixed, so `ecc` is unreachable even by a bug
- never touches the Prisma schema or migrations

**Artifact/migration gate mutual exclusion is documented** in the header of
`verify-release-artifact.mjs`: both gates delete and rebuild
`apps/api/dist` and `tsconfig.build.tsbuildinfo`, and the migration gate
executes `node dist/main.js`, so concurrent runs let one delete the artifact
the other is running. The databases are now independent; the remaining shared
resource is the build output directory.

### WS4 (permitted local scope)

`ci.yml` was not modified. `verify-ci-parity.mjs` was wired into local
execution and now provisions its own database. **No commit and no push were
performed.**

---

## B. Verified locally

Every gate below was executed against this working tree during Phase 26.
Gates that rebuild `apps/api/dist` were run **sequentially**, not
concurrently.

### Build, test, typecheck, lint

| Gate | Result |
| ---- | ------ |
| `pnpm -r typecheck` | **PASS** — all 8 workspaces |
| `pnpm -r lint` | Baseline unchanged — `apps/api`: **55 errors / 69 warnings**, exactly the Phase 25 baseline. Fails on `--max-warnings 0` by design (see §H) |
| `pnpm -r test` (unit) | **PASS** — `apps/api` 157 passed / 44 skipped (201); `apps/web` 1 passed; `apps/mobile` 32 passed |
| `pnpm --filter @ecc/api test:integration` (e2e, real PostgreSQL) | **PASS** — **126 passed / 126**, 7 files. Run against a Phase 26 throwaway database |
| `pnpm -r build` | **PASS** — api, web, mobile, all packages |

The e2e suite is **skipped by default** (`test:integration` reported 126
skipped without a `DATABASE_URL`). Rather than report that as coverage, a
throwaway PostgreSQL was provisioned and the suite run against it: **126/126
pass**. The skipped-by-default behaviour is not itself a defect, but the number
of e2e tests actually executing is recorded here so it cannot be read as zero.

### Security and release gates

| Gate | Result |
| ---- | ------ |
| `verify:metadata` | **PASS** — 91 metadata entries, 0 `Function` entries, 59 DTO identity checks |
| `verify:routes` | **PASS** — every non-public live route guarded; public allow-list matches reality |
| `build:verify` | **PASS** — clean, warm and stale-tsbuildinfo builds each emit `dist/main.js`; 0 spec/test files in dist |
| `verify:auth:compiled` | **PASS** — all 4 modes (`core`, `session`, `lockout`, `account`) against the built artifact with production config, real limiter, no test escape hatch |
| `verify-env-contract` | **PASS** |
| `verify-config-contract` | **PASS** (now includes §8, the WS1 gate) |
| `verify-db-migrations.sh` | **PASS** — all checks; also independently re-confirmed D-2 and F-1 behaviour |
| `verify-release-artifact.mjs` | **PASS** — all 14 checks (9 API + 5 Web), on a self-provisioned throwaway database |
| `verify-docker-images.mjs` | **PASS** — API and web images, runtime behaviour, storage modes, SIGTERM drain |
| `verify-dependency-audit.mjs` | **PASS** — lockfile-pinned, native modules load (argon2id verified), 5 install-time code-execution points reported |
| `verify-dependency-triage.mjs` | **PASS** — untriaged advisory is a finding, not a disposition |
| `verify-ci-parity.mjs` | **PASS** — 39 locally-runnable commands executed, **0 failed**; 3 need the remote runner; 6 skipped by deliberate choice |

### Specific claims reproduced rather than trusted

Per the evidence principle, prior-phase claims were reproduced against the
current tree rather than taken from the reports:

- **D-2 (token lifetime bounded):** reproduced by `verify-db-migrations.sh` —
  "a one-hour-old token with a ten-year exp -> 401".
- **F-1 (future `iat` rejected):** reproduced — "a token with `iat` five minutes
  in the future -> 401", "a ten-year future `iat` and `exp` -> 401", and the
  negative control "an ordinary fresh token is still accepted".
- **F-3 (keyed `@Body` on a live route):** the `verify:routes:mutate` gate
  reports M8 as Phase 25 F-3 and it passes.
- **F-4 (rewrites triage):** the `verify-next-config-features` gate and its
  mutation harness pass, and are wired into the CI-parity run.

---

## C. Independently reviewed

**Nothing in this phase has been independently reviewed, and nothing here
should be read as reviewed.**

- The Phase 26 work (the WS1 gate, the WS6 refactor, the documentation) has
  had no independent review. `SECURITY_REVIEW_PHASE_26.md` **does not exist**
  and was deliberately **not** created — see §F.
- The Phase 25 implementer reported findings **F-1 … F-5** as fixed and
  mutation-tested. Those claims were **reproduced** by this phase's local runs
  (§B), which is evidence that the fixes behave as described. **Reproduction
  by the implementer's successor is not independent review.** See §F and §M.

---

## D. Externally verified

**Nothing. No external verification of any kind was performed or exists.**

Specifically **not** claimed:

- GitHub Actions — **no run ID exists.** `gh run list` returns empty.
- Staging — **does not exist.** No environment was contacted.
- Production — **no deployment, rehearsed or otherwise.**
- Backup/restore — **never performed**, not even locally.
- Penetration testing — **never performed**, internal or external.
- Load / soak / chaos testing — **never performed.**
- Compliance certification — **none exists.** See `COMPLIANCE.md`.

---

## E. Blocked by missing external infrastructure or access

### WS3 — STAGING: **BLOCKED**

The pre-flight established there is no staging environment, no GitHub
environments, no repository secrets, no staging host, no Kubernetes/Helm/
Terraform, and nothing listening on a staging PostgreSQL endpoint.

**No local container was relabelled "staging."** All container and database
verification in §B is labelled **LOCAL** and runs against throwaway containers
on loopback. It is not staging and is not evidence about a deployed system.

No cloud infrastructure, Kubernetes, Terraform or Helm was created.

### WS4 — GITHUB ACTIONS: **BLOCKED**

- `origin/main` is `d06e6f8`; local `HEAD` is `d0cd0dd`. Local history contains
  security work absent from `origin/main`, and `origin/main` has **deleted**
  substantial Phase 16–25 security artefacts.
- `ci.yml` is **not present on `origin/main`**.
- A genuine remote CI run therefore requires committing and pushing this work
  and reconciling that divergence. **The implementer is not authorised to
  commit or push.** No commit, push, force-push, rebase, reset, amend or stash
  was performed.

**This is a release blocker, not a documentation gap.** Until it is resolved,
none of the assurance in §B has ever executed on a GitHub-hosted runner.

---

## F. Deferred

### WS2 — Phase 25 independent review: **PENDING (not performed by the implementer)**

The Phase 25 implementer must not review their own work, and
`SECURITY_REVIEW_PHASE_26.md` is reviewer-owned. **It was not created.**

What a separate reviewer needs to reproduce F-1 … F-5:

| Finding | Reproduce with | Expected |
| ------- | -------------- | -------- |
| F-1 (future-`iat` token acceptance) | `bash scripts/verify-db-migrations.sh` → "an authenticated round trip" step | "a token with `iat` five minutes in the future -> 401"; "a ten-year future `iat` and `exp` -> 401"; "an ordinary fresh token is still accepted" |
| F-2 | `pnpm --filter @ecc/api verify:auth:compiled` (needs `DATABASE_URL` at a throwaway DB, `STORAGE_DIR`) | mode `core` passes, including all 13 token-defect cases → 401 |
| F-3 (keyed `@Body` on a live route) | `pnpm --filter @ecc/api verify:routes:mutate` | M8 detected |
| F-4 (rewrites triage rule shape) | `node scripts/verify-next-config-features.mjs` + `node scripts/mutate-next-config-rewrites.mjs` | gate passes; mutant rejected |
| F-5 | per `docs/PHASE_25_FINAL_REPORT.md` | per that report |

All five are covered by `pnpm --filter @ecc/api verify:routes:mutate`,
`verify:lifetime:mutate`, `verify:auth:compiled` and `verify-db-migrations.sh`,
all of which passed locally in §B. **That is reproduction, not review.**

### Also deferred

- Any Phase 27 work. Not started.
- Backup/restore procedure and rehearsal.
- Penetration, load and soak testing.
- Monitoring, metrics, alerting, log aggregation.
- Realtime (Socket.IO), Redis migration, MinIO/S3 migration, AI/OCR,
  EHR/GPS/payments, dashboard redesign, mobile features, auth redesign — all
  explicitly out of scope.

---

## G. Documentation changes

Current-state documentation only. **No historical phase report was rewritten.**

### `README.md` (rewritten)

Was stale: claimed "Phase 1 — monorepo foundation complete", "No business
logic yet", Node 20+, and a quick start requiring Redis and MinIO.

Now states what the system is, its actual implementation state, the real
architecture and modules, the supported local/deployment model, the real
Node/pnpm requirements, how to run it, what assurance is verified, what is
**not** externally verified, and what remains deferred. It is not a phase
history — that stays in `docs/PHASE_*.md`.

Two corrections worth flagging because they were asserted and then checked:

- **Redis and MinIO are dead scaffold.** `docker-compose.yml` still defines
  both, but no Redis client is a dependency and documents are stored on the
  local filesystem under `STORAGE_DIR`. The README now says so explicitly
  rather than sending a reader to start two services nothing connects to.
- Framework versions were initially written as NestJS 11 / Prisma 6 / 31
  models. Checked against the manifests: **NestJS 10, Prisma 5, 36 models**,
  corrected before completion.

### `PROJECT_PLAN.md` (updated in place)

Was stale: claimed "Phase 15 complete", "Next milestone: Phase 16".

- Header now states the current milestone (Phase 26), the real current state,
  and that Phase 27 is not authorised.
- Added a **"Phase numbering"** section reconciling the two incompatible
  vocabularies. This plan and `docs/` diverged from Phase 18 onward: the plan's
  speculative §9 "Phase 18 — Observability", §10 "Phase 19 — Production
  Deployment" and §11 "Phase 20 — AI Service Boundary" were **never the phases
  that ran**. Actual Phases 18–26 are tabulated with their reports.
- The superseded sections are marked **SUPERSEDED** with what was and was not
  delivered, and retained unaltered rather than deleted. The divergence is
  documented, not erased.
- §5 rewritten with the true milestone, a report/review table, and §5.2
  **release blockers**.
- §6 "not yet complete" retained with **status notes** on the two items that
  partially changed (deployment, E2E coverage) rather than silently rewritten.
- §15 rewritten: real completed list, current focus, and a new §15.4
  "Not verified — do not represent as done".
- The Definition of Done is annotated: every criterion is met **except**
  "the phase is checkpointed in Git", because committing is not authorised.
- The §16 philosophy ordering is revised, with the reason: observability and
  deployment have moved down because until the code is committed, CI-run and
  deployed, further work has no consumer.

`PROJECT_PLAN-old.md` was **not modified** (checksum verified).

### `COMPLIANCE.md` (created — option A)

Option A was chosen: `ARCHITECTURE.md` §1 and §6, `SECURITY.md` and
`THREAT_MODEL.md` all defer to this document, so removing the references would
have been the more disruptive choice.

It contains **only** claims supportable from the repository, each tied to the
gate that verifies it, and states plainly what it does **not** claim: no HIPAA,
SOC 2, ISO, GDPR or other regulatory or legal compliance; no penetration,
load or soak testing; no staging or production capability; no backup or
restore. Section 6 is largely a list of things that do not exist, including
TLS termination and application-level encryption at rest. Section 7 lists the
organisational controls that are the deployer's responsibility and are out of
scope for a code repository.

Claims were spot-checked against source before being written (Argon2id, the
`auditLog` writers, `DocumentAccess` enforcement, Helmet, `httpOnly` cookies,
the readiness endpoint).

The three dangling references were corrected: `ARCHITECTURE.md` §1 and §6 and
`SECURITY.md`'s header no longer say the document "will be added in Phase 1".
`THREAT_MODEL.md`'s reference was already correct and was left alone.

---

## H. Test and gate results

Sequential, no concurrency. Every gate green.

```
typecheck                 PASS
lint (apps/api)           55 errors / 69 warnings  — unchanged from Phase 25 baseline
unit tests                PASS  157 api / 1 web / 32 mobile  (44 api skipped)
e2e tests (real PG)       PASS  126/126
build                     PASS
verify:metadata           PASS
verify:routes             PASS
build:verify              PASS
verify:auth:compiled      PASS  4/4 modes
verify-env-contract       PASS
verify-config-contract    PASS  (incl. WS1 §8)
mutate-config-contract    PASS  15/15 mutants
verify:metadata:mutate    PASS
verify:routes:mutate      PASS  8/8 mutants
verify:lifetime:mutate    PASS
verify-db-migrations.sh   PASS  9/9 checks
verify-release-artifact   PASS  14/14 checks
verify-docker-images      PASS
verify-dependency-audit   PASS
verify-dependency-triage  PASS
verify-ci-parity          PASS  39 executed / 0 failed
```

**On the lint baseline.** `pnpm -r lint` exits non-zero because
`apps/api` runs with `--max-warnings 0`. This is pre-existing and matches the
Phase 25 baseline exactly — Phase 26 did not add a single error or warning. The
ci-parity harness runs it as an explicitly labelled **advisory** step
(`continue-on-error`) whose name states it is pre-existing debt, rather than
letting it masquerade as either a passing gate or a Phase 26 regression. It
remains a tracked debt item, not a solved one.

**Historical discrepancy found (not rewritten).** Phase 22/23-era reports
describe `verify-ci-parity.mjs` as passing. On a machine without the leftover
`55432` database it reported **3 failures** — a false alarm, not a regression.
This is exactly the determinism defect WS6 was created to fix, and it is
recorded here as a correction to an earlier implicit claim rather than by
editing that phase's report.

---

## I. Mutation results

A gate that has never been shown to fail is not evidence of anything.

### WS1 — new (`mutate-config-contract.mjs`, M9–M15)

| Mutant | Detected |
| ------ | -------- |
| M9 `transform` removed from `main.ts` | **YES** |
| M10 `whitelist` removed | **YES** |
| M11 `forbidNonWhitelisted` removed | **YES** |
| M12 `whitelist` set to `false` rather than removed | **YES** |
| M13 flag expressed as a conditional, not a literal | **YES** |
| M14 test harness weakened while production is strict | **YES** |
| M15 the whole `useGlobalPipes` registration removed | **YES** |

M9/M10/M11 are the four required proofs (M9–M11 + the clean baseline). M12–M15
beyond them, covering the ways a deletion-only assertion would be vacuous.

M9–M11 **initially passed the mutation test while the gate was broken** — the
first run showed 7 FAILs. The cause was a defect in the gate I had just
written: `path.relative(repoRoot, relFile)` was applied to an already-relative
path, so under the mutation harness it resolved against the process cwd and
read the **real repository's** `main.ts` instead of the mutant's. The gate
appeared to pass because it was auditing a different file than the one under
test. Fixed by resolving against `repoRoot` explicitly. This is worth
recording explicitly: the mutation harness caught a bug in the *gate*, which is
the whole reason it exists.

### WS6 — negative tests

| Scenario | Result |
| -------- | ------ |
| Gate run with no pre-existing database, nothing else running | **PASS** — provisioned its own, cleaned up |
| Assertion failure **after** provisioning and migration | **PASS** — 1 check failed, **no container left behind** |
| Failure **during** provisioning (container up, readiness never reached) | **PASS** — **no container left behind.** This was the original leak: provisioning originally sat outside the `try`, so this case leaked a container. Found and fixed |
| `verify-ci-parity.mjs --list` | **PASS** — provisions nothing. A reader who only wants an inventory does not get a database |
| Full `verify-ci-parity.mjs` run | **PASS** — 0 failures (was 3), no container left behind |

The harness restores the script from a backup after each injected failure; the
file was verified byte-identical to its pre-test state afterwards.

---

## J. Git integrity

**Baseline captured before any modification, and re-verified at end.**

| Check | Result |
| ----- | ------ |
| `git log -1 --oneline` | `d0cd0dd` at start **and** end — unchanged |
| `git diff --cached --name-only` | Empty at start **and** end — nothing staged |
| `git reset` / `clean` / `checkout` / `restore` / `rebase` / `amend` / `stash` | **None performed** |
| Commits created | **None** |
| Pushes / force-pushes | **None** |
| Phase 18–25 uncommitted work | **Preserved** — 41 → 44 modified tracked files; the 3 additions are Phase 26's own doc edits |
| Modified by Phase 26 | `README.md`, `PROJECT_PLAN.md`, `COMPLIANCE.md` (new), `ARCHITECTURE.md` §1/§6, `SECURITY.md` header, `scripts/verify-config-contract.mjs`, `scripts/mutate-config-contract.mjs`, `scripts/verify-release-artifact.mjs`, `scripts/verify-ci-parity.mjs`, `scripts/lib/throwaway-postgres.mjs` (new) |

Protected files verified **byte-identical by SHA256**:

- `pnpm-lock.yaml` — `bc20d17e46fda82c8eeef4dabdd202a68a767356151401f24c731391ac4ec3b8` ✓ unchanged
- `PROJECT_PLAN-old.md` ✓ unchanged
- All 12 `SECURITY_REVIEW_PHASE_*.md` ✓ unchanged
- `apps/api/prisma/schema.prisma` ✓ unchanged
- All 3 `apps/api/prisma/migrations/**` files ✓ unchanged

---

## K. Database integrity

| Check | Result |
| ----- | ------ |
| Development database `ecc` | **Untouched.** 37 tables before and after every gate run |
| Databases on the developer server | `ecc`, `postgres`, `template0`, `template1` — unchanged, no strays |
| `prisma/schema.prisma` | Unmodified (checksum) |
| `apps/api/prisma/migrations/**` | Unmodified (checksum) |
| Verification databases | All throwaway, uniquely named, explicitly created and destroyed, verified absent after each run |
| Leaked containers after any run | **Zero**, including after deliberately injected failures |
| `DATABASE_URL` for the e2e suite | A Phase 26 throwaway container, never `ecc` |

---

## L. Files intentionally not touched

Per the phase's mandatory scope rules, none of these was modified:

`apps/api/src/**` (as Phase 26 implementation — read only, by the WS1 gate) ·
`apps/api/prisma/schema.prisma` · `apps/api/prisma/migrations/**` ·
`pnpm-lock.yaml` · any package manifest · `apps/api/Dockerfile` ·
`apps/web/Dockerfile` · `apps/mobile/**` · `docker-compose.yml` ·
`PROJECT_PLAN-old.md` · any `SECURITY_REVIEW_*` · any historical Phase 16–25
report · `ci.yml` · `.env.example` · `THREAT_MODEL.md`

No dependency upgrade. No Prisma change. No application feature development.

---

## M. Remaining release blockers

1. **Phase 18–26 work is uncommitted.** Not authorised to commit. Until it is,
   no CI runner can execute any of it.
2. **`origin/main` divergence.** `origin/main` (`d06e6f8`) is behind local
   `HEAD` (`d0cd0dd`) and has deleted substantial Phase 16–25 security
   artefacts; `ci.yml` is absent from it. Reconciling needs an explicit
   commit/push authorisation and a deliberate history decision.
3. **No GitHub Actions run exists.** `gh run list` is empty.
4. **No staging environment.** Nothing has ever been deployed.
5. **No backup or restore has been tested.** No backup job, schedule or
   procedure exists; no restore has been performed, not even locally.
6. **Independent review of Phase 25 is outstanding.** F-1…F-5 are reproduced
   by this phase but unreviewed.
7. **Lint debt**: 55 errors / 69 warnings in `apps/api`, tracked and
   advisory. Must not grow.
8. **No TLS termination or application-level encryption at rest** is configured
   in this repository; both are assumed to be the deploying platform's
   responsibility and are documented as such.

---

## N. Phase 27 has not started

No Phase 27 work was begun, scoped or scheduled. The phase ends here.

The correct next action is **not** another phase of code work. It is to obtain
authorisation to commit and push, reconcile `origin/main`, and obtain a real
GitHub Actions run — because until that happens, the entire body of assurance
in §B has never executed anywhere but this machine, and no further phase can
change that.
