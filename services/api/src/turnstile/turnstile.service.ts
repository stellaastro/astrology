import { Injectable, Logger } from '@nestjs/common';

export type TurnstileOutcome =
  | { verdict: 'pass' }
  | { verdict: 'fail'; reason: string }
  | { verdict: 'degraded'; reason: string };

const TIMEOUT_MS = 4000;
const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile bot check.
 *
 * DEGRADES OPEN, and that is the whole design decision.
 *
 * If Cloudflare is slow or down, the choice is: reject every signup, or accept
 * them and mark which ones were unverified. Rejecting means a third party's
 * outage takes down the only signup path on a site whose entire traffic comes
 * from three directors sharing a link — a bot-check failure would cost more
 * than the bots it stops. So a `degraded` outcome still creates the lead, with
 * `turnstileBypassed = true` so those rows can be reviewed later.
 *
 * A genuine `fail` (Cloudflare answered, and said no) is still rejected. The
 * distinction is between "the guard said no" and "the guard did not answer".
 *
 * With no secret configured the service returns `degraded` rather than
 * pretending to verify. An unconfigured bot check that silently reports success
 * is worse than none, because nobody notices it is not working.
 */
@Injectable()
export class TurnstileService {
  private readonly log = new Logger(TurnstileService.name);

  async verify(token: string | undefined, remoteIp?: string): Promise<TurnstileOutcome> {
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

    if (!secret) {
      this.log.warn('TURNSTILE_SECRET_KEY not set — bot check is not running');
      return { verdict: 'degraded', reason: 'not_configured' };
    }
    if (!token) {
      // A missing token with a configured secret means the widget did not run:
      // an ad blocker, a script error, or a scripted request. Not conclusive
      // enough to reject a real person over.
      return { verdict: 'degraded', reason: 'missing_token' };
    }

    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        this.log.warn(`Turnstile returned HTTP ${res.status} — degrading open`);
        return { verdict: 'degraded', reason: `http_${res.status}` };
      }

      const data = (await res.json()) as {
        success?: boolean;
        'error-codes'?: string[];
      };

      if (data.success) return { verdict: 'pass' };

      const codes = data['error-codes'] ?? [];
      // These mean OUR configuration is broken, not that the visitor failed.
      // Rejecting a real person because we shipped a bad secret is the wrong
      // way round.
      const ourFault = ['invalid-input-secret', 'missing-input-secret', 'internal-error'];
      if (codes.some((c) => ourFault.includes(c))) {
        this.log.error(`Turnstile rejected OUR credentials: ${codes.join(', ')}`);
        return { verdict: 'degraded', reason: codes.join(',') };
      }

      return { verdict: 'fail', reason: codes.join(',') || 'unsuccessful' };
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'unreachable';
      this.log.warn(`Turnstile ${reason} — degrading open`);
      return { verdict: 'degraded', reason };
    }
  }
}
