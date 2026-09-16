import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EmergencyAlertType, EmergencyAlertSeverity } from '@prisma/client';

export class CreateEmergencyAlertDto {
  @IsEnum(EmergencyAlertType)
  type!: EmergencyAlertType;

  @IsEnum(EmergencyAlertSeverity)
  severity!: EmergencyAlertSeverity;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  message?: string;

  @IsString()
  @MaxLength(256)
  source!: string;
}
