/**
 * Phase 49 — additional care-circle payload.
 *
 * `seniorId` is required here (unlike onboarding) because the caller must
 * already hold a legitimate care-circle membership for that senior; the
 * service re-checks that through `AuthorizationService` before any write.
 * This endpoint therefore cannot be used to reach a senior the caller does
 * not already have access to.
 */
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCareCircleDto {
  @IsUUID('4', { message: 'seniorId must be a valid UUID.' })
  seniorId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Name is required.' })
  @MaxLength(120, { message: 'name must be at most 120 characters.' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'description must be at most 2000 characters.' })
  description?: string;
}