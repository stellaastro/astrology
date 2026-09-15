import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface SessionUser {
  id: string;
  email: string;
  roles: string[];
  disabledAt: Date | null;
}

/** Eight hours. Long enough for a working day, short enough that a forgotten
 *  session on a shared machine expires the same day. */
const TTL_MS = 8 * 60 * 60 * 1000;

/** Rewriting last_seen_at on every request would be a write per page view. */
const TOUCH_AFTER_MS = 5 * 60 * 1000;

export const SESSION_COOKIE = 'stella_session';

/**
 * Server-side sessions (ADR-039, plan 3.2).
 *
 * THE REASON THIS IS A TABLE AND NOT A SIGNED TOKEN. A self-contained token is
 * valid until it expires, so disabling an account would not end a session that
 * is already open — the holder keeps their access until the clock runs out.
 * Revocation has to be a lookup against something the server can change. That
 * means a row, and it means one read per authenticated request. That read is
 * the feature, not the cost.
 *
 * ONLY THE HASH IS STORED. The cookie carries 32 random bytes; the table holds
 * their SHA-256. A dump of this table therefore does not let anyone resume a
 * session — the same reason a password column holds a hash.
 *
 * SHA-256 rather than scrypt here, deliberately: the token is already 256 bits
 * of entropy from a CSPRNG, so there is no guessing attack for a slow KDF to
 * frustrate, and this runs on every request.
 */
@Injectable()
export class SessionService {
  private readonly log = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Issues a session and returns the raw cookie value — the only time it exists. */
  async create(
    userId: string,
    ctx: { ip?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TTL_MS);

    await this.prisma.session.create({
      data: {
        tokenHash: SessionService.hash(token),
        userId,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 255) ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Resolves a cookie to a user, or null.
   *
   * Every rejection path returns the same null. A caller cannot tell "no such
   * session" from "revoked" from "account disabled", because the difference is
   * only useful to someone probing.
   */
  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;

    const row = await this.prisma.session.findUnique({
      where: { tokenHash: SessionService.hash(token) },
      include: { user: true },
    });

    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt <= new Date()) return null;
    // The whole point of the table: a disabled account loses access NOW, not
    // when its token happens to expire.
    if (row.user.disabledAt) return null;

    if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
      // Best-effort. Failing to record activity must not fail the request.
      this.prisma.session
        .update({ where: { tokenHash: row.tokenHash }, data: { lastSeenAt: new Date() } })
        .catch((e: unknown) => this.log.warn(`Could not touch session: ${String(e)}`));
    }

    return {
      id: row.user.id,
      email: row.user.email,
      roles: Array.isArray(row.user.roles) ? (row.user.roles as string[]) : [],
      disabledAt: row.user.disabledAt,
    };
  }

  /** Ends one session. Idempotent: signing out twice is not an error. */
  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: SessionService.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Ends every session for a user — password change, or a suspected theft. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) this.log.log(`Revoked ${count} session(s) for user ${userId}`);
    return count;
  }

  /**
   * Removes rows well past expiry. Called by the scheduler.
   *
   * Kept for a week after expiry rather than deleted at once, so "when did that
   * session end" stays answerable during an investigation.
   */
  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  }

  /** Constant-time compare, for callers checking a token they already hold. */
  static sameToken(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
