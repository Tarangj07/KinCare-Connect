-- Phase 13 Emergency Alert Schema Migration
-- Phase 16 fix: this migration failed on a fresh database with
-- E42804/P3009 because the status/severity value mapping ran as a
-- standalone UPDATE that assigned text to enum columns *before* the
-- target enum values existed (e.g. 'ACTIVE' is not a value of the old
-- EmergencyAlertStatus). `prisma migrate deploy` could never apply the
-- schema from scratch. The mapping now lives inside the USING clause of
-- each ALTER COLUMN TYPE, where the column still holds the old enum and
-- the expression can produce the new one. No application code or data
-- semantics changed.

-- ============================================================================
-- 1. Create new enum types (must exist before any reference)
-- ============================================================================
CREATE TYPE "EmergencyAlertType" AS ENUM ('MEDICAL', 'FALL', 'SOS', 'MEDICATION', 'OTHER');
CREATE TYPE "EmergencyAlertSeverity_new" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM');
CREATE TYPE "EmergencyAlertStatus_new" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- ============================================================================
-- 2. Severity conversion with value mapping (preserve historical meaning)
-- ============================================================================
-- Old values: INFO, LOW, MEDIUM, HIGH, CRITICAL
-- New values: CRITICAL, HIGH, MEDIUM
--
-- Mapping:
--   INFO     -> MEDIUM (lowest available preserved severity)
--   LOW      -> MEDIUM (lowest available preserved severity)
--   MEDIUM   -> MEDIUM (unchanged)
--   HIGH     -> HIGH (unchanged)
--   CRITICAL -> CRITICAL (unchanged)
-- ============================================================================
ALTER TABLE "emergency_alerts" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "emergency_alerts" ALTER COLUMN "severity" TYPE "EmergencyAlertSeverity_new" USING (
  CASE "severity"::text
    WHEN 'HIGH'     THEN 'HIGH'::"EmergencyAlertSeverity_new"
    WHEN 'CRITICAL' THEN 'CRITICAL'::"EmergencyAlertSeverity_new"
    ELSE 'MEDIUM'::"EmergencyAlertSeverity_new"
  END
);
ALTER TYPE "EmergencyAlertSeverity" RENAME TO "EmergencyAlertSeverity_old";
ALTER TYPE "EmergencyAlertSeverity_new" RENAME TO "EmergencyAlertSeverity";
DROP TYPE "EmergencyAlertSeverity_old";
ALTER TABLE "emergency_alerts" ALTER COLUMN "severity" SET DEFAULT 'MEDIUM';

-- ============================================================================
-- 3. Status conversion with value mapping (preserve historical meaning)
-- ============================================================================
-- Old values: DETECTED, ACKNOWLEDGED, ESCALATED, RESOLVED, FALSE_ALARM
-- New values: ACTIVE, ACKNOWLEDGED, RESOLVED, CANCELLED
--
-- Mapping:
--   DETECTED      -> ACTIVE   (alert was active, not yet acknowledged)
--   ACKNOWLEDGED  -> ACKNOWLEDGED (unchanged)
--   ESCALATED     -> ACTIVE   (escalated implies active/unresolved state)
--   RESOLVED      -> RESOLVED (unchanged)
--   FALSE_ALARM   -> CANCELLED (false alarm is a cancellation of concern)
-- ============================================================================
ALTER TABLE "emergency_alerts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "emergency_alerts" ALTER COLUMN "status" TYPE "EmergencyAlertStatus_new" USING (
  CASE "status"::text
    WHEN 'ACKNOWLEDGED' THEN 'ACKNOWLEDGED'::"EmergencyAlertStatus_new"
    WHEN 'RESOLVED'     THEN 'RESOLVED'::"EmergencyAlertStatus_new"
    WHEN 'FALSE_ALARM'  THEN 'CANCELLED'::"EmergencyAlertStatus_new"
    ELSE 'ACTIVE'::"EmergencyAlertStatus_new"
  END
);
ALTER TYPE "EmergencyAlertStatus" RENAME TO "EmergencyAlertStatus_old";
ALTER TYPE "EmergencyAlertStatus_new" RENAME TO "EmergencyAlertStatus";
DROP TYPE "EmergencyAlertStatus_old";
ALTER TABLE "emergency_alerts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- ============================================================================
-- 4. Drop obsolete columns and add new fields
-- ============================================================================
-- Columns removed: kind, context, escalated_at
-- Rationale: These fields are not part of the Phase 13 emergency alert model.
-- Data mapping completed above ensures no existing rows contain removed enum
-- values before type conversion. No archive table is created because no
-- historical data for deprecated fields requires preservation.
ALTER TABLE "emergency_alerts" DROP COLUMN "context",
DROP COLUMN "escalated_at",
DROP COLUMN "kind",
ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "resolved_by_user_id" UUID,
ADD COLUMN     "type" "EmergencyAlertType" NOT NULL DEFAULT 'MEDICAL',
ADD COLUMN     "cancelled_by_user_id" UUID,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6);

-- ============================================================================
-- 5. Foreign keys for actor identity tracking
-- ============================================================================
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
