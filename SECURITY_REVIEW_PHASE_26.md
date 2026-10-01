# SECURITY_REVIEW_PHASE_26.md — Independent Review

**Subject:** Phase 26 — WS1 (ValidationPipe strictness gate), WS5
(documentation alignment), WS6 (gate determinism)
**Reviewed tree:** `f51614dae70187262a22d67786ffb3b5bfd4ef58` (== `origin/main`)
**Review date:** 2026-09-29
**Reviewer type:** review agent
**Method:** read-only adversarial review. No production code was modified.
Temporary mutations applied to working files and to **scratch copies outside
the repository** were reverted; the working tree was verified clean afterwards.

---

## 0. Independence disclosure — read this before relying on this document

**This review is NOT independent. It is a self-review with adversarial
method, and it must not be cited as independent assurance.**

- **I implemented all three workstreams reviewed here.** WS1 (the AST
  ValidationPipe gate and M9–M15), WS5 (README / PROJECT_PLAN / COMPLIANCE.md
  and the ARCHITECTURE.md + SECURITY.md reference corrections) and WS6
  (`scripts/lib/throwaway-postgres.mjs` and the refactor of
  `verify-release-artifact.mjs` and `verify-ci-parity.mjs`) are my work.
- **I know where my own work is weak**, which is exactly the knowledge that
  makes self-review unreliable:
  - I introduced a path-resolution bug in the WS1 gate that made it read the
    **real** `main.ts` instead of the mutant. The mutation harness caught it,
    but only by accident of harness design.
  - I introduced a container leak in the WS6 code by calling the provisioner
    outside the `try`. Caught by my own negative test.
  - I know which mutants the harness contains and which it does not.
- Nothing here should be read as a second opinion. It is a careful,
  adversarial pass over my own work, which is worth something — but it is not
  what "independent review" means, and **it does not close the Phase 26 review
  blocker.**

**What would be needed to actually close it:** a reviewer with no
implementation relationship, given the Phase 26 diff, the gate sources, and
this document as a map of where the traps are.

---

## 1. WS1 — ValidationPipe strictness gate

### 1.1 Does it assert what it claims?

Yes. `scripts/verify-config-contract.mjs` §8 requires
`transform`, `whitelist` and `forbidNonWhitelisted` to be present **and set to
the literal `true`** at two sites: `apps/api/src/main.ts` and
`apps/api/src/testing/create-test-app.ts`. Verified present in both.

### 1.2 AST-based detection is genuinely stronger than a regex

This was the design rationale. I attacked it with the two substitutions a
regex would miss:

| Mutation | Gate verdict | Regex `transform: true` would have |
| -------- | ------------ | ---------------------------------- |
| `transform: !!1` | **rejected** — "sets `transform` to `!!1` rather than the literal `true`" | **MISSED** |
| `transform: STRICT` (a `const STRICT = true` indirection) | **rejected** — "sets `transform` to `STRICT`" | **MISSED** |
| `disableErrorMessages: true` added alongside | **accepted** (correct — not a weakening) | accepted |

The AST reads the literal value. The claim holds.

### 1.3 **The specific requested reproduction: gate reading the real file**

This is the bug I originally shipped. I reproduced it exactly.

Setup: a scratch tree containing a **mutated** `main.ts` (`transform: true`
deleted), run with the gate from that scratch tree while the process cwd was
the real repository.

**(A) Current, fixed code — correct:**
```
- apps/api/src/main.ts:39 — the global ValidationPipe does not set `transform`
  (the production bootstrap); Nest's default applies...
FAILED — 1 configuration problem(s)
```

**(B) Original buggy path resolution, deliberately reintroduced — FALSE GREEN:**
```
- global ValidationPipe: transform, whitelist and forbidNonWhitelisted are all
  literal true in apps/api/src/main.ts and apps/api/src/testing/create-test-app.ts
The environment contract is accurate: read, documented, CI, image and compose
  sets correspond.
```

With the bug present the gate **passed** while auditing the wrong file, and
the note even continued to assert all three flags were "literal true" — the
clearest possible evidence it was reading the real `main.ts`.

**Conclusion: the original bug was real and severe (a completely vacuous
gate), and the fix is load-bearing.** `path.join(repoRoot, relFile)` is now
used and `repoRoot` is derived from `import.meta.url`, not the cwd, so the gate
cannot be detached from its own tree.

**Reviewer note.** The mutation harness caught this only because it copies the
tree and runs the copied script. A harness that mutated files in place and
re-ran the *real* script would have passed forever. That fragility is
inherent to this class of gate and is recorded as **N-6**.

### 1.4 Can it produce a false green?

| Attempt | Result |
| ------- | ------ |
| Delete a flag | caught |
| Set a flag to `false` | caught |
| Set a flag to `!!1` / a constant | caught |
| Remove the whole `useGlobalPipes` call | caught |
| Weaken only the test-harness mirror | caught |
| Register a pipe from an identifier whose options are not inline | caught (reports it as unverifiable rather than passing silently) |
| Add an unrelated extra flag | correctly **passes** — not over-strict |

**Residual false-green (N-7):** the gate checks the two *known* call sites. A
global pipe registered in a third file, or a DTO validated by a pipe mounted on
a controller rather than globally, would not be covered. That is a scoping
limit, not a defect, and it fails safe in the sense that nothing is asserted
about unknown sites.

**False-negative (over-strict) note:** rejecting `const STRICT = true` is
defensible for a security gate but is technically a false positive — the value
is provably `true`. Recorded as **N-8**, not a defect.

### 1.5 Verdict

**WS1 is sound and its central claim — that the three flags are asserted and
that the assertion cannot be silently defeated by a path error — is
independently reproduced in both directions.** Confidence is high on
correctness and low on *coverage breadth* (see N-7).

---

## 2. WS5 — documentation alignment

Checked every factual claim that could be verified mechanically.

| Claim in README | Verified against | Result |
| --- | --- | --- |
| Node `>=22.13.0` | `package.json` `engines.node` | **correct** |
| pnpm `11.25.0` | `package.json` `packageManager` | **correct** |
| NestJS 10 | `apps/api/package.json` `@nestjs/core ^10.4.6` | **correct** |
| Prisma 5 | `@prisma/client ^5.22.0` | **correct** |
| "Prisma schema of 36 models" | `grep -c '^model '` = **36** | **correct** |
| Redis/MinIO not required | no Redis client in `apps/api`; storage is `STORAGE_DIR` | **correct**, and the README explicitly calls the compose services dead scaffold |

Note: an earlier draft of the README stated NestJS 11 / Prisma 6 / 31 models.
Those were wrong and were corrected during Phase 26 before completion. The
shipped values are right.

**Dangling authoritative references:** every file referenced as authoritative
by `ARCHITECTURE.md`, `SECURITY.md`, `THREAT_MODEL.md` and `README.md` now
exists (`COMPLIANCE.md`, `PROJECT_PLAN.md`, `ARCHITECTURE.md`,
`THREAT_MODEL.md`, `SECURITY.md`, `PROJECT_PLAN-old.md`). The Phase 1 "we will
add this in Phase 1" promises in `ARCHITECTURE.md` §1/§6 and `SECURITY.md`
have been corrected.

**`COMPLIANCE.md`:** contains **no** certification claim. It explicitly
disclaims HIPAA, SOC 2, ISO 27001/27701, GDPR and legal compliance, and states
that it "is not a compliance attestation". §6 is largely a list of things that
do not exist (no TLS, no app-level encryption at rest, no backup, no monitoring).
Spot-checked control claims against source (Argon2id, `auditLog` writers,
`DocumentAccess` enforcement, Helmet, `httpOnly` cookies, `/health/ready`) —
all present.

**`PROJECT_PLAN.md`:** now states Phase 26 as current, and contains an explicit
section reconciling the two phase-numbering schemes. The superseded Phase 18–20
sections are **marked SUPERSEDED and retained**, not deleted — the divergence
is documented rather than erased. I verified the plan does not silently claim
Phase 18 was "Observability" as fact.

### 2.1 Verdict

**WS5 is accurate.** Every mechanically checkable claim holds. The principal
risk with this workstream — documentation that asserts plausible-sounding but
false facts — was specifically checked for and not found.

**Residual (N-9):** `PROJECT_PLAN.md` retains superseded sections. A reader who
skips the reconciliation section could still mis-read Phase 18–20. The
mitigation is present and correctly placed; the risk is residual, not zero.

---

## 3. WS6 — release-artifact gate determinism

### 3.1 Self-provisioning — verified

No gate depends on a hardcoded `127.0.0.1:55432`. The only remaining mentions
are in explanatory comments. `scripts/lib/throwaway-postgres.mjs` is shared by
`verify-release-artifact.mjs` and `verify-ci-parity.mjs`.

| Property | Verified |
| -------- | -------- |
| Self-provisioned throwaway PostgreSQL | yes — the gate ran with no pre-existing database |
| Unique container name | `ecc-artifact-pg-9kj4e7a41794` (pid + random) |
| Unique **database** name | `ecc_artifact_9kj4e7a41794` |
| Docker-allocated host port | `-p 127.0.0.1::5432`, port read back via `docker port` |
| Loopback-only | yes — not reachable off-host |
| Readiness is real | query → settle 2 s → query again, plus liveness check each iteration |

### 3.2 Cleanup — verified on both paths

| Scenario | Result |
| -------- | ------ |
| Normal success | **0 containers leaked**; gate reported `throwaway database … destroyed` |
| Failure injected **after** provisioning | gate exit 1, **0 containers leaked** |
| Failure during readiness (Phase 26 test) | **0 leaked** |
| Signal / uncaught exception | `installCleanupHandlers()` on `SIGINT`/`SIGTERM`/`SIGHUP`/`exit`/`uncaughtException` |

The specific leak I originally shipped (provisioner called **outside** the
`try`) is genuinely fixed: the failure-injection test above proves the
`finally` path executes.

### 3.3 The developer `ecc` database cannot be targeted

The database name is always `ecc_<label>_<random>`. I checked the constructor
across labels, including the adversarial `label: 'ecc'`:

```
label=artifact  -> database = ecc_artifact_9kj4e7a41794
label=ci-parity -> database = ecc_ci-parity_9kj44bc6c597
label=ecc       -> database = ecc_ecc_9kj3515976e0     <-- still not "ecc"
```

No code path produces the database name `ecc`. The developer database was
never targeted during this review: its table count (37) and database list are
unchanged.

### 3.4 Can the two gates run independently? — YES

`verify-release-artifact.mjs --skip-web` and `verify-ci-parity.mjs` were run
concurrently; both exited 0, used distinct databases, and leaked nothing. The
database half of the Phase 26 claim holds.

### 3.5 **Concurrency and `apps/api/dist` — partially validated, NOT clean**

This is the most important caveat in this review.

`verify-release-artifact.mjs` and `verify-db-migrations.sh` both delete and
rebuild `apps/api/dist` and `tsconfig.build.tsbuildinfo`, and the migration
gate executes `node dist/main.js`. I ran them **truly concurrently**:

```
migration gate exit=0
artifact gate   exit=0
```

**Both passed.** That is *not* proof the hazard is gone — it is evidence the
race is **timing-dependent and did not manifest on this attempt**. The
mutation hazard is real (one gate can `rm -rf` the directory the other is
executing from) but is not deterministically reproducible.

**Consequence for the claim in the gate header:** the mutual-exclusion warning
is correct and should stay. But the phrasing implies the risk is
straightforward; in practice it is intermittent, which is exactly the
property that causes a team to test concurrently once, see green, and remove
the warning.

**Recommended (not implemented — review is read-only):** make the two gates
build into **separate output directories**, or have the migration gate assert
it holds a lock on `dist`. Today the protection is procedural only.

Recorded as **N-10** (MEDIUM).

### 3.6 Verdict

**WS6 achieves its stated goal for databases and cleanup — verified
empirically, including the failure path.** The residual `dist` race is
documented, real, intermittent, and only procedurally mitigated.

**New finding:** the `ci-parity` label produces a **hyphenated** database name
(`ecc_ci-parity_…`). PostgreSQL accepts it only when quoted. It works today
because the URL is percent-safe and Prisma handles it, but any future
`psql -d <name>` or naive string concatenation in a gate would break.
Cosmetic today, a latent trap tomorrow. Recorded as **N-11** (LOW).

---

## 4. New findings (recorded, NOT fixed — this review is read-only)

| ID | Severity | Finding |
|----|----------|---------|
| **N-6** | LOW | The WS1 gate's correctness depends on the *harness* copying the tree and running the copied script. A harness that mutates in place and re-runs the real script would pass forever. The path bug this review reproduced is exactly that class. |
| **N-7** | LOW | The ValidationPipe assertion covers two known call sites. A pipe registered elsewhere, or per-controller, is not asserted. Fails safe (nothing is claimed) but does not extend coverage. |
| **N-8** | INFO | The AST check rejects `const STRICT = true`. Technically a false positive; defensible for a security gate. |
| **N-9** | LOW | `PROJECT_PLAN.md` retains superseded Phase 18–20 sections. Correctly marked, but a reader who skips the reconciliation section can still mis-read the history. |
| **N-10** | **MEDIUM** | The `apps/api/dist` rebuild race between `verify-release-artifact.mjs` and `verify-db-migrations.sh` is real, **intermittent**, and mitigated only procedurally. My concurrent run went green, which is the condition under which a team would delete the warning. Recommend separate output directories or a lock. |
| **N-11** | LOW | `label: 'ci-parity'` yields database name `ecc_ci-parity_…`. Valid only when quoted; a latent trap for any future raw `psql -d`. |

**No Critical or High finding was discovered.** No security control was found
to have disappeared, been weakened, or been made unreachable.

---

## 5. Constraint compliance

- No production code modified by this review. All mutations were on scratch
  copies outside the repository, or applied and reverted; `git status` for
  `apps/api/src`, `scripts/` and `README.md` is **clean**.
- `docs/PHASE_26_FINAL_REPORT.md` read only, never modified.
- No previous `SECURITY_REVIEW_*.md` modified.
- `PROJECT_PLAN-old.md`, Prisma schema and migrations, `pnpm-lock.yaml` —
  untouched.
- Only throwaway PostgreSQL containers used (`ecc-p27-rev-pg-*`).
  **Developer `ecc` database never targeted** — verified unchanged.
- No git history operation. **No commit, no push.**

## 6. Verdict

| WS | Verdict | Confidence |
|----|---------|-----------|
| WS1 ValidationPipe gate | Functionally correct; the path bug is genuinely fixed and reproduced in both directions | High on correctness, low on coverage breadth |
| WS5 documentation | Every checkable claim verified accurate; no dangling references; no false certification claim | High |
| WS6 gate determinism | Database and cleanup goals met and empirically verified; residual intermittent `dist` race is real | High on DB/cleanup, **medium** on concurrency |

**And the verdict that matters most:** this document does **not** constitute
independent review of Phase 26, because I wrote Phase 26. The Phase 26 review
blocker remains **open**. See §0.
