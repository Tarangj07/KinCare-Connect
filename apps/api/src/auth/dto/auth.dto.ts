import { IsEmail, IsNotEmpty, IsString, registerDecorator, ValidationArguments } from 'class-validator';

import {
  isAcceptablePassword,
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../password-policy';

/**
 * A password meeting the strength policy.
 *
 * Phase 23 (W4): this replaces a quadratic `@Matches` regex that let a single
 * unauthenticated `POST /auth/register` block the event loop for minutes. The
 * policy itself is unchanged — see `password-policy.ts` for the equivalence
 * argument and the measurements.
 */
export function IsAcceptablePassword(validationOptions?: { message?: string }) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isAcceptablePassword',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (_value: unknown, args: ValidationArguments): boolean => isAcceptablePassword(args.value),
        defaultMessage: (): string => validationOptions?.message ?? PASSWORD_POLICY_MESSAGE,
      },
    });
  };
}

/**
 * Registration payload. Only a basic user account; no privileged
 * roles may be assigned by the client.
 */
export class RegisterDto {
  @IsEmail({}, { message: 'Email format is invalid.' })
  email!: string;

  @IsString()
  @IsAcceptablePassword({
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters with a mix of letters, numbers, and optionally special characters.`,
  })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Full name is required.' })
  fullName!: string;
}

/**
 * Login payload. No role selection allowed.
 */
export class LoginDto {
  @IsEmail({}, { message: 'Email format is invalid.' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required.' })
  password!: string;
}

/**
 * Refresh payload. The refresh token is read from the httpOnly cookie
 * by the middleware, but this type is kept for clients that prefer
 * an explicit body-based refresh (mobile SDK compatibility).
 */
export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required.' })
  refreshToken!: string;
}
