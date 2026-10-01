/**
 * Phase 49 — senior onboarding payload.
 *
 * The global `ValidationPipe` runs with `whitelist: true` and
 * `forbidNonWhitelisted: true`, so only the properties declared here are
 * accepted; anything else is a 400. That is what stops a client from
 * setting a senior's `isActive`, `deletedAt` or relationships through this
 * endpoint — Prisma models are never bound directly.
 *
 * `dateOfBirth` is validated for shape AND for being a real, non-future
 * calendar date. `class-validator`'s `IsDateString` accepts a zone-less
 * local time and the built-in `IsDate` is looser still; both would let a
 * value through that either silently rolls forward to another day
 * (`2026-02-30`) or lands in the future. The column is `@db.Date`, so a
 * silently wrong day would be persisted as a different day of birth.
 */
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Real calendar date, `YYYY-MM-DD`, not in the future. */
export function isRealPastOrPresentDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  // getUTC* because the value is pinned to `Z`; this is the only frame in
  // which the caller's written components can be compared.
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return false;
  }
  return parsed.getTime() <= Date.now();
}

export function IsRealPastOrPresentDate(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isRealPastOrPresentDate',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate: (_value: unknown, _args: ValidationArguments): boolean =>
          isRealPastOrPresentDate(_value),
        defaultMessage: (args: ValidationArguments): string =>
          `${args.property} must be a real date in YYYY-MM-DD form and must not be in the future.`,
      },
    });
  };
}

export class CreateSeniorDto {
  @IsString()
  @IsNotEmpty({ message: 'Full name is required.' })
  @MaxLength(200, { message: 'fullName must be at most 200 characters.' })
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'preferredName must be at most 200 characters.' })
  preferredName?: string;

  @IsOptional()
  @IsRealPastOrPresentDate()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'carePreferences must be at most 2000 characters.' })
  carePreferences?: string;

  /**
   * Name of the founding care circle created with the senior.
   *
   * Onboarding is one operation: senior + circle + the creator's FAMILY_ADMIN
   * membership. See `care-circle.service.ts` for why the membership cannot be
   * a separate step.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'circleName must be at most 120 characters.' })
  circleName?: string;
}