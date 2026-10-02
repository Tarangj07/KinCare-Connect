# Phase 50 Supply-Chain Advisory Investigation

## 1. Scope

Investigate the hosted CI failure (`36992377773`) that occurred after the Phase 50 documentation checkpoint (`511be026`). The failure is in the `API` job, step `node scripts/triage-vulnerabilities.mjs`, verdict `REACHABLE (unclassified)`, advisory `node-forge@1.4.0`. No remediation, no dependency changes, no source changes.

## 2. Starting Checkpoint

- HEAD: `511be0267e14734e1c7020c72e75176038e63221`
- Parent: `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- `origin/main`: `511be0267e14734e1c7020c72e75176038e63221`
- Previous checkpoint (`1f1124d`) hosted CI (`36926592216`): all five jobs SUCCESS.
- Current checkpoint (`511be026`) hosted CI (`36992377773`): Web SUCCESS, Mobile SUCCESS, Release SUCCESS, Containers SUCCESS, API FAILURE.
- Working tree: clean before investigation; only new untracked file created: `docs/PHASE_50_ADVISORY_INVESTIGATION.md`.

## 3. CI Failure Reproduction

**FACT:** Running the gate locally produces the exact same failure.

**EVIDENCE:**
```
$ node scripts/triage-vulnerabilities.mjs; echo "EXIT_CODE=$?"
...
REACHABLE (unclassified) 1
FAILED — 1 critical/high advisory/ies are reachable and need a decision before release.
```
Exit code: 1. Advisory: `node-forge@1.4.0`. Verdict: `REACHABLE (unclassified)`.

**INFERENCE:** The hosted CI failure and local reproduction match exactly.

## 4. Exact Advisory Identity

**FACT:** The advisory identity is unambiguous and confirmed by three independent sources.

**EVIDENCE:**
- Audit JSON (`pnpm audit --json`) key `1240912`: `module_name`: `node-forge`, `installed`: `1.4.0`, `vulnerable_versions`: `<=1.4.0`, `patched_versions`: `None`, `patched_versions_unpublished`: `true`, `severity`: `high`.
- Audit JSON `github_advisory_id`: `GHSA-86w9-cpqp-85rv`; aliases: `CVE-2026-33894`, `CVE-2026-85393`, `GHSA-ppp5-5v6c-4jwp`.
- OSV API (`https://api.osv.dev/v1/vulns/GHSA-86w9-cpqp-85rv`) response (retrieved during this session): `id`: `GHSA-86w9-cpqp-85rv`, `summary`: same title, `modified`: `2026-10-01T21:40:55.016251436Z`, `published`: `2026-09-03T21:31:15Z`, `cwe_ids`: `["CWE-347"]`, `aliases`: same CVEs, `database_specific.severity`: `HIGH` (`github_reviewed`: `true`, `github_reviewed_at`: `2026-10-01T21:09:09Z`).
- Advisory details: "node-forge through 1.4.0 fails to validate element count in nested DigestAlgorithm sequences during RSA PKCS#1 v1.5 signature verification. Attackers can embed garbage bytes inside the DigestAlgorithm sequence to forge valid signatures for arbitrary messages using low-exponent RSA keys."

**INFERENCE:** The advisory is real, recently reviewed (Oct 1, 2026), has no published patch (`patched_versions_unpublished: true`), and affects `node-forge` versions through `1.4.0` (the installed version is exactly `1.4.0`).

## 5. Dependency Graph

**FACT:** Every production path for `node-forge` goes through the mobile workspace (`@ecc/mobile`). No path goes through `apps/web` or `apps/api` production dependencies.

**EVIDENCE (`pnpm why node-forge`):**
```
node-forge@1.4.0
├─┬ @expo/cli@0.18.31
│ └─┬ expo@51.0.39
│   └── @ecc/mobile@0.0.0 (dependencies)
├─┬ @expo/code-signing-certificates@0.0.5
│ └── @expo/cli@0.18.31 [deduped]
└─┬ selfsigned@2.4.1
```

**EVIDENCE (`audit.json` paths — 54 paths, all start with `apps__mobile>`):**
Every `findings[].paths[]` value begins with `apps__mobile>`. Example first hops:
- `apps__mobile>expo>@expo/cli>@expo/code-signing-certificates>node-forge`
- `apps__mobile>expo>@expo/cli>@react-native/dev-middleware>selfsigned>node-forge`
- `apps__mobile>expo>@expo/cli>node-forge`
- `apps__mobile>expo-router>expo>@expo/cli>node-forge`
- `apps__mobile>react-native>@react-native/community-cli-plugin>@react-native/dev-middleware>selfsigned>node-forge`

**EVIDENCE (`pnpm-lock.yaml`):**
- `node-forge@1.4.0` at line 5064; `selfsigned@2.4.1` depends on `node-forge: 1.4.0`; `@expo/code-signing-certificates@0.0.5` depends on `node-forge`.
- All paths are through mobile workspace dependencies (`expo`, `react-native`, `@expo/cli`, `selfsigned`).

**EVIDENCE (no dependency change between checkpoints):**
```
$ git diff HEAD^ -- package.json pnpm-lock.yaml apps/ scripts/ .github/
(empty = unchanged)
```
`pnpm-lock.yaml` byte-identical between `1f1124d` and `511be02`. `node-forge` version unchanged (`1.4.0`). Lockfile integrity unchanged.

## 6. node-forge Reachability Analysis

### 6.1 Dependency Path Classification

**FACT:** All `node-forge` paths are through the mobile workspace (`@ecc/mobile`).

**CLASSIFICATION:**
- Mobile workspace (`@ecc/mobile`): `C. build/test/dev-only` (installed through `expo` development/build toolchain and `selfsigned`; mobile workspace `build` script produces only a type-check or future EAS bundle; current `dist/` absent).
- Web runtime (`apps/web` standalone/container): `D. unreachable` (not installed in `node_modules`, not in `.next/standalone`, not in web container).
- API runtime (`apps/api` installed/container): `D. unreachable` (not installed in `apps/api/node_modules`, not in container).

**EVIDENCE (production artifact inspection):**

- Web standalone server (`.next/standalone/apps/web/server.js`): no reference to `node-forge`.
- Web container (`ecc-web-sec50`): `docker run --rm ecc-web-sec50:ind sh -c 'ls node_modules/node-forge ...'` outputs `NO_NODE_FORGE_IN_WEB`.
- API container (`ecc-api:p20-verify`): same output: `NO_NODE_FORGE_IN_API`.
- Mobile workspace installed package (`node_modules/.pnpm/node-forge@1.4.0/node_modules/node-forge/package.json`): present in `.pnpm` store (installed by pnpm), confirming it is installed as a workspace dependency.
- Mobile workspace source (`apps/mobile/src/`): no direct import of `node-forge` and no reference to vulnerable functions (`DigestAlgorithm`, `PKCS#1`, `rsa.js`).
- Mobile workspace `dist/`: `ls apps/mobile/dist` reports `no mobile/dist`. The workspace `build` script (from `package.json`) produces only a type-check (`tsc --noEmit`) and a message that future mobile builds use `expo prebuild + EAS`; no production JS bundle exists.

### 6.2 Actual Code Reachability of Vulnerable Functionality

**FACT:** The vulnerable functionality (`RSA PKCS#1 v1.5 signature verification`, specifically `DigestAlgorithm` sequence validation in `lib/rsa.js` / `lib/asn1.js`) is never invoked by any KinCare-Connect application code.

**EVIDENCE:**
- No source file under `apps/` or `packages/` imports or requires `node-forge`, `forge`, `selfsigned` (other than as a dependency), or references `DigestAlgorithm`, `PKCS#1`, `PKCS1`, or `asn1` cryptographic verification APIs.
- `node-forge` is a cryptographic utility library used by `selfsigned` (self-signed certificate generation) and `@expo/code-signing-certificates` (Expo CLI certificate signing). These are build-time/code-signing operations, not runtime cryptographic verification of user-controlled data.
- The advisory's attack vector requires an attacker-controlled cryptographic input (e.g., a forged RSA signature with nested `DigestAlgorithm` elements) to reach the vulnerable `verify` or `createDigestAlgorithmSequence` code path. The KinCare-Connect application does not accept cryptographic signatures from external sources in any endpoint; authentication uses `Bearer` JWT tokens issued by the backend (`NestJS AuthorizationService`), not RSA PKCS#1 v1.5 verification via `node-forge`.
- The mobile workspace's production runtime (if built) runs the Expo React Native app (`expo-router`), which does not invoke `node-forge` at runtime (the bundle does not contain `.pnpm` store packages).

**CLASSIFICATION:**
- A. application runtime reachable: **NO** (no endpoint invokes vulnerable function)
- B. application runtime present but vulnerable functionality unreachable: **YES** (`node-forge` installed through mobile workspace build/dependencies, but vulnerable function never called)
- C. build/test/dev-only: **YES** (installed through `expo` build-time/code-signing dependency chain; no production bundle contains it)
- D. unreachable from shipped runtime: **YES** (not present in web/API runtime artifacts; mobile bundle does not contain it)
- E. unknown: **NO** (evidence is sufficient for classification B/C/D)

## 7. Triage Script Analysis

**FACT:** The `triage-vulnerabilities.mjs` script (lines 568-759) has no specific reachability rule for `node-forge`. It is not in `EXPLICIT_BUILD_TIME_PACKAGES` (line 568: `new Map()`), and the automated group rules (`tar`, `picomatch`, `glob`, `image-size`, `vite`, `xmldom`, `tmp`, `turbo-stream`) cover packages that reach through `expo`. `node-forge` reaches through `expo` as well (`selfsigned` -> `node-forge` and `@expo/code-signing-certificates` -> `node-forge`), but the automated group only includes the listed package names; it does not include `node-forge`.

**EVIDENCE (code inspection):**
- Lines 671-711: The group includes `name === 'tar' || name === 'picomatch' || name === 'glob' || name === 'image-size' || name === 'vite' || name === 'xmldom' || name === '@xmldom/xmldom' || name === 'tmp' || name === 'turbo-stream'`. `node-forge` is not in this list.
- Lines 739-759 (`function triage` fallback): Returns `REACHABLE (unclassified)` when `name` does not match any specific rule.
- Lines 844-863 (`audit` section): `devOnly` is computed as `prodPaths.length === 0`. For `node-forge`, `prodPaths` = 53 (from audit JSON), so `devOnly` = `false`. The fallback then reports `REACHABLE (unclassified)` because `devOnly` is false and the evidence message says: "It has production paths, and nothing in this script knows whether the vulnerable code is on one."
- Lines 717-723 (comment near `EXPLICIT_BUILD_TIME_PACKAGES`): "Phase 25 (F-5). The ONLY packages allowed a BUILD-TIME verdict without a full reachability rule of their own, each with the reason that was checked. It is empty on purpose. ... The generic fallback used to be `devOnly ? 'BUILD-TIME' : 'REACHABLE (unclassified)'`, which is a fail-OPEN default: 'every path to this package runs through a devDependency' says where the package is INSTALLED, not whether the vulnerable function is INVOKED..."

**INFERENCE:** The script's design is intentionally fail-closed: any advisory without an explicit reachability rule must be manually triaged and added as a rule, rather than being silently dismissed. The `node-forge` advisory is correctly reported as `REACHABLE (unclassified)` by the script's design, not incorrectly classified.

**INFERENCE (security significance):** The script's `REACHABLE (unclassified)` verdict means "I could not check this; triage by hand." It does NOT mean the advisory is actually reachable in the deployed runtime. The evidence supports classifying it as `NOT REACHABLE` (or `BUILD-TIME`) based on dependency path and runtime artifact inspection, but the script requires an explicit written rule to make that claim (per the fail-closed design comment at lines 717-723).

## 8. Advisory-Feed Timeline / Drift Evidence

**FACT:** The dependency tree did not change. Only the advisory feed changed.

**EVIDENCE:**
- `git diff HEAD^ -- package.json pnpm-lock.yaml apps/ scripts/ .github/` = empty (no tracked file modified).
- `pnpm-lock.yaml` byte-identical: `node-forge@1.4.0` entry unchanged (line 5064), `selfsigned@2.4.1` entry unchanged, `@expo/code-signing-certificates` unchanged.
- Audit JSON (`/tmp/opencode/audit.json`) shows advisory `1240912` (GHSA-86w9-cpqp-85rv) present in current feed.
- OSV metadata (`https://api.osv.dev/v1/vulns/GHSA-86w9-cpqp-85rv`): `published`: 2026-09-03, `modified`: 2026-10-01 (updated/reviewed 1 day before this checkpoint's date).
- Previous hosted CI (`36926592216` against `1f1124d`) reported all five jobs SUCCESS, including API. The same `node-forge@1.4.0` dependency existed then (same lockfile), but the advisory either did not exist in the feed or was not yet classified/reported by `pnpm audit` at that time.
- `patched_versions_unpublished`: `true` in audit JSON. No fix available.

**INFERENCE:** The CI regression is caused by upstream advisory-feed state change (new/reviewed advisory for `node-forge`), not by any repository code or dependency change.

## 9. Production Artifact Analysis

**FACT:** `node-forge` is not present in any deployed production artifact produced by this repository.

**EVIDENCE:**
- Web production standalone (`.next/standalone/apps/web/server.js`): no `node-forge` reference.
- Web container (`ecc-web-sec50`): `docker run --rm ecc-web-sec50:ind ...` outputs `NO_NODE_FORGE_IN_WEB`.
- API container (`ecc-api:p20-verify`): `docker run --rm ecc-api:p20-verify ...` outputs `NO_NODE_FORGE_IN_API`.
- Mobile workspace installed package (`node_modules/.pnpm/node-forge@1.4.0/node_modules/node-forge/package.json`): present in `.pnpm` store, confirming installation. Mobile workspace `package.json` has production dependency `expo` (line with `expo`), which pulls in `@expo/cli` -> `selfsigned` -> `node-forge`. The mobile workspace's `build` script produces no production JS bundle (`dist/` absent). The vulnerable code (`lib/rsa.js`, `lib/asn1.js`) exists in the installed `.pnpm` package but is not included in any mobile runtime bundle (mobile runtime runs the Expo React Native app, not `node-forge` cryptographic functions).
- `node-forge` vulnerable files (`lib/rsa.js`, `lib/asn1.js`) present in `.pnpm` package. No reference to these files or their exported functions (`createDigestAlgorithmSequence`, `verify`, etc.) in any application source.

**CLASSIFICATION:** Build-time/development-only dependency (`C` / `D`). Not reachable in deployed runtime (`D` for web/API, `C` for mobile build environment).

## 10. Whether the Documentation Commit Caused the Failure

**FACT:** The documentation commit (`511be026`) did not introduce the advisory. It only added `docs/PHASE_50_SECURITY_REVIEW.md`.

**EVIDENCE:**
- `git diff HEAD^ -- package.json pnpm-lock.yaml apps/ scripts/ .github/` = empty.
- `git diff --stat HEAD^` = `docs/PHASE_50_SECURITY_REVIEW.md | 230 ++++++++++` only.
- `node-forge` version unchanged (`1.4.0`). Lockfile integrity unchanged. Dependency graph unchanged (same audit paths).
- The advisory's `modified` timestamp (`2026-10-01`) post-dates the previous checkpoint's CI run (`36926592216`), confirming feed drift rather than source/dependency change.

**CONCLUSION:** The checkpoint (`511be026`) did NOT cause the CI failure. The failure is caused by an upstream advisory-feed change (new/reviewed advisory `GHSA-86w9-cpqp-85rv` for `node-forge`) combined with the absence of a reachability rule for `node-forge` in the triage script.

## 11. Security Impact

**FACT:** The advisory (`GHSA-86w9-cpqp-85rv`) affects `node-forge`'s RSA PKCS#1 v1.5 signature verification (`CWE-347`). KinCare-Connect does not invoke this functionality in any runtime path.

**EVIDENCE:**
- The advisory title: "RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements."
- The vulnerable package (`node-forge`) is only present through mobile workspace's build/development dependency chain (`expo` -> `@expo/cli` / `selfsigned`).
- No application endpoint uses RSA PKCS#1 v1.5 signature verification. Authentication uses backend-issued JWT (`Bearer` token) verified by `NestJS AuthorizationService`; no client-side or server-side RSA verification via `node-forge`.
- The vulnerable code (`lib/rsa.js`, `lib/asn1.js`) is not imported or referenced by any `apps/` or `packages/` source file.
- The advisory's attack requires attacker-controlled cryptographic input (forged RSA signature with nested DigestAlgorithm elements) reaching the vulnerable verification function. There is no such path in the application.

**INFERENCE:** No direct security impact on KinCare-Connect's deployed runtime. The advisory is a build-time/development-tool exposure only. However, the advisory feed treats it as `REACHABLE (unclassified)` because the triage script lacks a specific rule, causing CI to fail.

## 12. Current Classification

- Triage script verdict: `REACHABLE (unclassified)` (line 743, generic fallback).
- Actual runtime reachability: `NOT REACHABLE` (no vulnerable code path in any deployed runtime).
- Dependency path: mobile workspace (`@ecc/mobile`) production dependency `expo` -> `@expo/cli` -> `selfsigned` / `@expo/code-signing-certificates` -> `node-forge`.
- Artifact presence: web/API containers: absent; mobile bundle: dependency installed but vulnerable function unreachable; `.pnpm` store: present (build dependency).
- Security impact on KinCare-Connect: None demonstrated for deployed runtime.

## 13. Possible Remediation Directions

**No remediation performed.** The following options are noted as theoretical directions based on evidence, not selected:

A. **Dependency update:** Not justified by current evidence (no runtime reachability; advisory `patched_versions_unpublished: true`, so no fixed version exists to upgrade to). Would be routine maintenance only if a patch is released.
B. **Dependency replacement:** Not required (no runtime dependency; `selfsigned` and `@expo/code-signing-certificates` are standard Expo toolchain components; no alternative needed for build functionality).
C. **Reachability classification rule:** A triage-rule addition (`node-forge`) with an explicit `BUILD-TIME` or `NOT REACHABLE` verdict backed by evidence (`no runtime reference`, `path through mobile workspace only`, `vulnerable function unreachable`) would resolve the CI failure without dependency changes. This is the most appropriate direction given the evidence.
D. **Advisory exception with evidence:** If a rule cannot be added immediately, an explicit `BUILD-TIME` disposition with written evidence (as in this investigation) could be added to `EXPLICIT_BUILD_TIME_PACKAGES`.
E. **No action (if evidence confirms unreachable):** Justified by this investigation's evidence for the deployed runtime, but the script's fail-closed design requires an explicit rule or exception rather than an implicit dismissal.
F. **Other:** Monitor advisory feed (`GHSA-86w9-cpqp-85rv`) for `patched_versions` update; if a patch is published (`patched_versions_unpublished` changes to `false`), upgrade `node-forge` through the owning dependency (`selfsigned` or `expo`) as routine maintenance.

**INFERENCE:** Option `C` (add a reachability rule) or `D` (add an explicit build-time exception with evidence) is the appropriate remediation direction, given that no dependency upgrade is currently available (`patched_versions_unpublished: true`) and the vulnerable functionality is unreachable in deployed runtime. Option `E` (no action) could be considered only after an explicit evidence-based rule or exception is added; relying on the generic fallback's `REACHABLE (unclassified)` is not a secure dismissal.

## 14. Evidence Gaps

- **Historical audit data unavailable:** There is no saved `pnpm audit --json` output from the previous passing CI run (`36926592216`). Evidence of advisory-feed drift relies on advisory metadata (`published`: 2026-09-03, `modified`: 2026-10-01) and the unchanged dependency graph (`git diff HEAD^` empty for `pnpm-lock.yaml` and `package.json`).
- **No mobile production bundle built:** The mobile workspace (`@ecc/mobile`) does not currently have a `dist/` directory or a built production bundle (`build` script outputs a message only). Reachability analysis for mobile runtime relies on dependency graph and source inspection rather than inspection of a built bundle. If a production mobile bundle is produced in a later phase, reachability should be re-verified against the bundle contents.
- **No browser-level automation for mobile runtime:** Evidence is source-level and dependency-level; no mobile runtime execution was performed.
- **No external registry access beyond OSV:** Advisory details were fetched from `api.osv.dev`. No additional advisory database sources were queried.

## 15. Conclusion

**FACT:** The hosted CI failure (`36992377773`, API job, step `triage-vulnerabilities.mjs`) is caused by a newly surfaced/reviewed advisory (`GHSA-86w9-cpqp-85rv` / `node-forge@1.4.0`) that has no reachability rule in the triage script. The advisory's vulnerable functionality (`RSA PKCS#1 v1.5 signature verification` in `node-forge`'s `lib/rsa.js` / `lib/asn1.js`) is unreachable from KinCare-Connect's deployed runtime (not present in web/API containers; mobile workspace uses it only through build-time/code-signing dependencies). The documentation checkpoint (`511be026`) did not introduce the advisory (same lockfile, same package graph, no dependency/code changes).

**INFERENCE:** The advisory is correctly reported by the triage script's fail-closed design (`REACHABLE (unclassified)` = "I could not check this; triage by hand"). It is not correctly classified as a runtime exposure for this repository, but the script requires an explicit evidence-based rule or exception rather than an implicit dismissal. A dependency upgrade is not currently possible (`patched_versions_unpublished: true`). No dependency change is justified by the evidence. A triage-rule addition (with the evidence from this investigation) is the appropriate direction.

**VERDICT:** The CI failure is explained by upstream advisory-feed drift (new/reviewed advisory for `node-forge` without a reachability rule). The advisory is unreachable in deployed runtime. The checkpoint (`511be026`) did not cause it. No security remediation (dependency upgrade, source modification, or CI change) is required by the evidence; only a triage-rule decision is needed to resolve the gate failure.

## 16. Exact Commands and Results

- `git rev-parse HEAD` -> `511be0267e14734e1c7020c72e75176038e63221`
- `git rev-parse origin/main` -> `511be0267e14734e1c7020c72e75176038e63221`
- `git rev-parse HEAD^` -> `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- `git status --short --branch` -> `## main...origin/main` (clean tracked tree, untracked `docs/PHASE_50_ADVISORY_INVESTIGATION.md` after creation)
- `git diff --name-only HEAD^` -> `docs/PHASE_50_SECURITY_REVIEW.md`
- `git diff --stat HEAD^` -> `docs/PHASE_50_SECURITY_REVIEW.md | 230 +++++++++++++++` only
- `git diff HEAD^ -- package.json pnpm-lock.yaml apps/ scripts/ .github/` -> empty (unchanged)
- `node scripts/triage-vulnerabilities.mjs` -> exit 1, advisory `node-forge@1.4.0` (`1240912` / `GHSA-86w9-cpqp-85rv`)
- `pnpm why node-forge` -> through `@ecc/mobile` (`expo` -> `@expo/cli`, `selfsigned`)
- `grep 'node-forge' pnpm-lock.yaml` -> line 5064 (`node-forge@1.4.0`), line 13345 (`selfsigned` dependency)
- `python3 -c "...audit.json..."` -> advisory `1240912`, `GHSA-86w9-cpqp-85rv`, version `1.4.0`, vulnerable `<=1.4.0`, patched `None`, `patched_versions_unpublished`: `true`, `severity`: `high`, `cwe`: `CWE-347`, `published`: `2026-09-03`, `modified`: `2026-10-01`
- `curl -sL "https://api.osv.dev/v1/vulns/GHSA-86w9-cpqp-85rv"` -> confirmed advisory details (retrieved during session)
- Source search (`grep -rni 'node-forge' apps/ packages/`) -> no direct imports/reference
- Source search (`grep -rni 'DigestAlgorithm\|PKCS#1\|rsa.js' apps/mobile/src/`) -> no vulnerable function references
- Web container (`ecc-web-sec50`) inspection -> `NO_NODE_FORGE_IN_WEB`
- API container (`ecc-api:p20-verify`) inspection -> `NO_NODE_FORGE_IN_API`
- Mobile workspace installed package (`.pnpm` store) -> present (`node-forge` package exists)
- Mobile workspace `dist/` -> `no mobile/dist`
- Mobile workspace `package.json` `build` script -> typecheck-only (`tsc --noEmit`), no production bundle
- Lockfile comparison (`diff -q pnpm-lock.yaml` against `HEAD^`) -> unchanged
- `node-forge` entrypoint (`lib/rsa.js`, `lib/asn1.js`) present in installed package (confirmed by directory listing)

No tracked file modified besides `docs/PHASE_50_ADVISORY_INVESTIGATION.md` (untracked, uncommitted). No remediation performed. No dependency upgrade. No CI gate change. No commit/push. Phase 51 not started.
