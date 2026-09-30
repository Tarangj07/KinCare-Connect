#!/usr/bin/env node
/**
 * Phase 20 — container build and runtime verification.
 *
 * Phase 19 left P19-01 open: both Dockerfiles were pre-existing from
 * Phase 1 and had never been built. Their runtime stages copied
 * `apps/<app>/node_modules`, which under pnpm's isolated linker consists
 * of symlinks into the workspace root's `node_modules/.pnpm` store that
 * was never copied into the image. This script is the regression gate for
 * that class of defect: it builds both images for real and then proves
 * they work, rather than merely looking correct.
 *
 * What it asserts (all against real containers):
 *
 *   Image construction
 *     1. Both Dockerfiles build from a clean context.
 *     2. The API runtime tree has no broken symlinks (self-contained).
 *     3. The Web runtime tree has no broken symlinks.
 *     4. Neither image contains a .env file, a .git directory, test
 *        sources or dev-only tooling.
 *     5. Both images run as a non-root user.
 *
 *   API container
 *     6. The EXACT documented operator command
 *        (`node_modules/.bin/prisma migrate deploy`) applies every
 *        migration to a clean database, exits 0, and leaves the
 *        database at the expected migration state (Phase 21 / L-01).
 *     7. Liveness answers 200 without consulting the database.
 *     8. Readiness answers 200 and reports the database as reachable.
 *     9. `docker stop` (SIGTERM) drains and exits 0, not killed (143).
 *    10. Production start is refused without STORAGE_DIR (Phase 18/19).
 *    11. Production start is refused with a placeholder JWT secret
 *        (Phase 16) — i.e. no insecure default was added to make the
 *        container boot.
 *    12. Production start is refused with a non-postgres DATABASE_URL.
 *    13. No application path is writable by the runtime user, while
 *        STORAGE_DIR is (Phase 21 / L-03).
 *    14. The Phase 18 0600/0700 storage modes are still enforced by the
 *        application inside the read-only image.
 *
 *   Web container
 *    15. The home page, /dashboard and /health render 200.
 *    16. A hashed static asset is served (proves the static copy path).
 *    17. /health reports the live API as ok (proves NEXT_PUBLIC_API_URL
 *        still flows from the runtime environment), and an unknown route
 *        returns 404.
 *
 *   Shutdown
 *    18. Both containers exit 0 on SIGTERM (not 143, not OOM-killed) and
 *        stop serving.
 *
 * Everything runs against a disposable PostgreSQL container created and
 * destroyed by this script; no developer database is used or modified.
 * STORAGE_DIR is a disposable volume explicitly provisioned 0700 and
 * owned by 1000:1000, so the check does not depend on the uid of the
 * user running the script (a GitHub runner is uid 1001, which a
 * Phase-20-style host bind mount could not satisfy).
 *
 * Usage:  node scripts/verify-docker-images.mjs [--skip-build]
 * Exits non-zero on the first failing assertion.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';

const repoRoot = new URL('..', import.meta.url).pathname;
const skipBuild = process.argv.includes('--skip-build');

const API_IMAGE = process.env.P20_API_IMAGE ?? 'ecc-api:p20-verify';
const WEB_IMAGE = process.env.P20_WEB_IMAGE ?? 'ecc-web:p20-verify';
const NET = 'p20-verify-net';
const PG_CONTAINER = 'p20-verify-postgres';
const STORAGE_VOLUME = 'p20-verify-storage';
const DB_NAME = 'ecc_p20_verify';
const DB_USER = 'ecc';
const DB_PASSWORD = 'p20-verify-secret';
const DB_URL_INTERNAL = `postgresql://${DB_USER}:${DB_PASSWORD}@${PG_CONTAINER}:5432/${DB_NAME}`;
// Second, empty database used only by the Phase 21 (L-01) migration check,
// so "applies migrations to a clean database" is proven literally rather
// than inferred from an already-migrated one.
const CLEAN_DB_NAME = 'ecc_p21_clean';
const CLEAN_DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${PG_CONTAINER}:5432/${CLEAN_DB_NAME}`;
// The documented operator command. Kept as a single constant so the
// Dockerfile comment, the documentation and this gate cannot drift apart,
// and so the check exercises the published syntax rather than a private
// shortcut. `prisma` is deliberately absent: it is not on PATH, and the
// inherited docker-entrypoint.sh would rewrite it to `node prisma ...`
// and fail — see docs/PHASE_21_CONTAINER_RUNTIME_HARDENING.md.
const MIGRATION_COMMAND = ['node_modules/.bin/prisma', 'migrate', 'deploy'];
// Throwaway signing secret. The API refuses placeholders and anything
// shorter than 32 characters, so this is a valid-but-ephemeral value.
const JWT_SECRET = 'p20-verify-only-production-secret-32-chars';
const API_PORT = 13400;
const WEB_PORT = 13401;

let failures = 0;
const containers = [];

function log(msg) {
  console.log(msg);
}

function check(name, fn) {
  // Checks may be synchronous or async; the result is always awaited so a
  // rejected HTTP wait is reported as a FAIL rather than an unhandled
  // rejection (which would let a broken image pass).
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

function docker(args, opts = {}) {
  const res = spawnSync('docker', args, { encoding: 'utf8', ...opts });
  if (res.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed (exit ${res.status}):\n${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
}

async function waitForHttp(url, { timeoutMs = 60_000, expect } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      last = `HTTP ${res.status}`;
      if (expect) expect(res, body);
      return { status: res.status, body };
    } catch (err) {
      last = String(err.cause?.code ?? err.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`timed out waiting for ${url} (last: ${last})`);
}

function cleanup() {
  for (const c of containers) spawnSync('docker', ['rm', '-f', c], { encoding: 'utf8' });
  spawnSync('docker', ['network', 'rm', '-f', NET], { encoding: 'utf8' });
  spawnSync('docker', ['volume', 'rm', '-f', STORAGE_VOLUME], { encoding: 'utf8' });
}

async function main() {
  // ---------------------------------------------------------------- build
  log('\nPhase 20 — container build and runtime verification\n');
  log('Building images');
  if (!skipBuild) {
    for (const [image, dockerfile] of [
      [API_IMAGE, 'apps/api/Dockerfile'],
      [WEB_IMAGE, 'apps/web/Dockerfile'],
    ]) {
      await check(`${dockerfile} builds`, () => {
        execFileSync('docker', ['build', '-f', dockerfile, '-t', image, repoRoot], {
          stdio: 'pipe',
        });
        const id = docker(['image', 'inspect', image, '--format', '{{.Id}}']);
        return id.slice(0, 19);
      });
    }
  } else {
    log('  (--skip-build: using existing images)');
  }

  // ------------------------------------------------------------ inspection
  log('\nImage inspection');

  const brokenLinkCheck = (dir) =>
    `const fs=require("fs"),p=require("path"),bad=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isSymbolicLink()){try{fs.statSync(f)}catch{bad.push(f+" -> "+fs.readlinkSync(f))}}else if(e.isDirectory())w(f)}})("${dir}");if(bad.length){console.error(bad.join("\\n"));process.exit(1)}console.log("ok")`;

  // Phase 22 (F-02, closes Phase-21 P21-02). The dangling-link walk above
  // only reports a symlink whose target does not resolve. A symlink that
  // resolves perfectly well but points OUTSIDE the application tree passed
  // undetected — a `require()` through such a link would load a file the
  // image is not supposed to contain, and a link is exactly how a
  // self-contained `pnpm deploy` tree can silently stop being self-contained.
  //
  // `fs.realpathSync` resolves the whole chain, so a link that leaves /app
  // and comes back is caught too; the lexical resolution is the fallback for
  // links whose target does not exist (already reported as dangling above).
  // Legitimate internal links — pnpm's relative `node_modules/.bin/*` shims
  // and the `.pnpm` store links — resolve to real files inside /app and are
  // not flagged.
  const escapingLinkCheck = (dir) =>
    `const fs=require("fs"),p=require("path"),bad=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isSymbolicLink()){let target;try{target=fs.realpathSync(f)}catch{target=p.resolve(p.dirname(f),fs.readlinkSync(f))}if(target!=="${dir}"&&!target.startsWith("${dir}/"))bad.push(f+" -> "+fs.readlinkSync(f)+" (resolves to "+target+")")}else if(e.isDirectory())w(f)}})("${dir}");if(bad.length){console.error(bad.join("\\n"));process.exit(1)}console.log("ok")`;

  for (const [label, image, dir] of [
    ['API', API_IMAGE, '/app'],
    ['Web', WEB_IMAGE, '/app'],
  ]) {
    await check(`${label} image has no broken symlinks`, () =>
      docker(['run', '--rm', '--entrypoint', 'node', image, '-e', brokenLinkCheck(dir)]),
    );

    await check(`${label} image has no symlink escaping ${dir}`, () =>
      docker(['run', '--rm', '--entrypoint', 'node', image, '-e', escapingLinkCheck(dir)]),
    );

    await check(`${label} image contains no secrets or VCS data`, () => {
      const found = docker([
        'run',
        '--rm',
        '--entrypoint',
        'sh',
        image,
        '-c',
        'find /app \\( -name ".env*" -o -name ".git" -o -name "*.pem" -o -name "*.key" \\) -print',
      ]);
      assert(found === '', `image contains forbidden entries: ${found}`);
      return 'no .env/.git/keys';
    });
  }

  await check('API image ships no test or source material', () => {
    const listing = docker(['run', '--rm', '--entrypoint', 'sh', API_IMAGE, '-c', 'ls /app | tr "\\n" " "']);
    for (const forbidden of ['src', 'test', 'coverage', 'node_modules.bak']) {
      assert(!listing.split(' ').includes(forbidden), `/app contains ${forbidden}`);
    }
    assert(listing.includes('dist'), '/app/dist is missing');
    return listing.trim();
  });

  await check('Web image ships no application source', () => {
    const found = docker([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      WEB_IMAGE,
      '-c',
      'find /app -maxdepth 3 -name "src" -o -maxdepth 3 -name "test" -o -maxdepth 3 -name "*.spec.ts"',
    ]);
    assert(found === '', `image contains source/test material: ${found}`);
    return 'clean';
  });

  for (const [label, image] of [
    ['API', API_IMAGE],
    ['Web', WEB_IMAGE],
  ]) {
    await check(`${label} image runs as a non-root user`, () => {
      const id = docker(['run', '--rm', '--entrypoint', 'id', image, '-u']);
      assert(id.trim() !== '0', `container runs as uid ${id.trim()}`);
      return id.trim();
    });
  }

  // ------------------------------------------------------- throwaway infra
  log('\nStarting throwaway PostgreSQL');
  try {
    docker(['network', 'create', NET]);
  } catch {
    /* already exists */
  }
  containers.push(PG_CONTAINER);
  docker([
    'run', '-d',
    '--name', PG_CONTAINER,
    '--network', NET,
    '-e', `POSTGRES_USER=${DB_USER}`,
    '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e', `POSTGRES_DB=${DB_NAME}`,
    'postgres:16-alpine',
  ]);
  const pgDeadline = Date.now() + 60_000;
  for (;;) {
    const res = spawnSync('docker', ['exec', PG_CONTAINER, 'pg_isready', '-U', DB_USER, '-d', DB_NAME], {
      encoding: 'utf8',
    });
    if (res.status === 0) break;
    if (Date.now() > pgDeadline) throw new Error('throwaway PostgreSQL did not become ready');
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('  throwaway PostgreSQL ready');

  // Phase 21 (L-03): STORAGE_DIR is a disposable volume provisioned the
  // way the image documentation tells an operator to provision it —
  // owner-only, owned by the runtime uid. A host temp directory cannot
  // express that on any machine whose user is not uid 1000 (GitHub
  // runners are uid 1001), which would make the writability check below
  // report a fixture problem as an image problem.
  docker(['volume', 'create', STORAGE_VOLUME]);
  for (const args of [
    ['chown', '1000:1000', '/mnt/storage'],
    ['chmod', '700', '/mnt/storage'],
  ]) {
    docker([
      'run', '--rm', '--user', '0',
      '-v', `${STORAGE_VOLUME}:/mnt/storage`,
      API_IMAGE,
      ...args,
    ]);
  }
  const storageMode = docker([
    'run', '--rm', '--user', '0',
    '-v', `${STORAGE_VOLUME}:/mnt/storage`,
    API_IMAGE,
    'stat', '-c', '%U:%G %a', '/mnt/storage',
  ]);
  assert(storageMode === 'node:node 700', `STORAGE_VOLUME is ${storageMode}, expected node:node 700`);

  // ------------------------------------------------------------- API image
  log('\nAPI container');

  // ------------------------------------------------------------ Phase 21
  // L-01: the migration procedure the Dockerfile advertises must be the
  // one that actually works. Run the published command against a
  // database that is provably empty first.
  await check('a clean database really is empty before migrating', () => {
    docker(['exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', 'postgres', '-qc', `CREATE DATABASE ${CLEAN_DB_NAME}`]);
    const tables = docker([
      'exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', CLEAN_DB_NAME, '-tAc',
      "select count(*) from information_schema.tables where table_schema = 'public'",
    ]);
    assert(tables === '0', `fresh database already has ${tables} tables`);
    return '0 tables before migrate';
  });

  await check('the documented migration command applies every migration to a clean database', () => {
    const out = docker([
      'run', '--rm', '--network', NET,
      '-e', `DATABASE_URL=${CLEAN_DB_URL}`,
      API_IMAGE,
      ...MIGRATION_COMMAND,
    ]);
    assert(
      /All migrations have been successfully applied/i.test(out),
      `documented command "${MIGRATION_COMMAND.join(' ')}" did not report success:\n${out}`,
    );
    return MIGRATION_COMMAND.join(' ');
  });

  await check('the migrated database is at the expected migration state', () => {
    // Expected count comes from the migrations shipped in the image, not
    // from a hard-coded number, so a future migration is not a failure.
    const shipped = Number(docker([
      'run', '--rm', '--entrypoint', 'sh', API_IMAGE, '-c',
      'find /app/prisma/migrations -maxdepth 2 -name migration.sql | wc -l',
    ]));
    assert(shipped > 0, 'the image ships no migrations at all');

    const rows = docker([
      'exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', CLEAN_DB_NAME, '-tAc',
      'select count(*) filter (where finished_at is not null), count(*) filter (where rolled_back_at is not null) from _prisma_migrations',
    ]).split('|');
    assert(Number(rows[0]) === shipped, `expected ${shipped} finished migrations, found ${rows[0]}`);
    assert(Number(rows[1]) === 0, `${rows[1]} migration(s) were rolled back`);

    const tables = docker([
      'exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', CLEAN_DB_NAME, '-tAc',
      "select count(*) from information_schema.tables where table_schema = 'public'",
    ]);
    assert(Number(tables) > shipped, `only ${tables} tables were created by ${shipped} migrations`);

    // Independent confirmation from the CLI itself, not just from SQL.
    const status = docker([
      'run', '--rm', '--network', NET,
      '-e', `DATABASE_URL=${CLEAN_DB_URL}`,
      API_IMAGE,
      'node_modules/.bin/prisma', 'migrate', 'status',
    ]);
    assert(/Database schema is up to date/i.test(status), `migrate status disagrees:\n${status}`);
    return `${shipped} migrations, ${rows[0]} finished, ${tables} tables`;
  });

  await check('re-running the documented migration command is a no-op', () => {
    const out = docker([
      'run', '--rm', '--network', NET,
      '-e', `DATABASE_URL=${CLEAN_DB_URL}`,
      API_IMAGE,
      ...MIGRATION_COMMAND,
    ]);
    assert(/No pending migrations to apply/i.test(out), `expected an idempotent no-op, got:\n${out}`);
    return 'no pending migrations';
  });

  await check('the prisma CLI is reached by path, not by name', () => {
    // This is WHY the documented command is path-qualified. `prisma` is
    // not on PATH, and the base image's docker-entrypoint.sh rewrites an
    // unresolvable argv[0] to `node prisma ...`, which then fails with
    // "Cannot find module '/app/prisma'". Asserting the cause here keeps
    // a future entrypoint or PATH change from silently invalidating the
    // published command.
    const onPath = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', API_IMAGE, '-c', 'command -v prisma'], {
      encoding: 'utf8',
    });
    assert(onPath.status !== 0 && onPath.stdout.trim() === '', '`prisma` unexpectedly resolved on PATH');
    const cli = docker(['run', '--rm', '--entrypoint', 'sh', API_IMAGE, '-c', 'test -x /app/node_modules/.bin/prisma && echo executable']);
    assert(cli === 'executable', 'node_modules/.bin/prisma is not executable in the image');
    return 'prisma not on PATH; .bin/prisma executable';
  });

  await check('migrations also apply through the documented --entrypoint node form', () => {
    docker(['exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', 'postgres', '-qc', `CREATE DATABASE ${CLEAN_DB_NAME}_entrypoint`]);
    const out = docker([
      'run', '--rm', '--network', NET,
      '-e', `DATABASE_URL=${CLEAN_DB_URL}_entrypoint`,
      '--entrypoint', 'node', API_IMAGE,
      'node_modules/prisma/build/index.js', 'migrate', 'deploy',
    ]);
    assert(/All migrations have been successfully applied/i.test(out), `unexpected output:\n${out}`);
    return 'node_modules/prisma/build/index.js';
  });

  // The pre-existing check the API needs in order to serve traffic.
  await check('migrations apply to the database the API will use', () => {
    const out = docker([
      'run', '--rm', '--network', NET,
      '-e', `DATABASE_URL=${DB_URL_INTERNAL}`,
      API_IMAGE,
      ...MIGRATION_COMMAND,
    ]);
    assert(/No pending migrations to apply|successfully applied/i.test(out), `unexpected output: ${out}`);
    return MIGRATION_COMMAND.join(' ');
  });

  // Negative configuration checks: the image must not have been made
  // bootable by weakening the Phase 16/18/19 fail-fast rules.
  await check('production start is refused without STORAGE_DIR', () => {
    const res = spawnSync(
      'docker',
      [
        'run', '--rm', '--network', NET,
        '-e', 'NODE_ENV=production',
        '-e', `DATABASE_URL=${DB_URL_INTERNAL}`,
        '-e', `JWT_ACCESS_SECRET=${JWT_SECRET}`,
        API_IMAGE,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert(res.status !== 0, 'container started without STORAGE_DIR (expected refusal)');
    assert(/STORAGE_DIR is required/.test(res.stderr), `error did not name STORAGE_DIR:\n${res.stderr.slice(0, 400)}`);
    return `exit ${res.status}`;
  });

  await check('production start is refused with a placeholder JWT secret', () => {
    const res = spawnSync(
      'docker',
      [
        'run', '--rm', '--network', NET,
        '-e', 'NODE_ENV=production',
        '-e', `DATABASE_URL=${DB_URL_INTERNAL}`,
        '-e', 'JWT_ACCESS_SECRET=change-me-in-production',
        '-e', 'STORAGE_DIR=/app/storage',
        '-v', `${STORAGE_VOLUME}:/app/storage`,
        API_IMAGE,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert(res.status !== 0, 'container started with a placeholder JWT secret (expected refusal)');
    assert(/JWT_ACCESS_SECRET is missing or set to a placeholder value/.test(res.stderr), `unexpected error:\n${res.stderr.slice(0, 400)}`);
    return `exit ${res.status}`;
  });

  await check('production start is refused with a non-postgres DATABASE_URL', () => {
    const res = spawnSync(
      'docker',
      [
        'run', '--rm', '--network', NET,
        '-e', 'NODE_ENV=production',
        '-e', 'DATABASE_URL=mysql://someone:somewhere/db',
        '-e', `JWT_ACCESS_SECRET=${JWT_SECRET}`,
        '-e', 'STORAGE_DIR=/app/storage',
        '-v', `${STORAGE_VOLUME}:/app/storage`,
        API_IMAGE,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert(res.status !== 0, 'container started with a non-postgres DATABASE_URL (expected refusal)');
    assert(
      /DATABASE_URL must be a postgres:\/\/ or postgresql:\/\/ connection string/.test(res.stderr),
      `unexpected error:\n${res.stderr.slice(0, 400)}`,
    );
    // The message must name the variable, never the value.
    assert(!res.stderr.includes('somewhere'), 'the refusal message echoed the connection string');
    return `exit ${res.status}`;
  });

  const apiName = 'p20-verify-api';
  containers.push(apiName);
  docker([
    'run', '-d', '--name', apiName, '--network', NET, '-p', `127.0.0.1:${API_PORT}:3000`,
    '-e', 'NODE_ENV=production',
    '-e', `DATABASE_URL=${DB_URL_INTERNAL}`,
    '-e', `JWT_ACCESS_SECRET=${JWT_SECRET}`,
    '-e', 'STORAGE_DIR=/app/storage',
    '-v', `${STORAGE_VOLUME}:/app/storage`,
    API_IMAGE,
  ]);

  await check('liveness answers 200', async () => {
    const res = await waitForHttp(`http://127.0.0.1:${API_PORT}/api/v1/health`, {
      expect: (r) => assert(r.status === 200, `expected 200, got ${r.status}`),
    });
    assert(/"status":"ok"/.test(res.body), `unexpected liveness body: ${res.body}`);
    return res.body;
  });

  await check('readiness answers 200 with a reachable database', async () => {
    const res = await waitForHttp(`http://127.0.0.1:${API_PORT}/api/v1/health/ready`, {
      expect: (r) => assert(r.status === 200, `expected 200, got ${r.status}`),
    });
    assert(/"database":\{"status":"ok"\}/.test(res.body), `unexpected readiness body: ${res.body}`);
    return res.body;
  });

  await check('Docker HEALTHCHECK reports the container healthy', () => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const status = docker(['inspect', apiName, '--format', '{{.State.Health.Status}}']);
      if (status === 'healthy') return 'healthy';
      if (Date.now() > deadline) throw new Error(`health status stayed ${status}`);
      execFileSync('sleep', ['2']);
    }
  });

  // ------------------------------------------------- Phase 22 (F-01)
  // A real, authenticated round-trip against the running production image.
  //
  // Why this exists. Every check above proves the image *boots* and *serves
  // health*. None of them proved the application can do its actual job. That
  // blind spot had a concrete cost: `auth.controller.ts` imported its DTOs
  // with `import type`, so TypeScript elided the import and emitted
  // `design:paramtypes = [Function]` instead of `[RegisterDto]`. Nest's
  // ValidationPipe does not skip `Function`, so it ran class-validator
  // against a constructor with none of the DTO's constraints and
  // `forbidNonWhitelisted` rejected every field. In the shipped image
  // `POST /auth/register` and `POST /auth/login` both answered
  // 400 "property email should not exist" — no user could ever obtain a
  // token. The vitest suites missed it because SWC emits
  // `typeof RegisterDto === "undefined" ? Object : RegisterDto`, which
  // degrades to `Object` and IS skipped by the pipe: the test toolchain and
  // the shipping toolchain disagreed, and only the tsc output ships.
  //
  // These checks close that class for good. They use the real endpoints of
  // the real image with the real production configuration. Nothing is
  // bypassed: the access token is obtained by registering a throwaway
  // account and logging in, exactly as a client does. No test-only code path,
  // no environment variable and no flag is added to the image.
  //
  // Each mechanism is asserted in BOTH directions, so a stub cannot satisfy
  // them: a "verify" that always returns true passes the positive login and
  // fails the wrong-password case; a route with no guard passes the
  // unauthenticated case and fails the unauthenticated-rejection case.
  log('\n  Authenticated round-trip (Phase 22)');

  const API_BASE = `http://127.0.0.1:${API_PORT}/api/v1`;
  // Same origin, kept as a separate name so the Phase 23 raw-body helpers read
  // unambiguously as bypassing the JSON convenience wrappers. Two names, one
  // value — deliberately not two independently-constructed URLs.
  const API_BASE_RAW = API_BASE;
  // Fixed, not random: the gate creates its own throwaway PostgreSQL on every
  // run, so there is no pre-existing account to collide with and the check
  // stays reproducible. `.invalid` is reserved by RFC 2606 and can never be a
  // real deliverable address.
  const GATE_EMAIL = 'container-gate@p22-gate.invalid';
  const GATE_PASSWORD = 'GateVerify1x';
  const GATE_PRIVILEGED_EMAIL = 'container-gate-privileged@p22-gate.invalid';

  /** POST JSON and return {status, json}. Never throws on a non-2xx. */
  async function postJson(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    return { status: res.status, json };
  }

  /** GET with an optional bearer token. */
  async function getJson(path, token) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    return { status: res.status, json };
  }

  let gateUserId = null;
  let gateAccessToken = null;

  await check('registration through the real auth endpoint succeeds', async () => {
    const { status, json } = await postJson('/auth/register', {
      email: GATE_EMAIL,
      password: GATE_PASSWORD,
      fullName: 'Container Gate',
    });
    // A 403 "already registered" is tolerated so the block is idempotent if
    // the API container is somehow reused against a non-empty database. A 400
    // is NOT tolerated: that is the F-01 signature, where the pipe rejects
    // every field because it never sees the DTO.
    const alreadyThere = status === 403 && /already registered/i.test(json?.error?.message ?? '');
    assert(
      status === 201 || alreadyThere,
      `expected 201 from /auth/register, got ${status}: ${JSON.stringify(json)}`,
    );
    if (status === 201) {
      assert(json?.user?.id, 'register response carried no user id');
      assert(json.user.email === GATE_EMAIL, `register echoed ${json.user.email}`);
      gateUserId = json.user.id;
      return `201, user ${json.user.id}`;
    }
    return 'account already present; continuing to login';
  });

  await check('the DTO validation declared in source actually runs in the image', async () => {
    // Phase 22 (F-01) regression, asserted behaviourally. A body the
    // RegisterDto's own `@Matches` password rule must reject has to come back
    // as 400. Before the fix the pipe rejected *every* body with 400 for the
    // wrong reason, so this check is deliberately paired with the 201 above:
    // together they prove the pipe is validating against the real DTO rather
    // than passing everything through or rejecting everything.
    //
    // Only the status is asserted. GlobalExceptionFilter collapses a
    // class-validator array of messages into one generic string, so the body
    // deliberately does not say which rule failed. That is correct
    // no-information-disclosure behaviour and must not be relaxed to make an
    // assertion easier.
    const { status } = await postJson('/auth/register', {
      email: `weak-${GATE_EMAIL}`,
      password: 'alllowercase', // no uppercase, no digit
      fullName: 'Container Gate',
    });
    assert(status === 400, `a weak password was accepted (HTTP ${status})`);
    return 'weak password rejected with 400';
  });

  await check('registration cannot assign a privileged role', async () => {
    // `forbidNonWhitelisted: true` means an unknown property is a 400 rather
    // than a silently ignored field, so a client cannot smuggle in a role.
    const { status } = await postJson('/auth/register', {
      email: GATE_PRIVILEGED_EMAIL,
      password: GATE_PASSWORD,
      fullName: 'Container Gate',
      globalRole: 'SUPER_ADMIN',
    });
    assert(status === 400, `an undeclared globalRole field was accepted (HTTP ${status})`);
    const rows = docker([
      'exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc',
      `select count(*) from users where email = '${GATE_PRIVILEGED_EMAIL}'`,
    ]);
    assert(rows === '0', `the rejected registration still created a user row (${rows})`);
    const role = docker([
      'exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc',
      `select global_role from users where email = '${GATE_EMAIL}'`,
    ]);
    assert(role === 'USER', `registered user's global_role is ${role}, expected USER`);
    return 'undeclared role field rejected; stored role is USER';
  });

  await check('the persisted credential is a real Argon2id hash, not the password', async () => {
    // Proves the hashing path executed inside the image, independently of
    // whether login later succeeds. A dependency that loads but no longer
    // hashes (Phase 21 P21-01) would store the plaintext or a placeholder
    // and fail here.
    const hash = docker([
      'exec', PG_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc',
      `select password_hash from users where email = '${GATE_EMAIL}'`,
    ]);
    assert(hash.startsWith('$argon2id$'), `password_hash is not an argon2id hash: ${hash.slice(0, 40)}`);
    assert(hash !== GATE_PASSWORD, 'the password was stored in plaintext');
    assert(hash.length > 40, `password_hash looks truncated: ${hash.length} chars`);
    return `$argon2id$, ${hash.length} chars`;
  });

  await check('login rejects a wrong password', async () => {
    // The negative half of the credential check. Without it, a `verify` that
    // always returned true would pass a naive "login works" assertion.
    const { status } = await postJson('/auth/login', {
      email: GATE_EMAIL,
      password: 'DefinitelyWrong9',
    });
    assert(status === 401, `a wrong password was accepted (HTTP ${status})`);
    return '401 for a wrong password';
  });

  await check('login issues a usable access token', async () => {
    const { status, json } = await postJson('/auth/login', {
      email: GATE_EMAIL,
      password: GATE_PASSWORD,
    });
    assert(status === 201, `expected 201 from /auth/login, got ${status}: ${JSON.stringify(json)}`);
    assert(typeof json?.access === 'string' && json.access.length > 0, 'login returned no access token');
    assert(json.access.split('.').length === 3, 'access token is not a three-segment JWT');
    assert(gateUserId === null || json?.user?.id === gateUserId, `login returned user ${json?.user?.id}, expected ${gateUserId}`);
    gateUserId = json.user.id;
    gateAccessToken = json.access;
    return '201, three-segment JWT, matching user id';
  });

  await check('a protected endpoint refuses an unauthenticated request', async () => {
    // Proves the route is actually guarded. Without this, the authenticated
    // request below could pass against an endpoint that serves everyone.
    const { status, json } = await getJson('/auth/me');
    assert(status === 401, `GET /auth/me answered ${status} without a token`);
    assert(json?.error?.code === 'UNAUTHENTICATED', `unexpected error shape: ${JSON.stringify(json)}`);
    return '401 UNAUTHENTICATED';
  });

  await check('an authenticated request against a protected endpoint succeeds', async () => {
    const { status, json } = await getJson('/auth/me', gateAccessToken);
    assert(status === 200, `expected 200 from /auth/me, got ${status}: ${JSON.stringify(json)}`);
    assert(json?.id === gateUserId, `/auth/me returned id ${json?.id}, expected ${gateUserId}`);
    assert(json.email === GATE_EMAIL, `/auth/me returned email ${json.email}`);
    assert(json.globalRole === 'USER', `/auth/me returned globalRole ${json.globalRole}`);
    return `200 for ${json.email}`;
  });

  await check('a protected endpoint refuses a forged access token', async () => {
    // Phase 16 HS256 pinning, re-proved inside the image. The token below is
    // signed with the CORRECT secret but declares alg=HS384, so it is only
    // accepted if the algorithm is genuinely pinned.
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const head = b64({ alg: 'HS384', typ: 'JWT' });
    const payload = b64({
      sub: gateUserId,
      email: GATE_EMAIL,
      role: 'USER',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const signature = createHmac('sha384', JWT_SECRET).update(`${head}.${payload}`).digest('base64url');
    const { status } = await getJson('/auth/me', `${head}.${payload}.${signature}`);
    assert(status === 401, `an HS384 token signed with the real secret was accepted (HTTP ${status})`);

    // …and a structurally valid but unsigned token.
    const none2 = await getJson(
      '/auth/me',
      `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`,
    );
    assert(none2.status === 401, `an alg=none token was accepted (HTTP ${none2.status})`);
    return 'HS384 and alg=none both refused';
  });

  await check('the access token lifetime is bounded in the image (Phase 24 D-2)', async () => {
    // Phase 24 closed D-2: the guard verifies with `maxAge`, so the effective
    // validity of any accepted token is min(exp, iat + 15m) whatever the token
    // claims. The compiled-artifact suite proves this against `dist`; this
    // check proves the IMAGE a deployment runs honours it, which is the only
    // place the two can differ.
    //
    // Both halves matter. A control that refuses everything would pass the
    // first assertion, and one without the bound would pass the second, so
    // the freshly issued token is the control: it is the same token the login
    // check already proved usable, signed at a known moment.
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const mint = (claims) => {
      const head = b64({ alg: 'HS256', typ: 'JWT' });
      const body = b64({ sub: gateUserId, email: GATE_EMAIL, role: 'USER', ...claims });
      return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
    };

    const fresh = await getJson('/auth/me', mint({ iat: nowSec, exp: nowSec + 10 * 365 * 86400 }));
    assert(
      fresh.status === 200,
      `a correctly signed token issued now with a ten-year exp was refused (HTTP ${fresh.status}). The lifetime ` +
        'bound is stricter than a bound-by-age; investigate before relaxing this check.',
    );

    // The defect itself: correctly signed, real secret, unexpired for ten
    // years, issued an hour ago. Before the D-2 fix this was accepted.
    const aged = await getJson('/auth/me', mint({ iat: nowSec - 3600, exp: nowSec + 10 * 365 * 86400 }));
    assert(
      aged.status === 401,
      `a correctly signed token one hour old with a ten-year exp was ACCEPTED (HTTP ${aged.status}). The ` +
        'access-token lifetime is unbounded in the image, so a leaked long-lived token is never retired. This is ' +
        'deferred finding D-2 reopening.',
    );
    return 'fresh token accepted, one-hour-old token with a ten-year exp refused';
  });

  await check('the access token is not reusable as a refresh token', async () => {
    // Phase 16 (H11/A16) delivery contract: the short-lived access token must
    // not be accepted by the refresh endpoint, or a leaked access token would
    // silently mint a 30-day session. This is the only check that touches
    // /auth/refresh; keeping it to one call keeps the whole block well inside
    // the production rate limiter's 10-requests-per-15-minutes budget, which
    // is itself part of what is under test.
    const { status } = await postJson('/auth/refresh', { refreshToken: gateAccessToken });
    assert(status === 401, `the access token was accepted as a refresh token (HTTP ${status})`);
    return '401 when presented to /auth/refresh';
  });

  // ------------------------------------------------- Phase 23 (W7)
  // Container regression for the Phase 23 findings.
  //
  // Each check below corresponds to a defect found and fixed in this phase,
  // and each is asserted against the RUNNING IMAGE rather than against the
  // source, because "the source is correct" and "the shipped artifact is
  // correct" diverged in Phase 22. The bodies are deliberately large: a check
  // that ran against a small payload would pass under a parser limit that
  // still breaks every real document.
  log('\n  Phase 23 regressions (request-size, error-boundary, rate-limit)');

  /** Raw POST with a body of an exact byte size, bypassing JSON helpers. */
  async function postRaw(path, bodyString, token) {
    const res = await fetch(`${API_BASE_RAW}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: bodyString,
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* asserted on below */
    }
    // `headers` is returned so the Phase 28 rate-limit check can assert on
    // `Retry-After` without issuing a second request — issuing one would
    // spend a unit of the very budget that check is measuring.
    return { status: res.status, json, text, headers: res.headers };
  }

  await check('a body well above body-parser default is parsed, not refused', async () => {
    // Phase 23 (W4): body-parser's 100kb default made every document larger
    // than ~75KB impossible to upload, and the failure surfaced as a 500
    // because PayloadTooLargeError is not an HttpException. Before the fix
    // this request answered 500; a naive fix that only changed the status
    // code would still refuse every real document, so the assertion is that
    // the request is PARSED and then rejected by the DTO, not by the parser.
    const payload = JSON.stringify({
      email: `p23-size-${Date.now()}@container-gate.invalid`,
      // 512KB — five times the old default, and far past the point where a
      // small-payload test would notice.
      password: 'x'.repeat(512 * 1024),
      fullName: 'P23 Size',
    });
    const { status, json } = await postRaw('/auth/register', payload);
    assert(
      status === 400,
      `a 512KB body answered ${status}; the parser refused it. Phase 23 raised the limit to match the ` +
        `document contract, so a large-but-permitted body must be parsed and then rejected by the DTO. Body: ` +
        `${String(json?.error?.message ?? '').slice(0, 160)}`,
    );
    assert(
      json?.error?.code !== 'PAYLOAD_TOO_LARGE',
      'a 512KB body was refused by the parser limit rather than parsed; the document contract is still unreachable',
    );
    return 'parsed, then rejected by the DTO with 400';
  });

  await check('a body past the absolute limit is 413 with the standard envelope', async () => {
    // 32MB, past the 24MB ceiling. Also proves the boundary is a real ceiling
    // and not "no limit at all", which would be a denial-of-service vector.
    const payload = JSON.stringify({
      email: `p23-huge-${Date.now()}@container-gate.invalid`,
      password: 'z'.repeat(32 * 1024 * 1024),
      fullName: 'P23 Huge',
    });
    const { status, json, text } = await postRaw('/auth/register', payload);
    assert(status === 413, `a 32MB body answered ${status}, expected 413`);
    assert(json?.error?.code === 'PAYLOAD_TOO_LARGE', `the 413 carried code ${json?.error?.code}`);
    assert(Boolean(json?.error?.requestId), 'the 413 carried no requestId');
    assert(
      !/postgres|argon2|node_modules|raw-body|body-parser/.test(text),
      `the 413 leaked internal detail: ${text.slice(0, 200)}`,
    );
    return '413 PAYLOAD_TOO_LARGE, envelope intact';
  });

  await check('a malformed identifier in a path is 400, not a 500', async () => {
    // Phase 23 (W4): this reached Prisma as P2023 "Inconsistent column data"
    // and became an unhandled 500 with a stack in the log. One representative
    // route is enough: the failure is in the error boundary, which is shared.
    const res = await fetch(`${API_BASE_RAW}/seniors/not-a-uuid/medications`, {
      headers: { authorization: `Bearer ${gateAccessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* asserted below */
    }
    assert(
      res.status === 400,
      `a non-UUID path segment answered ${res.status}, expected 400. Body: ${text.slice(0, 200)}`,
    );
    assert(json?.error?.code === 'INVALID_IDENTIFIER', `the 400 carried code ${json?.error?.code}`);
    assert(!/prisma|Inconsistent column data|at \w+ \(/.test(text), 'the 400 leaked driver detail');
    return '400 INVALID_IDENTIFIER with no driver detail';
  });

  await check('a validation failure is a 400 with no driver detail', async () => {
    // The impossible-date case (2026-13-45T99:99:99.000Z) lives on the
    // appointment and measurement DTOs, both of which sit behind an
    // AuthorizationService care-circle check, so this gate — which holds no
    // care circle — cannot reach them. Reaching one would require seeding a
    // senior, a circle and a membership, which is what
    // test/validation-boundary.security.e2e-spec.ts does against a real
    // database. What IS reachable from here is the shared error boundary
    // that the date fix also relies on: a body the DTO rejects must answer a
    // 4xx carrying the standard envelope and no internal detail.
    const res = await fetch(`${API_BASE_RAW}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `p23-invalid-${Date.now()}@container-gate.invalid`,
        password: 'Aa1!aaaa',
        fullName: 'P23 Invalid',
        // Undeclared: the strict whitelist must refuse it rather than
        // silently stripping it and creating the account.
        measuredAt: '2026-13-45T99:99:99.000Z',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* asserted below */
    }
    assert(res.status === 400, `an undeclared field answered ${res.status}, expected 400`);
    assert(Boolean(json?.error?.code), 'the 400 carried no error code');
    assert(Boolean(json?.error?.requestId), 'the 400 carried no requestId');
    assert(
      !/prisma|Invalid Date|argon2|node_modules|at \w+ \(/.test(text),
      `the 400 leaked internal detail: ${text.slice(0, 200)}`,
    );
    return '400, standard envelope, no driver detail';
  });

  await check('the password policy is enforced in the image and is not a ReDoS', async () => {
    // Phase 23 (W4): the old `@Matches` pattern was quadratic. A 16KB
    // password took ~0.9s of blocked event loop; 256KB took ~240s, during
    // which the process served nothing at all — not even the health probe.
    // The rewritten policy is linear, so the same input is fast. Measured on
    // the image, with the request itself as the probe: this is the property
    // that matters, not a microbenchmark.
    const password = 'x'.repeat(64 * 1024);
    const started = Date.now();
    const { status } = await postRaw(
      '/auth/register',
      JSON.stringify({
        email: `p23-redos-${Date.now()}@container-gate.invalid`,
        password,
        fullName: 'P23 ReDoS',
      }),
    );
    const elapsed = Date.now() - started;
    assert(status === 400, `a 64KB password answered ${status}, expected 400`);
    assert(
      elapsed < 5_000,
      `validating a 64KB password took ${elapsed}ms in the image. The quadratic pattern took ~15s at this size ` +
        'and ~240s at 256KB, blocking the whole event loop.',
    );

    // And the policy still rejects a weak password quickly, so the fast path
    // is not simply "accept everything".
    const weak = await postRaw(
      '/auth/register',
      JSON.stringify({
        email: `p23-weak-${Date.now()}@container-gate.invalid`,
        password: 'alllowercase',
        fullName: 'P23 Weak',
      }),
    );
    assert(weak.status === 400, `a weak password answered ${weak.status}, expected 400`);
    return `64KB rejected in ${elapsed}ms; weak password still refused`;
  });

  await check('the API still answers its liveness probe after the stress probes', async () => {
    // The ReDoS check is only meaningful if the process survived it. A hung
    // event loop would fail here rather than being reported as "slow".
    const started = Date.now();
    const res = await fetch(`${API_BASE_RAW}/health`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.text();
    const elapsed = Date.now() - started;
    assert(res.status === 200, `liveness answered ${res.status} after the stress probes`);
    assert(body.includes('"status":"ok"'), `liveness reported ${body.slice(0, 120)}`);
    assert(elapsed < 2_000, `liveness took ${elapsed}ms, so the event loop was still congested`);
    return `answered in ${elapsed}ms`;
  });

  await check('the rate limiter is enforced in the image', async () => {
    // Phase 16/18 established that the limiter runs in production and that
    // the test-only bypass is inert outside NODE_ENV=test. The container runs
    // with NODE_ENV=production, so this proves the limiter is genuinely armed
    // in the artifact a deployment runs — which the source-level suites
    // cannot, because they run with the bypass deliberately enabled.
    //
    // Phase 28 (N-12): the refusal is 429. This check asserts the status
    // specifically, because a gate that merely looked for "some refusal"
    // would still be green against the 403 defect it exists to prevent. It
    // also asserts `RATE_LIMITED` in the envelope, which the global filter
    // derives from the status, and `Retry-After`, so the 429 cannot be
    // faked by an unrelated component emitting the number.
    const email = `p23-rl-${Date.now()}@container-gate.invalid`;
    let limited = false;
    // 14 attempts: the production budget is 10 per IP per 15 minutes.
    for (let i = 0; i < 14; i += 1) {
      const { status, json, headers } = await postRaw('/auth/login', JSON.stringify({ email, password: `Wrong${i}pass1` }));
      if (status === 429 && /rate limit/i.test(json?.error?.message ?? '')) {
        // The refusal must be identifiable as throttling, not as an
        // authorization failure, and must tell the caller when to return.
        if (json?.error?.code !== 'RATE_LIMITED') {
          throw new Error(
            `a rate-limited request answered 429 but error.code was ${JSON.stringify(json?.error?.code)}; ` +
              'the global filter did not classify it as RATE_LIMITED',
          );
        }
        const retryAfter = headers?.get?.('retry-after');
        if (!/^\d+$/.test(String(retryAfter)) || Number.parseInt(String(retryAfter), 10) <= 0) {
          throw new Error(
            `a 429 in the image carried Retry-After=${JSON.stringify(retryAfter)}; it must be a positive ` +
              'integer number of seconds (RFC 9110 §10.2.3)',
          );
        }
        limited = true;
        break;
      }
      // A 403 here is the pre-Phase-28 behaviour and must fail loudly rather
      // than being accepted as "some refusal happened".
      if (status === 403 && /rate limit/i.test(json?.error?.message ?? '')) {
        throw new Error(
          'the image answered 403 Forbidden for an exhausted rate-limit budget. That is the N-12 defect: ' +
            'throttling must be 429, and 403 is indistinguishable from an authorization failure.',
        );
      }
    }
    assert(
      limited,
      '14 failed logins from one IP never produced a rate-limit refusal. The limiter is not armed in the image, ' +
        'so credential stuffing is unthrottled in the artifact a deployment actually runs.',
    );
    return 'a rate-limit refusal was produced within the production budget';
  });

  await check('authorization refusals in the image are 403, not 429', async () => {
    // The converse of the check above, and the one that catches a "fix"
    // implemented by widening every 4xx to 429.
    //
    // `GET /seniors/<uuid>/medications` is guarded by JwtAuthGuard +
    // RolesGuard and is NOT decorated with `@RateLimit()`, so the limiter
    // cannot influence it. The gate's own valid access token is used, and a
    // random senior id guarantees no care-circle membership, so
    // `assertCanAccessSenior` throws a genuine ForbiddenException. A control
    // assertion first proves the route is reachable at all — a 401 or 404
    // here would mean the 403 was produced by something other than the
    // authorization check, and the check below would be vacuous.
    const seniorId = randomUUID();
    const res = await fetch(`${API_BASE_RAW}/seniors/${seniorId}/medications`, {
      headers: { authorization: `Bearer ${gateAccessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* asserted below */
    }
    assert(
      res.status === 403,
      `an authenticated user with no care-circle membership was answered ${res.status} on a senior-scoped route, ` +
        `not 403. Body: ${text.slice(0, 200)}. Phase 28 changed the rate-limit status only; an authorization ` +
        'refusal must be unaffected.',
    );
    assert(
      json?.error?.code === 'FORBIDDEN',
      `the authorization refusal reported code ${JSON.stringify(json?.error?.code)}, expected FORBIDDEN`,
    );
    assert(
      json?.error?.code !== 'RATE_LIMITED',
      'an authorization refusal was reported as RATE_LIMITED; 403 and 429 are no longer distinguishable',
    );
    // A genuine authorization refusal is terminal: retrying will not help,
    // so advertising a retry delay would be a lie.
    assert(
      res.headers.get('retry-after') === null,
      `a 403 authorization refusal advertised Retry-After: ${res.headers.get('retry-after')}; only a throttled ` +
        'response may carry one',
    );
    return 'a real authorization refusal is 403 FORBIDDEN with no Retry-After';
  });

  // ------------------------------------------------- Phase 21 (L-03)
  // These run against the LIVE api container, as the runtime uid, and
  // attempt real writes. They are not satisfied by reading a mode
  // column: Phase 20's `COPY --chown=1000:1000` tree was 0644/0755
  // 1000:1000, i.e. "read-only-looking" but writable by the exact user
  // that runs the process, and only a write attempt proves the
  // difference.
  await check('no application path is writable by the runtime user', () => {
    const script = [
      'uid=$(id -u)',
      'before=$(wc -c < /app/dist/main.js)',
      'tampered=""',
      // 1. append to the application entry point
      '(echo tampered >> /app/dist/main.js) 2>/dev/null && tampered="$tampered dist/main.js"',
      // 2. rewrite the Prisma schema that migrations are generated from
      '(echo tampered >> /app/prisma/schema.prisma) 2>/dev/null && tampered="$tampered prisma/schema.prisma"',
      // 3. rewrite the executable the documented migration command runs
      '(echo tampered >> /app/node_modules/.bin/prisma) 2>/dev/null && tampered="$tampered node_modules/.bin/prisma"',
      // 4. replace a dependency so require() loads attacker code
      '(echo tampered > /app/node_modules/tampered.js) 2>/dev/null && tampered="$tampered node_modules/tampered.js"',
      // 5. shadow the entry point entirely
      '(echo tampered > /app/dist/tampered.js) 2>/dev/null && tampered="$tampered dist/tampered.js"',
      // 6. rewrite package.json (e.g. to add a prestart hook)
      '(echo tampered >> /app/package.json) 2>/dev/null && tampered="$tampered package.json"',
      // 7. create a new top-level entry in the application directory
      '(mkdir /app/tampered) 2>/dev/null && tampered="$tampered mkdir:/app/tampered"',
      'after=$(wc -c < /app/dist/main.js)',
      '[ "$before" = "$after" ] || tampered="$tampered dist/main.js-changed"',
      '[ -n "$tampered" ] && { echo "WRITABLE: $tampered"; exit 1; }',
      'echo "uid=$uid denied every write under /app"',
    ].join('\n');
    const out = docker(['exec', apiName, 'sh', '-c', script]);
    assert(/^uid=1000 denied every write under \/app$/.test(out), `unexpected result: ${out}`);
    return out;
  });

  await check('the tamper probes left no trace in the running container', () => {
    // The running container's /app must still hash-match the image. A
    // successful write attempt (even one that was later reverted) would
    // break the match, and a probe file that survived would show up here.
    const paths = '/app/dist/main.js /app/package.json /app/prisma/schema.prisma /app/node_modules/.bin/prisma';
    const inImage = docker(['run', '--rm', '--entrypoint', 'md5sum', API_IMAGE, ...paths.split(' ')]);
    const inRunning = docker(['exec', apiName, 'md5sum', ...paths.split(' ')]);
    assert(inImage === inRunning, `running container diverged from the image:\n${inImage}\n${inRunning}`);
    const residue = docker(['exec', apiName, 'find', '/app', '-name', 'tampered*']);
    assert(residue === '', `tamper artefacts were persisted: ${residue}`);
    return 'md5 of 4 paths unchanged, no tampered* files';
  });

  await check('STORAGE_DIR is writable by the runtime user', () => {
    const script = [
      'umask 000',
      'mkdir -p "$STORAGE_DIR/writable" || exit 1',
      'printf probe > "$STORAGE_DIR/writable/probe" || exit 1',
      'test "$(cat "$STORAGE_DIR/writable/probe")" = probe || exit 1',
      'rm -rf "$STORAGE_DIR/writable"',
      'echo "wrote and read back under $STORAGE_DIR as uid $(id -u)"',
    ].join('\n');
    const out = docker(['exec', apiName, 'sh', '-c', script]);
    assert(/wrote and read back under \/app\/storage as uid 1000/.test(out), `unexpected result: ${out}`);
    return out;
  });

  await check('Phase 18 0600/0700 storage modes are still enforced in the image', () => {
    // Drives the *application's own* StorageService, not a shell
    // approximation of it, so this proves the read-only /app did not
    // force the storage hardening to be relaxed.
    const script = [
      'const fs = require("fs");',
      'const { StorageService } = require("/app/dist/storage/storage.service.js");',
      '(async () => {',
      '  const s = new StorageService();',
      '  const key = "p21-check/document.txt";',
      '  const o = await s.upload(Buffer.from("protected"), key, "text/plain");',
      '  const file = fs.statSync(`${process.env.STORAGE_DIR}/${key}`);',
      '  const dir = fs.statSync(`${process.env.STORAGE_DIR}/p21-check`);',
      '  const back = await s.retrieve(key);',
      '  await s.delete(key);',
      '  const mode = (st) => (st.mode & 0o777).toString(8);',
      '  if (mode(file) !== "600") throw new Error(`file mode ${mode(file)}`);',
      '  if (mode(dir) !== "700") throw new Error(`dir mode ${mode(dir)}`);',
      '  if (back.toString() !== "protected") throw new Error("content mismatch");',
      '  if (await s.exists(key)) throw new Error("delete did not remove the object");',
      '  console.log(`file=${mode(file)} dir=${mode(dir)} roundtrip=ok`);',
      '})().catch((e) => { console.error(e.message); process.exit(1); });',
    ].join('\n');
    const out = docker(['exec', apiName, 'node', '-e', script]);
    assert(out === 'file=600 dir=700 roundtrip=ok', `unexpected result: ${out}`);
    return out;
  });

  await check('production start is still refused for a group/other-readable STORAGE_DIR', () => {
    const res = spawnSync(
      'docker',
      [
        'run', '--rm', '--network', NET,
        '-e', 'NODE_ENV=production',
        '-e', `DATABASE_URL=${DB_URL_INTERNAL}`,
        '-e', `JWT_ACCESS_SECRET=${JWT_SECRET}`,
        '-e', 'STORAGE_DIR=/app/storage',
        // A tmpfs is used so the loose mode is disposable and does not
        // need a second volume or a host directory.
        '--tmpfs', '/app/storage:rw,mode=0755',
        API_IMAGE,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    assert(res.status !== 0, 'container started with a 0755 STORAGE_DIR (expected refusal)');
    assert(
      /STORAGE_DIR has permissions 0755/.test(res.stderr),
      `unexpected error:\n${res.stderr.slice(0, 400)}`,
    );
    return `exit ${res.status}`;
  });

  // ------------------------------------------------------------- Web image
  log('\nWeb container');

  // The web health check below needs a *live* API, so the SIGTERM check
  // is deliberately performed at the very end, after the web section.

  const webName = 'p20-verify-web';
  containers.push(webName);
  docker([
    'run', '-d', '--name', webName, '--network', NET, '-p', `127.0.0.1:${WEB_PORT}:3001`,
    '-e', `NEXT_PUBLIC_API_URL=http://${apiName}:3000`,
    WEB_IMAGE,
  ]);

  await check('home page renders 200', async () => {
    const res = await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, {
      expect: (r) => assert(r.status === 200, `expected 200, got ${r.status}`),
    });
    assert(/Elderly Care Coordination/.test(res.body), 'home page did not render the expected content');
    return '200 with expected content';
  });

  await check('dashboard route renders', async () => {
    const res = await waitForHttp(`http://127.0.0.1:${WEB_PORT}/dashboard`, {
      expect: (r) => assert(r.status === 200, `expected 200, got ${r.status}`),
    });
    return `HTTP ${res.status}`;
  });

  await check('static assets are served', async () => {
    const home = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
    const html = await home.text();
    const asset = html.match(/\/_next\/static\/css\/[A-Za-z0-9]+\.css/);
    assert(asset, 'no hashed CSS asset referenced by the home page');
    const res = await fetch(`http://127.0.0.1:${WEB_PORT}${asset[0]}`);
    assert(res.status === 200, `static asset returned ${res.status}`);
    return asset[0];
  });

  await check('health page reports the live API as ok', async () => {
    const res = await waitForHttp(`http://127.0.0.1:${WEB_PORT}/health`, {
      expect: (r) => assert(r.status === 200, `expected 200, got ${r.status}`),
    });
    assert(/Status:[\s\S]{0,40}ok/.test(res.body), 'health page did not report the API as ok');
    assert(!/ECONNREFUSED|127\.0\.0\.1:3000/.test(res.body), 'health page leaked an internal address');
    return 'status ok';
  });

  await check('unknown route returns 404', async () => {
    const res = await fetch(`http://127.0.0.1:${WEB_PORT}/p20-no-such-route`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
    return '404';
  });

  // --- Phase 36 (P35-1): the image-optimizer endpoint in the REAL image -----
  //
  // `verify-next-image-optimizer.mjs` proves the endpoint is dead in the
  // standalone server built from the source tree. This proves it in the artifact
  // that is actually shipped. The two are not the same thing: the image copies
  // `.next/standalone` and `.next/static` across stages, and a build that is
  // correct locally can still produce an image whose traced tree differs.
  //
  // The Phase 35 review demonstrated this endpoint answering HTTP 200 with image
  // bytes, unauthenticated, in the production container built from HEAD — so
  // asserting it in the container is the only assertion that closes P35-1 rather
  // than restating the source configuration.
  await check('the image-optimization endpoint does not serve an image (Phase 36 P35-1)', async () => {
    // Stage a REAL png in the running container's public/ directory first. A
    // request for a missing file answers 400 from inside the optimizer ("isn't
    // a valid image"), which looks like a refusal but is actually the optimizer
    // RUNNING — the exact misreading Phase 35 recorded, where a 400 carrying
    // the optimizer's own error string was cited as evidence the endpoint was
    // absent. With a decodable image present, an enabled optimizer answers 200
    // and a disabled one answers 404, so this probe distinguishes the two.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAQAAAAECCAYAAACqaXHeAAAAKUlEQVR42mNk+M9QzzCKRsEoGgWjYBSMDIzEPIQwGDKgYh' +
        'oEDEgwYhAKMDAxMDD8Z2AAAX8lCiuAAAAAElFTkSuQmCC',
      'base64',
    );
    const tmp = '/tmp/p36-probe.png';
    writeFileSync(tmp, png);
    docker(['cp', tmp, `${webName}:/app/apps/web/public/p36-probe.png`]);
    rmSync(tmp, { force: true });

    const results = [];
    for (const [label, target] of [
      ['local png', '%2Fp36-probe.png'],
      ['remote url', 'https%3A%2F%2Fexample.com%2Fx.png'],
    ]) {
      const res = await fetch(`http://127.0.0.1:${WEB_PORT}/_next/image?url=${target}&w=64&q=75`, {
        headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      });
      const contentType = res.headers.get('content-type') ?? '';
      assert(
        !(res.status === 200 && /^image\//.test(contentType)),
        `/_next/image (${label}) answered ${res.status} ${contentType} — that is the P35-1 state: a live, ` +
          'unauthenticated Image Optimization endpoint in the shipped image',
      );
      results.push(`${label}: ${res.status} ${contentType || '(no content-type)'}`);
    }
    return results.join('; ');
  });

  await check('the shipped image records the optimizer as disabled (Phase 36 P35-1)', async () => {
    // `images-manifest.json` is a BUILD artifact and is deliberately NOT copied
    // into the runtime image — the Dockerfile copies only `.next/standalone` and
    // `.next/static`, so there is nothing to read here. That absence is itself
    // worth asserting: it means the image cannot be shipped with a stale
    // manifest claiming a different posture than the server it runs. The
    // build-time half of this check lives in `verify-next-image-optimizer.mjs`,
    // and the runtime half is the probe above.
    const found = docker(['exec', webName, 'sh', '-c', 'find / -name images-manifest.json 2>/dev/null | head -1']);
    assert(
      found === '',
      `the runtime image ships a build manifest at ${found}, which the Dockerfile should not copy; ` +
        'a manifest in the image can disagree with the server that actually runs',
    );
    return 'no build manifest in the runtime image (only the traced server and static assets)';
  });

  // ------------------------------------------------------------- shutdown
  log('\nGraceful shutdown');

  await check('SIGTERM drains and exits cleanly', () => {
    const started = Date.now();
    const stopped = spawnSync('docker', ['stop', '-t', '20', apiName], { encoding: 'utf8' });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    assert(stopped.status === 0, `docker stop failed: ${stopped.stderr}`);
    // Exit code 0 (not 143) proves the SIGTERM handler ran Nest's
    // shutdown hooks and the process exited by itself; 143 would mean the
    // signal was never handled and the process was killed.
    const exitCode = docker(['inspect', apiName, '--format', '{{.State.ExitCode}}']);
    const oom = docker(['inspect', apiName, '--format', '{{.State.OOMKilled}}']);
    assert(exitCode === '0', `expected exit code 0 after SIGTERM, got ${exitCode} (143 = killed by signal)`);
    assert(oom === 'false', 'container was OOM-killed');
    return `exit 0 in ${elapsed}s`;
  });

  await check('API stops serving after shutdown', async () => {
    try {
      await fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    } catch {
      return 'connection refused, as expected';
    }
    throw new Error('API still answered after being stopped');
  });

  await check('the web container also stops cleanly on SIGTERM', () => {
    const stopped = spawnSync('docker', ['stop', '-t', '20', webName], { encoding: 'utf8' });
    assert(stopped.status === 0, `docker stop failed: ${stopped.stderr}`);
    const exitCode = docker(['inspect', webName, '--format', '{{.State.ExitCode}}']);
    const oom = docker(['inspect', webName, '--format', '{{.State.OOMKilled}}']);
    assert(exitCode === '0', `expected exit code 0 after SIGTERM, got ${exitCode}`);
    assert(oom === 'false', 'web container was OOM-killed');
    return 'exit 0';
  });

  await check('web stops serving after shutdown', async () => {
    try {
      await fetch(`http://127.0.0.1:${WEB_PORT}/`, { signal: AbortSignal.timeout(5000) });
    } catch {
      return 'connection refused, as expected';
    }
    throw new Error('web still answered after being stopped');
  });
}

main()
  .catch((err) => {
    failures += 1;
    console.error(`\n  ERROR  ${err.message ?? err}`);
  })
  .finally(() => {
    cleanup();
    if (failures > 0) {
      console.error(`\nFAILED: ${failures} check(s) did not pass.\n`);
      process.exit(1);
    }
    console.log('\nAll container build and runtime checks passed.\n');
  });
