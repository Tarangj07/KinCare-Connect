/**
 * Phase 49 — accessible-senior resolution (PR-48-02).
 *
 * `GET /api/v1/me/seniors` exists because a client cannot address a
 * senior-scoped URL without a senior id, and `/auth/me` returns only
 * `{ id, email, fullName, globalRole }`.
 *
 * This is deliberately a SEPARATE endpoint rather than a change to
 * `/auth/me`:
 *  - the auth contract is unchanged, so the existing mobile `getMe` and any
 *    web consumer keep working against the same four fields;
 *  - senior access is a resource-authorization concern (derived from
 *    care-circle membership), while `/auth/me` is an identity concern
 *    (derived from the `User` row), and mixing them would couple a
 *    membership change to the session payload;
 *  - it keeps the response independently cacheable and independently
 *    testable, and it avoids putting PHI-adjacent senior names into a
 *    payload every authenticated client already treats as "who am I".
 */
import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { SeniorService } from './services/senior.service';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('USER', 'SUPER_ADMIN')
export class MeController {
  constructor(private readonly seniorService: SeniorService) {}

  @Get('seniors')
  async accessibleSeniors(@Req() req: Request) {
    const user = (req as Request & { user?: { sub?: string } }).user;
    if (!user?.sub) throw new ForbiddenException('Authentication required.');
    return this.seniorService.findAccessibleSeniors(user.sub);
  }
}