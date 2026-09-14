import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

/**
 * Dose generation service.
 *
 * Idempotency: running this service for the same date range must not
 * create duplicate doses. The database enforces this via the
 * `@@unique([medicationId, scheduledAt])` constraint on `MedicationDose`.
 */
@Injectable()
export class DoseGenerationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate pending doses for all active schedules of a senior's
   * active medications for a given date range.
   */
  async generateDosesForSeniorRange(seniorId: string, from: Date, to: Date): Promise<{ created: number; skipped: number }> {
    const medications = await this.prisma.medication.findMany({
      where: { seniorId, isActive: true, deletedAt: null },
      include: { schedules: { where: { isActive: true } } },
    });
    let created = 0;
    let skipped = 0;

    for (const med of medications) {
      for (const sched of med.schedules) {
        // For each day in [from, to], generate one dose instance.
        const current = new Date(from);
        while (current <= to) {
          const scheduledAt = this.buildScheduledAt(current, sched.timeOfDay);
          const existing = await this.prisma.medicationDose.findUnique({
            where: { medicationId_scheduledAt: { medicationId: med.id, scheduledAt } },
          });
          if (!existing) {
            try {
              await this.prisma.medicationDose.create({
                data: {
                  seniorId,
                  medicationId: med.id,
                  scheduleId: sched.id,
                  scheduledAt,
                  status: 'PENDING',
                },
              });
              created++;
            } catch {
              // Unique constraint violation means the dose was created
              // between the find and the create (race); count as skipped.
              skipped++;
            }
          } else {
            skipped++;
          }
          current.setUTCDate(current.getUTCDate() + 1);
        }
      }
    }
    return { created, skipped };
  }

  private buildScheduledAt(date: Date, timeOfDay: Date): Date {
    const result = new Date(date.getTime());
    result.setUTCHours(timeOfDay.getUTCHours(), timeOfDay.getUTCMinutes(), 0, 0);
    return result;
  }
}
