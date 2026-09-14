import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength, Matches, MinLength } from 'class-validator';

export class UploadDocumentDto {
  @IsString({ message: 'Title is required.' })
  @IsNotEmpty({ message: 'Title cannot be empty.' })
  @MaxLength(200, { message: 'Title too long (max 200 chars).' })
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'Category too long (max 100 chars).' })
  category?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Description too long (max 1000 chars).' })
  description?: string;

  @IsString({ message: 'Content type is required.' })
  @IsNotEmpty({ message: 'Content type cannot be empty.' })
  contentType!: string;

  @IsString({ message: 'File name is required.' })
  @IsNotEmpty({ message: 'File name cannot be empty.' })
  fileName!: string;

  @IsString({ message: 'File content (base64) is required.' })
  @IsNotEmpty({ message: 'File content cannot be empty.' })
  fileContent!: string;
}
