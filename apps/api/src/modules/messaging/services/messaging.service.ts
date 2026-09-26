import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationService } from '../../../auth/authorization.service';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private async assertConversationAccess(userId: string, seniorId: string, conversationId: string): Promise<void> {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, seniorId, deletedAt: null },
      include: { participants: { where: { userId, leftAt: null, createdAt: { gt: '1970-01-01' } } } },
    });
    if (!conversation) {
      throw new ForbiddenException('Access denied: conversation not accessible for this senior or user is not a participant.');
    }
    if (conversation.participants.length === 0) {
      throw new ForbiddenException('Access denied: user is not a participant in this conversation.');
    }
  }

  async createConversation(seniorId: string, userId: string, title?: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const conversation = await this.prisma.conversation.create({
      data: { seniorId, title: title ?? `Conversation - ${new Date().toISOString()}` },
    });
    await this.prisma.conversationParticipant.create({
      data: { conversationId: conversation.id, userId },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'messaging.conversation.created',
        resourceType: 'conversation',
        resourceId: conversation.id,
        seniorId,
        metadata: { title: conversation.title ?? null },
      },
    });
    return conversation;
  }

  async addParticipant(seniorId: string, conversationId: string, userId: string, targetUserId: string) {
    await this.assertConversationAccess(userId, seniorId, conversationId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, seniorId, deletedAt: null },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    // Verify targetUserId is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(targetUserId)) {
      throw new ForbiddenException('Invalid targetUserId format.');
    }

    // Verify target user has ACTIVE CareCircle membership for this senior's care context
    await this.authorizationService.assertCanAccessSenior(targetUserId, seniorId);
    const existing = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: targetUserId, leftAt: null },
    });
    if (existing) return existing;
    const participant = await this.prisma.conversationParticipant.create({
      data: { conversationId, userId: targetUserId },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'messaging.participant.added',
        resourceType: 'conversation_participant',
        resourceId: participant.id,
        seniorId,
        metadata: { conversationId, targetUserId },
      },
    });
    return participant;
  }

  async createMessage(seniorId: string, userId: string, conversationId: string, body: string, replyToId?: string) {
    await this.assertConversationAccess(userId, seniorId, conversationId);
    const conversationState = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { isClosed: true },
    });
    if (conversationState?.isClosed) {
      throw new ForbiddenException('Conversation is closed. New messages are not allowed.');
    }
    if (replyToId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(replyToId)) {
        throw new ForbiddenException('Invalid replyToId format.');
      }
      const replyMessage = await this.prisma.message.findFirst({
        where: {
          id: replyToId,
          conversationId,
          isDeleted: false,
        },
      });
      if (!replyMessage) {
        throw new ForbiddenException('Reply reference message not found or does not belong to this conversation.');
      }
    }
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderUserId: userId,
        seniorId,
        body,
        replyToId: replyToId ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'messaging.message.created',
        resourceType: 'message',
        resourceId: message.id,
        seniorId,
        metadata: { conversationId, replyToId: replyToId ?? null, hasBody: true },
      },
    });
    // Notification event boundary: reference only IDs, never message body.
    // Phase 16 (A22): notify the *other* active participants, not the
    // sender — previously the row was addressed to the sender, so no
    // recipient ever received anything.
    const recipients = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, leftAt: null, userId: { not: userId } },
      select: { userId: true },
    });
    for (const recipient of recipients) {
      await this.prisma.notification.create({
        data: {
          userId: recipient.userId,
          seniorId,
          kind: 'messaging.new_message',
          payload: { conversationId, messageId: message.id, senderUserId: userId },
          channel: 'IN_APP',
        },
      });
    }
    return message;
  }

  async getMessages(seniorId: string, userId: string, conversationId: string, skip = 0, take = 20) {
    await this.assertConversationAccess(userId, seniorId, conversationId);
    if (skip < 0) skip = 0;
    if (take > 100 || take < 1) take = 20;
    return this.prisma.message.findMany({
      where: { conversationId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
      include: { sender: { select: { id: true, fullName: true, email: true } }, replyTo: { select: { id: true } } },
    });
  }

  async getConversation(seniorId: string, userId: string, conversationId: string) {
    await this.assertConversationAccess(userId, seniorId, conversationId);
    return this.prisma.conversation.findFirst({
      where: { id: conversationId, seniorId, deletedAt: null },
      include: { participants: { where: { leftAt: null }, include: { user: { select: { id: true, fullName: true, email: true } } } }, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
  }

  async listConversations(seniorId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    return this.prisma.conversation.findMany({
      where: {
        seniorId,
        deletedAt: null,
        participants: { some: { userId, leftAt: null } },
      },
      include: { participants: { where: { leftAt: null }, include: { user: { select: { id: true, fullName: true } } } }, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async markRead(seniorId: string, userId: string, conversationId: string) {
    await this.assertConversationAccess(userId, seniorId, conversationId);
    return this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId, leftAt: null },
      data: { lastReadAt: new Date() },
    });
  }
}
