/**
 * Phase 25 remediation (SECURITY_REVIEW_PHASE_25 INFO-03) — create-task payload.
 *
 * The handler used to declare
 * `@Body() body: { title: string; description?: string; ... }`. An inline
 * type literal is erased at compile time, so `design:paramtypes` emitted
 * `Object` — a metatype Nest's `ValidationPipe` skips (its skip-list is
 * [String, Boolean, Number, Array, Object, Buffer, Date]). The route therefore
 * accepted **any** body: no whitelist, no `forbidNonWhitelisted`, no type or
 * length constraints, and `verify:routes` failed on the compiled artifact
 * exactly the way Phase 24 (D-4) and Phase 25 (F-2/F-3) documented.
 *
 * Binding the body to a DTO class is the contract every other body route in
 * this service already uses. The fields and their optionality are copied
 * verbatim from the previous inline literal so the wire contract does not
 * change; the validators close the boundary the service already assumed:
 *
 *   - `priority` / `recurrenceFrequency` were `as`-cast to Prisma enums in
 *     `CareTaskService.create`; an unknown value reached Prisma and became a
 *     500. `@IsEnum` refuses it as a 400 instead.
 *   - `dueAt` / `recurrenceEndsAt` were handed to `new Date(...)`. The
 *     Phase 23 (W4) rule (`IsIsoInstant`) rejects impossible-but-well-formed
 *     dates at the boundary rather than persisting a silently rolled-forward
 *     day or crashing with an unparseable value.
 */
import { CareTaskPriority, RecurrenceFrequency } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { IsIsoInstant } from '../../../common/validation/is-iso-instant';

export class CreateTaskDto {
  @IsString({ message: 'Task title is required.' })
  @IsNotEmpty({ message: 'Task title cannot be empty.' })
  @MaxLength(200, { message: 'title must be at most 200 characters.' })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'description must be at most 2000 characters.' })
  description?: string;

  @IsOptional()
  @IsEnum(CareTaskPriority, { message: 'priority must be a valid care-task priority.' })
  priority?: CareTaskPriority;

  @IsOptional()
  @IsIsoInstant({ message: 'dueAt must be ISO 8601 format with timezone.' })
  dueAt?: string;

  @IsOptional()
  @IsEnum(RecurrenceFrequency, { message: 'recurrenceFrequency must be a valid recurrence frequency.' })
  recurrenceFrequency?: RecurrenceFrequency;

  @IsOptional()
  @IsIsoInstant({ message: 'recurrenceEndsAt must be ISO 8601 format with timezone.' })
  recurrenceEndsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'recurrenceRule must be at most 2000 characters.' })
  recurrenceRule?: string;
}
