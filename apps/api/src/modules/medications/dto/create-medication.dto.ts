import { IsString, IsNotEmpty, IsOptional, IsUUID, IsInt, Min, Max, Matches } from 'class-validator';

/**
 * Create medication payload. Ownership is derived from seniorId
 * through the authorization service; never trusted blindly.
 */
export class CreateMedicationDto {
  @IsString({ message: 'Medication name is required.' })
  @IsNotEmpty({ message: 'Medication name cannot be empty.' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Dosage is required.' })
  dosage!: string;

  @IsString()
  @IsOptional()
  form?: string;

  @IsString()
  @IsOptional()
  instructions?: string;

  @IsString()
  @IsOptional()
  prescribedByName?: string;

  @IsString()
  @IsOptional()
  pharmacyName?: string;

  @IsString()
  @IsOptional()
  pharmacyPhone?: string;

  @Matches(/\d{4}-\d{2}-\d{2}/, { message: 'Start date must be YYYY-MM-DD format.' })
  @IsOptional()
  startDate?: string;

  @Matches(/\d{4}-\d{2}-\d{2}/, { message: 'End date must be YYYY-MM-DD format.' })
  @IsOptional()
  endDate?: string;
}

/**
 * Update medication payload.
 */
export class UpdateMedicationDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  dosage?: string;

  @IsString()
  @IsOptional()
  form?: string;

  @IsString()
  @IsOptional()
  instructions?: string;

  @IsString()
  @IsOptional()
  prescribedByName?: string;

  @IsString()
  @IsOptional()
  pharmacyName?: string;

  @IsString()
  @IsOptional()
  pharmacyPhone?: string;

  @Matches(/\d{4}-\d{2}-\d{2}/, { message: 'Start date must be YYYY-MM-DD format.' })
  @IsOptional()
  startDate?: string;

  @Matches(/\d{4}-\d{2}-\d{2}/, { message: 'End date must be YYYY-MM-DD format.' })
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  isActive?: string; // Converted to Boolean by the controller/service layer.
}
