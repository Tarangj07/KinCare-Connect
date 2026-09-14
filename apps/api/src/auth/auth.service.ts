import { ForbiddenException, Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { PrismaService } from '../database/prisma.service';

export interface LoginResult {
  user: { id: string; email: string; fullName: string; globalRole: string };
  access: string;
  refresh: string;
  familyId: string;
}

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
    return argon2.verify(hash, password);
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

  async login(data: { email: string; password: string }): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const match = await this.verifyHash(user.passwordHash, data.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    if (user.failedLoginCount >= 10 && user.lockedUntil && user.lockedUntil > new Date()) {
      await this.prisma.auditLog.create({
        data: { actorUserId: user.id, actorType: 'USER', action: 'auth.login.locked', resourceType: 'user', resourceId: user.id, metadata: { failedLoginCount: user.failedLoginCount } },
      });
      throw new ForbiddenException('Account temporarily locked due to too many failed attempts.');
    }

    const familyId = user.id;
    const { token, familyId: family, jti, hashedToken } = await this.generateRefreshToken(user.id, familyId);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: family,
        jti,
        tokenHash: hashedToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.auditLog.create({
      data: { actorUserId: user.id, actorType: 'USER', action: 'auth.login', resourceType: 'user', resourceId: user.id, metadata: { success: true } },
    });

    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, globalRole: user.globalRole as string },
      access: this.generateAccessToken(user.id, user.email, user.globalRole),
      refresh: token,
      familyId: family,
    };
  }

  async refresh(tokenString: string): Promise<string> {
    const rows = await this.prisma.refreshToken.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
    let found: (typeof rows)[number] | undefined;
    for (const r of rows) {
      if (await this.verifyHash(r.tokenHash, tokenString)) {
        found = r; break;
      }
    }
    if (!found) throw new UnauthorizedException('Refresh token invalid or expired');

    const user = await this.prisma.user.findUnique({ where: { id: found.userId, isActive: true } });
    if (!user) throw new UnauthorizedException('Account not active');

    const family = await this.prisma.refreshToken.findMany({ where: { familyId: found.familyId, revokedAt: null } });
    const newer = family.some((t) => t.id !== found.id && t.updatedAt > found.updatedAt);
    if (newer) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: found.familyId }, data: { revokedAt: new Date() } });
      await this.prisma.auditLog.create({
        data: { actorUserId: user.id, actorType: 'USER', action: 'auth.refresh.reuse_detected', resourceType: 'refresh_token', resourceId: found.familyId, metadata: {} },
      });
      throw new ForbiddenException('Refresh token reused — family revoked');
    }

    await this.prisma.refreshToken.update({ where: { id: found.id }, data: { revokedAt: new Date() } });
    const { token, jti, hashedToken } = await this.generateRefreshToken(user.id, found.familyId);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, familyId: found.familyId, jti, tokenHash: hashedToken, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
    await this.prisma.refreshToken.update({ where: { id: found.id }, data: { replacedById: (await this.prisma.refreshToken.findFirst({ where: { userId: user.id, familyId: found.familyId, tokenHash: hashedToken }, orderBy: { createdAt: 'desc' } }))?.id ?? null } });
    await this.prisma.auditLog.create({ data: { actorUserId: user.id, actorType: 'USER', action: 'auth.refresh', resourceType: 'user', resourceId: user.id, metadata: { rotated: true } } });
    return this.generateAccessToken(user.id, user.email, user.globalRole);
  }

  async logout(tokenString?: string) {
    if (tokenString) {
      const rows = await this.prisma.refreshToken.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
      for (const r of rows) {
        if (await this.verifyHash(r.tokenHash, tokenString)) {
          await this.prisma.refreshToken.update({ where: { id: r.id }, data: { revokedAt: new Date() } });
          await this.prisma.auditLog.create({ data: { actorUserId: r.userId, actorType: 'USER', action: 'auth.logout', resourceType: 'refresh_token', resourceId: r.id, metadata: { revoked: true } } });
          break;
        }
      }
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const match = await this.verifyHash(user.passwordHash, currentPassword);
    if (!match) throw new UnauthorizedException('Current password does not match');

    const newHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    await this.prisma.auditLog.create({ data: { actorUserId: userId, actorType: 'USER', action: 'auth.password.change', resourceType: 'user', resourceId: userId, metadata: {} } });
  }

  async revokeAllRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorUserId: userId, actorType: 'USER', action: 'auth.logout_all', resourceType: 'user', resourceId: userId, metadata: { revokedAll: true } } });
  }

  private generateAccessToken(userId: string, email: string, globalRole: string): string {
    return this.jwt.sign({ sub: userId, email, role: globalRole }, { expiresIn: '15m', secret: process.env['JWT_ACCESS_SECRET'] ?? 'dev-secret-change-me' });
  }

  private async generateRefreshToken(userId: string, familyId: string) {
    const jti = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const rawToken = Array.from({ length: 64 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const hashedToken = await this.hashPassword(rawToken);
    return { token: rawToken, familyId, jti, hashedToken };
  }
}
