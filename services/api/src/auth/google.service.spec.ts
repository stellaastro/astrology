import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { GoogleService } from './google.service';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

describe('GoogleService', () => {
  let svc: GoogleService;
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.test/api/v1/auth/google/callback';
    svc = new GoogleService();
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reports whether it is configured', () => {
    expect(svc.configured).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(new GoogleService().configured).toBe(false);
  });

  it('refuses to start when unconfigured rather than building a broken url', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => new GoogleService().start()).toThrow();
  });

  describe('start()', () => {
    it('asks for an authorization code with openid scope', () => {
      const { url } = svc.start();
      const p = new URL(url).searchParams;
      expect(p.get('response_type')).toBe('code');
      expect(p.get('client_id')).toBe(CLIENT_ID);
      expect(p.get('scope')).toContain('openid');
      expect(p.get('scope')).toContain('email');
    });

    /** PKCE: the challenge must be the SHA-256 of the verifier, not the
     *  verifier itself — sending the verifier would defeat the point. */
    it('sends S256 of the verifier, never the verifier', () => {
      const { url, verifier } = svc.start();
      const p = new URL(url).searchParams;
      const expected = createHash('sha256').update(verifier).digest('base64url');
      expect(p.get('code_challenge_method')).toBe('S256');
      expect(p.get('code_challenge')).toBe(expected);
      expect(url).not.toContain(verifier);
    });

    it('mints a fresh state and verifier every time', () => {
      const a = svc.start();
      const b = svc.start();
      expect(a.state).not.toBe(b.state);
      expect(a.verifier).not.toBe(b.verifier);
    });

    it('uses enough entropy for state and verifier to be unguessable', () => {
      const { state, verifier } = svc.start();
      expect(state.length).toBeGreaterThanOrEqual(32);
      expect(verifier.length).toBeGreaterThanOrEqual(43);
    });

    /** Asking for offline access would hand us a refresh token we would then
     *  have to store and protect, for an identity we only need once. */
    it('does not request offline access', () => {
      expect(new URL(svc.start().url).searchParams.get('access_type')).toBe('online');
    });
  });

  describe('id token claims', () => {
    const encode = (claims: Record<string, unknown>) =>
      `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

    const read = (claims: Record<string, unknown>) =>
      (svc as unknown as { readIdToken(t: string): unknown }).readIdToken(encode(claims));

    const valid = {
      aud: CLIENT_ID,
      iss: 'https://accounts.google.com',
      sub: '1234567890',
      email: 'Person@Example.com',
      email_verified: true,
      name: 'A Person',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    it('accepts a well-formed token and lowercases the address', () => {
      expect(read(valid)).toEqual({
        sub: '1234567890',
        email: 'person@example.com',
        emailVerified: true,
        name: 'A Person',
      });
    });

    /** A token minted for a different client is a real confusion attack. */
    it('rejects a token issued for another client', () => {
      expect(() => read({ ...valid, aud: 'someone-elses-client' })).toThrow();
    });

    it('rejects an unexpected issuer', () => {
      expect(() => read({ ...valid, iss: 'https://evil.example' })).toThrow();
    });

    it('rejects an expired token', () => {
      expect(() => read({ ...valid, exp: Math.floor(Date.now() / 1000) - 10 })).toThrow();
    });

    /**
     * An unverified address is one somebody merely typed. Accepting it would
     * let anyone claim another person's account by signing up with it.
     */
    it('rejects an unverified email address', () => {
      expect(() => read({ ...valid, email_verified: false })).toThrow();
      expect(() => read({ ...valid, email_verified: 'true' })).toThrow();
    });

    it('rejects a token with no subject or no email', () => {
      expect(() => read({ ...valid, sub: '' })).toThrow();
      expect(() => read({ ...valid, email: '' })).toThrow();
    });

    it('rejects a malformed token rather than crashing', () => {
      const s = svc as unknown as { readIdToken(t: string): unknown };
      expect(() => s.readIdToken('nonsense')).toThrow();
      expect(() => s.readIdToken('a.!!!notbase64!!!.c')).toThrow();
    });
  });
});
