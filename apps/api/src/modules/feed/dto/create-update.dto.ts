import { IsString, IsNotEmpty, IsOptional, IsUUID, Matches, MinLength, IsIn } from 'class-validator';

export class CreateFamilyUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  body!: string;

  @IsIn(['CIRCLE', 'ORGANIZATION', 'PRIVATE'], { message: 'Invalid visibility value.' })
  @IsOptional()
  visibility?: 'CIRCLE' | 'ORGANIZATION' | 'PRIVATE';

  @IsString()
  @IsOptional()
  kind?: string;

  @IsString()
  @IsOptional()
  relatedEntityType?: string;

  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, { message: 'relatedEntityId must be a valid UUID v4.' })
  @IsOptional()
  relatedEntityId?: string;
}
