import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body!: string;

  @IsString()
  @IsOptional()
  @IsUUID(4)
  replyToId?: string;
}
