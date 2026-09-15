import { Module, Logger, type OnModuleInit } from '@nestjs/common';
import { MailService } from './mail.service';
import { leadConfirmation } from './lead-confirmation';
import { privacyVerification } from './privacy-verification';
import { OutboxService } from '../outbox/outbox.service';

/** Shape of the payload leads.service enqueues on 'lead.confirm'. */
interface LeadConfirmPayload {
  leadId: string;
  email: string;
  locale: string;
  token: string;
}

function isLeadConfirmPayload(v: unknown): v is LeadConfirmPayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.email === 'string' && typeof p.token === 'string';
}

/**
 * Registers the outbox handler that actually sends the waitlist confirmation.
 *
 * This is the half that was missing. `leads.service` has always enqueued a
 * 'lead.confirm' message inside the signup transaction, but no handler was
 * registered for that topic — so the outbox logged "no handler" every ten
 * seconds while the API told every visitor to check an email that was never
 * sent. The endpoint was live and honest-looking, and the promise was false.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule implements OnModuleInit {
  private readonly log = new Logger(MailModule.name);

  constructor(
    private readonly mail: MailService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.outbox.register('lead.confirm', async (payload) => {
      if (!isLeadConfirmPayload(payload)) {
        // Throw, so the outbox retries and then parks it. A malformed payload
        // is a bug worth seeing, not a message to quietly drop.
        throw new Error('lead.confirm payload is missing email or token');
      }

      const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
      const prefix = process.env.API_GLOBAL_PREFIX ?? 'api/v1';
      // Points at the WEB confirmation page, not the API endpoint. Clicking a
      // link in an email and getting raw JSON back is not a confirmation
      // experience; the page calls the API and says what happened.
      const url = `${base}/confirm?token=${encodeURIComponent(payload.token)}`;
      void prefix;

      const { subject, text, html } = leadConfirmation(url, payload.locale ?? 'en');
      await this.mail.send(payload.email, subject, text, html);
    });

    /** DPDP access and erasure verification (ADR-040). */
    this.outbox.register('privacy.verify', async (payload) => {
      const p = payload as { email?: unknown; kind?: unknown; token?: unknown };
      if (
        typeof p.email !== 'string' ||
        typeof p.token !== 'string' ||
        (p.kind !== 'access' && p.kind !== 'erasure')
      ) {
        // Throw so the outbox retries and parks it. Silently dropping a
        // statutory request is the one failure mode this must not have.
        throw new Error('privacy.verify payload is missing email, kind or token');
      }

      const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
      const { subject, text } = privacyVerification({
        email: p.email,
        kind: p.kind,
        token: p.token,
        baseUrl: base,
      });
      await this.mail.send(p.email, subject, text);
    });

    this.log.log(
      this.mail.configured
        ? 'Registered outbox handlers for "lead.confirm" and "privacy.verify"'
        : 'Registered outbox handlers for "lead.confirm" and "privacy.verify" — but SMTP ' +
            'is NOT configured, so both will retry and park rather than send.',
    );
  }
}
