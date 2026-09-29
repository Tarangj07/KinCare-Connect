import { ForbiddenException, Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { timingSafeEqual } from 'crypto';

import { PrismaService } from '../database/prisma.service';
import { ACCESS_TOKEN_TTL_SECONDS, generateTokenId, generateTokenSecret, hashToken, resolveJwtAccessSecret } from '../config/security-config';

export interface LoginResult {
  user: { id: string; email: string; fullName: string; globalRole: string };
  access: string;
  refresh: string;
  familyId: string;
}

export interface TokenMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
const REFRESH_TTL_DAYS = 30;

interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  jti: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/**
 * Authentication service.
 *
 * Phase 16 remediations applied here:
 * - C1/A1: refresh tokens and jtis now come from the CSPRNG.
 * - C2/A2: JWT secret resolved via security-config with fail-fast
 *   validation (no silent fallback to a known dev secret).
 * - H3/A5: refresh-token reuse detection works — replay of a revoked or
 *   already-rotated token revokes the whole rotation family.
 * - H4/A6: verification is O(1) — the token embeds its jti, so lookup is
 *   an indexed findUnique; secrets (256-bit CSPRNG) are SHA-256 hashed at
 *   rest as documented in the Prisma schema, removing the Argon2 scan.
 * - H7/A7: failed logins increment counters and lock the account;
 *   successful logins reset them.
 * - H8: deactivated/soft-deleted accounts cannot obtain tokens.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verifyHash(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed/placeholder stored hashes (e.g. seed data) must fail
      // closed as an authentication error, not a 500.
      return false;
    }
  }

  async register(data: { email: string; password: string; fullName: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ForbiddenException('Email already registered');

    const hash = await this.hashPassword(data.password);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: hash,
        fullName: data.fullName,
        globalRole: 'USER',
        emailVerified: false,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        actorType: 'USER',
        action: 'auth.register',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { email: data.email },
      },
    });

    return { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole as string };
  }

  async login(data: { email: string; password: string }, meta?: TokenMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });

    // H7/A7: lockout is checked BEFORE password verification so a locked
    // account cannot be probed at all.
    if (user && user.failedLoginCount >= MAX_FAILED_LOGINS && user.lockedUntil && user.lockedUntil > new Date()) {
      await this.prisma.auditLog.create({
        data: { actorUserId: user.id, actorType: 'USER', action: 'auth.login.locked', resourceType: 'user', resourceId: user.id, metadata: { failedLoginCount: user.failedLoginCount } },
      });
      throw new ForbiddenException('Account temporarily locked due to too many failed attempts.');
    }

    const match = user ? await this.verifyHash(user.passwordHash, data.password) : false;
    if (!user || !match) {
      // H7/A7: increment the counter and audit the failure so credential
      // stuffing is actually throttled and observable.
      if (user) {
        const updated = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: { increment: 1 },
            ...(user.failedLoginCount + 1 >= MAX_FAILED_LOGINS ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) } : {}),
          },
        });
        await this.prisma.auditLog.create({
          data: { actorUserId: user.id, actorType: 'USER', action: 'auth.login.failed', resourceType: 'user', resourceId: user.id, metadata: { failedLoginCount: updated.failedLoginCount }, ipAddress: meta?.ip ?? null, userAgent: meta?.userAgent ?? null },
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // H8/A7: deactivated or soft-deleted accounts must not obtain tokens.
    if (!user.isActive || user.deletedAt !== null) {
      await this.prisma.auditLog.create({
        data: { actorUserId: user.id, actorType: 'USER', action: 'auth.login.inactive', resourceType: 'user', resourceId: user.id, metadata: {} },
      });
      throw new ForbiddenException('Account is deactivated.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // One rotation family per login (per device), per ARCHITECTURE §4.6.
    const familyId = generateTokenId();
    const { token, jti, hashedToken } = this.generateRefreshToken();

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        jti,
        tokenHash: hashedToken,
        ipAddress: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.auditLog.create({
      data: { actorUserId: user.id, actorType: 'USER', action: 'auth.login', resourceType: 'user', resourceId: user.id, metadata: { success: true }, ipAddress: meta?.ip ?? null, userAgent: meta?.userAgent ?? null },
    });

    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole as string },
      access: this.generateAccessToken(user.id, user.email, user.globalRole),
      refresh: token,
      familyId,
    };
  }

  /**
   * Rotate a refresh token. Returns { access, refresh } — the caller is
   * responsible for persisting/delivering the new refresh token (cookie for
   * web, secure storage for mobile).
   */
  async refresh(tokenString: string, meta?: TokenMeta): Promise<{ access: string; refresh: string; familyId: string }> {
    const parsed = this.parseRefreshToken(tokenString);
    if (!parsed) throw new UnauthorizedException('Refresh token invalid or expired');

    // H4/A6: O(1) indexed lookup by embedded jti — no table scan, no
    // per-row Argon2 work that an attacker could amplify.
    const found = (await this.prisma.refreshToken.findUnique({ where: { jti: parsed.jti } })) as RefreshTokenRecord | null;
    if (!found) throw new UnauthorizedException('Refresh token invalid or expired');

    if (!this.tokenSecretMatches(found.tokenHash, parsed.secret)) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // H3/A5: reuse detection — a revoked or already-superseded token is
    // proof of replay. Revoke the entire rotation family.
    if (found.revokedAt !== null || found.replacedById !== null) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: found.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.prisma.auditLog.create({
        data: { actorUserId: found.userId, actorType: 'USER', action: 'auth.refresh.reuse_detected', resourceType: 'refresh_token', resourceId: found.familyId, metadata: { jti: found.jti }, ipAddress: meta?.ip ?? null, userAgent: meta?.userAgent ?? null },
      });
      throw new ForbiddenException('Refresh token reused — family revoked');
    }

    if (found.expiresAt <= new Date()) throw new UnauthorizedException('Refresh token invalid or expired');

    const user = await this.prisma.user.findUnique({ where: { id: found.userId, isActive: true } });
    if (!user) throw new UnauthorizedException('Account not active');

    const { token, jti, hashedToken } = this.generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Race-safe rotation: the new token is created and the old one
    // conditionally revoked atomically; if the old row was revoked by a
    // concurrent request in the meantime, treat it as reuse.
    const rotated = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { userId: user.id, familyId: found.familyId, jti, tokenHash: hashedToken, expiresAt, ipAddress: meta?.ip ?? null, userAgent: meta?.userAgent ?? null },
      });
      const revokeOld = await tx.refreshToken.updateMany({
        where: { id: found.id, revokedAt: null, replacedById: null },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      return revokeOld.count === 1 ? created : null;
    });

    if (!rotated) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: found.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.prisma.auditLog.create({
        data: { actorUserId: found.userId, actorType: 'USER', action: 'auth.refresh.reuse_detected', resourceType: 'refresh_token', resourceId: found.familyId, metadata: { race: true } },
      });
      throw new ForbiddenException('Refresh token reused — family revoked');
    }

    await this.prisma.auditLog.create({ data: { actorUserId: user.id, actorType: 'USER', action: 'auth.refresh', resourceType: 'user', resourceId: user.id, metadata: { rotated: true } } });
    return {
      access: this.generateAccessToken(user.id, user.email, user.globalRole),
      refresh: token,
      familyId: found.familyId,
    };
  }

  async logout(tokenString?: string, userId?: string) {
    if (!tokenString) return;
    const parsed = this.parseRefreshToken(tokenString);
    if (!parsed) return;
    const row = (await this.prisma.refreshToken.findUnique({ where: { jti: parsed.jti } })) as RefreshTokenRecord | null;
    if (!row) return;
    if (userId && row.userId !== userId) return; // never act on another user's token
    if (!this.tokenSecretMatches(row.tokenHash, parsed.secret)) return;
    if (row.revokedAt) return;

    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorUserId: row.userId, actorType: 'USER', action: 'auth.logout', resourceType: 'refresh_token', resourceId: row.id, metadata: { revoked: true } } });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const match = await this.verifyHash(user.passwordHash, currentPassword);
    if (!match) throw new UnauthorizedException('Current password does not match');

    const newHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash, failedLoginCount: 0, lockedUntil: null } });
    // Credential change invalidates every existing session.
    await this.revokeAllRefreshTokens(userId);
    await this.prisma.auditLog.create({ data: { actorUserId: userId, actorType: 'USER', action: 'auth.password.change', resourceType: 'user', resourceId: userId, metadata: {} } });
  }

  async revokeAllRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorUserId: userId, actorType: 'USER', action: 'auth.logout_all', resourceType: 'user', resourceId: userId, metadata: { revokedAll: true } } });
  }

  /**
   * Profile for `GET /auth/me`. The subject is taken from the validated
   * JWT only; the database is the source of truth for liveness, so a
   * deactivated account stops being reported as active (H8).
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.deletedAt !== null) {
      throw new UnauthorizedException('Account not active');
    }
    return { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole as string };
  }

  private generateAccessToken(userId: string, email: string, globalRole: string): string {
    // Phase 24 (D-2): the literal '15m' here and in AppModule's signOptions
    // were two independent copies of the same policy, and neither constrained
    // the verifier. All three now read ACCESS_TOKEN_TTL_SECONDS.
    return this.jwt.sign({ sub: userId, email, role: globalRole }, { expiresIn: ACCESS_TOKEN_TTL_SECONDS, secret: resolveJwtAccessSecret() });
  }

  /**
   * Refresh token format: `<jti>.<256-bit CSPRNG secret>`.
   * The jti (from the CSPRNG, via crypto.randomUUID) gives O(1) indexed
   * lookup; the secret half is never stored in plaintext — only its
   * SHA-256 digest, per the schema's documented design.
   */
  private generateRefreshToken() {
    const jti = generateTokenId();
    const rawSecret = generateTokenSecret();
    const rawToken = `${jti}.${rawSecret}`;
    const hashedToken = hashToken(rawSecret);
    return { token: rawToken, jti, hashedToken };
  }

  private parseRefreshToken(token: string): { jti: string; secret: string } | null {
    if (typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    return { jti: token.slice(0, dot), secret: token.slice(dot + 1) };
  }

  private tokenSecretMatches(storedHashHex: string, secret: string): boolean {
    const computed = Buffer.from(hashToken(secret), 'hex');
    let stored: Buffer;
    try {
      stored = Buffer.from(storedHashHex, 'hex');
    } catch {
      return false;
    }
    if (computed.length !== stored.length) return false;
    return timingSafeEqual(computed, stored);
  }
}
