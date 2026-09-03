# THREAT_MODEL.md

> Living document. Maintained alongside `SECURITY.md`. Every new
> feature must be reviewed against the threats listed here; new
> threats discovered during the build are added.

We use the STRIDE category labels in the **Category** column, and the
following rubric for **Likelihood** and **Impact**:

* Likelihood: Low / Medium / High
* Impact: Low / Medium / High / Critical
* Residual risk is what we expect to remain after the listed
  mitigations are implemented.

This document does not promise that any of these mitigations are
already shipped — it is the target. Implementation status is reflected
in `SECURITY.md`.

---

## 1. Assets

* User credentials (passwords, password-reset tokens, refresh tokens)
* Personally identifying information (PII) — names, emails, phone
  numbers
* Health-related information (medications, doses, measurements,
  appointments, notes) — treated as PHI for threat-modelling purposes
* Care-circle membership data (who is allowed to see which senior)
* Documents uploaded by users (prescriptions, insurance cards)
* Audit logs (their integrity is itself an asset)
* Signing keys (JWT, S3, database)

## 2. Trust boundaries

* **Untrusted client** — any browser, mobile app, or API client.
* **Authenticated user** — passes login; still untrusted for
  authorization decisions.
* **API server** — trusted to enforce authorization; runs in our
  infrastructure.
* **Worker process** — trusted, but cannot accept inbound HTTP.
* **Object storage** — trusted for durability and access control;
  not trusted to enforce application-layer access (signed URLs are
  our contract).
* **Third-party providers** — email, push, S3. We treat them as
  potential leakers of metadata and as availability dependencies.

## 3. Threats

### 3.1 Account takeover

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Credential stuffing / password spraying against `/api/v1/auth/login`           |
| STRIDE          | Spoofing, Elevation of privilege                                              |
| Attack surface  | Public HTTP                                                                    |
| Impact          | High — attacker gains a legitimate session                                     |
| Likelihood      | High                                                                           |
| Mitigation      | Argon2id password hashing, per-account lockout, per-IP rate limit, WAF-class rules for repeated failures, optional TOTP (Phase 16), refresh-token rotation with reuse detection |
| Residual risk   | Medium — sophisticated distributed attacks remain plausible                    |

### 3.2 Token theft

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Stolen access token (XSS, malware, network log capture)                        |
| STRIDE          | Spoofing, Information disclosure                                               |
| Attack surface  | Browser, mobile device, network                                                |
| Impact          | High — full session access until expiry                                        |
| Likelihood      | Medium                                                                         |
| Mitigation      | Short access-token TTL (15 min), httpOnly+Secure+SameSite=strict cookies for web, secure-store on mobile, `Strict-Transport-Security`, CSP, output encoding, no PHI in tokens, refresh-token reuse detection |
| Residual risk   | Medium — local malware on the user's device is largely outside our control    |

### 3.3 Broken access control / IDOR

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Authenticated user requests a senior or document they do not belong to         |
| STRIDE          | Elevation of privilege, Information disclosure                                 |
| Attack surface  | All senior-scoped REST endpoints                                               |
| Impact          | Critical — full PHI disclosure                                                 |
| Likelihood      | High without a centralised guard; Low with one                                 |
| Mitigation      | Single `SeniorAccessGuard` factory used by every senior-scoped route; per-circle role checks; integration tests assert user A cannot read user B's resources; CI test suite contains explicit cross-tenant test cases |
| Residual risk   | Low — provided every new endpoint is registered with the guard                  |

### 3.4 Privilege escalation

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | FAMILY_MEMBER calls an admin-only route                                        |
| STRIDE          | Elevation of privilege                                                         |
| Attack surface  | `/admin/*`, billing, organisation management                                   |
| Impact          | High                                                                           |
| Likelihood      | Medium                                                                         |
| Mitigation      | `RolesGuard` requires explicit `@Roles()` decorator; admin routes are mounted on a separate sub-app with stricter CORS; tests assert rejection of every lower role |
| Residual risk   | Low                                                                            |

### 3.5 Unauthorized family member

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Ex-partner / estranged relative retains access after relationship change       |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | Care-circle membership                                                         |
| Impact          | High — persistent PHI exposure                                                 |
| Likelihood      | Medium                                                                         |
| Mitigation      | Self-service removal is only available to `FAMILY_ADMIN`; all membership changes are audit-logged with reason; UI surfaces "who currently has access" with one-click removal; org admins can revoke on behalf of a senior |
| Residual risk   | Low — provided removal is prompt                                                |

### 3.6 Unauthorized caregiver

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Caregiver keeps accessing a senior after their engagement ends                 |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | Care-circle membership + assignment to tasks                                   |
| Impact          | High                                                                           |
| Likelihood      | Medium                                                                         |
| Mitigation      | Caregiver assignments have explicit `endsAt`; worker deactivates expired assignments and emits a `caregiver.assignment.expired` event; revocation is audit-logged |
| Residual risk   | Low                                                                            |

### 3.7 Document leakage

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Direct guess of an S3 object key; public bucket; permanent URL leak in email  |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | Object storage, email, chat                                                    |
| Impact          | High                                                                           |
| Likelihood      | Medium                                                                         |
| Mitigation      | Buckets are private; all access is through `PresignService` with 5-minute TTL; S3 keys are random UUIDs (no enumeration); presign requests are audit-logged; CSP and `X-Content-Type-Options: nosniff` prevent inline rendering of returned objects |
| Residual risk   | Low — the link itself is the bearer credential, so link sharing is equivalent to sharing the document; the audit log surfaces it                                  |

### 3.8 Health data leakage via logs

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | PHI ends up in structured logs                                                |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | Application logs, error tracking, request bodies                              |
| Impact          | High                                                                           |
| Likelihood      | High if left unchecked                                                        |
| Mitigation      | `pino` redact list blocks `req.body` and `req.query` for health/feed modules by default; lint rule forbids `console.log` of object literals in `apps/api`; centralised error filter never serialises request bodies into responses or logs |
| Residual risk   | Low — provided the redact list is updated whenever a new sensitive module is added                                                            |

### 3.9 Malicious file upload

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | PDF/HTML containing JavaScript; oversized upload; executable polyglot          |
| STRIDE          | Tampering, Denial of service, Information disclosure                           |
| Attack surface  | `/documents` upload endpoint                                                  |
| Impact          | High                                                                           |
| Likelihood      | Medium                                                                         |
| Mitigation      | MIME-type validation by content sniffing, file-size cap per user, blocked extensions list (`.exe`, `.html`, `.svg`, etc.), `Content-Disposition: attachment` on signed responses, malware scan hook (ClamAV) in dev; production sign-off on a managed scanning provider |
| Residual risk   | Medium — the zero-day file bypass risk is never fully closed                    |

### 3.10 XSS

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Stored XSS in family feed / messaging; reflected XSS in error pages            |
| STRIDE          | Tampering, Information disclosure                                             |
| Attack surface  | Any user-rendered text                                                         |
| Impact          | High — token theft, action on behalf of the user                               |
| Likelihood      | High without a framework default                                              |
| Mitigation      | React/React Native render text by default; `DOMPurify` for any HTML allowed (none at MVP); strict CSP with no inline scripts; `X-Content-Type-Options: nosniff`; output encoding in error pages |
| Residual risk   | Low                                                                            |

### 3.11 CSRF

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | State-changing request from a malicious site using a victim's session cookie |
| STRIDE          | Tampering, Spoofing                                                           |
| Attack surface  | Browser → API                                                                 |
| Impact          | Medium — same-site cookies + bearer-typed content mitigate most of it          |
| Likelihood      | Medium                                                                         |
| Mitigation      | Auth cookies are `SameSite=strict`; auth cookie path is `/api/v1/auth` only; CSRF token required for mutating requests; mobile clients use bearer tokens (no cookie involvement) |
| Residual risk   | Low                                                                            |

### 3.12 SQL injection

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Malicious input reaches the database driver                                   |
| STRIDE          | Tampering, Information disclosure                                             |
| Attack surface  | Every query                                                                   |
| Impact          | Critical                                                                      |
| Likelihood      | High without a default                                                        |
| Mitigation      | Prisma parameterises every query; raw SQL is forbidden by lint rule except inside `prisma/seed.ts`; integration tests with adversarial inputs (Phase 17) |
| Residual risk   | Very low                                                                       |

### 3.13 WebSocket authorization bypass

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Client joins a `room` for a senior they do not belong to; receives updates     |
| STRIDE          | Information disclosure, Spoofing                                             |
| Attack surface  | Socket.IO gateway                                                             |
| Impact          | High                                                                           |
| Likelihood      | Medium                                                                         |
| Mitigation      | `connection` handshake validates the JWT; the join handler calls `canAccessSenior` server-side; room names are derived from server-issued tokens, not from client input |
| Residual risk   | Low                                                                            |

### 3.14 Notification abuse

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Attacker triggers many emergency alerts to spam contacts                      |
| STRIDE          | Denial of service                                                             |
| Attack surface  | Emergency alert API                                                           |
| Impact          | High — alarm fatigue, loss of trust                                           |
| Likelihood      | Low (auth required) — but high if a vulnerability lets unauthenticated users post |
| Mitigation      | Emergency alerts require at least `FAMILY_MEMBER`; per-senior rate limit on alert creation; repeated alerts de-duplicate by `(seniorId, type, 5min window)`; UI shows a cooldown timer after a manual alert |
| Residual risk   | Low                                                                            |

### 3.15 Insider threat

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Operator with database access reads PHI directly                              |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | Production database, object storage, audit log                                |
| Impact          | Critical                                                                      |
| Likelihood      | Low                                                                            |
| Mitigation      | Production DB access requires SSO + just-in-time elevation; audit logs include a `actorType` of `OPERATOR` for direct DB reads; row-level Postgres roles separate `app` (no PHI by default) from `app_phi`; document the access pattern in `DEPLOYMENT.md` |
| Residual risk   | Medium — operator access is a business control, not a technical one            |

### 3.16 Compromised device

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | User's phone is stolen; attacker reads in-app data                            |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | Mobile app                                                                    |
| Impact          | Medium (device-local data only) — High if the attacker can change the password |
| Likelihood      | Medium                                                                         |
| Mitigation      | Tokens in `expo-secure-store` (Keychain/Keystore), not `AsyncStorage`; biometric re-prompt after background > 5 min; remote-revoke endpoint exposed to FAMILY_ADMIN; the mobile app does not cache documents locally by default |
| Residual risk   | Medium                                                                         |

### 3.17 API abuse / scraping

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Scripted enumeration of public-looking endpoints                              |
| STRIDE          | Information disclosure                                                         |
| Attack surface  | All unauthenticated endpoints                                                  |
| Impact          | Medium                                                                         |
| Likelihood      | High                                                                           |
| Mitigation      | Global per-IP rate limit on the API edge; per-user rate limit once authenticated; route-level rate limit on auth endpoints; structured 429 with `Retry-After` |
| Residual risk   | Low                                                                            |

### 3.18 Health device / integration spoofing

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | Forged "fall detected" webhook from an unverified source                      |
| STRIDE          | Tampering, Denial of service                                                  |
| Attack surface  | Webhook endpoints                                                             |
| Impact          | High — false alarms erode trust                                               |
| Likelihood      | Low                                                                            |
| Mitigation      | Webhook endpoints require an `X-Provider` header + an HMAC signature; replay protection via timestamp window; providers must be `enabled` in the database before events are processed |
| Residual risk   | Low — provided providers are whitelisted, not "self-registered"                |

### 3.19 Subscription / billing abuse

| Field           | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| Threat          | User manipulates client-side feature flags to access paid features            |
| STRIDE          | Elevation of privilege                                                         |
| Attack surface  | Web / mobile feature gates                                                    |
| Impact          | Medium                                                                         |
| Likelihood      | Medium                                                                         |
| Mitigation      | All entitlement checks are duplicated server-side (`EntitlementsService`); the client-side check exists for UX only; billing-webhook handler validates the payment provider signature |
| Residual risk   | Low                                                                            |

---

## 4. Out of scope (for this threat model)

* Physical security of our infrastructure (covered by cloud provider).
* End-user device compromise beyond app-level mitigations.
* Compromise of upstream packages — covered separately by dependency
  auditing in `SECURITY.md`.
* Legal / regulatory risk — covered by `COMPLIANCE.md`.
