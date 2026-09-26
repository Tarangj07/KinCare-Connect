import {
  Body, Controller, Get, Patch, Delete, ForbiddenException,
  NotFoundException, UseGuards, Req, Param, Query,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { NotificationService } from './services/notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  private getUserId(req: Request): string {
    const user = (req as Request & { user?: { sub?: string } }).user;
    const userId = user?.sub;
    if (!userId) throw new ForbiddenException('Authentication required.');
    return userId;
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('read') read?: string,
    @Query('kind') kind?: string,
    @Query('channel') channel?: string,
    @Query('seniorId') seniorId?: string,
  ) {
    const userId = this.getUserId(req);
    return this.notificationService.findForUser(userId, {
      read: read === 'true',
      kind,
      channel,
      seniorId,
    });
  }

  @Get(':notificationId')
  async getOne(
    @Param('notificationId') notificationId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    const notifications = await this.notificationService.findForUser(userId);
    const notification = notifications.find((n: { id: string }) => n.id === notificationId);
    if (!notification) throw new NotFoundException('Notification not found.');
    return notification;
  }

  @Patch(':notificationId/read')
  async markAsRead(
    @Param('notificationId') notificationId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.notificationService.markAsRead(userId, notificationId);
  }

  @Patch(':notificationId/unread')
  async markAsUnread(
    @Param('notificationId') notificationId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.notificationService.markAsUnread(userId, notificationId);
  }

  @Delete(':notificationId')
  async archive(
    @Param('notificationId') notificationId: string,
    @Req() req: Request,
  ) {
    const userId = this.getUserId(req);
    return this.notificationService.archive(userId, notificationId);
  }
}
