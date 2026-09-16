/**
 * The payments seam (ADR-023: Razorpay per-booking, paid at booking).
 *
 * Everything the rest of the system knows about a payment gateway lives here,
 * for the same reason `RealtimeProvider` exists: swapping provider, or refusing
 * to configure one, must not require touching booking code.
 */

export interface PaymentOrder {
  /** The gateway's order id. Given to the browser; it is not a secret. */
  orderId: string;
  amountPaise: number;
  currency: string;
  /** The PUBLIC key id the checkout script needs. Never the secret. */
  keyId: string;
}

export interface PaymentsProvider {
  /** Whether usable credentials are configured at all. */
  readonly configured: boolean;

  /** The public key id, for the browser checkout. */
  readonly keyId: string;

  /**
   * Creates an order the customer can pay against.
   *
   * `receipt` is our booking id. It is the only thread tying the gateway's
   * record to ours, and it travels back on the webhook.
   */
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<PaymentOrder>;

  /**
   * Takes an AUTHORISED payment.
   *
   * Orders are created with auto-capture off, so an authorised payment is money
   * reserved rather than money taken. This is the step that actually charges,
   * and it is deliberately a separate decision the server makes after checking
   * the slot is still ours.
   *
   * The amount is passed again and the gateway checks it: capturing a different
   * amount than was authorised must fail at Razorpay, not only here.
   */
  capturePayment(paymentId: string, amountPaise: number): Promise<void>;

  /**
   * Verifies a webhook came from the gateway.
   *
   * Takes the RAW BODY. Re-serialising parsed JSON changes whitespace and key
   * order, so the signature stops matching for reasons that have nothing to do
   * with authenticity — and the usual response to that is to stop checking.
   */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

export const PAYMENTS_PROVIDER = Symbol('PAYMENTS_PROVIDER');
