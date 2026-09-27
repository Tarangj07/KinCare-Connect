/**
 * Shared care-circle fixtures for real-database integration tests.
 *
 * Builds an isolated, uniquely-named senior/care-circle graph per suite
 * (collision-free emails/circle names) covering the membership edge cases
 * Phase 16 secured: ACTIVE, PENDING, ENDED, expired-`endsAt`, a
 * soft-deleted circle, and a soft-deleted senior. Tokens are signed with
 * the same resolver the running app uses, so integration requests carry
 * genuine HS256 credentials.
 *
 * Data-only helper: creates and deletes rows, never alters behaviour.
 */
import { JwtService } from '@nestjs/jwt';
import { type CircleRole, PrismaClient } from '@prisma/client';

import { resolveJwtAccessSecret } from '../../src/config/security-config';

export type MemberSpec = {
  key: string;
  role: CircleRole;
  status?: 'ACTIVE' | 'PENDING' | 'ENDED';
  endsAtPast?: boolean;
};

export interface CareFixture {
  prisma: PrismaClient;
  seniorA: string;
  seniorB: string;
  deletedSenior: string;
  circleA: string;
  circleB: string;
  deletedCircle: string;
  seniorUserA: string;
  measurementTypeKey: string;
  membersA: Record<string, string>;
  membersB: Record<string, string>;
  deletedCircleMembers: Record<string, string>;
  emails: Record<string, string>;
  /** HS256 access token mirroring the auth service's payload shape. */
  tokenFor(userId: string): string;
  /** Token for users created outside the fixture (explicit email). */
  signAs(userId: string, email: string): string;
  cleanup(): Promise<void>;
}

export async function buildCareFixture(memberSpecs: {
  a: MemberSpec[];
  b: MemberSpec[];
}): Promise<CareFixture> {
  const prisma = new PrismaClient({ datasourceUrl: process.env['DATABASE_URL'] });
  await prisma.$connect();

  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  const jwt = new JwtService({
    secret: resolveJwtAccessSecret(),
    signOptions: { expiresIn: '15m' },
  });

  const createdUserIds: string[] = [];
  const emails = new Map<string, string>();
  const mkUser = async (label: string): Promise<string> => {
    const email = `p17-${label}-${runId}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'fixture-unusable',
        fullName: `P17 ${label}`,
        globalRole: 'USER',
      },
    });
    createdUserIds.push(user.id);
    emails.set(user.id, email);
    return user.id;
  };

  const creatorA = await mkUser('ca');
  const creatorB = await mkUser('cb');

  const seniorA = await prisma.seniorProfile.create({
    data: { fullName: `P17 Senior A ${runId}` },
  });
  const seniorB = await prisma.seniorProfile.create({
    data: { fullName: `P17 Senior B ${runId}` },
  });
  const deletedSenior = await prisma.seniorProfile.create({
    data: { fullName: `P17 Deleted Senior ${runId}`, deletedAt: new Date() },
  });

  const circleA = await prisma.careCircle.create({
    data: { seniorId: seniorA.id, name: `c-a-${runId}`, createdById: creatorA },
  });
  const circleB = await prisma.careCircle.create({
    data: { seniorId: seniorB.id, name: `c-b-${runId}`, createdById: creatorB },
  });
  const deletedCircle = await prisma.careCircle.create({
    data: {
      seniorId: seniorA.id,
      name: `c-del-${runId}`,
      createdById: creatorA,
      deletedAt: new Date(),
    },
  });

  const membersA: Record<string, string> = { creator: creatorA };
  const membersB: Record<string, string> = { creator: creatorB };
  const deletedCircleMembers: Record<string, string> = {};

  const addMember = async (
    spec: MemberSpec,
    circleId: string,
    tag: string,
    bucket: Record<string, string>,
  ) => {
    const userId = await mkUser(`${tag}-${spec.key}`);
    await prisma.careCircleMember.create({
      data: {
        circleId,
        userId,
        role: spec.role,
        status: spec.status ?? 'ACTIVE',
        endsAt: spec.endsAtPast ? new Date(Date.now() - 86_400_000) : null,
      },
    });
    bucket[spec.key] = userId;
  };

  for (const spec of memberSpecs.a) await addMember(spec, circleA.id, 'a', membersA);
  for (const spec of memberSpecs.b) await addMember(spec, circleB.id, 'b', membersB);
  await addMember(
    { key: 'member', role: 'FAMILY_MEMBER' },
    deletedCircle.id,
    'ad',
    deletedCircleMembers,
  );

  // Senior A's own login identity (used by emergency fan-out recipient rule).
  const seniorUserA = await mkUser('sa');
  await prisma.user.update({ where: { id: seniorUserA }, data: { seniorProfileId: seniorA.id } });

  const measurementType = await prisma.healthMeasurementType.create({
    data: { key: `p17-hr-${runId}`, displayName: 'P17 Heart Rate', schema: { kind: 'scalar' } },
  });

  const emailMap = Object.fromEntries(emails);

  return {
    prisma,
    seniorA: seniorA.id,
    seniorB: seniorB.id,
    deletedSenior: deletedSenior.id,
    circleA: circleA.id,
    circleB: circleB.id,
    deletedCircle: deletedCircle.id,
    seniorUserA,
    measurementTypeKey: measurementType.key,
    membersA,
    membersB,
    deletedCircleMembers,
    emails: emailMap,
    tokenFor: (userId: string) => jwt.sign({ sub: userId, email: emailMap[userId], role: 'USER' }),
    signAs: (userId: string, email: string) => jwt.sign({ sub: userId, email, role: 'USER' }),
    async cleanup() {
      const seniorIds = [seniorA.id, seniorB.id, deletedSenior.id];
      // Order matters: delete referencing rows before the rows they point
      // at. Senior cascade deletes most resources, but grantee/actor FKs
      // (users) and cross-links (documentAccess, doses) are torn down
      // explicitly for robustness.
      await prisma.documentAccess.deleteMany({ where: { seniorId: { in: seniorIds } } });
      await prisma.healthDocument.deleteMany({ where: { seniorId: { in: seniorIds } } });
      await prisma.medicationDose.deleteMany({ where: { seniorId: { in: seniorIds } } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.comment.deleteMany({ where: { authorUserId: { in: createdUserIds } } });
      await prisma.familyUpdate.deleteMany({ where: { authorUserId: { in: createdUserIds } } });
      await prisma.healthMeasurement.deleteMany({ where: { seniorId: { in: seniorIds } } });
      await prisma.healthMeasurementType.deleteMany({ where: { id: measurementType.id } });
      await prisma.careCircle.deleteMany({ where: { seniorId: { in: seniorIds } } });
      await prisma.seniorProfile.deleteMany({ where: { id: { in: seniorIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.$disconnect();
    },
  };
}
