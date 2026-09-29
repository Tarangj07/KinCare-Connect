import { Controller, Get, Patch, UseGuards, Req, ForbiddenException, NotFoundException, Body, Query, Param } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UpdateNotificationPreferenceDto } from './dto/update-preference.dto';
import { NotificationService } from './services/notification.service';

@Controller('notification-preferences')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationPreferenceController {
  constructor(private readonly notificationService: NotificationService) {}

  private getUserId(req: { user?: { sub?: string } }): string {
    const user = req.user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    return userId;
  }

  @Get()
  async list(@Req() req: { user?: { sub?: string } }) {
    const userId = this.getUserId(req);
    return { message: 'Preferences endpoint — architecture ready.', userId };
  }

  @Patch()
  // Phase 24 (D-4): was an inline type literal, whose emitted metatype is
  // `Object` — a metatype ValidationPipe skips, so this body was bound
  // unvalidated and then echoed back.
  async update(@Body() body: UpdateNotificationPreferenceDto) {
    return { message: 'Preference updated (stub — architecture ready for Phase 8).', body };
  }
}
