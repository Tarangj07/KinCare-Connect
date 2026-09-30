# PHASE 36 — REMEDIATION OF THE PHASE 35 FINDINGS

**Phase:** 36 — Remediation of P35-1, P34-1 and P35-2
**Base commit:** `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` (= `origin/main` at start)
**Commit created:** `e77fb2ebcb68c962b79a892b7ffc149f6b5a418e`
**Hosted run:** `36713311446` — **SUCCESS (5/5 jobs, 97 steps, 0 skipped)**
**Date:** 2026-09-30
**Pushes:** 1 (normal fast-forward `5b841eb..e77fb2e`, no force, no rebase, no amend)

> **This phase makes no staging, production or production-readiness claim. It does not claim the
> system is production ready, staging ready, release ready, or fully secure. It claims only that
> three specific findings from the Phase 35 review were reproduced, remediated, and are now
> enforced by mutation-tested controls that pass on a hosted runner.**

> **P34-5 REMAINS OPEN — see §14.** This phase provides no independent review of Phase 32, Phase
> 33, Phase 34 or Phase 35. Review independence must come from a separate reviewer.

---

## 1. Objective

Remediate only the repository-side findings from `SECURITY_REVIEW_PHASE_35.md` that are actionable
from inside this repository:

| Finding | Severity | Remediation approach chosen |
|---|---|---|
| **P35-1** — `/_next/image` live and unauthenticated in the production container | MEDIUM | Disable the Image Optimization endpoint through supported Next.js configuration; add layered gates proving the runtime state; mutation-test them |
| **P34-1** — dependency gates enforce only critical/high, so the Phase 33 floors are unenforced | MEDIUM | A dependency **security floor** read from the resolved graph, not the override declaration; mutation-tested |
| **P35-2** — the untracked-artifact detection path has no passing mutation | LOW | Add mutants that make the CI mirror a real git work tree, including a control that proves attribution and an over-correction guard |

Explicitly **out of scope**, per the brief: P34-5 and every organizational-independence/reviewer
gap. Those are recorded as still open in §14.

---

## 2. Pre-flight state

Verified before any change. HEAD and `origin/main` matched, so no stop condition was hit.

| Item | Value |
|---|---|
| `git status --short` | 16 untracked files (pre-existing reports + reviews), **no** tracked modifications |
| `git diff --stat` | empty |
| `git diff --cached --stat` | empty |
| `git rev-parse HEAD` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| `git rev-parse origin/main` | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` — **identical** |
| `git stash list` | 0 |
| Phase 36 artifacts already present | **none** (`docs/PHASE_36_FINAL_REPORT.md` and `SECURITY_REVIEW_PHASE_36.md` both absent) |

### Baseline fingerprints captured before any change

| Artifact | Baseline SHA-256 |
|---|---|
| `pnpm-lock.yaml` | `7fa75d7c2388114a96b45b3616bc01d4f005a469367d473ed2b2b34cb018b0a8` |
| `apps/api/prisma/schema.prisma` | `a36fd3e7803a7adbbdd6ac77c0f2a51053899b98ee751d447664ea6ce1d1c9be` |
| Prisma migrations (tree) | 3 files, each hashed individually in the baseline |
| `.github/workflows/ci.yml` | `6f23ebddd6e46eb2449e92975b3c81f7fedff322e3ba205b194d8aecd7e29af5` |
| `scripts/verify-ci-parity.mjs` | `2f01d1de533269f53c9078bc3d2ea609a4930926cd5eefb75e305d01cbf0508b` |
| All `SECURITY_REVIEW_*.md` (23 files) | individually hashed |
| All historical `PHASE_*` reports + `docs/RELEASE_READINESS.md` (31 files) | individually hashed |
| `PROJECT_PLAN-old.md` | `277614287b60f697f98f83ff4f1d929b886ad1ef539b14a440c8bd544070ef13` |
| `apps/api/src/**` tree | `f29f05487aacd719bc6439a3c424f5c8860b44c6d5dd61155f64d1a7c5505a6f` |
| `apps/mobile/src/**` tree | `9d5f65ffca955160aa68c03dd6fbf701a3b2716c4def6cbc78702559c16affcf` |
| `apps/web/src/**` tree | `fcd677c60c7bd7c50e1ad0e070f6da0be21ad86a049d4a37b1a1f13aacea817a` |
| Developer `ecc` database | 37 public tables, 14 users, data fingerprint `13d335ef48f7cca651a923b320aa8335` |

### Documents read before acting

`SECURITY_REVIEW_PHASE_35.md`, `SECURITY_REVIEW_PHASE_34.md`, `docs/PHASE_33_FINAL_REPORT.md`,
`docs/PHASE_30_RECONCILIATION.md`, and the current implementations of
`verify-ci-parity.mjs`, `triage-vulnerabilities.mjs`, `lib/next-config-features.mjs`,
`verify-next-config-features.mjs`, `mutate-ci-integration.mjs`, `verify-config-contract.mjs`,
`verify-docker-images.mjs`, `apps/web/next.config.mjs`, `apps/web/Dockerfile` and `.github/workflows/ci.yml`.

**No Phase 35 finding was accepted on its documentation.** Each was reproduced first (§3, §6, §8).

---

## 3. P35-1 reproduction

Reproduced on `HEAD` with **no changes**, against the actual production build.

### 3.1 The application renders no images

```
$ grep -rn "next/image|<Image|getImageProps" apps/web/src packages/*/src
(no matches)
$ grep -rn "<img|<Image" apps/web/src
(no matches)
```

No image component exists anywhere, including in `packages/ui`. So no functionality is at stake in
changing the image configuration — this is remediation path **A** (disable a feature the
application does not use), not path **B** (constrain a feature it needs).

### 3.2 The endpoint was live, unauthenticated, on `HEAD`

```
$ node apps/web/.next/standalone/apps/web/server.js      # PORT=13950
  /_next/image?url=%2Frepro.png&w=64&q=75        200 image/png 7853 bytes
  /_next/image?url=https%3A%2F%2Fexample.com%2Fx.png&w=64&q=75   400
  /_next/image?url=%2Fmissing.png&w=64&q=75      400
  /definitely-not-a-route                       404
```

Then the same probe against the **production container image** built from `HEAD`:

```
$ docker run -d -p 13960:3001 ecc-web:p36-verify
  /_next/image?url=%2Frepro.png&w=64&q=75        400  "The requested resource isn't a valid image."
  /definitely-not-a-route                       404
```

**P35-1 reproduced.** `/_next/image` is a live, unauthenticated, externally reachable route in the
shipped image, registered by Next regardless of whether any component uses it.

### 3.3 Why the existing evidence was wrong

`triage-vulnerabilities.mjs` concluded NOT REACHABLE from *application usage* — no `next/image`
import, no `<Image>` element, no `images` config key — and cited as corroboration: *"Phase 23
additionally probed the running image: GET /_next/image answered 400 for both a remote and a local
url"*.

A 400 carrying the optimizer's **own error string** is evidence the endpoint is **present and
executing**, not absent. That inference was the whole basis of the disposition, and it is invalid.

### 3.4 What was actually protecting the deployment

`sharp` is absent from the web image:

```
$ docker exec <web> node -e "require('sharp')"   ->  sharp MISSING
$ docker exec <web> sh -c 'find / -name "*.wasm" | wc -l'  ->  0
```

With no `sharp` and no squoosh WASM codecs, `next/dist/server/image-optimizer.js` cannot run the
AVIF transform. **That — not anything the repository checks — is what kept advisory 1193733
unexploitable.** It is an incidental property of a transitive *optional* dependency.

---

## 4. P35-1 remediation

### 4.1 Why option A, and why it costs nothing

`next/dist/server/next-server.js:146-166` gates the optimizer:

```js
this.handleNextImageRequest = async (req, res, parsedUrl) => {
    if (!parsedUrl.pathname.startsWith("/_next/image")) return false;
    if (this.minimalMode || this.nextConfig.output === "export" || process.env.NEXT_MINIMAL) { ...400... }
    const imagesConfig = this.nextConfig.images;
    if (imagesConfig.loader !== "default" || imagesConfig.unoptimized) {
        await this.render404(req, res);        // <-- 404, optimizer module never required
        return true;
    }
    ...
```

`images: { unoptimized: true }` is the supported configuration for an app that renders no images.
`<Image>` would still work (it renders the plain `src`), so nothing is lost.

**`apps/web/next.config.mjs`** now carries:

```js
  images: {
    unoptimized: true,
  },
```

with a comment recording why, what the previous evidence got wrong, and which script proves the
runtime state.

### 4.2 The triage rule was rewritten, not weakened

`NEXT_FEATURES[image optimization]` previously asked *"does the app use images?"*. It now asks
*"can the optimizer be entered at all?"* — the question that actually gates the endpoint — and fails
closed at every step:

1. `images.unoptimized` unreadable → **REACHABLE** ("I could not check this" is a finding).
2. `unoptimized === true` → **NOT REACHABLE**, with the mechanism named.
3. a non-`default` loader → **REACHABLE** (a third-party loader may still fetch and transform).
4. anything else → **REACHABLE**, explicitly noting that *absence of a `next/image` import is not a
   defence*, quoting the Phase 35 evidence.

**A value reader was needed.** `analyseNextConfig` reports *keys*, and `images: {}` and
`images: { unoptimized: true }` declare the same key with opposite security postures.
`readNextConfigValue()` in `scripts/lib/next-config-features.mjs` reads a nested config **value**
from the AST, and is deliberately conservative — it returns `known: false` for a spread, a computed
key, a cross-file reference, a conditional/merged export, or any non-literal value, and never
guesses. Verified behaviour:

| Input | Result |
|---|---|
| `images: { unoptimized: true }` | `{known:true, value:true}` |
| `images: { unoptimized: false }` | `{known:true, value:false}` |
| `images: { unoptimized: !true }` | `{known:true, value:false}` |
| `images: {}` / no `images` key | `{known:true, value:undefined}` (Next's default applies) |
| `images: { unoptimized: someGlobal }` | `{known:false}` → REACHABLE |
| `const b={}; export default { images: {...b} }` | `{known:false}` → REACHABLE |
| `const b={images:{unoptimized:true}}; export default {...b}` | `{known:false}` → REACHABLE |
| `export default { a: 'unoptimized: true' }` | `{known:true, value:undefined}` — a string is not a value |
| `export default { /* images: { unoptimized: true } */ }` | `{known:true, value:undefined}` — a comment is not a value |

### 4.3 The new gate: `scripts/verify-next-image-optimizer.mjs`

Three layers, each failing closed. A source-only check would have repeated the exact mistake the
finding describes, so the gate refuses to certify anything it cannot read.

| Layer | Asserts | Why it exists |
|---|---|---|
| 1 — configuration | `images.unoptimized` is a readable literal `true`, from the AST | catches the config, including a comment or a dynamic value |
| 2 — **build evidence** | the BUILT `.next/images-manifest.json` reports `unoptimized: true`, and `remotePatterns` is empty | Next's own resolved output. Catches a stale build, a cached turbo task, or a config edited without rebuilding |
| 3 — **runtime** | the standalone server is started and `/_next/image` is requested unauthenticated | the only layer that can observe the actual endpoint |

Layer 3 asserts the endpoint does not serve a transformed image (a 404 is the intended state; a
200 with `content-type: image/*` is a **FAILURE** — that is P35-1 itself). It also probes a remote
URL (the SSRF-shaped half of the same route) and asserts `/` and `/health` still answer 200, so
the surface cannot be closed by breaking the application.

**If the build is missing the gate FAILS.** It has a `--config-only` flag, but CI does not use it
and the CI-parity contract pins the exact command so a step cannot be narrowed to it.

---

## 5. Runtime proof for `/_next/image`

### 5.1 Clean production image, real container

Built with `docker build -f apps/web/Dockerfile` from a clone of the fix, then run:

| Request | Status |
|---|---|
| `/_next/image?url=%2Frepro.png&w=64&q=75` | **404** |
| `/_next/image?url=https%3A%2F%2Fexample.com%2Fx.png&w=64&q=75` | **404** |
| `/_next/image?url=%2Fmissing.png&w=64&q=75` | **404** |
| `/_next/image` (no parameters) | **404** |
| `/` | 200 |
| `/health` | 200 |
| `/dashboard/senior` | 200 |
| `/dashboard/admin` | 200 |

**The endpoint is disabled and unrelated routes are functional.**

### 5.2 The container gate now proves it in the shipped artifact

`verify-docker-images.mjs` (existing gate, extended — not replaced) stages a **real PNG** into the
running container's `public/` before probing:

```
PASS  the image-optimization endpoint does not serve an image (Phase 36 P35-1)
      — local png: 404 text/html; charset=utf-8; remote url: 404 text/html; charset=utf-8
PASS  the shipped image records the optimizer as disabled (Phase 36 P35-1)
      — no build manifest in the runtime image (only the traced server and static assets)
```

The real PNG matters. A request for a **missing** file answers 400 from *inside* the optimizer,
which looks like a refusal but is the optimizer **running** — exactly the misreading Phase 35
recorded. With a decodable image present, an enabled optimizer answers 200 and a disabled one
answers 404, so the probe distinguishes the two.

The second check asserts `images-manifest.json` is **absent** from the runtime image. The Dockerfile
copies only `.next/standalone` and `.next/static`, so there is nothing to read; that absence is
itself worth asserting, because a manifest in the image could disagree with the server that runs.

### 5.3 Verified on the hosted runner

Run `36713311446`, `web` job, step 10:

```
PASS  /_next/image does not serve an optimized image to an unauthenticated request
      (status=404 content-type=text/html bytes=7193 …)
PASS  /_next/image does not fetch a REMOTE url  (status=404 bytes=7173)
PASS  / still answers 200 (the app was not broken to close the endpoint)  (status=200)
PASS  /health still answers 200 …  (status=200)
PASSED — /_next/image cannot serve an optimized image …
```

Containers job, same run: both Phase 36 checks `success`.

### 5.4 Claim discipline

**Proved:** the endpoint is unreachable in the source build, the standalone server, the production
container, and on the hosted runner.
**NOT claimed:** that the AVIF RCE path is unreachable in general. The AVIF transform still cannot
execute while `sharp` is absent, but that is a property of the dependency graph, not of this gate —
and the gate makes the endpoint itself unreachable, so the AVIF path becomes reachable only if
`sharp` is added **and** someone re-enables the optimizer, which Layer 1 catches.

---

## 6. P34-1 reproduction

In a disposable clone of `HEAD` outside the repository, with only the two `brace-expansion` override
targets lowered to the **high-severity** floors `1.1.20` / `2.1.6`, then a real install:

```
$ pnpm audit --json | metadata.vulnerabilities
{"info":0,"low":8,"moderate":38,"high":44,"critical":4}
                                  ↑ 36 -> 38; high and critical UNCHANGED
  moderate 1240100  <1.1.21         >=1.1.21   installed 1.1.20
  moderate 1240101  >=2.0.0 <2.1.7  >=2.1.7    installed 2.1.6
```

Then every pre-existing gate, against a **complete** mirror (Prisma client generated — see the
correction in §9.2):

| Gate | Exit |
|---|---|
| `verify-dependency-audit.mjs` | **0** |
| `verify-dependency-triage.mjs` | **0** |
| `triage-vulnerabilities.mjs` | **0** |
| `verify-ci-parity.mjs --list` | **0** |
| `verify-config-contract.mjs` | **0** |

**P34-1 reproduced.** Two moderate advisories Phase 33 deliberately fixed are back in the effective
graph and every gate is green.

### 6.1 Root cause, re-derived

`triage-vulnerabilities.mjs:748`:

```js
.filter((a) => a.severity === 'critical' || a.severity === 'high')
```

Every dependency gate filters to critical and high **before** deciding anything. And:

```
$ grep -rn "1\.1\.21|2\.1\.7|6\.28\.1" scripts/ .github/
(no matches)
```

The floors existed only as a YAML comment in `pnpm-workspace.yaml`.

---

## 7. Dependency-floor remediation

### 7.1 `scripts/verify-dependency-security-floor.mjs`

**Invariant:** *CI must not become green merely because the security remediation was silently
lowered to a version that reintroduces a known advisory.*

**Authoritative source: the resolved graph in `pnpm-lock.yaml`**, not the override declaration. A
declaration can be right while the lockfile is wrong — a stale lockfile, a partially applied
install, a hand edit. That drift is invisible to a check that reads the declaration and is exactly
what this control must catch. The lockfile is parsed with the `yaml` package already in the graph,
resolved the same way `verify-ci-parity.mjs` resolves it, and the walk goes through `snapshots:`,
where pnpm records each resolved package's resolved dependencies.

**Three floors**, each carrying the advisories it came from:

| Floor | Advisories |
|---|---|
| `brace-expansion` 1.x ≥ `1.1.21` | 1240108 (high, `<1.1.19`), 1240104 (high, `<1.1.20`), 1240100 (**moderate**, `<1.1.21`) |
| `brace-expansion` 2.x ≥ `2.1.7` | 1240109 (high, `<2.1.5`), 1240105 (high, `<2.1.6`), 1240101 (**moderate**, `>=2.0.0 <2.1.7`) |
| `undici` 6.x ≥ `6.28.1` | 1240042 (high), 1239934 (moderate), 1240039 (low) |

**Four verdicts, so the legitimate cases are not punished:**

| Verdict | When | Meaning |
|---|---|---|
| `OK` | resolved version ≥ floor | compliant |
| `BREACH` | resolved version < floor | **fails CI** |
| `REVIEW` | a major no floor governs | exit 0, but named so a human must look; guessing would either fail a legitimate upgrade or, worse, pass a vulnerable one |
| `REMOVED` | the package is absent from the graph | the advisory went with it — recorded so it is never a pass *by omission* |

It is a **floor, not a pin**: `1.1.21 → 1.1.22` passes forever with no edit to the script. An
unparseable version is a BREACH, not a pass.

**Explicitly not done** — the control **suppresses nothing**: no audit ignore, no allow-list, no
severity change, no `continue-on-error`, no triage weakening, no classification of a reachable
vulnerability as unreachable, and no package pinned outside the three recorded floors. It **adds** a
check.

### 7.2 Result on the repository

```
    [OK     ] brace-expansion@1.1.21   the graph resolves `brace-expansion@1.1.21`, at or above the floor.
    [OK     ] brace-expansion@2.1.7    the graph resolves `brace-expansion@2.1.7`, at or above the floor.
    [OK     ] undici@6.28.1            the graph resolves `undici@6.28.1`, at or above the floor.
  3 instance(s) checked: 3 at or above floor, 0 below, 0 needing review, 0 no longer present.
PASSED
```

### 7.3 P34-1 closed — verified

Re-run against the lowered-override mirror from §6, everything else identical:

| Gate | Exit |
|---|---|
| `verify-dependency-audit.mjs` | 0 |
| `verify-dependency-triage.mjs` | 0 |
| `triage-vulnerabilities.mjs` | 0 |
| `verify-ci-parity.mjs --list` | 0 |
| **`verify-dependency-security-floor.mjs`** | **1** |

```
    [BREACH ] brace-expansion@1.1.21
               the graph resolves `brace-expansion@1.1.20`, which is BELOW the floor brace-expansion@1.1.21.
               advisories 1240108 (high, <1.1.19), 1240104 (high, <1.1.20) and 1240100 (MODERATE, <1.1.21)…
    [BREACH ] brace-expansion@2.1.7
               the graph resolves `brace-expansion@2.1.6`, which is BELOW the floor brace-expansion@2.1.7…
  3 instance(s) checked: 1 at or above floor, 2 below, 0 needing review, 0 no longer present.
FAILED — 2 resolved dependency instance(s) are below the recorded security floor.
```

**Only the new control objects.** The state Phase 35 demonstrated as silently green now fails CI.

### 7.4 `pnpm-lock.yaml` — unchanged

`7fa75d7c2388114a96b45b3616bc01d4f005a469367d473ed2b2b34cb018b0a8` before **and** after. No
dependency change was required; the authorization to modify it was not needed and not used.

---

## 8. P35-2 reproduction and remediation

### 8.1 Reproduction

`verify-ci-parity.mjs`'s `untrackedTargetProblem()` opens with:

```js
if (!existsSync(path.join(repoRoot, '.git'))) return null;
```

Every mirror `mutate-ci-integration.mjs` built was a `mkdtemp` directory with **no `.git`**, so
that branch returned `null` for **all 21 existing mutants**. Confirmed by reading
`makeMirror()`: it copies `scripts/`, three `package.json` files, the workflow, and a
`node_modules` symlink — nothing that creates a work tree.

The protection was implemented, read, and exercised by nothing that could fail. **P35-2
reproduced.**

### 8.2 Remediation — three mutants forming a 2×2

`gitInitMirror()` / `gitUntrack()` make the mirror a real git work tree with everything committed,
then remove one file from the index while leaving it on disk — the exact Phase 31/32 condition.

| Mutant | State | Expected | Result |
|---|---|---|---|
| **C22** | gate script present on disk, **not tracked** | must **FAIL** | `step "Storage backup …" depends on a file that is not committed: scripts/verify-storage-backup-restore.mjs is required by this step but is NOT tracked by git.` |
| **C23** | same untracked tree **+ the untracked assertion disabled** (`return null` inserted at the top of `untrackedTargetProblem()`) | must **PASS** | `correctly NOT detected` |
| **C24** | everything tracked (positive control) | must **PASS** | `correctly NOT detected` |

**Why C23 is the important one.** C22 alone would be weaker than it looks: the contract has several
reasons to report a problem, so "exit 1" does not prove the *untracked* assertion fired. C23 leaves
an otherwise-identical broken tree with that assertion neutralised, and the contract goes green.
If C22 and C23 disagree, C22's detection was attributable to that assertion specifically. C24 is
the over-correction guard, without which a "fix" that made the assertion always report a problem
would pass both.

A harness change was also required: the "did the mutant change anything" guard compared **file
content**, so a mutant that only changes the git **index** was scored as a no-op — which would have
deleted the only coverage this finding has. Git state is now its own change signal.

### 8.3 Also fixed: a vacuous size guard

`verify-ci-parity.mjs` guarded its own contract with:

```js
if (REQUIRED_GATES.length < 17) { … }
```

This was non-vacuous only because `17` was a hard-coded literal. It is now asserted against an
independent `REQUIRED_GATE_IDS` list of 21 ids, and each id is checked by name — so deleting an
entry *and* lowering a threshold together still fails. This is the same defect class as mutant D11
in the dependency harness, found and fixed rather than recorded.

---

## 9. Mutation results

### 9.1 `scripts/mutate-next-image-optimizer.mjs` — **8 mutants, 7 detected + 1 tolerated by design**

| ID | Mutation | Expected | Result |
|---|---|---|---|
| **M1** | the vulnerable configuration **restored** (`images` key removed entirely) | fail | `-> DETECTED by the intended check: images.unoptimized is exactly true` |
| **M2** | the runtime probe fixture cannot be staged (public/ replaced by a regular file) | fail | `-> DETECTED by the intended check: the probe image is staged` |
| **M3** | config correct but the **built manifest disagrees** (hand-edited to `unoptimized:false`) | fail | `-> DETECTED by the intended check: the BUILT manifest reports unoptimized: true` |
| **M4** | `unoptimized` explicitly `false` | fail | `-> DETECTED: images.unoptimized is exactly true` |
| **M5** | `unoptimized` made **dynamic** (`globalThis.__imageOptIn`) | fail | `-> DETECTED: images.unoptimized is a readable literal` |
| **M6** | the check satisfied by a **comment** claiming `unoptimized: true` | fail | `-> DETECTED: images.unoptimized is exactly true` |
| **M7** | the **runtime probe disabled**, config and build stay correct | pass | `-> tolerated, as designed` |
| **M8** | the analyser regressed to a **text match** | fail | `-> DETECTED: a COMMENT claiming unoptimized: true does not satisfy the check` |

**Every detection is scored against the named check**, not merely a non-zero exit. M7 is tolerated
deliberately: Layers 1 and 2 still refuse to certify a tree whose runtime was never probed, which
is what a layered control should do — and the degradation is printed, not silent.

### 9.2 `scripts/mutate-dependency-security-floor.mjs` — **12 mutants**

| ID | Mutation | Expected | Result |
|---|---|---|---|
| D1 | `brace-expansion` 1.x resolved below floor (1.1.21→1.1.20) | fail | `-> DETECTED for the intended reason` |
| D2 | `brace-expansion` 2.x resolved below floor (2.1.7→2.1.6) | fail | `-> DETECTED for the intended reason` |
| D3 | `undici` resolved below floor (6.28.1→6.28.0) | fail | `-> DETECTED for the intended reason` |
| D4 | override entry deleted from `pnpm-workspace.yaml` (lockfile untouched) | pass | `-> correctly NOT detected` |
| D5 | **override correct, lockfile still vulnerable** | fail | `-> DETECTED for the intended reason` |
| D6 | **lockfile alone** edited, no install run | fail | `-> DETECTED for the intended reason` |
| D7 | coordinated **upgrade** above the floor (1.1.21→1.1.22) | pass | `-> correctly NOT detected` |
| D8 | dependency **genuinely gone** from the graph | pass | `-> correctly NOT detected` (REMOVED) |
| D9 | **unrelated package** added to the graph | pass | `-> correctly NOT detected` (no BREACH/REVIEW) |
| D10 | **new major** `brace-expansion@3.0.0` | review | `-> REVIEW, as required` |
| D11 | `FLOORS` list **emptied** | pass | `-> correctly NOT detected` |
| D12 | a floor **raised above every version** (1.1.99) | fail | `-> DETECTED for the intended reason` |

Each `fail` mutant additionally asserts the output mentions the floor, the offending version, and
`BELOW` — a detection that fires for a different reason is rejected. **That discipline exists
because of a documented past failure** (§9.4). D5 and D6 are the mutants a declaration-only check
could not catch.

### 9.3 `scripts/mutate-ci-integration.mjs` — **24 mutants (was 21)**

21 detected, 3 positive controls correctly not flagged. The three new ones are C22/C23/C24 from §8.
All post-conditions `ok`: `.github/workflows/ci.yml`, `scripts/verify-ci-parity.mjs`,
`apps/api/package.json`, `mutate-rate-limit-n12.mjs`, `verify-storage-backup-restore.mjs` and
`run-db-suites.mjs` are byte-identical after the run.

### 9.4 A setup artifact I had to catch — recorded, not hidden

During the P34-1 reproduction, `verify-dependency-audit.mjs` initially exited 1 in the disposable
mirror. That looked like a second control catching the regression. It was not:

```
- the Prisma query engine did not load:  code: 'MODULE_NOT_FOUND'
  requireStack: [ …/@prisma/client/default.js, …/apps/api/[eval] ]
```

A **missing generated Prisma client in my own incomplete mirror** — not a security detection. After
running `prisma generate`, the same gate exits **0**, and the corrected table in §6 is the one that
stands. This is precisely the trap Phase 34 recorded and discarded a result over; it is recorded
here for the same reason.

### 9.5 Pre-existing harnesses re-run

| Harness | Mutants | Result |
|---|---|---|
| `mutate-rate-limit-n12.mjs` (N-12) | 8 | PASS — 7 detected, 1 negative control correctly blind |
| `mutate-config-contract.mjs` | — | PASS |
| `mutate-next-config-rewrites.mjs` | — | PASS |
| `mutate-decorator-metadata.mjs` | — | PASS |
| `mutate-route-authorization.mjs` | — | PASS |
| `mutate-token-lifetime.mjs` | — | PASS |
| `mutate-container-gate.mjs` | 11 | **PARTIAL — see §13.1** |

---

## 10. Full regression results

Run in the repository's established order. Exact counts; nothing skipped and reported as green.

| # | Gate / suite | Result |
|---|---|---|
| 1 | `verify-dependency-audit.mjs` | **PASS** |
| 2 | `verify-dependency-triage.mjs` | **PASS** |
| 3 | **`verify-dependency-security-floor.mjs`** (new) | **PASS** |
| 4 | `triage-vulnerabilities.mjs` | **PASS** |
| 5 | `verify-config-contract.mjs` | **PASS** |
| 6 | `verify-env-contract.mjs` | **PASS** |
| 7 | `verify-next-config-features.mjs` | **PASS** (extended, §11) |
| 8 | **`verify-next-image-optimizer.mjs`** (new) | **PASS** |
| 9 | `verify-ci-parity.mjs --list` | **PASS** |
| 10 | `pnpm typecheck` | **PASS** (11/11 tasks) |
| 11 | `pnpm --filter @ecc/api build` | **PASS** |
| 12 | `pnpm --filter @ecc/api build:verify` | **PASS** (280 files in dist; clean/warm/stale-tsbuildinfo all emitted `dist/main.js`) |
| 13 | `verify:metadata` (compiled-artifact decorator parity) | **PASS** |
| 14 | `verify:routes` (every non-public route guarded) | **PASS** |
| 15 | **`run-db-suites.mjs`** — e2e | **PASS** — 8 files / **138 tests** / **0 skipped** |
| 16 | **`run-db-suites.mjs`** — unit + integration in one process | **PASS** — 27 files / **348 tests** / **0 skipped** |
| 17 | mobile tests | **PASS** — 6 files / **34 tests** |
| 18 | web tests | **PASS** — 1 file / **1 test** (pre-existing gap `R-3`, unchanged) |
| 19 | **`verify-docker-images.mjs`** | **PASS** (all checks, including both Phase 36 ones) |
| 20 | API lint | **124 problems (55 errors, 69 warnings)** — baseline held **exactly**, no new debt |
| 21 | mobile lint | **18 problems (0 errors, 18 warnings)** — unchanged |

**Test totals: 486 database-backed (138 e2e + 348 unit+integration) + 34 mobile + 1 web = 521, 0 skipped.**

Both lint steps remain `continue-on-error: true` in CI exactly as before — the baseline was
compared against, not changed to obtain green output.

### 10.1 Database protection

`run-db-suites.mjs` created and destroyed its own throwaway PostgreSQL
(`ecc-p28-pg-bbj96f51b0d7`, database `ecc_p28_bbj96f51b0d7`) and printed, from the harness itself:

> `the developer `ecc` database is not involved in this run`

**Developer database unchanged:** 37 public tables, 14 users, data fingerprint
`13d335ef48f7cca651a923b320aa8335` — **byte-identical to the pre-flight baseline.**

---

## 11. Two regressions this change introduced, and fixed

Recorded because both would otherwise have shipped silently, and because one of them is a
false-positive-class defect rather than a break.

**(a) `verify-next-config-features.mjs` asserted the wrong invariant.** It required the real config
to "declare **none** of the triaged features" — true of the Phase 25 config, false once `images`
was added. Deleting the assertion would have been the easy fix and would have lost a check.
Restated and made **more** precise: a feature being *present* is not what matters, it is whether
presence **enables a reachable surface**. The old form was satisfied by a config with no `images`
key at all — which is exactly the configuration that left `/_next/image` live on the Phase 35
evidence. The replacement asserts (i) no routing surface, and (ii) the `images` key is present
**and** carries `unoptimized: true`. Ten value-reader cases were added alongside it.

**(b) `verify-config-contract.mjs` reported two phantom environment variables.** My new fixtures
contained `process.env.NEXT_IMAGE_ON` and `process.env.NEXT_IMAGE_OPTIMIZER` as *strings inside
fixture config source*. The config-contract gate scans raw source for `process.env` reads and
cannot distinguish a read inside a string literal from a real one, so it correctly — and
unhelpfully — reported two undocumented environment variables this repository does not read.
Fixed by using a global (`globalThis.__imageOptIn`) instead: the property under test is "a
non-literal value is unreadable", which a global exercises identically, and it keeps the declared
environment surface honest.

---

## 12. Hosted CI run

| Field | Value |
|---|---|
| Run | **`36713311446`** |
| Commit | **`e77fb2ebcb68c962b79a892b7ffc149f6b5a418e`** (the exact final commit) |
| URL | https://github.com/Tarangj07/KinCare-Connect/actions/runs/36713311446 |
| Window | 2026-09-30T12:12:31Z → 12:18:42Z |
| **Final status** | **`success` — 5/5 jobs** |
| Total steps | **97, of which 0 skipped** |

| Job | Result |
|---|---|
| API — typecheck, tests (unit + PostgreSQL integration), build | **success** |
| Release — migrations, release artifacts, security regression sweeps | **success** |
| Containers — build API and Web images, verify they run | **success** |
| Web — typecheck, lint, tests, build | **success** |
| Mobile — typecheck and tests | **success** |

**No step was skipped anywhere in the run.** The four new Phase 36 steps, all recorded `success`
(i.e. executed, not skipped):

```
success  20  [api]     Supply chain — the dependency security floor is enforced (Phase 36 P34-1)
success  10  [web]     Web runtime — the Image Optimization endpoint is unreachable (Phase 36 P35-1)
success  20  [release] Mutation — the image-optimizer gate detects the P35-1 state (Phase 36)
success  21  [release] Mutation — the dependency floor detects a lowered remediation (Phase 36)
```

The mutation harnesses' full mutant-by-mutant output is present in the run logs (8 image-optimizer
mutants, 12 dependency-floor mutants, all as in §9.1–§9.2), and the containers job logs both
Phase 36 container checks as `PASS`.

The pre-existing security steps were also all green, including
`Supply chain — no reachable critical/high advisory`, `Configuration contract`,
`Storage backup`, `Mutation — the N-12 429 contract`,
`Mutation — removing a required Phase 28 gate from CI` and `Dependency audit has not been weakened`.

A green run is evidence that **this commit** builds and passes **its own gates** on GitHub-hosted
runners. It is not a readiness, security, or compliance certification, and none is claimed.

---

## 13. Remaining findings and blockers

### 13.1 Container-gate mutation harness — PARTIAL, environment-limited (UNVERIFIED, not a defect)

`scripts/mutate-container-gate.mjs` rebuilds the API image with `--no-cache` for each of 11
mutants. Result: **7 PASS (M1–M7), 4 could not run (M8–M11)**.

The 4 did not fail a control. They failed to build:

```
the mutant image failed to build:
  #14 352.2 [WARN] GET https://registry.npmjs.org/next/-/next-14.2.35.tgz error (23). Will retry…
  #14 352.2 TimeoutError: The operation was aborted due to timeout
  ERROR: failed to build: … pnpm install --filter @ecc/api... --frozen-lockfile … exit code: 1
```

**npm-registry timeouts inside `--no-cache` Docker builds on this host**, not security detection
and not a code defect. The harness was stopped after ~1 hour of ~10-minute-per-mutant builds and
26 GB of build cache. The free-space floor (20 GB) had already been breached before Phase 36 began
(19.9 GB at harness start).

**M8–M11 are therefore UNVERIFIED on this host.** They were also unaffected by this phase: all four
target N-12 rate-limit behaviour in the API image, which Phase 36 did not touch, and the N-12
control itself passed locally and in hosted run `36684252352` and `36713311446`.

Docker build cache was pruned afterwards (disk back to 41 GB free).

### 13.2 No new findings

No new CRITICAL, HIGH or MEDIUM finding was identified. Two INFO observations are recorded:

- **`sharp` is still absent from the web image.** Nothing about that is asserted or controlled
  except that `/_next/image` cannot be reached at all, which is stronger. If a future dependency
  pulls `sharp` in, the endpoint is still 404 — the gate does not depend on `sharp`'s absence.
- **`images-manifest.json` is not shipped in the runtime image.** Deliberate (the Dockerfile copies
  only `.next/standalone` and `.next/static`). Now asserted, so a change that starts copying it is
  reviewed rather than discovered.

### 13.3 Stop conditions

None was hit. No Prisma change, no application-architecture change, no major-version migration, no
broad lockfile churn (`pnpm-lock.yaml` is byte-identical), no new authentication architecture, no
existing gate weakened, no new unrelated security blocker, no test targeted the developer
database, and all three findings reproduced. The Phase 35 findings were all reproducible, so the
"cannot be reproduced" stop condition did not apply.

---

## 14. Explicit limitations

1. **P34-5 REMAINS OPEN. This phase provides no independent review of Phase 32, Phase 33, Phase 34
   or Phase 35. Review independence must come from a separate reviewer.** This commit is the
   implementer's own remediation of findings raised against its predecessor's work; it cannot
   discharge that requirement, and no document created in this phase should be cited as doing so.
   The organisational-independence gap described in Phase 35 §1.2 is unchanged: implementer and
   reviewer share this repository, this host and these credentials.
2. The inherited independent-review gaps for **Phases 22, 23, 25, 26 and 27** remain open and are
   unaffected by this phase.
3. **M8–M11 of the container-gate mutation harness are UNVERIFIED** on this host (§13.1).
4. The dependency-floor control proves that the floors recorded in its source are **enforced**. It
   does not prove those floors are the correct floors for every future advisory; a new advisory
   against an already-floored package raises the floor, and a new package needs a floor added.
5. The floors are enforced against the **lockfile**. If a future change removed the lockfile from
   CI, the control would read a stale file — but `verify-ci-parity.mjs` requires every gate to be a
   real CI step and `verify-dependency-audit.mjs` requires `pnpm install --frozen-lockfile`, so
   that removal would fail other controls.
6. **Not claimed:** staging deployment (none has ever existed), production deployment (nothing has
   ever been deployed anywhere), production TLS, observability, load/soak testing, penetration
   testing, compliance certification, backup automation/encryption/retention/off-host storage, or
   that the remaining 4 critical / 44 high advisories are unreachable in *any* deployment.
7. The `/_next/image` runtime proof covers the built standalone server and the production container
   on this host and on a GitHub-hosted runner. It says nothing about a deployment outside this
   repository.

---

## 15. Files changed

**Modified (6):**

| File | Change |
|---|---|
| `apps/web/next.config.mjs` | `images: { unoptimized: true }` (+38 lines of rationale) |
| `.github/workflows/ci.yml` | 4 new steps: floor gate (api), image-optimizer gate (web), 2 mutation harnesses (release), + web build for the harness |
| `scripts/triage-vulnerabilities.mjs` | image-optimization rule rewritten to gate on the config that actually matters; `nextConfigSource()` added |
| `scripts/lib/next-config-features.mjs` | `readNextConfigValue()` added (+~160 lines) |
| `scripts/verify-ci-parity.mjs` | 4 required gates + `REQUIRED_GATE_IDS` replacing the vacuous size guard |
| `scripts/mutate-ci-integration.mjs` | `gitInitMirror()`/`gitUntrack()`, mutants C22/C23/C24, git-aware change detection |
| `scripts/verify-next-config-features.mjs` | real-config invariant restated; 10 value-reader cases added |
| `scripts/verify-docker-images.mjs` | 2 container-level P35-1 checks with a real staged PNG |

**Created (4):**

| File | Purpose |
|---|---|
| `scripts/verify-next-image-optimizer.mjs` | P35-1 gate: config + built manifest + running server |
| `scripts/mutate-next-image-optimizer.mjs` | 8 mutants for the above |
| `scripts/verify-dependency-security-floor.mjs` | P34-1 gate: resolved-graph floors |
| `scripts/mutate-dependency-security-floor.mjs` | 12 mutants for the above |
| `docs/PHASE_36_FINAL_REPORT.md` | this document |

`12 files changed, 2581 insertions(+), 21 deletions(-)` excluding this report.

### Protected artifacts — after

| Artifact | Result |
|---|---|
| `pnpm-lock.yaml` | **UNCHANGED** (`7fa75d7c…`) |
| `apps/api/prisma/schema.prisma` | **UNCHANGED** (`a36fd3e7…`) |
| Prisma migrations (3 files) | **UNCHANGED** |
| `apps/api/src/**` tree | **UNCHANGED** (`f29f0548…`) |
| `apps/mobile/src/**` tree | **UNCHANGED** (`9d5f65ff…`) |
| `apps/web/src/**` tree | **UNCHANGED** (`fcd677c6…`) |
| `packages/**`, all `apps/*/package.json` | **UNCHANGED** |
| All `SECURITY_REVIEW_*.md` (23) | **UNCHANGED** |
| All historical `PHASE_*` reports + `docs/RELEASE_READINESS.md` (31) | **UNCHANGED** |
| `PROJECT_PLAN-old.md` | **UNCHANGED** |
| `.github/workflows/ci.yml` | **MODIFIED — intentional** (wiring the new gates) |
| `scripts/verify-ci-parity.mjs` | **MODIFIED — intentional** (registering the new gates) |
| `SECURITY_REVIEW_PHASE_35.md` | **UNCHANGED** — no historical review was edited to make a prior claim look correct |
| Developer `ecc` database | **UNCHANGED** (37 tables, 14 users, `13d335ef…`) |
| Throwaway infrastructure | created and destroyed; `docker ps` shows only the 4 pre-existing containers |
| Docker build cache | pruned; 41 GB free (from 16 GB at peak) |

`SECURITY_REVIEW_PHASE_36.md` was **not created**, per the brief.

---

## 16. Commit / push information

| Field | Value |
|---|---|
| Commit | `e77fb2ebcb68c962b79a892b7ffc149f6b5a418e` |
| Subject | `phase(36): remediate P35-1, P34-1 and P35-2 from the independent Phase 35 review` |
| Parent | `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17` |
| Push | `5b841eb..e77fb2e  main -> main` — normal fast-forward |
| Force-push / rebase / reset / amend of unrelated commits | **none** |
| Commits created | 1 |
| Pushes | 1 |
| Files in the commit | 12 |
| Final `HEAD` == `origin/main` | `e77fb2ebcb68c962b79a892b7ffc149f6b5a418e` |

---

*Remediation performed against `5b841eb2296ae0f6053a9ce3130ca4bf201b6a17`. Every Phase 35 finding
was reproduced before it was remediated. No protected artifact was modified except `ci.yml` and
`verify-ci-parity.mjs`, both intentionally, to register the new gates. P34-5 remains open. No
staging, production or production-readiness claim is made.*
