import {
  Body, Controller, Get, Post, Req, Res, HttpCode, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { SESSION_COOKIE } from './session.service';
import { AuthGuard, Public, type AuthedRequest } from './auth.guard';

class LoginDto {
  @IsEmail({}, { message: 'Enter the email address for the account.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Enter the password.' })
  @MaxLength(1024)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Sign in.
   *
   * Rate limited hard: 5 attempts per minute per IP, on top of the per-account
   * lockout in AuthService. The two cover different attacks — the lockout stops
   * one account being ground down, the throttle stops one IP spraying many.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, expiresAt, user } = await this.auth.login(dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,   // unreadable from JavaScript, so XSS cannot lift it
      secure: true,     // HTTPS only
      sameSite: 'lax',  // survives a normal top-level navigation, blocks CSRF POSTs
      path: '/',
      expires: expiresAt,
    });

    // The token is never in the body — only in the httpOnly cookie.
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
    await this.auth.logout(cookies[SESSION_COOKIE], req.user?.id, req.ip);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { status: 'ok' };
  }

  /** Who am I. Used by the admin UI to decide what to render. */
  @Get('me')
  me(@Req() req: AuthedRequest) {
    if (!req.user) throw new UnauthorizedException();
    return { id: req.user.id, email: req.user.email, roles: req.user.roles };
  }
}
