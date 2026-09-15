import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type {
  JoinToken, RealtimeProvider, RealtimeRole, RealtimeRoom,
} from './realtime.provider';

const API = 'https://api.100ms.live/v2';

/** A management token is used once, immediately. Five minutes is generous. */
const MANAGEMENT_TTL_SECONDS = 300;

/**
 * A join token has to outlast a consultation plus a reconnect, and no longer.
 * A token that lives for days is a link into someone's session that keeps
 * working long after they have left.
 */
const JOIN_TTL_SECONDS = 4 * 60 * 60;

/**
 * 100ms, via the REST API (ADR-047).
 *
 * TWO THINGS THE ACCOUNT'S EXISTING SETUP GOT WRONG, both deliberately not
 * inherited here:
 *
 * 1. THERE WAS ONE SHARED ROOM. A consultation marketplace needs a room per
 *    booking. With one room, two concurrent consultations put four people in
 *    the same call — a customer would hear someone else's reading, which is
 *    both a privacy breach and the single most embarrassing possible bug.
 *    `createRoom` is called per consultation.
 *
 * 2. THE STORED STATIC TOKEN HAD EXPIRED (2026-09-12) and could not have
 *    worked. Tokens are minted here, per request, from the app key and secret.
 *    A long-lived token checked into a config file is a credential with no
 *    revocation story.
 *
 * The app secret NEVER reaches a browser. It can mint a moderator token for any
 * room on the account, so it stays on the server and the client receives only a
 * short-lived token scoped to one room and one role.
 */
@Injectable()
export class HmsService implements RealtimeProvider {
  private readonly log = new Logger(HmsService.name);

  get configured(): boolean {
    return Boolean(process.env.HMS_APP_KEY && process.env.HMS_APP_SECRET && process.env.HMS_TEMPLATE_ID);
  }

  private secret(): { key: string; secret: string; templateId: string } {
    const key = process.env.HMS_APP_KEY ?? '';
    const secret = process.env.HMS_APP_SECRET ?? '';
    const templateId = process.env.HMS_TEMPLATE_ID ?? '';
    if (!key || !secret || !templateId) {
      // Throw rather than degrade: a consultation that silently has no room is
      // worse than one that fails loudly before anyone dials in.
      throw new ServiceUnavailableException(
        'Video is not configured (HMS_APP_KEY / HMS_APP_SECRET / HMS_TEMPLATE_ID).',
      );
    }
    return { key, secret, templateId };
  }

  private static sign(payload: Record<string, unknown>, secret: string): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const header = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64(payload);
    const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  /** Short-lived, minted per call, never stored. */
  private managementToken(): string {
    const { key, secret } = this.secret();
    const now = Math.floor(Date.now() / 1000);
    return HmsService.sign(
      {
        access_key: key,
        type: 'management',
        version: 2,
        jti: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + MANAGEMENT_TTL_SECONDS,
      },
      secret,
    );
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${this.managementToken()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // The provider's own message is the useful part; a generic "video failed"
      // sends someone to check the wrong thing.
      throw new ServiceUnavailableException(
        `100ms ${init.method ?? 'GET'} ${path} returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }

  async createRoom(name: string, description?: string): Promise<RealtimeRoom> {
    const { templateId } = this.secret();
    const room = await this.call<{ id: string }>('/rooms', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: description ?? '',
        template_id: templateId,
      }),
    });
    this.log.log(`Created 100ms room ${room.id} for ${name}`);
    return { roomId: room.id };
  }

  /**
   * A join token for one person, one room, one role.
   *
   * ROLE MAPPING. The account's template ships with the default 100ms roles
   * (listener, moderator, speaker) — a demo template, not one designed for a
   * consultation. `listener` cannot speak, so a customer given that role would
   * sit mute through a reading they paid for.
   *
   * The mapping is therefore explicit and overridable, so the template can be
   * fixed without a code change. Both sides default to `speaker`: in a 1:1
   * reading both people talk, and the failure mode of guessing wrong here is a
   * silent customer.
   */
  async joinToken(input: { roomId: string; userId: string; role: RealtimeRole }): Promise<JoinToken> {
    const { key, secret } = this.secret();
    const role =
      input.role === 'astrologer'
        ? (process.env.HMS_ROLE_ASTROLOGER ?? 'speaker')
        : (process.env.HMS_ROLE_CUSTOMER ?? 'speaker');

    const now = Math.floor(Date.now() / 1000);
    const token = HmsService.sign(
      {
        access_key: key,
        room_id: input.roomId,
        user_id: input.userId,
        role,
        type: 'app',
        version: 2,
        jti: randomUUID(),
        iat: now,
        nbf: now,
        exp: now + JOIN_TTL_SECONDS,
      },
      secret,
    );
    return { token, expiresIn: JOIN_TTL_SECONDS };
  }

  /** A closed room is a link that stops working when the consultation ends. */
  async disableRoom(roomId: string): Promise<void> {
    await this.call(`/rooms/${roomId}`, {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    this.log.log(`Disabled 100ms room ${roomId}`);
  }
}
