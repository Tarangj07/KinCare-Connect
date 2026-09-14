import {
  Body, Controller, Get, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';
import type { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/auth.guard';
import { RateLimitGuard } from './guards/rate-limit.guard'; // eslint-disable-line @typescript-eslint/no-unused-vars -- applied via decorator

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  @RateLimit()
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) _res: Response) {
    const userData = await this.authService.register(dto);
    return { message: 'Account created. Email verification pending.', user: userData };
  }

  @Post('login')
  @Public()
  @RateLimit()
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: { id: string; email: string; fullName: string; globalRole: string } }> {
    const result = await this.authService.login(dto);
    res.cookie('refresh', result.refresh, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });
    return { user: result.user };
  }

  @Post('refresh')
  @Public()
  @RateLimit()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) _res: Response,
  ): Promise<{ access: string }> {
    const tokenFromCookie = (req as Request & { cookies?: { refresh?: string } }).cookies?.refresh;
    const tokenFromBody = (req.body as RefreshDto)?.refreshToken ?? tokenFromCookie;
    const newAccess = await this.authService.refresh(tokenFromBody);
    return { access: newAccess };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const tokenFromCookie = (req as Request & { cookies?: { refresh?: string } }).cookies?.refresh;
    await this.authService.logout(tokenFromCookie);
    res.clearCookie('refresh', { path: '/api/v1/auth/refresh' });
    return { message: 'Logged out.' };
  }

  @Post('me')
  @Public()
  async me(@Req() req: Request): Promise<{ id: string; email: string; fullName: string; globalRole: string }> {
    return (req as Request & { user?: { id: string; email: string; fullName: string; globalRole: string } }).user || { id: '', email: '', fullName: '', globalRole: 'USER' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: Request): Promise<{ id: string; email: string; fullName: string; globalRole: string }> {
    return (req as Request & { user?: { id: string; email: string; fullName: string; globalRole: string } }).user || { id: '', email: '', fullName: '', globalRole: 'USER' };
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
