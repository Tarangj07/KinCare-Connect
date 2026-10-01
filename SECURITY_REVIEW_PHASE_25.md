# SECURITY_REVIEW_PHASE_25.md — Independent Review

**Subject:** Phase 25 — findings F-1 … F-5
**Reviewed tree:** `f51614dae70187262a22d67786ffb3b5bfd4ef58` (== `origin/main`)
**Review date:** 2026-09-29
**Reviewer type:** review agent
**Method:** read-only adversarial review. No production code was modified by
this review. Two temporary mutations were applied to working files to test
detection, and **both were reverted**; the working tree was verified clean
afterwards.

---

## 0. Independence disclosure — read this first

**This review is not fully independent, and a reader must weigh it
accordingly.**

- I did **not** implement Phase 25. F-1 … F-5 were authored by the Phase 25
  implementer.
- However, I **did** reproduce and assert those findings as holding during
  Phase 26, and I wrote `docs/PHASE_26_FINAL_REPORT.md` asserting that
  "F-1…F-5 are covered by the mutation harnesses and reproduce cleanly." I am
  therefore reviewing work I have previously **endorsed** without independent
  scrutiny. That is a weaker position than a true second pair of eyes.
- The mitigations actually applied here: findings were checked against source
  and against a **live `NODE_ENV=production` process**, not against the
  implementer's own harnesses alone; two mutations were written **independently
  of the implementer's own mutation list** specifically to look for a gate that
  passes only the mutants it was written against; and every conclusion below
  cites the command that produced it.

**What this document can and cannot establish.** It can establish that each
control behaves correctly against the specific attacks I could construct, and
that the gates reject mutations I chose without reference to the implementer's
list. It cannot establish the absence of a defect I failed to think of. A
reviewer who has not previously endorsed the work would be better placed to
find that. **This should not be treated as closing the Phase 25 review
blocker on its own** — see §8.

---

## 1. F-1 — future-dated `iat` defeats the lifetime bound

**Original claim (Phase 25, §B).** `jsonwebtoken`'s `maxAge` evaluates
`now >= iat + maxAge`. For a token whose `iat` is in the **future** that
inequality is false for a long time, so a correctly signed token stamped ten
years ahead satisfied every check the verifier performs. The documented
guarantee "effective validity is `min(exp, iat + 15m)`" was therefore false.

### 1.1 Defect reproduced (independently)

Signed real HS256 tokens with the real signing secret and verified them with
`maxAge: 900` and **no** `iat` rule — i.e. the Phase 24 (D-2) control alone:

```
=== PHASE 24 (D-2) CONTROL ALONE: maxAge, no iat rule ===
  ACCEPTED  normal token,      iat=now
  ACCEPTED  iat = now + 1 year,  exp=now+10y    <-- 365d in the future, accepted
  ACCEPTED  iat = now + 10 years, exp=now+10y+1s <-- 3650d in the future, accepted
```

**The defect is real and reproduces exactly as described.** `maxAge` alone
does not bound a future-dated `iat`.

### 1.2 Fix verified against source

`apps/api/src/config/security-config.ts:57-63`:

```ts
export function isAccessTokenIssuedInThePast(
  iat: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false;
  return iat <= nowSeconds + ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS;
}
```

Single call site, `apps/api/src/auth/guards/auth.guard.ts:78`, applied **after**
`verifyAsync` and before `req.user` is populated. A missing `iat` is refused
rather than defaulted.

### 1.3 Predicate edge cases (17 cases, independent)

All behaved as a reviewer would require. Notable:

| Input | Result | Assessment |
| ----- | ------ | ---------- |
| `iat = now+5` (boundary) | accepted | correct — window is inclusive |
| `iat = now+6` | refused | correct |
| `iat = now+5.5` (float just outside) | refused | correct — no float escape |
| `iat = "1000000"` (string) | refused | correct — no type coercion |
| `iat = NaN` / `±Infinity` | refused | correct — `Number.isFinite` guard holds |
| `iat = {valueOf:()=>1}` | refused | correct — no object coercion |
| `iat = undefined` | refused | correct |
| `iat = 0` / `-100` | accepted | **acceptable** — `maxAge` independently refuses these; the predicate is not the only control |

### 1.4 Verified live, in `NODE_ENV=production`

A real server was booted from `apps/api/dist/main.js` with
`NODE_ENV=production`, a real signing secret and a throwaway PostgreSQL. A
user was registered and logged in so a genuine identity existed. Tokens were
then minted directly with the real secret and presented as `Bearer`:

| Case | Result | Expected |
| ---- | ------ | -------- |
| `iat=now-1h, exp=now+10y` (D-2 bound) | **401** | 401 |
| `iat=now+1h, exp=now+10y` (F-1) | **401** | 401 |
| `iat=now+10y, exp=now+10y+1s` (F-1 core) | **401** | 401 |
| `iat=now+2, exp=now+2` (inside 5 s window) | **200** | 200 — proves the jitter window works |
| `iat=now-1, exp=now+15m` (ordinary token) | **200** | 200 — proves no blanket refusal |
| refresh-cookie round trip | **201** | 201 — no regression |

The `iat=now+2` → 200 result is the important one for **false-green**
analysis: the rule is a bound, not a refusal, and a legitimate token inside
the jitter window still works.

### 1.5 Compiled artifact

`isAccessTokenIssuedInThePast` present in `dist/config/security-config.js`
(2 references) and called from `dist/auth/guards/auth.guard.js` (1). The
control survives compilation.

### 1.6 Mutation harnesses

`mutate-token-lifetime.mjs` — all 4 mutants rejected: maxAge removed, TTL
raised to 24 h, the `iat` check removed, the window widened 5 s → 1 h.

### 1.7 **Independent** mutation (not in the implementer's list)

The implementer removes the call or widens the window. I instead **inverted
the bound**, keeping the call and the constant intact:

```ts
// P27 INDEPENDENT MUTANT
return typeof iat === 'number' && Number.isFinite(iat);
```

This makes the predicate *accept every finite future `iat`* while leaving
every symbol the implementer's harness looks for in place. Result: **6 test
failures**, including both the guard-level and the predicate-level F-1 cases.

```
× rejects a verified token whose iat is in the future, even from a stubbed verifier
× refuses a future iat (5 minutes ahead) whose exp is still in the future
× refuses a future iat AND a future exp ten years out
× refuses a future iat even when the token carries no exp at all
× refuses a future iat that is only just past the tolerated window
× is a property of the shared predicate, not of this guard alone
Test Files  1 failed (1)
```

The suite is not asserting on a string. Reverted; `git diff` empty; suite
back to 24/24.

### 1.8 False-green analysis

- A guard that dropped the `iat` check entirely: caught (M3, and my M).
- A guard that inverted the bound: caught.
- A guard that *removed the call and inlined a `return true`*: the predicate
  tests are separate and would still fail.
- **Residual false-green:** if someone changed
  `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` to a large value **and** updated the
  spec's expectations to match, the suite would pass. The constant is
  asserted nowhere as an absolute. This is a shared-value-drift weakness
  common to all policy-constant tests; it is recorded as a **LOW** new
  finding (**N-1**) rather than a defect in the fix.

### 1.9 Verdict

**F-1 is genuinely closed.** The defect reproduced; the fix is correctly
placed, correctly narrow, present in the compiled artifact, effective in a
live production-mode process, resistant to an independently chosen mutation,
and does not cause a blanket refusal.

---

## 2. F-4 — Next.js `rewrites` triage rule is wrong

**Original claim.** The D-6 rule read `next.config.mjs` as **text**, so a
working `rewrites` (declared as a function or a spread) was not detected and
its advisory was dismissed as "not reachable".

### 2.1 Verified

`scripts/lib/next-config-features.mjs` + `verify-next-config-features.mjs`
parse the config with the TypeScript AST. `mutate-next-config-rewrites.mjs`
passes 4/4, including M3 — the informative one: it **neuters the analyser**
while leaving the rewrite planted, and the verdict is asserted to become
`NOT REACHABLE`. That proves the verdict comes from the *analysis* and not
from the presence of a keyword in the file, which is the actual defect class.

### 2.2 Independent observation

No additional mutation was written for F-4. The harness's M3 is a strong test
and I found no gap on inspection, but **this is the weakest-evidenced of the
five** and is called out as such.

### 2.3 Verdict

**F-4 is closed**, with lower confidence than F-1. The known over-report
residual (a third-party Next.js plugin injecting rewrites is invisible to a
config-AST reader) is a real limitation and is **not** fixed; it is recorded
in §7 as **N-2**.

---

## 3. F-2 — the DTO gate checks metatype, not validation

**Original claim.** The compiled-artifact gate asserted only that a body
parameter's metatype was a class. A class stripped of every constraint
satisfied it, so "validated" was never actually established.

### 3.1 Verified

`verify-route-authorization.mjs:80-90` reads the **compiled** DTO class and
counts constraints, excluding ones that do nothing alone
(`CONDITIONAL_VALIDATION_TYPES` = `@IsOptional`, `@ValidateIf`), and reports
`total` / `effective` / `properties`. Inherited constraints count (prototype
chain is walked).

`mutate-route-authorization.mjs` M6 (every constraint stripped) and M7
(reduced to `@IsOptional()` alone) are both rejected.

### 3.2 Verdict

**F-2 is closed.** The gate now measures the property it claims to measure
rather than a proxy. The "at least one effective constraint per DTO" bar is a
deliberately chosen floor, not proof that a DTO is *sufficiently* constrained
— recorded as **N-3**.

---

## 4. F-3 — keyed `@Body('field')` escapes DTO coverage

**Original claim.** A keyed `@Body('field')` is extracted from the body
*before* `ValidationPipe` runs, so the remaining object is never whitelisted
and the named field is validated only by hand-written handler checks. The
Phase 24 rule reported "no whole body" and treated the route as covered.

### 4.1 Verified in the tree

No keyed `@Body` remains in any controller. The one live instance
(`@Body('targetUserId')` in `messaging.controller.ts`) was replaced with a
DTO.

### 4.2 **Independent** mutation on a different controller

The implementer's M8 plants a keyed body in the **messaging** controller. To
test whether the rule generalises or is fitted to one file, I planted one in
`emergency.controller.ts` — a controller the implementer never used — using a
**renamed import** so the metatype is erased the same way:

```ts
import { CreateEmergencyAlertDto as _Dto } from './dto/create-emergency-alert.dto';
...
@Body('notes') dto: Partial<_Dto>,   // P27 INDEPENDENT MUTANT
```

The gate rejected it, naming the route, the field and the reason:

```
FAILED — 1 authorization-structure problem(s):
  - POST /api/v1/seniors/:seniorId/emergency-alerts (EmergencyController.create)
    binds a KEYED body field `@Body('notes')` at parameter #1. A keyed body
    parameter is taken out of the request body before ValidationPipe runs...
```

**The rule is structural, not file-specific.** Reverted; `git status` clean;
gate green again.

### 4.3 Verdict

**F-3 is closed** for live routes. The three Phase 4 public stubs still bind
keyed body parameters by design; they sit on the documented public allow-list
and are enumerated in **N-4**.

---

## 5. F-5 — dependency classifier fails open

**Original claim.** The generic fallback classified an unrecognised advisory
as not-reachable, so an advisory nobody had triaged was silently dismissed.

### 5.1 **Independent** test with an advisory no rule has ever seen

I constructed a synthetic `pnpm audit` report containing a high-severity
advisory for a package absent from every rule and from
`EXPLICIT_BUILD_TIME_PACKAGES`, reachable only through a devDependency:

```
REACHABLE (unclassified) 1
  REACHABLE (unclassified)
    [high] p27-never-seen-package@99.0.0  (0/1 prod paths)
      evidence: no reachability rule is defined for `p27-never-seen-package`
      in this script, and it is not in EXPLICIT_BUILD_TIME_PACKAGES either...
      "I could not check this" is a finding, not a dismissal.
```

Process exit code: **1**.

### 5.2 Verdict

**F-5 is closed.** An unknown advisory is reported as actionable and fails the
build. The dev-only heuristic did **not** silently downgrade it. A `moderate`
advisory is also not force-promoted to critical, which would be the mirror-image
false green.

---

## 6. Consolidated evidence

| Finding | Defect reproduced | Source verified | Compiled artifact | Live production | Own harness | **Independent** mutation | Verdict |
|---------|------------------|-----------------|-------------------|-----------------|-------------|--------------------------|---------|
| F-1 future `iat` | **Yes** | Yes | Yes | **Yes** | 4/4 | **Yes** (inverted bound → 6 failures) | **CLOSED** |
| F-2 DTO metatype-only | Not re-run | Yes | Yes (compiled DTO) | n/a | M6, M7 | No | **CLOSED** |
| F-3 keyed `@Body` | Yes (rule rejects) | Yes | Yes | n/a | M8 | **Yes** (different controller → rejected) | **CLOSED** |
| F-4 `rewrites` text read | Yes (M3) | Yes | n/a | n/a | 4/4 | No | **CLOSED** (lower confidence) |
| F-5 fail-open | **Yes** (synthetic advisory) | Yes | n/a | n/a | 24 assertions | **Yes** (unknown high → REACHABLE, exit 1) | **CLOSED** |

All five findings are **genuinely closed** on the evidence available. None is
closed on the implementer's word alone: F-1, F-3 and F-5 were each
independently re-attacked.

---

## 7. New findings (not previously recorded)

These are **not** fixable-at-review findings. They are recorded for the
maintainer; no code was changed for any of them.

| ID | Severity | Finding |
|----|----------|---------|
| **N-1** | LOW | `ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS` is not asserted as an absolute anywhere. A change to the constant together with matching spec updates would keep the suite green. A policy constant that nothing pins can drift. |
| **N-2** | MEDIUM | **F-4 residual, real and unfixed.** The rewrites detector reads `next.config.mjs` only. A third-party Next.js plugin (or `next.config.js` alongside `.mjs`) that injects rewrites is invisible, and its advisory would be classified on incomplete information. |
| **N-3** | LOW | **F-2 bar.** "At least one effective constraint" is a floor. A DTO with one weak constraint and nineteen unconstrained fields passes. The gate proves constraints *exist*, not that the DTO is adequate. |
| **N-4** | LOW | **F-3 residual.** Three Phase 4 public stubs still bind keyed body parameters. They are on the documented public allow-list and enumerated, so this is accepted, but it is a standing exception. |
| **N-5** | INFO | F-1 relies on the signing secret remaining secret. Knowledge of it still yields a valid token; the F-1 control bounds the token's age, not the attacker's ability to mint one. Inherent to HS256, not a defect. |

No **Critical** or **High** finding was discovered.

---

## 8. Verdict and what this does NOT close

**All five findings (F-1 … F-5) are assessed as genuinely closed**, on evidence
that includes three independently constructed mutations and one live
`NODE_ENV=production` reproduction.

However, see §0. Because I previously endorsed this work in the Phase 26
report without independent scrutiny, **this document should not be treated as
the closure of the Phase 25 review blocker on its own.** The blocker is
"Phase 25 has never received independent review." What now exists is a
review performed by a party with prior involvement in the assessment.

A genuinely independent closure requires a reviewer who has not previously
endorsed F-1 … F-5. **The practical path**: this document is sufficient
evidence for the *specific technical claims* in §6, and should be re-read by
such a reviewer rather than treated as a substitute for one.

## 9. Constraints honoured

- No production code was modified by this review. Two mutations were applied
  to test detection and **both reverted**; `git status` for `apps/api/src` is
  clean.
- `docs/PHASE_25_FINAL_REPORT.md` was read only, never modified.
- No previous `SECURITY_REVIEW_*.md` was modified.
- `PROJECT_PLAN-old.md` and all historical reports are untouched.
- Prisma schema and migrations untouched; `pnpm-lock.yaml` untouched.
- Only a throwaway PostgreSQL container (`ecc-p27-rev-pg-*`, database
  `ecc_p27_review`) was used. **The developer `ecc` database was never
  targeted** — verified: its database list and table count are unchanged.
- No git history operation was performed.
