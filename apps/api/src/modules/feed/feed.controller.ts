import {
  Body, Controller, Delete, ForbiddenException, Get, NotFoundException,
  Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthorizationService } from '../../auth/authorization.service';
import { FeedService } from './services/feed.service';
import { CreateFamilyUpdateDto } from './dto/create-update.dto';
import { UpdateFamilyUpdateDto } from './dto/update-update.dto';

@Controller('seniors/:seniorId/feed')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  private async assertAccess(req: Request, seniorId: string): Promise<void> {
    const user = (req as Request & { user?: { sub?: string } }).user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
  }

  @Post()
  async create(
    @Param('seniorId') seniorId: string,
    @Body() dto: CreateFamilyUpdateDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Only FAMILY_ADMIN, FAMILY_MEMBER, or CAREGIVER can post family updates.');
    }
    return this.feedService.createUpdate(seniorId, userId, {
      body: dto.body,
      visibility: (dto.visibility as 'CIRCLE' | 'ORGANIZATION' | 'PRIVATE') ?? 'CIRCLE',
      kind: dto.kind ?? 'free_form',
      relatedEntityType: dto.relatedEntityType as 'appointment' | 'medication' | 'care_task' | 'measurement' | undefined,
      relatedEntityId: dto.relatedEntityId,
    });
  }

  @Get()
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.feedService.findBySenior(seniorId, userId);
  }

  @Get(':updateId')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('updateId') updateId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const update = await this.feedService.findOne(seniorId, updateId, userId);
    if (!update) throw new NotFoundException('Family update not found.');
    return update;
  }

  @Patch(':updateId')
  async update(
    @Param('seniorId') seniorId: string,
    @Param('updateId') updateId: string,
    // Phase 24 (D-4): was `Partial<CreateFamilyUpdateDto>`, whose emitted
    // metatype is `Object` — a metatype the ValidationPipe skips, so this
    // route took an entirely unvalidated body. See UpdateFamilyUpdateDto.
    @Body() dto: UpdateFamilyUpdateDto,
    @Req() req: Request,
  ) {
    void dto;
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER') {
      throw new ForbiddenException('Only FAMILY_ADMIN or FAMILY_MEMBER can update family updates.');
    }
    // Stub for Phase 10 — full edit architecture documented but update deferred to full implementation.
    return { message: 'Family update update endpoint — architecture ready.', seniorId, updateId };
  }

  @Delete(':updateId')
  async archive(
    @Param('seniorId') seniorId: string,
    @Param('updateId') updateId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER') {
      throw new ForbiddenException('Only FAMILY_ADMIN or FAMILY_MEMBER can archive family updates.');
    }
    return this.feedService.archive(seniorId, updateId, userId);
  }
}
