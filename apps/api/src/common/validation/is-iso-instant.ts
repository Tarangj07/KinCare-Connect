/**
 * ISO-8601 instant validation.
 *
 * Phase 23 (W4). A bare shape regex is not sufficient for a value that is
 * later handed to `new Date(...)` and then to a database column. The pattern
 * below accepts a *syntactically* well-formed but semantically impossible
 * timestamp such as `2026-13-45T99:99:99.000Z`; that string passed the DTO,
 * became `new Date("Invalid Date")` in the service, and Prisma raised a
 * client-validation error, so a client could turn a bad date into an HTTP
 * 500. Requiring the value to actually parse closes that at the boundary,
 * where the error message can be specific and the status is a correct 400.
 *
 * The shape is still pinned to an explicit UTC offset with milliseconds, so
 * a caller cannot omit the timezone and have the server guess one. That is a
 * stricter rule than `class-validator`'s built-in `IsDateString`, which
 * accepts a zone-less local time.
 *
 * Lives in `common/` rather than a feature DTO because the appointment and
 * measurement DTOs both need it and duplicating the rule would let the two
 * drift — which is exactly how the original defect arose.
 */
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const ISO_INSTANT_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/**
 * True when `value` has the required shape AND denotes a real instant.
 *
 * The shape alone is not enough, and neither is `Date.parse`: JavaScript
 * accepts and silently *rolls forward* a day that does not exist, so
 * `2026-02-30T10:00:00.000Z` parses to 2 March and would be persisted as a
 * different day than the caller asked for. `Date.parse` also returns NaN for
 * out-of-range hours and minutes, so shape + parse together already reject
 * `2026-13-45T99:99:99.000Z`.
 *
 * Because the day-rollover case is silent rather than NaN, the calendar
 * components are re-checked explicitly. A value is accepted only when the
 * date it denotes is the same date the caller wrote.
 */
export function isParsableIsoInstant(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = ISO_INSTANT_SHAPE.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  // getUTC* rather than get* : the value is pinned to `Z`, so UTC is the
  // only frame in which the caller's components can be compared.
  return (
    parsed.getUTCFullYear() === Number(year) &&
    // getUTCMonth is 0-based.
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day) &&
    parsed.getUTCHours() === Number(hour) &&
    parsed.getUTCMinutes() === Number(minute) &&
    parsed.getUTCSeconds() === Number(second)
  );
}

/**
 * class-validator decorator requiring a real ISO-8601 instant.
 *
 * @example
 *   class CreateThingDto {
 *     \@IsIsoInstant()
 *     startsAt!: string;
 *   }
 */
export function IsIsoInstant(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isIsoInstant',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate: (_value: unknown, args: ValidationArguments): boolean => isParsableIsoInstant(args.value),
        defaultMessage: (args: ValidationArguments): string =>
          `${args.property} must be an ISO 8601 timestamp with a timezone, and must be a real date.`,
      },
    });
  };
}
