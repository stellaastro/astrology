import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

function arg<T>(fn: unknown, call: number, index: number): T {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected at least ${call + 1} call(s)`);
  return c[index] as T;
}

const PRICE = 150_000;

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'B1',
  customerId: 'C1',
  astrologerId: 'A1',
  status: 'held',
  pricePaise: PRICE,
  holdExpiresAt: new Date(Date.now() + 600_000),
  razorpayOrderId: null as string | null,
  ...over,
});

function harness(opts: { booking?: Record<string, unknown> | null; verify?: boolean } = {}) {
  const tx = { booking: { update: vi.fn(async () => ({})) } };
  const prisma = {
    booking: {
      findUnique: vi.fn(async () => (opts.booking === undefined ? booking() : opts.booking)),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx)),
  };
  const audit = { record: vi.fn(async () => 'AE1') };
  const idempotency = {
    run: vi.fn(async (_s: string, _k: string, _b: unknown, work: () => Promise<unknown>) => ({
      executed: true,
      value: await work(),
    })),
  };
  const bookings = { confirm: vi.fn(async () => ({ id: 'B1', status: 'confirmed' })) };
  const gateway = {
    configured: true,
    keyId: 'rzp_test_abc',
    createOrder: vi.fn(async () => ({
      orderId: 'order_1', amountPaise: PRICE, currency: 'INR', keyId: 'rzp_test_abc',
    })),
    capturePayment: vi.fn(async () => undefined),
    verifyWebhook: vi.fn(() => opts.verify ?? true),
  };
  return {
    svc: new PaymentsService(
      prisma as never, audit as never, idempotency as never,
      bookings as never, gateway as never,
    ),
    prisma, tx, audit, idempotency, bookings, gateway,
  };
}

const evt = (over: Record<string, unknown> = {}, name = 'payment.authorized') =>
  Buffer.from(JSON.stringify({
    event: name,
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: PRICE, ...over } } },
  }));

describe('the tax configuration gate (O6)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('REFUSES to create an order when the CA has not answered', async () => {
    delete process.env.GST_RATE_BP;
    delete process.env.GST_SAC_CODE;
    delete process.env.GST_PLACE_OF_SUPPLY;
    const h = harness();
    // An invented rate on a real invoice is a filing problem, not a bug, and
    // it cannot be corrected on a paid row (§79).
    await expect(h.svc.createOrder('B1', 'C1', {})).rejects.toThrow(/O6|GST_RATE_BP/);
    expect(h.gateway.createOrder).not.toHaveBeenCalled();
  });

  it('refuses BEFORE calling the gateway, leaving no orphan order', async () => {
    delete process.env.GST_RATE_BP;
    const h = harness();
    await expect(h.svc.createOrder('B1', 'C1', {})).rejects.toThrow();
    expect(h.gateway.createOrder).not.toHaveBeenCalled();
  });
});

describe('creating an order', () => {
  beforeEach(() => {
    process.env.GST_RATE_BP = '1800';
    process.env.GST_SAC_CODE = '998399';
    process.env.GST_PLACE_OF_SUPPLY = 'UP';
  });

  it('creates an order for the frozen price', async () => {
    const h = harness();
    const res = await h.svc.createOrder('B1', 'C1', {});
    expect(arg<{ amountPaise: number }>(h.gateway.createOrder, 0, 0).amountPaise).toBe(PRICE);
    expect(res.orderId).toBe('order_1');
  });

  it('returns the PUBLIC key id, never the secret', async () => {
    const h = harness();
    const res = await h.svc.createOrder('B1', 'C1', {});
    expect(res.keyId).toBe('rzp_test_abc');
  });

  it("hides another customer's booking behind NOT FOUND", async () => {
    const h = harness({ booking: booking({ customerId: 'SOMEONE-ELSE' }) });
    await expect(h.svc.createOrder('B1', 'C1', {})).rejects.toThrow(NotFoundException);
  });

  it('refuses to start a payment against a lapsed hold', async () => {
    const h = harness({ booking: booking({ holdExpiresAt: new Date(Date.now() - 1000) }) });
    await expect(h.svc.createOrder('B1', 'C1', {})).rejects.toThrow(ConflictException);
  });

  it('refuses to start a payment for an already-confirmed booking', async () => {
    const h = harness({ booking: booking({ status: 'confirmed' }) });
    await expect(h.svc.createOrder('B1', 'C1', {})).rejects.toThrow(ConflictException);
  });

  /** Two orders for one booking is two ways to pay for it. */
  it('hands back the EXISTING order rather than creating a second', async () => {
    const h = harness({ booking: booking({ razorpayOrderId: 'order_existing' }) });
    const res = await h.svc.createOrder('B1', 'C1', {});
    expect(res.orderId).toBe('order_existing');
    expect(h.gateway.createOrder).not.toHaveBeenCalled();
  });
});

describe('the webhook', () => {
  beforeEach(() => {
    process.env.GST_RATE_BP = '1800';
    process.env.GST_SAC_CODE = '998399';
    process.env.GST_PLACE_OF_SUPPLY = 'UP';
  });

  /**
   * The signature IS the authentication — Razorpay has no session. A forged
   * payment.authorized would confirm a booking nobody paid for.
   */
  it('REJECTS an unsigned webhook before touching anything', async () => {
    const h = harness({ verify: false });
    await expect(h.svc.handleWebhook(evt(), 'bad', 'ev_1')).rejects.toThrow(BadRequestException);
    expect(h.prisma.booking.findUnique).not.toHaveBeenCalled();
    expect(h.bookings.confirm).not.toHaveBeenCalled();
  });

  it('verifies against the RAW BYTES, not a re-serialised object', async () => {
    const h = harness();
    const raw = evt();
    await h.svc.handleWebhook(raw, 'sig', 'ev_1');
    expect(arg<Buffer>(h.gateway.verifyWebhook, 0, 0)).toBe(raw);
  });

  it('refuses a webhook with no event id — it could not be deduplicated', async () => {
    const h = harness();
    await expect(h.svc.handleWebhook(evt(), 'sig', '')).rejects.toThrow(BadRequestException);
  });

  it('deduplicates on the gateway EVENT ID, hashing the raw body', async () => {
    const h = harness();
    await h.svc.handleWebhook(evt(), 'sig', 'ev_7');
    expect(arg<string>(h.idempotency.run, 0, 0)).toBe('razorpay.webhook');
    expect(arg<string>(h.idempotency.run, 0, 1)).toBe('ev_7');
    // The raw body is the hash input, so a replay carrying the same event id
    // with different contents is a body mismatch rather than a silent replay.
    expect(arg<string>(h.idempotency.run, 0, 2)).toBe(evt().toString('utf8'));
  });

  it('captures and confirms a good payment', async () => {
    const h = harness();
    const res = await h.svc.handleWebhook(evt(), 'sig', 'ev_1');
    expect(h.gateway.capturePayment).toHaveBeenCalledWith('pay_1', PRICE);
    expect(h.bookings.confirm).toHaveBeenCalled();
    expect(res).toMatchObject({ outcome: 'confirmed' });
  });

  it('CAPTURES BEFORE CONFIRMING — never a paid booking with no money behind it', async () => {
    const h = harness();
    h.gateway.capturePayment.mockRejectedValueOnce(new Error('gateway down'));
    await expect(h.svc.handleWebhook(evt(), 'sig', 'ev_1')).rejects.toThrow('gateway down');
    // The reverse order would leave a row marked paid that is indistinguishable
    // from a genuinely paid one for ever afterwards.
    expect(h.bookings.confirm).not.toHaveBeenCalled();
  });

  it('passes the computed tax split to confirm', async () => {
    const h = harness();
    await h.svc.handleWebhook(evt(), 'sig', 'ev_1');
    // ₹1500 at 18% inclusive, hand-computed: 127119 + 22881 = 150000.
    expect(arg<Record<string, number>>(h.bookings.confirm, 0, 1)).toMatchObject({
      taxableValuePaise: 127_119,
      taxAmountPaise: 22_881,
      taxRateBp: 1800,
    });
  });

  /**
   * NEVER TRUST THE WEBHOOK'S AMOUNT. A payment for a different amount than the
   * one quoted means the order was tampered with or two things are out of step,
   * and capturing on either reading is worse than stopping.
   */
  it('REFUSES to capture when the amount does not match the frozen price', async () => {
    const h = harness();
    const res = await h.svc.handleWebhook(evt({ amount: 100 }), 'sig', 'ev_1');
    expect(h.gateway.capturePayment).not.toHaveBeenCalled();
    expect(h.bookings.confirm).not.toHaveBeenCalled();
    expect(res).toMatchObject({ reason: 'amount mismatch' });
  });

  it('refuses an amount LARGER than the price too, not only smaller', async () => {
    const h = harness();
    await h.svc.handleWebhook(evt({ amount: PRICE + 1 }), 'sig', 'ev_1');
    expect(h.gateway.capturePayment).not.toHaveBeenCalled();
  });

  /**
   * The reason orders are created with auto-capture OFF. If the reaper expired
   * the hold while the customer was in their banking app, the slot may already
   * have been resold. Capturing charges them for a consultation that cannot
   * happen, and the refund costs a gateway fee that is not returned.
   */
  it('does NOT capture when the hold lapsed — the customer is never charged', async () => {
    const h = harness({ booking: booking({ status: 'expired' }) });
    const res = await h.svc.handleWebhook(evt(), 'sig', 'ev_1');
    expect(h.gateway.capturePayment).not.toHaveBeenCalled();
    expect(h.bookings.confirm).not.toHaveBeenCalled();
    expect(res).toMatchObject({ outcome: 'not_captured' });
  });

  it('records the non-capture rather than failing silently', async () => {
    const h = harness({ booking: booking({ status: 'expired' }) });
    await h.svc.handleWebhook(evt(), 'sig', 'ev_1');
    expect(arg<{ action: string }>(h.audit.record, 0, 1).action).toBe('payment.not_captured');
  });

  it('leaves the hold ALONE on a failed payment — the card is often retried', async () => {
    const h = harness();
    const res = await h.svc.handleWebhook(evt({}, 'payment.failed'), 'sig', 'ev_1');
    expect(res).toMatchObject({ outcome: 'payment_failed' });
    expect(h.prisma.booking.update).not.toHaveBeenCalled();
    expect(h.bookings.confirm).not.toHaveBeenCalled();
  });

  it('acknowledges an event it does not handle instead of making Razorpay retry for days', async () => {
    const h = harness();
    const res = await h.svc.handleWebhook(evt({}, 'refund.processed'), 'sig', 'ev_1');
    expect(res).toMatchObject({ handled: false });
  });

  it('does not confirm anything for an order it has no booking for', async () => {
    const h = harness({ booking: null });
    const res = await h.svc.handleWebhook(evt(), 'sig', 'ev_1');
    expect(res).toMatchObject({ reason: 'unknown order' });
    expect(h.gateway.capturePayment).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON, after the signature passed', async () => {
    const h = harness();
    await expect(h.svc.handleWebhook(Buffer.from('not json'), 'sig', 'ev_1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('records the payment id so a replay cannot apply twice at the database', async () => {
    const h = harness();
    await h.svc.handleWebhook(evt(), 'sig', 'ev_1');
    const data = arg<{ data: Record<string, unknown> }>(h.prisma.booking.update, 0, 0).data;
    expect(data.razorpayPaymentId).toBe('pay_1');
    expect(data.capturedPaise).toBe(PRICE);
  });
});
