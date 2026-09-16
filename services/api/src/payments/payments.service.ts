import {
  Inject, Injectable, Logger,
  BadRequestException, ConflictException,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BookingsService } from '../bookings/bookings.service';
import { PAYMENTS_PROVIDER, type PaymentsProvider } from './payments.provider';
import { splitInclusive, taxConfigFromEnv } from './tax';

/** The events we act on. Everything else is acknowledged and ignored. */
const AUTHORIZED = 'payment.authorized';
const FAILED = 'payment.failed';

/**
 * Payments (tasks 7.1, 7.2).
 *
 * ## The flow, and why it authorises before it captures
 *
 *     hold ──create order──▶ customer pays ──▶ payment.authorized
 *                                                    │
 *                              booking still held? ──┴── no ──▶ DO NOT CAPTURE
 *                                     │                         (authorisation
 *                                    yes                          lapses; the
 *                                     ▼                           customer is
 *                            capture ──▶ confirm                  never charged)
 *
 * Razorpay orders are created with `payment_capture: 0`, so an authorised
 * payment is money reserved, not money taken. That matters because a hold can
 * lapse while the customer is in their banking app: with auto-capture the
 * outcome is "charged, then refunded, minus a gateway fee that is not
 * returned"; without it the outcome is "never charged". The second is better
 * for the customer and cheaper for Stella, and the difference is one flag.
 *
 * It is also the mechanism ADR-052 needs for chat, where the authorised amount
 * is a ceiling and the captured amount comes from the meter.
 *
 * ## What is never trusted
 *
 * The webhook's amount is checked against the price WE froze, and a mismatch
 * refuses rather than reconciles. The server is authoritative for payment
 * success (§78); a webhook is an assertion by a third party, verified by
 * signature and then still checked against our own record.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly bookings: BookingsService,
    @Inject(PAYMENTS_PROVIDER) private readonly gateway: PaymentsProvider,
  ) {}

  /**
   * The tax split for a price, or a refusal naming what the CA has not answered.
   *
   * REFUSING IS THE POINT. Under pay-at-booking the invoice is issued at
   * booking, so a made-up rate would be a wrong GST figure on a real invoice —
   * a filing problem, not a bug, and one that cannot be corrected on a paid row
   * (§79). Owner action O6.
   */
  private taxFor(pricePaise: number) {
    const cfg = taxConfigFromEnv();
    if ('missing' in cfg) {
      throw new ServiceUnavailableException(
        `Payments are not configured: ${cfg.missing.join(', ')} unset. The rate, ` +
          `SAC code and place of supply are the CA's answer (owner action O6), ` +
          `not a default — an invented tax split on a real invoice is a filing ` +
          `problem.`,
      );
    }
    return splitInclusive(pricePaise, cfg.config);
  }

  /**
   * Creates the Razorpay order a customer pays against.
   *
   * Returns the PUBLIC key id and order id; the browser needs both and neither
   * is a secret. The key secret never leaves the server.
   */
  async createOrder(bookingId: string, customerId: string, actor: AuditActor) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.customerId !== customerId) {
      // NOT FOUND rather than FORBIDDEN: 403 would confirm the booking exists,
      // turning an id into an oracle.
      throw new NotFoundException('No such booking.');
    }
    if (booking.status !== 'held') {
      throw new ConflictException(
        `This booking is "${booking.status}" and cannot be paid for. Book the slot again.`,
      );
    }
    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < Date.now()) {
      // Refusing to START a payment against a lapsed hold is cheap. Refusing to
      // FINISH one is not, which is why confirm() deliberately does the
      // opposite once money is in flight.
      throw new ConflictException('This hold has expired. Book the slot again.');
    }

    // Computed before the gateway call so an unanswered O6 refuses without
    // creating an orphan order on Razorpay's side.
    this.taxFor(booking.pricePaise);

    // An order already exists: hand the same one back rather than creating a
    // second. Two orders for one booking is two ways to pay for it.
    if (booking.razorpayOrderId) {
      return {
        orderId: booking.razorpayOrderId,
        amountPaise: booking.pricePaise,
        currency: 'INR',
        keyId: this.gateway.keyId,
        bookingId,
      };
    }

    const order = await this.gateway.createOrder({
      amountPaise: booking.pricePaise,
      receipt: bookingId,
      notes: { bookingId, astrologerId: booking.astrologerId },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { razorpayOrderId: order.orderId },
      });
      await this.audit.record(tx, {
        action: 'payment.order.created',
        targetType: 'Booking',
        targetId: bookingId,
        after: { orderId: order.orderId, amountPaise: booking.pricePaise },
        actor,
      });
    });

    return { ...order, bookingId };
  }

  /**
   * Handles a Razorpay webhook.
   *
   * ORDER OF OPERATIONS IS THE SECURITY PROPERTY:
   *
   *   1. verify the signature over the RAW body — before parsing, before
   *      looking anything up, before touching the database. An unsigned webhook
   *      is not a message, it is an attacker's request, and a forged
   *      `payment.authorized` would confirm a booking nobody paid for.
   *   2. deduplicate on the gateway's event id. Gateways retry.
   *   3. only then act.
   *
   * Sandbox webhooks get all three, identically. A sandbox webhook trusted
   * because it is "only a test" is how the live one gets trusted too.
   */
  async handleWebhook(rawBody: Buffer, signature: string, eventId: string) {
    if (!this.gateway.verifyWebhook(rawBody, signature)) {
      this.log.warn('Rejected a webhook with an invalid signature');
      // 400, not 401: there is no authentication to retry, and Razorpay treats
      // a 4xx as "do not redeliver", which is right for a message we will never
      // accept.
      throw new BadRequestException('Invalid signature.');
    }
    if (!eventId) throw new BadRequestException('Missing event id.');

    let event: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Body is not JSON.');
    }

    const result = await this.idempotency.run(
      'razorpay.webhook',
      eventId,
      // The RAW body is the hash input, so a replay carrying the same event id
      // with different contents is caught as a body mismatch rather than
      // silently replaying the first outcome.
      rawBody.toString('utf8'),
      async () => this.applyEvent(event),
    );
    return result.value;
  }

  private async applyEvent(event: {
    event?: string;
    payload?: Record<string, { entity?: Record<string, unknown> }>;
  }) {
    const name = event.event ?? '';
    if (name !== AUTHORIZED && name !== FAILED) {
      // Acknowledged and ignored. Returning an error for an event we do not
      // handle makes Razorpay retry it for days.
      return { handled: false, reason: `ignored event ${name}` };
    }

    const entity = event.payload?.payment?.entity ?? {};
    const orderId = typeof entity.order_id === 'string' ? entity.order_id : '';
    const paymentId = typeof entity.id === 'string' ? entity.id : '';
    const amount = typeof entity.amount === 'number' ? entity.amount : -1;
    if (!orderId || !paymentId) throw new BadRequestException('Event is missing order or payment id.');

    const booking = await this.prisma.booking.findUnique({ where: { razorpayOrderId: orderId } });
    if (!booking) {
      // Loud, because it means Razorpay has an order we have no record of —
      // a bug or an account shared with something else, and either way the
      // money is real.
      this.log.error(`Webhook for order ${orderId}, which belongs to no booking`);
      return { handled: false, reason: 'unknown order' };
    }

    if (name === FAILED) {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.record(tx, {
          action: 'payment.failed',
          targetType: 'Booking',
          targetId: booking.id,
          after: { orderId, paymentId },
          actor: { id: 'razorpay', role: 'system' },
        });
      });
      // The hold is deliberately LEFT ALONE. A failed card is often retried on
      // the same checkout, and cancelling the booking would take the slot away
      // mid-attempt. The reaper handles it if nobody comes back.
      return { handled: true, outcome: 'payment_failed' };
    }

    /*
     * NEVER TRUST THE WEBHOOK'S AMOUNT. It is checked against the price WE
     * froze at booking, and a mismatch refuses rather than reconciles: a
     * payment for a different amount than the one quoted means either the order
     * was tampered with or two things are out of step, and capturing on either
     * reading is worse than stopping.
     */
    if (amount !== booking.pricePaise) {
      this.log.error(
        `Payment ${paymentId} is ${amount} paise but booking ${booking.id} is ` +
          `${booking.pricePaise}. NOT capturing.`,
      );
      return { handled: false, reason: 'amount mismatch' };
    }

    /*
     * THE SLOT CHECK, and the reason orders are not auto-captured.
     *
     * If the reaper expired this hold while the customer was in their banking
     * app, the slot may already have been resold. Capturing would charge them
     * for a consultation that cannot happen, and the refund would cost the
     * gateway fee — which is not returned. Declining to capture lets the
     * authorisation lapse and the customer is never charged at all.
     */
    if (booking.status !== 'held') {
      this.log.warn(
        `Payment ${paymentId} authorised for booking ${booking.id}, which is now ` +
          `"${booking.status}". NOT capturing — the authorisation will lapse and ` +
          `the customer will not be charged.`,
      );
      await this.prisma.$transaction(async (tx) => {
        await this.audit.record(tx, {
          action: 'payment.not_captured',
          targetType: 'Booking',
          targetId: booking.id,
          before: { status: booking.status },
          after: { orderId, paymentId, reason: 'hold no longer held' },
          actor: { id: 'razorpay', role: 'system' },
        });
      });
      return { handled: true, outcome: 'not_captured' };
    }

    const tax = this.taxFor(booking.pricePaise);

    /*
     * CAPTURE FIRST, CONFIRM SECOND, and the order is not arbitrary.
     *
     * Capture is the step that can fail — a network error, a gateway outage, an
     * authorisation that has already lapsed. Confirming first would leave a
     * booking marked paid with no money behind it, and that row looks identical
     * to a genuinely paid one for ever afterwards. The other way round the
     * worst case is money taken and a booking still "held", which the audit
     * trail shows, the reaper cannot silently expire without leaving a record,
     * and a human can resolve.
     */
    await this.gateway.capturePayment(paymentId, booking.pricePaise);

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { razorpayPaymentId: paymentId, capturedPaise: booking.pricePaise },
    });
    await this.bookings.confirm(booking.id, tax, { id: 'razorpay', role: 'system' });

    return { handled: true, outcome: 'confirmed', bookingId: booking.id };
  }
}
