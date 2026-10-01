/**
 * Phase 49 — care-circle and membership management.
 *
 * Every route below requires an existing `AuthorizationService` membership
 * for the circle's senior. There is no self-service path here: no request
 * shape lets a caller name a senior they cannot already reach.
 *
 * `ParseUUIDPipe` is applied to the id parameters so a malformed id is a
 * 400 at the boundary rather than a Prisma client-validation error.
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

// VALUE imports — see the Phase 22 (F-01) note in `auth.controller.ts`.
import { AddCareCircleMemberDto } from './dto/add-circle-member.dto';
import { CreateCareCircleDto } from './dto/create-care-circle.dto';
import { CareCircleService } from './services/care-circle.service';

@Controller('care-circles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('USER', 'SUPER_ADMIN')
export class CareCircleController {
  constructor(private readonly careCircleService: CareCircleService) {}

  private getUserId(req: Request): string {
    const user = (req as Request & { user?: { sub?: string } }).user;
    if (!user?.sub) throw new ForbiddenException('Authentication required.');
    return user.sub;
  }

  @Post()
  async create(@Body() dto: CreateCareCircleDto, @Req() req: Request) {
    return this.careCircleService.createCircle(this.getUserId(req), {
      seniorId: dto.seniorId,
      name: dto.name,
      description: dto.description,
    });
  }

  @Get(':circleId/members')
  async listMembers(
    @Param('circleId', new ParseUUIDPipe({ version: '4' })) circleId: string,
    @Req() req: Request,
  ) {
    return this.careCircleService.listMembers(this.getUserId(req), circleId);
  }

  @Post(':circleId/members')
  async addMember(
    @Param('circleId', new ParseUUIDPipe({ version: '4' })) circleId: string,
    @Body() dto: AddCareCircleMemberDto,
    @Req() req: Request,
  ) {
    return this.careCircleService.addMember(this.getUserId(req), circleId, {
      userId: dto.userId,
      role: dto.role,
      displayName: dto.displayName,
      notes: dto.notes,
    });
  }

  @Delete(':circleId/members/:memberId')
  async removeMember(
    @Param('circleId', new ParseUUIDPipe({ version: '4' })) circleId: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Req() req: Request,
  ) {
    return this.careCircleService.removeMember(this.getUserId(req), circleId, memberId);
  }
}