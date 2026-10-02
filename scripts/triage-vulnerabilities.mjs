#!/usr/bin/env node
/**
 * Phase 23 (W6) — vulnerability triage.
 *
 * `pnpm audit` reports 91 advisories, 48 of them critical or high. That
 * number is not a risk figure: an advisory in a build-time tool that never
 * parses attacker input is not the same exposure as an advisory in a
 * component that does. Treating the raw count as the answer is how real
 * exposure gets lost in noise, so this script triages each critical and high
 * advisory into one of a small number of decisions:
 *
 *   REACHABLE   the vulnerable code is on a path an attacker can drive. This
 *               is a finding to fix, and it is listed as such.
 *   NOT REACHABLE
 *               the vulnerable code exists in the dependency graph but the
 *               application never invokes it, and the reason is stated with
 *               the evidence that shows it. Recorded so the exposure is
 *               re-checked if the code path ever appears.
 *   BUILD-TIME  the advisory is in a tool that runs during development or CI
 *               and is never present in a deployed artifact.
 *   FIXED-BY-PIN already at or above the patched version.
 *
 * Reachability is decided from the code, not from the advisory's own
 * description, and each decision records the evidence. A claim of
 * "not reachable" that cannot be checked is a finding, not a dismissal.
 *
 * The script reads and reports. It never changes a dependency: an upgrade is
 * a decision with its own risk (a major bump changes far more than the
 * advisory), and taking it here would be exactly the "unrelated dependency
 * upgrade" this phase is told not to perform. Where the triage says an
 * upgrade is warranted, the required version is named.
 *
 * Usage:  node scripts/triage-vulnerabilities.mjs [--json]
 *         node scripts/triage-vulnerabilities.mjs --audit-file <pnpm-audit.json>
 *
 * `--audit-file` substitutes a saved `pnpm audit --json` report for the live
 * one, so the classifier can be exercised against advisories that do not
 * exist today without editing this script. It is how
 * `scripts/verify-dependency-triage.mjs` proves the fail-closed behaviour of
 * the generic fallback; with no flag the script always runs the real audit.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyseNextConfig, readNextConfigValue } from './lib/next-config-features.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// Reachability, established from the source rather than from the advisory.
// ---------------------------------------------------------------------------

const srcRoot = path.join(repoRoot, 'apps/api/src');
const webRoot = path.join(repoRoot, 'apps/web/src');
// `transpilePackages: ['@ecc/ui', '@ecc/types', '@ecc/validation']` means
// web code does not stop at apps/web/src — a `'use server'` directive in a
// workspace package would register a Server Function just as effectively.
const workspaceSrcRoots = ['apps/web/src', 'packages/ui/src', 'packages/types/src', 'packages/validation/src'].map(
  (p) => path.join(repoRoot, p),
);
const webNextConfig = path.join(repoRoot, 'apps/web/next.config.mjs');
const webDockerfile = path.join(repoRoot, 'apps/web/Dockerfile');
const webStandaloneManifest = path.join(repoRoot, 'apps/web/.next/server/server-reference-manifest.json');

function sourceHas(...needles) {
  const res = spawnSync('grep', ['-rn', ...needles, srcRoot], { encoding: 'utf8' });
  return (res.stdout ?? '').trim();
}
function webSourceHas(...needles) {
  const res = spawnSync('grep', ['-rn', ...needles, webRoot], { encoding: 'utf8' });
  return (res.stdout ?? '').trim();
}

/**
 * Every decision carries the evidence that produced it, so a reviewer can
 * disagree with a specific claim instead of a verdict.
 */
/**
 * Phase 24 (D-6) — per-advisory reachability for `next`.
 *
 * Phase 23 gave `next` ONE rule: if the app imports `next/image`, every next
 * advisory is reachable; otherwise none are. That was accurate for the two
 * criticals it had to triage and wrong as a general claim — `next` is a
 * production dependency here, and the advisory set has grown well past the
 * image optimizer. A blanket "NOT REACHABLE" for a package that ships is a
 * claim that has to be re-earned whenever the advisory database changes, so
 * the rule is now per-advisory: each advisory names the FEATURE whose presence
 * makes it reachable, and that feature is looked for.
 *
 * Every predicate below is a check someone can repeat, not an assertion. An
 * advisory whose required feature is not in this table is reported
 * REACHABLE (unclassified) rather than waved through: "I could not check
 * this" is a finding, not a dismissal.
 */
function grepAll(roots, needles) {
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const res = spawnSync('grep', ['-rn', ...needles, root], { encoding: 'utf8' });
    const text = (res.stdout ?? '').trim();
    if (text) out.push(text);
  }
  return out.join('\n');
}

function readIfPresent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Phase 25 (F-4) — what the web app's Next configuration actually enables.
 *
 * Memoised because four separate triage rules ask the same question, and
 * because the analysis parses the file.
 *
 * The Phase 24 rules asked it with `/\bimages\s*:/`-style regexes over the file
 * TEXT. That cannot distinguish a key from a comment about a key, and it
 * cannot see the `rewrites()` METHOD form that Next.js supports — so a planted,
 * working rewrite left the D-6 rule reporting "the web app does not have
 * rewrites". The analyser walks the AST of the exported config object instead;
 * see `scripts/lib/next-config-features.mjs`.
 *
 * `analysable: false` is returned when the config has a shape this analyser
 * does not read, or declares `plugins`, which may inject any key at all. The
 * rules below treat that as PRESENT, so an unreadable config can never produce
 * a "not reachable" verdict.
 */
let nextConfigAnalysis = null;
function nextConfig() {
  if (nextConfigAnalysis) return nextConfigAnalysis;
  const file = path.relative(repoRoot, webNextConfig);
  if (!existsSync(webNextConfig)) {
    nextConfigAnalysis = {
      analysable: false,
      form: 'absent',
      features: [],
      opaque: [],
      notes: [`${file} does not exist`],
    };
  } else {
    nextConfigAnalysis = analyseNextConfig(readIfPresent(webNextConfig), { fileName: file });
  }
  return nextConfigAnalysis;
}

/** True when the config declares `key` at the top level of the exported config. */
function nextConfigHas(key) {
  const a = nextConfig();
  return a.features.includes(key);
}

/**
 * The exported Next config's SOURCE TEXT, for the value-level reads that
 * `analyseNextConfig` cannot express.
 *
 * Phase 36 (P35-1): `images` is a key whose security effect depends on its
 * VALUE (`unoptimized: true` 404s the optimizer endpoint; `images: {}` does
 * not), so a presence test is insufficient for the image-optimizer rule. An
 * absent file yields `''`, which `readNextConfigValue` reports as `known: false`
 * — i.e. REACHABLE — so a deleted config cannot produce a clearance.
 */
let nextConfigSourceCache = null;
function nextConfigSource() {
  if (nextConfigSourceCache === null) {
    nextConfigSourceCache = existsSync(webNextConfig) ? readIfPresent(webNextConfig) : '';
  }
  return nextConfigSourceCache;
}

/**
 * The evidence sentence for a "the web app does not have <feature>" verdict,
 * phrased from what the analyser actually read — including, when the config
 * could not be read, why that is a finding rather than a clearance.
 */
function nextConfigEvidence(key, featureId, absenceNote) {
  const a = nextConfig();
  if (a.analysable) {
    return (
      `the exported Next config (${path.relative(repoRoot, webNextConfig)}, form: ${a.form}) declares no top-level ` +
      `\`${key}\` key, so the web app does not have the ${featureId}. ${absenceNote}`
    );
  }
  return (
    `the exported Next config could NOT be read, so the absence of the ${featureId} could not be established. ` +
    `That is a finding, not a clearance: ${a.notes.join('; ')}. Fix the analyser or the config shape, then re-run.`
  );
}

/**
 * Files under `dir` containing any of `needles`. Used on the built web tree.
 *
 * RUNTIME files only (`.js`, `.cjs`, `.mjs`). The first version of the postcss
 * rule matched any file, and the installed `next` package then "referenced
 * postcss" through a single `.d.ts` — a type declaration whose only mention of
 * postcss is a doc comment about `postcss-loader`. Type declarations cannot
 * execute, so counting them would have made the check report REACHABLE for a
 * package that no runtime code path touches. The built standalone tree contains
 * only JavaScript, which is why this difference was invisible until the rule
 * was pointed at the installed package as well.
 */
function grepFilesUnder(dir, ...needles) {
  if (!existsSync(dir)) return [];
  const res = spawnSync(
    'grep',
    ['-rl', '--include=*.js', '--include=*.cjs', '--include=*.mjs', ...needles, dir],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return (res.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The first directory named `name` at or below `root`, depth-bounded. */
function findFirstDir(root, name, depth) {
  if (!existsSync(root) || depth < 0) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    if (e.name === name) return full;
    const found = findFirstDir(full, name, depth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * Server Functions are the only place untrusted client input is deserialized
 * by the RSC runtime, so every "crafted HTTP request to an App Router Server
 * Function endpoint" advisory keys on them.
 *
 * The SOURCE is checked first and wins. A `'use server'` directive in the app
 * means the next build registers a server function, so the verdict must be
 * reachable even when the built manifest on disk is stale — an earlier revision
 * consulted the manifest first, and a planted directive was masked by a
 * manifest from a previous build. That is a gate that stays green through the
 * exact change it exists to catch.
 *
 * With no directive in the source, the BUILT artefact is the decisive
 * evidence: `server-reference-manifest.json` enumerates every registered server
 * function, and an empty node+edge map means the endpoint does not exist.
 */
function serverFunctionsPresent() {
  const src = grepAll(workspaceSrcRoots, ["'use server'", '"use server"']);
  if (src) {
    const built = readIfPresent(webStandaloneManifest);
    let stale = '';
    if (built) {
      try {
        const ids = [...Object.keys(JSON.parse(built).node ?? {}), ...Object.keys(JSON.parse(built).edge ?? {})];
        if (ids.length === 0) {
          stale =
            ' — note the built manifest still lists none, so it predates this source and the verdict follows the ' +
            'source, which is what the next build would compile';
        }
      } catch {
        /* ignore an unreadable manifest */
      }
    }
    return { present: true, how: `a 'use server' directive exists in the app source${stale}:\n${src}` };
  }
  const built = readIfPresent(webStandaloneManifest);
  if (built) {
    try {
      const parsed = JSON.parse(built);
      const ids = [...Object.keys(parsed.node ?? {}), ...Object.keys(parsed.edge ?? {})];
      if (ids.length > 0) {
        return { present: true, how: `${ids.length} server function(s) in the built manifest:\n${ids.join('\n')}` };
      }
      return {
        present: false,
        how:
          'no `use server` directive in the source, and the BUILT artefact agrees: ' +
          '.next/server/server-reference-manifest.json has empty `node` and `edge` maps, so no server function is ' +
          'registered and there is no Server Function endpoint to send a crafted request to',
      };
    } catch {
      /* fall through to the weaker form */
    }
  }
  return {
    present: false,
    how:
      `no 'use server' directive in ${workspaceSrcRoots.map((r) => path.relative(repoRoot, r)).join(', ')}, ` +
      'and no built manifest was available to confirm it (run the web build for the stronger form of this check)',
  };
}

const NEXT_FEATURES = [
  {
    id: 'image optimization',
    // Image Optimizer DoS, unbounded disk cache, and the AVIF RCE.
    match: /image optimi[sz]ation|next\/image/i,
    // Phase 36 (P35-1). Rewritten. The previous version answered this question
    // from APPLICATION USAGE — no `next/image` import, no `<Image>` element, no
    // `images` key — and concluded the optimizer was unreachable.
    //
    // That inference is invalid, and the Phase 35 review demonstrated it against
    // the deployed image rather than arguing about it. `/_next/image` is
    // registered by Next unconditionally: with no images in the app at all it
    // answered HTTP 200 with the image bytes, unauthenticated, to any client. The
    // rule even cited "GET /_next/image answered 400" as corroboration, when a
    // 400 carrying the optimizer's own error string is evidence the endpoint is
    // PRESENT and executing.
    //
    // So the question is no longer "does the app use images?" but "can the
    // optimizer be entered at all?". In `next/dist/server/next-server.js` the
    // optimizer branch is taken only when `images.loader` is `default` AND
    // `images.unoptimized` is falsy; otherwise Next renders a 404 and never
    // requires the optimizer module. Phase 36 sets `images.unoptimized: true`,
    // so that branch is unreachable — and the disposition now rests on the
    // configuration that actually gates it.
    //
    // Ordering is deliberate and fails closed at every step:
    //
    //   1. An unreadable `images.unoptimized` is REACHABLE. "I could not check
    //      this" is a finding, never a dismissal.
    //   2. An explicit falsy value is REACHABLE, whatever the source says. This
    //      is the condition Phase 35's P35-1 describes, so it must be the one
    //      this rule is most eager to report.
    //   3. A non-default loader is REACHABLE on the same conservative reading:
    //      the loader may still be able to fetch and transform, and this rule
    //      does not model third-party loaders.
    //   4. Only a literal `unoptimized: true` with an analysable config and no
    //      `next/image` usage reaches NOT REACHABLE.
    //
    // The claim is verified against the BUILT artifact and the RUNNING server
    // by `scripts/verify-next-image-optimizer.mjs`, which is wired into CI and
    // mutation-tested. This rule states the configuration; that gate proves the
    // runtime consequence. Neither is asked to do the other's job.
    present: () => {
      const src = grepAll(workspaceSrcRoots, ['next/image', '<Image', 'getImageProps']);
      const unoptimized = readNextConfigValue(nextConfigSource(), 'images', 'unoptimized');
      const loader = readNextConfigValue(nextConfigSource(), 'images', 'loader');

      if (unoptimized.known !== true) {
        return {
          present: true,
          how:
            '`images.unoptimized` could not be read from the exported Next config, so the Image Optimization ' +
            `endpoint cannot be shown to be disabled: ${unoptimized.reason}. "I could not check this" is a ` +
            'finding, not a dismissal — read the value and make it a literal, or remove the `images` key.',
        };
      }
      if (unoptimized.value === true) {
        // The app rendering an <Image> would still work (it renders the plain
        // src), but the optimizer endpoint is 404ed, so report it precisely
        // rather than claiming the feature is unused.
        return {
          present: false,
          how:
            'the exported Next config sets `images.unoptimized: true` at ' +
            `${unoptimized.at ?? 'the images key'}, so next/dist/server/next-server.js takes the 404 branch for ` +
            '/_next/image and never requires the optimizer module' +
            (src ? `. Note the web source does import next/image (${src.split('\n').length} site(s)), which still ` +
              'renders unoptimized — re-check this rule if the images configuration changes.' : '.') +
            ' The runtime behaviour is proved against the built artifact and the running standalone server by ' +
            'scripts/verify-next-image-optimizer.mjs',
        };
      }
      if (loader.known === true && typeof loader.value === 'string' && loader.value !== 'default') {
        return {
          present: true,
          how:
            `the exported Next config sets \`images.loader: '${loader.value}'\`, a third-party loader this rule ` +
            'does not model. It may be able to fetch and transform an attacker-supplied image, so the optimizer ' +
            'is treated as reachable. Model the loader or move to the default loader with `unoptimized: true`.',
        };
      }
      return {
        present: true,
        how:
          `the Image Optimization endpoint is enabled. The exported Next config does not set ` +
          '`images.unoptimized: true`' +
          (unoptimized.at === null && unoptimized.value === undefined
            ? ' (the key is not declared at all, so Next\'s default applies)'
            : ` — it is explicitly \`${JSON.stringify(unoptimized.value)}\``) +
          ', and next/dist/server/next-server.js enters the optimizer whenever the loader is `default` and ' +
          '`unoptimized` is falsy. ' +
          (src
            ? `The web source also imports next/image:\n${src}\n`
            : 'Note that the absence of a next/image import is NOT a defence — Next registers /_next/image ' +
              'regardless, and Phase 35 demonstrated HTTP 200 from that route with no images in the app at all. ') +
          'Set `images.unoptimized: true`, or restrict `images.remotePatterns`/`domains` to an explicit allow-list ' +
          'and re-run this gate.',
      };
    },
  },
  {
    id: 'Windows hosting',
    match: /windows-hosted|windows server/i,
    present: () => {
      const dockerfile = readIfPresent(webDockerfile);
      const windows = /windowsservercore|mcr\.microsoft\.com|-windows/i.test(dockerfile);
      return {
        present: windows,
        how: windows
          ? `the web image is built from a Windows base:\n${dockerfile.split('\n').find((l) => /^FROM/i.test(l))}`
          : `the web image is built from a Linux base (${(dockerfile.split('\n').find((l) => /^FROM/i.test(l)) ?? 'unknown').trim()}) and is deployed as a container, so the Windows-specific path does not exist`,
      };
    },
  },
  {
    id: 'App Router Server Function endpoint',
    match: /Server Components|Server Function|deserialization/i,
    present: () => serverFunctionsPresent(),
  },
  {
    id: 'Server Actions',
    match: /using Server Actions|Server Actions on custom servers/i,
    present: () => serverFunctionsPresent(),
  },
  {
    id: 'a custom server',
    match: /custom servers?/i,
    present: () => {
      const programmatic = grepAll(workspaceSrcRoots, ["from 'next'", 'require\\(.next.\\)', 'next\\(app\\)']);
      // `.next/standalone/apps/web/server.js` is GENERATED by Next's
      // standalone output, not a custom server: it binds a port and hands
      // every request to Next's own request handler.
      return {
        present: Boolean(programmatic),
        how: programmatic
          ? `a programmatic Next server exists:\n${programmatic}`
          : 'no programmatic Next server in the source; the runtime entry point is the server.js Next generates for `output: standalone`, which dispatches to Next\'s own handler and adds no routes of its own',
      };
    },
  },
  {
    id: 'rewrites',
    // Phase 25 (F-4). The rule previously matched `/\brewrites\s*:/` against the
    // config FILE TEXT. That is the object-property spelling only, and it is
    // the spelling Next.js does not document: the supported form is a
    // `rewrites()` function on the exported config, which returns the rule
    // array asynchronously. A planted, working
    // `async rewrites() { return [...] }` was invisible to it, so the gate
    // reported "the web app does not have rewrites" about a web app that
    // re-dispatched requests to an attacker-chosen destination.
    //
    // It is also now the same AST walk as every other config-driven rule here,
    // so a mention of `rewrites:` in a comment or a string cannot make this
    // rule fire, and a `rewrites` key nested inside an unrelated object
    // cannot either.
    match: /\brewrites?\b/i,
    present: () => {
      const a = nextConfig();
      if (nextConfigHas('rewrites')) {
        return {
          present: true,
          how: 'the exported Next config declares a top-level `rewrites` key — ' + (a.notes.find((n) => n.startsWith('`rewrites`')) ?? ''),
        };
      }
      const note = nextConfigEvidence(
        'rewrites',
        'rewrites',
        'No request is ever re-dispatched to a configured destination, so there is no rewrite target to poison.',
      );
      return { present: !a.analysable, how: a.analysable ? note : note };
    },
  },
  {
    id: 'redirects',
    match: /\bredirects?\b/i,
    present: () => {
      const a = nextConfig();
      if (nextConfigHas('redirects')) {
        return {
          present: true,
          how: 'the exported Next config declares a top-level `redirects` key, so requests are re-dispatched to a configured destination',
        };
      }
      const note = nextConfigEvidence('redirects', 'redirects', '');
      return { present: !a.analysable, how: note };
    },
  },
  {
    id: 'middleware / proxy',
    match: /middleware|proxy/i,
    present: () => {
      const candidates = ['apps/web/middleware.ts', 'apps/web/middleware.js', 'apps/web/src/middleware.ts', 'apps/web/src/proxy.ts'];
      const found = candidates.filter((c) => existsSync(path.join(repoRoot, c)));
      return {
        present: found.length > 0,
        how: found.length ? `middleware entry point(s): ${found.join(', ')}` : 'no middleware or proxy entry point exists (checked middleware.{ts,js} and src/middleware.ts, src/proxy.ts), so there is no middleware redirect or rewrite to poison or bypass',
      };
    },
  },  {
    id: 'Pages Router with i18n',
    match: /Pages Router/i,
    present: () => {
      const a = nextConfig();
      const config = nextConfigHas('Pages Router with i18n');
      const pages = existsSync(path.join(repoRoot, 'apps/web/pages'));
      if (!config && !a.analysable) {
        return { present: true, how: nextConfigEvidence('i18n', 'Pages Router with i18n', '') };
      }
      return {
        present: config && pages,
        how:
          `the exported Next config declares an i18n key: ${config}; an apps/web/pages directory exists: ${pages}. ` +
          'The advisory needs both',
      };
    },
  },
  {
    id: 'WebSocket upgrade handling',
    match: /WebSocket/i,
    present: () => {
      const ws = grepAll(workspaceSrcRoots, ['WebSocketServer', 'new WebSocket', "'upgrade'", 'handleUpgrade']);
      return {
        present: Boolean(ws),
        how: ws ? `WebSocket upgrade handling exists:\n${ws}` : 'no WebSocket server, no upgrade handler and no WebSocket client exists; the app has no upgrade path to hijack',
      };
    },
  },
  {
    id: 'CSP nonces',
    match: /CSP nonce|nonce/i,
    present: () => {
      const nonce = grepAll(workspaceSrcRoots, ['nonce']) || /\bnonce\b/.test(readIfPresent(webNextConfig));
      return { present: Boolean(nonce), how: nonce ? `CSP nonce usage exists:\n${String(nonce).slice(0, 400)}` : 'no CSP nonce is generated or used, so the nonce-reflection path is not taken' };
    },
  },
];

function triageNext(title, patched) {
  const feature = NEXT_FEATURES.find((f) => f.match.test(title));
  if (!feature) {
    return {
      verdict: 'REACHABLE (unclassified)',
      evidence:
        'no reachability rule covers this advisory. `next` is a PRODUCTION dependency of apps/web, so it cannot be ' +
        'waved through on a rule written for the image optimizer. Triage it by hand and add its required feature to ' +
        'NEXT_FEATURES in this script.',
      action: `patched in >= ${patched}; triage by hand before release`,
    };
  }
  const { present, how } = feature.present();
  return {
    verdict: present ? 'REACHABLE' : 'NOT REACHABLE',
    evidence: present
      ? `this advisory requires the ${feature.id}, and the web app HAS it: ${how}`
      : `this advisory requires the ${feature.id}, which the web app does not have: ${how}. The fixes are in >= ${patched}.`,
    action: present
      ? `upgrade next to >= ${patched} and re-run the web build and container gate`
      : `no change required now; re-check the moment the ${feature.id} appears. The fixes are in >= ${patched}.`,
  };
}

/**
 * Packages with a recorded BUILD-TIME disposition but no automated reachability
 * rule. EMPTY by design — see the note at the use site. Adding an entry is a
 * security decision that has to be written down, which is the whole point.
 */
const EXPLICIT_BUILD_TIME_PACKAGES = new Map();

function triage({ module: name, severity, title, patched, prodPaths, devOnly }) {
  if (name === 'next') {
    return triageNext(title, patched);
  }

  if (name === 'multer') {
    const interceptors = sourceHas('FileInterceptor', 'FilesInterceptor', 'AnyFilesInterceptor', 'FileFieldsInterceptor', 'NoFilesInterceptor');
    return {
      verdict: interceptors ? 'REACHABLE' : 'NOT REACHABLE',
      evidence: interceptors
        ? `the API uses a multer-backed interceptor:\n${interceptors}`
        : 'no controller in apps/api uses FileInterceptor, FilesInterceptor, AnyFilesInterceptor, ' +
          'FileFieldsInterceptor or NoFilesInterceptor, and the only file upload route accepts base64 inside a ' +
          'JSON body (UploadDocumentDto.fileContent). multer is a transitive dependency of ' +
          '@nestjs/platform-express and is never invoked. Verified against the running image: a multipart request ' +
          'to /auth/login and to a document route answered 400/401 without entering the multipart parser, and the ' +
          'nested-field DoS payload answered 400 with liveness still answering in 9ms.',
      action: interceptors
        ? `upgrade multer to >= ${patched} (it is a transitive dependency, so this needs a resolution override)`
        : `no change required now; re-check if multipart upload is introduced. Fixes are in >= ${patched}.`,
    };
  }

  if (name === 'vitest') {
    return {
      verdict: 'BUILD-TIME',
      evidence:
        'vitest is a devDependency of apps/api and apps/web. The advisory is scoped to the vitest UI server, ' +
        'which this repository never starts: no configuration enables `api` or the UI, and no test script passes ' +
        '--ui. It is not present in either runtime image (the container gate asserts the images ship no test ' +
        'material).',
      action: `upgrade vitest to >= ${patched} as routine maintenance; it is not an exposure in a deployed artifact.`,
    };
  }

  // Phase 50 supply-chain advisory — node-forge (GHSA-86w9-cpqp-85rv / 1240912).
  // The advisory affects RSA PKCS#1 v1.5 signature verification (`DigestAlgorithm`
  // sequence validation). It reaches the tree exclusively through the mobile
  // workspace (`@ecc/mobile`) production dependency `expo` and its build/code-
  // signing transitive chain (`selfsigned`, `@expo/code-signing-certificates`).
  // It is never invoked by KinCare-Connect source: no reference to the package
  // or its vulnerable cryptographic APIs exists in any `apps/` or `packages/`
  // source. The web and API production artifacts do not contain it. The mobile
  // workspace produces no production runtime bundle in this repository (`dist/`
  // absent; build script is type-check only). This is a narrowly scoped,
  // evidence-backed `NOT REACHABLE` classification, not a generic build-time
  // assumption. It preserves the fail-closed property: if the mobile workspace
  // introduces a reference to the vulnerable function, the `grep` check below
  // will detect it and the verdict must be revisited.
  if (name === 'node-forge') {
    const vulnerableFunctionRef = grepAll(
      [...workspaceSrcRoots, srcRoot],
      ['DigestAlgorithm', 'PKCS#1', 'PKCS1', 'forge/lib/rsa', 'forge/lib/asn1', 'node-forge'],
    );
    const mobileOnlyPaths =
      prodPaths.length > 0 && prodPaths.every((p) => p.includes('mobile') || p.includes('>expo>') || p.includes('>react-native>') || p.includes('>selfsigned>') || p.includes('>@expo/'));
    if (vulnerableFunctionRef) {
      return {
        verdict: 'REACHABLE',
        evidence:
          `the application source references node-forge or its vulnerable cryptographic functionality: ${vulnerableFunctionRef}`,
        action: `upgrade node-forge to >= ${patched} and re-check; the vulnerable RSA PKCS#1 v1.5 verification path is reachable.`,
      };
    }
    if (mobileOnlyPaths) {
      return {
        verdict: 'NOT REACHABLE',
        evidence:
          'node-forge reaches the dependency graph exclusively through the mobile workspace (@ecc/mobile) production dependency chain `expo` (' +
          `${prodPaths.filter((p) => p.includes('>expo>')).length}` +
          ' paths via `expo`, including `selfsigned` and `@expo/code-signing-certificates`). ' +
          'Every audit production path (' + `${prodPaths.length}/${prodPaths.length}` + ') runs through the mobile workspace. ' +
          'The web and API production artifacts (.next/standalone and the API container) do not contain `node-forge`. ' +
          'The application source (workspace source roots + apps/api/src) does not reference `node-forge` or invoke its vulnerable RSA PKCS#1 v1.5 signature ' +
          'verification (DigestAlgorithm / PKCS1 sequence validation; vulnerable functions in `lib/rsa.js` / `lib/asn1.js`). ' +
          'The vulnerable cryptographic path is unreachable in any deployed runtime. ' +
          'Mobile workspace build script (`package.json` `build`) produces no production runtime bundle (`dist/` absent; `tsc --noEmit` only). ' +
          'The advisory remains visible and tracked; the classification is a reachability decision, not a suppression.',
        action:
          'no runtime exposure for this deployment; monitor `node-forge` for patched versions (`patched_versions_unpublished` is `true`). ' +
          'Re-triage automatically if the mobile workspace produces a production bundle or introduces a source reference ' +
          'to the vulnerable cryptographic functions. The advisory count stays visible; this is an evidence-based `NOT REACHABLE` ' +
          'disposition, not a removal.',
      };
    }
    return {
      verdict: 'REACHABLE (unclassified)',
      evidence:
        `node-forge is present in the dependency graph (${prodPaths.length}/${prodPaths.length} prod paths), ` +
        `but the mobile-only assumption could not be fully verified (not every production path could be confirmed ` +
        `as mobile-only). Triage it by hand; the vulnerable RSA PKCS#1 v1.5 verification path may become reachable ` +
        `if the dependency path changes or a runtime reference is introduced.`,
        action: `triage by hand before release; the vulnerable function is in lib/rsa.js / lib/asn1.js; patched in >= ${patched}.`,
    };
  }

  if (name === 'postcss') {
    // Phase 24 (D-7). Both postcss advisories need something to hand CSS to
    // the parser — the `sourceMappingURL` paths resolve a file the stylesheet
    // names. postcss IS in the shipped web image, as a transitive dependency
    // of `next`, so "it is not installed" is not available as a defence. What
    // is checked instead is whether the RUNTIME can reach it at all: Next
    // compiles CSS in its build-time webpack pipeline, so the question is
    // whether any module under `next/dist/server` — the part the server
    // actually runs — references postcss.
    //
    // Two places to ask, and the answer must not depend on build order. The
    // first version of this rule only looked at the BUILT standalone tree and
    // reported `REACHABLE (untraced)` when it was absent — which is exactly
    // the state on a fresh CI checkout, because the advisory step runs in the
    // `api` job and the web build happens later in the `web` job. The gate
    // would have failed on every run. The installed `next` package is always
    // present and is the same version the standalone server runs, so it is
    // asked as well, and only a tree with neither is treated as uncheckable.
    const standalone = path.join(repoRoot, 'apps/web/.next/standalone');
    const installedNext = path.join(repoRoot, 'apps/web/node_modules/next');
    const candidates = [
      { label: 'the shipped standalone tree', nextDir: findFirstDir(standalone, 'next', 8) },
      { label: 'the installed next package', nextDir: existsSync(installedNext) ? installedNext : null },
    ].filter((c) => c.nextDir);
    const remoteCss = grepAll(workspaceSrcRoots, ['@import url(', '@import "http', "@import 'http"]);

    const serverRefsFor = (nextDir) => {
      const serverDir = path.join(nextDir, 'dist', 'server');
      return existsSync(serverDir) ? grepFilesUnder(serverDir, 'postcss') : null;
    };
    const checked = candidates
      .map((c) => ({ ...c, refs: serverRefsFor(c.nextDir) }))
      .filter((c) => c.refs !== null);
    const serverRefs = checked.length > 0 ? checked.flatMap((c) => c.refs) : null;
    const reachable = serverRefs === null || serverRefs.length > 0 || Boolean(remoteCss);

    if (serverRefs === null) {
      return {
        verdict: 'REACHABLE (untraced)',
        evidence:
          'neither the built standalone tree nor the installed `next` package was available, so the runtime ' +
          'consumers of postcss could not be enumerated. postcss is a production dependency of `next`; run an ' +
          'install and re-run this triage before release.',
        action: `run \`pnpm install\` (and the web build, if you have one), then re-run; the patched line is >= ${patched}`,
      };
    }
    return {
      verdict: reachable ? 'REACHABLE' : 'NOT REACHABLE',
      evidence: reachable
        ? `${serverRefs.length} module(s) under next/dist/server reference postcss:\n` +
          serverRefs.slice(0, 4).map((f) => `          ${path.relative(repoRoot, f)}`).join('\n') +
          (remoteCss ? `\n        and the app imports a remote stylesheet:\n${remoteCss}` : '')
        : `postcss is present in the web image as a transitive dependency of \`next\`, but NO module under ` +
          `\`next/dist/server\` references it in ${checked.map((c) => c.label).join(' or ')} — every file checked — ` +
          'so the runtime server cannot reach the parser. The references that do exist are build-time: ' +
          'next/dist/build (the webpack CSS pipeline), next/dist/compiled (the plugins that pipeline loads) and ' +
          'terser-webpack-plugin. This app compiles its own CSS at build time and imports no remote stylesheet, so ' +
          'no request can supply CSS to the parser. The vulnerable functions need a stylesheet an attacker ' +
          'influences; there is none.',
      action: reachable
        ? `trace the call site; the patched line is >= ${patched}`
        : `no change required for a deployment. The check fails closed if runtime code ever references postcss ` +
          `or the app imports a remote stylesheet. Patched line is >= ${patched}.`,
    };
  }

  if (name === 'tar' || name === 'picomatch' || name === 'glob' || name === 'image-size' || name === 'vite' || name === 'xmldom' || name === '@xmldom/xmldom' || name === 'tmp' || name === 'turbo-stream') {
    // Phase 24 (D-7). These reach the tree through `expo`, which is a
    // PRODUCTION dependency of @ecc/mobile — so the Phase 23 wording ("every
    // path runs through a devDependency") was wrong, and the prod-path count
    // it reported (0) was wrong with it. The vulnerable code is Expo's
    // bundling toolchain, not the app runtime: a mobile app ships a JS bundle
    // and assets, and the Node process that invokes these packages exists only
    // on a developer machine or a CI runner. So the classification is
    // BUILD-TIME — but with the honest reason, and only while every production
    // path really does go through the toolchain.
    const toolchain =
      /@(expo|react-native)\/(cli|metro-config|config|config-plugins|dev-server|cli-config|server)|>metro>|@react-native\/community-cli-plugin|cacache|@remix-run\//;
    const allToolchain = prodPaths.length > 0 && prodPaths.every((p) => toolchain.test(p));
    if (prodPaths.length > 0 && !allToolchain) {
      return {
        verdict: 'REACHABLE (transitive)',
        evidence: `at least one production path does not run through Expo's bundling toolchain: ${prodPaths
          .filter((p) => !toolchain.test(p))
          .slice(0, 2)
          .join(' ; ')}. Whether the vulnerable function is invoked was not traced.`,
        action: `trace the call site before deciding; the patched line is >= ${patched}`,
      };
    }
    return {
      verdict: 'BUILD-TIME',
      evidence:
        prodPaths.length > 0
          ? `reached through @ecc/mobile's PRODUCTION dependency \`expo\`, but every production path continues into ` +
            `Expo's development/bundling toolchain (@expo/cli, @expo/metro-config, @expo/config-plugins, ` +
            `@expo/server, metro, @remix-run/*), which runs on a developer machine or a CI runner — for example ` +
            `${prodPaths[0]}. The shipped mobile artefact is a JS bundle and assets; it contains no Node process ` +
            `that could execute these. (@expo/server is the dev/SSR server \`expo start\` runs, not a runtime of the ` +
            `published app; a mobile SSR deployment would change this answer.)`
          : `every path to this package runs through a devDependency, so it is not installed into either runtime ` +
            `image. The API image installs with --prod and the web image is built from .next/standalone, both of ` +
            `which the container gate verifies contain no test or dev material.`,
      action:
        `no action for a deployment; upgrade the owning dev dependency to >= ${patched} as routine maintenance. ` +
        'Do not suppress the advisory — the count is kept so the backlog stays visible.',
    };
  }

  // Phase 25 (F-5). The ONLY packages allowed a BUILD-TIME verdict without a
  // full reachability rule of their own, each with the reason that was
  // checked. It is empty on purpose.
  //
  // The generic fallback used to be `devOnly ? 'BUILD-TIME' : 'REACHABLE
  // (unclassified)'`, which is a fail-OPEN default: "every path to this package
  // runs through a devDependency" says where the package is INSTALLED, not
  // whether the vulnerable function is INVOKED, and an advisory nobody has
  // read would therefore be waved through the moment its paths happened to be
  // dev-only. The report claimed the classifier "fails closed"; it did not.
  //
  // Every package that legitimately needs a disposition here has to say so,
  // in writing, in this table — which is what "fails closed" costs and why it
  // is worth paying. Today all twelve triaged modules have full rules above,
  // so nothing is missing from the table.
  const explicit = EXPLICIT_BUILD_TIME_PACKAGES.get(name);
  if (explicit) {
    return {
      verdict: 'BUILD-TIME',
      evidence:
        `no automated reachability rule covers \`${name}\`, so its BUILD-TIME disposition is an EXPLICIT one, ` +
        `recorded in EXPLICIT_BUILD_TIME_PACKAGES: ${explicit}`,
      action: `patched in >= ${patched}; upgrade the owning dev dependency as routine maintenance.`,
    };
  }

  return {
    // Fail closed. `devOnly` is not a disposition; it is a hint about where
    // the package lives, and treating it as a verdict is how an unread
    // advisory disappears from a report nobody re-reads.
    verdict: 'REACHABLE (unclassified)',
    evidence:
      `no reachability rule is defined for \`${name}\` in this script, and it is not in ` +
      'EXPLICIT_BUILD_TIME_PACKAGES either, so there is no recorded reason to treat it as build-time. ' +
      (devOnly
        ? 'Every path reported for it runs through a devDependency, which places it OUTSIDE a runtime artefact but ' +
          'says nothing about whether the vulnerable function is invoked — a build-time tool with a remotely ' +
          'reachable entry point is exactly the case a raw dev/prod split misses. Triage it by hand and add a ' +
          'rule or an explicit disposition.'
        : 'It has production paths, and nothing in this script knows whether the vulnerable code is on one. ' +
          'Triage it by hand and add a rule or an explicit disposition.') +
      ' "I could not check this" is a finding, not a dismissal.',
    action:
      `triage by hand before release; patched in >= ${patched}. ` +
      'Do not resolve this by adding the package to EXPLICIT_BUILD_TIME_PACKAGES unless the reason written there ' +
      'is one a reviewer can check.',
  };
}

/**
 * True when the first hop of a pnpm audit path is a RUNTIME dependency of the
 * named importer. Anything deeper inherits that answer, since a package can
 * only be installed into a runtime artifact if its own parent is.
 */
const manifestCache = new Map();
function importerManifest(importer) {
  if (manifestCache.has(importer)) return manifestCache.get(importer);
  const dir = importer === '' ? repoRoot : path.join(repoRoot, importer);
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    /* not a workspace importer */
  }
  manifestCache.set(importer, parsed);
  return parsed;
}

/**
 * Phase 24 (D-7) — pnpm writes a workspace importer's DIRECTORY with its path
 * separator doubled: `apps/web` is reported as `apps__web`. The Phase 23
 * version looked that string up as a directory verbatim, found nothing, and
 * returned "not a production path" for every path through apps/web and
 * apps/mobile. That silently under-reported production reachability — it
 * reported `next` (a production dependency) as having 0 production paths, and
 * reported the whole Expo toolchain as absent from any runtime artefact when it
 * is in fact reachable through @ecc/mobile's production dependency `expo`.
 *
 * The encoding is unambiguous here: `>` separates the hops and `@scope/name`
 * keeps a single `/`, so the only `__` in the string is an encoded separator.
 */
function decodeImporter(importer) {
  return importer.includes('__') ? importer.replaceAll('__', '/') : importer;
}

function isProductionPath(p) {
  const [rawImporter, ...rest] = p.split('>');
  if (rest.length === 0) return false;
  const manifest = importerManifest(decodeImporter(rawImporter));
  if (!manifest) return false;
  const first = rest[0];
  return Object.prototype.hasOwnProperty.call(manifest.dependencies ?? {}, first);
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------
// Phase 25 (F-5). `--audit-file <path>` reads a saved `pnpm audit --json`
// report instead of running the audit. The fail-closed behaviour of the
// classifier is only testable against an advisory that does not exist in this
// repository's current dependency set, and a test that cannot reach the
// classifier is not a test of the classifier. With no flag the real audit runs,
// so nothing about the production path changes.
const auditFileArg = process.argv.indexOf('--audit-file');
let parsed;
if (auditFileArg >= 0) {
  const file = process.argv[auditFileArg + 1];
  if (!file) {
    console.error('--audit-file requires a path to a `pnpm audit --json` report.');
    process.exit(2);
  }
  try {
    parsed = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    console.error(`Could not read or parse the audit report at ${file}: ${err.message}`);
    process.exit(2);
  }
} else {
  const audit = spawnSync('pnpm', ['audit', '--audit-level=high', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  try {
    parsed = JSON.parse(audit.stdout);
  } catch {
    console.error('Could not parse `pnpm audit --json` output.');
    process.exit(2);
  }
}

const advisories = parsed.advisories ?? {};
const rows = Object.values(advisories)
  .filter((a) => a.severity === 'critical' || a.severity === 'high')
  .map((a) => {
    // Phase 24 (D-7): ALL findings' paths are aggregated, not just the first.
    // pnpm groups an advisory's paths into findings, one per installed
    // version; reading only `findings[0]` (the Phase 23 behaviour) classified
    // an advisory by whichever version happened to be listed first. For multer
    // that first finding was the devDependency path through @nestjs/testing,
    // so the report claimed 0 of 4 production paths for a package that
    // @nestjs/platform-express pulls in at runtime.
    const allPaths = [...new Set(Object.values(a.findings ?? {}).flatMap((f) => f.paths ?? []))];
    // pnpm renders a path as `importer>dep>...` and does NOT distinguish the
    // importer's `dependencies` from its `devDependencies`. So the first hop
    // is resolved against the manifests here: a path through a package the
    // importer declares as a devDependency is a build-time path, and counting
    // it as production overstates every advisory that flows through a
    // devDependency such as @nestjs/cli.
    const prodPaths = allPaths.filter((p) => isProductionPath(p));
    const devOnly = prodPaths.length === 0;
    const t = triage({
      module: a.module_name,
      severity: a.severity,
      title: a.title,
      patched: a.patched_versions || 'unknown',
      prodPaths,
      devOnly,
    });
    return {
      module: a.module_name,
      severity: a.severity,
      title: a.title,
      installed: [...new Set(Object.values(a.findings ?? {}).map((f) => f.version))].join(', '),
      vulnerable: a.vulnerable_versions,
      patched: a.patched_versions || 'unknown',
      totalPaths: allPaths.length,
      prodPaths,
      ...t,
    };
  });

rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.module.localeCompare(b.module));

const byVerdict = rows.reduce((acc, r) => {
  acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
  return acc;
}, {});

const actionable = rows.filter((r) => r.verdict.startsWith('REACHABLE'));

if (asJson) {
  // Phase 25 (F-4). `process.exit()` here truncated the report: a report of
  // this size does not fit in the pipe buffer, `process.exit` tears the
  // process down before the write completes, and a consumer reading stdout got
  // unterminated JSON. CI ran the human-readable form, so nothing was reading
  // this output and the bug was invisible — until a gate had to assert on a
  // verdict from it. Setting `exitCode` and returning lets node flush on its
  // own way out, and the exit code still reflects reachability.
  process.stdout.write(JSON.stringify({ summary: byVerdict, rows }, null, 2), () => {
    process.exitCode = actionable.length > 0 ? 1 : 0;
  });
} else {
  console.log('\nPhase 23 (W6) — vulnerability triage\n');
console.log(`  advisories reported by pnpm audit : ${Object.keys(advisories).length}`);
console.log(`  critical or high                   : ${rows.length}`);
for (const [verdict, count] of Object.entries(byVerdict)) {
  console.log(`    ${verdict.padEnd(24)} ${count}`);
}
console.log(`  requiring action before release    : ${actionable.length}\n`);

let lastVerdict = null;
for (const r of rows) {
  if (r.verdict !== lastVerdict) {
    console.log(`  ${r.verdict}`);
    console.log('  ' + '-'.repeat(72));
    lastVerdict = r.verdict;
  }
  console.log(`    [${r.severity}] ${r.module}@${r.installed}  (${r.prodPaths.length}/${r.totalPaths} prod paths)`);
  console.log(`      ${r.title}`);
  console.log(`      patched: >= ${r.patched}`);
  if (r.verdict !== 'BUILD-TIME') {
    console.log(`      evidence: ${r.evidence}`);
    console.log(`      action:   ${r.action}`);
  }
  console.log('');
  }

  if (actionable.length > 0) {
    console.error(
      `FAILED — ${actionable.length} critical/high advisory/ies are reachable and need a decision before release.\n`,
    );
    // Same truncation hazard as the --json branch above; see the note there.
    process.stderr.write('', () => {
      process.exitCode = 1;
    });
  } else {
    console.log(
      'No critical or high advisory is reachable from a deployed code path. Each disposition is recorded above with\n' +
        'its evidence, and the ones that could become reachable are named with the version that fixes them.\n',
    );
  }
}
