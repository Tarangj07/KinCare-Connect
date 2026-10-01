# Release Readiness — KinCare-Connect

**For a cold reviewer.** Written 2026-09-29, at
`f51614dae70187262a22d67786ffb3b5bfd4ef58`.

This document uses **evidence, not scores**. There is no security rating here
and no claim that the system is "secure", "certified" or "production ready".
Those words are not used because the evidence does not support them.

---

## 1. What is KinCare-Connect?

A multi-tenant elderly-care coordination platform. Families, professional
caregivers and the seniors they support use it to share health measurements,
documents, schedules, care tasks, medication history, messaging, notifications
and emergency alerts, with access scoped by organisation membership and
care-circle role.

It is **not** an EMR, not a clinical decision-support system, and not a
prescribing tool.

## 2. What components exist?

| Component | Technology | Port | State |
|-----------|-----------|------|-------|
| API | NestJS 10 on Express, Prisma 5, PostgreSQL 16 | 3000 | Implemented, tested |
| Web | Next.js 14 App Router | 3001 | Implemented, tested |
| Mobile | Expo / React Native | — | Implemented; **not** covered by container or release gates |
| Shared packages | `config`, `types`, `validation`, `ui` | — | Implemented |

Data model: **36 Prisma models** covering identity, organisations and
subscriptions, senior/caregiver profiles, care circles, medications,
appointments, care tasks, health measurements and devices, documents and access
grants, feed, messaging, notifications, emergency alerts, audit logs, consent
and invitations.

## 3. What is the supported deployment architecture?

Exactly what `docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md` describes:

```
reverse proxy / TLS terminator   (NOT provided by this repository)
        │
   ┌────┴────┐
 web (3001)  api (3000)          both containers, non-root (uid 1000)
                  │
            PostgreSQL 16        single instance, named volume
                  │
            STORAGE_DIR          persistent volume, documents (0600 in 0700)
```

Explicitly **not** part of the supported model, and deliberately not
introduced: Kubernetes, Terraform, Helm, cloud-managed databases, Redis,
S3/MinIO, message brokers. `docker-compose.yml` still defines `redis` and
`minio` services, but **no application code connects to them** — they are
leftover scaffold, and no migration to them has been designed or attempted.

## 4. What has actually been tested, and where?

This is the section that matters. Read the **Environment** column.

### 4.1 Verified in GitHub Actions (real hosted runners)

Run **`36559541316`**, commit `f51614d`, **SUCCESS**, 5/5 jobs, monitored to
completion. This is the first and only line of evidence produced by a CI
runner that is not this laptop.

| Job | Result |
|-----|--------|
| API — typecheck, tests (unit + PostgreSQL integration), build | success |
| Web — typecheck, lint, tests, build | success |
| Mobile — typecheck and tests | success |
| Containers — build images, verify they run | success |
| Release — migrations, release artifacts, security regression sweeps | success |

Within those jobs, green on a **clean checkout**: Prisma generate/validate,
migrations on a fresh CI database, build determinism, decorator-metadata
parity, route authorization, configuration contract, dependency audit,
vulnerability triage, the F-4 and F-5 gates, unit tests, integration tests
against a real PostgreSQL service, the fail-closed production contract,
deployment smoke, the **full compiled authentication suite**, an
authenticated round-trip, migration safety on throwaway databases,
release-artifact integrity and reproducibility, and five mutation harnesses.

**Two CI steps are `continue-on-error` and are advisory by design**, and are
**not** counted as passing gates: API lint (55 errors carried from the Phase 16
checkpoint) and Mobile lint.

### 4.2 Verified locally (this machine, throwaway infrastructure)

| Verification | Result |
| ------------ | ------ |
| `pnpm -r typecheck` | PASS |
| `pnpm -r build` | PASS |
| API unit tests | 157 passed / 44 skipped |
| API e2e + security tests | **126/126** against a throwaway PostgreSQL |
| Web / Mobile tests | 1 / 32 passed |
| Lint (`apps/api`) | **55 errors / 69 warnings — the established baseline, unchanged** |
| `verify-config-contract` | PASS (incl. the Phase 26 ValidationPipe gate) |
| `mutate-config-contract` | PASS, 15/15 mutants |
| `verify-env-contract` | PASS |
| `verify-dependency-audit` / `-triage` | PASS |
| `verify-next-config-features` | PASS |
| `verify-decorator-metadata` / `verify-route-authorization` | PASS |
| `build:verify` | PASS |
| `verify:auth:compiled` (4 modes) | PASS |
| `verify-db-migrations.sh` | PASS, 15 checks |
| `verify-release-artifact.mjs` | PASS, 13 checks |
| `verify-docker-images.mjs` | PASS, **57 checks** |
| `verify-ci-parity.mjs` | PASS, 39 commands, 0 failures |
| Mutation harnesses (5) | PASS |
| **Backup + restore (Phase 27)** | PASS on throwaway PostgreSQL — see §11 |
| **Bounded concurrency smoke (Phase 27)** | PASS — see §12 |

### 4.3 Verified in staging

**Nothing. No staging environment exists.** See §8.

## 5. Which controls have independent review?

This is the weakest area, and the table is deliberately unflattering.

| Subject | Review document | Independence |
| ------- | --------------- | ------------ |
| Phase 13, 14 | `SECURITY_REVIEW_PHASE_13*.md`, `_14.md` | Genuinely independent |
| Phase 16, 17 | `SECURITY_REVIEW_PHASE_16.md`, `_17.md` | Genuinely independent |
| Phase 18, 19, 20, 21 | `SECURITY_REVIEW_PHASE_18…21.md` | Genuinely independent |
| Phase 24 | `SECURITY_REVIEW_PHASE_24.md` | Genuinely independent |
| **Phase 25** | `SECURITY_REVIEW_PHASE_25.md` | **NOT independent** — see below |
| **Phase 26** | `SECURITY_REVIEW_PHASE_26.md` | **NOT independent** — see below |

**Both Phase 25 and Phase 26 reviews were produced by an agent that had
previously worked on the material.** For Phase 26 this is unambiguous: the
reviewer wrote the code being reviewed. For Phase 25 the reviewer had already
reproduced and endorsed the findings in the Phase 26 report before reviewing
them.

Both documents state this disclosure prominently. They contain real technical
work — live `NODE_ENV=production` reproduction, independently chosen
mutations, and empirically verified cleanup — but **they do not constitute
independent review, and the corresponding blockers remain open.**

**What is actually independently reviewed: Phases 13–14, 16–21 and 24.**
Phases 22, 23 and 25 have no review at all.

## 6. What has been tested in staging?

**Nothing.** No staging environment exists. No GitHub environments (`0`), no
repository secrets, no staging host, no cluster, nothing listening on a
staging database endpoint.

**STAGING VALIDATION — BLOCKED (external environment required).**

Local container behaviour is verified and is labelled **LOCAL**, not staging.
Do not read the 57-check container gate as evidence about a deployed system.

## 7. What has NOT been tested?

| Not tested | Note |
| ---------- | ---- |
| Any deployment to any environment | Nothing has ever been deployed |
| TLS termination | No certificate, no proxy config, no `sslmode` in the repo |
| Encryption at rest | Delegated to the platform; **not configured here** |
| `STORAGE_DIR` backup/restore | Command documented; **never executed** — see §11 |
| Backup at production volume | Tested at 3 rows only |
| Backup automation / scheduling | Not implemented; §4 of the backup doc is manual |
| Backup encryption, retention, rotation | Not implemented |
| Restore into a newer PostgreSQL major | Not tested |
| Production capacity | A bounded smoke test only — see §12 |
| Database connection exhaustion at scale | `connection_limit` is set in tests, not enforced in production config |
| Disk exhaustion behaviour | No monitoring of any kind |
| Log aggregation, retention, alerting | Not implemented |
| Metrics, tracing | Not implemented |
| Rollback of a **deployed** release | Never exercised; nothing has been deployed |
| Penetration testing | Never performed |
| Soak / chaos testing | Never performed |
| Mobile app in any release gate | Excluded from container and artifact gates |
| Compliance certification | None. See `COMPLIANCE.md` |
| Independent review of Phases 22, 23, 25, 26 | See §5 |

## 8. Remaining release blockers

1. **No staging environment.** Nothing has been deployed or validated as a
   deployment.
2. **No production deployment.** No target, no rehearsal.
3. **Backup/restore is proven only for the database, only at tiny volume, and
   is entirely manual.** The document-storage half is untested. No
   scheduling, no encryption, no retention.
4. **Independent review of Phase 25 outstanding.**
5. **Independent review of Phase 26 outstanding** (and the existing
   `SECURITY_REVIEW_PHASE_26.md` is a self-review).
6. **No independent review of Phases 22 or 23 at all.**
7. **No TLS termination** configured or exercised.
8. **No observability**: no metrics, no alerting, no log aggregation, no
   tracing, no disk monitoring.
9. **Lint debt** 55 errors / 69 warnings, advisory in CI, tracked.
10. **Rate limiting returns HTTP 403, not 429** — see §10, **N-12**.

## 9. The backup/restore procedure

Full procedure: **`docs/BACKUP_RESTORE.md`**. Summary:

```bash
# BACKUP (database)
docker compose exec -T postgres pg_dump -U ecc -d ecc -Fc -f /tmp/ecc-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose cp postgres:/tmp/ecc-<ts>.dump ./backups/

# RESTORE
docker compose stop api web
docker compose exec -T postgres psql -U ecc -d postgres -c "DROP DATABASE IF EXISTS ecc WITH (FORCE)"
docker compose exec -T postgres psql -U ecc -d postgres -c "CREATE DATABASE ecc OWNER ecc"
docker compose exec -T postgres pg_restore -U ecc -d ecc --no-owner --no-privileges /tmp/restore.dump
docker compose start api web
# then validate: /health/ready, log in as a pre-backup user, wrong password -> 401
```

**Never** target the developer `ecc` database with a restore. Stop the
application first; a restore under live writes is not a restore.

## 10. Known defects and limitations found in Phase 27

Recorded by the Phase 27 reviews. **None was fixed** — reviews do not fix.

| ID | Sev | Finding |
|----|-----|---------|
| **N-12** | **MEDIUM** | **Rate limiting returns `403 Forbidden`, not `429 Too Many Requests`.** Measured: 50 concurrent valid logins → 8× `201`, 42× `403`. `ForbiddenException` in `rate-limit.guard.ts:76`. RFC-correct status is 429. Consequence: clients cannot distinguish "throttled, retry later" from "forbidden"; 429 is the status most HTTP client libraries treat as retryable, and 429 may carry `Retry-After`. The global exception filter already has a `case 429:` branch that is therefore never reached for this path. |
| **N-10** | MEDIUM | `verify-release-artifact.mjs` and `verify-db-migrations.sh` both delete and rebuild `apps/api/dist`; run concurrently, one can delete the artifact the other is executing. **Intermittent** — a concurrent run during this phase went green, which is exactly the condition under which a team would delete the warning. Mitigation is procedural only. |
| **N-2** | MEDIUM | The Next.js `rewrites` detector reads `next.config.mjs` only. A plugin or a sibling `next.config.js` injecting rewrites is invisible. |
| **N-11** | LOW | `verify-ci-parity` produces a **hyphenated** database name (`ecc_ci-parity_…`). Valid only when quoted; a latent trap for any future raw `psql -d`. |
| **N-1** | LOW | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` is not asserted as an absolute; a coordinated change to the constant and its specs would stay green. |
| **N-3** | LOW | The DTO gate requires "at least one effective constraint" — a floor, not proof of adequacy. |
| **N-4** | LOW | Three public stub routes still bind keyed body parameters (on the documented public allow-list). |
| **N-6** | LOW | The ValidationPipe gate's correctness depends on its harness copying the tree. A harness mutating in place would pass forever. |
| **N-7** | LOW | The ValidationPipe assertion covers two known call sites only. |
| **N-9** | LOW | `PROJECT_PLAN.md` retains superseded Phase 18–20 sections (correctly marked, but a reader who skips the reconciliation section can mis-read history). |

No Critical or High finding was identified in Phase 27.

## 11. What a real deployment still requires

Not optional. All of these are absent from this repository.

1. A **host or platform** to deploy to, plus a **TLS terminator**. The
   repository ships no certificate, no reverse-proxy configuration, and does
   not set `sslmode` on the database connection.
2. A **real `JWT_ACCESS_SECRET`** — ≥32 characters, not a placeholder. The
   process refuses to start in production without one. It must come from a
   secret store, not a file in the image.
3. **A scheduled, monitored backup** — not a manual command. With backups run
   nightly the RPO is 24 hours, which is almost certainly unacceptable for
   emergency alerts and health data. See `docs/BACKUP_RESTORE.md` §9.
4. **Backup encryption and a retention policy**, with the backups stored
   off-host under access control at least as strict as the live database.
5. **A `STORAGE_DIR` volume with a tested backup** — the document path is
   currently untested.
6. **Monitoring and alerting** — at minimum: API health, database
   reachability, disk space on the database *and* backup volumes, and container
   restart loops. There is none today.
7. **A log destination** with PHI-appropriate handling and a retention rule.
8. **A rollback procedure** that has actually been rehearsed.
9. **A staging environment** in which §11 items 1–8 are exercised before
   production.
10. **A decision on RPO/RTO and retention**, made by whoever owns the data,
   not by an engineer.

## 12. Concurrency and load

A **bounded smoke test only** — see `docs/PHASE_27_FINAL_REPORT.md` for
numbers. 50 concurrent requests per class against a single local process on a
throwaway database.

**LOAD VALIDATION — NOT PRODUCTION CAPACITY TESTING.** Nothing here supports
any statement about throughput, capacity limits, or behaviour under real load.
The rate limiter engaged during the login burst, which is the intended
behaviour and is why the raw `201` count is low.

## 13. Explicitly out of scope

Not implemented, not attempted, not claimed: Redis migration, S3/MinIO
migration, Kubernetes, Terraform, Helm, cloud-managed services, WebSockets /
realtime, push/email/SMS notification providers, AI/OCR, EHR/GPS/payments
integration, dashboard redesign, mobile feature work, auth redesign,
observability implementation, penetration testing, load/soak testing,
compliance certification.

## 14. The honest summary

**What is true.** This is a real, working, well-tested application. The gate
suite is unusually thorough, the mutation harnesses are genuine, and the
project has now been verified both locally and on GitHub-hosted runners, with
one real workflow defect found and fixed by that CI run. The security work in
Phases 16–26 is substantial and mostly held up under adversarial re-testing.

**What is not true.** It has never been deployed. It has no staging. Its
backups are proven only for the database, at a scale of three rows, by hand.
Its TLS, observability, alerting, retention and encryption are absent. Two of
its most recent phases have been reviewed only by someone who built them.

**A green CI run is not production readiness, and this document does not
claim it is.**
