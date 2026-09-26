import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async createUpdate(seniorId: string, userId: string, data: { body: string; visibility?: 'CIRCLE' | 'ORGANIZATION' | 'PRIVATE'; kind?: string; relatedEntityType?: 'appointment' | 'medication' | 'care_task' | 'measurement'; relatedEntityId?: string }) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    // FAMILY_ADMIN, FAMILY_MEMBER, CAREGIVER all can post updates.
    // OBSERVER cannot post (read-only). DOCTOR can post clinical updates.
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to post family updates.');
    }
    const update = await this.prisma.familyUpdate.create({
      data: {
        seniorId,
        authorUserId: userId,
        body: data.body,
        visibility: (data.visibility as 'CIRCLE' | 'ORGANIZATION' | 'PRIVATE') ?? 'CIRCLE',
        kind: data.kind ?? 'free_form',
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'family_feed.post_created',
        resourceType: 'family_update',
        resourceId: update.id,
        seniorId,
        metadata: { visibility: data.visibility ?? 'CIRCLE', kind: data.kind ?? 'free_form' },
      },
    });
    return update;
  }

  /**
   * Phase 16 (H6/A4): PRIVATE posts are author-only. Previously the
   * visibility column was only honoured if the client asked for it, so a
   * "private" update was returned to every circle member (including
   * OBSERVERs). CIRCLE and ORGANIZATION posts stay visible to circle
   * members (organisation-scoped separation is not yet implemented).
   */
  private visibilityWhere(userId: string, requested?: 'CIRCLE' | 'ORGANIZATION' | 'PRIVATE') {
    const and: Record<string, unknown>[] = [
      { OR: [{ visibility: { not: 'PRIVATE' as const } }, { authorUserId: userId }] },
    ];
    if (requested) and.push({ visibility: requested });
    return and;
  }

  async findBySenior(seniorId: string, userId: string, visibility?: 'CIRCLE' | 'ORGANIZATION' | 'PRIVATE') {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const where: Record<string, unknown> = {
      seniorId,
      deletedAt: null,
      AND: this.visibilityWhere(userId, visibility),
    };
    return this.prisma.familyUpdate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { fullName: true } }, comments: { take: 3, orderBy: { createdAt: 'desc' }, include: { author: { select: { fullName: true } } } } },
    });
  }

  async findOne(seniorId: string, updateId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const update = await this.prisma.familyUpdate.findFirst({
      where: {
        id: updateId,
        seniorId,
        deletedAt: null,
        AND: this.visibilityWhere(userId),
      },
      include: { comments: { include: { author: { select: { fullName: true } } } }, author: { select: { fullName: true } } },
    });
    if (!update) throw new NotFoundException('Family update not found.');
    return update;
  }

  async archive(seniorId: string, updateId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER') {
      throw new ForbiddenException('Only FAMILY_ADMIN or FAMILY_MEMBER can archive family updates.');
    }
    const update = await this.prisma.familyUpdate.findFirst({ where: { id: updateId, seniorId, deletedAt: null } });
    if (!update) throw new NotFoundException('Family update not found.');
    // Only the original author or FAMILY_ADMIN can archive.
    if (update.authorUserId !== userId && role !== 'FAMILY_ADMIN') {
      throw new ForbiddenException('Only the original author or FAMILY_ADMIN can archive updates.');
    }
    const updated = await this.prisma.familyUpdate.update({
      where: { id: updateId },
      data: { deletedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'family_feed.post_deleted',
        resourceType: 'family_update',
        resourceId: updateId,
        seniorId,
        metadata: {},
      },
    });
    return updated;
  }

  async addComment(seniorId: string, updateId: string, userId: string, body: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Only FAMILY_ADMIN, FAMILY_MEMBER, or CAREGIVER can comment on family updates.');
    }
    const update = await this.prisma.familyUpdate.findFirst({ where: { id: updateId, seniorId, deletedAt: null } });
    if (!update) throw new NotFoundException('Family update not found.');
    const comment = await this.prisma.comment.create({
      data: {
        updateId,
        authorUserId: userId,
        body,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'family_feed.comment_created',
        resourceType: 'comment',
        resourceId: comment.id,
        seniorId,
        metadata: { updateId },
      },
    });
    return comment;
  }
}
