import {
  Body, Controller, Get, Post, Query, Req, Res, HttpCode, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionService } from './session.service';

/** Short-lived, single-flight cookies for the OAuth round trip. */
const OAUTH_STATE_COOKIE = 'stella_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'stella_oauth_verifier';
import { Public, type AuthedRequest } from './auth.guard';
import { GoogleService } from './google.service';

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
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleService,
  ) {}

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

  /**
   * Starts Google sign-in.
   *
   * `state` and the PKCE verifier go into short-lived httpOnly cookies rather
   * than a table: they are valid for one redirect and nothing else needs to
   * read them. httpOnly matters — if script could read `state`, the CSRF
   * defence it provides would be worth nothing.
   */
  @Public()
  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  googleStart(@Res({ passthrough: true }) res: Response) {
    const { url, state, verifier } = this.google.start();
    const opts = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 10 * 60 * 1000, // the flow is seconds; ten minutes is generous
    };
    res.cookie(OAUTH_STATE_COOKIE, state, opts);
    res.cookie(OAUTH_VERIFIER_COOKIE, verifier, opts);
    res.redirect(302, url);
  }

  /**
   * Google redirects here.
   *
   * The state comparison is the CSRF defence: without it, an attacker can hand
   * a victim a `code` from the attacker's own account and silently sign the
   * victim into it. Compared in constant time, and the cookies are cleared
   * whatever the outcome so a code cannot be replayed.
   */
  @Public()
  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleCallback(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
    const expectedState = cookies[OAUTH_STATE_COOKIE];
    const verifier = cookies[OAUTH_VERIFIER_COOKIE];

    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
    res.clearCookie(OAUTH_VERIFIER_COOKIE, { path: '/' });

    // The user pressed Cancel, or Google refused. Not an error to shout about.
    if (error) return res.redirect(302, '/?signin=cancelled');

    if (!code || !state || !expectedState || !verifier) {
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }
    if (!SessionService.sameToken(state, expectedState)) {
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }

    const identity = await this.google.exchange(code, verifier);
    const { token, expiresAt } = await this.auth.loginWithGoogle(identity, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    // Back to the site, not to a JSON body — a browser is following this.
    return res.redirect(302, '/?signin=ok');
  }

  /** Who am I. Used by the admin UI to decide what to render. */
  @Get('me')
  me(@Req() req: AuthedRequest) {
    if (!req.user) throw new UnauthorizedException();
    return { id: req.user.id, email: req.user.email, roles: req.user.roles };
  }
}
