-- Phase 13 Emergency Alert Schema Migration (Safe Path)
-- Mapping rationale documented inline.

-- ============================================================================
-- 1. Create new enum types (must exist before any reference)
-- ============================================================================
CREATE TYPE "EmergencyAlertType" AS ENUM ('MEDICAL', 'FALL', 'SOS', 'MEDICATION', 'OTHER');
CREATE TYPE "EmergencyAlertSeverity_new" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM');
CREATE TYPE "EmergencyAlertStatus_new" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- ============================================================================
-- 2. DATA MIGRATION: Status enum value mapping (preserve historical meaning)
-- ============================================================================
-- Old values: DETECTED, ACKNOWLEDGED, ESCALATED, RESOLVED, FALSE_ALARM
-- New values: ACTIVE, ACKNOWLEDGED, RESOLVED, CANCELLED
--
-- Mapping:
--   DETECTED      -> ACTIVE   (alert was active, not yet acknowledged)
--   ACKNOWLEDGED  -> ACKNOWLEDGED (unchanged)
--   ESCALATED     -> ACTIVE   (escalated implies active/unresolved state; preserved as active)
--   RESOLVED      -> RESOLVED (unchanged)
--   FALSE_ALARM   -> CANCELLED (false alarm is a cancellation of concern)
-- ============================================================================
UPDATE "emergency_alerts"
SET "status" = CASE "status"::text
  WHEN 'DETECTED'     THEN 'ACTIVE'
  WHEN 'ACKNOWLEDGED' THEN 'ACKNOWLEDGED'
  WHEN 'ESCALATED'    THEN 'ACTIVE'
  WHEN 'RESOLVED'     THEN 'RESOLVED'
  WHEN 'FALSE_ALARM'  THEN 'CANCELLED'
  ELSE 'ACTIVE'
END;

-- ============================================================================
-- 3. DATA MIGRATION: Severity enum value mapping (preserve historical meaning)
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
UPDATE "emergency_alerts"
SET "severity" = CASE "severity"::text
  WHEN 'INFO'     THEN 'MEDIUM'
  WHEN 'LOW'      THEN 'MEDIUM'
  WHEN 'MEDIUM'   THEN 'MEDIUM'
  WHEN 'HIGH'     THEN 'HIGH'
  WHEN 'CRITICAL' THEN 'CRITICAL'
  ELSE 'MEDIUM'
END;

-- ============================================================================
-- 4. Alter severity column using mapped values
-- ============================================================================
ALTER TABLE "emergency_alerts" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "emergency_alerts" ALTER COLUMN "severity" TYPE "EmergencyAlertSeverity_new" USING ("severity"::text::"EmergencyAlertSeverity_new");
ALTER TYPE "EmergencyAlertSeverity" RENAME TO "EmergencyAlertSeverity_old";
ALTER TYPE "EmergencyAlertSeverity_new" RENAME TO "EmergencyAlertSeverity";
DROP TYPE "EmergencyAlertSeverity_old";
ALTER TABLE "emergency_alerts" ALTER COLUMN "severity" SET DEFAULT 'MEDIUM';

-- ============================================================================
-- 5. Alter status column using mapped values
-- ============================================================================
ALTER TABLE "emergency_alerts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "emergency_alerts" ALTER COLUMN "status" TYPE "EmergencyAlertStatus_new" USING ("status"::text::"EmergencyAlertStatus_new");
ALTER TYPE "EmergencyAlertStatus" RENAME TO "EmergencyAlertStatus_old";
ALTER TYPE "EmergencyAlertStatus_new" RENAME TO "EmergencyAlertStatus";
DROP TYPE "EmergencyAlertStatus_old";
ALTER TABLE "emergency_alerts" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- ============================================================================
-- 6. Drop obsolete columns and add new fields
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
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- ============================================================================
-- 7. Foreign keys for actor identity tracking
-- ============================================================================
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ==========================================================================
-- 8. Cancellation fields (missing from truncated migration — added per Phase 13 schema)
-- ==========================================================================
ALTER TABLE "emergency_alerts" ADD COLUMN "cancelled_by_user_id" UUID;
ALTER TABLE "emergency_alerts" ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
