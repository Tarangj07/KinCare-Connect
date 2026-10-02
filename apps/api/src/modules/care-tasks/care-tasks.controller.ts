import {
  Body, Controller, Get, Post, Patch, Delete, ForbiddenException,
  NotFoundException, UseGuards, Req, Param,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthorizationService } from '../../auth/authorization.service';
// VALUE imports — see the Phase 22 (F-01) / Phase 24 (D-4) / Phase 25 (F-3)
// notes in `auth.controller.ts` and `feed.controller.ts`. An `import type` is
// elided at compile time, so `design:paramtypes` carries no real class, the
// metatype degrades to `Object`, and the global ValidationPipe (whose skip-list
// contains `Object`) silently stops validating the body. `verify:routes` reads
// the compiled artifact and fails on exactly that.
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CareTaskService } from './services/care-task.service';

@Controller('seniors/:seniorId/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CareTaskController {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly careTaskService: CareTaskService,
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
    @Body() body: CreateTaskDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN, FAMILY_MEMBER, CAREGIVER, or DOCTOR can create care tasks.');
    }
    return this.careTaskService.create(seniorId, userId, body);
  }

  @Get()
  async list(
    @Param('seniorId') seniorId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.careTaskService.findBySenior(seniorId, userId);
  }

  @Get(':taskId')
  async getOne(
    @Param('seniorId') seniorId: string,
    @Param('taskId') taskId: string,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    return this.careTaskService.findOne(seniorId, taskId, userId);
  }

  @Patch(':taskId')
  async update(
    @Param('seniorId') seniorId: string,
    @Param('taskId') taskId: string,
    @Body() body: UpdateTaskDto,
    @Req() req: Request,
  ) {
    await this.assertAccess(req, seniorId);
    const userId = (req as Request & { user: { sub: string } }).user.sub;
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'CAREGIVER') {
      throw new ForbiddenException('Insufficient privileges to modify task.');
    }
    return this.careTaskService.update(seniorId, taskId, userId, body);
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
    return this.careTaskService.cancel(seniorId, taskId, userId);
  }
}
