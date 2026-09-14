import { IsString, IsNotEmpty, IsOptional, IsUUID, Matches, MinLength } from 'class-validator';

export class CreateAppointmentDto {
  @IsString({ message: 'Title is required.' })
  @IsNotEmpty({ message: 'Title cannot be empty.' })
  @MinLength(2)
  title!: string;

  @IsString()
  @IsOptional()
  providerName?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  isTelehealth?: string;

  @Matches(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, {
    message: 'startsAt must be ISO 8601 format with timezone.',
  })
  startsAt!: string;

  @Matches(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, { message: 'endsAt must be ISO 8601 format with timezone.' })
  @IsOptional()
  endsAt?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateAppointmentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  providerName?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  isTelehealth?: string;

  @Matches(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, { message: 'startsAt must be ISO 8601 format with timezone.' })
  @IsOptional()
  startsAt?: string;

  @Matches(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/, { message: 'endsAt must be ISO 8601 format with timezone.' })
  @IsOptional()
  endsAt?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
