import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

/**
 * Body of `PATCH /seniors/:seniorId/feed/:updateId`.
 *
 * Phase 24 (D-4). The handler was declared as
 * `@Body() dto: Partial<CreateFamilyUpdateDto>`. `Partial<T>` is a mapped
 * type, not a class, so TypeScript emitted `Object` into
 * `design:paramtypes` — verified against the compiled artifact:
 *
 *   PATCH /feed/:updateId paramtypes: [ 'String', 'String', 'Object', 'Object' ]
 *   POST  /feed           paramtypes: [ 'String', 'CreateFamilyUpdateDto', 'Object' ]
 *
 * Nest's `ValidationPipe` skips any parameter whose metatype is `Object`, so
 * the route accepted **any** body: no whitelist, no `forbidNonWhitelisted`,
 * no enum check, no length bound. The global strict-validation guarantee
 * silently did not extend to this route, and a body carrying `userId` or
 * `authorUserId` was accepted with 200 instead of refused.
 *
 * A dedicated class is required rather than making the existing one optional:
 * `Partial` is exactly the construct that erases the runtime type. The
 * constraints are copied verbatim from `CreateFamilyUpdateDto` so a PATCH can
 * never accept something the POST would refuse.
 */
export class UpdateFamilyUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @IsOptional()
  body?: string;

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
