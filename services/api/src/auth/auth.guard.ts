import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, ForbiddenException, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_COOKIE, SessionService, type SessionUser } from './session.service';

export const ROLES_KEY = 'stella:roles';

/**
 * Requires the caller to hold at least one of these roles.
 *
 * Roles are additive (ADR-018): one identity can be both astrologer and admin,
 * so this asks "do you have this role", never "are you this kind of user".
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Marks a route as public. Everything else behind this guard requires a session. */
export const PUBLIC_KEY = 'stella:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthedRequest extends Request {
  user?: SessionUser;
}

/**
 * Session guard.
 *
 * Reads the session from the database on every request — see SessionService for
 * why that read is the point rather than the cost. The alternative, trusting a
 * signed token, means a disabled account keeps working until its token expires.
 *
 * DENIES BY DEFAULT. A route is public only if it says so with @Public(), so a
 * new endpoint added without thinking is closed, not open.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
    const user = await this.sessions.resolve(cookies[SESSION_COOKIE]);

    if (!user) throw new UnauthorizedException('Sign in to continue.');
    req.user = user;

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    // Prefix match, so admin:super satisfies a requirement for admin:*.
    const ok = required.some((need) =>
      user.roles.some((held) => held === need || held.startsWith(`${need}:`)),
    );
    // 403 not 404: the caller is authenticated, and pretending the route does
    // not exist would only confuse the legitimate user who lacks a role.
    if (!ok) throw new ForbiddenException('You do not have access to this.');
    return true;
  }
}
