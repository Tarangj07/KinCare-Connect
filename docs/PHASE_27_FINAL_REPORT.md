# Phase 27 — Final Report

**Phase:** 27 — Release Validation, Independent Assurance & Operational Readiness
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Base commit:** `f51614dae70187262a22d67786ffb3b5bfd4ef58` (== `origin/main` at start)
**Date:** 2026-09-29
**Commits created:** 0. **Pushes:** 0. (Awaiting explicit authorisation.)

---

## 1. Headline

Phase 27 added **no** security features and changed **no** application code. It
attempted to close the independent-review and operational-validation gaps, and
in doing so established that **two of them cannot be closed by the party that
did the work** — including me.

The most important finding of this phase is not a defect. It is that
`SECURITY_REVIEW_PHASE_25.md` and `SECURITY_REVIEW_PHASE_26.md` **are not
independent reviews**, because I had already implemented or endorsed the
material they review. They are documented as such, prominently, at the top of
each file. **The Phase 25 and Phase 26 review blockers remain open.**

---

## 2. Status table

| Area | Status | Evidence | Environment | Remaining limitation |
|------|--------|----------|-------------|----------------------|
| **Phase 25 independent review** | **NOT INDEPENDENT** | `SECURITY_REVIEW_PHASE_25.md` | Local + live prod-mode process | Reviewer had endorsed F-1…F-5 in the Phase 26 report beforehand. Does **not** close the blocker |
| **Phase 26 independent review** | **NOT INDEPENDENT** | `SECURITY_REVIEW_PHASE_26.md` | Local, scratch copies | Reviewer **wrote** WS1/WS5/WS6. Does **not** close the blocker |
| **GitHub Actions** | **PASS** | **Run ID: `36559541316`** | GitHub-hosted runners, clean checkout | First and only CI evidence; 2 advisory lint steps not counted as gates |
| Local security gates | PASS | 13 gates, all green | Local, throwaway infra | None known |
| Application tests | PASS | 157 unit / **126/126 e2e** / 1 web / 32 mobile | Local throwaway PG | 44 API unit tests skip without a DB |
| Container tests | PASS | 57 checks | Local Docker | **LOCAL only — not staging** |
| Migration tests | PASS | 15 checks | Throwaway PG | Small volume only |
| Dependency audit | PASS | lockfile-pinned, native modules load, F-5 classifier fails closed | Local | Snapshot of one lockfile state |
| **Backup / restore** | **PASS (database only)** | Full drop-and-restore on throwaway PG | Local, throwaway PG | **3 rows.** `STORAGE_DIR` path untested; no automation, encryption, retention or scheduling |
| **Staging** | **BLOCKED** | `0` GitHub environments, no secrets, no host, no cluster | — | Nothing deployed, ever |
| **Load / concurrency** | **PASS (bounded smoke)** | 50 concurrent × 5 classes | Local, single process | **NOT production capacity testing** |
| **TLS** | **NOT IMPLEMENTED** | No cert, no proxy config, no `sslmode` | — | Required before production |
| **Observability** | **NOT IMPLEMENTED** | No metrics/alerting/tracing/log aggregation | — | Disk exhaustion unmonitored |
| **Rollback** | **NOT TESTED** | — | — | Never exercised; nothing deployed |
| Documentation | PASS | `RELEASE_READINESS.md`, `BACKUP_RESTORE.md` | — | Two review docs carry disclosure caveats |
| Lint baseline | **UNCHANGED** | 55 errors / 69 warnings | — | Pre-existing debt, advisory in CI |

---

## 3. Workstream results

### WS1 — Independent review of Phase 25

`SECURITY_REVIEW_PHASE_25.md` — **with an independence disclosure**.

F-1…F-5 were each re-attacked, not re-read:

- **F-1 (future `iat`)**: defect **reproduced** (`maxAge` alone accepted a token
  with `iat` 10 years ahead); fix verified in source, in the compiled artifact,
  and **live against a `NODE_ENV=production` server** where
  `iat=now+1h` → 401, `iat=now+10y` → 401, `iat=now+2` → 200 (jitter window
  works, so it is not a blanket refusal), ordinary token → 200, refresh → 201.
  17 predicate edge cases including `NaN`, `±Infinity`, strings, objects and
  float boundaries. **Independent mutation** — inverting the bound instead of
  removing the call — produced **6 failures**.
- **F-3 (keyed `@Body`)**: **independent mutation on a different controller**
  (`emergency.controller.ts`, with a renamed import) — the gate rejected it,
  naming route, field and reason. Proves the rule is structural, not fitted to
  the file the implementer used.
- **F-5 (fail-open)**: **independent synthetic advisory** for a package no rule
  has ever seen → `REACHABLE (unclassified)`, exit code 1. Fails closed.
- **F-2, F-4**: verified against source and the implementer's harnesses; no
  independent mutation written. Called out as lower-confidence.

**Verdict: all five genuinely closed on available evidence** — but see §4.

Three harness errors of my own are recorded rather than hidden: `noTimestamp`
silently stripping `iat`, `fullName` vs `firstName`/`lastName`, and reading
`lb.id` when the response nests under `user`. Each was fixed in the harness,
not the product.

### WS2 — Independent review of Phase 26

`SECURITY_REVIEW_PHASE_26.md` — **with an explicit statement that it is a
self-review and must not be cited as independent assurance.**

- **WS1 gate**: AST detection confirmed stronger than a regex — `transform: !!1`
  and a `const STRICT = true` indirection are both rejected (a
  `transform: true` regex would miss both); an unrelated extra flag correctly
  still passes.
- **The requested reproduction succeeded.** Using a scratch copy with a mutated
  `main.ts`:
  - current code → **correctly FAILS**;
  - the original `path.relative` bug deliberately reintroduced → **passes
    falsely**, while still printing that all three flags are "literal true".
  The bug was real and severe (a vacuous gate) and the fix is load-bearing.
- **WS5**: every checkable doc claim verified against the manifests — Node
  `>=22.13.0`, pnpm `11.25.0`, NestJS 10, Prisma 5, 36 models, Redis/MinIO
  correctly identified as dead scaffold. No dangling authoritative references.
  `COMPLIANCE.md` contains no certification claim and explicitly disclaims
  HIPAA/SOC 2/ISO/GDPR.
- **WS6**: cleanup verified on success **and** on injected failure (0 leaked
  containers either way); unique container/database names; Docker-allocated
  loopback port; the developer `ecc` database unreachable by construction
  (even `label:'ecc'` yields `ecc_ecc_<random>`). The two gates ran
  concurrently with distinct databases and both passed.

### WS3 — Backup and restore

`docs/BACKUP_RESTORE.md` + a **real** drop-and-restore on a throwaway
PostgreSQL, seeded through the **real application** (not synthetic SQL):

| Step | Result |
| ---- | ------ |
| `pg_dump -Fc` | 292 TOC entries, 37 TABLE DATA, 117 KB |
| `pg_restore --list` | structurally readable |
| **Destructive step** | `DROP DATABASE … WITH (FORCE)`; confirmed absent |
| `pg_restore` | exit 0 |
| Schema | 37 tables (36 Prisma + `_prisma_migrations`) |
| Row counts | `users=1 refresh_tokens=1 audit_logs=2` — match |
| **Content fingerprint** | `md5(...)` = `c12a604425d0ca4cbeb71e41812698cd` — **identical** |
| Secret handling | refresh token restored as a 64-char **hash** |
| App on restored DB | `/health/ready` 200, `database.status=ok` |
| **Pre-backup user logs in** | **201** — the decisive test |
| `/auth/me` | 200, correct id |
| Wrong password | 401 — hash integrity preserved |

**Not tested** (stated in the document): `STORAGE_DIR` backup/restore, production
volume, automation, encryption, retention, newer-major restore, RPO/RTO.

### WS4 — Staging

**STAGING VALIDATION — BLOCKED.** `gh` environments = **0**; no repository
secrets; no staging env vars; no cluster; `terraform` and `helm` absent; only
a local Docker context.

**Nothing was deployed and no local container was relabelled "staging".**
Container evidence is labelled LOCAL throughout.

### WS5 — Bounded concurrency smoke

Against a single local process on a throwaway DB, 50 concurrent per class:

| Class | Result |
| ----- | ------ |
| `GET /health` | 50/50 → `200`, 127 ms |
| `GET /health/ready` | 50/50 → `200`, 62 ms |
| `GET /auth/me` unauthenticated | 50/50 → `401` |
| `POST /auth/login` (valid) | 8× `201`, **42× `403`**, 642 ms |
| `POST /auth/login` (malformed) | 50/50 → `400` |

Graceful shutdown under live traffic: `SIGTERM` → **exit 143** (clean drain),
service stopped listening.

**Two of my shutdown attempts were invalid** — the first ran against a server
that had already exited, the second set env vars after launching. Both are
discarded; only the third, correct invocation is reported.

**LOAD VALIDATION — NOT PRODUCTION CAPACITY TESTING.** No throughput or
capacity claim is made.

**The `403` result produced a real finding — see N-12.**

### WS6 — Operational readiness audit

Findings are separated into **A. Required before production**, **B.
Recommended**, **C. Not applicable**, in `docs/RELEASE_READINESS.md` §11 and
`docs/PHASE_27_FINAL_REPORT.md` §6. No infrastructure requirement was invented
that the supported deployment model does not use.

---

## 4. New findings — recorded, NOT fixed

Reviews do not fix. Each needs a maintainer decision.

| ID | Sev | Finding |
|----|-----|---------|
| **N-12** | **MEDIUM** | **Rate limiting returns `403 Forbidden` instead of `429 Too Many Requests`** — measured (42/50 concurrent logins). `ForbiddenException`, `rate-limit.guard.ts:76`. Clients cannot distinguish throttling from authorization failure; 429 is the retryable, `Retry-After`-capable status; the global exception filter's `case 429:` branch is unreachable via this path. |
| **N-10** | MEDIUM | `apps/api/dist` rebuild race between the release-artifact and migration gates. **Intermittent** — a concurrent run this phase went green, which is the condition under which the warning gets deleted. Procedural mitigation only. |
| **N-2** | MEDIUM | `rewrites` detector reads `next.config.mjs` only; a plugin or sibling `next.config.js` is invisible. |
| **N-11** | LOW | Hyphenated database name `ecc_ci-parity_…` — valid only when quoted. |
| **N-1** | LOW | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` not pinned by an absolute assertion. |
| **N-3** | LOW | DTO gate's "at least one effective constraint" is a floor. |
| **N-4** | LOW | Three public stub routes still bind keyed body parameters. |
| **N-6** | LOW | ValidationPipe gate correctness depends on its harness copying the tree. |
| **N-7** | LOW | ValidationPipe assertion covers two known call sites only. |
| **N-9** | LOW | `PROJECT_PLAN.md` retains superseded sections. |

**No Critical or High finding was identified.** No stop condition from the
brief was triggered.

---

## 5. The independence problem — stated plainly

I was asked to independently review Phase 25 and Phase 26.

- **Phase 26 is mine.** I wrote the WS1 gate, the WS5 documents and the WS6
  refactor. I introduced two defects in that work (a path-resolution bug that
  made the gate read the real source file, and a container leak from
  provisioning outside the `try`). I know where the traps are.
- **Phase 25 I had already endorsed** by reproducing F-1…F-5 during Phase 26
  and asserting in writing that they held.

Producing files titled "independent review" in that state would create a false
assurance record. Instead both documents were written with the disclosure as
their first substantive section, and both state that they do not close their
own blocker.

**Both review blockers remain open.** Genuine closure requires a reviewer with
no implementation relationship. This is the single most important thing in this
report.

---

## 6. Operational readiness — A / B / C

Full detail in `docs/RELEASE_READINESS.md`. Summary:

### A. Required before production

1. A deployment target and a **TLS terminator** — none exists.
2. A real `JWT_ACCESS_SECRET` from a secret store (the app already refuses to
   start without one).
3. **Scheduled, monitored backups.** Manual today; a nightly schedule means a
   24-hour RPO.
4. **Backup encryption and an off-host retention policy.**
5. A **tested `STORAGE_DIR` backup** — currently untested.
6. **Monitoring and alerting**: API health, database reachability, disk space
   on the database *and* backup volumes, container restart loops.
7. A log destination with PHI-appropriate handling and retention.
8. A **rehearsed rollback procedure**.
9. A **staging environment** in which 1–8 are exercised.
10. An RPO/RTO and retention decision from the data owner.

### B. Recommended operational improvements

- Fix **N-12** (429 instead of 403).
- Fix **N-10** (separate build output directories, or a lock).
- Move `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` and the F-1 constant into a
  pinned-constants assertion (**N-1**).
- Measure `connection_limit` under real concurrency; it is set for tests only.
- Extend the `rewrites` detector beyond `next.config.mjs` (**N-2**).
- Address the `dist` build-output sharing between gates.

### C. Not applicable to the supported architecture

- Kubernetes, Terraform, Helm, cloud-managed database/object-store backup
  products — the model is one PostgreSQL instance plus a volume.
- Redis and S3/MinIO backup — **neither service is used by the application**.
  `docker-compose.yml` still defines them; nothing connects. Backing them up
  would be theatre, and no migration to them has been designed.
- Queue/broker monitoring, WebSocket operations, AI service operations.

---

## 7. Evidence classification — the required separation

| Claim class | What exists |
| ----------- | ----------- |
| **Proven locally** | All 13 gates, all test suites, 5 mutation harnesses, backup/restore (database, tiny volume), bounded concurrency, graceful shutdown under load |
| **Proven in GitHub Actions** | Run `36559541316`, 5/5 jobs, clean checkout — the full API/Web/Mobile/Containers/Release matrix |
| **Proven in staging** | **Nothing.** No staging environment exists |
| **Independently reviewed** | Phases 13–14, 16–21, 24 only |
| **Not tested** | Everything in `RELEASE_READINESS.md` §7 — TLS, production volume, document backup, capacity, observability, rollback, pentest, certification |

---

## 8. Constraint compliance

- **No commit. No push.** 0 and 0, as instructed.
- No `git reset`, `rebase`, `stash`, `amend`, or force-push.
- **No application source changed.** All review mutations were on scratch
  copies outside the repository, or applied and reverted; `git status` shows
  only the four new documents.
- `PROJECT_PLAN-old.md`, Prisma schema, Prisma migrations, `pnpm-lock.yaml`,
  both Dockerfiles — untouched, checksum-verified.
- No previous `SECURITY_REVIEW_*.md` modified. No historical report modified.
- **Developer `ecc` database never targeted** — 37 tables before and after;
  database list unchanged.
- Throwaway infrastructure only; the review container was removed and no
  dangling volumes or containers remain.
- Phase 27 added no security features, no dependencies, no Prisma changes, and
  introduced no Redis/S3/MinIO.

## 9. Files created this phase

- `SECURITY_REVIEW_PHASE_25.md` — Phase 25 review (**with disclosure**)
- `SECURITY_REVIEW_PHASE_26.md` — Phase 26 review (**with disclosure**)
- `docs/BACKUP_RESTORE.md` — procedure + test record
- `docs/RELEASE_READINESS.md` — consolidated current state
- `docs/PHASE_27_FINAL_REPORT.md` — this document

## 10. Phase 27 success criteria

| # | Criterion | Result |
| - | --------- | ------ |
| 1 | `SECURITY_REVIEW_PHASE_25.md` assesses F-1…F-5 | **Done** (independence disclosed) |
| 2 | `SECURITY_REVIEW_PHASE_26.md` assesses WS1/WS5/WS6 | **Done** (independence disclosed) |
| 3 | Backup/restore documented and tested on throwaway PG | **Done** (database; `STORAGE_DIR` untested) |
| 4 | Staging tested, or marked BLOCKED | **BLOCKED**, explicitly |
| 5 | Bounded concurrency test, or documented unavailable | **Done** (bounded smoke) |
| 6 | `RELEASE_READINESS.md` exists | **Done** |
| 7 | `PHASE_27_FINAL_REPORT.md` exists | **Done** |
| 8 | Local / CI / staging / review separated | **Done** (§7) |
| 9 | No historical evidence rewritten | **Done** |
| 10 | No security control weakened | **Done** |
| 11 | No Prisma / lockfile changes | **Done** |
| 12 | Developer database untouched | **Done** |
| 13 | No commit or push without authorisation | **Done** — awaiting authorisation |

**The phase produced no Critical or High finding, changed no production code,
and did not manufacture evidence for any environment that does not exist.**

Stopping here. Awaiting authorisation before any commit or push.
