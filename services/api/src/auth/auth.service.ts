import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';
import { hashPassword, needsRehash, verifyPassword } from './password';
import { monotonicFactory } from 'ulid';
import type { GoogleIdentity } from './google.service';

const ulid = monotonicFactory();

/** Failures before the account locks, and for how long. */
const MAX_FAILED = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * A hash of a password nobody has. Verified against when the account does not
 * exist, so a request for an unknown user costs the same ~500ms as a request
 * for a real one. Without it, response time alone tells an attacker which
 * usernames exist — and "admin" being the obvious guess does not make the other
 * accounts free to enumerate.
 */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Password sign-in.
   *
   * ADR-038 makes this the only factor for the admin account, so everything
   * that can be tightened around it is:
   *
   *   - one generic message for every failure, so the response never says
   *     whether the account exists
   *   - a constant-ish cost on the unknown-account path (see DUMMY_HASH)
   *   - a durable lockout counter in the database, not memory — restarting the
   *     API must not clear a lockout
   *   - every attempt audited, success or failure, with the IP
   *   - all existing sessions left alone on success, but the hash upgraded in
   *     place if the cost parameters have since been raised
   */
  async login(
    email: string,
    password: string,
    ctx: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ token: string; expiresAt: Date; user: { id: string; email: string; roles: string[] } }> {
    const normalised = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.record(user.id, 'auth.login.locked', ctx, normalised);
      // Says the account is locked rather than pretending the password is
      // wrong: the person being locked out is usually the legitimate owner, and
      // an attacker already knows they are being blocked.
      throw new UnauthorizedException(
        'This account is temporarily locked after too many failed attempts. Try again later.',
      );
    }

    const stored = user?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, stored);

    // `user &&` matters: a correct password against DUMMY_HASH is impossible,
    // but making the check explicit means a future edit cannot make it possible.
    if (!user || !user.passwordHash || !ok) {
      if (user) await this.registerFailure(user.id, user.failedLoginCount, ctx, normalised);
      else await this.record(null, 'auth.login.unknown', ctx, normalised);
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    if (user.disabledAt) {
      await this.record(user.id, 'auth.login.disabled', ctx, normalised);
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const data: Record<string, unknown> = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    };
    // Raising the cost later must not lock anyone out; upgrade on the one
    // occasion the plaintext is legitimately in hand.
    if (needsRehash(user.passwordHash)) {
      data.passwordHash = await hashPassword(password);
      this.log.log(`Upgraded password hash parameters for ${user.id}`);
    }
    await this.prisma.user.update({ where: { id: user.id }, data });

    const { token, expiresAt } = await this.sessions.create(user.id, ctx);
    await this.record(user.id, 'auth.login.success', ctx, normalised);

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        roles: Array.isArray(user.roles) ? (user.roles as string[]) : [],
      },
    };
  }

  /**
   * Signs in with a verified Google identity, creating the account on first
   * sight (ADR-037).
   *
   * MATCHED BY google_sub FIRST, email second. Google's `sub` is stable; an
   * email address is not — people change them, and addresses get reassigned
   * inside a workspace. Matching on email alone would hand an account to
   * whoever inherits the address.
   *
   * When an existing password account signs in with the same address, the two
   * are linked rather than duplicated: one identity per human keeps the audit
   * trail answerable (ADR-018).
   */
  async loginWithGoogle(
    identity: GoogleIdentity,
    ctx: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ token: string; expiresAt: Date; user: { id: string; email: string; roles: string[] } }> {
    let user = await this.prisma.user.findUnique({ where: { googleSub: identity.sub } });

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
      if (byEmail) {
        if (byEmail.googleSub && byEmail.googleSub !== identity.sub) {
          // Two Google accounts claiming one address. Refuse rather than guess.
          await this.record(byEmail.id, 'auth.google.conflict', ctx, identity.email);
          throw new UnauthorizedException('Could not complete Google sign-in.');
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { googleSub: identity.sub, name: byEmail.name ?? identity.name ?? null },
        });
        await this.record(user.id, 'auth.google.linked', ctx, identity.email);
      } else {
        user = await this.prisma.user.create({
          data: {
            id: ulid(),
            email: identity.email,
            name: identity.name ?? null,
            googleSub: identity.sub,
            // A new Google account is a customer. Roles are granted
            // deliberately, never inferred from how someone signed in.
            roles: [],
          },
        });
        await this.record(user.id, 'auth.google.signup', ctx, identity.email);
      }
    }

    if (user.disabledAt) {
      await this.record(user.id, 'auth.google.disabled', ctx, identity.email);
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { token, expiresAt } = await this.sessions.create(user.id, ctx);
    await this.record(user.id, 'auth.google.success', ctx, identity.email);

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        roles: Array.isArray(user.roles) ? (user.roles as string[]) : [],
      },
    };
  }

  async logout(token: string | undefined, actorId?: string, ip?: string): Promise<void> {
    await this.sessions.revoke(token);
    if (actorId) {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.record(tx, {
          action: 'auth.logout',
          targetType: 'User',
          targetId: actorId,
          actor: { id: actorId, ip },
        });
      });
    }
  }

  private async registerFailure(
    userId: string,
    current: number,
    ctx: { ip?: string | undefined },
    email: string,
  ): Promise<void> {
    const count = current + 1;
    const locked = count >= MAX_FAILED;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: count,
        ...(locked ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS), failedLoginCount: 0 } : {}),
      },
    });
    if (locked) {
      this.log.warn(`Locked ${email} after ${MAX_FAILED} failed attempts (ip=${ctx.ip ?? '?'})`);
    }
    await this.record(userId, locked ? 'auth.login.lockout' : 'auth.login.failed', ctx, email);
  }

  /**
   * Audits an attempt.
   *
   * Swallows its own failure, unlike every other audit write in this codebase.
   * That is deliberate and it is the one place it is right: if the audit table
   * is unwritable, refusing to log anyone in would turn a logging fault into a
   * total outage, and the alternative — a failed LOGIN going unrecorded — is
   * far less serious than a failed booking or refund going unrecorded.
   */
  private async record(
    userId: string | null,
    action: string,
    ctx: { ip?: string | undefined },
    email: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.record(tx, {
          action,
          targetType: 'User',
          // AuditService distinguishes "absent" from "explicitly null", so an
          // unknown account passes undefined rather than null.
          targetId: userId ?? undefined,
          // The address is the subject of the event, so it belongs here; the
          // password never is, in any form.
          after: { email },
          actor: { id: userId ?? undefined, ip: ctx.ip },
        });
      });
    } catch (err) {
      this.log.error(`Could not audit ${action}: ${String(err)}`);
    }
  }
}
