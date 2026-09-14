import { IsEmail, IsNotEmpty, IsString, Matches,MinLength } from 'class-validator';

/**
 * Registration payload. Only a basic user account; no privileged
 * roles may be assigned by the client.
 */
export class RegisterDto {
  @IsEmail({}, { message: 'Email format is invalid.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @Matches(/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).*|(?=.*[A-Z])(?=.*[a-z])(?=.*\d).*|(?=.*[A-Z])(?=.*[\W_]).*|(?=.*[a-z])(?=.*[\W_])(?=.*\d).*/, {
    message:
      'Password must contain at least 8 characters with a mix of letters, numbers, and optionally special characters.',
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
