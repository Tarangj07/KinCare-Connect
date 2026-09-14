import { IsString, IsOptional, IsIn, Matches, MinLength } from 'class-validator';

export class NotificationPreferenceDto {
  @IsString()
  @IsIn(['IN_APP', 'PUSH', 'EMAIL', 'SMS'])
  channel!: string;

  @IsString()
  @IsOptional()
  kind?: string;

  @IsString()
  @IsOptional()
  enabled?: string;
}
