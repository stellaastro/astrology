import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string | undefined;
}

/**
 * Google sign-in (ADR-037), spoken directly rather than through Firebase.
 *
 * The flow is authorization-code + PKCE:
 *
 *   1. `start()` mints a random `state` and a PKCE `verifier`, and returns the
 *      URL to send the browser to. Both are stored in httpOnly cookies by the
 *      controller — never in a database, because they live for seconds.
 *   2. Google redirects back with a one-time `code`.
 *   3. `exchange()` swaps that code for tokens over TLS, using our client
 *      secret AND the verifier.
 *
 * WHY BOTH state AND PKCE. `state` stops CSRF: without it, an attacker can feed
 * a victim their own `code` and log the victim into the ATTACKER's account.
 * PKCE stops an intercepted code being redeemed by anyone who did not start the
 * flow. They defend different things; neither replaces the other.
 */
@Injectable()
export class GoogleService {
  private readonly log = new Logger(GoogleService.name);

  get configured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  private redirectUri(): string {
    return (
      process.env.GOOGLE_REDIRECT_URI ??
      `${(process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')}/api/v1/auth/google/callback`
    );
  }

  /** Begins a flow. Returns the URL plus the two secrets the callback needs. */
  start(): { url: string; state: string; verifier: string } {
    if (!this.configured) {
      throw new UnauthorizedException('Google sign-in is not configured.');
    }

    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // We want an identity, not an ongoing grant: no refresh token, and no
      // offline access to store and later have to protect.
      access_type: 'online',
      prompt: 'select_account',
    });

    return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, verifier };
  }

  /** Exchanges the one-time code for an identity. */
  async exchange(code: string, verifier: string): Promise<GoogleIdentity> {
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Google's error body can name the client id; log the status only.
      this.log.warn(`Google token exchange failed: ${res.status}`);
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }

    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) throw new UnauthorizedException('Could not complete Google sign-in.');

    return this.readIdToken(json.id_token);
  }

  /**
   * Reads the ID token.
   *
   * SIGNATURE VERIFICATION IS DELIBERATELY OMITTED, and this is the one place
   * that is sound: the token did not arrive from the browser. We fetched it
   * ourselves from Google's token endpoint over TLS, authenticated with our
   * client secret. There is no untrusted party in that path to forge it, which
   * is why Google's own documentation permits skipping validation for tokens
   * received directly from this endpoint.
   *
   * `aud` and `iss` are still checked, because a token minted for a DIFFERENT
   * client is a real confusion attack, and the check costs nothing.
   */
  private readIdToken(idToken: string): GoogleIdentity {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Could not complete Google sign-in.');

    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(parts[1] as string, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }

    if (claims.aud !== process.env.GOOGLE_CLIENT_ID) {
      this.log.warn('Google ID token audience did not match this client');
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }
    if (typeof claims.iss !== 'string' || !VALID_ISSUERS.includes(claims.iss)) {
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('Could not complete Google sign-in.');
    }

    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!sub || !email) throw new UnauthorizedException('Could not complete Google sign-in.');

    // An unverified address is one someone merely typed. Accepting it would let
    // anyone claim another person's account by signing up with their address.
    if (claims.email_verified !== true) {
      throw new UnauthorizedException('Your Google account email is not verified.');
    }

    return {
      sub,
      email,
      emailVerified: true,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    };
  }
}
