import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(userId: string, kind: string, payload: Record<string, unknown>, seniorId?: string, channel = 'IN_APP') {
    return this.prisma.notification.create({
      data: {
        userId,
        kind,
        payload: payload as Prisma.InputJsonValue,
        seniorId: seniorId ?? null,
        channel: channel as NotificationChannel,
      },
    });
  }

  async findForUser(userId: string, filters?: { read?: boolean; kind?: string; channel?: string; seniorId?: string }) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        readAt: filters?.read === true ? { not: null } : filters?.read === false ? null : undefined,
        kind: filters?.kind ?? undefined,
        channel: filters?.channel ? (filters.channel as NotificationChannel) : undefined,
        seniorId: filters?.seniorId ?? undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }

  async markAsUnread(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: null } });
  }

  async archive(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
}
