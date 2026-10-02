import {
  Body, Controller, Get, Post, Req, Res, UseGuards, HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';
// Phase 22 (F-01, CRITICAL): this MUST be a value import, not `import type`.
//
// `import type` is fully elided at compile time, so `emitDecoratorMetadata` has
// no runtime symbol to reference for a `@Body() dto: RegisterDto` parameter.
// TypeScript then emits `Function` (not `Object`) into `design:paramtypes`,
// and Nest's ValidationPipe — whose `toValidate()` skip-list is
// [String, Boolean, Number, Array, Object, Buffer, Date] — does not skip
// `Function`. It therefore runs class-validator against a constructor that
// carries none of the DTO's constraints, and `forbidNonWhitelisted: true`
// rejects every supplied property:
//
//   POST /api/v1/auth/register  -> 400 "property email should not exist"
//   POST /api/v1/auth/login     -> 400 "property email should not exist"
//
// i.e. no user could register or obtain an access token in a production image.
// The test suites did not catch it because vitest/SWC emits
// `typeof RegisterDto === "undefined" ? Object : RegisterDto`, which degrades to
// `Object` and is therefore SKIPPED by the pipe — the two toolchains disagree
// and only the tsc output ships. Importing the DTOs as values keeps the import
// alive, so `design:paramtypes` carries the real class and the declared
// validation actually runs. `scripts/verify-docker-images.mjs` now performs a
// real register/login/me round-trip against the built image so this class of
// build-output defect can never again be invisible.
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/auth.guard';

interface JwtUser {
  sub: string;
  email: string;
  role: string;
}

const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private meta(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }

  private setRefreshCookie(res: Response, refresh: string): void {
    res.cookie('refresh', refresh, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: REFRESH_COOKIE_PATH,
    });
  }

  @Post('register')
  @Public()
  @RateLimit()
  async register(@Body() dto: RegisterDto) {
    const userData = await this.authService.register(dto);
    return { message: 'Account created. Email verification pending.', user: userData };
  }

  /**
   * Login returns the access token in the body (mobile stores it in
   * SecureStore; the web app may ignore it and rely on the cookie-bound
   * refresh flow). Phase 16 (H11/A16): the access token was previously
   * computed and never delivered, leaving the mobile session inoperative.
   */
  @Post('login')
  @Public()
  @RateLimit()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: { id: string; email: string; fullName: string; globalRole: string }; access: string }> {
    const result = await this.authService.login(dto, this.meta(req));
    this.setRefreshCookie(res, result.refresh);
    return { user: result.user, access: result.access };
  }

  @Post('refresh')
  @Public()
  @RateLimit()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access: string }> {
    const tokenFromCookie = (req as Request & { cookies?: { refresh?: string } }).cookies?.refresh;
    const tokenFromBody = (req.body as RefreshDto | undefined)?.refreshToken ?? tokenFromCookie;
    const result = await this.authService.refresh(tokenFromBody ?? '', this.meta(req));
    // Rotate the cookie so web clients keep the family chain alive.
    this.setRefreshCookie(res, result.refresh);
    return { access: result.access };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const tokenFromCookie = (req as Request & { cookies?: { refresh?: string } }).cookies?.refresh;
    const tokenFromBody = (req.body as RefreshDto | undefined)?.refreshToken ?? tokenFromCookie;
    const user = (req as Request & { user?: JwtUser }).user as JwtUser;
    // Body/cookie-supplied tokens are only honoured for the caller's own
    // session — enforced by matching userId inside the service.
    if (tokenFromBody) await this.authService.logout(tokenFromBody, user.sub);
    res.clearCookie('refresh', { path: REFRESH_COOKIE_PATH });
    return { message: 'Logged out.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: Request): Promise<{ id: string; email: string; fullName: string; globalRole: string }> {
    const user = (req as Request & { user?: JwtUser }).user as JwtUser;
    return this.authService.getProfile(user.sub);
  }

  // Phase 4 stubs
  @Post('forgot-password')
  @Public()
  @RateLimit()
  @HttpCode(501)
  async forgotPassword(@Body('email') _email: string): Promise<{ message: string }> {
    return { message: 'Password reset is not implemented. Use account registration and login.' };
  }

  @Post('reset-password')
  @Public()
  @RateLimit()
  @HttpCode(501)
  async resetPassword(@Body('token') _token: string, @Body('newPassword') _newPassword: string): Promise<{ message: string }> {
    return { message: 'Password reset is not implemented.' };
  }

  @Post('verify-email')
  @Public()
  @HttpCode(501)
  async verifyEmail(@Body('token') _token: string): Promise<{ message: string }> {
    return { message: 'Email verification is not implemented.' };
  }
}
