import {
  Body, Controller, Get, Post, Patch, Delete, ForbiddenException,
  NotFoundException, UseGuards, Req, Param,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthorizationService } from '../../auth/authorization.service';

@Controller('seniors/:seniorId/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CareTaskController {
  constructor(
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
    @Body() body: { title: string; description?: string; priority?: string; dueAt?: string; recurrenceFrequency?: string; recurrenceEndsAt?: string; recurrenceRule?: string },
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER') {
      throw new ForbiddenException('Only FAMILY_ADMIN or FAMILY_MEMBER can create care tasks.');
    }
    return { message: 'Task creation not yet fully implemented — architecture ready for Phase 7.', seniorId, body };
  }

  @Get()
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    return { message: 'Task list endpoint — architecture ready.', seniorId };
  }

  @Get(':taskId')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    return { message: 'Task detail endpoint — architecture ready.', seniorId, taskId };
  }

  @Patch(':taskId')
  async update(
    @Param('seniorId') seniorId: string,
    @Param('taskId') taskId: string,
    @Body() body: { title?: string; description?: string; priority?: string; status?: string; dueAt?: string; completedAt?: string },
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Insufficient privileges to modify task.');
    }
    return { message: 'Task update endpoint — architecture ready.', seniorId, taskId };
  }

  @Delete(':taskId')
  async cancel(
    @Param('seniorId') seniorId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN') {
      throw new ForbiddenException('Only FAMILY_ADMIN can cancel tasks.');
    }
    return { message: 'Task cancelled endpoint — architecture ready.', seniorId, taskId };
  }
}
