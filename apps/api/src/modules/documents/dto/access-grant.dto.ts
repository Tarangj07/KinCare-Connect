import { IsString, IsNotEmpty, IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateAccessGrantDto {
  @IsString({ message: 'Target userId is required.' })
  @IsNotEmpty({ message: 'Target userId cannot be empty.' })
  @IsUUID('4', { message: 'Invalid UUID for userId.' })
  userId!: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, { message: 'Invalid expiration format.' })
  expiresAt?: string;
}
