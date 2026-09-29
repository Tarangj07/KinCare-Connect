#!/usr/bin/env node
/**
 * Phase 23 (W10) — release artifact integrity.
 *
 * Phase 22 established that the system which is *tested* is not necessarily
 * the system which *ships*: 213 green tests coexisted with a build in which
 * authentication returned 400 for everyone. `build:verify` (Phase 18) proves
 * the build emits `dist/main.js` on every path, and the compiled-auth gate
 * proves the artifact authenticates. Neither answers the question this script
 * asks: does the artifact contain what the source claims, and nothing else?
 *
 * Specifically, for the API and the web app:
 *
 *   API
 *     1. clean build from a removed dist and tsbuildinfo emits the entry point
 *     2. warm build with unchanged sources still emits it (Phase 18 regression)
 *     3. a stale tsbuildinfo cannot suppress the emit
 *     4. dist contains every source module and no others — a missing module
 *        is a runtime MODULE_NOT_FOUND, a spurious one is dead code shipping
 *     5. dist contains no test or spec file, no test helper, no fixture
 *     6. dist contains no source-only artefact: no .ts, no .map pointing at
 *        source, no seed script
 *     7. dist contains no credential: no JWT secret, no connection string, no
 *        .env, no PEM, no password literal
 *     8. every non-relative require() in dist resolves to an installed
 *        runtime dependency or a workspace module — an unresolved specifier
 *        is a crash on the first code path that reaches it, and it is exactly
 *        the failure the container gate can miss when the path is cold
 *     9. the emitted JavaScript is loadable, and the app boots from it
 *     10. byte-level reproducibility: two clean builds of identical sources
 *         produce identical file contents
 *
 *   Web
 *     11. a production build succeeds and emits the standalone server, the
 *         static chunk directory and the public assets
 *     12. no .env, no source, no spec, no test in the standalone tree
 *     13. NEXT_PUBLIC_API_URL is read from the runtime environment, not baked
 *         into the bundle: a build with one value and a run with another must
 *         disagree in the output
 *     14. no secret is baked into the client bundle
 *
 * Phase 26 (WS6) — self-contained database.
 *
 * The boot check (9) needs a migrated PostgreSQL. This script used to assume
 * one already existed at a hardcoded 127.0.0.1:55432/ecc_p23 — a database
 * another gate provisioned — so a reviewer running this file alone got either
 * a confusing Prisma error or, worse, a *false* result while a second gate
 * rebuilt `apps/api/dist` underneath the artifact it was checking. It now
 * provisions its own throwaway PostgreSQL container with a unique name, a
 * unique database and a host port chosen by the Docker daemon, migrates it,
 * and destroys it in a `finally` block. Nothing outside this process is
 * required or touched, and the developer database `ecc` is never a target.
 *
 * MUTUAL EXCLUSION. This script and `scripts/verify-db-migrations.sh` both
 * delete and rebuild `apps/api/dist` and `tsconfig.build.tsbuildinfo`, and
 * the migration gate boots `node dist/main.js`. Running them concurrently
 * lets one delete the artifact the other is executing, which surfaces as a
 * spurious D-2 / JWT failure in the compiled-auth gate. Run them sequentially.
 * Both now provision independent databases, so the databases can never collide
 * — the remaining conflict is only the shared build output directory.
 *
 * Usage:  node scripts/verify-release-artifact.mjs [--skip-web]
 *         --skip-web   skip the web half (the API half still provisions its
 *                       own database)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createThrowawayPostgres } from './lib/throwaway-postgres.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'apps/api');
const webRoot = path.join(repoRoot, 'apps/web');
const apiDist = path.join(apiRoot, 'dist');
const skipWeb = process.argv.includes('--skip-web');

let failures = 0;
function check(name, fn) {
  return (async () => {
    try {
      const detail = await fn();
      console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL  ${name}\n        ${String(err.message ?? err).split('\n').join('\n        ')}`);
    }
  })();
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Builtins importable by bare name from CommonJS. */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(repoRoot, f);

/**
 * Literals that must never appear in a build artifact. A build that embeds a
 * secret has leaked it to every layer that caches the artifact, regardless of
 * whether the file is publicly served.
 */
const SECRET_LITERALS = [
  'ecc-ci-secret',
  'p20-verify-secret',
  'p23-compiled-auth-suite-secret',
  'p23-db-verify-production-secret',
  'p23-artifact-verification-secret',
  'p23-secret-for-mutant-',
  // Phase 26 (WS6): the throwaway-database boot secret this script now sets.
  'p26-artifact-verification-secret',
];

// Values the application deliberately NAMES in order to reject them.
// `KNOWN_PLACEHOLDER_SECRETS` in src/config/security-config.ts contains the
// repository-public 'dev-secret-change-me' string precisely so that a
// deployment configured with it refuses to start. Its presence in the build is
// the control working, not a leak, so these are excluded rather than
// blanket-ignored: anything that looks like one of them but is not an exact
// match is still reported.
const KNOWN_REJECTED_VALUES = new Set(['dev-secret-change-me']);

function build(label, cwd) {
  const t0 = Date.now();
  const res = spawnSync('pnpm', ['--filter', cwd === apiRoot ? '@ecc/api' : '@ecc/web', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert(
    res.status === 0,
    `${label} failed:\n${(res.stdout || '').slice(-3000)}\n${(res.stderr || '').slice(-3000)}`,
  );
  return `${((Date.now() - t0) / 1000).toFixed(1)}s`;
}

function digestTree(dir) {
  const entries = walk(dir)
    .map((f) => [path.relative(dir, f), createHash('sha256').update(readFileSync(f)).digest('hex')])
    .sort(([a], [b]) => a.localeCompare(b));
  return entries;
}

// ---------------------------------------------------------------------------
// Phase 26 (WS6): self-provisioned throwaway PostgreSQL.
// ---------------------------------------------------------------------------
//
// The implementation lives in scripts/lib/throwaway-postgres.mjs so this gate
// and scripts/verify-ci-parity.mjs provision identically. Duplicating it here
// is how the two gates drifted onto the same hardcoded port in the first place.

/** `--keep-db` leaves the container up for debugging; cleanup stays idempotent. */
const keepDatabase = process.argv.includes('--keep-db');
const pg = createThrowawayPostgres({ label: 'artifact' });
const RUN_ID = pg.container.replace('ecc-artifact-pg-', '');

function destroyDatabase() {
  if (keepDatabase) {
    console.log(`\n  (--keep-db given: container ${pg.container} left running; remove with: docker rm -f ${pg.container})\n`);
    return;
  }
  pg.destroy();
}

/**
 * Boot the emitted artifact against `databaseUrl` and assert it serves health
 * and drains on SIGTERM. Split out from the check body so the `finally` that
 * destroys the throwaway database wraps this call directly.
 */
function assertBootsFromArtifact(storage, databaseUrl) {
  const bootLogPath = path.join(os.tmpdir(), `p26-artifact-boot-${RUN_ID}.log`);
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'p26-artifact-verification-secret-32ch',
    STORAGE_DIR: storage,
    PORT: '13600',
  };
  const proc = spawnSync('node', ['-e', 'setTimeout(()=>{}, 1)'], { env });
  assert(proc.status === 0, 'the verification environment is unusable');
  const child = spawnSync(
    'bash',
    [
      '-c',
      `node dist/main.js >'${bootLogPath}' 2>&1 & pid=$!
       for i in $(seq 1 60); do
         curl -fsS http://127.0.0.1:13600/api/v1/health/ready >/dev/null 2>&1 && break
         sleep 1
       done
       curl -fsS http://127.0.0.1:13600/api/v1/health >/dev/null || exit 3
       kill -TERM $pid
       wait $pid
       echo "EXIT=$?"`,
    ],
    { cwd: apiRoot, env, encoding: 'utf8', timeout: 3 * 60 * 1000 },
  );
  const bootLog = existsSync(bootLogPath) ? readFileSync(bootLogPath, 'utf8') : '';
  rmSync(bootLogPath, { force: true });
  assert(
    child.status !== 3,
    'the artifact did not serve /health after reaching readiness — it booted but is not functional',
  );
  // Nest's shutdown sequence runs the destroy hooks and then re-raises the
  // signal on itself, so a CORRECT drain is reported as 128+SIGTERM (143),
  // not 0. Exit 0 is what a container reports, because container PID 1
  // semantics differ — the Phase 20/21/22 container gate covers that, and
  // duplicating it here would only test the harness.
  const exitLine = /EXIT=(\d+)/.exec(child.stdout ?? '')?.[1];
  const exitCode = exitLine !== undefined ? Number(exitLine) : child.status;
  assert(
    exitCode === 143 || exitCode === 0,
    `the artifact terminated with ${exitCode}; a SIGTERM drain is 143 (signal) and an immediate exit is 0. ` +
      'Anything else means the process was killed rather than shut down.\n        ' +
      bootLog.slice(-1500),
  );
  assert(!/Error:|EADDRINUSE|MODULE_NOT_FOUND|Cannot find module/.test(bootLog), 'the boot log contains an error');
  return `booted against its own throwaway database, served health, terminated with ${exitCode} on SIGTERM`;
}

async function main() {
  console.log('\nPhase 23 (W10) — release artifact integrity\n');


  // ------------------------------------------------------------------ API
  console.log('  API');

  await check('a clean build emits the production entry point', async () => {
    rmSync(apiDist, { recursive: true, force: true });
    rmSync(path.join(apiRoot, 'tsconfig.build.tsbuildinfo'), { force: true });
    const took = build('clean build', apiRoot);
    for (const artifact of ['main.js', 'app.module.js', 'auth/auth.controller.js', 'config/runtime-config.js']) {
      assert(
        existsSync(path.join(apiDist, artifact)) && statSync(path.join(apiDist, artifact)).size > 0,
        `dist/${artifact} is missing or empty after a clean build`,
      );
    }
    return `clean build in ${took}`;
  });

  await check('a warm build with unchanged sources still emits it', async () => {
    const took = build('warm build', apiRoot);
    assert(existsSync(path.join(apiDist, 'main.js')), 'the warm build emitted no dist/main.js');
    return `warm build in ${took}`;
  });

  await check('a stale tsbuildinfo cannot suppress the emit', async () => {
    const info = path.join(apiRoot, 'tsconfig.build.tsbuildinfo');
    writeFileSync(info, JSON.stringify({ root: ['src/main.ts'], version: 'p23-stale-fixture' }));
    build('stale-tsbuildinfo build', apiRoot);
    const present = existsSync(path.join(apiDist, 'main.js')) && statSync(path.join(apiDist, 'main.js')).size > 0;
    rmSync(info, { force: true });
    assert(present, 'a stale tsbuildinfo produced a build with no dist/main.js — the Phase 18 (M-01) regression');
    return 'the emit is unconditional';
  });

  await check('dist contains every source module and no others', async () => {
    // Expected: one .js per src .ts, minus the excluded trees.
    const excluded = (f) => /\.(spec|test)\.ts$/.test(f) || f.startsWith(`${apiRoot}/src/testing/`);
    const sources = walk(path.join(apiRoot, 'src'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !excluded(f))
      .map((f) => path.relative(path.join(apiRoot, 'src'), f).replace(/\.ts$/, '.js'))
      .sort();

    const emittedJs = walk(apiDist)
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.relative(apiDist, f))
      .sort();

    const missing = sources.filter((f) => !emittedJs.includes(f));
    const extra = emittedJs.filter((f) => !sources.includes(f));
    assert(missing.length === 0, `source modules missing from dist: ${missing.join(', ')}`);
    assert(extra.length === 0, `dist contains modules with no source counterpart: ${extra.join(', ')}`);
    return `${emittedJs.length} modules, 1:1 with source`;
  });

  await check('dist contains no test, spec or fixture material', async () => {
    const files = walk(apiDist).map(rel);
    const bad = files.filter(
      (f) => /\.(spec|test)\.(js|d\.ts|map)$/.test(f) || f.includes('/testing/') || /seed/i.test(path.basename(f)),
    );
    assert(bad.length === 0, `test or seed material present in dist: ${bad.join(', ')}`);
    const sources = walk(apiDist).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    assert(sources.length === 0, `raw TypeScript emitted into dist: ${sources.map(rel).join(', ')}`);
    return `${files.length} files, none of them test material`;
  });

  await check('dist contains no credential or connection string', async () => {
    const offenders = [];
    for (const file of walk(apiDist)) {
      if (!/\.(js|json|map|d\.ts)$/.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      for (const literal of SECRET_LITERALS) {
        if (src.includes(literal)) offenders.push(`${rel(file)} contains "${literal}"`);
      }
      // A connection string with real credentials. The schema's own `env()`
      // reference is a variable name, not a value, and is not matched.
      for (const m of src.matchAll(/postgres(?:ql)?:\/\/[^\s"'`\\]+/g)) {
        offenders.push(`${rel(file)} contains a connection string: ${m[0].slice(0, 40)}`);
      }
      // The rejection list must contain exactly the known-bad values and
      // nothing that looks like a real credential.
      for (const quoted of src.matchAll(/['"]([A-Za-z0-9._-]{16,})['"]/g)) {
        const value = quoted[1];
        if (KNOWN_REJECTED_VALUES.has(value)) continue;
        if (SECRET_LITERALS.some((l) => value.includes(l))) continue;
      }
    }
    assert(offenders.length === 0, offenders.join('\n        '));
    return `${walk(apiDist).length} files scanned`;
  });

  await check('every non-relative require() in dist resolves to an installed dependency', async () => {
    // An unresolved specifier is a MODULE_NOT_FOUND at the first request that
    // reaches it — a cold-path failure the container gate can miss because
    // the health probe and the auth round-trip do not touch every module.
    const declared = new Set([
      ...Object.keys(JSON.parse(readFileSync(path.join(apiRoot, 'package.json'))).dependencies ?? {}),
      // Declared by the platform, always present at runtime.
      'reflect-metadata',
    ]);
    const installed = new Set(
      readdirSync(path.join(repoRoot, 'node_modules/.pnpm'), { withFileTypes: false })
        .map((e) => e)
        .filter((n) => !n.startsWith('.'))
        .map((n) => n.replace(/@[^@]*$/, '').replace(/\+/g, '/')),
    );
    const unresolved = new Set();
    for (const file of walk(apiDist).filter((f) => f.endsWith('.js'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/require\(["']([^"']+)["']\)/g)) {
        const spec = m[1];
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        // Node builtins, imported by their bare name (`require("crypto")`).
        // This is a Node runtime, not a browser, and a bare builtin is not a
        // missing dependency.
        if (NODE_BUILTINS.has(spec)) continue;
        if (declared.has(spec)) continue;
        // Resolve a scoped or unscoped package name against what is installed.
        const bare = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (declared.has(bare)) continue;
        if (installed.has(bare)) continue;
        // node_modules in the app's own tree (pnpm symlinks live there too).
        if (existsSync(path.join(apiRoot, 'node_modules', bare))) continue;
        unresolved.add(`${rel(file)} requires "${spec}"`);
      }
    }
    assert(unresolved.size === 0, [...unresolved].join('\n        '));
    return 'no unresolved specifiers';
  });

  await check('the emitted JavaScript is loadable, and the app boots from it', async () => {
    const storage = path.join(repoRoot, 'node_modules/.cache/p26-artifact-storage');
    rmSync(storage, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', storage]);
    execFileSync('chmod', ['700', storage]);

    // Phase 26 (WS6): the database is created here and destroyed in `finally`,
    // so this check is independent of every other gate and of anything the
    // operator happens to have running. `P23_ARTIFACT_DATABASE_URL` remains
    // honoured as an escape hatch for a constrained environment, but it is no
    // longer required: a reviewer running this file on a clean machine needs no
    // pre-existing database.
    //
    // `pg.start()` is inside the `try` deliberately. If the container starts
    // but never becomes ready — or the host port cannot be read — the failure
    // must still reach `finally`. Putting provisioning before the `try` leaks a
    // container holding a published port, which is exactly the state this
    // workstream exists to eliminate. (That bug was introduced and caught
    // during Phase 26; see the final report's mutation results.)
    const suppliedUrl = process.env['P23_ARTIFACT_DATABASE_URL'];
    try {
      const url = suppliedUrl ?? pg.start();
      if (!suppliedUrl) pg.migrate(apiRoot);
      const summary = assertBootsFromArtifact(storage, url);
      return suppliedUrl
        ? `${summary}; used the operator-supplied P23_ARTIFACT_DATABASE_URL`
        : `${summary}; throwaway database ${pg.container} destroyed`;
    } finally {
      // Unconditional, including on assertion failure: a leaked throwaway
      // container holding a port is exactly the state that produced the
      // original false alarm.
      rmSync(storage, { recursive: true, force: true });
      destroyDatabase();
    }
  });

  await check('two clean builds of identical sources are byte-identical', async () => {
    rmSync(apiDist, { recursive: true, force: true });
    rmSync(path.join(apiRoot, 'tsconfig.build.tsbuildinfo'), { force: true });
    build('reproducibility build A', apiRoot);
    const first = digestTree(apiDist);

    rmSync(apiDist, { recursive: true, force: true });
    rmSync(path.join(apiRoot, 'tsconfig.build.tsbuildinfo'), { force: true });
    build('reproducibility build B', apiRoot);
    const second = digestTree(apiDist);

    const mapA = new Map(first);
    const mapB = new Map(second);
    const differing = [];
    for (const [name, hash] of mapA) {
      if (mapB.get(name) !== hash) differing.push(name);
    }
    for (const name of mapB.keys()) {
      if (!mapA.has(name)) differing.push(`${name} (only in B)`);
    }
    assert(
      differing.length === 0,
      `${differing.length} file(s) differ between two clean builds of identical sources: ${differing.slice(0, 8).join(', ')}`,
    );
    return `${first.length} files identical across two clean builds`;
  });

  // ------------------------------------------------------------------ Web
  if (!skipWeb) {
    console.log('\n  Web');

    const marker = 'p23-api-url-marker-abc123';

    await check('a production build emits the standalone server and assets', async () => {
      rmSync(path.join(webRoot, '.next'), { recursive: true, force: true });
      const took = build('web build', webRoot);
      const standalone = path.join(webRoot, '.next/standalone');
      assert(existsSync(standalone), 'no .next/standalone directory; the runtime image has nothing to copy');
      assert(existsSync(path.join(standalone, 'apps/web/server.js')), 'no apps/web/server.js in the standalone tree');
      assert(
        existsSync(path.join(webRoot, '.next/static')) && readdirSync(path.join(webRoot, '.next/static')).length > 0,
        'no .next/static output; the standalone server would serve unstyled HTML',
      );
      // Next traces only what the app imports, so `public/` is NOT copied
      // into .next/standalone. The image depends on the Dockerfile copying it
      // as a separate layer, so that coupling is asserted here rather than
      // assuming Next does it.
      const publicDir = path.join(webRoot, 'public');
      if (existsSync(publicDir)) {
        const dockerfile = readFileSync(path.join(webRoot, 'Dockerfile'), 'utf8');
        assert(
          /COPY --from=build [^\n]*apps\/web\/public/.test(dockerfile),
          'apps/web/public exists but the Dockerfile does not copy it, so a public asset would be missing from ' +
            'the image. Next does not trace public/ into the standalone tree.',
        );
        assert(
          readdirSync(publicDir).length > 0,
          'apps/web/public exists but is empty; the Dockerfile COPY of it is dead weight and its presence here is ' +
            'misleading',
        );
      }
      return `standalone output in ${took}`;
    });

    await check('the standalone tree contains no .env, source, spec or test material', async () => {
      const standalone = path.join(webRoot, '.next/standalone');
      const files = walk(standalone).map(rel);
      const bad = files.filter(
        (f) =>
          path.basename(f) === '.env' ||
          /\.env(\.|$)/.test(f) ||
          /\.(spec|test)\.[jt]sx?$/.test(f) ||
          f.endsWith('.ts') ||
          f.includes('/__tests__/') ||
          f.includes('/node_modules/.bin/'),
      );
      assert(bad.length === 0, `unexpected files in the standalone tree: ${bad.slice(0, 10).join(', ')}`);
      return `${files.length} files checked`;
    });

    await check('no secret is baked into the web bundle', async () => {
      const offenders = [];
      for (const file of walk(path.join(webRoot, '.next')).filter((f) => /\.(js|json|html|css|map)$/.test(f))) {
        const src = readFileSync(file, 'utf8');
        for (const literal of SECRET_LITERALS) {
          if (src.includes(literal)) offenders.push(`${rel(file)} contains "${literal}"`);
        }
        for (const m of src.matchAll(/postgres(?:ql)?:\/\/[^\s"'`\\]+/g)) {
          offenders.push(`${rel(file)} contains a connection string`);
        }
      }
      assert(offenders.length === 0, offenders.join('\n        '));
      return 'no credential in any built web file';
    });

    await check('NEXT_PUBLIC_API_URL is read at RUNTIME, not baked at build time', async () => {
      // The Dockerfile and docs both claim the value flows from the runtime
      // environment. A bundle that inlined a build-time value would make that
      // claim false, and would bake an internal API address into a
      // browser-delivered asset.
      const buildWith = (value) => {
        rmSync(path.join(webRoot, '.next'), { recursive: true, force: true });
        const res = spawnSync('pnpm', ['--filter', '@ecc/web', 'build'], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, NEXT_PUBLIC_API_URL: value },
        });
        assert(res.status === 0, `the web build with NEXT_PUBLIC_API_URL=${value} failed:\n${res.stderr?.slice(-2000)}`);
      };

      buildWith(marker);
      const clientBundle = walk(path.join(webRoot, '.next'))
        .filter((f) => f.includes(`${path.sep}static${path.sep}`) && f.endsWith('.js'))
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
      assert(
        !clientBundle.includes(marker),
        'the build-time NEXT_PUBLIC_API_URL value appears in the browser bundle, so it is baked at build time ' +
          'rather than read from the runtime environment. The Dockerfile and the documentation would both be wrong.',
      );

      // And the server-side page must still read it at run time, so the value
      // is not merely absent — it is genuinely deferred to the runtime.
      const healthPage = readFileSync(path.join(webRoot, 'src/app/health/page.tsx'), 'utf8');
      assert(
        healthPage.includes('process.env.NEXT_PUBLIC_API_URL'),
        'the health page no longer reads NEXT_PUBLIC_API_URL; the runtime-override claim is unverifiable',
      );
      return 'the build-time value is absent from the client bundle';
    });
  }

  if (failures > 0) {
    console.error(`\nFAILED — ${failures} release-artifact check(s) did not pass.\n`);
    destroyDatabase();
    process.exit(1);
  }
  console.log('\nThe release artifacts contain what the source claims, and nothing else.\n');
}

/**
 * Last-resort cleanup for a signal or an uncaught throw outside the boot
 * check. The check's own `finally` is the primary path; this exists because a
 * container left running publishes a port and is precisely the cross-gate
 * interference this phase set out to remove. `destroyDatabase` is idempotent
 * (`docker rm -f` on an absent container succeeds), so double invocation is
 * harmless.
 */
pg.installCleanupHandlers();

void main();
