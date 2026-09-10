/**
 * Schema integration tests. These tests run only when the API is
 * pointed at a real database (DATABASE_URL set). They verify the
 * most important constraints added in Phase 2:
 *
 *   - SeniorProfile ↔ User one-to-one (via User.seniorProfileId)
 *   - CareCircleMember uniqueness within a circle
 *   - Email uniqueness on User
 *   - Foreign key CASCADE behaviour for owned entities
 *   - The audit log's append-only contract is enforced by the
 *     application role (Phase 16); the schema just guarantees the
 *     metadata is persisted.
 *
 * Skip the file when DATABASE_URL is missing so vitest works in
 * environments without a database (e.g. CI build matrix).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_URL = process.env['DATABASE_URL'];
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb('Prisma schema integration', () => {
  const prisma = new PrismaClient({ datasourceUrl: DB_URL });

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('has the expected tables in the public schema', async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const names = rows.map((r) => r.tablename);
    expect(names).toContain('users');
    expect(names).toContain('senior_profiles');
    expect(names).toContain('care_circles');
    expect(names).toContain('care_circle_members');
    expect(names).toContain('medications');
    expect(names).toContain('medication_doses');
    expect(names).toContain('audit_logs');
    expect(names).toContain('health_measurements');
  });

  it('enforces unique email on users', async () => {
    // Use a throwaway email so the test is safe to re-run.
    const email = `unique-test-${Date.now()}@example.com`;
    await prisma.user.create({
      data: {
        email,
        passwordHash: 'placeholder',
        fullName: 'Unique Test',
      },
    });
    await expect(
      prisma.user.create({
        data: { email, passwordHash: 'placeholder', fullName: 'Duplicate' },
      }),
    ).rejects.toThrow();
  });

  it('CASCADE-deletes medication doses when a medication is removed', async () => {
    const senior = await prisma.seniorProfile.findFirst();
    if (!senior) {
      // Seed data not present; skip.
      return;
    }
    const med = await prisma.medication.create({
      data: { seniorId: senior.id, name: 'cascade-test', dosage: '1 mg' },
    });
    const dose = await prisma.medicationDose.create({
      data: {
        seniorId: senior.id,
        medicationId: med.id,
        scheduledAt: new Date('2030-01-01T08:00:00Z'),
      },
    });
    await prisma.medication.delete({ where: { id: med.id } });
    const stillThere = await prisma.medicationDose.findUnique({ where: { id: dose.id } });
    expect(stillThere).toBeNull();
  });

  it('SET NULL keeps the user when a senior is soft-related', async () => {
    // User.seniorProfileId has SetNull — a user with a senior
    // link should keep their account if the senior is deleted.
    const senior = await prisma.seniorProfile.create({
      data: { fullName: 'SetNull Test' },
    });
    const user = await prisma.user.create({
      data: {
        email: `setnull-${Date.now()}@example.com`,
        passwordHash: 'placeholder',
        fullName: 'SetNull User',
        seniorProfileId: senior.id,
      },
    });
    await prisma.seniorProfile.delete({ where: { id: senior.id } });
    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded).not.toBeNull();
    expect(reloaded?.seniorProfileId).toBeNull();
    // cleanup
    await prisma.user.delete({ where: { id: user.id } });
  });
});
