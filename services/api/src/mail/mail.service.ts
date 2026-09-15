import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Outbound email.
 *
 * Deliberately thin: one transport, one send method, no templating engine. The
 * only mail this system sends today is a waitlist confirmation.
 *
 * WHY IT THROWS RATHER THAN SWALLOWING. Every caller is an outbox handler, and
 * the outbox retries on a thrown error and parks after MAX_ATTEMPTS. A mailer
 * that logged and returned would mark the message processed, and the lead would
 * wait forever for an email nobody knows was never sent. Failing loudly is what
 * makes the retry work.
 *
 * KNOWN LIMIT: this goes through Gmail SMTP, which caps near 500 messages a day
 * and carries no deliverability reputation of its own. Fine for a waitlist at
 * roster 3; task 2.15 replaces it with a transactional provider plus
 * SPF/DKIM/DMARC before any real volume.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private transport?: Transporter;

  /** True when SMTP is configured well enough to attempt a send. */
  get configured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  }

  private getTransport(): Transporter {
    if (this.transport) return this.transport;

    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transport = createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this wrong
      // fails as a timeout rather than a clear error, so it is derived from the
      // port instead of being configured separately.
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER as string,
        pass: process.env.SMTP_PASSWORD as string,
      },
    });
    return this.transport;
  }

  /**
   * Sends one message.
   *
   * @throws when SMTP is unconfigured or the send fails — see the class note.
   */
  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!this.configured) {
      throw new Error(
        'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD). Refusing to ' +
          'silently drop mail — the outbox will retry and then park this message.',
      );
    }

    const from = process.env.MAIL_FROM ?? process.env.SMTP_USER;
    /*
     * html is OPTIONAL. The privacy emails are deliberately plain text: they
     * carry a one-time link to someone who may not have asked for it, and a
     * plain-text message has no remote images to load, nothing to mis-render,
     * and no way to disguise where the link goes.
     */
    const info = await this.getTransport().sendMail({
      from, to, subject, text,
      ...(html ? { html } : {}),
    });

    // The recipient is deliberately NOT logged. It is the personal data this
    // system exists to protect, and a message id is enough to trace a delivery.
    this.log.log(`Sent "${subject}" (messageId=${info.messageId})`);
  }
}
