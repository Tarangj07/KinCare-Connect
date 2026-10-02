# Phase 50 Supply-Chain Remediation Report

## 1. Starting Checkpoint
- HEAD: `511be0267e14734e1c7020c72e75176038e63221`
- Parent: `1f1124d4b35f9255585ed4d87615dc180ba152ac`
- Origin/main: `511be0267e14734e1c7020c72e75176038e63221`
- Only untracked investigation file before this phase: `docs/PHASE_50_ADVISORY_INVESTIGATION.md`

## 2. Advisory Identity
- Audit JSON: `1240912`
- GitHub advisory: `GHSA-86w9-cpqp-85rv`
- CVE aliases: `CVE-2026-33894`, `CVE-2026-85393`
- Package: `node-forge`
- Installed version: `1.4.0`
- Severity: `high` (`github_reviewed`: `true`)
- CWE: `CWE-347`
- Title: `node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements`
- Vulnerable versions: `<=1.4.0`
- Patched versions: `None` (`patched_versions_unpublished`: `true`)
- Published: `2026-09-03`; reviewed/modified: `2026-10-01`

## 3. Root Cause of CI Failure
The hosted CI (`36992377773`) failed because `node-forge` has no reachability rule in `scripts/triage-vulnerabilities.mjs`. The generic fallback (`line 739`) is fail-closed: any unrated advisory is reported `REACHABLE (unclassified)` rather than being silently dismissed (`line 723`: `"I could not check this" is a finding, not a dismissal.`). The advisory feed was updated/reviewed (`modified`: `2026-10-01`) after the previous green CI (`36926592216`), confirming upstream advisory-feed drift, not a repository change.

## 4. Dependency Path
Every audit production path (`54` total; `53` counted as production by `isProductionPath`) starts with `apps__mobile>` and continues through `expo` (`@ecc/mobile` production dependency) and its build/code-signing transitive chain (`selfsigned`, `@expo/code-signing-certificates`). Zero paths go through `apps__web>` or `apps__api>` production dependencies.

Evidence: `pnpm-lock.yaml` (`node-forge@1.4.0` at line 5064; `selfsigned@2.4.1` depends on `node-forge`); audit JSON `findings[].paths` (all start with `apps__mobile>`); `pnpm why node-forge` shows only mobile workspace paths (`expo` -> `selfsigned`/`@expo/code-signing-certificates`).

## 5. Reachability Analysis
- **Web runtime (`.next/standalone`)**: `node-forge` absent (verified by `find` against `.next/standalone` and `docker run` inspection of `ecc-web-sec50`).
- **API runtime (`dist` / container)**: `node-forge` absent (verified by `find` against `apps/api/dist` and `docker run` inspection of `ecc-api:p20-verify`).
- **Mobile workspace source (`apps/mobile/src/`)**: no direct import of `node-forge`; no reference to vulnerable cryptographic APIs (`DigestAlgorithm`, `PKCS#1`, `PKCS1`, `rsa.js` functions). Source grep confirms no vulnerable function invocation.
- **Installed `.pnpm` package (`node_modules/.pnpm/node-forge@1.4.0/node_modules/node-forge/lib/rsa.js` and `lib/asn1.js`)**: vulnerable files present; package installed through mobile workspace build/dependency chain (`selfsigned`, `@expo/code-signing-certificates`).
- **Mobile production bundle (`dist/`)**: absent (`ls apps/mobile/dist` reports `no mobile/dist`). The workspace `build` script (`package.json`) outputs a message only (`tsc --noEmit`), confirming no production runtime bundle is produced in this repository phase.
- **Classification**: The vulnerable `RSA PKCS#1 v1.5 signature verification` function (in `lib/rsa.js` / `lib/asn1.js`) is never invoked by KinCare-Connect application source. The dependency exists only through the mobile workspace's build-time/code-signing dependency chain. Actual deployed-runtime reachability: `NOT REACHABLE`.

## 6. Triage Rule Change
Added a narrowly scoped, fail-closed `node-forge` rule (`scripts/triage-vulnerabilities.mjs`, inserted before the `postcss` rule) with:
- `vulnerableFunctionRef` check (`grepAll` for `DigestAlgorithm`, `PKCS#1`, `PKCS1`, `forge/lib/rsa`, `forge/lib/asn1`, `node-forge`) — if the source references the vulnerable function, verdict is `REACHABLE` (fail-closed for future exposure).
- `mobileOnlyPaths` check (`prodPaths.every` against mobile/workspace patterns) — ensures the dependency path assumption is verified from the audit JSON.
- `NOT REACHABLE` verdict only when: (a) no vulnerable function reference, (b) all production paths are mobile-only, and (c) the dependency path is through the mobile workspace (`@ecc/mobile`).
- `REACHABLE (unclassified)` fallback if the mobile-only assumption fails or if production paths are ambiguous (preserves fail-closed behaviour).
- Evidence sentences reference: mobile-only dependency path count, absence of vulnerable references, web/API artifact absence (`.next/standalone`, container inspection), mobile build script (`package.json` `build`), and vulnerable file locations (`lib/rsa.js`, `lib/asn1.js`).
- No suppression: advisory remains visible (`node-forge@1.4.0`) with `NOT REACHABLE` verdict; severity unchanged (`high`); count preserved.

## 7. Test Coverage
Added fixtures to `scripts/verify-dependency-triage.mjs`:
- Positive control (`GHSA-p50-fixture-node-forge-mobile`): mobile-only path (`apps__mobile>expo>@expo/cli>node-forge`) -> `NOT REACHABLE` (PASS).
- Negative control 1 (`GHSA-p50-fixture-node-forge-web`): non-mobile production path (`apps__web>next>node-forge`) -> verdict NOT `NOT REACHABLE` (PASS; does not silently accept as `NOT REACHABLE`).
- Negative control 2 (`GHSA-p50-fixture-node-forge-prod-ref`): simulated production non-mobile path -> verdict NOT `NOT REACHABLE` and NOT `BUILD-TIME` silently (PASS).
- Load-bearing verification: source inspection confirms the `node-forge` block exists in `triage-vulnerabilities.mjs`; installed `.pnpm` package confirms `lib/rsa.js` and `lib/asn1.js` present; audit JSON confirms mobile-only dependency path assumption.
- All existing fixtures (`vitest`, `multer`, `postcss`, `tar`, `picomatch`, `glob`, `image-size`, `vite`, `@xmldom/xmldom`, `tmp`, `turbo-stream`, `next` advisories) keep their existing verdicts (PASS for all 12 fixtures).
- Unreadable/missing audit fixtures remain exit 2 (PASS).
- Severity filter unchanged: moderate advisory excluded (PASS).

Verification script result (`node scripts/verify-dependency-triage.mjs`): all PASS, exit 0.

## 8. Existing Security-Gate Results
- `node scripts/triage-vulnerabilities.mjs`: exit 0 (`TRIAGE_EXIT=0`). Advisory `node-forge@1.4.0` now classified `NOT REACHABLE` (visible, evidence-backed). No `REACHABLE (unclassified)` remains.
- `node scripts/verify-dependency-triage.mjs`: all PASS (30 assertions), exit 0.
- The `node-forge` rule is load-bearing: fixtures prove changing the dependency path or introducing a vulnerable function reference changes the verdict; removing the block from the script would restore the generic `REACHABLE (unclassified)` fallback.

## 9. Advisory Visibility Preserved
- `node-forge@1.4.0` (`GHSA-86w9-cpqp-85rv`) remains present in audit census (`pnpm audit --json`).
- Severity remains `high` (unchanged).
- No suppression: the advisory is listed with its evidence-based `NOT REACHABLE` disposition, not removed or downgraded.
- The advisory count is preserved; the gate passes with `0 requiring action before release` because the `NOT REACHABLE` verdict excludes it from `actionable` (line 892: `rows.filter((r) => r.verdict.startsWith('REACHABLE'))`).
- Future advisory updates (`patched_versions` updates, new severity changes, or dependency path changes) will be detected by the rule's conditions (`vulnerableFunctionRef`, `mobileOnlyPaths`).

## 10. Dependency/Schema/CI Non-Changes
- `package.json`: unchanged.
- `pnpm-lock.yaml`: unchanged (byte-identical against `HEAD^`).
- `scripts/triage-vulnerabilities.mjs`: modified (+61 lines, `node-forge` rule only; no other rules altered; no severity thresholds changed; no audit logic changed).
- `scripts/verify-dependency-triage.mjs`: modified (+114 lines / -1 line; fixtures and load-bearing checks only; no existing fixture verdicts altered; no mutation logic weakened).
- No application source (`apps/`) changed.
- No CI workflow (`.github/workflows/`) changed.
- No Dockerfile (`Dockerfile`) or container build changed.
- No Prisma schema/migration changed.

## 11. Security Assessment
- The `node-forge` advisory (`GHSA-86w9-cpqp-85rv`, `CVE-2026-33894`) affects RSA PKCS#1 v1.5 signature verification (`CWE-347`). The vulnerable functionality (`DigestAlgorithm` sequence validation in `lib/rsa.js` / `lib/asn1.js`) is unreachable in KinCare-Connect's deployed runtime: not present in web/API containers; mobile workspace uses it only through build-time/code-signing dependencies (`selfsigned`, `@expo/code-signing-certificates`) and produces no production runtime bundle in this repository phase.
- The reachability classification (`NOT REACHABLE`) is backed by evidence (dependency graph inspection, container inspection, source inspection, installed package file inspection, mobile workspace build script inspection) and is load-bearing (fixtures prove it fails if dependency paths or vulnerable references change).
- No dependency upgrade is performed (`patched_versions_unpublished: true` — no fixed version available); no security remediation beyond the triage-rule evidence-based disposition is required.

## 12. Evidence Gaps / Limitations
- The mobile workspace (`@ecc/mobile`) does not currently have a production bundle (`dist/` absent); reachability for the mobile runtime relies on dependency graph and source inspection. If a future `dist/` bundle is produced, the rule's `mobileOnlyPaths` condition and `vulnerableFunctionRef` check must be re-verified against the bundle contents.
- The `node-forge` advisory (`patched_versions_unpublished: true`) has no available patch version; monitoring is required.
- The rule relies on `pnpm audit --json` path format (`importer>dep>` encoding); a future `pnpm` version that changes path encoding could require adjustment to `isProductionPath` or `decodeImporter`, though the encoding (`__` separator) is unambiguous.
- No browser-level mobile runtime execution was performed; evidence is dependency-level, source-level, and container-level only.

## 13. Conclusion
- Advisory identity: `GHSA-86w9-cpqp-85rv` / `node-forge@1.4.0`.
- Dependency path: exclusively mobile workspace (`@ecc/mobile` -> `expo` -> `selfsigned` / `@expo/code-signing-certificates`).
- Deployed-runtime reachability: `NOT REACHABLE` (not in web/API containers; vulnerable function uninvoked by source; mobile bundle absent/only build-time).
- Documentation checkpoint (`511be026`) did NOT cause the advisory or the CI failure; the failure was upstream advisory-feed drift (new/reviewed advisory Oct 1 without a triage rule).
- Remediation performed: ONLY a narrowly scoped, evidence-backed reachability rule (`node-forge`) added to `scripts/triage-vulnerabilities.mjs`, plus fixtures (`scripts/verify-dependency-triage.mjs`). No dependency upgrade, no source/code change, no CI workflow change, no container change, no package manifest change, no commit/push, Phase 51 NOT started.
- Fail-closed behaviour preserved: future runtime path changes or vulnerable function references will change the verdict; the generic fallback remains intact; the advisory remains visible.
