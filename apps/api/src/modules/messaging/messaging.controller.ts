import {
  Controller, Post, Get, Body, Param, Query, Req,
  ForbiddenException, NotFoundException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthorizationService } from '../../auth/authorization.service';
import { MessagingService } from './services/messaging.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { AddConversationParticipantDto } from './dto/add-participant.dto';

/**
 * Secure messaging endpoints — Phase 11.
 *
 * Authorization model (two layers):
 * 1. ACTIVE CareCircleMember for senior (verified by AuthorizationService).
 * 2. Explicit ConversationParticipant for conversation (verified by service).
 * CareCircle membership ALONE does NOT grant conversation access.
 */
@Controller('seniors/:seniorId/conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private getUserId(req: Request): string {
    const user = (req as Request & { user?: { sub?: string } }).user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    return userId;
  }

  @Post()
  async createConversation(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.messagingService.createConversation(seniorId, userId);
  }

  @Post(':conversationId/messages')
  async sendMessage(
    @Param('seniorId') seniorId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateMessageDto,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    // Conversation identity derived from route, never body.
    // Sender identity derived from JWT (userId), never body.
    return this.messagingService.createMessage(seniorId, userId, conversationId, dto.body, dto.replyToId);
  }

  @Get()
  async listConversations(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.messagingService.listConversations(seniorId, userId);
  }

  @Get(':conversationId')
  async getConversation(
    @Param('seniorId') seniorId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.messagingService.getConversation(seniorId, userId, conversationId);
  }

  @Get(':conversationId/messages')
  async listMessages(
    @Param('seniorId') seniorId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const userId = this.getUserId(req);
    const skipNum = skip ? parseInt(skip, 10) : 0;
    const takeNum = take ? parseInt(take, 10) : 20;
    return this.messagingService.getMessages(seniorId, userId, conversationId, skipNum, takeNum);
  }

  @Post(':conversationId/read')
  async markRead(
    @Param('seniorId') seniorId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.messagingService.markRead(seniorId, userId, conversationId);
  }

  @Post(':conversationId/participants')
  async addParticipant(
    @Param('seniorId') seniorId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: AddConversationParticipantDto,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    // Phase 25 (F-3): the shape check moved into the DTO's class-validator
    // constraints, so the whole request body is whitelisted and an unexpected
    // property is a 400 instead of a silent no-op. `ForbiddenException` is no
    // longer raised here; a malformed body is a 400 from ValidationPipe.
    return this.messagingService.addParticipant(seniorId, conversationId, userId, dto.targetUserId);
  }
}
