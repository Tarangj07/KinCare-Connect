import type { ExecutionContext} from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS, ACCESS_TOKEN_TTL_SECONDS, isAccessTokenIssuedInThePast } from '../../config/security-config';

import { JwtAuthGuard } from './auth.guard';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

const VALID_SECRET = 'unit-test-secret-value-with-more-than-32-chars!!';
process.env['JWT_ACCESS_SECRET'] = VALID_SECRET;
process.env['NODE_ENV'] = 'test';

describe('JwtAuthGuard — authentication guarantees (Phase 16 H5/A8)', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    jwtService = { verifyAsync: vi.fn() };
    guard = new JwtAuthGuard(jwtService as never);
  });

  it('rejects a request that has NO Authorization header even when a refresh cookie is present', async () => {
    // This is the exact bypass shape from the Phase 16 audit: cookie-only
    // requests used to return `true` with no identity attached.
    const req: { headers: Record<string, string>; cookies?: Record<string, string>; user?: unknown } = { headers: {}, cookies: { refresh: 'jti.secret' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });

  it('rejects a request with no Authorization header and no cookie', async () => {
    const req: { headers: Record<string, string>; cookies?: Record<string, string>; user?: unknown } = { headers: {}, cookies: {} };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token missing/);
  });

  it('rejects a malformed Bearer header', async () => {
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Token abc' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unverifiable token and does not attach identity', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer forged' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('rejects a validly-signed token that lacks a subject (identity guarantee)', async () => {
    jwtService.verifyAsync.mockResolvedValue({ iat: Math.floor(Date.now() / 1000), email: 'x@y.z', role: 'USER' });
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer no-sub' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });

  it('accepts a verified token with a subject and pins HS256', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.c',
      role: 'USER',
      iat: Math.floor(Date.now() / 1000),
    });
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer good' } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'user-1', email: 'a@b.c', role: 'USER' });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('good', {
      secret: VALID_SECRET,
      algorithms: ['HS256'],
      // Phase 24 (D-2): the verifier refuses any token older than the access
      // token lifetime, whatever its `exp` claims.
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    });
  });

  it('rejects a verified token whose `iat` is in the future, even from a stubbed verifier', async () => {
    // The future-`iat` rule is the guard's own, not the library's, so it has to
    // hold on the path where `verifyAsync` is replaced. A mock that resolved a
    // future-dated payload is the shape the Phase 25 reviewer's live
    // production process accepted.
    const future = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60;
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.c', role: 'USER', iat: future });
    const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer future' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });
});

/**
 * Phase 24 (D-2) — the token-lifetime bound, proved against the real
 * `jsonwebtoken` verifier rather than a mock.
 *
 * The block above can only assert that the guard *asks* for a `maxAge`; a
 * typo, a dropped option or a library that ignores it would still pass. These
 * cases sign real tokens with the real secret and real timestamps, so they
 * fail if the bound is not actually enforced.
 */
describe('JwtAuthGuard — access-token lifetime is bounded at verification (Phase 24 D-2)', () => {
  const jwt = new JwtService({ secret: VALID_SECRET });
  const guard = new JwtAuthGuard(jwt);
  const now = () => Math.floor(Date.now() / 1000);

  it('the lifetime policy is 15 minutes', () => {
    // Deliberately a literal, not a comparison against the constant the code
    // uses. The first draft of this block compared the bound against
    // ACCESS_TOKEN_TTL_SECONDS itself, which made every other test in it
    // self-referential: raising the constant moved the tests with it, so the
    // mutation harness (M2 — "the lifetime raised to 24 hours") passed the
    // suite. The mutation harness found the harness, not the control.
    //
    // 900 is not an arbitrary number in this file. It is the number quoted as
    // the accepted residual risk of deferred finding D-1 — "a deactivated or
    // soft-deleted account keeps access for at most 15 minutes" — so changing
    // it widens a documented risk. That change should be a deliberate edit
    // HERE, in the assertion, where it is visible.
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
  });

  const request = (token: string): { headers: Record<string, string>; user?: unknown } => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const sign = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, { secret: VALID_SECRET, algorithm: 'HS256' });

  it('accepts a token issued now with the production lifetime', async () => {
    const token = sign({ sub: 'user-1', email: 'a@b.c', role: 'USER' });
    const req = request(token);
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'user-1' });
  });

  it('accepts a token one second short of the lifetime and refuses it past it', async () => {
    // jsonwebtoken's `maxAge` is evaluated against `iat`, so the boundary is
    // "how old is this token", not "what does exp say". Both halves are
    // asserted: a bound that only ever refuses would be indistinguishable
    // from a broken verifier.
    const fresh = sign({
      sub: 'user-1',
      email: 'a@b.c',
      role: 'USER',
      iat: now() - (ACCESS_TOKEN_TTL_SECONDS - 30),
      exp: now() + ACCESS_TOKEN_TTL_SECONDS,
    });
    await expect(guard.canActivate(makeContext(request(fresh)))).resolves.toBe(true);

    const stale = sign({
      sub: 'user-1',
      email: 'a@b.c',
      role: 'USER',
      iat: now() - (ACCESS_TOKEN_TTL_SECONDS + 60),
      exp: now() + ACCESS_TOKEN_TTL_SECONDS,
    });
    await expect(guard.canActivate(makeContext(request(stale)))).rejects.toThrow(UnauthorizedException);
  });

  it('bounds a ten-year-exp token by its age, not by its exp claim', async () => {
    // The exact defect Phase 23 deferred: a correctly signed token whose
    // `exp` claims ten years. `maxAge` is defined in terms of `iat`, so the
    // effective validity of ANY accepted token is
    //   min(exp, iat + ACCESS_TOKEN_TTL_SECONDS)
    // and the exp claim alone no longer decides how long a token lives.
    //
    // Both halves are asserted because either alone is unfalsifiable: a
    // verifier that refused everything would pass the second, and one that
    // ignored the bound would pass the first.
    const longLived = sign({
      sub: 'user-1',
      email: 'a@b.c',
      role: 'USER',
      exp: now() + 10 * 365 * 24 * 60 * 60,
    });
    const freshReq = request(longLived);
    await expect(guard.canActivate(makeContext(freshReq))).resolves.toBe(true);
    expect(freshReq.user).toMatchObject({ sub: 'user-1' });

    // The same token, backdated past the bound, is refused — before the
    // Phase 24 fix this token was accepted for ten years.
    const backdated = sign({
      sub: 'user-1',
      email: 'a@b.c',
      role: 'USER',
      iat: now() - (ACCESS_TOKEN_TTL_SECONDS + 60),
      exp: now() + 10 * 365 * 24 * 60 * 60,
    });
    const staleReq = request(backdated);
    await expect(guard.canActivate(makeContext(staleReq))).rejects.toThrow(/Access token invalid or expired/);
    expect(staleReq.user).toBeUndefined();
  });

  it('refuses a correctly signed token that carries no issued-at claim', async () => {
    // `noTimestamp: true` is the only way to produce this with the real
    // signer. It is not something issuance can emit; accepting it would mean
    // the lifetime bound is decided by a claim the token itself controls.
    const noIat = jwt.sign(
      { sub: 'user-1', email: 'a@b.c', role: 'USER', exp: now() + 60 },
      { secret: VALID_SECRET, algorithm: 'HS256', noTimestamp: true },
    );
    const req = request(noIat);
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });

  it('still refuses a token signed with the wrong algorithm even when it is fresh', async () => {
    // The lifetime bound must not have replaced the algorithm pin: a fresh
    // HS512 token with the real secret is still not an HS256 token.
    const hs512 = jwt.sign(
      { sub: 'user-1', email: 'a@b.c', role: 'USER' },
      { secret: VALID_SECRET, algorithm: 'HS512' },
    );
    await expect(guard.canActivate(makeContext(request(hs512)))).rejects.toThrow(UnauthorizedException);
  });
});

/**
 * Phase 25 (F-1) — a future-dated `iat` must not defeat the Phase 24 bound.
 *
 * Phase 24 (D-2) claimed the effective validity of any accepted access token
 * is `min(exp, iat + 15m)`. That claim is FALSE for a token whose `iat` is in
 * the future, and not in a corner: `jsonwebtoken` evaluates `maxAge` as
 * `now >= iat + maxAge`, so a future `iat` defers the whole check to
 * `iat + 15m`. A correctly signed token with `iat` and `exp` ten years out
 * was accepted by a live NODE_ENV=production process with HTTP 200.
 *
 * Every case here signs a real token with the real secret, so the assertions
 * are about the verifier the image runs. A rule implemented only in a test
 * double would not be caught by them, which is why the mocked-verifier case
 * in the block above exists alongside these.
 */
describe('JwtAuthGuard — a future-dated `iat` cannot extend the access-token bound (Phase 25 F-1)', () => {
  const jwt = new JwtService({ secret: VALID_SECRET });
  const guard = new JwtAuthGuard(jwt);
  const now = () => Math.floor(Date.now() / 1000);
  const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

  const request = (token: string): { headers: Record<string, string>; user?: unknown } => ({
    headers: { authorization: `Bearer ${token}` },
  });
  const claims = { sub: 'user-1', email: 'a@b.c', role: 'USER' };
  const sign = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, { secret: VALID_SECRET, algorithm: 'HS256' });

  /**
   * A correctly signed HS256 token built by hand.
   *
   * The whole point of the future-`iat` cases is tokens the normal signer
   * would never produce, so the signer cannot be used to build them: it
   * validates `iat` and defaults it. This is the shape a party holding the
   * secret actually puts on the wire, and it is the shape the production
   * verifier has to refuse.
   */
  const handSign = (payload: Record<string, unknown>): string => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64(payload);
    const sig = createHmac('sha256', VALID_SECRET).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  };

  it('the tolerated future-`iat` window is 5 seconds', () => {
    // Literal, for the same reason the 15-minute lifetime is asserted as a
    // literal: comparing it against the constant the code reads would let a
    // widened window move the assertion with it, and the mutation harness
    // would pass while the control was gone.
    expect(ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS).toBe(5);
  });

  it('accepts a normal token (iat = now)', async () => {
    // The must-keep-working half. Every rule added to reject a malicious
    // token has to be shown not to reject an ordinary one.
    const req = request(sign({ ...claims, iat: now(), exp: now() + ACCESS_TOKEN_TTL_SECONDS }));
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'user-1' });
  });

  it('refuses an old token beyond the allowed age (iat = now - 16m, exp ten years out)', async () => {
    // Phase 24's bound still holds independently of the new one.
    const req = request(sign({ ...claims, iat: now() - (ACCESS_TOKEN_TTL_SECONDS + 60), exp: now() + TEN_YEARS }));
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('refuses a future `iat` (5 minutes ahead) whose `exp` is still in the future', async () => {
    const req = request(sign({ ...claims, iat: now() + 300, exp: now() + 300 }));
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('refuses a future `iat` AND a future `exp` ten years out — the Phase 25 review payload', async () => {
    const req = request(sign({ ...claims, iat: now() + TEN_YEARS, exp: now() + TEN_YEARS + 900 }));
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('refuses a future `iat` even when the token carries no `exp` at all', async () => {
    // `maxAge` alone accepts this: there is no expiry to contradict, and the
    // age bound is checked against an `iat` ten years away.
    const futureNoExp = jwt.sign(
      { ...claims, iat: now() + TEN_YEARS },
      { secret: VALID_SECRET, algorithm: 'HS256', noTimestamp: false },
    );
    const req = request(futureNoExp);
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('refuses a future `iat` that is only just past the tolerated window', async () => {
    const req = request(
      sign({ ...claims, iat: now() + ACCESS_TOKEN_MAX_FUTURE_IAT_SECONDS + 30, exp: now() + 900 }),
    );
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('accepts an `iat` inside the tolerated clock-skew window', async () => {
    // A rule that refused every future `iat` would also refuse a token minted
    // by a sibling instance whose clock runs a second fast, which is an
    // outage. The window is what distinguishes the two.
    const req = request(sign({ ...claims, iat: now() + 2, exp: now() + ACCESS_TOKEN_TTL_SECONDS }));
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it('refuses a non-numeric `iat` ("malformed" in the form the signer cannot emit)', async () => {
    // jsonwebtoken's signer refuses a non-numeric `iat`, so a string one can
    // only be hand-crafted — but it can be hand-crafted and correctly signed,
    // and `maxAge` then compares `now` against `String + 15m`, which in JS is
    // string concatenation, not addition. The guard's own rule refuses it
    // first, which is the order that does not depend on the library's
    // comparison semantics.
    const req = request(handSign({ ...claims, iat: `${now() + 900}`, exp: now() + 900 }));
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
    expect(req.user).toBeUndefined();
  });

  it('refuses `iat: Infinity` and `iat: NaN`', async () => {
    // JSON has no literal for either, so a hand-crafted token carries `null`
    // — and `null + 15m` is `null` concatenated, which compares false and so
    // never trips `maxAge`. Neither value is a usable NumericDate and neither
    // may be allowed to satisfy the bound by comparison.
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, null]) {
      const req = request(handSign({ ...claims, iat: bad, exp: now() + 900 }));
      await expect(guard.canActivate(makeContext(req))).rejects.toThrow(/Access token invalid or expired/);
      expect(req.user).toBeUndefined();
    }
  });

  it('is a property of the shared predicate, not of this guard alone', () => {
    // Any future verifier has to be able to apply the same rule; the constant
    // and the predicate live together in security-config for that reason.
    const t = 1_000_000_000;
    expect(isAccessTokenIssuedInThePast(t - 1, t)).toBe(true);
    expect(isAccessTokenIssuedInThePast(t + 5, t)).toBe(true);
    expect(isAccessTokenIssuedInThePast(t + 6, t)).toBe(false);
    expect(isAccessTokenIssuedInThePast(t + TEN_YEARS, t)).toBe(false);
    expect(isAccessTokenIssuedInThePast(undefined, t)).toBe(false);
    expect(isAccessTokenIssuedInThePast(`${t}`, t)).toBe(false);
    expect(isAccessTokenIssuedInThePast(null, t)).toBe(false);
  });
});
