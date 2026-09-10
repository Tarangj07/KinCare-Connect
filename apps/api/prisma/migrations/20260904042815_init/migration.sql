-- Enable the pgcrypto extension so `gen_random_uuid()` is available.
-- This is required by every model that uses @default(dbgenerated("gen_random_uuid()")).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "CircleRole" AS ENUM ('FAMILY_ADMIN', 'FAMILY_MEMBER', 'CAREGIVER', 'DOCTOR', 'OBSERVER');

-- CreateEnum
CREATE TYPE "CircleMemberStatus" AS ENUM ('ACTIVE', 'PENDING', 'ENDED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('ORG_ADMIN', 'ORG_MEMBER');

-- CreateEnum
CREATE TYPE "DoseStatus" AS ENUM ('PENDING', 'TAKEN', 'SKIPPED', 'MISSED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CareTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "CareTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('CIRCLE', 'ORGANIZATION', 'PRIVATE');

-- CreateEnum
CREATE TYPE "EmergencyAlertStatus" AS ENUM ('DETECTED', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "EmergencyAlertSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'OPERATOR', 'SYSTEM', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREEMIUM', 'FAMILY_PREMIUM', 'ORGANIZATION', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('MANUAL', 'DEVICE', 'IMPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT NOT NULL,
    "senior_profile_id" UUID,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "global_role" "GlobalRole" NOT NULL DEFAULT 'USER',
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "full_name" TEXT NOT NULL,
    "preferred_locale" TEXT NOT NULL DEFAULT 'en',
    "phone" TEXT,
    "profile_photo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'ORG_MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senior_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "date_of_birth" DATE,
    "care_preferences" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country" CHAR(2),
    "general_notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "senior_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senior_organization_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "senior_organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_circles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "care_circles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_circle_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "circle_id" UUID NOT NULL,
    "user_id" UUID,
    "senior_id" UUID,
    "role" "CircleRole" NOT NULL,
    "status" "CircleMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT,
    "notes" TEXT,
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "care_circle_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "primary_senior_id" UUID,
    "employer_organization_id" UUID,
    "qualifications" TEXT,
    "background_check_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "caregiver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "relationship" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "form" TEXT,
    "instructions" TEXT,
    "prescribed_by_name" TEXT,
    "pharmacy_name" TEXT,
    "pharmacy_phone" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "medication_id" UUID NOT NULL,
    "time_of_day" TIME(6) NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" TEXT,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_doses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "medication_id" UUID NOT NULL,
    "schedule_id" UUID,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6),
    "status" "DoseStatus" NOT NULL DEFAULT 'PENDING',
    "recorded_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medication_doses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "provider_name" TEXT,
    "location" TEXT,
    "is_telehealth" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "user_id" UUID,
    "external_name" TEXT,
    "role" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointment_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "appointment_id" UUID,
    "offset_minutes" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "CareTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CareTaskStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "recurrence_frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'NONE',
    "recurrence_rule" TEXT,
    "recurrence_ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "care_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_task_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "care_task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_measurement_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "default_unit" TEXT,
    "schema" JSONB NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "health_measurement_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "device_id" UUID,
    "value" JSONB NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "source" "MeasurementSource" NOT NULL DEFAULT 'MANUAL',
    "recorded_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "health_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT,
    "display_name" TEXT NOT NULL,
    "metadata" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "health_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "description" TEXT,
    "scan_status" TEXT NOT NULL DEFAULT 'pending',
    "scan_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "health_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_accesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "senior_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "granted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "PostVisibility" NOT NULL DEFAULT 'CIRCLE',
    "kind" TEXT,
    "related_entity_type" TEXT,
    "related_entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "family_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "update_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "title" TEXT,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(6),
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "senior_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "reply_to_id" UUID,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "senior_id" UUID,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "EmergencyAlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "EmergencyAlertStatus" NOT NULL DEFAULT 'DETECTED',
    "message" TEXT,
    "source" TEXT NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by_user_id" UUID,
    "escalated_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution" TEXT,
    "external_id" TEXT,
    "context" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "emergency_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'USER',
    "senior_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "request_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "granter_user_id" UUID,
    "scope" TEXT NOT NULL,
    "details" JSONB,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "senior_id" UUID NOT NULL,
    "organization_id" UUID,
    "issued_by_user_id" UUID NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "role" "CircleRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "accepted_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "external_customer_id" TEXT,
    "external_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "external_customer_id" TEXT,
    "external_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_senior_profile_id_key" ON "users"("senior_profile_id");

-- CreateIndex
CREATE INDEX "users_global_role_idx" ON "users"("global_role");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_deleted_at_idx" ON "organizations"("deleted_at");

-- CreateIndex
CREATE INDEX "organization_memberships_organization_id_idx" ON "organization_memberships"("organization_id");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_user_id_organization_id_key" ON "organization_memberships"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "senior_profiles_deleted_at_idx" ON "senior_profiles"("deleted_at");

-- CreateIndex
CREATE INDEX "senior_profiles_full_name_idx" ON "senior_profiles"("full_name");

-- CreateIndex
CREATE INDEX "senior_organization_memberships_organization_id_ends_at_idx" ON "senior_organization_memberships"("organization_id", "ends_at");

-- CreateIndex
CREATE INDEX "senior_organization_memberships_senior_id_idx" ON "senior_organization_memberships"("senior_id");

-- CreateIndex
CREATE UNIQUE INDEX "senior_organization_memberships_senior_id_organization_id_key" ON "senior_organization_memberships"("senior_id", "organization_id");

-- CreateIndex
CREATE INDEX "care_circles_senior_id_idx" ON "care_circles"("senior_id");

-- CreateIndex
CREATE INDEX "care_circles_deleted_at_idx" ON "care_circles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "care_circles_senior_id_name_key" ON "care_circles"("senior_id", "name");

-- CreateIndex
CREATE INDEX "care_circle_members_user_id_status_idx" ON "care_circle_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "care_circle_members_senior_id_status_idx" ON "care_circle_members"("senior_id", "status");

-- CreateIndex
CREATE INDEX "care_circle_members_circle_id_role_idx" ON "care_circle_members"("circle_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "care_circle_members_circle_id_user_id_key" ON "care_circle_members"("circle_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "care_circle_members_circle_id_senior_id_key" ON "care_circle_members"("circle_id", "senior_id");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_profiles_user_id_key" ON "caregiver_profiles"("user_id");

-- CreateIndex
CREATE INDEX "caregiver_profiles_primary_senior_id_idx" ON "caregiver_profiles"("primary_senior_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_senior_id_priority_idx" ON "emergency_contacts"("senior_id", "priority");

-- CreateIndex
CREATE INDEX "medications_senior_id_is_active_idx" ON "medications"("senior_id", "is_active");

-- CreateIndex
CREATE INDEX "medications_senior_id_deleted_at_idx" ON "medications"("senior_id", "deleted_at");

-- CreateIndex
CREATE INDEX "medication_schedules_medication_id_idx" ON "medication_schedules"("medication_id");

-- CreateIndex
CREATE INDEX "medication_doses_senior_id_scheduled_at_idx" ON "medication_doses"("senior_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "medication_doses_senior_id_status_idx" ON "medication_doses"("senior_id", "status");

-- CreateIndex
CREATE INDEX "medication_doses_status_scheduled_at_idx" ON "medication_doses"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "medication_doses_medication_id_scheduled_at_key" ON "medication_doses"("medication_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_senior_id_starts_at_idx" ON "appointments"("senior_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_senior_id_status_idx" ON "appointments"("senior_id", "status");

-- CreateIndex
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");

-- CreateIndex
CREATE INDEX "appointment_participants_user_id_idx" ON "appointment_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_participants_appointment_id_user_id_key" ON "appointment_participants"("appointment_id", "user_id");

-- CreateIndex
CREATE INDEX "reminders_senior_id_appointment_id_idx" ON "reminders"("senior_id", "appointment_id");

-- CreateIndex
CREATE INDEX "reminders_delivered_at_idx" ON "reminders"("delivered_at");

-- CreateIndex
CREATE INDEX "care_tasks_senior_id_due_at_idx" ON "care_tasks"("senior_id", "due_at");

-- CreateIndex
CREATE INDEX "care_tasks_senior_id_status_idx" ON "care_tasks"("senior_id", "status");

-- CreateIndex
CREATE INDEX "care_tasks_status_due_at_idx" ON "care_tasks"("status", "due_at");

-- CreateIndex
CREATE INDEX "care_task_assignments_user_id_idx" ON "care_task_assignments"("user_id");

-- CreateIndex
CREATE INDEX "care_task_assignments_ends_at_idx" ON "care_task_assignments"("ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "care_task_assignments_task_id_user_id_key" ON "care_task_assignments"("task_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_measurement_types_key_key" ON "health_measurement_types"("key");

-- CreateIndex
CREATE INDEX "health_measurements_senior_id_type_id_measured_at_idx" ON "health_measurements"("senior_id", "type_id", "measured_at");

-- CreateIndex
CREATE INDEX "health_measurements_type_id_measured_at_idx" ON "health_measurements"("type_id", "measured_at");

-- CreateIndex
CREATE INDEX "health_measurements_senior_id_measured_at_idx" ON "health_measurements"("senior_id", "measured_at");

-- CreateIndex
CREATE INDEX "health_devices_owner_user_id_idx" ON "health_devices"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_devices_provider_external_id_key" ON "health_devices"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_documents_storage_key_key" ON "health_documents"("storage_key");

-- CreateIndex
CREATE INDEX "health_documents_senior_id_deleted_at_idx" ON "health_documents"("senior_id", "deleted_at");

-- CreateIndex
CREATE INDEX "health_documents_uploaded_by_user_id_idx" ON "health_documents"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "document_accesses_user_id_idx" ON "document_accesses"("user_id");

-- CreateIndex
CREATE INDEX "document_accesses_senior_id_idx" ON "document_accesses"("senior_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_accesses_document_id_user_id_key" ON "document_accesses"("document_id", "user_id");

-- CreateIndex
CREATE INDEX "family_updates_senior_id_created_at_idx" ON "family_updates"("senior_id", "created_at");

-- CreateIndex
CREATE INDEX "family_updates_senior_id_kind_created_at_idx" ON "family_updates"("senior_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "family_updates_author_user_id_idx" ON "family_updates"("author_user_id");

-- CreateIndex
CREATE INDEX "comments_update_id_created_at_idx" ON "comments"("update_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_author_user_id_idx" ON "comments"("author_user_id");

-- CreateIndex
CREATE INDEX "conversations_senior_id_updated_at_idx" ON "conversations"("senior_id", "updated_at");

-- CreateIndex
CREATE INDEX "conversations_senior_id_deleted_at_idx" ON "conversations"("senior_id", "deleted_at");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversation_id_user_id_key" ON "conversation_participants"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_user_id_idx" ON "messages"("sender_user_id");

-- CreateIndex
CREATE INDEX "messages_senior_id_created_at_idx" ON "messages"("senior_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_senior_id_kind_idx" ON "notifications"("senior_id", "kind");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_kind_key" ON "notification_preferences"("user_id", "channel", "kind");

-- CreateIndex
CREATE INDEX "emergency_alerts_senior_id_status_idx" ON "emergency_alerts"("senior_id", "status");

-- CreateIndex
CREATE INDEX "emergency_alerts_status_severity_detected_at_idx" ON "emergency_alerts"("status", "severity", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_alerts_senior_id_source_external_id_key" ON "emergency_alerts"("senior_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_senior_id_created_at_idx" ON "audit_logs"("senior_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "consents_senior_id_scope_idx" ON "consents"("senior_id", "scope");

-- CreateIndex
CREATE INDEX "consents_expires_at_idx" ON "consents"("expires_at");

-- CreateIndex
CREATE INDEX "consents_revoked_at_idx" ON "consents"("revoked_at");

-- CreateIndex
CREATE INDEX "invitations_invitee_email_status_idx" ON "invitations"("invitee_email", "status");

-- CreateIndex
CREATE INDEX "invitations_senior_id_status_idx" ON "invitations"("senior_id", "status");

-- CreateIndex
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");

-- CreateIndex
CREATE INDEX "organization_subscriptions_organization_id_status_idx" ON "organization_subscriptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "organization_subscriptions_current_period_end_idx" ON "organization_subscriptions"("current_period_end");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions"("current_period_end");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_senior_profile_id_fkey" FOREIGN KEY ("senior_profile_id") REFERENCES "senior_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senior_organization_memberships" ADD CONSTRAINT "senior_organization_memberships_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senior_organization_memberships" ADD CONSTRAINT "senior_organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_circles" ADD CONSTRAINT "care_circles_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_circles" ADD CONSTRAINT "care_circles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_circle_members" ADD CONSTRAINT "care_circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "care_circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_circle_members" ADD CONSTRAINT "care_circle_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_circle_members" ADD CONSTRAINT "care_circle_members_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_primary_senior_id_fkey" FOREIGN KEY ("primary_senior_id") REFERENCES "senior_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_schedules" ADD CONSTRAINT "medication_schedules_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_doses" ADD CONSTRAINT "medication_doses_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "medication_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_participants" ADD CONSTRAINT "appointment_participants_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_tasks" ADD CONSTRAINT "care_tasks_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_task_assignments" ADD CONSTRAINT "care_task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "care_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "health_measurement_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "health_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_devices" ADD CONSTRAINT "health_devices_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_accesses" ADD CONSTRAINT "document_accesses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "health_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_accesses" ADD CONSTRAINT "document_accesses_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_updates" ADD CONSTRAINT "family_updates_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_updates" ADD CONSTRAINT "family_updates_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_update_id_fkey" FOREIGN KEY ("update_id") REFERENCES "family_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_senior_id_fkey" FOREIGN KEY ("senior_id") REFERENCES "senior_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
