import { IsString, IsNotEmpty, IsOptional, IsUUID, MinLength } from 'class-validator';

import { IsIsoInstant } from '../../../common/validation/is-iso-instant';

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

  // Phase 23 (W4): replaced a shape-only `@Matches` regex, which accepted
  // impossible-but-well-formed dates such as `2026-13-45T99:99:99.000Z` and
  // let them reach Prisma as `new Date("Invalid Date")` — an HTTP 500 caused
  // entirely by client input. See common/validation/is-iso-instant.ts.
  @IsIsoInstant({ message: 'startsAt must be ISO 8601 format with timezone.' })
  startsAt!: string;

  @IsIsoInstant({ message: 'endsAt must be ISO 8601 format with timezone.' })
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

  @IsIsoInstant({ message: 'startsAt must be ISO 8601 format with timezone.' })
  @IsOptional()
  startsAt?: string;

  @IsIsoInstant({ message: 'endsAt must be ISO 8601 format with timezone.' })
  @IsOptional()
  endsAt?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
