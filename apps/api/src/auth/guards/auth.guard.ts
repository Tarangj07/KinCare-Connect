import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  isAccessTokenIssuedInThePast,
  resolveJwtAccessSecret,
} from '../../config/security-config';

/**
 * JWT authentication guard.
 *
 * Phase 16 (H5/A8): the previous implementation returned `true` whenever a
 * `refresh` cookie was present without validating anything or populating
 * `req.user`, letting requests through the guard unauthenticated. The
 * refresh flow owns its own `@Public()` route and does not need — and must
 * never implicitly receive — a bypass here. The only accepted credential is
 * a valid Bearer access token signed with the configured secret.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'];
    let token: string | undefined;

    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token) throw new UnauthorizedException('Access token missing.');

    try {
      // Phase 24 (D-2): `algorithms` pins the signing algorithm and the
      // subject check guarantees an identity, but `exp` alone only bounds a
      // token that this server issued. A correctly signed token carrying a
      // ten-year `exp` satisfied every check below until `maxAge` was added.
      // `maxAge` bounds what the VERIFIER will honour by the token's own
      // `iat`, so the guarantee no longer depends on how the token was
      // minted: the oldest access token this process will accept is
      // ACCESS_TOKEN_TTL_SECONDS old, whatever its `exp` claims. It is also
      // what makes the deactivated-account window (deferred D-1) a property
      // of verification rather than of issuance convention.
      //
      // A token with no `iat` is refused: jsonwebtoken's `maxAge` check is
      // defined in terms of `iat`, and every access token this service
      // issues carries one, so its absence means the token did not come from
      // the normal issuance path.
      //
      // Phase 25 (F-1). `maxAge` alone does not deliver the guarantee above.
      // jsonwebtoken evaluates `now >= iat + maxAge`, so a token whose `iat`
      // is in the FUTURE satisfies it for the whole of `iat + 15m` — and if
      // `iat` is ten years out, for ten years. A correctly signed token with
      // a future `iat` and a future `exp` was accepted by this guard in
      // production, which falsified "effective validity is min(exp, iat+15m)"
      // for exactly the tokens the bound was added to constrain. The library
      // offers no option for this (its `clockTolerance` only widens `exp`
      // and `nbf`), so the rule is applied here, from the one shared
      // predicate in `security-config` that issuance and verification read.
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        role: string;
        iat?: number;
      }>(token, {
        secret: resolveJwtAccessSecret(),
        algorithms: ['HS256'],
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
      });
      // Identity guarantee: a passing request always has a subject.
      if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new UnauthorizedException('Access token invalid or expired.');
      }
      if (!isAccessTokenIssuedInThePast(payload.iat)) {
        throw new UnauthorizedException('Access token invalid or expired.');
      }
      (req as Request & { user: { sub: string; email: string; role: string } }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Access token invalid or expired.');
    }
  }
}
