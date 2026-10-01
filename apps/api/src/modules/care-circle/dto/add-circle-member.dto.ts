/**
 * Phase 49 — care-circle member payload.
 *
 * `userId` names an EXISTING platform account. This is a privileged
 * administrative act (FAMILY_ADMIN only), not an invitation: no invitation
 * surface, token, acceptance step or delivery channel exists in the API
 * (Phase 48 PR-48-16 lists `Invitation` as schema-only). The invitee's
 * consent is therefore NOT captured by this call — see the Phase 49 report.
 *
 * `CircleRole` is imported as a VALUE (not `import type`) for the same
 * reason the auth DTOs are: `@IsEnum(CircleRole)` needs a runtime symbol,
 * and an elided import would strip the constraint entirely.
 */
import { CircleRole } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AddCareCircleMemberDto {
  @IsUUID('4', { message: 'userId must be a valid UUID.' })
  userId!: string;

  @IsEnum(CircleRole, { message: 'role must be a valid care-circle role.' })
  @IsNotEmpty({ message: 'role is required.' })
  role!: CircleRole;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'displayName must be at most 200 characters.' })
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'notes must be at most 2000 characters.' })
  notes?: string;
}