import {
  Body, Controller, Get, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';
import type { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
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
  async forgotPassword(@Body('email') _email: string): Promise<{ message: string }> {
    return { message: 'If an account exists with this email, a reset link was sent.' };
  }

  @Post('reset-password')
  @Public()
  @RateLimit()
  async resetPassword(@Body('token') _token: string, @Body('newPassword') _newPassword: string): Promise<{ message: string }> {
    return { message: 'Password reset completed (stub — Phase 4).' };
  }

  @Post('verify-email')
  @Public()
  async verifyEmail(@Body('token') _token: string): Promise<{ message: string }> {
    return { message: 'Email verified (stub — Phase 4).' };
  }
}
