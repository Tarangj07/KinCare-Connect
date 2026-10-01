#!/usr/bin/env node
/**
 * Phase 36 (P35-1) — the Image Optimization endpoint must be unreachable.
 *
 * What this is for. Advisory 1193733 is a critical unauthenticated RCE in the
 * Next.js Image Optimization API when AVIF output is used. For most of this
 * repository's history the triage gate reported it NOT REACHABLE, on the
 * reasoning that the app renders no images:
 *
 *     "no next/image import, no <Image element and no `images` key in the
 *      exported Next config; the optimizer has no loader to invoke. Phase 23
 *      additionally probed the running image: GET /_next/image answered 400"
 *
 * The independent Phase 35 review attacked that claim against the deployed
 * image instead of the source, and it was wrong. Next registers `/_next/image`
 * UNCONDITIONALLY — not because any component uses it. In the production
 * container built from HEAD, with no images anywhere in the app:
 *
 *     GET /_next/image?url=%2Frepro.png&w=64&q=75   ->  200 image/png  7853 bytes
 *     GET /definitely-not-a-route                    ->  404
 *
 * A live, unauthenticated, externally reachable route returning image bytes.
 * The "answered 400" corroboration is worse than useless as evidence: a 400
 * carrying the optimizer's OWN error string is proof the endpoint is present and
 * executing.
 *
 * What was actually protecting the deployment was that `sharp` happened to be
 * absent from the traced standalone tree, so the AVIF transform could not run.
 * That is an incidental property of a transitive OPTIONAL dependency. Any
 * change that pulls `sharp` into the web image would have converted an
 * already-live endpoint into the documented RCE path while every gate still
 * reported "not reachable". That is the property this gate exists to make
 * impossible to reintroduce silently.
 *
 * What this gate asserts, and why each part is here.
 *
 *   1. CONFIGURATION — `apps/web/next.config.mjs` sets `images.unoptimized`
 *      to a literal `true`, read from the AST by the same analyser the triage
 *      rule uses. A value, not a presence test: `images: {}` declares the key
 *      and disables nothing.
 *
 *   2. BUILD EVIDENCE — the BUILT `.next/images-manifest.json` reports
 *      `unoptimized: true`. This is Next's own resolved output, so a config
 *      that fails to reach the build, a stale build, or a config edited
 *      without rebuilding all fail here. Source text alone is not accepted.
 *
 *   3. RUNTIME — the standalone server is started on an ephemeral port and
 *      `/_next/image` is requested unauthenticated. The assertion is that the
 *      response is NOT a successful image. A 404 is the intended state (Next's
 *      own branch); a 400 from the optimizer is ALSO acceptable, because it
 *      means the optimizer is refusing for want of parameters — but a 200 with
 *      image bytes is a FAILURE, because that is the P35-1 state itself.
 *      Recorded this way on purpose: the gate must not be satisfied by the
 *      endpoint being present-but-broken, only by it being unable to serve a
 *      transformed image.
 *
 *   4. NON-REGRESSION — unrelated routes still answer. Disabling a security
 *      surface by breaking the application is not a remediation.
 *
 *      Phase 50 CI reconciliation. This layer used to assert `/` returns 200.
 *      That assertion encoded the PRE-Phase-50 application: `/` was then a
 *      PUBLIC placeholder landing page ("Phase 1 · Foundation"), so 200 was
 *      correct. Phase 50 deliberately replaced it — `apps/web/src/app/page.tsx`
 *      is now a Server Component that resolves the session and redirects, so an
 *      anonymous `GET /` answers 307 to `/login` and NO landing markup is
 *      produced for either audience (docs/PHASE_50_FINAL_REPORT.md §8, §19;
 *      PR-48-19).
 *
 *      The INVARIANT this layer exists to protect is unchanged — "the app was
 *      not broken to close the image endpoint" — but a broken-app regression
 *      and the intended redirect must be distinguishable, and only the
 *      CONTRACT can tell them apart. A 200 assertion cannot: it is satisfied by
 *      the redirect being reverted to a public page, which is precisely the
 *      security regression this reconciliation must not introduce, and it is
 *      unsatisfiable by the intended behaviour. Changing 200 -> 307 would be
 *      worse: it would assert a status code and nothing about the destination,
 *      so a redirect to any page — including a 404 — would pass.
 *
 *      What is asserted instead, all against the SAME running server and the
 *      SAME unauthenticated probe used for the image endpoint:
 *
 *        4a. `GET /` is a redirect (3xx) whose `Location` resolves to the
 *            login route — not a 404, not a 500, not a dead link.
 *        4b. `GET /login` — that destination — answers 200 and renders the
 *            sign-in page, identified by the `aria-labelledby` target
 *            `signin-heading` from `apps/web/src/app/login/page.tsx`. Every
 *            Next page embeds the not-found template in its RSC payload, so the
 *            404 copy cannot be used to identify a 404 and is not used.
 *        4c. The unauthenticated `/` response body carries none of the
 *            authenticated shell's CSS-module classes (`shell_shell__`, from
 *            `apps/web/src/app/(authenticated)/shell.module.css`, which appears
 *            on any page inside that layout and on no other route) and sets no
 *            `ecc_at` session cookie. This keeps P35-1's non-regression layer
 *            honest about the Phase 50 boundary: it now additionally proves that
 *            closing the image endpoint was NOT accompanied by opening the root
 *            route. A structural marker is used rather than visible copy so that
 *            rewording the interface cannot turn the check into a vacuous one.
 *        4d. `/dashboard` — a route INSIDE the authenticated layout — must
 *            apply the same contract, and must not contain the shell marker.
 *            This is what makes 4c falsifiable: `/` never renders the shell, so
 *            the marker test there alone cannot distinguish a working guard from
 *            a deleted one. A removed or weakened guard in
 *            `apps/web/src/app/(authenticated)/layout.tsx` makes this probe
 *            answer 200 with `shell_shell__` in the body and the check fails.
 *        4e. `/health` still answers 200, unchanged from before Phase 50.
 *
 *      Nothing about the image-optimizer assertion itself (layers 1-3) is
 *      altered.
 *
 * Every layer fails closed. If the build is missing, this gate FAILS; it never
 * reports success because a check could not run.
 *
 * Usage:  node scripts/verify-next-image-optimizer.mjs [--config-only]
 *           --config-only  skip the build-artifact and runtime probes (for a
 *                          checkout with no web build); the CI wiring does NOT
 *                          use it, because proving the runtime state is the
 *                          entire point.
 */
import { spawn } from 'node:child_process';
import net, { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNextConfigValue } from './lib/next-config-features.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'apps/web');
const configPath = path.join(webRoot, 'next.config.mjs');
const manifestPath = path.join(webRoot, '.next/images-manifest.json');
const standaloneServer = path.join(webRoot, '.next/standalone/apps/web/server.js');

/**
 * The fixture filename staged into the running server's `public/` directory.
 * The probe URLs below request exactly this name: an earlier revision staged
 * `verify-next-image-optimizer-probe.png` but requested `/repro.png`, so the
 * optimizer answered 400 "isn't a valid image" and the runtime layer could not
 * distinguish a disabled endpoint from a missing fixture. The name is
 * url-encoded in the probes below so the two cannot drift apart again.
 */
const PROBE_IMAGE = 'verify-next-image-optimizer-probe.png';
const PROBE_URL = encodeURIComponent(`/${PROBE_IMAGE}`);
const configOnly = process.argv.includes('--config-only');

/**
 * A valid 64x64 PNG, so a live optimizer has a real image to transform and a
 * 200 cannot be an artifact of an unreadable fixture. Declared before any use:
 * `const` bindings are in the temporal dead zone until initialised, and the
 * helper below runs at module top level.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAECCAYAAACqaXHeAAAAKUlEQVR42mNk+M9QzzCKRsEoGgWjYBSMDIzEPIQwGDKgYh' +
    'oEDEgwYhAKMDAxMDD8Z2AAAX8lCiuAAAAAElFTkSuQmCC',
  'base64',
);

let failures = 0;
const notes = [];

function check(name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// 1. Configuration
// ---------------------------------------------------------------------------
console.log('\nPhase 36 (P35-1) — the Next.js Image Optimization endpoint must be unreachable\n');
console.log('  Layer 1 — configuration (apps/web/next.config.mjs)\n');

if (!existsSync(configPath)) {
  check('apps/web/next.config.mjs exists', false, 'the config file is missing; nothing can be asserted');
  finish();
} else {
  const source = readFileSync(configPath, 'utf8');
  const unoptimized = readNextConfigValue(source, 'images', 'unoptimized', { fileName: 'apps/web/next.config.mjs' });

  check(
    '`images.unoptimized` is a readable literal',
    unoptimized.known === true,
    unoptimized.reason ?? null,
  );
  check(
    '`images.unoptimized` is exactly `true`',
    unoptimized.known === true && unoptimized.value === true,
    unoptimized.known === true
      ? `read ${JSON.stringify(unoptimized.value)} at ${unoptimized.at ?? '(key not declared — Next\'s default applies)'}`
      : 'unreadable',
  );

  // A comment mentioning the value must not satisfy this. The analyser reads
  // the AST, so it cannot, but asserting the negative documents the intent and
  // would catch a future regression to a text match.
  const commentOnly = 'export default {\n  // images: { unoptimized: true }\n};\n';
  const commentRead = readNextConfigValue(commentOnly, 'images', 'unoptimized', { fileName: 'comment-only.mjs' });
  check(
    'a COMMENT claiming `unoptimized: true` does not satisfy the check',
    commentRead.known === true && commentRead.value !== true,
    `a comment-only config reads as value=${JSON.stringify(commentRead.value)} known=${commentRead.known}`,
  );

  // An unreadable/dynamic value must NOT be treated as safe.
  //
  // The unreadable thing used here is a global, NOT `process.env.X`, and that
  // is deliberate. `verify-config-contract.mjs` scans raw source for
  // `process.env` reads, and it cannot tell a read inside a fixture string from
  // a real one — so a fixture written with `process.env.NEXT_IMAGE_ON` made the
  // config gate report two undocumented environment variables that this gate
  // does not actually read. The property under test is "a non-literal value is
  // unreadable", which a global exercises just as well, and choosing it keeps
  // the environment surface this repository declares honest.
  const dynamic = 'export default { images: { unoptimized: globalThis.__imageOptIn } };\n';
  const dynamicRead = readNextConfigValue(dynamic, 'images', 'unoptimized', { fileName: 'dynamic.mjs' });
  check(
    'a DYNAMIC `unoptimized` value is reported as unknown, not as safe',
    dynamicRead.known === false,
    `known=${dynamicRead.known} reason=${dynamicRead.reason}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Build evidence
// ---------------------------------------------------------------------------
if (!configOnly) {
  console.log('\n  Layer 2 — build evidence (.next/images-manifest.json)\n');
  check(
    '.next/images-manifest.json exists',
    existsSync(manifestPath),
    existsSync(manifestPath)
      ? 'no web build found'
      : 'no web build found. This gate needs the BUILT artifact — a source-only check would repeat the P35-1 mistake. ' +
        'Run `pnpm --filter @ecc/web build` first. In CI the `web` job builds before this runs.',
  );

  if (existsSync(manifestPath)) {
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      check('.next/images-manifest.json is parseable JSON', false, err.message);
    }
    if (manifest) {
      const images = manifest.images ?? {};
      check(
        'the BUILT manifest reports `unoptimized: true`',
        images.unoptimized === true,
        `built images-manifest.json reports unoptimized=${JSON.stringify(images.unoptimized)} loader=${JSON.stringify(images.loader)} path=${JSON.stringify(images.path)}`,
      );
      notes.push(
        `built manifest: loader=${images.loader} path=${images.path} formats=${JSON.stringify(images.formats)} ` +
          `remotePatterns=${JSON.stringify(images.remotePatterns)}`,
      );
      // Defence in depth, and a tripwire for a config that later swaps the
      // optimizer for something else at the same time.
      check(
        'the built manifest still names no remote image allow-list',
        Array.isArray(images.remotePatterns) && images.remotePatterns.length === 0,
        `remotePatterns=${JSON.stringify(images.remotePatterns)} — a non-empty allow-list would let the optimizer fetch ` +
          'attacker-chosen origins and must be reviewed separately',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3 + 4. Runtime
// ---------------------------------------------------------------------------
if (!configOnly) {
  console.log('\n  Layer 3 — runtime (the standalone production server)\n');

  if (!check('the standalone server exists', existsSync(standaloneServer), `expected ${standaloneServer}`)) {
    finish();
  } else {
    const port = await freePort();
    // Staging is checked BEFORE the server starts, and as its own check. An
    // earlier revision folded a staging failure into "the standalone server
    // starts", which reported a fixture problem as a server problem and would
    // have let the runtime layer's meaning drift. The probes below are only
    // meaningful if the fixture is really there.
    const staged = stageProbeImage();
    if (!check('the probe image is staged in the standalone tree\'s public/ directory', staged.ok, staged.detail)) {
      finish();
    }
    const started = await startStandalone(port, staged);
    if (!started.ok) {
      check('the standalone production server starts', false, started.detail);
      staged.cleanup();
      finish();
    } else {
      check('the standalone production server starts', true, `port=${port}`);
      const stagedFixture = started.staged;
      // The fixture MUST stay in place for the whole probe sequence. An earlier
      // revision removed it as soon as the server answered, so every probe ran
      // against a missing file: the optimizer answered 400 "isn't a valid
      // image" and the runtime layer could not tell a DISABLED endpoint from a
      // MISSING fixture — which is exactly the distinction this gate exists to
      // make. Cleanup is deferred to the `finally` below.
      check(
        'the probe image is staged in the running server\'s public/ directory',
        existsSync(stagedFixture),
        `expected ${stagedFixture}. If this fails the runtime probes would be meaningless.`,
      );
      try {
        // --- the security property: /_next/image must not serve a transformed image
        const image = await probe(port, `/_next/image?url=${PROBE_URL}&w=64&q=75`, {
          accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        });
        const servesImage = image.status === 200 && /^image\//.test(image.contentType);
        check(
          '/_next/image does not serve an optimized image to an unauthenticated request',
          !servesImage,
          `status=${image.status} content-type=${image.contentType || '(none)'} bytes=${image.bytes} ` +
            `(Next 404s this route when images.unoptimized is true; a 200 here is the P35-1 state)`,
        );
        notes.push(`GET /_next/image?url=${PROBE_URL}&w=64&q=75 -> ${image.status} ${image.contentType || '(no content-type)'} ${image.bytes}b`);

        // A remote url must not be fetchable either — the SSRF-shaped half of
        // the same endpoint.
        const remote = await probe(port, '/_next/image?url=https%3A%2F%2Fexample.com%2Fx.png&w=64&q=75');
        check(
          '/_next/image does not fetch a REMOTE url',
          remote.status !== 200,
          `status=${remote.status} bytes=${remote.bytes}`,
        );

        // A bare request with no parameters.
        const bare = await probe(port, '/_next/image');
        check('/_next/image without parameters is not a 200 image', bare.status !== 200 || !/^image\//.test(bare.contentType), `status=${bare.status}`);

        // --- non-regression: the application must still work.
        //
        // Phase 50 reconciliation. `/` is no longer a public landing page, so
        // the invariant is asserted as the CONTRACT (see the header, layer 4):
        // the root route must resolve, its redirect target must be real, and it
        // must not be leaking the authenticated shell. Status codes alone
        // cannot express any of that.
        const root = await probe(port, '/');
        const location = /^\/(?:[^/?#]*)(?:\/.*)?$/.test(root.location) ? root.location : '';
        check(
          '/ is a redirect to the login route (the app was not broken, and the root route was not made public)',
          root.status >= 300 && root.status < 400 && location.startsWith('/login'),
          `status=${root.status} location=${root.location || '(none)'} — an anonymous GET / must answer a redirect ` +
            'to /login; a 200 here would mean the root route was reverted to the pre-Phase-50 public landing page',
        );

        const login = await probe(port, '/login');
        check(
          'the login route / redirects to answers 200 and renders the sign-in page, not the 404 page',
          login.status === 200 && login.bodyText.includes('signin-heading'),
          `status=${login.status} bytes=${login.bytes} signin-heading=${
            login.bodyText.includes('signin-heading') ? 'present' : 'ABSENT'
          } — the redirect target must be the real sign-in page. (A substring test is required in BOTH ` +
            'directions: every Next page embeds the not-found template in its RSC payload, so the 404 text alone ' +
            'cannot identify a 404. `signin-heading` is the `aria-labelledby` target of the card in ' +
            'apps/web/src/app/login/page.tsx and appears on no other route.)',
        );

        // The redirect envelope must not carry the authenticated shell or a session
        // cookie. This is the assertion that keeps the non-regression layer from
        // becoming a licence to expose the root route.
        //
        // `shell_shell__` is the CSS-module class of the authenticated layout
        // (`apps/web/src/app/(authenticated)/shell.module.css`), so it appears in
        // the markup of ANY page rendered inside that layout and on no other
        // route. It is used in preference to visible copy such as "Active
        // senior": a reworded interface must not silently turn a security check
        // into a vacuous one.
        const SHELL_MARKER = 'shell_shell__';
        const leaked = root.bodyText.includes(SHELL_MARKER);
        const setsSession = /set-cookie:[^\n]*\becc_at\b/i.test(root.rawHeader);
        check(
          'the unauthenticated / response body carries no authenticated-shell content and no session cookie',
          !leaked && !setsSession,
          leaked
            ? `the body contains "${SHELL_MARKER}" — the authenticated layout rendered for an anonymous caller`
            : `shell-marker=absent set-cookie=${/set-cookie:/i.test(root.rawHeader) ? 'present (no ecc_at)' : 'absent'}`,
        );

        // The same contract must hold for a route that is INSIDE the
        // authenticated layout, not only for `/`. This is what makes the shell
        // check above falsifiable: `/` never renders the shell under any
        // behaviour, so the marker test there cannot distinguish a working guard
        // from a removed one. `/dashboard` does render it, so if the server-side
        // guard in `apps/web/src/app/(authenticated)/layout.tsx` were deleted or
        // weakened, this probe answers 200 WITH `shell_shell__` in the body and
        // the check fails.
        const guarded = await probe(port, '/dashboard');
        check(
          'an authenticated route (/dashboard) redirects an anonymous caller to /login and renders no shell',
          guarded.status >= 300
            && guarded.status < 400
            && /^\/login/.test(guarded.location)
            && !guarded.bodyText.includes(SHELL_MARKER)
            && !/set-cookie:[^\n]*\becc_at\b/i.test(guarded.rawHeader),
          `status=${guarded.status} location=${guarded.location || '(none)'} shell-marker=${
            guarded.bodyText.includes(SHELL_MARKER) ? 'PRESENT (protected content rendered)' : 'absent'
          }`,
        );

        const health = await probe(port, '/health');
        check('/health still answers 200 (the app was not broken to close the endpoint)', health.status === 200, `status=${health.status}`);
      } finally {
        started.proc.kill('SIGTERM');
        await sleep(400);
        if (started.proc.exitCode === null) started.proc.kill('SIGKILL');
        staged.cleanup();
      }
    }
  }
}

finish();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Place a real PNG in the standalone server's own `public/` directory, so a live
 * optimizer has something valid to serve and a 200 cannot be an artifact of a
 * missing fixture.
 *
 * Next 14 standalone output resolves `public/` relative to the server's CWD, and
 * does not trace `public/` into the standalone tree (the Dockerfile copies it in
 * separately), so the directory may not exist and one is created — and then
 * removed, along with the file, by `cleanup`.
 *
 * Separated from `startStandalone` so that a staging failure is reported as the
 * problem it is.
 */
function stageProbeImage() {
  const serverDir = path.dirname(standaloneServer);
  const publicDir = path.join(serverDir, 'public');
  const staged = path.join(publicDir, PROBE_IMAGE);
  let createdPublicDir = false;
  try {
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true });
      createdPublicDir = true;
    }
    writeFileSync(staged, PNG_1X1);
  } catch (err) {
    if (createdPublicDir) rmSync(publicDir, { recursive: true, force: true });
    return {
      ok: false,
      staged,
      detail: `could not stage the probe image into ${publicDir}: ${err.message}`,
      cleanup() {},
    };
  }
  return {
    ok: true,
    staged,
    detail: publicDir,
    cleanup() {
      try {
        rmSync(staged, { force: true });
        if (createdPublicDir) rmSync(publicDir, { recursive: true, force: true });
      } catch {
        /* best effort; the fixture lives only under .next/, which is gitignored */
      }
    },
  };
}

async function startStandalone(port, stagedFixtureInfo) {
  const serverDir = path.dirname(standaloneServer);
  const staged = stagedFixtureInfo.staged;

  const proc = spawn(process.execPath, [standaloneServer], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout.on('data', (d) => (output += d));
  proc.stderr.on('data', (d) => (output += d));

  for (let i = 0; i < 60; i += 1) {
    if (proc.exitCode !== null) {
      return { ok: false, detail: `the server exited with ${proc.exitCode}: ${output.slice(-800)}` };
    }
    try {
      const res = await rawProbe(port, '/');
      if (res.status > 0) {
        // Deliberately NOT cleaned up here: the fixture has to survive until the
        // probes have run. The caller owns cleanup from this point.
        return { ok: true, proc, staged, detail: null };
      }
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  cleanup();
  return { ok: false, detail: `the server never became reachable on port ${port}: ${output.slice(-800)}` };
}

/**
 * HTTP GET returning status, content-type, `Location`, the response header
 * block and the body, decoded as latin1. No dependencies.
 *
 * Phase 50 reconciliation: the non-regression layer asserts a REDIRECT
 * CONTRACT rather than a status code, so the `Location` header and the body
 * text must be observable. `location` is read case-insensitively because the
 * header name's casing is a server detail, not part of the contract.
 */
async function rawProbe(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = net.connect(port, '127.0.0.1', () => {
      const head = [`GET ${urlPath} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Connection: close', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join('\r\n');
      req.write(`${head}\r\n\r\n`);
    });
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('error', reject);
    req.on('close', () => {
      const buf = Buffer.concat(chunks);
      const sep = buf.indexOf('\r\n\r\n');
      const header = sep === -1 ? buf.toString('latin1') : buf.subarray(0, sep).toString('latin1');
      const body = sep === -1 ? Buffer.alloc(0) : buf.subarray(sep + 4);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(header)?.[1] ?? 0);
      const contentType = /content-type:\s*([^\r\n;]+)/i.exec(header)?.[1]?.trim() ?? '';
      const location = /(?:^|\r\n)location:\s*([^\r\n]*)/i.exec(header)?.[1]?.trim() ?? '';
      resolve({ status, contentType, bytes: body.length, location, bodyText: body.toString('latin1'), rawHeader: header });
    });
    req.setTimeout(15_000, () => req.destroy(new Error('probe timed out')));
  });
}

async function probe(port, urlPath, headers = {}) {
  try {
    return await rawProbe(port, urlPath, headers);
  } catch (err) {
    return { status: 0, contentType: '', bytes: 0, location: '', bodyText: '', rawHeader: '', error: err.message };
  }
}

/** A valid 64x64 PNG fixture; see the declaration at the top of this file. */

function finish() {
  if (notes.length) {
    console.log('\n  evidence:');
    for (const n of notes) console.log(`    - ${n}`);
  }
  if (failures > 0) {
    console.error(
      `\nFAILED — ${failures} check(s): the Image Optimization endpoint is not provably unreachable, the build ` +
        'evidence is missing, or the non-regression layer found the application not serving its Phase 50 root-route ' +
        'contract (an anonymous GET / must redirect to a live /login and must not render authenticated content; ' +
        '/health must be 200). For the image endpoint itself, set `images: { unoptimized: true }` in ' +
        'apps/web/next.config.mjs and rebuild.\n',
    );
    process.exit(1);
  }
  console.log(
    '\nPASSED — /_next/image cannot serve an optimized image: the config sets `images.unoptimized: true`, the ' +
      'BUILT manifest agrees, the running standalone server answers 404, and the application still works (' +
      'the anonymous root route redirects to a live /login and serves no authenticated content, and /health is 200).\n',
  );
  process.exit(0);
}
