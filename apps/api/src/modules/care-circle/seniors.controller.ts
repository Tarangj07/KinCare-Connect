/**
 * Phase 49 — senior provisioning.
 *
 * `POST /api/v1/seniors` is the single legitimate entry point to every
 * senior-scoped capability in the API (PR-48-01 / PR-48-03). It is the only
 * route in the codebase that establishes care-circle access, and it does so
 * exclusively for the caller.
 *
 * No `@Public()`: an anonymous caller gets 401 from `JwtAuthGuard`.
 */
import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

// VALUE import — see the Phase 22 (F-01) note in `auth.controller.ts`. An
// `import type` is elided, so `design:paramtypes` would carry no real class
// and the global ValidationPipe would skip this DTO entirely.
import { CreateSeniorDto } from './dto/create-senior.dto';
import { SeniorService } from './services/senior.service';

@Controller('seniors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('USER', 'SUPER_ADMIN')
export class SeniorsController {
  constructor(private readonly seniorService: SeniorService) {}

  @Post()
  async onboard(@Body() dto: CreateSeniorDto, @Req() req: Request) {
    const user = (req as Request & { user?: { sub?: string } }).user;
    if (!user?.sub) throw new ForbiddenException('Authentication required.');
    return this.seniorService.onboardSenior(user.sub, {
      fullName: dto.fullName,
      preferredName: dto.preferredName,
      dateOfBirth: dto.dateOfBirth,
      carePreferences: dto.carePreferences,
      circleName: dto.circleName,
    });
  }
}