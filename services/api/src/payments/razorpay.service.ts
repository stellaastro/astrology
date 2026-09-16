import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentOrder, PaymentsProvider } from './payments.provider';

const API_BASE = 'https://api.razorpay.com/v1';

/** Razorpay key prefixes. The distinction is the whole point of the guard below. */
const LIVE_PREFIX = 'rzp_live_';
const TEST_PREFIX = 'rzp_test_';

export class LiveKeyInDevelopmentError extends Error {}
export class TestKeyInProductionError extends Error {}

/**
 * Razorpay (task 7.1).
 *
 * ## The environment guard, which is the most important thing in this file
 *
 * A `rzp_live_` key charges real cards belonging to real people. This class
 * REFUSES TO CONSTRUCT with a live key under a development or review profile,
 * and refuses to construct with a test key under production.
 *
 * The first direction is the one that does damage. Every payment integration is
 * built by making it work locally first, and "make it work locally" with a live
 * key means the first successful test is a real charge on somebody's card, the
 * first bug is a real double charge, and the first cleanup is a real refund with
 * a gateway fee that is not returned. The failure is silent: a live key works
 * perfectly in development, which is exactly why nothing catches it.
 *
 * The second direction is cheaper — a test key in production simply fails to
 * take money — but a failure that looks like "payment declined" to every
 * customer is worth ten seconds of boot refusal too.
 *
 * Same posture as the `is_dev_fixture` boot guard: downtime over contaminated
 * data, and here the contamination would be somebody's bank statement.
 *
 * ## The app secret
 *
 * Used for two things and never sent anywhere except Razorpay: HTTP basic auth
 * on order creation, and the HMAC that verifies a webhook. `keyId` is public —
 * the browser checkout needs it — and the secret is not, so they are kept
 * visibly separate rather than bundled into one "credentials" object.
 */
/*
 * NOT @Injectable: this class is built by a factory in PaymentsModule, because
 * its constructor takes the environment and Nest would otherwise try to resolve
 * `NodeJS.ProcessEnv` as a provider and fail at boot.
 */
export class RazorpayService implements PaymentsProvider {
  private readonly log = new Logger(RazorpayService.name);

  readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.keyId = env.RAZORPAY_KEY_ID ?? '';
    this.keySecret = env.RAZORPAY_KEY_SECRET ?? '';
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? '';

    RazorpayService.guardKeyEnvironment(this.keyId, env.APP_ENV ?? 'development');

    if (!this.configured) {
      this.log.warn(
        'Razorpay is NOT configured — no order can be created and no booking ' +
          'can be confirmed. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and ' +
          'RAZORPAY_WEBHOOK_SECRET.',
      );
    }
  }

  /**
   * Refuses a key that does not belong in this environment.
   *
   * An UNPREFIXED key is allowed through: Razorpay has used other formats, and
   * refusing to boot over an unrecognised shape would be a guard that breaks
   * the site for a naming change. What is refused is a key that positively
   * identifies itself as belonging somewhere else.
   */
  static guardKeyEnvironment(keyId: string, appEnv: string): void {
    if (!keyId) return;
    const isProduction = appEnv === 'production';

    if (!isProduction && keyId.startsWith(LIVE_PREFIX)) {
      throw new LiveKeyInDevelopmentError(
        `RAZORPAY_KEY_ID is a LIVE key (${LIVE_PREFIX}…) and APP_ENV is ` +
          `"${appEnv}". A live key charges real cards. Refusing to start. Use ` +
          `an ${TEST_PREFIX} key from Dashboard → Settings → API Keys → Test Mode.`,
      );
    }
    if (isProduction && keyId.startsWith(TEST_PREFIX)) {
      throw new TestKeyInProductionError(
        `RAZORPAY_KEY_ID is a TEST key (${TEST_PREFIX}…) in production. Every ` +
          `payment would fail and it would look like the gateway was down. ` +
          `Refusing to start.`,
      );
    }
  }

  get configured(): boolean {
    return Boolean(this.keyId && this.keySecret && this.webhookSecret);
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<PaymentOrder> {
    if (!this.configured) {
      throw new ServiceUnavailableException('Payments are not configured on this server.');
    }
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new RangeError('An order amount must be a positive whole number of paise.');
    }

    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        // Razorpay is denominated in paise, so this is a pass-through rather
        // than a conversion — which is why Money is paise (see common/money.ts).
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        // The customer must not be charged before we know the booking is real,
        // so the payment is captured by us, not automatically by Razorpay.
        payment_capture: 0,
        notes: input.notes ?? {},
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      // The gateway's message, not ours: "payment failed" hides whether the
      // account is unactivated, the amount is below the minimum, or the
      // category is refused (owner action O6).
      this.log.error(`Razorpay order creation failed (${res.status}): ${body.slice(0, 500)}`);
      throw new ServiceUnavailableException('The payment gateway refused to create an order.');
    }

    const order = (await res.json()) as { id: string; amount: number; currency: string };
    return {
      orderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      keyId: this.keyId,
    };
  }

  /**
   * Captures an authorised payment.
   *
   * ALREADY-CAPTURED IS NOT AN ERROR. Razorpay returns BAD_REQUEST_ERROR with
   * a description saying the payment has already been captured, and a retried
   * webhook reaching this point is normal rather than exceptional — treating it
   * as a failure would leave a paid booking unconfirmed for ever. The money was
   * taken once either way; the gateway is the one enforcing that.
   */
  async capturePayment(paymentId: string, amountPaise: number): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException('Payments are not configured on this server.');
    }

    const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR' }),
    });

    if (res.ok) return;

    const body = await res.text();
    if (/already been captured/i.test(body)) {
      this.log.log(`Payment ${paymentId} was already captured; treating as success`);
      return;
    }
    this.log.error(`Razorpay capture failed for ${paymentId} (${res.status}): ${body.slice(0, 500)}`);
    throw new ServiceUnavailableException('The payment gateway refused to capture the payment.');
  }

  /**
   * HMAC-SHA256 of the RAW body under the webhook secret, compared in constant
   * time.
   *
   * Constant time because `===` on a hex digest leaks, byte by byte, how much
   * of a forged signature was right — which is enough to construct a valid one
   * given enough attempts. `timingSafeEqual` throws on a length mismatch, so
   * the lengths are checked first rather than letting that surface as a 500.
   */
  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret || !signature) return false;

    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    if (given.length !== expected.length) return false;
    return timingSafeEqual(expected, given);
  }
}
