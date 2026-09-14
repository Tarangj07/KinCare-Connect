import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CircleRole } from '@prisma/client';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async canAccessSenior(userId: string, seniorId: string): Promise<boolean> {
    const seniorProfile = await this.prisma.seniorProfile.findUnique({
      where: { id: seniorId, deletedAt: null, isActive: true },
    });
    if (!seniorProfile) return false;

    const circles = await this.prisma.careCircle.findMany({
      where: { seniorId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (circles.length === 0) return false;

    const circleIds = circles.map((c) => c.id);
    const membership = await this.prisma.careCircleMember.findFirst({
      where: {
        circleId: { in: circleIds },
        userId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { role: true },
    });
    return membership !== null;
  }

  async getMemberRole(userId: string, seniorId: string): Promise<CircleRole | null> {
    const seniorProfile = await this.prisma.seniorProfile.findUnique({
      where: { id: seniorId, deletedAt: null, isActive: true },
    });
    if (!seniorProfile) return null;

    const circles = await this.prisma.careCircle.findMany({
      where: { seniorId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    const membership = await this.prisma.careCircleMember.findFirst({
      where: {
        circleId: { in: circles.map((c) => c.id) },
        userId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { role: true },
    });
    return (membership?.role as CircleRole | null) ?? null;
  }

  async isFamilyAdmin(userId: string, seniorId: string): Promise<boolean> {
    return (await this.getMemberRole(userId, seniorId)) === 'FAMILY_ADMIN';
  }

  async isFamilyMember(userId: string, seniorId: string): Promise<boolean> {
    const role = await this.getMemberRole(userId, seniorId);
    return role === 'FAMILY_ADMIN' || role === 'FAMILY_MEMBER';
  }

  async isCaregiver(userId: string, seniorId: string): Promise<boolean> {
    return (await this.getMemberRole(userId, seniorId)) === 'CAREGIVER';
  }

  async isDoctor(userId: string, seniorId: string): Promise<boolean> {
    return (await this.getMemberRole(userId, seniorId)) === 'DOCTOR';
  }

  async isObserver(userId: string, seniorId: string): Promise<boolean> {
    return (await this.getMemberRole(userId, seniorId)) === 'OBSERVER';
  }

  async assertCanAccessSenior(userId: string, seniorId: string): Promise<void> {
    const can = await this.canAccessSenior(userId, seniorId);
    if (!can) {
      throw new ForbiddenException('Access denied: no authorized care-circle membership for this senior.');
    }
  }
}
