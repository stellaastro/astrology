import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { HmsService } from './hms.service';

/**
 * Token minting only — no network. What matters here is what ends up INSIDE a
 * token handed to a browser, because the app secret can mint a moderator token
 * for any room on the account.
 */
const SECRET = 'test-secret-not-a-real-one';
const decode = (t: string) => JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString());

describe('HmsService token minting', () => {
  const saved = { ...process.env };
  let svc: HmsService;

  beforeEach(() => {
    process.env.HMS_APP_KEY = 'test-key';
    process.env.HMS_APP_SECRET = SECRET;
    process.env.HMS_TEMPLATE_ID = 'test-template';
    delete process.env.HMS_ROLE_ASTROLOGER;
    delete process.env.HMS_ROLE_CUSTOMER;
    svc = new HmsService();
  });
  afterEach(() => { process.env = { ...saved }; });

  it('reports configured only when all three are set', () => {
    expect(svc.configured).toBe(true);
    delete process.env.HMS_APP_SECRET;
    expect(new HmsService().configured).toBe(false);
  });

  it('refuses to mint when unconfigured rather than producing a broken token', async () => {
    delete process.env.HMS_APP_SECRET;
    await expect(
      new HmsService().joinToken({ roomId: 'r', userId: 'u', role: 'customer' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('scopes a token to one room, one user and one role', async () => {
    const { token } = await svc.joinToken({ roomId: 'room-1', userId: 'user-1', role: 'customer' });
    const p = decode(token);
    expect(p.room_id).toBe('room-1');
    expect(p.user_id).toBe('user-1');
    expect(p.type).toBe('app');
  });

  it('NEVER puts the app secret in the token', async () => {
    const { token } = await svc.joinToken({ roomId: 'r', userId: 'u', role: 'customer' });
    // The secret can mint a moderator token for any room on the account.
    expect(token).not.toContain(SECRET);
    expect(JSON.stringify(decode(token))).not.toContain(SECRET);
  });

  it('mints an APP token for joining, not a management token', async () => {
    const { token } = await svc.joinToken({ roomId: 'r', userId: 'u', role: 'astrologer' });
    // A management token in a browser would let the holder create and destroy
    // rooms across the whole account.
    expect(decode(token).type).toBe('app');
    expect(decode(token).type).not.toBe('management');
  });

  it('signs with HS256 over the secret, verifiably', async () => {
    const { token } = await svc.joinToken({ roomId: 'r', userId: 'u', role: 'customer' });
    const [h, p, sig] = token.split('.');
    expect(createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')).toBe(sig);
  });

  it('expires, and not in days', async () => {
    const { token, expiresIn } = await svc.joinToken({ roomId: 'r', userId: 'u', role: 'customer' });
    const p = decode(token);
    expect(p.exp).toBeGreaterThan(p.iat);
    // Long enough for a consultation plus a reconnect; short enough that a
    // leaked link stops working the same day.
    expect(expiresIn).toBeLessThanOrEqual(6 * 60 * 60);
  });

  it('defaults BOTH sides to a role that can speak', async () => {
    const a = decode((await svc.joinToken({ roomId: 'r', userId: 'u', role: 'astrologer' })).token);
    const c = decode((await svc.joinToken({ roomId: 'r', userId: 'v', role: 'customer' })).token);
    // The account's template ships with listener/moderator/speaker. A customer
    // given `listener` would sit mute through the reading they paid for.
    expect(a.role).toBe('speaker');
    expect(c.role).toBe('speaker');
  });

  it('lets the template roles be corrected without a code change', async () => {
    process.env.HMS_ROLE_ASTROLOGER = 'host';
    process.env.HMS_ROLE_CUSTOMER = 'guest';
    const s = new HmsService();
    expect(decode((await s.joinToken({ roomId: 'r', userId: 'u', role: 'astrologer' })).token).role).toBe('host');
    expect(decode((await s.joinToken({ roomId: 'r', userId: 'u', role: 'customer' })).token).role).toBe('guest');
  });

  it('gives every token a unique id', async () => {
    const a = decode((await svc.joinToken({ roomId: 'r', userId: 'u', role: 'customer' })).token);
    const b = decode((await svc.joinToken({ roomId: 'r', userId: 'u', role: 'customer' })).token);
    expect(a.jti).not.toBe(b.jti);
  });
});
