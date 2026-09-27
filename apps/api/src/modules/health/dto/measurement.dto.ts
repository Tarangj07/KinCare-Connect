import { IsObject, IsString, IsNotEmpty, IsOptional, IsUUID, Matches, IsIn, IsInt, Min, Max } from 'class-validator';

/**
 * Create a health measurement for a senior.
 *
 * Authorization: The caller must have an active CareCircleMember
 * role (FAMILY_ADMIN, FAMILY_MEMBER, CAREGIVER, DOCTOR, OBSERVER)
 * for the senior. The authorization service verifies this.
 */
export class CreateHealthMeasurementDto {
  @IsString()
  @IsNotEmpty()
  measurementTypeKey!: string;

  /// Structured value as JSON. For scalar: { "kind":"scalar","value":72,"unit":"bpm" }
  /// For compound (e.g. BP): { "kind":"compound","components":{"systolic":120,"diastolic":80,"unit":"mmHg"} }
  /// Phase 17: required a validator — with no decorator it was stripped by
  /// the strict whitelist and every measurement POST failed with 400.
  @IsObject({ message: 'value must be a JSON object.' })
  value!: Record<string, unknown>;

  @Matches(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, { message: 'measuredAt must be ISO 8601 with timezone.' })
  measuredAt!: string;

  @IsIn(['MANUAL', 'DEVICE', 'IMPORT', 'SYSTEM'])
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class HealthMeasurementFilterDto {
  @IsString()
  @IsOptional()
  measurementType?: string;

  @Matches(/\d{4}-\d{2}-\d{2}/)
  @IsOptional()
  from?: string;

  @Matches(/\d{4}-\d{2}-\d{2}/)
  @IsOptional()
  to?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
