import * as Sentry from '@sentry/node';
import { Logger } from '@nestjs/common';

/**
 * Error reporting.
 *
 * Called before the Nest app is created so that a crash during bootstrap is
 * still reported — a failure to start is exactly the kind that otherwise goes
 * unseen until someone visits the site.
 *
 * No DSN means Sentry stays off rather than throwing. The DSN is unprovisioned
 * (DECISION_LOG "Still open" #12), and an API that refuses to boot without an
 * optional observability vendor is worse than one running unmonitored.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  const log = new Logger('Sentry');

  if (!dsn) {
    log.warn('SENTRY_DSN not set — error reporting is OFF. Set it in .env.');
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unknown',
    // Low sample rate: this is a low-traffic booking system, and traces cost
    // money. Errors are always captured; only performance traces are sampled.
    tracesSampleRate: 0.1,

    /**
     * Last line of defence against credentials reaching a third party.
     * The primary control is not putting them in errors at all, but a
     * connection string in a Prisma error message is exactly the kind of thing
     * that ends up in a stack trace without anyone deciding it should.
     */
    beforeSend(event) {
      if (event.request?.headers) {
        for (const h of ['authorization', 'cookie', 'x-api-key']) {
          if (event.request.headers[h]) event.request.headers[h] = '[redacted]';
        }
      }
      const scrub = (s: string): string =>
        s
          .replace(/mysql:\/\/[^@\s]+@/gi, 'mysql://[redacted]@')
          .replace(/redis:\/\/[^@\s]+@/gi, 'redis://[redacted]@')
          .replace(/\b(rzp_(?:live|test)_[A-Za-z0-9]+)/g, '[redacted-razorpay-key]');

      if (event.message) event.message = scrub(event.message);
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrub(ex.value);
      }
      return event;
    },
  });

  log.log(`Error reporting enabled (${process.env.APP_ENV ?? 'unknown'})`);
  return true;
}

export { Sentry };
