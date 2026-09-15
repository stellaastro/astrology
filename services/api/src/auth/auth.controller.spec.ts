import { describe, it, expect, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { SessionService } from './session.service';
import type { AuthService } from './auth.service';
import type { GoogleService } from './google.service';

/**
 * Where Google sign-in is allowed to send you afterwards.
 *
 * The threat is the open redirect: `?next=https://evil.test` landing on a real
 * stellaastro.com URL that bounces the victim somewhere else, which is a
 * credible phishing primitive precisely because the first hop is genuine.
 *
 * The defence is that the parameter is a KEY, not a URL — so these tests are
 * mostly a list of payloads that each have to come back as '/'.
 */

/** Minimal Express Response double: records cookies and the final redirect. */
function makeRes() {
  const cookies: Record<string, string> = {};
  const cleared: string[] = [];
  return {
    cookies,
    cleared,
    location: undefined as string | undefined,
    cookie(name: string, value: string) {
      cookies[name] = value;
      return this;
    },
    clearCookie(name: string) {
      cleared.push(name);
      return this;
    },
    redirect(_status: number, url: string) {
      this.location = url;
      return this;
    },
  };
}

const STATE = 'state-value-aaaaaaaaaaaaaaaaaaaa';
const VERIFIER = 'verifier-value-bbbbbbbbbbbbbbbb';

function makeController(): AuthController {
  const google = {
    start: () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', state: STATE, verifier: VERIFIER }),
    exchange: vi.fn(async () => ({ sub: 'g-1', email: 'someone@example.test', emailVerified: true })),
  } as unknown as GoogleService;

  const auth = {
    loginWithGoogle: vi.fn(async () => ({
      token: 'session-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    })),
  } as unknown as AuthService;

  return new AuthController(auth, google);
}

/** Runs a full start→callback flow and returns where the browser ends up. */
async function flow(next: string | undefined): Promise<string | undefined> {
  const c = makeController();

  const startRes = makeRes();
  c.googleStart(startRes as never, next);

  // Only cookies the start step actually set are presented back, exactly as a
  // browser would — so a rejected `next` is genuinely absent, not just ignored.
  const req = {
    cookies: startRes.cookies,
    ip: '203.0.113.5',
    get: () => 'test-agent',
  };

  const cbRes = makeRes();
  await c.googleCallback(req as never, cbRes as never, 'auth-code', STATE, undefined);
  return cbRes.location;
}

describe('Google sign-in return destination', () => {
  it('returns to /admin when sign-in started there', async () => {
    expect(await flow('admin')).toBe('/admin');
  });

  it('returns to the landing page by default', async () => {
    expect(await flow(undefined)).toBe('/?signin=ok');
  });

  it.each([
    ['an absolute URL', 'https://evil.test'],
    ['a protocol-relative URL', '//evil.test'],
    ['a backslash variant', '/\\evil.test'],
    ['userinfo smuggling', 'https://stellaastro.com@evil.test'],
    ['a path that exists', '/admin'],
    ['an unknown key', 'dashboard'],
    ['prototype pollution via __proto__', '__proto__'],
    ['prototype pollution via constructor', 'constructor'],
    ['an empty string', ''],
  ])('refuses %s and lands on the default page', async (_label, payload) => {
    const landed = await flow(payload);
    expect(landed).toBe('/?signin=ok');
    // The payload must not appear anywhere in the destination, in any form.
    expect(landed).not.toContain('evil.test');
  });

  it('never stores a rejected next value in a cookie', () => {
    const c = makeController();
    const res = makeRes();
    c.googleStart(res as never, 'https://evil.test');
    expect(res.cookies['stella_oauth_next']).toBeUndefined();
  });

  it('clears the destination cookie so it cannot leak into a later flow', async () => {
    const c = makeController();
    const startRes = makeRes();
    c.googleStart(startRes as never, 'admin');

    const cbRes = makeRes();
    await c.googleCallback(
      { cookies: startRes.cookies, ip: '203.0.113.5', get: () => 'test-agent' } as never,
      cbRes as never,
      'auth-code',
      STATE,
      undefined,
    );
    expect(cbRes.cleared).toContain('stella_oauth_next');
  });

  it('still rejects a mismatched state even with a valid destination', async () => {
    const c = makeController();
    const startRes = makeRes();
    c.googleStart(startRes as never, 'admin');

    await expect(
      c.googleCallback(
        { cookies: startRes.cookies, ip: '203.0.113.5', get: () => 'test-agent' } as never,
        makeRes() as never,
        'auth-code',
        'a-different-state-value-cccccccc', // attacker-supplied
        undefined,
      ),
    ).rejects.toThrow(/Could not complete Google sign-in/);
  });

  it('uses a constant-time comparison for state', () => {
    // Guards the CSRF defence itself: a plain === here would be the bug.
    expect(SessionService.sameToken(STATE, STATE)).toBe(true);
    expect(SessionService.sameToken(STATE, 'x')).toBe(false);
  });
});
