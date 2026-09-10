/**
 * Demo seed data for the elderly care coordination platform.
 *
 * Goals:
 *  - Demonstrate relationships between users, seniors, care circles,
 *    medications, schedules, doses, appointments, tasks, measurements,
 *    notifications, and audit-relevant operations.
 *  - Be deterministic so tests and demos are reproducible.
 *  - Contain no real patient information. All names, addresses, phone
 *    numbers, and clinical values are synthetic.
 *  - Leave the database in a known state (idempotent upserts on the
 *    canonical accounts by email).
 *
 * Run with:  pnpm --filter @ecc/api prisma:seed
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ---------- helpers --------------------------------------------------------

/** Stable fixed seed so the output is reproducible across runs. */
function deterministicIdempotency(): Prisma.InputJsonValue {
  return { seededAt: '2026-09-04T00:00:00.000Z' };
}

/** A small, fixed RNG so timestamps and ids line up across runs. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xc0ffee);

// ---------- main -----------------------------------------------------------

async function main(): Promise<void> {
  console.warn('[seed] starting…');

  // Idempotency: find the demo senior (if it exists from a prior
  // run) and delete everything we own in dependency order. We
  // avoid filtering by name and instead use a known fixed email
  // to anchor user cleanup.
  const existingSenior = await prisma.seniorProfile.findFirst({
    where: { fullName: 'Meera Patel' },
  });
  const seniorId = existingSenior?.id;

  if (seniorId) {
    await prisma.message.deleteMany({ where: { seniorId } });
    await prisma.conversationParticipant.deleteMany({ where: { conversation: { seniorId } } });
    await prisma.conversation.deleteMany({ where: { seniorId } });
    await prisma.documentAccess.deleteMany({ where: { seniorId } });
    await prisma.healthDocument.deleteMany({ where: { seniorId } });
    await prisma.healthMeasurement.deleteMany({ where: { seniorId } });
    await prisma.notification.deleteMany({ where: { seniorId } });
    await prisma.appointmentParticipant.deleteMany({ where: { appointment: { seniorId } } });
    await prisma.reminder.deleteMany({ where: { seniorId } });
    await prisma.appointment.deleteMany({ where: { seniorId } });
    await prisma.careTaskAssignment.deleteMany({ where: { task: { seniorId } } });
    await prisma.careTask.deleteMany({ where: { seniorId } });
    await prisma.medicationDose.deleteMany({ where: { seniorId } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { seniorId } } });
    await prisma.medication.deleteMany({ where: { seniorId } });
    await prisma.emergencyAlert.deleteMany({ where: { seniorId } });
    await prisma.consent.deleteMany({ where: { seniorId } });
    await prisma.comment.deleteMany({ where: { update: { seniorId } } });
    await prisma.familyUpdate.deleteMany({ where: { seniorId } });
    await prisma.invitation.deleteMany({ where: { seniorId } });
    await prisma.careCircleMember.deleteMany({ where: { circle: { seniorId } } });
    await prisma.careCircle.deleteMany({ where: { seniorId } });
    await prisma.caregiverProfile.deleteMany({ where: { primarySeniorId: seniorId } });
    await prisma.emergencyContact.deleteMany({ where: { seniorId } });
    await prisma.seniorOrganizationMembership.deleteMany({ where: { seniorId } });
    // Unlink any user with seniorProfileId pointing at this senior.
    await prisma.user.updateMany({
      where: { seniorProfileId: seniorId },
      data: { seniorProfileId: null },
    });
    await prisma.seniorProfile.deleteMany({ where: { id: seniorId } });
  }

  // Wipe users and org by stable ids/emails.
  await prisma.organizationMembership.deleteMany({
    where: { user: { email: 'org-admin@example.com' } },
  });
  await prisma.organizationSubscription.deleteMany({ where: { organization: { slug: 'sunrise-care' } } });
  await prisma.organization.deleteMany({ where: { slug: 'sunrise-care' } });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'priya.patel@example.com',
          'arjun.patel@example.com',
          'aanya.kumar@example.com',
          'ravi.shah@example.com',
          'meera.patel@example.com',
          'org-admin@example.com',
        ],
      },
    },
  });

  // ---------- organization -------------------------------------------------

  const org = await prisma.organization.create({
    data: {
      name: 'Sunrise Care',
      slug: 'sunrise-care',
      contactEmail: 'contact@sunrise-care.example',
      contactPhone: '+1-555-0100',
    },
  });

  await prisma.organizationSubscription.create({
    data: {
      organizationId: org.id,
      plan: 'ORGANIZATION',
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    },
  });

  // ---------- users (no real secrets, no real hashes) ----------------------

  // passwordHash is required by the User model, so we use a
  // placeholder hash. Phase 3 wires up the real password flow; the
  // seed users are not expected to log in.
  const PLACEHOLDER_HASH = '$argon2id$v=19$m=65536,t=3,p=1$SEED$PLACEHOLDER';

  const familyAdmin = await prisma.user.create({
    data: {
      email: 'priya.patel@example.com',
      passwordHash: PLACEHOLDER_HASH,
      fullName: 'Priya Patel',
      preferredLocale: 'en',
      phone: '+1-555-0101',
      globalRole: 'USER',
    },
  });

  const familyMember = await prisma.user.create({
    data: {
      email: 'arjun.patel@example.com',
      passwordHash: PLACEHOLDER_HASH,
      fullName: 'Arjun Patel',
      preferredLocale: 'en',
      phone: '+1-555-0102',
      globalRole: 'USER',
    },
  });

  const caregiver = await prisma.user.create({
    data: {
      email: 'aanya.kumar@example.com',
      passwordHash: PLACEHOLDER_HASH,
      fullName: 'Aanya Kumar',
      preferredLocale: 'en',
      phone: '+1-555-0103',
      globalRole: 'USER',
    },
  });

  const doctor = await prisma.user.create({
    data: {
      email: 'ravi.shah@example.com',
      passwordHash: PLACEHOLDER_HASH,
      fullName: 'Dr. Ravi Shah',
      preferredLocale: 'en',
      phone: '+1-555-0104',
      globalRole: 'USER',
    },
  });

  // The senior who has their own login.
  const seniorUser = await prisma.user.create({
    data: {
      email: 'meera.patel@example.com',
      passwordHash: PLACEHOLDER_HASH,
      fullName: 'Meera Patel',
      preferredLocale: 'en',
      phone: '+1-555-0105',
      globalRole: 'USER',
    },
  });

  // A user with org-admin role, but not in any care circle.
  const orgAdmin = await prisma.user.create({
    data: {
      email: 'org-admin@example.com',
      passwordHash: PLACEHOLDER_HASH,
      fullName: 'Sunrise Care Admin',
      preferredLocale: 'en',
      globalRole: 'USER',
    },
  });

  await prisma.organizationMembership.create({
    data: { userId: orgAdmin.id, organizationId: org.id, role: 'ORG_ADMIN' },
  });

  // ---------- senior profile ----------------------------------------------

  // Senior who logs in: `seniorProfileId` is set after SeniorProfile
  // is created (we can't pass it in a single create because Prisma
  // doesn't allow it for unrelated models).
  const senior = await prisma.seniorProfile.create({
    data: {
      fullName: 'Meera Patel',
      preferredName: 'Meera',
      dateOfBirth: new Date('1948-04-12T00:00:00Z'),
      carePreferences: 'Prefers morning visits. Vegetarian meals only.',
      addressLine1: '12 Linden Avenue',
      city: 'Cambridge',
      region: 'MA',
      postalCode: '02139',
      country: 'US',
      generalNotes: 'Lives alone. Daughter Priya visits on weekends.',
    },
  });

  await prisma.user.update({
    where: { id: seniorUser.id },
    data: { seniorProfileId: senior.id },
  });

  await prisma.seniorOrganizationMembership.create({
    data: { seniorId: senior.id, organizationId: org.id },
  });

  // ---------- emergency contacts ------------------------------------------

  await prisma.emergencyContact.createMany({
    data: [
      { seniorId: senior.id, fullName: 'Priya Patel', relationship: 'Daughter', phone: '+1-555-0101', priority: 1 },
      { seniorId: senior.id, fullName: 'Arjun Patel', relationship: 'Son', phone: '+1-555-0102', priority: 2 },
      { seniorId: senior.id, fullName: 'Sunrise Care 24/7', relationship: 'Provider', phone: '+1-555-0199', priority: 3 },
    ],
  });

  // ---------- caregiver profile -------------------------------------------

  const caregiverProfile = await prisma.caregiverProfile.create({
    data: {
      userId: caregiver.id,
      primarySeniorId: senior.id,
      qualifications: 'Certified Home Health Aide, 5 years experience.',
    },
  });

  // ---------- care circle + members ---------------------------------------

  const circle = await prisma.careCircle.create({
    data: {
      seniorId: senior.id,
      name: 'Inner Family',
      description: 'Family and primary caregivers for Meera.',
      createdById: familyAdmin.id,
    },
  });

  await prisma.careCircleMember.createMany({
    data: [
      { circleId: circle.id, userId: familyAdmin.id, role: 'FAMILY_ADMIN', displayName: 'Priya (daughter)' },
      { circleId: circle.id, userId: familyMember.id, role: 'FAMILY_MEMBER', displayName: 'Arjun (son)' },
      { circleId: circle.id, userId: caregiver.id, role: 'CAREGIVER', displayName: 'Aanya (home aide)' },
      { circleId: circle.id, userId: doctor.id, role: 'DOCTOR', displayName: 'Dr. Shah (GP)' },
      { circleId: circle.id, seniorId: senior.id, role: 'OBSERVER', displayName: 'Meera (self)' },
    ],
  });

  // ---------- medications + schedules + doses -----------------------------

  const metformin = await prisma.medication.create({
    data: {
      seniorId: senior.id,
      name: 'Metformin',
      dosage: '500 mg',
      form: 'tablet',
      instructions: 'Take with meals.',
      prescribedByName: 'Dr. R. Shah',
      pharmacyName: 'Cambridge Pharmacy',
      pharmacyPhone: '+1-555-0150',
      startDate: new Date('2026-01-15T00:00:00Z'),
    },
  });

  const lisinopril = await prisma.medication.create({
    data: {
      seniorId: senior.id,
      name: 'Lisinopril',
      dosage: '10 mg',
      form: 'tablet',
      instructions: 'Take in the morning.',
      prescribedByName: 'Dr. R. Shah',
      startDate: new Date('2026-03-02T00:00:00Z'),
    },
  });

  const metforminSchedules = await Promise.all([
    prisma.medicationSchedule.create({
      data: {
        medicationId: metformin.id,
        timeOfDay: new Date('1970-01-01T08:00:00Z'),
        quantity: 1,
        unit: 'tablet',
      },
    }),
    prisma.medicationSchedule.create({
      data: {
        medicationId: metformin.id,
        timeOfDay: new Date('1970-01-01T20:00:00Z'),
        quantity: 1,
        unit: 'tablet',
      },
    }),
  ]);

  const lisinoprilSchedule = await prisma.medicationSchedule.create({
    data: {
      medicationId: lisinopril.id,
      timeOfDay: new Date('1970-01-01T09:00:00Z'),
      quantity: 1,
      unit: 'tablet',
    },
  });

  // Pre-populate a few days of dose instances. Use UTC time matching
  // the schedule time-of-day for the scheduledAt timestamp.
  const today = new Date('2026-09-04T00:00:00Z');
  const doseDays = 3;
  for (let dayOffset = -1; dayOffset <= doseDays; dayOffset += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() + dayOffset);

    for (const sched of metforminSchedules) {
      const tod = sched.timeOfDay;
      const scheduledAt = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), tod.getUTCHours(), tod.getUTCMinutes()),
      );
      // Past doses are TAKEN; today and future are PENDING.
      const isPast = scheduledAt < new Date('2026-09-04T12:00:00Z');
      await prisma.medicationDose.create({
        data: {
          seniorId: senior.id,
          medicationId: metformin.id,
          scheduleId: sched.id,
          scheduledAt,
          status: isPast ? 'TAKEN' : 'PENDING',
          recordedAt: isPast ? scheduledAt : null,
          recordedByUserId: isPast ? caregiver.id : null,
        },
      });
    }

    const tod = lisinoprilSchedule.timeOfDay;
    const scheduledAt = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), tod.getUTCHours(), tod.getUTCMinutes()),
    );
    const isPast = scheduledAt < new Date('2026-09-04T12:00:00Z');
    await prisma.medicationDose.create({
      data: {
        seniorId: senior.id,
        medicationId: lisinopril.id,
        scheduleId: lisinoprilSchedule.id,
        scheduledAt,
        status: isPast ? 'TAKEN' : 'PENDING',
        recordedAt: isPast ? scheduledAt : null,
        recordedByUserId: isPast ? caregiver.id : null,
      },
    });
  }

  // ---------- appointments + reminders ------------------------------------

  const appt1 = await prisma.appointment.create({
    data: {
      seniorId: senior.id,
      title: 'GP follow-up',
      providerName: 'Dr. R. Shah',
      location: 'Cambridge Family Practice, Room 3',
      isTelehealth: false,
      startsAt: new Date('2026-09-09T15:30:00Z'),
      endsAt: new Date('2026-09-09T16:00:00Z'),
      status: 'SCHEDULED',
      notes: 'Bring blood pressure log.',
    },
  });

  const appt2 = await prisma.appointment.create({
    data: {
      seniorId: senior.id,
      title: 'Telehealth — endocrinology',
      providerName: 'Dr. M. Iyer',
      location: 'Zoom link in calendar invite',
      isTelehealth: true,
      startsAt: new Date('2026-09-22T17:00:00Z'),
      endsAt: new Date('2026-09-22T17:30:00Z'),
      status: 'SCHEDULED',
    },
  });

  await prisma.appointmentParticipant.createMany({
    data: [
      { appointmentId: appt1.id, userId: doctor.id, role: 'doctor' },
      { appointmentId: appt1.id, userId: familyAdmin.id, role: 'driver' },
      { appointmentId: appt2.id, userId: doctor.id, role: 'doctor' },
    ],
  });

  await prisma.reminder.createMany({
    data: [
      { seniorId: senior.id, appointmentId: appt1.id, offsetMinutes: -1440, channel: 'IN_APP' },
      { seniorId: senior.id, appointmentId: appt1.id, offsetMinutes: -120, channel: 'PUSH' },
      { seniorId: senior.id, appointmentId: appt2.id, offsetMinutes: -30, channel: 'IN_APP' },
    ],
  });

  // ---------- care tasks --------------------------------------------------

  const taskBp = await prisma.careTask.create({
    data: {
      seniorId: senior.id,
      title: 'Check blood pressure',
      description: 'Use home monitor. Log the reading.',
      priority: 'MEDIUM',
      status: 'PENDING',
      dueAt: new Date('2026-09-04T22:00:00Z'),
      recurrenceFrequency: 'DAILY',
    },
  });
  await prisma.careTaskAssignment.create({
    data: { taskId: taskBp.id, userId: caregiver.id, role: 'primary' },
  });

  const taskWalk = await prisma.careTask.create({
    data: {
      seniorId: senior.id,
      title: '15-minute walk',
      description: 'Around the block if weather permits.',
      priority: 'LOW',
      status: 'COMPLETED',
      dueAt: new Date('2026-09-04T13:00:00Z'),
      completedAt: new Date('2026-09-04T13:20:00Z'),
    },
  });
  await prisma.careTaskAssignment.create({
    data: { taskId: taskWalk.id, userId: caregiver.id, role: 'primary' },
  });

  const taskCall = await prisma.careTask.create({
    data: {
      seniorId: senior.id,
      title: 'Daily check-in call',
      priority: 'MEDIUM',
      status: 'PENDING',
      dueAt: new Date('2026-09-05T11:00:00Z'),
      recurrenceFrequency: 'DAILY',
    },
  });
  await prisma.careTaskAssignment.create({
    data: { taskId: taskCall.id, userId: familyAdmin.id, role: 'primary' },
  });

  // ---------- health measurement types + measurements ---------------------

  // Idempotent type inserts.
  const typeBp = await prisma.healthMeasurementType.upsert({
    where: { key: 'blood_pressure' },
    update: {},
    create: {
      key: 'blood_pressure',
      displayName: 'Blood pressure',
      defaultUnit: 'mmHg',
      schema: { kind: 'compound', components: ['systolic', 'diastolic'] },
    },
  });
  const typeHr = await prisma.healthMeasurementType.upsert({
    where: { key: 'heart_rate' },
    update: {},
    create: { key: 'heart_rate', displayName: 'Heart rate', defaultUnit: 'bpm', schema: { kind: 'scalar' } },
  });
  const typeGlucose = await prisma.healthMeasurementType.upsert({
    where: { key: 'glucose' },
    update: {},
    create: { key: 'glucose', displayName: 'Glucose', defaultUnit: 'mg/dL', schema: { kind: 'scalar' } },
  });
  const typeWeight = await prisma.healthMeasurementType.upsert({
    where: { key: 'weight' },
    update: {},
    create: { key: 'weight', displayName: 'Weight', defaultUnit: 'kg', schema: { kind: 'scalar' } },
  });
  const typeSpo2 = await prisma.healthMeasurementType.upsert({
    where: { key: 'spo2' },
    update: {},
    create: { key: 'spo2', displayName: 'Blood oxygen', defaultUnit: '%', schema: { kind: 'scalar' } },
  });

  // Measurements over the past 5 days.
  const baseDate = new Date('2026-09-04T07:00:00Z');
  for (let i = 5; i >= 1; i -= 1) {
    const measuredAt = new Date(baseDate);
    measuredAt.setUTCDate(measuredAt.getUTCDate() - i);
    const sys = 115 + Math.floor(rand() * 12);
    const dia = 72 + Math.floor(rand() * 8);
    await prisma.healthMeasurement.create({
      data: {
        seniorId: senior.id,
        typeId: typeBp.id,
        measuredAt,
        source: 'MANUAL',
        recordedByUserId: caregiver.id,
        value: { kind: 'compound', components: { systolic: sys, diastolic: dia, unit: 'mmHg' } },
      },
    });
    await prisma.healthMeasurement.create({
      data: {
        seniorId: senior.id,
        typeId: typeHr.id,
        measuredAt,
        source: 'MANUAL',
        recordedByUserId: caregiver.id,
        value: { kind: 'scalar', value: 68 + Math.floor(rand() * 12), unit: 'bpm' },
      },
    });
    await prisma.healthMeasurement.create({
      data: {
        seniorId: senior.id,
        typeId: typeGlucose.id,
        measuredAt,
        source: 'MANUAL',
        recordedByUserId: caregiver.id,
        value: { kind: 'scalar', value: 95 + Math.floor(rand() * 30), unit: 'mg/dL' },
      },
    });
    await prisma.healthMeasurement.create({
      data: {
        seniorId: senior.id,
        typeId: typeSpo2.id,
        measuredAt,
        source: 'MANUAL',
        recordedByUserId: caregiver.id,
        value: { kind: 'scalar', value: 95 + Math.floor(rand() * 4), unit: '%' },
      },
    });
  }
  await prisma.healthMeasurement.create({
    data: {
      seniorId: senior.id,
      typeId: typeWeight.id,
      measuredAt: new Date('2026-09-01T07:30:00Z'),
      source: 'MANUAL',
      recordedByUserId: caregiver.id,
      value: { kind: 'scalar', value: 62.4, unit: 'kg' },
    },
  });

  // ---------- family feed -------------------------------------------------

  const update1 = await prisma.familyUpdate.create({
    data: {
      seniorId: senior.id,
      authorUserId: caregiver.id,
      body: 'Morning check-in complete. Blood pressure 122/78.',
      kind: 'measurement_recorded',
      visibility: 'CIRCLE',
    },
  });
  await prisma.comment.create({
    data: { updateId: update1.id, authorUserId: familyAdmin.id, body: 'Thanks, Aanya. Looks good.' },
  });

  await prisma.familyUpdate.create({
    data: {
      seniorId: senior.id,
      authorUserId: familyAdmin.id,
      body: "GP appointment booked for next Tuesday. I'll drive.",
      kind: 'appointment_scheduled',
      visibility: 'CIRCLE',
      relatedEntityType: 'appointment',
      relatedEntityId: appt1.id,
    },
  });

  // ---------- notifications -----------------------------------------------

  await prisma.notification.createMany({
    data: [
      {
        userId: caregiver.id,
        seniorId: senior.id,
        kind: 'care_task.due',
        channel: 'IN_APP',
        payload: { taskId: taskBp.id, dueAt: '2026-09-04T22:00:00Z' },
      },
      {
        userId: familyAdmin.id,
        seniorId: senior.id,
        kind: 'medication.due',
        channel: 'PUSH',
        payload: { medicationId: metformin.id, scheduledAt: '2026-09-04T20:00:00Z' },
      },
      {
        userId: familyAdmin.id,
        seniorId: senior.id,
        kind: 'appointment.upcoming',
        channel: 'EMAIL',
        payload: { appointmentId: appt1.id, startsAt: '2026-09-09T15:30:00Z' },
      },
    ],
  });

  // ---------- consent -----------------------------------------------------

  await prisma.consent.create({
    data: {
      seniorId: senior.id,
      granterUserId: seniorUser.id,
      scope: 'share_with_care_circle',
      details: { circleId: circle.id },
      grantedAt: new Date('2026-01-10T00:00:00Z'),
    },
  });

  // ---------- audit log (one synthetic entry) -----------------------------

  await prisma.auditLog.create({
    data: {
      actorUserId: familyAdmin.id,
      actorType: 'USER',
      seniorId: senior.id,
      action: 'circle.member.added',
      resourceType: 'care_circle_member',
      resourceId: caregiver.id,
      metadata: { circleId: circle.id, role: 'CAREGIVER' },
      requestId: 'seed-bootstrap',
    },
  });

  console.warn('[seed] done. Demo accounts:');
  console.warn('  priya.patel@example.com (FAMILY_ADMIN)');
  console.warn('  arjun.patel@example.com (FAMILY_MEMBER)');
  console.warn('  aanya.kumar@example.com (CAREGIVER)');
  console.warn('  ravi.shah@example.com     (DOCTOR)');
  console.warn('  meera.patel@example.com   (senior with own login)');
  console.warn('  org-admin@example.com     (Sunrise Care ORG_ADMIN)');
  console.warn('[seed] idempotency:', deterministicIdempotency());
  // mark as used to satisfy noUnusedLocals
  void caregiverProfile;
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
