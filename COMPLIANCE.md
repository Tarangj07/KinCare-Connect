# COMPLIANCE.md

> This document was promised in `ARCHITECTURE.md` §6, `SECURITY.md` and
> `THREAT_MODEL.md`, but had never been written. Phase 26 creates it, because
> three documents already defer to it.
>
> **Read this first.** This file is an inventory of *technical controls that
> the repository demonstrably implements and that the local gate suite
> verifies*, plus an explicit list of what is **not** implemented, not tested
> and not claimed. It is not a compliance attestation.

## 1. What this document is not

The ECC repository makes **no compliance claim**. Specifically, it does not
claim, and must not be described as:

- **HIPAA compliance or certification.** No BAA, no risk analysis, no
  administrative, physical or technical safeguard attestation. The technical
  controls below are *inputs* to a HIPAA programme, not the programme itself.
- **SOC 2 compliance.** No auditor opinion, no Trust Services Criteria
  assessment, no control testing by an independent party. No SOC 2 Type I or
  Type II report exists.
- **ISO 27001 or ISO 27701 certification.** No ISMS, no certification body,
  no Statement of Applicability.
- **GDPR, UK GDPR, PDPA or any other regulatory compliance.** No records of
  processing, no DPIA, no data-subject rights tooling, no residency or
  retention enforcement.
- **Legal compliance of any kind.** Contractual, licensing and employment-law
  obligations are outside the scope of a code repository and are not addressed
  here.
- **Penetration testing, load testing, soak testing or chaos testing.** None
  has been performed by anyone, internal or external.
- **A production, staging or disaster-recovery capability.** Nothing is
  deployed anywhere. See §6.

Every control below is verified by a gate that runs in this repository. Every
entry names the gate. Where no gate exists, the row says so.

## 2. Access control

| Control | Implementation | Evidence |
| ------- | -------------- | -------- |
| Authentication | Argon2id password hashing; JWT access tokens issued in `httpOnly` cookies; refresh tokens persisted for revocation; rotating refresh on use | `apps/api/src/auth/`, `verify:auth:compiled`, `SECURITY_REVIEW_PHASE_16/17` |
| Password policy | Dedicated policy module enforced at registration and password change | `apps/api/src/auth/password-policy.ts`, `password-policy.spec.ts` |
| Session termination | Refresh-token rotation and revocation; stale tokens rejected | `auth-session.lifecycle.e2e-spec.ts`, `verify:auth:compiled` |
| Rate limiting | In-memory guard on authentication and sensitive routes | `apps/api/src/auth/guards/rate-limit.guard.ts`, `rate-limit.guard.spec.ts` |
| Rate-limit opt-out safety | The `ECC_TEST_DISABLE_RATE_LIMIT` bypass is inert unless `NODE_ENV` is exactly `test` | `verify-config-contract.mjs` §6, `mutate-config-contract.mjs` M8 |
| Route authorization | Organization membership plus care-circle role checks, enforced server-side | `apps/api/src/auth/guards/auth.guard.ts`, `auth.guard.spec.ts` |
| Authorization coverage | Structural assertion over the **compiled** Nest route table that every non-public route is guarded | `verify:routes`, mutation-proved by `verify:routes:mutate` |
| Authorization matrix | Role × resource × expected-decision e2e spec | `apps/api/test/authorization-matrix.security.e2e-spec.ts` |
| Object-level authorization (IDOR/BOLA) | Regression specs for documents, emergency alerts, feed, messaging, notifications, appointments | `apps/api/test/*.security.e2e-spec.ts`, `verify:auth:compiled` |

## 3. Input validation

| Control | Implementation | Evidence |
| ------- | -------------- | -------- |
| Global DTO validation | `ValidationPipe` with `transform: true`, `whitelist: true`, `forbidNonWhitelisted: true` | `apps/api/src/main.ts`; **source-asserted** by `verify-config-contract.mjs` §8, mutation-proved by `mutate-config-contract.mjs` M9–M15 (Phase 26 WS1) |
| Harness/production parity | The e2e test harness mirrors the production pipe configuration exactly | `apps/api/src/testing/create-test-app.ts`, `mutate-config-contract.mjs` M14 |
| Reusable schemas | zod schemas in `packages/validation`, including an ISO-instant validator | `packages/validation/`, `is-iso-instant.spec.ts` |
| Validation boundaries | E2E spec asserting rejection boundaries at the HTTP edge | `apps/api/test/validation-boundary.security.e2e-spec.ts` |
| Request body size | Explicit limits on the JSON and urlencoded parsers, not the framework default | `apps/api/src/config/body-limit.ts`, `main.ts` |
| Parameter metatype handling | DTOs that would otherwise bind as `Object` and bypass `ValidationPipe` are replaced with real DTOs | `apps/api/src/modules/*/dto/`, `verify:metadata` |

## 4. Data protection at rest and in transit

| Control | Implementation | Evidence |
| ------- | -------------- | -------- |
| Password storage | Argon2id; plaintext never persisted or logged | `auth.service.ts`, `verify:auth:compiled` |
| Document file permissions | `STORAGE_DIR` created `0700`; every stored file written `0600` | `apps/api/src/storage/storage.service.ts`, `storage.service.spec.ts` |
| Document access control | `DocumentAccess` grants; every document read is authorized and recorded | `documents.security.e2e-spec.ts`, `document.service.ts` |
| No credentials in artifacts | No secret, connection string, `.env`, PEM or password literal in `dist` or the client bundle | `verify-release-artifact.mjs` checks 7 and 14 |
| No baked API URL | `NEXT_PUBLIC_API_URL` read at runtime, asserted absent from the browser bundle | `verify-release-artifact.mjs` check 13 |
| **Encryption at rest** | **NOT IMPLEMENTED in the application.** Relies on the storage platform's managed volume/database encryption, which is outside this repository | — |
| **TLS / HTTPS termination** | **NOT IMPLEMENTED.** Expected to terminate at a reverse proxy or load balancer; no TLS is configured in the repository or in the container images | — |
| **Field-level / column encryption** | **NOT IMPLEMENTED.** Considered and rejected in favour of platform-managed encryption; see `ARCHITECTURE.md` §6 | — |

## 5. Auditability and configuration integrity

| Control | Implementation | Evidence |
| ------- | -------------- | -------- |
| Audit log | `AuditLog` model; sensitive operations recorded | `apps/api/prisma/schema.prisma`, `audit` writers |
| Request correlation | `RequestIdMiddleware` stamps every response and log line | `request-id.middleware.spec.ts` |
| Consistent error envelope | `GlobalExceptionFilter` normalises error responses; client-input errors separated from server errors | `client-input-errors.spec.ts`, `global-exception.filter.ts` |
| No secret in version control | Tracked files and Dockerfiles scanned for literal credentials and committed `.env` files | `verify-config-contract.mjs` §1 |
| No credential in images | Dockerfiles must not bake a credential-shaped `ENV` | `verify-config-contract.mjs` §1, `mutate-config-contract.mjs` M6 |
| Template placeholders rejected | A copied `.env.example` cannot boot a production process — `JWT_ACCESS_SECRET` placeholders fail `assertRuntimeConfig()` | `verify-config-contract.mjs` §7, `mutate-config-contract.mjs` M3 |
| Fail-closed startup | `assertRuntimeConfig()` refuses to start a production process with a missing, short or placeholder JWT secret, or an unwritable `STORAGE_DIR` | `apps/api/src/config/runtime-config.ts`, `runtime-config.spec.ts` |
| Documented environment contract | Every variable read by code is documented; every documented variable is read; ports and Node/pnpm versions are consistent across templates, code, Dockerfiles and CI | `verify-env-contract.mjs`, `verify-config-contract.mjs`, `mutate-config-contract.mjs` M1–M7 |
| Dependency vulnerability triage | Reachable advisories triaged; unfixed ones recorded with a stated reason | `verify-dependency-audit.mjs`, `verify-dependency-triage.mjs`, `triage-vulnerabilities.mjs` |
| Security headers | Helmet with an explicit configuration | `apps/api/src/main.ts`, `next.config.mjs` |

## 6. Deployment, operations and continuity

This is where the repository's assurance ends. Read it before making any
statement about production readiness.

| Item | Status |
| ---- | ------ |
| Production Docker images | **Implemented and locally verified.** Multi-stage, non-root, no credential baked in. Gate: `verify-docker-images.mjs`, mutation-proved by `mutate-container-gate.mjs` |
| Image runtime behaviour | **Implemented and locally verified.** Entrypoint, signal handling, health probe. Gates: `verify-docker-images.mjs`, `verify-release-artifact.mjs` |
| GitHub Actions workflow | **Authored, never executed.** `ci.yml` exists and is structurally audited by `verify-ci-parity.mjs`, which also runs every locally-runnable command. **There is no run ID.** |
| Deployment runbook | **Written** for the container model this repository actually supports (`docs/PHASE_22_CI_DEPLOYMENT_RUNBOOK.md`) |
| Staging environment | **Does not exist.** No cloud, Kubernetes, Terraform or Helm anything |
| Production environment | **Does not exist.** Nothing is deployed |
| **Backup** | **NOT IMPLEMENTED and NOT TESTED.** No backup job, schedule, or procedure exists |
| **Restore** | **NOT IMPLEMENTED and NOT TESTED.** No restore has ever been performed, not even locally |
| **Disaster recovery** | **No plan, no RTO, no RPO** |
| **Monitoring / alerting / metrics** | **NOT IMPLEMENTED** (health and readiness endpoints only) |
| **Log aggregation / retention** | **NOT IMPLEMENTED** |
| **Capacity / performance testing** | **NOT PERFORMED.** No load or soak test exists |
| **Penetration test** | **NOT PERFORMED** |
| **Incident response / breach notification** | **No process exists.** Not a code concern, and not implemented here |
| **Rollback procedure** | **No rollback has been exercised**, because no deployment has occurred |

Database migration safety *is* verified locally, and is the strongest
continuity control present: migrations apply to an empty database, are
idempotent on re-run, reproduce identically on a second database, and the
application boots and authenticates against the migrated schema
(`verify-db-migrations.sh`). This says nothing about restoring a backup.

## 7. Organisational controls — the deployer's responsibility

None of the following is implemented by, or is within the scope of, this
repository. They are obligations of the organisation operating a deployment.

- Business Associate Agreement execution with every vendor handling PHI
- Workforce training and access-review procedures
- Vendor and sub-processor risk assessment
- Incident response and breach notification procedures and timelines
- Data retention and disposal schedules, and their enforcement
- Data-subject rights processes (access, correction, erasure, portability)
- Physical and facility security of the hosting environment
- Identity verification procedures for account provisioning
- Periodic risk assessments

## 8. Evidence and limitations

**How the "verified locally" entries above were established.** Each names a
gate in `scripts/` or `apps/api/scripts/` that was executed against the
working tree during Phase 26, sequentially — several of these gates rebuild
`apps/api/dist` and interfere with each other when run concurrently. The
mutation harnesses (`mutate-config-contract.mjs`, `mutate-decorator-metadata.mjs`,
`mutate-route-authorization.mjs`, `mutate-container-gate.mjs`,
`mutate-token-lifetime.mjs`) exist because a gate that has never been shown to
fail is not evidence of anything; each proves its gate rejects the defect class
it claims to catch.

**What "verified locally" does not mean.**

- It does not mean verified on a GitHub-hosted runner. That has never happened.
- It does not mean verified in an environment resembling production.
- It does not mean the controls were assessed by anyone qualified to assess
  them. The reviews in `SECURITY_REVIEW_PHASE_*.md` are independent
  engineering reads, not audits.
- **Independent review of Phase 25 is outstanding.** The Phase 25 implementer
  reported findings F-1…F-5 as fixed and mutation-tested; those claims have not
  yet received an independent review, and `SECURITY_REVIEW_PHASE_26.md` does
  not exist. Reproducibility instructions are in
  `docs/PHASE_26_FINAL_REPORT.md`.
- The Phase 16–26 work is **uncommitted**. It is verified in a working tree,
  not in any commit, and not on any remote.

## 9. Where the phase history lives

Per-phase detail, including what each phase actually did and what it left open:

- `docs/PHASE_16_SECURITY_REMEDIATION.md` … `docs/PHASE_26_FINAL_REPORT.md`
- `SECURITY_REVIEW_PHASE_16.md` … `SECURITY_REVIEW_PHASE_24.md` (independent,
  reviewer-owned)
- `PROJECT_PLAN.md` §5.2 for the current release blockers

Historical phase reports are records of what was believed at the time. Where a
later phase reproduced a claim and found it inaccurate, the current truth is
recorded in the later report rather than by rewriting the earlier one.
