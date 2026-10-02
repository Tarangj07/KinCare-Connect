/**
 * Phase 25 remediation (SECURITY_REVIEW_PHASE_25 INFO-03) — update-task payload.
 *
 * Same defect class as `CreateTaskDto`: the handler declared
 * `@Body() body: { title?: string; ... }`, an inline type literal whose
 * emitted metatype is `Object` — which `ValidationPipe` skips, so this body
 * reached `CareTaskService.update` completely unvalidated.
 *
 * Every field is optional, matching the previous inline literal and the
 * service's own `!== undefined` per-field merge. The service contract is
 * unchanged; the validators now enforce at the edge what the service already
 * assumed: `status` was `as`-cast to a Prisma enum (an unknown value reached
 * Prisma as a 500; `@IsEnum` refuses it as a 400), and `dueAt` /
 * `completedAt` were handed to `new Date(...)` (the Phase 23 W4 rule rejects
 * impossible dates at the boundary).
 */
import { CareTaskPriority, CareTaskStatus } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { IsIsoInstant } from '../../../common/validation/is-iso-instant';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'title must be at most 200 characters.' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'description must be at most 2000 characters.' })
  description?: string;

  @IsOptional()
  @IsEnum(CareTaskPriority, { message: 'priority must be a valid care-task priority.' })
  priority?: CareTaskPriority;

  @IsOptional()
  @IsEnum(CareTaskStatus, { message: 'status must be a valid care-task status.' })
  status?: CareTaskStatus;

  @IsOptional()
  @IsIsoInstant({ message: 'dueAt must be ISO 8601 format with timezone.' })
  dueAt?: string;

  @IsOptional()
  @IsIsoInstant({ message: 'completedAt must be ISO 8601 format with timezone.' })
  completedAt?: string;
}
