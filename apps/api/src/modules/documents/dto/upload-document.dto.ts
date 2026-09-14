import { IsString, IsNotEmpty, IsOptional, MaxLength, Matches } from 'class-validator';

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_FILE_CONTENT_LENGTH = 20 * 1024 * 1024; // 20MB base64 string max (approx >10MB decoded)

export class UploadDocumentDto {
  @IsString({ message: 'Title is required.' })
  @IsNotEmpty({ message: 'Title cannot be empty.' })
  @MaxLength(200, { message: 'Title too long (max 200 chars).' })
  @Matches(/^[^\x00-\x1f\x7f]+$/, { message: 'Title contains invalid characters.' })
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
  @IsString({ message: 'Content type must be a string.' })
  @Matches(new RegExp(`^(?:${ALLOWED_CONTENT_TYPES.map(ct => ct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`), { message: 'Content type is not allowed.' })
  contentType!: string;

  @IsString({ message: 'File name is required.' })
  @IsNotEmpty({ message: 'File name cannot be empty.' })
  @MaxLength(255, { message: 'File name too long (max 255 chars).' })
  @Matches(/^[^\x00-\x1f\x7f\\/:*?"<>|]+$/, { message: 'File name contains invalid or path-traversal characters.' })
  fileName!: string;

  @IsString({ message: 'File content (base64) is required.' })
  @IsNotEmpty({ message: 'File content cannot be empty.' })
  @MaxLength(MAX_FILE_CONTENT_LENGTH, { message: 'File content exceeds maximum base64 length.' })
  @Matches(BASE64_REGEX, { message: 'File content must be valid base64.' })
  fileContent!: string;
}
