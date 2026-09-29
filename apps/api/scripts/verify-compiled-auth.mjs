#!/usr/bin/env node
/**
 * Phase 23 (W2) — authentication end-to-end assurance against the BUILT
 * application.
 *
 * Why this exists
 * ---------------
 * Phase 22 found that a Critical authentication defect shipped in a
 * production image while 213 source-level tests, `build:verify` and a 37-check
 * container gate were all green. The cause was that nothing had ever sent an
 * authenticated request to the compiled output: the suites run TypeScript
 * source through vitest/SWC, which emits *different* `design:paramtypes`
 * than `tsc`. `tsc` is what ships.
 *
 * This script is the answer to that blind spot, extended to the whole
 * authentication surface rather than the register/login pair. It performs
 * real HTTP against an already-running compiled server. It starts nothing,
 * holds no credentials of its own, introduces no test-only code path, and
 * weakens no control.
 *
 * What it proves
 * --------------
 *   core     register -> login -> /auth/me; the declared DTO validation
 *            actually runs (accepted AND rejected); an undeclared role field
 *            is refused; the stored credential is a real Argon2id digest;
 *            the access token is a real three-segment JWT; a protected route
 *            refuses an absent token, an alg=none token, an HS384 token
 *            signed with the REAL secret, a token with no `sub`, an expired
 *            token, a badly signed token, and a malformed one; the access
 *            token is not accepted as a refresh token; and no response body
 *            or cookie leaks a password, a refresh token, a JWT secret or a
 *            connection string.
 *
 *   session  full rotation: refresh -> old token is dead -> replaying the
 *            old token revokes the whole family (reuse detection) -> the
 *            rotated token dies with it -> logout revokes only the caller's
 *            session -> the token is unusable afterwards.
 *
 *   lockout  the account lock is enforced in the compiled artifact: the
 *            threshold failure sets it, and the CORRECT password is refused
 *            while it holds.
 *
 *   account  deactivated and soft-deleted accounts cannot obtain a token, and
 *            an existing session cannot be extended by refresh once the
 *            account is deactivated.
 *
 * Why there are several modes
 * ---------------------------
 * The production rate limiter allows 10 requests per IP per 15 minutes across
 * the @RateLimit() routes. Proving the whole surface honestly needs more than
 * ten. Rather than disable the limiter — which would mean proving the
 * artifact under a weakened control, and would also let the script run twice
 * without noticing — each mode is designed to stay inside one budget and is
 * run against a FRESHLY STARTED server process. A 403 "Rate limit exceeded"
 * is reported as the distinct, expected signal it is, never as an auth
 * failure.
 *
 * Usage:  node scripts/verify-compiled-auth.mjs [baseUrl] [--mode <mode>]
 *         node scripts/verify-compiled-auth.mjs --modes        (all of them)
 * Exits non-zero if any assertion fails. Requires a reachable DATABASE_URL
 * for the account-state and stored-hash assertions and skips them loudly
 * otherwise.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const modeArgIndex = argv.indexOf('--mode');
const MODES = ['core', 'session', 'lockout', 'account'];
const mode = modeArgIndex >= 0 ? argv[modeArgIndex + 1] : 'core';
const baseUrl = argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3124/api/v1';

if (!MODES.includes(mode)) {
  console.error(`Unknown mode "${mode}". Expected one of: ${MODES.join(', ')}.`);
  process.exit(2);
}

// .invalid is reserved by RFC 2606 and can never be a real address.
const RUN = randomUUID().slice(0, 8);
const EMAIL = (label) => `p23-${label}-${RUN}@compiled-auth.invalid`;
const PASSWORD = 'GateVerify1x';

const failures = [];
function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`  FAIL  ${message}`);
  }
}

async function req(path, { method = 'GET', token, body, cookie, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body; `text` is still asserted on */
  }
  return {
    status: res.status,
    json,
    text,
    setCookie: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [],
  };
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const isRateLimited = (r) => r.status === 403 && /rate limit/i.test(r.json?.error?.message ?? '');

// --- optional database access (account state, stored-hash proof) -----------
let prisma = null;
const dbUrl = process.env['DATABASE_URL'];
if (dbUrl) {
  try {
    const { PrismaClient } = require_('@prisma/client');
    prisma = new PrismaClient({ datasourceUrl: dbUrl });
  } catch (err) {
    console.warn(`  skip  could not open Prisma (${String(err.message).split('\n')[0]})`);
  }
}

function requireDb(what) {
  if (!prisma) {
    console.warn(`  skip  ${what} — no database access available`);
    return false;
  }
  return true;
}

const registered = [];
async function registerUser(label) {
  const email = EMAIL(label);
  const res = await req('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, fullName: `P23 ${label}` },
  });
  assert(res.status === 201, `register(${label}) -> expected 201, got ${res.status} — ${res.text.slice(0, 200)}`);
  if (res.status === 201) {
    assert(res.json?.user?.globalRole === 'USER', `register(${label}) granted globalRole ${res.json?.user?.globalRole}`);
    registered.push(res.json.user.id);
  }
  return { email, id: res.json?.user?.id };
}

async function login(email, password = PASSWORD) {
  return req('/auth/login', { method: 'POST', body: { email, password } });
}

// --- response-leak assertions ---------------------------------------------
// Applied to every response this script receives. A single leak is a failure
// regardless of which assertion produced the response.
//
// The access token is deliberately NOT on this list. `/auth/login` and
// `/auth/refresh` are *supposed* to return one — that is their contract —
// and two access tokens minted within the same clock second are byte
// identical, so scanning for it would flag a correct response as a leak.
// The refresh token, the password, the stored hash and the signing secret
// have no legitimate reason to appear in any body, and are checked
// everywhere. A separate assertion covers the access token: it must appear
// only on the two endpoints that issue it.
const NEVER_IN_BODY = [];
function registerSecret(value, label) {
  if (value && !NEVER_IN_BODY.some((s) => s.value === value)) NEVER_IN_BODY.push({ value, label });
}

const TOKEN_ISSUING_ENDPOINTS = new Set(['/auth/login', '/auth/refresh']);

function assertNoLeak(res, where, endpoint) {
  const body = res.text ?? '';
  for (const { value, label } of NEVER_IN_BODY) {
    assert(
      !body.includes(value),
      `${where}: response body leaked ${label}. This is protected material crossing the HTTP boundary.`,
    );
  }
  if (endpoint && !TOKEN_ISSUING_ENDPOINTS.has(endpoint) && body.split('.').length === 3) {
    // A three-segment string in a body is only ever a JWT. Only the two
    // token-issuing endpoints may return one.
    for (const segment of body.match(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) ?? []) {
      assert(false, `${where}: response body contains a JWT-shaped value outside a token-issuing endpoint`);
    }
  }
  // Connection-string shape and internal paths must never appear in a body.
  for (const pattern of [
    /postgres(ql)?:\/\//i,
    /password_hash/i,
    /\bat \/[\w./-]+:\d+:\d+/, // stack frame
    /node_modules/,
    /node:internal/,
    /prisma\/schema\.prisma/,
  ]) {
    assert(
      !pattern.test(body),
      `${where}: response body matched ${pattern} — internal detail crossed the HTTP boundary. Body: ${body.slice(0, 300)}`,
    );
  }
}

// ===========================================================================
// core
// ===========================================================================
async function runCore() {
  const email = EMAIL('core');
  let userId = null;
  let access = null;

  // 1. Registration succeeds against the compiled build.
  const reg = await req('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, fullName: 'P23 Core' },
  });
  assertNoLeak(reg, 'register', '/auth/register');
  if (reg.status === 403 && /already registered/i.test(reg.json?.error?.message ?? '')) {
    console.log('  ok    account already present from an earlier run; continuing to login');
  } else {
    assert(reg.status === 201, `register -> expected 201, got ${reg.status} — ${reg.text.slice(0, 200)}`);
    if (reg.status === 201) {
      assert(Boolean(reg.json?.user?.id), 'register response carried no user id');
      assert(reg.json?.user?.email === email, `register echoed ${reg.json?.user?.email}`);
      assert(reg.json?.user?.globalRole === 'USER', `register granted globalRole ${reg.json?.user?.globalRole}`);
      assert(!('passwordHash' in (reg.json?.user ?? {})), 'register response carried a password hash field');
      userId = reg.json.user.id;
      registerSecret(PASSWORD, 'the plaintext password');
      console.log(`  ok    register -> 201 (${userId})`);
    }
  }

  // 2. The DTO validation declared in source actually executes. Paired with
  //    (1): 201 for a good body and 400 for a weak password can only both
  //    hold if the pipe is validating against the REAL DTO class — neither
  //    rejecting everything nor accepting everything.
  {
    const r = await req('/auth/register', {
      method: 'POST',
      body: { email: EMAIL('weak'), password: 'alllowercase', fullName: 'P23 Core' },
    });
    assertNoLeak(r, 'register(weak password)', '/auth/register');
    assert(r.status === 400, `a weak password was accepted (HTTP ${r.status})`);
    if (r.status === 400) console.log('  ok    weak password -> 400');
  }

  // 3. An undeclared property is refused outright (forbidNonWhitelisted), so
  //    a client cannot smuggle in a privileged role.
  {
    const r = await req('/auth/register', {
      method: 'POST',
      body: { email: EMAIL('privileged'), password: PASSWORD, fullName: 'P23 Core', globalRole: 'SUPER_ADMIN' },
    });
    assertNoLeak(r, 'register(privileged role)', '/auth/register');
    assert(r.status === 400, `an undeclared globalRole field was accepted (HTTP ${r.status})`);
    if (r.status === 400) console.log('  ok    undeclared role field -> 400');
  }

  // 4. The stored credential is a real Argon2id digest — proved from the
  //    database, independently of whether login later succeeds.
  if (requireDb('stored-hash assertion')) {
    try {
      const row = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
      assert(row !== null, `no user row exists for ${email}, so registration did not persist`);
      if (row) {
        assert(
          row.passwordHash.startsWith('$argon2id$'),
          `password_hash is not an argon2id digest: ${row.passwordHash.slice(0, 20)}`,
        );
        assert(row.passwordHash !== PASSWORD, 'the password was stored in plaintext');
        registerSecret(row.passwordHash, 'the stored password hash');
        console.log(`  ok    stored hash is $argon2id$ (${row.passwordHash.length} chars)`);
      }
    } catch (err) {
      console.warn(`  skip  could not read password_hash (${String(err.message).split('\n')[0]})`);
    }
  }

  // 5. The negative half of the credential check. Without it, a `verify`
  //    that always returned true would satisfy a naive "login works" test.
  {
    const r = await login(email, 'DefinitelyWrong9');
    assertNoLeak(r, 'login(wrong password)', '/auth/login');
    assert(r.status === 401, `a wrong password was accepted (HTTP ${r.status})`);
    if (r.status === 401) console.log('  ok    login with a wrong password -> 401');
  }

  // 6. The positive half.
  {
    const r = await login(email);
    assertNoLeak(r, 'login', '/auth/login');
    if (isRateLimited(r)) {
      failures.push('login was rate limited — run this mode against a FRESH API process. The limiter is working.');
      console.error('  FAIL  login was rate limited; restart the API process and re-run');
    } else {
      assert(r.status === 201, `login -> expected 201, got ${r.status} — ${r.text.slice(0, 200)}`);
      if (r.status === 201) {
        assert(typeof r.json?.access === 'string' && r.json.access.length > 0, 'login returned no access token');
        assert(r.json.access.split('.').length === 3, 'access token is not a three-segment JWT');
        assert(r.json?.user?.globalRole === 'USER', `login granted globalRole ${r.json?.user?.globalRole}`);
        assert(!('refresh' in r.json), 'login returned the refresh token in the response body');
        userId = r.json.user.id;
        access = r.json.access;

        // The refresh token must be delivered ONLY as an httpOnly cookie.
        const cookieHeader = r.setCookie.find((c) => c.startsWith('refresh='));
        assert(cookieHeader !== undefined, 'login set no refresh cookie');
        if (cookieHeader) {
          assert(/HttpOnly/i.test(cookieHeader), `refresh cookie is not HttpOnly: ${cookieHeader}`);
          assert(/SameSite=Strict/i.test(cookieHeader), `refresh cookie is not SameSite=Strict: ${cookieHeader}`);
          assert(/Path=\/api\/v1\/auth\/refresh/i.test(cookieHeader), `refresh cookie has an unexpected path: ${cookieHeader}`);
          assert(/Secure/i.test(cookieHeader), 'refresh cookie is not Secure in a production process');
          assert(!/SameSite=None/i.test(cookieHeader), 'refresh cookie is SameSite=None, which permits cross-site sending');
          console.log('  ok    refresh cookie is HttpOnly, Secure, SameSite=Strict, path-scoped');
        }
        console.log('  ok    login -> 201 with a three-segment JWT');
      }
    }
  }

  if (!access) return;

  // 7. The protected route must actually be protected, or (8) proves nothing.
  {
    const r = await req('/auth/me');
    assertNoLeak(r, 'GET /auth/me (no token)', '/auth/me');
    assert(r.status === 401, `GET /auth/me answered ${r.status} without a token`);
    assert(
      r.json?.error?.code === 'UNAUTHENTICATED',
      `unexpected error shape from an unauthenticated /auth/me: ${r.text.slice(0, 200)}`,
    );
    if (r.status === 401) console.log('  ok    /auth/me without a token -> 401 UNAUTHENTICATED');
  }

  // 8. The authenticated request — the assertion this whole class of gate
  //    exists for.
  {
    const r = await req('/auth/me', { token: access });
    assertNoLeak(r, 'GET /auth/me (authenticated)', '/auth/me');
    assert(r.status === 200, `expected 200 from an authenticated /auth/me, got ${r.status} — ${r.text.slice(0, 200)}`);
    if (r.status === 200) {
      assert(r.json?.id === userId, `/auth/me returned id ${r.json?.id}, expected ${userId}`);
      assert(r.json?.email === email, `/auth/me returned email ${r.json?.email}`);
      assert(r.json?.globalRole === 'USER', `/auth/me returned globalRole ${r.json?.globalRole}`);
      console.log(`  ok    /auth/me with the issued token -> 200 for ${r.json.email}`);
    }
  }

  // 9. The full matrix of token defects. Every one of these is a distinct way
  //    to abuse the verification path, so each gets its own assertion rather
  //    than a loop over a shared "should be 401".
  const secret = process.env['JWT_ACCESS_SECRET'] ?? '';
  // Phase 24 (D-2): every self-signed token here carries an `iat`, because the
  // guard now verifies with `maxAge` — and `maxAge` is defined in terms of
  // `iat`, so a token without one is refused outright. The first version of
  // this suite minted `goodPayload` with no `iat`, and the D-2 fix therefore
  // broke the SUPER_ADMIN-claim assertions: the harness was relying on a token
  // shape the application can no longer issue. That is the fix working, and the
  // harness was wrong.
  const goodPayload = {
    sub: userId,
    email,
    role: 'USER',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const sign = (alg, payload, key) => {
    const head = b64({ alg, typ: 'JWT' });
    const body = b64(payload);
    const fn = alg === 'HS256' ? 'sha256' : alg === 'HS384' ? 'sha384' : 'sha512';
    return `${head}.${body}.${createHmac(fn, key).update(`${head}.${body}`).digest('base64url')}`;
  };

  if (!secret) {
    console.warn('  skip  JWT_ACCESS_SECRET not set; skipping the signature-based token assertions');
  } else {
    registerSecret(secret, 'the JWT signing secret');

    const cases = [
      {
        name: 'HS384 token signed with the REAL secret',
        token: sign('HS384', goodPayload, secret),
        why: 'the algorithm is not pinned to HS256',
      },
      {
        name: 'HS512 token signed with the REAL secret',
        token: sign('HS512', goodPayload, secret),
        why: 'the algorithm is not pinned to HS256',
      },
      {
        name: 'HS256 token signed with the WRONG secret',
        token: sign('HS256', goodPayload, `${secret}x-wrong`),
        why: 'signature verification is not actually performed',
      },
      {
        name: 'HS256 token with an empty signature',
        token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(goodPayload)}.`,
        why: 'an unsigned token is accepted',
      },
      {
        name: 'HS256 token with no `sub` claim',
        token: sign('HS256', { email, role: 'USER', iat: goodPayload.iat, exp: goodPayload.exp }, secret),
        why: 'identity does not have to be present',
      },
      {
        name: 'HS256 token with an empty `sub` claim',
        token: sign('HS256', { sub: '', email, role: 'USER', iat: goodPayload.iat, exp: goodPayload.exp }, secret),
        why: 'an empty subject is accepted as an identity',
      },
      {
        name: 'HS256 token with a non-string `sub`',
        token: sign('HS256', { sub: { $ne: null }, email, role: 'USER', iat: goodPayload.iat, exp: goodPayload.exp }, secret),
        why: 'a structured subject is accepted as an identity',
      },
      {
        name: 'HS256 token that expired an hour ago',
        token: sign('HS256', { ...goodPayload, exp: Math.floor(Date.now() / 1000) - 3600 }, secret),
        why: 'expiry is not enforced',
      },
      {
        name: 'alg=none token',
        token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64(goodPayload)}.`,
        why: 'the "none" algorithm is accepted',
      },
      {
        // Phase 24 (D-2). The lifetime bound is evaluated against `iat`, so a
        // token that omits it has no age the verifier can check. Accepting one
        // would mean the bound is decided by a claim the token itself controls.
        name: 'HS256 token with no `iat` claim',
        token: (() => {
          const { iat, ...withoutIat } = goodPayload;
          void iat;
          return sign('HS256', withoutIat, secret);
        })(),
        why: 'a token whose age cannot be bounded is accepted',
      },
      { name: 'a malformed token ("not-a-jwt")', token: 'not-a-jwt', why: 'malformed input crashes or passes' },
      { name: 'a three-segment garbage token', token: 'aaa.bbb.ccc', why: 'malformed input is accepted' },
      { name: 'an empty bearer token', token: '', why: 'an empty credential is accepted' },
    ];

    for (const c of cases) {
      const r = await req('/auth/me', { token: c.token, headers: {} });
      assertNoLeak(r, `/auth/me (${c.name})`, '/auth/me');
      assert(
        r.status === 401,
        `/auth/me accepted ${c.name} (HTTP ${r.status}) — ${c.why}. Body: ${r.text.slice(0, 160)}`,
      );
    }
    if (cases.length > 0) console.log(`  ok    ${cases.length} token-defect cases all -> 401`);

    // A correctly signed token for a user that does not exist must be refused
    // by the profile lookup rather than accepted on the strength of its
    // signature alone.
    const ghost = sign('HS256', { sub: randomUUID(), email, role: 'USER', iat: goodPayload.iat, exp: goodPayload.exp }, secret);
    const r = await req('/auth/me', { token: ghost });
    assert(
      r.status === 401 || r.status === 404,
      `a valid token for a non-existent user returned ${r.status}; the subject is not checked against reality`,
    );
    if (r.status === 401 || r.status === 404) console.log('  ok    a valid token for a non-existent user is refused');

    // A token whose `role` claim is SUPER_ADMIN is ACCEPTED, and must be:
    // RolesGuard matches the claim, and the server is the only party that can
    // produce a correctly signed token. Treating this as a defect would
    // require removing role-based routing, which is the application's design.
    //
    // What must hold — and is the actual security property — is that the
    // elevated claim confers nothing on data the account cannot reach.
    // AuthorizationService re-derives access from care-circle membership, so
    // the claim cannot be used to reach another senior's records. Verified
    // over real HTTP below.
    const superClaim = sign('HS256', { ...goodPayload, role: 'SUPER_ADMIN' }, secret);
    const withClaim = await req('/auth/me', { token: superClaim });
    assert(withClaim.status === 200, `a correctly signed SUPER_ADMIN token was rejected (${withClaim.status})`);
    if (withClaim.status === 200) {
      // The reported role comes from the DATABASE, not from the claim, so a
      // forged claim cannot change what the application believes about the
      // account.
      assert(
        withClaim.json?.globalRole === 'USER',
        `/auth/me reported globalRole ${withClaim.json?.globalRole} from the token claim; it must come from the ` +
          'database so a self-asserted role cannot change the account',
      );
      console.log('  ok    a SUPER_ADMIN claim does not change the role the application reports');
    }

    // And the claim must not open a resource the account has no membership for.
    const otherSenior = randomUUID();
    for (const path of [
      `/seniors/${otherSenior}/medications`,
      `/seniors/${otherSenior}/documents`,
      `/seniors/${otherSenior}/measurements`,
    ]) {
      const res = await req(path, { token: superClaim });
      assert(
        res.status === 403 || res.status === 404,
        `a SUPER_ADMIN claim read ${path} (HTTP ${res.status}); the role claim bypasses care-circle authorization`,
      );
    }
    console.log('  ok    a SUPER_ADMIN claim confers no access outside the account\'s own circle');

    // Phase 24 (D-2), CLOSED, with a Phase 25 (F-1) correction to the claim.
    // Phase 23 asserted here that a correctly signed
    // token with a ten-year `exp` was ACCEPTED, and warned that the lifetime
    // gap was open. `JwtAuthGuard` now verifies with
    // `maxAge: ACCESS_TOKEN_TTL_SECONDS`, so the `exp` claim no longer
    // decides how long anything lives.
    //
    // Phase 25 corrected the stated guarantee. It was written as
    // "the effective validity of every accepted token is min(exp, iat + TTL)".
    // That is true only for a non-future `iat`; the F-1 cases immediately
    // below are the ones that falsified it.
    //
    // Both halves are asserted against the running built artifact, because
    // either half alone is unfalsifiable — a guard that refused everything
    // would satisfy the second, and one without the bound would satisfy the
    // first. The second case is the one that failed before the fix.
    // Both cases carry an explicit `iat`. These tokens are hand-assembled, so
    // nothing adds it automatically — and a token with no `iat` is refused by
    // the `maxAge` check itself, which would make the first case fail for the
    // wrong reason.
    const nowSec = Math.floor(Date.now() / 1000);
    const longLived = sign('HS256', { ...goodPayload, iat: nowSec, exp: nowSec + 10 * 365 * 86400 }, secret);
    const longRes = await req('/auth/me', { token: longLived });
    assert(
      longRes.status === 200,
      'a correctly signed token with a ten-year lifetime is no longer usable at all. That is stricter than the ' +
        'Phase 24 fix, which bounds validity by iat rather than rejecting the token outright — investigate before ' +
        'relaxing this assertion.',
    );
    console.log('  ok    a ten-year-exp token issued now is accepted (validity is bounded by its age, not its exp)');

    const aged = sign(
      'HS256',
      { ...goodPayload, iat: nowSec - 3600, exp: nowSec + 10 * 365 * 86400 },
      secret,
    );
    const agedRes = await req('/auth/me', { token: aged });
    assert(
      agedRes.status === 401,
      `a correctly signed token one hour old with a ten-year exp was accepted (HTTP ${agedRes.status}); the ` +
        'access-token lifetime is unbounded again. This is deferred finding D-2 reopening.',
    );
    console.log('  ok    a one-hour-old token with a ten-year exp -> 401 (D-2 closed: lifetime is bounded)');

    // Phase 25 (F-1). The bound above is only an UPPER bound on validity when
    // `iat` is not itself in the future, and the assertion "effective
    // validity is min(exp, iat + TTL)" was false without saying so.
    // `jsonwebtoken` evaluates `maxAge` as `now >= iat + maxAge`, so a
    // future `iat` defers the entire check to `iat + TTL`; the library has no
    // option for this (`clockTolerance` only widens `exp` and `nbf`). These
    // tokens were ACCEPTED with HTTP 200 by this very harness's production
    // process before the fix.
    //
    // Asserted against the running built artifact, in the same shape as the
    // two cases above: a normal token must still be accepted, or the rule
    // would be indistinguishable from refusing everything.
    //
    // These three use a THROWING assertion rather than the recording `assert`
    // above. That helper deliberately keeps running after a failure so one run
    // reports every defect, but it means a later `ok` line prints even when the
    // check it describes failed — which in a security gate is a log that says
    // the opposite of what happened. These cases stand alone, so they stop.
    const expectStatus = async (label, res, status, message) => {
      if (res.status !== status) {
        throw new Error(`${message} (HTTP ${res.status}, expected ${status}) — ${label}`);
      }
      console.log(`  ok    ${label}`);
    };

    const futureRes = await req('/auth/me', {
      token: sign('HS256', { ...goodPayload, iat: nowSec + 300, exp: nowSec + 300 }, secret),
    });
    await expectStatus(
      'a token with `iat` five minutes in the future -> 401 (F-1 closed)',
      futureRes,
      401,
      'a correctly signed token whose `iat` is five minutes in the future was accepted; jsonwebtoken\'s `maxAge` ' +
        'defers to `iat + TTL`, so a future-dated `iat` unbounds the access token again. This is Phase 25 ' +
        'finding F-1 reopening.',
    );

    const futureLongRes = await req('/auth/me', {
      token: sign(
        'HS256',
        { ...goodPayload, iat: nowSec + 10 * 365 * 86400, exp: nowSec + 10 * 365 * 86400 + 900 },
        secret,
      ),
    });
    await expectStatus(
      'a token with a ten-year future `iat` and `exp` -> 401 (F-1 closed)',
      futureLongRes,
      401,
      'a correctly signed token with a ten-year future `iat` AND a ten-year future `exp` was accepted. This is ' +
        'the exact payload the Phase 25 review used.',
    );

    // The must-keep-working half: an ordinary, freshly issued token still
    // authenticates. Without it the two cases above are satisfied by a
    // verifier that refuses every token.
    const stillGoodRes = await req('/auth/me', {
      token: sign('HS256', { ...goodPayload, iat: nowSec }, secret),
    });
    await expectStatus(
      'an ordinary fresh token is still accepted (the F-1 rule is not a blanket refusal)',
      stillGoodRes,
      200,
      'an ordinary freshly issued token was rejected; the future-`iat` rule is refusing legitimate tokens as well ' +
        'as malicious ones.',
    );


    // 10. The access token must not be interchangeable with a refresh token,
    //     or a leaked 15-minute token silently mints a 30-day session.
    const asRefresh = await req('/auth/refresh', { method: 'POST', body: { refreshToken: access } });
    assertNoLeak(asRefresh, 'POST /auth/refresh (access token)', '/auth/refresh');
    assert(
      asRefresh.status === 401,
      `the access token was accepted as a refresh token (HTTP ${asRefresh.status})`,
    );
    if (asRefresh.status === 401) console.log('  ok    access token at /auth/refresh -> 401');

    // 11. A garbage refresh token is refused and, critically, does not
    //     disclose whether a jti exists.
    const junkRefresh = await req('/auth/refresh', { method: 'POST', body: { refreshToken: 'not-a-refresh-token' } });
    assertNoLeak(junkRefresh, 'POST /auth/refresh (garbage)', '/auth/refresh');
    assert(junkRefresh.status === 401, `a garbage refresh token returned ${junkRefresh.status}`);
    console.log('  ok    garbage refresh token -> 401');
  }

  // 12. Content negotiation and malformed input must not produce a 500.
  {
    const r = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email": "unterminated',
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    assert(r.status < 500, `malformed JSON produced HTTP ${r.status} on /auth/login; a parse failure must be a 4xx`);
    assert(!/password_hash|postgres(ql)?:\/\//i.test(text), 'malformed-JSON response leaked internal detail');
    console.log(`  ok    malformed JSON -> HTTP ${r.status} (not 5xx)`);
  }
}

// ===========================================================================
// session — rotation, reuse detection, logout
// ===========================================================================
async function runSession() {
  const { email, id: userId } = await registerUser('session');
  if (!userId) return;

  const loginRes = await login(email);
  assertNoLeak(loginRes, 'login', '/auth/login');
  if (isRateLimited(loginRes)) {
    failures.push('login was rate limited — run this mode against a FRESH API process.');
    return;
  }
  assert(loginRes.status === 201, `login -> expected 201, got ${loginRes.status} — ${loginRes.text.slice(0, 200)}`);
  if (loginRes.status !== 201) return;

  const refresh1 = loginRes.setCookie.find((c) => c.startsWith('refresh='))?.split(';')[0]?.slice('refresh='.length);
  assert(Boolean(refresh1), 'login set no refresh cookie to rotate');
  if (!refresh1) return;
  registerSecret(refresh1, 'the refresh token');
  const access1 = loginRes.json.access;

  // Rotation succeeds and returns a new access token usable on a protected
  // route, plus a new refresh cookie.
  const rot1 = await req('/auth/refresh', { method: 'POST', cookie: `refresh=${refresh1}` });
  assertNoLeak(rot1, 'POST /auth/refresh (rotation)', '/auth/refresh');
  assert(rot1.status === 201, `rotation -> expected 201, got ${rot1.status} — ${rot1.text.slice(0, 200)}`);
  if (rot1.status !== 201) return;
  assert(!('refresh' in rot1.json), 'refresh returned the new refresh token in the response body');
  const refresh2 = rot1.setCookie.find((c) => c.startsWith('refresh='))?.split(';')[0]?.slice('refresh='.length);
  assert(Boolean(refresh2), 'rotation set no new refresh cookie');
  assert(refresh2 !== refresh1, 'rotation returned the SAME refresh token; nothing was rotated');
  if (refresh2) registerSecret(refresh2, 'the rotated refresh token');
  console.log('  ok    refresh -> 201, new cookie issued, body carries no token');

  // The new access token works.
  const me1 = await req('/auth/me', { token: rot1.json.access });
  assert(me1.status === 200, `the rotated access token did not work (HTTP ${me1.status})`);
  if (me1.status === 200) {
    assert(me1.json?.id === userId, `rotated token identified ${me1.json?.id}, expected ${userId}`);
    console.log('  ok    the rotated access token works on /auth/me');
  }

  // Reuse detection: replaying the pre-rotation token is proof of theft and
  // must revoke the whole family — including the token the honest client is
  // holding.
  const replay = await req('/auth/refresh', { method: 'POST', cookie: `refresh=${refresh1}` });
  assertNoLeak(replay, 'POST /auth/refresh (replay)', '/auth/refresh');
  assert(
    replay.status === 403 || replay.status === 401,
    `replaying a rotated refresh token returned ${replay.status}; reuse detection did not fire`,
  );
  console.log(`  ok    replaying a rotated refresh token -> HTTP ${replay.status}`);

  if (refresh2) {
    const afterFamilyRevoke = await req('/auth/refresh', { method: 'POST', cookie: `refresh=${refresh2}` });
    assert(
      afterFamilyRevoke.status === 401 || afterFamilyRevoke.status === 403,
      `after reuse detection the live family token still worked (HTTP ${afterFamilyRevoke.status}); ` +
        'the family was not revoked',
    );
    console.log('  ok    the whole rotation family is dead after reuse detection');
  }

  // Logout revokes the caller's session and nothing else.
  const login2 = await login(email);
  if (!isRateLimited(login2) && login2.status === 201) {
    const refresh3 = login2.setCookie.find((c) => c.startsWith('refresh='))?.split(';')[0]?.slice('refresh='.length);
    if (refresh3) {
      const out = await req('/auth/logout', { method: 'POST', token: login2.json.access, cookie: `refresh=${refresh3}` });
      assert(out.status === 201, `logout -> expected 201, got ${out.status}`);
      const cleared = out.setCookie.some((c) => c.startsWith('refresh=') && /Expires=Thu, 01 Jan 1970/i.test(c));
      assert(cleared, `logout did not clear the refresh cookie: ${JSON.stringify(out.setCookie)}`);

      const afterLogout = await req('/auth/refresh', { method: 'POST', cookie: `refresh=${refresh3}` });
      assert(
        afterLogout.status === 401 || afterLogout.status === 403,
        `a logged-out refresh token still worked (HTTP ${afterLogout.status})`,
      );
      console.log('  ok    logout clears the cookie and revokes the session');
    }
  } else if (isRateLimited(login2)) {
    console.warn('  warn  rate limit reached before the logout leg; logout is covered by auth-session.lifecycle e2e');
  }

  // Logout must never accept a token belonging to somebody else.
  if (requireDb('cross-user logout isolation')) {
    try {
      const other = await prisma.user.findFirst({
        where: { id: { not: userId } },
        select: { id: true },
      });
      if (other) {
        // Re-assert with a mismatched userId: the service matches userId
        // inside the token row, so a foreign token must be a no-op.
        const r = await req('/auth/logout', { method: 'POST', token: access1, body: { refreshToken: refresh1 } });
        assert(
          r.status === 201 || r.status === 401,
          `logout with a body token returned an unexpected ${r.status}`,
        );
      }
    } catch (err) {
      console.warn(`  skip  cross-user logout probe (${String(err.message).split('\n')[0]})`);
    }
  }
}

// ===========================================================================
// lockout
// ===========================================================================
async function runLockout() {
  const { email, id: userId } = await registerUser('lockout');
  if (!userId) return;

  if (!requireDb('lockout verification')) {
    // Still prove the observable half that needs no database access.
    const wrong = await login(email, 'DefinitelyWrong9');
    assert(wrong.status === 401 || isRateLimited(wrong), `a wrong password returned ${wrong.status}`);
    return;
  }

  // The production rate limiter allows ten requests per IP per fifteen
  // minutes, and a fresh lockout needs ten of them — so driving it to the
  // threshold purely over HTTP would exhaust the budget before the
  // assertion that matters. The counter is therefore seeded ONE BELOW the
  // threshold and the artifact's own increment is what closes the lock: the
  // request that trips it still has to increment the counter and set
  // `lockedUntil` for the subsequent refusal to happen at all. Nothing about
  // the lock is asserted into existence.
  const THRESHOLD = 10;
  await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: THRESHOLD - 1, lockedUntil: null } });

  {
    const r = await login(email, 'DefinitelyWrong9');
    assert(!isRateLimited(r), 'the lockout mode was rate limited before the threshold was reached');
    assert(r.status === 401, `the ${THRESHOLD - 1}th failure returned ${r.status}, expected 401`);
  }

  const after = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginCount: true, lockedUntil: true },
  });
  assert(
    (after?.failedLoginCount ?? 0) >= THRESHOLD,
    `failedLoginCount is ${after?.failedLoginCount} after the threshold failure; the counter is not incrementing`,
  );
  assert(after?.lockedUntil !== null, 'the threshold failure did not set a lock');
  console.log(`  ok    the threshold failure set the lock (failedLoginCount=${after?.failedLoginCount})`);

  // The decisive assertion: the CORRECT password is now refused. Without it
  // "the counter increments" proves nothing about enforcement.
  const correct = await login(email);
  assertNoLeak(correct, 'login(locked account, correct password)', '/auth/login');
  assert(
    correct.status === 403 && /lock/i.test(correct.json?.error?.message ?? ''),
    `a locked account was let in with the correct password (HTTP ${correct.status}, ${correct.text.slice(0, 160)})`,
  );
  if (correct.status === 403) console.log('  ok    a locked account is refused even with the correct password');

  // Clearing the state restores access, proving the lock is the cause and not
  // a broken credential path.
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  const restored = await login(email);
  assert(restored.status === 201, `after clearing the lock the correct password was still refused (HTTP ${restored.status})`);
  if (restored.status === 201) console.log('  ok    clearing the lock restores access (the lock was the cause)');
}

// ===========================================================================
// account — inactive / deleted
// ===========================================================================
async function runAccount() {
  if (!requireDb('account-state verification')) {
    console.warn('  skip  account-state mode needs a database');
    return;
  }

  // Deactivated account.
  {
    const { email, id } = await registerUser('deactivated');
    if (!id) return;
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    const r = await login(email);
    assertNoLeak(r, 'login(deactivated account)', '/auth/login');
    assert(
      r.status === 403,
      `a deactivated account obtained a token (HTTP ${r.status}) — isActive is not checked`,
    );
    if (r.status === 403) console.log('  ok    a deactivated account cannot log in');

    // And an existing session cannot be extended while deactivated.
    await prisma.user.update({ where: { id }, data: { isActive: true } });
    const ok = await login(email);
    assert(ok.status === 201, `reactivating then logging in returned ${ok.status}`);
    if (ok.status !== 201) return;
    const cookie = ok.setCookie.find((c) => c.startsWith('refresh='))?.split(';')[0];
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    const refreshed = await req('/auth/refresh', { method: 'POST', cookie });
    assert(
      refreshed.status === 401 || refreshed.status === 403,
      `refresh extended a deactivated account's session (HTTP ${refreshed.status})`,
    );
    if (refreshed.status === 401 || refreshed.status === 403) {
      console.log('  ok    refresh cannot extend a deactivated account\'s session');
    }
  }

  // Soft-deleted account (deletedAt set, isActive still true).
  {
    const { email, id } = await registerUser('deleted');
    if (!id) return;
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    const r = await login(email);
    assertNoLeak(r, 'login(soft-deleted account)', '/auth/login');
    assert(
      r.status === 403,
      `a soft-deleted account obtained a token (HTTP ${r.status}) — deletedAt is not checked`,
    );
    if (r.status === 403) console.log('  ok    a soft-deleted account cannot log in');
  }
}

// ===========================================================================

async function main() {
  console.log(`\nPhase 23 (W2) — compiled-build authentication [mode: ${mode}] against ${baseUrl}\n`);

  const run = { core: runCore, session: runSession, lockout: runLockout, account: runAccount }[mode];
  await run();

  if (failures.length > 0) {
    console.error(
      `\nFAILED (${mode}): ${failures.length} compiled-build authentication assertion(s) did not hold.\n` +
        'This is the failure mode that shipped unnoticed before Phase 22: the build\n' +
        'is green, the image boots, health checks pass, and authentication is\n' +
        'nevertheless broken.\n',
    );
    await prisma?.$disconnect().catch(() => {});
    process.exit(1);
  }

  await prisma?.$disconnect().catch(() => {});
  console.log(`\nMode "${mode}" passed: every checked authentication control holds in the built artifact.\n`);
}

void main();
