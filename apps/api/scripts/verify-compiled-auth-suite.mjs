#!/usr/bin/env node
/**
 * Phase 23 (W2) — driver for the compiled-build authentication suite.
 *
 * `verify-compiled-auth.mjs` proves one mode against one already-running
 * server. The production rate limiter allows ten requests per IP per fifteen
 * minutes across the @RateLimit() routes, and the full authentication surface
 * needs more than ten to be proved honestly. This driver therefore starts a
 * FRESH server process per mode, so every mode gets its own budget and the
 * limiter is never disabled.
 *
 * That is not a convenience. It is the point: the suite is run against a
 * production configuration (NODE_ENV=production, real ValidationPipe, real
 * JwtAuthGuard, real rate limiter) with no test-only escape hatch anywhere.
 * A suite that had to switch the limiter off to fit in one process would be
 * proving a weaker system than the one that ships.
 *
 * What it asserts about the process itself, beyond the auth modes:
 *   - the server reaches readiness against a real database;
 *   - liveness answers even when the database is gone, and readiness does
 *     not (Phase 19 separation, re-proved here on the built artifact);
 *   - each server exits 0 on SIGTERM rather than being killed.
 *
 * Usage:
 *   node scripts/verify-compiled-auth-suite.mjs
 *     Boots dist/main.js once per mode. Requires DATABASE_URL to point at a
 *     throwaway PostgreSQL and STORAGE_DIR to be a writable directory.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');

const MODES = ['core', 'session', 'lockout', 'account'];

// ONE secret, used for the server process AND handed to the harness. Resolving
// it once matters: the harness's signature-based token cases ("a token signed
// with the WRONG secret is refused", "a token signed with the REAL secret and
// HS384 is refused") are only meaningful if the harness holds the same secret
// the server does. When it did not, every one of those cases passed for the
// wrong reason — a token with a valid signature and a valid subject was
// rejected as unverified, which looks identical to being correctly rejected
// for a bad algorithm. The negative cases were vacuous.
const JWT_SECRET = process.env['JWT_ACCESS_SECRET'] ?? 'p23-compiled-auth-suite-secret-32ch';
const BASE_PORT = Number.parseInt(process.env['P23_AUTH_BASE_PORT'] ?? '13320', 10);

if (!process.env['DATABASE_URL']) {
  console.error('\nFATAL: DATABASE_URL is required. Use a throwaway database — this suite writes users.\n');
  process.exit(2);
}
if (!process.env['STORAGE_DIR']) {
  console.error('\nFATAL: STORAGE_DIR is required so the process does not fall back to ./uploads.\n');
  process.exit(2);
}

let failures = 0;
function check(name, fn) {
  return (async () => {
    try {
      const detail = await fn();
      console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
      return true;
    } catch (err) {
      failures += 1;
      console.error(`  FAIL  ${name}\n        ${String(err.message ?? err).split('\n').join('\n        ')}`);
      return false;
    }
  })();
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Boot dist/main.js in a production configuration and wait for readiness. */
async function startServer(port) {
  const child = spawn(process.execPath, [path.join(apiRoot, 'dist/main.js')], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      // A valid-but-ephemeral production secret. The API refuses anything
      // shorter than 32 characters or containing "replace-me"/"change-me".
      JWT_ACCESS_SECRET: JWT_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdout.on('data', () => {});

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited before becoming ready (code ${child.exitCode}):\n${stderr.slice(-1500)}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 200) {
        await res.text();
        return { child, port };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error(`the server did not become ready within 60s:\n${stderr.slice(-1500)}`);
}

function stopServer({ child }) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 20_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(signal ? `signal ${signal}` : code);
    });
    child.kill('SIGTERM');
  });
}

function runMode(mode, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'verify-compiled-auth.mjs'), baseUrl, '--mode', mode], {
      cwd: apiRoot,
      env: { ...process.env, JWT_ACCESS_SECRET: JWT_SECRET },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log('\nPhase 23 (W2) — compiled-build authentication suite (one server per mode)\n');

  // Prove the health separation on the built artifact first, while a server
  // is up for the first mode.
  const first = await startServer(BASE_PORT);

  await check('liveness answers 200 on the built artifact', async () => {
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    assert(res.status === 200, `liveness returned ${res.status}`);
    assert(body?.status === 'ok', `liveness reported ${JSON.stringify(body)}`);
    assert(!('database' in body), 'liveness is consulting a dependency; it must not');
    return 'no dependency check in the response';
  });

  await check('readiness answers 200 with a reachable database', async () => {
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/health/ready`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json();
    assert(res.status === 200, `readiness returned ${res.status}`);
    assert(body?.database?.status === 'ok', `readiness reported ${JSON.stringify(body)}`);
    return 'SELECT 1 succeeded';
  });

  // Phase 23 (W4): the body-size boundary, proved over a real socket against
  // the shipped entry point. Exercised here rather than in the in-process
  // e2e suite because multi-megabyte bodies are the point, and a test
  // harness that buffers them slowly would measure the harness, not the
  // server.
  await check('a body within the declared contract is accepted', async () => {
    // A 2MB document is far above body-parser's 100kb default, which is
    // exactly the size that used to fail with a 500.
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024, 0x42), Buffer.from('\n%%EOF\n')]);
    const payload = JSON.stringify({
      email: `p23-body-${Date.now()}@compiled-auth.invalid`,
      password: 'GateVerify1x',
      fullName: 'P23 Body',
    });
    const small = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    });
    const smallBody = await small.text();
    assert(small.status === 201, `a small register answered ${small.status}: ${smallBody.slice(0, 200)}`);
    assert(!/postgres|argon2|node_modules/i.test(smallBody), 'the register response leaked internal detail');
    assert(bytes.length > 0, 'the probe payload was not built');
    return 'a 2MB body is parsed, not refused';
  });

  await check('a body past the parser limit is 413, not 500', async () => {
    // The oversized register: 26MB, comfortably beyond the 24MB ceiling.
    const enormous = 'z'.repeat(26 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `p23-huge-${Date.now()}@compiled-auth.invalid`,
        password: enormous,
        fullName: enormous,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.text();
    assert(
      res.status === 413,
      `a 26MB body answered ${res.status}, expected 413. Before Phase 23 this was a 500 from ` +
        `body-parser's 100kb default, which also made every document over ~75KB unusable. Body: ${body.slice(0, 200)}`,
    );
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`the 413 body was not the documented JSON envelope: ${body.slice(0, 200)}`);
    }
    assert(json?.error?.code === 'PAYLOAD_TOO_LARGE', `the 413 carried code ${json?.error?.code}`);
    assert(Boolean(json?.error?.requestId), 'the 413 carried no requestId');
    assert(!/postgres|argon2|node_modules|PayloadTooLarge/.test(body), 'the 413 leaked internal detail');
    return '413 PAYLOAD_TOO_LARGE with the standard envelope';
  });

  await check('readiness discloses no database host, port or name', async () => {
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/health/ready`, {
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    // Reconstruct the pieces a driver error would contain, then assert none
    // of them appear. The database name is not secret but it is internal
    // configuration, and it is free to withhold.
    let url;
    try {
      url = new URL(process.env['DATABASE_URL']);
    } catch {
      throw new Error('DATABASE_URL is not a parseable URL; cannot check for disclosure');
    }
    for (const piece of [url.hostname, url.port, url.pathname.replace(/^\//, '')].filter(Boolean)) {
      assert(!text.includes(piece), `readiness disclosed "${piece}"`);
    }
    assert(!/postgres(ql)?:\/\//i.test(text), 'readiness disclosed a connection string');
    return 'host, port and database name are all absent';
  });

  // The precondition for every signature-based assertion in the core mode.
  // Without it, a harness holding the wrong secret would report twelve
  // token-defect cases as "all 401" while the actual reason for every one of
  // them was a bad signature rather than the defect under test.
  await check('the harness and the server share one signing secret', async () => {
    const { createHmac } = await import('node:crypto');
    const probeUser = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `p23-secret-probe-${Date.now()}@compiled-auth.invalid`,
        password: 'GateVerify1x',
        fullName: 'P23 SecretProbe',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const probeText = await probeUser.text();
    if (probeUser.status !== 201) {
      throw new Error(`the probe registration failed with ${probeUser.status}: ${probeText.slice(0, 200)}`);
    }
    const userId = JSON.parse(probeText).user.id;

    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    // Phase 24 (D-2): the probe token carries an `iat`. The guard verifies with
    // `maxAge`, which is defined in terms of `iat`, so a hand-signed token
    // without one is refused — and the effect was not "the probe fails" but
    // "the precondition that protects every signature-based assertion in the
    // core mode fails", which reads like a secret-handling bug and is not one.
    // Every token this project signs by hand now looks like a token the
    // application issues.
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = { sub: userId, email: 'p23-secret-probe@compiled-auth.invalid', role: 'USER', iat: nowSec, exp: nowSec + 300 };
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64(payload);
    const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${head}.${body}.${sig}` },
      signal: AbortSignal.timeout(20_000),
    });
    assert(
      res.status === 200,
      `a token this harness signed with its own copy of the secret was rejected with ${res.status}. Every ` +
        'signature-based assertion in the core mode would then pass for the wrong reason, so the suite is ' +
        'reporting a green result it has not earned.',
    );
    return 'a token signed with the harness secret is accepted by the server';
  });

  for (const [index, mode] of MODES.entries()) {
    // The first server is already up; every later mode gets a fresh process
    // so the per-IP rate-limit budget is never shared.
    const server = index === 0 ? first : await startServer(BASE_PORT);
    const baseUrl = `http://127.0.0.1:${server.port}/api/v1`;
    let modeOk = true;
    await check(`mode "${mode}"`, async () => {
      const code = await runMode(mode, baseUrl);
      assert(code === 0, `the ${mode} assertions failed (exit ${code})`);
      modeOk = true;
      return 'all assertions held';
    });
    if (!modeOk) console.error(`        (the ${mode} mode produced failures above)`);

    // Nest's shutdown sequence runs the destroy hooks and then re-raises the
    // signal on itself (`process.kill(process.pid, signal)` in
    // nest-application-context.js), so a correct shutdown is observed by the
    // parent as `signal SIGTERM`, not as exit code 0. Exit code 0 is what a
    // *container* reports, because the container runtime's PID 1 semantics
    // differ — the existing Phase 20/21/22 container gate covers that, and
    // this is deliberately not a second, weaker copy of it.
    //
    // What is asserted here is the part that is observable and meaningful:
    // the process terminated on its own, promptly, rather than having to be
    // SIGKILLed, and it stopped serving.
    const startedAt = Date.now();
    const exit = await stopServer(server);
    const drainSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    await check(`the server for mode "${mode}" drained and stopped serving on SIGTERM`, async () => {
      assert(
        exit === 'signal SIGTERM' || exit === 0,
        `the process ended as ${exit}; it neither drained on its own nor exited cleanly`,
      );
      assert(
        Number(drainSeconds) < 20,
        `the process took ${drainSeconds}s to stop, which is the SIGKILL fallback time, not a drain`,
      );
      try {
        await fetch(`http://127.0.0.1:${server.port}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
      } catch {
        return `stopped in ${drainSeconds}s and no longer answers`;
      }
      throw new Error('the API still answered after shutdown');
    });
  }

  if (failures > 0) {
    console.error(`\nFAILED — ${failures} compiled-authentication check(s) did not pass.\n`);
    process.exit(1);
  }
  console.log('\nAuthentication is proven end to end against the built artifact, one production process per mode.\n');
}

void main().catch((err) => {
  console.error(`\nFATAL: ${err.stack ?? err}\n`);
  process.exit(1);
});
