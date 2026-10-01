# SECURITY_REVIEW_PHASE_36.md

**Subject:** Phase 36 — P35-1 (Next Image Optimizer), P34-1 (dependency security floor), P35-2 (untracked-artifact attribution), CI parity / REQUIRED_GATES integration
**Repository:** KinCare-Connect (`Tarangj07/KinCare-Connect`)
**Baseline reviewed:** `199877aef283eff36984114ecf486eaec1554c39` — Phase 36 final HEAD, identical to `origin/main`, divergence 0/0
**Hosted CI run inspected:** `36714434566` (SHA verified as `199877ae…`)
**Date:** 2026-09-30
**Nature:** Independent adversarial verification only. No remediation performed. No production, staging, release-readiness, or compliance claim is made anywhere in this document.

---

## 1. Review scope

Phase 36 is the third consecutive remediation phase in a lineage that began with a self-review (P34) which was itself corrected by an independent review (P35). Phase 36 claims to have:

1. reproduced and remediated **P35-1** — the `/_next/image` endpoint was live and unauthenticated in the production container;
2. reproduced and closed **P34-1** — the Phase 33 dependency remediation floors were protected by nothing;
3. reproduced and strengthened **P35-2** — the untracked-artifact detection path had no passing mutant;
4. strengthened the CI parity / required-gate contract;
5. added four files (`verify-next-image-optimizer.mjs`, `mutate-next-image-optimizer.mjs`, `verify-dependency-security-floor.mjs`, `mutate-dependency-security-floor.mjs`) and `docs/PHASE_36_FINAL_REPORT.md`.

Every one of those claims was treated as an untrusted assertion and re-derived from primary sources: source code, the lockfile, the workflow, the built artifact, a running standalone production server, a real `pnpm install` on a weakened override state, a clean `git worktree` checkout, and the hosted CI run's own step list.

**Explicitly out of scope for this pass:** re-litigating whether every advisory disposition in `triage-vulnerabilities.mjs` is correct. Where I relied on an existing control's internal reasoning, I say so and mark it INSPECTED rather than VERIFIED.

---

## 2. Independence disclosure

I am an independent verification pass operating **inside this repository**, on the same machine, with the same toolchain, under the same git identity and the same hosted runner credentials as the implementation session.

**I am not organizationally independent of this work.** I cannot claim:

- separation of duties from the implementing agent;
- independence from the repository owner or the review lineage;
- an audit function distinct from the party whose work is under review;
- any independence in the sense an external auditor or a second organization would provide.

What I can claim, and what this document rests on: I did not implement Phase 36; I re-derived the material claims from primary sources rather than from `docs/PHASE_36_FINAL_REPORT.md` or any prior report; I attacked the controls adversarially; and I discarded any result that failed for a reason unrelated to the security property under test.

**This review does not and cannot discharge an organizational independence requirement.** A reader requiring that must obtain a review from a party outside this repository and this session. This document is an independent *verification pass*, which is a weaker and different thing.

---

## 3. Baseline / commit

| Property | Value |
|---|---|
| HEAD at review start | `199877aef283eff36984114ecf486eaec1554c39` |
| `origin/main` at review start | `199877aef283eff36984114ecf486eaec1554c39` |
| Divergence | none (`git status --porcelain` showed only pre-existing untracked review/report documents) |
| Tracked tree hash | `774566b4b973da5ae15590c010e2dfc8f64ecca4` |
| Branch | `main` |
| Staged files | none |

Protected-artifact checksums captured before review:

| File | MD5 |
|---|---|
| `pnpm-lock.yaml` | `ccfa78db9184754cf7f9f4ac86353659` |
| `pnpm-workspace.yaml` | `656abae051a73b60deba041dfa8f0a8c` |
| `package.json` | `322568884835c4083f2eac29801fb1b4` |
| `.github/workflows/ci.yml` | `1651c1020f72e04032efb99269681e68` |
| `apps/web/next.config.mjs` | `b5e1b263bc3b5e80a27d81f1748ee04f` |
| `apps/api/prisma/schema.prisma` | `4452c2a2cd00dc683930e164d6ec5a9c` |

All six are **unchanged** after review (§15).

---

## 4. Methodology

Principles applied, in order of priority:

1. **Runtime evidence over source assertion.** For P35-1 I rebuilt the pre-remediation state from scratch and probed a running production standalone server, rather than reading the fix's own comments.
2. **Real installs over lockfile text edits.** For P34-1 I ran an actual `pnpm install` with the overrides lowered, so the "resolved graph" the gate claims to read was produced by the package manager, not by my editing its output.
3. **Every mutant scored for intended cause.** Each mutant had to (a) actually apply, (b) fail on the *named* security check, and (c) leave the repository byte-identical. Mutations that fail for syntax errors, missing Prisma clients, wrong cwd, network failure, or unrelated build breakage were discarded and disclosed, not counted.
4. **Independent mirrors.** Because several harnesses mutate the working tree in place, and because I am not permitted to modify repository source, I ran those harnesses against throwaway mirrors under `/tmp` and cleaned them up.
5. **Positive controls.** Where a harness offers a control that must *not* fail, I confirmed that too — a control that fails everything is not a control.

**Defects in my own review harness** (disclosed, fixed, and the affected result re-derived — none counted as evidence before the fix):

| # | Defect | Handling |
|---|---|---|
| R-1 | A probe script crashed on `JSON.stringify(undefined).padEnd(...)`, truncating the analyser fail-closed matrix after one case. | Fixed; full 13-case matrix re-run and reported. |
| R-2 | A probe used `require('yaml')` from `/tmp`, which is not a resolution root for this workspace. | Re-resolved `yaml` from the pnpm store exactly as the gate does; re-run. |
| R-3 | A probe read `minimatch@x/package.json` from a non-hoisted path and failed three times. | Re-read from the virtual store (`node_modules/.pnpm/<pkg>/node_modules/<pkg>`); re-run. |
| R-4 | The first M8 container build was cancelled when my own shell call hit its 120 s tool timeout. **This was my harness killing the build, not a mutant result.** | Re-ran detached via `setsid`; M8 then completed and was scored. The cancelled run is discarded and not counted. |
| R-5 | I invoked `verify-db-migrations.sh` with `node`, producing a `SyntaxError`. | Re-invoked with `bash`; the gate then passed. The `node` error is discarded. |
| R-6 | The clean-checkout API build failed with `TS2339 … Property 'user' does not exist on type 'PrismaService'` — the documented "missing Prisma client" setup artifact, not a defect. CI runs `Generate Prisma client` first (ci.yml lines 62, 428). | Ran `prisma generate` then rebuilt; `API_BUILD_OK`. The failure is **discarded as setup noise**. |

No repository defect was fixed. No production source was modified.

---

## 5. P35-1 verification — the Next Image Optimizer

### 5.1 The original condition: REPRODUCED

I reconstructed the pre-remediation state independently rather than trusting the report. In a throwaway mirror I removed the entire `images: { … }` block from `apps/web/next.config.mjs` — reproducing the HEAD~1 configuration in which no `images` key exists — and ran a full production build.

The built artifact reported the vulnerable state:

```
.next/images-manifest.json → "loader":"default", "path":"/_next/image", "unoptimized":false
```

Starting the resulting standalone production server and requesting the endpoint unauthenticated:

```
GET /_next/image?url=%2Fverify-next-image-optimizer-probe.png&w=64&q=75  ->  200  image/png  104 bytes
```

**A live, unauthenticated, externally reachable route returning image bytes, from an application that renders no images.** P35-1 is real and its severity assessment (critical unauthenticated RCE path, advisory 1193733, gated in practice only by `sharp` being absent from the traced tree) is consistent with what Next.js 14 actually does.

I also confirmed the mechanism in the installed Next source rather than by assertion — `next/dist/server/next-server.js:167`:

```js
const imagesConfig = this.nextConfig.images;
if (imagesConfig.loader !== "default" || imagesConfig.unoptimized) {
    await this.render404(req, res);
    return true;
}
```

So `unoptimized: true` is genuinely a supported way to make the branch unreachable, and `/_next/image` is registered unconditionally — which is exactly why the old "no `next/image` import" inference was invalid.

### 5.2 The remediation: VERIFIED at runtime

On HEAD, with a fresh production build, `node scripts/verify-next-image-optimizer.mjs` exits 0 with all four probe classes answered:

| Probe | HEAD result | Required |
|---|---|---|
| `/_next/image?url=/<valid local png>&w=64&q=75` | **404** `text/html` | not a 200 image |
| `/_next/image?url=https://example.com/x.png&w=64&q=75` | **404** | not 200 |
| `/_next/image` (bare) | **404** | not a 200 image |
| `/` and `/health` | **200**, **200** | app not broken |

All three `/_next/image` variants return 404 and legitimate routes still serve — so the endpoint was closed without breaking the application, which is what separates a remediation from an outage.

I confirmed the three-layer structure is not merely three copies of the same assertion:
- **Layer 1** reads `images.unoptimized` from the AST of the config the production build consumes (`apps/web/next.config.mjs:49:5`).
- **Layer 2** reads Next's own resolved output, `.next/images-manifest.json`, which reports `unoptimized=true`.
- **Layer 3** probes the running standalone server built from that tree.

A stale build, a config edit without a rebuild, or a config that never reaches the build all fail Layer 2 or Layer 3 even when Layer 1 passes. This is genuine defence in depth, and I demonstrated the independence directly: hand-editing only the *built manifest* to disagree with a correct config (mutant M3) fails on Layer 2 while Layer 1 still passes.

### 5.3 Does the triage logic test the configuration that matters? YES

The rewritten triage rule (`scripts/triage-vulnerabilities.mjs:302-400`) no longer infers from application usage. It reads the *value* of `images.unoptimized` and the *value* of `images.loader`, and fails closed in this order: unreadable value → REACHABLE; explicit falsy → REACHABLE; non-default loader → REACHABLE; only a literal `true` on an analysable config reaches NOT REACHABLE. It also correctly warns in that last branch if the source *does* import `next/image`.

I verified the underlying analyser independently against 13 config shapes rather than reading its intent:

| Config shape | `readNextConfigValue` | Gate Layer 1 |
|---|---|---|
| `images: { unoptimized: true }` | known=true, value=true | satisfied |
| `!!true` | known=true, value=true | satisfied |
| identifier alias (`const c={…}; export default c`) | known=true, value=true | satisfied |
| **top-level spread** (`export default {...b}`) | known=false | **fails closed** |
| **spread inside `images`** | known=false | **fails closed** |
| **computed key** (`[k]: true`) | known=false | **fails closed** |
| **`Object.assign` merge** | known=false | **fails closed** |
| **phase function returning two objects** | known=false | **fails closed** |
| **value built by a call** | known=false | **fails closed** |
| **`!!process.env.X`** | known=false | **fails closed** |
| **`images` declared as a method** | known=false | **fails closed** |
| **`images` key absent entirely** | known=true, value=undefined | **fails closed** |
| **fn overriding `defaultConfig`** | known=false | **fails closed** |
| **fn mutating `defaultConfig`** | known=false | **fails closed** |

The unreadable/absent distinction is handled correctly: absent is `known:true, value:undefined` (Next's default applies) and is still rejected because the assertion requires the value to be exactly `true`. An unreadable config is never read as a safe one.

### 5.4 One fail-closed gap: plugin-derived config — FINDING R36-01

A config that declares a literal `images.unoptimized: true` **and** a `plugins` array is reported as `known=true, value=true` and satisfies Layer 1, while `analyseNextConfig` correctly reports `analysable: false` for the same input. I verified this end-to-end: with

```js
export default { images: { unoptimized: true }, plugins: [ withOptimizer ] };
```

Layer 1 reads `true` and passes, even though a plugin could rewrite the config afterwards.

**Severity is materially reduced by two facts I established:**

1. `verify-next-image-optimizer.mjs` does not rely on Layer 1 alone. Layers 2 and 3 would still catch a plugin that actually re-enabled the optimizer at build time.
2. Empirically, in Next.js **14.2.35** — the version this repository pins — the `plugins` key is **not applied to the resolved config at all**. It is absent from `config-schema.js`, absent from `config-shared.d.ts`, and the only `config.plugins` reads in the installed Next are in `setup-dev-bundler.js`, where they inspect `DefinePlugin` definitions for hot-reload. I built a tree with such a plugin: the resulting `images-manifest.json` still reported `unoptimized: true`, and the endpoint still answered 404.

So the exposure is currently theoretical for this Next version. It is still a real inconsistency between the two functions in `scripts/lib/next-config-features.mjs`: `analyseNextConfig` treats `plugins` as opaque and unanalysable, while `readNextConfigValue` does not. A future Next upgrade that restores config-plugin application, or a config authored in a shape where a later plugin applies, would make Layer 1 report a posture the deployed server does not have.

**I did not fix this.** It is a repository defect and remediation is out of scope for a review pass.

### 5.5 Is local development behaviour being mistaken for production? NO

The gate spawns the real standalone server with `NODE_ENV=production` and `output: 'standalone'`, which is the artefact the runtime image runs — not `next dev`. The dev-bundler plugin path identified above is dev-only and cannot be what Layer 3 measures. My own reproduction (§5.1) likewise used a production build, and produced 200 image bytes, so the gate's runtime probe genuinely discriminates.

### 5.6 Mutation harness: independently run, every mutant audited

`node scripts/mutate-next-image-optimizer.mjs` — **PASS**, 1 control + 8 mutants, 9 mirrors, all removed, post-condition byte-identical.

| Mutant | Expected | Observed | Attributable to the intended condition? |
|---|---|---|---|
| CONTROL | green | green | n/a — establishes that red is attributable |
| M1 vulnerable config restored (`images` removed) | fail | **DETECTED**, `images.unoptimized is exactly true` | yes |
| M2 runtime probe fixture broken | fail | **DETECTED**, `the probe image is staged…` | yes — guards the historical missing-fixture defect |
| M3 built manifest hand-edited to disagree | fail | **DETECTED**, `the BUILT manifest reports unoptimized: true` | yes — proves Layer 2 is independent evidence |
| M4 `unoptimized: false` | fail | **DETECTED**, `exactly true` | yes |
| M5 value made dynamic | fail | **DETECTED**, `is a readable literal` + `exactly true` | yes |
| M6 config faked by a comment | fail | **DETECTED**, `exactly true` | yes |
| M7 runtime probe disabled, config+build correct | **tolerated** | tolerated (exit 0) | **correctly disclosed**, not counted as a detection |
| M8 analyser regressed to a text match | fail | **DETECTED**, `a COMMENT claiming…` | yes — M6 only has meaning while the analyser reads the AST |

Positive control present and honoured: the unmutated CONTROL is green before any mutant, so no "detected" verdict here is vacuous. M7 is honestly labelled an accepted weakening rather than dressed up as a pass; I record it as such (see R36-02).

**Every mutation harness also asserts its post-condition** (real config, gate, analyser, and built manifest byte-identical), and all reported `ok`. I re-verified independently via the repo tree hash (§15).

### 5.7 What this does NOT prove

- Anything about a deployment outside this repository.
- Advisory 1193733's transform path itself. The AVIF path is unreachable *because* `sharp` is absent from the traced standalone tree — a property of the dependency graph, not of this gate. That remains an incidental, non-control property, exactly as the report itself states. A future change pulling `sharp` into the web image would not be caught by this gate.
- That `unoptimized: true` remains the correct long-term posture. It is a mitigation chosen because the app renders no images; if the app ever renders images, `<Image>` would silently render unoptimized originals. That is a product/performance consideration, not a security regression, and I record it as INFO.

---

## 6. P34-1 verification — the dependency security floor

### 6.1 The exact weakness: REPRODUCED independently

I did not rely on the harness's lockfile edits. I built a full mirror, lowered the `pnpm-workspace.yaml` overrides to the **high-severity floors only**, and ran a real `pnpm install`:

```yaml
'brace-expansion@>=1.0.0 <1.1.20': 1.1.20
'brace-expansion@>=2.0.0 <2.1.6': 2.1.6
'undici@<6.28.1': 6.28.1
```

The package manager resolved `brace-expansion@1.1.20` and `brace-expansion@2.1.6` — the genuine weakened graph, produced by pnpm rather than by my hand.

`pnpm audit --json` on both graphs:

| | info | low | **moderate** | high | critical |
|---|---|---|---|---|---|
| HEAD overrides | 0 | 8 | **36** | 44 | 4 |
| Weakened overrides | 0 | 8 | **38** | 44 | 4 |

Advisories **1240100** (`brace-expansion`, moderate, patched `>=1.1.21`) and **1240101** (`brace-expansion`, moderate, patched `>=2.1.7`) are **absent** at HEAD and **present** in the weakened graph. Critical and high counts are unchanged, which is precisely why every pre-existing gate misses it.

### 6.2 Pre-existing gates pass; the new gate fails

Run against the **same** weakened graph:

| Gate | Exit | Assessment |
|---|---|---|
| `verify-dependency-audit.mjs` | **0** | passes on the weakened graph |
| `triage-vulnerabilities.mjs` | **0** | "No critical or high advisory is reachable" |
| `verify-dependency-triage.mjs` | **0** | passes |
| `verify-config-contract.mjs` | **0** | passes |
| `verify-ci-parity.mjs --list` | **0** | passes |
| `verify-next-config-features.mjs` | **0** | passes |
| **`verify-dependency-security-floor.mjs`** | **1** | **2 BREACH verdicts**, names `brace-expansion@1.1.20` below `1.1.21` and `brace-expansion@2.1.6` below `2.1.7` |

**P34-1 is confirmed exactly as characterised, and it is now closed.** The first audit run exited 1 on `the Prisma query engine did not load` — the documented Phase 34 setup artifact. I discarded it, ran `prisma generate` in the mirror, and re-ran: exit 0. The security-floor failure is therefore attributable to the floor requirement, not to install/build noise.

Root cause confirmed in the code: `scripts/triage-vulnerabilities.mjs:846` still reads

```js
.filter((a) => a.severity === 'critical' || a.severity === 'high')
```

so both moderate advisories are filtered out before any disposition is decided. The new gate does not touch that line and does not need to — it adds an independent check rather than narrowing or reinterpreting triage.

### 6.3 Does it inspect the resolved graph, not package.json text? YES

The gate parses `pnpm-lock.yaml` with the `yaml` package already in the dependency graph and walks `snapshots:`, where pnpm records resolved dependencies. I confirmed by direct enumeration that it sees `brace-expansion: ['1.1.20','2.1.6']` and `undici: ['6.28.1']`. It also records the count of declared overrides for context while explicitly *not* relying on them.

The drift case is the sharp test, and the harness covers it as D5: override declaration correct, lockfile still resolving the vulnerable version → detected. I confirmed the underlying design choice is correct by reasoning: a frozen-lockfile CI install consumes the lockfile, so the lockfile is the authoritative statement of what will be installed.

### 6.4 Branch independence and undici: VERIFIED

The two `brace-expansion` lines are governed by separate `majors` lists and separate floors, and each is measured independently — D1 (1.x → 1.1.20) and D2 (2.x → 2.1.6) each produced exactly one BREACH naming the correct line. `undici` is detected independently by D3.

### 6.5 Bypass resistance

| Vector | Result | Evidence |
|---|---|---|
| Workspace overrides changed | **Detected** | D1/D2/D3 + my real install; the gate reads the graph, not the declaration |
| Nested dependencies | **Detected** | all three floored packages are transitive-only; I confirmed there is **no direct `brace-expansion` dependency in any importer manifest**, so the resolved graph is the only place they appear |
| Duplicated versions | **Detected** | enumeration is per-instance; multiple instances below a floor each produce a BREACH |
| Lockfile-only manipulation | **Detected** | D6 — editing only the lockfile is exactly the case |
| Symlinked packages | **Not a bypass** | the gate reads the lockfile graph, which is symlink-independent by construction; pnpm's virtual store is a symlink farm and the gate is unaffected |
| Package-manager output changes | **Not a bypass** | input is the lockfile YAML, not CLI text; the audit's human-readable output is irrelevant to it |
| Unrelated package additions | **Correctly tolerated** | D9 forbids both BREACH and REVIEW for an added package — the false-positive guard |

**D4 is the most informative result.** Deleting the `brace-expansion` 1.x override from `pnpm-workspace.yaml` while leaving the lockfile resolving 1.1.21 correctly yields **OK** — because the resolved graph is what a frozen-lockfile install produces. That is the right answer, and it is what distinguishes this gate from a naive declaration-text check.

### 6.6 Parent semver compatibility: VERIFIED

Read from the installed packages, not from comments:

| Parent | Declared range | Resolved | Compatible? |
|---|---|---|---|
| `minimatch@3.1.5` | `^1.1.7` | `1.1.21` (HEAD) / `1.1.20` | yes, patch |
| `minimatch@9.0.9` | `^2.0.2` | `2.1.7` (HEAD) / `2.1.6` | yes, patch |
| `@remix-run/node@2.17.5` | `^6.21.2` | `6.28.1` | yes, minor within `^6` |

All three are in-range for their parents, so the floors force no parent outside its declared range.

### 6.7 Can the floor be weakened by changing the gate's own configuration? NOT PROTECTED — FINDING R36-03

The harness's own D11 mutant empties `FLOORS` and expects the gate to **pass**. It does. I confirmed this independently: with `const FLOORS = [];`, the gate exits 0, having asserted nothing.

The harness is candid that this mutant "proves the harness can see the difference rather than proving the gate would catch it" — and `verify-ci-parity.mjs` has a non-vacuous count/id guard for *its own* `REQUIRED_GATES`, but the floor gate has **no equivalent self-protection**. A maintainer (or a compromised change) that empties or lowers `FLOORS` in `verify-dependency-security-floor.mjs` obtains a green build, and only review would notice.

This matters more than a typical missing-guard finding, because the control's entire purpose is to make a silent lowering of remediation impossible — and its own configuration is the one place that lowering can still happen without a failing check. I record it as **MEDIUM** and do not fix it.

### 6.8 Mutation harness: independently run

`node scripts/mutate-dependency-security-floor.mjs` — **PASS**, 1 control + 12 mutants, 13 mirrors removed, post-condition byte-identical for gate, lockfile and overrides.

| Mutant | Expected | Observed | Cause correct? |
|---|---|---|---|
| CONTROL | green | green | yes |
| D1 brace-expansion 1.x → 1.1.20 | fail | **DETECTED**, BREACH naming 1.1.20/1.1.21 | yes |
| D2 brace-expansion 2.x → 2.1.6 | fail | **DETECTED**, BREACH naming 2.1.6/2.1.7 | yes |
| D3 undici → 6.28.0 | fail | **DETECTED**, BREACH naming 6.28.0/6.28.1 | yes |
| D4 override declaration deleted, lockfile intact | pass | correctly OK | yes — the right answer for a resolved-graph control |
| D5 declaration correct, lockfile stale | fail | **DETECTED** | yes |
| D6 lockfile-only edit | fail | **DETECTED** | yes |
| **D7 upgrade 1.1.21 → 1.1.22** | pass | correctly OK | **positive control** — a floor, not a pin |
| **D8 undici genuinely removed** | pass | correctly OK, **REMOVED** verdict | **positive control** — removal is not failure nor silent pass |
| **D9 unrelated package added** | pass | correctly OK, no BREACH/REVIEW | **positive control** — false-positive guard |
| **D10 brace-expansion 3.0.0 added** | review | **REVIEW**, exit 0 | **positive control** — a third state exists; new majors force a human decision |
| D11 FLOORS emptied | pass | correctly OK | **this is the gap — see R36-03** |
| D12 floor raised to 1.1.99 | fail | **DETECTED**, BREACH naming 1.1.99 | yes — catches accidental pinning |

Five positive controls (D7–D10 plus D4) is a strong design: the harness demonstrates the control does not punish legitimate movement, which is what keeps it usable.

---

## 7. P35-2 verification — untracked-artifact attribution

### 7.1 The claimed gap was real, and is now closed

The Phase 35 finding was that `untrackedTargetProblem()` opens with `if (!existsSync(path.join(repoRoot, '.git'))) return null;`, and every pre-Phase-36 mirror was a bare temp directory with no `.git` — so the assertion was **skipped for all 21 existing mutants**. It was implemented, read, and never exercised by anything that could fail.

I confirmed the harness now builds real git work-tree mirrors (`gitInitMirror` + `gitUntrack`) and added a **2×2 with its own scoring**:

| Mutant | Tree state | Assertion | Expected | Observed |
|---|---|---|---|---|
| C22 | untracked | live | fail | **DETECTED** — `…is NOT tracked by git` |
| C23 | untracked | disabled (`return null`) | pass | correctly OK |
| C24 | all tracked | live | pass | correctly OK |

This is a well-constructed pair. **C22 alone would have been weak evidence** — the contract has many reasons to report a problem, so "exit 1" would not prove the *untracked* assertion fired. **C23 removes that ambiguity**: with the assertion neutralised and the tree otherwise identical, the contract goes green. C22 and C23 agreeing is what makes the attribution credible. C24 guards against the over-correction where the assertion always fires.

### 7.2 Independent attribution, not just harness agreement

I did not rely on the harness. I built my own git work-tree mirror, committed everything (control: **exit 0**), then removed one gate script from the index while leaving it on disk. Detection fired for the untracked reason:

```
step "Storage backup — STORAGE_DIR archive, destroy, restore, re-verify (Phase 28 WS2)"
  (job `release`) depends on a file that is not committed:
  `scripts/verify-storage-backup-restore.mjs` is required by this step but is NOT tracked by git.
```

I then repeated this for **each of the four Phase 36 gates individually** — all four detected:

| Untracked file | Exit | Reason |
|---|---|---|
| `scripts/verify-next-image-optimizer.mjs` | 1 | Phase 35 gate in the `web` job is not committed |
| `scripts/mutate-next-image-optimizer.mjs` | 1 | Phase 36 mutation harness not committed |
| `scripts/verify-dependency-security-floor.mjs` | 1 | Phase 36 gate in the `api` job not committed |
| `scripts/mutate-dependency-security-floor.mjs` | 1 | Phase 36 mutation harness not committed |

The Phase 36 additions are therefore covered by the P35-2 control **individually**, not merely as a group.

### 7.3 Helper-code audit

I inspected the resolution helpers rather than trusting their names:

- **`filterScriptOf`** — matches `pnpm [--run] --filter <pkg> <script>`; deliberately excludes `exec`/`install`/`dlx`, which resolve binaries rather than declared scripts. Correct.
- **`pkgNameToDir`** — an explicit name→directory map for `@ecc/api|mobile|web`, `packages/config|ui`. An unknown filter returns `null` rather than inventing a verdict. Correct, and conservative.
- **`stepSegments`** — models per-segment `cwd`, seeding from the `--filter` package directory so `pnpm --filter @ecc/api exec node ../../scripts/x.mjs` resolves to `scripts/x.mjs` rather than a path above the repository. This is the Phase 32 fix, and it is present.
- **`executedFileTargets`** — takes only the interpreter's **first non-flag operand** for `node`/`bash`/`sh`, and excludes `dist/ build/ out/ coverage/ .next/ node_modules/` as job-produced output. Deliberately narrow, which is what avoids spurious failures.
- **`isRepoFilePath` / `isGlobToken`** — require a separator *and* an extension on the last segment, and reject `*?[]{}`. A bare name, flag, port, or glob cannot be mistaken for a file.
- **`fileTokensOfScript`** — resolves a package script to the files it actually executes and checks each exists, closing the C17 gap (a renamed script with a matching package-script edit).

**This is not raw YAML grepping.** The workflow is parsed with a real YAML parser; matching is on whitespace-delimited **tokens** of the parsed `run:` command with **shell comments stripped first**, so `# node scripts/x.mjs` cannot satisfy a gate, and `verify:metadata` is not satisfied by `verify:metadata:mutate`.

### 7.4 cwd and environment independence: VERIFIED empirically

| Test | Result |
|---|---|
| `verify-ci-parity.mjs --list` run from `/tmp` | exit 0 |
| run from `/` | exit 0 |
| same line count as from the repo root | identical output |
| `env -i` (completely empty environment) | exit 0 |
| `PATH=/nonexistent HOME=/nonexistent` | **byte-identical output** to a normal run |
| `verify-dependency-security-floor.mjs` under `env -i` | exit 0 |

The harness also spawns its child with `env: { CI, FORCE_COLOR }` only — `PATH` and `HOME` deliberately withheld — which is the correct fix for the Phase 32 failure where forwarding them made the config-contract gate correctly report two undocumented environment reads.

### 7.5 Coordinated renames: no false failure

C21 renames `verify-storage-backup-restore.mjs` → `verify-storage-backup-restore-v2.mjs` **and** updates the package script to match: correctly **NOT detected**. A legitimate coordinated refactor is not punished, which is what keeps the contract credible.

### 7.6 No mutant passes by crashing

The harness rejects mutants that leave `verify-ci-parity.mjs` **unparseable** before scoring, and separately records `.git` index changes as a change signal (a mutant that only changes git state produces no content diff and would otherwise be scored a no-op). This directly addresses the historical defect where five mutants scored "DETECTED" because a brace-offset bug had deleted unrelated code and produced a `SyntaxError`. I saw no such case in this run.

### 7.7 Full harness result

`node scripts/mutate-ci-integration.mjs` — **PASS**, 1 control + 24 mutants (22 requiring detection, 2 positive controls plus C24), 25 mirrors removed, post-condition byte-identical for all six real files. All 22 detection mutants fired with the specific intended message, not merely a non-zero exit.

---

## 8. CI / parity verification

### 8.1 The hosted run: VERIFIED, not assumed

I queried the run directly rather than reading the report.

| Property | Value |
|---|---|
| Run ID | `36714434566` |
| `headSha` | `199877aef283eff36984114ecf486eaec1554c39` — **matches HEAD exactly** |
| `conclusion` | `success` |
| Jobs | **5 / 5 success** |
| Total steps | **97** |
| Skipped steps | **0** |

Implementation run `36713311446` also `success`, on `e77fb2e`. No divergence between the two.

**No hidden failure masked by later success:** GitHub Actions does not permit a later-success step after a failed step in the same job without an `if: always()` override, and the contract in `verify-ci-parity.mjs` rejects `continue-on-error`, `set +e`, `|| true`, `|| :`, `|| echo`, `&& exit 0` on required gates. Every step in the run reports `conclusion: success`.

All six Phase 36 steps executed, and I read them individually from the run — not from `ci.yml`:

| Step | Job | Conclusion |
|---|---|---|
| Web runtime — the Image Optimization endpoint is unreachable (P35-1) | web | success |
| Supply chain — the dependency security floor is enforced (P34-1) | api | success |
| Mutation — the image-optimizer gate detects the P35-1 state | release | success |
| Mutation — the dependency floor detects a lowered remediation | release | success |
| CI contract — the workflow satisfies the parity contract | release | success |
| Mutation — removing a required Phase 28 gate from CI is detected | release | success |

### 8.2 The Phase 36 gates are genuinely integrated

All four new gates are present in `ci.yml` as **parsed `run:` commands**, not as filename strings in comments, and each is a REQUIRED_GATES entry with a backing artefact:

| Gate id | Command in ci.yml | Artefact resolved |
|---|---|---|
| `p36-image-optimizer` | `node scripts/verify-next-image-optimizer.mjs` | `scripts/verify-next-image-optimizer.mjs` |
| `p36-image-optimizer-mutate` | `node scripts/mutate-next-image-optimizer.mjs` | `scripts/mutate-next-image-optimizer.mjs` |
| `p36-dependency-floor` | `node scripts/verify-dependency-security-floor.mjs` | `scripts/verify-dependency-security-floor.mjs` |
| `p36-dependency-floor-mutate` | `node scripts/mutate-dependency-security-floor.mjs` | `scripts/mutate-dependency-security-floor.mjs` |

### 8.3 Suppression and narrowing vectors — all detected

I applied each to the **image-optimizer gate** independently (each mutation reverted between tests):

| Vector | Exit | Contract message |
|---|---|---|
| `\|\| true` appended | **1** | "ends with `\|\| true`" **and** "contains `\|\| true` … A required gate that cannot fail is not a gate" |
| `set +e` in the step | **1** | "uses `set +e`, so a failing command does not fail the step" (both workflow-level and per-gate) |
| narrowed to `--config-only` | **1** | "invoked by a NON-EQUIVALENT command. Expected exactly `node scripts/verify-next-image-optimizer.mjs` … Options, filters or flags added to a required gate can narrow it to a fraction of its coverage" |
| `continue-on-error: true` | **1** | counted as advisory (3 vs 2), and the required-gate loop requires at least one non-advisory invoking step |

The `--config-only` rejection is the sharpest of these: that flag skips the runtime probe that is the entire point of the gate, and the contract refuses a step that looks wired in but checks less.

### 8.4 Vacuous-threshold protection — partial, FINDING R36-02

The Phase 36 work correctly replaced a self-referential guard (`REQUIRED_GATES.length < REQUIRED_GATE_COUNT` where `EXPECTED_GATE_COUNT = REQUIRED_GATES.length`, which can never be true) with a genuine `REQUIRED_GATE_IDS` list, and added explicit per-id assertions.

I tested the residual hole: I removed `p36-dependency-floor-mutate` from **both** `REQUIRED_GATES` and `REQUIRED_GATE_IDS` — a coordinated edit that lowers the count and the id list together. **`verify-ci-parity.mjs --list` exited 0.** The gate is still wired in `ci.yml` and would still execute, so nothing is actually unprotected today; but the contract no longer *requires* it, and a future coordinated deletion of both lists would pass silently.

The comment in the source anticipates exactly this: "deleting an entry and lowering the threshold together would pass a count-only check, and would not pass this one." That reasoning holds against a count-only edit, but not against editing both lists in the same file. There is no immutable second source of truth. **MEDIUM**, not fixed by me.

### 8.5 Dead/unreachable steps and identity validation

- A required gate invoked by **zero** steps → reported.
- A required gate invoked **only** by advisory steps → reported separately ("cannot fail the build").
- `exactCommand` is asserted on the **whole normalised command**, not a substring, so `--only`/`--list`-style narrowing cannot pass.
- Comments are stripped before token matching (shell `#` comments inside `run:` blocks, not just YAML comments).
- Matching is token-exact, so `verify:metadata` is not satisfied by `verify:metadata:mutate`.

---

## 9. Existing-control regression verification

Phase 36 changed no application source, no Prisma schema or migrations, and no lockfile (verified by checksum in §15). Nonetheless I re-executed the prior controls rather than assuming preservation.

### 9.1 Tested (executed in this pass)

| Control | Command | Result |
|---|---|---|
| N-12 rate limiting | `mutate-rate-limit-n12.mjs` | **PASS** — 7 mutants + negative control |
| N-12 dependency floor (containers) | `mutate-container-gate.mjs --only M8,M9,M10,M11` | **PASS** — see §10 |
| Config contract | `verify-config-contract.mjs` | exit 0 |
| Env contract | `verify-env-contract.mjs` | exit 0 |
| Dependency audit | `verify-dependency-audit.mjs` | exit 0 |
| Dependency triage (F-5 fails closed) | `verify-dependency-triage.mjs` | exit 0 |
| Next config AST (F-4) | `verify-next-config-features.mjs` | exit 0 |
| Rewrites rule (F-4 mutation) | `mutate-next-config-rewrites.mjs` | exit 0 |
| Metadata (Phase 23 W1) | `pnpm verify:metadata` | exit 0 |
| Metadata mutation | `pnpm verify:metadata:mutate` | exit 0 |
| Route authorization (W3) | `pnpm verify:routes` | exit 0 |
| Route mutation | `pnpm verify:routes:mutate` | exit 0 |
| CI integration (Phase 29 F-2) | `mutate-ci-integration.mjs` | PASS, 24 mutants |
| Release artifact (W10) | `verify-release-artifact.mjs --skip-web` | PASS — 280 files byte-identical across two clean builds |
| DB migration safety (W9) | `verify-db-migrations.sh` | PASS — 36 checks, throwaway container only |
| DB-backed suites | `run-db-suites.mjs` | PASS — 138 (integration) + 348 (unit+integration) |
| Mobile tests | `pnpm --filter @ecc/mobile test` | PASS — 34 tests |
| Web tests | `pnpm --filter @ecc/web test` | PASS — 1 test |

**486 DB-backed tests (138 + 348), 34 mobile, 1 web — all passed, 0 skipped.** This matches the Phase 36 claim, re-derived rather than copied.

### 9.2 N-12 specifics: independently confirmed

Every N-12 mutant failed on the *named* assertion, not incidentally:

| Property | Mutant | Failure observed |
|---|---|---|
| 429 not 403 | M-N12-1 | `expected 403 to be 429` (guard spec + e2e) |
| refusal not bypassed | M-N12-1 (2nd form) | `expected 201 to be 429` |
| `Retry-After` present | M-N12-3 | "a 429 must carry Retry-After (THREAT_MODEL.md §8)" |
| `Retry-After` real, not constant | M-N12-4 | `expected 60 to be 900` |
| `RATE_LIMITED` envelope | M-N12-5 | `expected 'ERROR' to be 'RATE_LIMITED'` |
| 403 not widened to 429 | M-N12-6 | `expected 429 to be 403` |
| mobile retains session on 429 | M-N12-7 | `expected undefined to be 'token_429_valid'` |

M-N12-7 is a genuine negative control: it proves the mobile client does **not** destroy a valid session on a 429. Together these cover 429 status, `RATE_LIMITED` classification, `Retry-After` semantics, genuine 403, no over-correction into 429, and mobile session retention on 429.

**Session clearing on genuine authentication/revocation 401/403 — INSPECTED, not separately re-tested in this pass.** The container-gate M8/M11 mutants assert 403 semantics and M7 asserts token-lifetime bounding, and the e2e suite asserts the 403 negative control, which is the same code path. I did not construct a fresh 401-revocation mutation of my own; I mark this honestly rather than claim more.

### 9.3 Phase 25 F-1 – F-5

F-4 (AST-based Next feature detection) and F-5 (triage classifier fails closed) were both **tested** above. F-1 – F-3 I **inspected** only: their harnesses (`mutate-config-contract.mjs`, and the W1/W3 mutation gates) are exercised in CI run 36714434566 and I re-ran the W1/W3 pairs directly, but I did not re-derive each of F-1 – F-3's original defect class independently.

### 9.4 No weakening found

I found no evidence that Phase 36 relaxed any prior control. The diff between `e77fb2e` and `199877a` touches only the final report; the remediation commit added four scripts, one workflow gate block per concern, and the contract entries — no suppression, no severity change, no audit ignore, no `continue-on-error` on a gate, and no removal of any existing REQUIRED_GATES entry.

---

## 10. M8–M11 container mutations — NOT TESTED (Phase 36) → VERIFIED DETECTED (this pass)

### 10.1 Phase 36's report

Phase 36 recorded M8–M11 as unverified because image builds timed out. I do **not** accept that as a pass, and I do not classify it as a failure.

### 10.2 The environment now permits it — executed

Docker 29.8.1 responding, ~41 GB free, `node:24-alpine` present, and the `ecc-api:p20-verify` base image already built. I ran the four mutants.

Because `mutate-container-gate.mjs` **mutates the working tree in place** (`apps/api/src/...`), and because I am not permitted to modify repository source, I ran it against a **throwaway mirror** under `/tmp`. This is the same technique the other harnesses use, applied here because of my own constraint.

Each mutant required a full `--no-cache` API image rebuild (~4 min each).

| Mutant | Result | Failure attributed to |
|---|---|---|
| **M8** rate-limit refusal reverts 429 → 403 | **DETECTED** | `the rate limiter is enforced in the image` |
| **M9** rate-limit refusal bypassed entirely | **DETECTED** | `the rate limiter is enforced in the image` |
| **M10** `Retry-After` contract dropped | **DETECTED** | `the rate limiter is enforced in the image` |
| **M11** authorization refusals widened to 429 | **DETECTED** | `authorization refusals in the image are 403, not 429` |
| post-condition | **PASS** | "the gate passes again on the restored repository" |

M11's expected string is *different* from M8–M10's, which is the discriminating evidence: the gate distinguishes the over-correction (403 widened to 429) from the under-correction (429 reverted to 403) rather than firing on either.

**Control restored after each mutation**, verified independently by diffing the three mutated source files in the mirror against the repository: `rate-limit-exceeded.exception.ts`, `rate-limit.guard.ts`, and `global-exception.filter.ts` are all **identical** to HEAD.

**All throwaway infrastructure removed:** four `ecc-api:p24-mutant-*` images deleted; the container mirror, all git worktrees, and every temp probe directory removed; no throwaway PostgreSQL container or database left running (`docker ps -a` shows no `p28`/`artifact`/`migrat` containers).

**M8–M11 are therefore VERIFIED DETECTED, not "not tested".** They are the one Phase 36 limitation this pass closed. Note that M8–M11 are N-12 container-gate mutants, i.e. Phase 28 controls — so their status was never a Phase 36 defect, only a Phase 36 reporting gap.

`ecc-web:p36-verify` was left in place: I confirmed it was created at 15:01 IST, before this review began (~17:53), so it is not my artifact.

---

## 11. Clean-checkout / reproducibility results

A fresh `git worktree` at HEAD, then every Phase 36 gate and the builds, from that checkout:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | **PASS** — "Lockfile is up to date, resolution step is skipped", 4.2 s |
| `verify-dependency-security-floor.mjs` | exit 0 — 3 instances, all at or above floor |
| `mutate-dependency-security-floor.mjs` | exit 0 |
| `verify-ci-parity.mjs --list` | exit 0 |
| `pnpm --filter @ecc/web build` | PASS |
| `verify-next-image-optimizer.mjs` | **PASS** — `/_next/image` → 404, `/` and `/health` → 200 |
| `mutate-next-image-optimizer.mjs` | **PASS** — 8 mutants |
| `pnpm --filter @ecc/api build` | **PASS** after `prisma generate` (see R-6) |
| `verify-db-migrations.sh` | PASS — 36 checks |

**The frozen-lockfile install resolves the same graph**, which is the reproducibility claim that matters for P34-1: a clean checkout cannot silently obtain a different dependency set. The worktree has been removed.

---

## 12. Mutation results table

Every mutation run in this pass, with counts.

| Harness | Control | Mutants | Required detection | Detected | Correctly tolerated | Positive controls | Result |
|---|---|---|---|---|---|---|---|
| `mutate-next-image-optimizer.mjs` | green | 8 | 7 | 7 | 1 (M7, disclosed) | 1 (CONTROL) | **PASS** |
| `mutate-dependency-security-floor.mjs` | green | 12 | 6 | 6 | 5 (D4, D7, D8, D9) + D10 REVIEW | 4 | **PASS** |
| `mutate-ci-integration.mjs` | green | 24 | 22 | 22 | 3 (C21, C23, C24) | 3 | **PASS** |
| `mutate-rate-limit-n12.mjs` | green | 7 | 7 | 7 | — | 1 (M-N12-7) | **PASS** |
| `mutate-container-gate.mjs --only M8,M9,M10,M11` | green (post-condition) | 4 | 4 | 4 | — | 1 | **PASS** |
| Reviewer-authored probes (§5.3, §7.2, §8.3, §8.4) | green | 22 | 22 | 22 | — | 2 | **PASS** |

**Totals: 77 mutations applied, 67 required detection and all 67 detected for the intended reason; 10 correctly tolerated or reported; every harness's post-condition verified; 79 throwaway mirrors/images removed.**

**Discarded results** (not counted as evidence): R-1 through R-6 in §4 — six reviewer-harness defects, each disclosed, each fixed or worked around, each affected test re-run.

---

## 13. Findings

### R36-01 — MEDIUM — `plugins` in the Next config is opaque to `analyseNextConfig` but transparent to `readNextConfigValue`

- **Component:** `scripts/lib/next-config-features.mjs` (`readNextConfigValue`), consumed by `scripts/verify-next-image-optimizer.mjs` Layer 1 and by the `image optimization` rule in `scripts/triage-vulnerabilities.mjs`
- **Condition:** a config declaring both `images: { unoptimized: true }` and a `plugins: [...]` array. `analyseNextConfig` returns `analysable: false` (it treats `plugins` as `OPAQUE_KEYS`), but `readNextConfigValue` returns `{ known: true, value: true }`.
- **Evidence:** my 13-case analyser matrix — `plugins + literal true` → `known=true value=true`, while the same input yields `analysable=false`. End-to-end, Layer 1 passes on such a config.
- **Consequence:** Layer 1 alone can report a posture the effective config does not have. **Mitigated in practice:** the gate's Layers 2 and 3 are independent (built manifest + running server), and in Next 14.2.35 the `plugins` key is not applied to the resolved config at all — I built such a tree and `images-manifest.json` still reported `unoptimized: true`, with `/_next/image` still 404. The exposure becomes real on a Next version that applies config plugins.
- **Reproducibility:** deterministic; the matrix case `plugins + literal true` reproduces it.
- **New or inherited:** new in Phase 36 (`readNextConfigValue` was added by this phase).
- **Fixed during review:** **NO** — remediation is out of scope.

### R36-02 — MEDIUM — a coordinated edit of both required-gate lists passes the parity contract

- **Component:** `scripts/verify-ci-parity.mjs` — `REQUIRED_GATES` and `REQUIRED_GATE_IDS`
- **Condition:** removing a gate entry from **both** lists in the same edit. The Phase 36 guard correctly defeats a count-only edit, but both lists live in the same file.
- **Evidence:** I removed `p36-dependency-floor-mutate` from both lists; `verify-ci-parity.mjs --list` **exited 0**. The gate remains wired in `ci.yml` and still executes, so nothing is unprotected at HEAD; the contract simply no longer *requires* it.
- **Consequence:** a future coordinated deletion would pass CI parity green while the gate's protection quietly lapses. No external immutable statement of the required set exists.
- **Reproducibility:** deterministic.
- **New or inherited:** the residual hole is inherited from the Phase 29/32 design; Phase 36 improved it (self-referential count → id list) but did not close it.
- **Fixed during review:** **NO**.

### R36-03 — MEDIUM — the dependency-floor gate's own `FLOORS` configuration is unprotected

- **Component:** `scripts/verify-dependency-security-floor.mjs`, `const FLOORS`
- **Condition:** emptying or lowering `FLOORS`. The gate then asserts nothing and exits 0. Harness mutant D11 expects exactly this and records it as `pass`.
- **Evidence:** confirmed independently — with `const FLOORS = [];` the gate exits 0.
- **Consequence:** the control exists to make a silent lowering of security remediation impossible, yet its own configuration is the one place such a lowering still yields a green build without any check failing. `verify-ci-parity.mjs` has an equivalent non-vacuous guard for its own list; this gate has none.
- **Reproducibility:** deterministic.
- **New or inherited:** new in Phase 36.
- **Fixed during review:** **NO**.

### R36-04 — MEDIUM — review documents for Phases 25–35 are untracked, so they are absent from the repository history

- **Component:** repository hygiene — `SECURITY_REVIEW_PHASE_25.md`, `_26`, `_28`, `_30`, `_31`, `_34`, `_35`, and `docs/PHASE_27/28/30/32/33_FINAL_REPORT.md`, `docs/RELEASE_READINESS.md`
- **Condition:** `git ls-files` reports all of these as untracked; they exist only in the local working tree. Every security-review document for Phase 24 and earlier **is** tracked, so this is a regression in the pattern, not a repository-wide convention.
- **Evidence:** `git status --porcelain` lists 16 untracked documents, none of them tracked in HEAD.
- **Consequence:** the audit trail for Phases 25–35 exists nowhere a clean checkout, a reviewer without filesystem access, or an auditor can see. This is precisely the failure mode P35-2 exists to prevent for *gates* — applied to the evidence of review itself. It also means the Phase 35 review that motivated Phase 36 cannot be independently consulted by anyone but its author.
- **Reproducibility:** deterministic.
- **New or inherited:** inherited from earlier phases; Phase 36 added `docs/PHASE_36_FINAL_REPORT.md`, which **is** tracked, so the regression is not ongoing.
- **Fixed during review:** **NO** — committing files is outside this review's authority.

### R36-05 — LOW — `sharp` absence remains the only thing preventing the AVIF RCE path

- **Component:** web runtime dependency graph / `apps/web` standalone tree
- **Condition:** `images.unoptimized: true` makes the optimizer *branch* unreachable, which is the real fix. However, the *transform* itself remains unreached only because `sharp` is absent from the traced tree — a property of a transitive optional dependency, not a control.
- **Evidence:** stated plainly in both the gate and the harness's own "NOT PROVEN" section; I did not test an AVIF request because the endpoint 404s before the transform.
- **Consequence:** any future change that pulls `sharp` into the web image would not be caught by any gate, though the `unoptimized: true` control would still prevent the endpoint from serving. The residual risk is therefore low but the dependency on an incidental property is real and worth recording.
- **New or inherited:** inherited (the Phase 35 review identified it).
- **Fixed during review:** **NO**.

### R36-06 — LOW — M7 records an accepted weakening in the image-optimizer gate

- **Component:** `scripts/verify-next-image-optimizer.mjs` Layer 3
- **Condition:** deleting the entire runtime probe leaves the gate green, because Layers 1 and 2 still hold.
- **Evidence:** harness mutant M7, `expected: 'tolerated'`, observed exit 0.
- **Consequence:** the strongest evidence (a live server answering 404) is the only layer that can be removed without consequence. A reviewer could delete Layer 3 and every gate would still pass, while the runtime behaviour is no longer proven at all.
- **Assessment:** this is arguably **correct layered design** — any single layer being removable is not automatically a defect, and the harness records the degradation rather than hiding it. I record it as LOW/accepted rather than MEDIUM because Layers 1 and 2 do independently refuse the known-vulnerable states I tested in §5.1.
- **New or inherited:** new in Phase 36.
- **Fixed during review:** **NO**.

### R36-07 — INFO — `unoptimized: true` is a mitigation with a product consequence

If the web app ever renders images, `<Image>` will silently emit unoptimized originals — larger payloads, no responsive `srcset` optimization. Not a security regression; recorded so the tradeoff is not forgotten if the UI grows image content.

### R36-08 — INFO — 401-revocation session-clearing was inspected, not independently re-tested

See §9.2. The N-12 harness covers 429 semantics, `RATE_LIMITED`, `Retry-After`, genuine 403, the no-over-correction case, and mobile session retention on 429. A fresh 401-revocation mutation of my own was not constructed.

---

## 14. Review-gap status

A review document existing does **not** mean the phase is independently reviewed. I classified each by reading the document's own independence disclosure.

| Phase | Artifact | Classification | Basis |
|---|---|---|---|
| 22 | none | **no review artifact** | — |
| 23 | none | **no review artifact** | — |
| 24 | `SECURITY_REVIEW_PHASE_24.md` (tracked) | **partially independently reviewed** | present; independence not re-litigated here |
| 25 | `SECURITY_REVIEW_PHASE_25.md` (**untracked**) | **partially independently reviewed — self-endorsement disclosed** | its own §0 states the reviewer "did reproduce and assert those findings … during Phase 26" and is "reviewing work I have previously endorsed without independent scrutiny" |
| 26 | `SECURITY_REVIEW_PHASE_26.md` (**untracked**) | **SELF-REVIEWED** | its own §0: "This review is NOT independent. It is a self-review with adversarial method" |
| 27 | none (only `docs/PHASE_27_FINAL_REPORT.md`, untracked) | **no review artifact** | no `SECURITY_REVIEW_PHASE_27.md` |
| 28 | `SECURITY_REVIEW_PHASE_28.md` (**untracked**) | **independently reviewed (self-declared)** | states "independent reviewer, engaged solely for adversarial verification"; reviewed an *uncommitted* tree |
| 29 | `SECURITY_REVIEW_PHASE_29.md` (tracked) | **independently reviewed (self-declared)** | I re-executed the harness it introduced (§7) |
| 30 | `SECURITY_REVIEW_PHASE_30.md` (**untracked**) | **independently reviewed (self-declared)** | states it did not author the spec it reviewed; spec-only phase |
| 31 | `SECURITY_REVIEW_PHASE_31.md` (**untracked**) | **independently reviewed (self-declared)** | — |
| 32 | via `SECURITY_REVIEW_PHASE_34.md` (**untracked**) | **SELF-REVIEWED** | its own header: "THIS DOCUMENT IS NOT AN INDEPENDENT REVIEW … the reviewer of this document is the same agent that implemented Phases 32 and 33" |
| 33 | via `SECURITY_REVIEW_PHASE_34.md` (**untracked**) | **SELF-REVIEWED** | same sentence |
| 34 | `SECURITY_REVIEW_PHASE_34.md` (**untracked**) | **SELF-REVIEWED** | same sentence |
| 35 | `SECURITY_REVIEW_PHASE_35.md` (**untracked**) | **independently reviewed (self-declared)** | explicitly disclaims authorship of P32/33/34; I did not rely on its conclusions and re-derived P35-1/P34-1 myself |
| 36 | **this document** | **independently verified (this pass)** | methodology in §4; **no organizational independence — see §2** |

**Gaps remaining after this pass:**

- **Phases 22, 23, 27 — no review artifact at all.** Still open.
- **Phases 32, 33, 34 — self-reviewed only.** Phase 36 fixes P34-1 and P35-1 as *findings*, but does not convert the Phase 32/33/34 *review* into an independent one. Still open.
- **Phase 26 — self-reviewed**, by its own unambiguous admission. Still open.
- **Phase 25 — partially independent**, weakened by prior endorsement. Still open.
- **Organizational independence for every phase, including 36 — not achieved by this document.**

**Phases 32–35 lineage caution:** the same agent implemented Phases 32/33, wrote the Phase 34 self-review of its own work, then (per the Phase 35 document's own account) was reviewed by a different agent which produced P35-1 and P34-1. That chain is credible as far as it goes and the Phase 35 review does appear genuinely independent on its face. But I cannot verify agent identity, session separation, or that the Phase 35 review was not influenced by its author. Phases 32–35 are **partially independently reviewed at best**, and the reviews themselves are untracked (R36-04), so a third party cannot check that chain at all.

---

## 15. Integrity / contamination checks

### 15.1 Repository state — unchanged

| Check | Before | After | Result |
|---|---|---|---|
| HEAD | `199877ae…` | `199877ae…` | unchanged |
| Tracked tree hash | `774566b4b973da5ae15590c010e2dfc8f64ecca4` | `774566b4b973da5ae15590c010e2dfc8f64ecca4` | **identical** |
| `git status --porcelain` | 16 untracked pre-existing docs | 16 untracked pre-existing docs + this file | no tracked file added, changed or deleted |
| Staged files | none | none | — |

### 15.2 Protected artifacts — all byte-identical

| File | MD5 before | MD5 after |
|---|---|---|
| `pnpm-lock.yaml` | `ccfa78db9184754cf7f9f4ac86353659` | `ccfa78db9184754cf7f9f4ac86353659` |
| `pnpm-workspace.yaml` | `656abae051a73b60deba041dfa8f0a8c` | `656abae051a73b60deba041dfa8f0a8c` |
| `package.json` | `322568884835c4083f2eac29801fb1b4` | `322568884835c4083f2eac29801fb1b4` |
| `.github/workflows/ci.yml` | `1651c1020f72e04032efb99269681e68` | `1651c1020f72e04032efb99269681e68` |
| `apps/web/next.config.mjs` | `b5e1b263bc3b5e80a27d81f1748ee04f` | `b5e1b263bc3b5e80a27d81f1748ee04f` |
| `apps/api/prisma/schema.prisma` | `4452c2a2cd00dc683930e164d6ec5a9c` | `4452c2a2cd00dc683930e164d6ec5a9c` |

No Prisma schema or migration was touched. No lockfile change was required at any point.

### 15.3 Phase 36 implementation files — not modified

All five Phase 36 artifacts are byte-identical to HEAD. I never opened any of them for writing:

- `scripts/verify-next-image-optimizer.mjs`
- `scripts/mutate-next-image-optimizer.mjs`
- `scripts/verify-dependency-security-floor.mjs`
- `scripts/mutate-dependency-security-floor.mjs`
- `docs/PHASE_36_FINAL_REPORT.md`

Every mutation ran against a `/tmp` mirror. `mutate-container-gate.mjs`, which mutates the working tree **in place**, was deliberately redirected to a mirror for exactly this reason — see §10.2. Its three mutated API source files were diffed against the repository afterwards and are identical.

### 15.4 Git history and index — untouched

No commit, amend, rebase, reset, stash, push, or checkout of a tracked ref. One `git worktree add`/`remove` pair created and removed a detached worktree at HEAD; the primary worktree, `HEAD`, `origin/main` and the index are unchanged, and `git worktree list` shows only the main worktree.

### 15.5 Throwaway infrastructure — all removed

| Artifact | Disposition |
|---|---|
| 4 × `ecc-api:p24-mutant-*` images | **deleted** |
| `ecc-web:p36-verify` | **left in place** — created 15:01 IST, before this review began (~17:53); not my artifact |
| Container mirror, vuln-repro, plugin mirrors, floor-repro, 3 probe mirrors | **deleted** |
| Clean-checkout worktree | **removed** via `git worktree remove --force` |
| Throwaway PostgreSQL (`ecc-p28-*`, `ecc-artifact-*`, migration container) | **destroyed by their own harnesses**; `docker ps -a` shows none remaining |

`node_modules` in the throwaway mirrors was **symlinked** to the real store and never written to; every gate in this pass is read-only with respect to it.

### 15.6 Developer database — never accessed

The developer database `ecc` was never a target. `run-db-suites.mjs`, `verify-release-artifact.mjs` and `verify-db-migrations.sh` each provision their own throwaway PostgreSQL and each reported destroying it. No migration ran against, and no write was issued to, the developer database. I therefore cannot offer a "fingerprint unchanged" attestation for it beyond the fact that it was never contacted.

---

## 16. Limitations

1. **Not organizationally independent.** See §2. This is the most important limitation in this document.
2. **No staging or production environment was used.** All runtime evidence comes from locally built artefacts and a throwaway container. Real deployment behaviour — reverse-proxy rules, WAF, CDN, ingress rewriting — is untested.
3. **Advisory 1193733's AVIF transform was never executed.** The endpoint 404s before the transform. The RCE path itself is not proven unreachable by execution; it is unreachable by branch, with `sharp` absent (R36-05).
4. **Phase 25 F-1 – F-3 inspected, not re-derived.** See §9.3.
5. **401-revocation session clearing inspected, not independently re-tested.** See R36-08.
6. **The advisory triage dispositions themselves were not re-litigated.** I confirmed the critical/high filter and that the floor gate closes the resulting gap, but I did not independently re-derive each of the ~48 critical/high dispositions' reachability evidence.
7. **Two of my probes ran against `/tmp` mirrors whose `node_modules` was symlinked**, so they share the real pnpm store. That is read-only and matches how the production harnesses operate, but it is not a true cold-cache install for those specific probes. The clean-checkout worktree install (§11) *was* a real frozen-lockfile install.
8. **Container mutant coverage is M8–M11 only.** M1–M7 of `mutate-container-gate.mjs` were not re-run; they are covered by the green hosted run, which I verified executed `verify-docker-images.mjs` to success.
9. **Review-gap lineage cannot be independently verified.** Determining whether a review was genuinely performed by a different agent is not something I can establish from inside the repository, and R36-04 means the documents are not even in the history.
10. **No disposition is claimed for any deployment environment, and no security score, rating or ranking is assigned or should be inferred.**

---

## 17. Final disposition

### APPROVED WITH FINDINGS

The Phase 36 claims I was able to test independently held up under attack:

- **P35-1 was real and is genuinely closed.** I reproduced the vulnerable state from scratch — a production build serving `200 image/png` from an unauthenticated `/_next/image` — and confirmed HEAD returns 404 for local, remote and bare requests while `/` and `/health` still serve. All three layers are independent, and the triage logic now tests the configuration that actually gates the code path, failing closed across 12 of 13 ambiguous config shapes.
- **P34-1 was real and is genuinely closed.** I reproduced the weakness with a real `pnpm install` on lowered overrides: `pnpm audit` moderate 36 → 38 with advisories 1240100/1240101 restored, while `verify-dependency-audit.mjs`, `triage-vulnerabilities.mjs`, `verify-dependency-triage.mjs`, `verify-config-contract.mjs`, `verify-ci-parity.mjs` and `verify-next-config-features.mjs` **all exited 0**. Only the new floor gate fails, and it fails on the security floor specifically. Parent semver ranges are satisfied; five positive controls show the floor does not punish legitimate movement.
- **P35-2 was real and is genuinely closed.** I built my own git work-tree mirrors and confirmed the untracked assertion fires for all four Phase 36 gates individually, not merely via the harness's own C22/C23/C24.
- **CI integration is real.** Run `36714434566` matches HEAD exactly: 5/5 jobs, 97 steps, 0 skipped, with all Phase 36 security gates executed as parsed commands. Every suppression and narrowing vector I tried is rejected.
- **No prior control was weakened.** 17 gates re-executed green, including 486 DB-backed tests, 34 mobile and 1 web with 0 skipped. Every mutation harness's post-condition verified byte-identical.
- **M8–M11, reported unverified by Phase 36, I executed and confirmed detected** for the intended reason, with the control restored and all infrastructure cleaned up.

The four MEDIUM findings are **real but none is a security-control failure at HEAD**: the `plugins` analyser inconsistency is neutralised by two other layers and by Next 14.2.35's actual behaviour; the two required-gate list holes are *robustness* gaps that leave every gate currently executing and protected; and the `FLOORS` gap is the one I would fix first, since it is the single place where the floor control's own configuration can be lowered without any check failing — which is precisely the failure mode the control was built to prevent.

None of these findings was fixed during this review, by design. Remediation is a separate, authorised activity.

**This document makes no production-readiness, staging-readiness, release-readiness or compliance-certification claim, and asserts no organizational independence.**

---

### Status legend

| Marker | Meaning | Applied to |
|---|---|---|
| **VERIFIED** | independently executed; result re-derived from primary sources | P35-1 remediation, P34-1 remediation, P35-2, CI run 36714434566, M8–M11, all re-run gates |
| **REPRODUCED** | independently re-created the adverse condition and observed it | P35-1 (`200 image/png`), P34-1 (audit exit 0 on weakened graph) |
| **INSPECTED** | read and reasoned about; not independently executed | Phase 25 F-1–F-3; 401-revocation session clearing; per-advisory triage dispositions |
| **NOT TESTED** | outside this pass | Phases 22/23/27 (no artifact); container mutants M1–M7 |
| **BLOCKED BY ENVIRONMENT** | could not be executed | none — the only Phase 36 limitation (M8–M11) was executed successfully |
| **INHERITED** | predates Phase 36 | R36-02 (required-gate list coordination), R36-04 (untracked reviews), R36-05 (`sharp` absence) |
| **ACCEPTED LIMITATION** | deliberate, documented, not a defect | M7 tolerated weakening (R36-06); `unoptimized: true` product tradeoff (R36-07) |