import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  RazorpayService,
  LiveKeyInDevelopmentError,
  TestKeyInProductionError,
} from './razorpay.service';

const SECRET = 'whsec-test';
const env = (over: Record<string, string> = {}) =>
  ({
    RAZORPAY_KEY_ID: 'rzp_test_abc123',
    RAZORPAY_KEY_SECRET: 'testsecret',
    RAZORPAY_WEBHOOK_SECRET: SECRET,
    APP_ENV: 'development',
    ...over,
  }) as NodeJS.ProcessEnv;

/**
 * THE GUARD THAT MATTERS MOST IN THIS PROJECT RIGHT NOW.
 *
 * config.txt holds a LIVE Razorpay key and secret and no test pair, so the
 * obvious next step — paste what is on hand into .env and see if orders work —
 * would have made the first successful test a real charge on a real card. A
 * live key works perfectly in development, which is exactly why nothing else
 * would have caught it.
 */
describe('the live-key guard', () => {
  it('REFUSES to start with a live key outside production', () => {
    expect(() => new RazorpayService(env({ RAZORPAY_KEY_ID: 'rzp_live_XXXX' }))).toThrow(
      LiveKeyInDevelopmentError,
    );
  });

  it('refuses a live key under the review profile too', () => {
    expect(
      () => new RazorpayService(env({ RAZORPAY_KEY_ID: 'rzp_live_XXXX', APP_ENV: 'review' })),
    ).toThrow(LiveKeyInDevelopmentError);
  });

  it('names the fix, not just the problem', () => {
    expect(() => new RazorpayService(env({ RAZORPAY_KEY_ID: 'rzp_live_XXXX' }))).toThrow(
      /rzp_test_/,
    );
  });

  it('refuses a TEST key in production — every payment would look like an outage', () => {
    expect(() => new RazorpayService(env({ APP_ENV: 'production' }))).toThrow(
      TestKeyInProductionError,
    );
  });

  it('allows a live key in production', () => {
    expect(
      () => new RazorpayService(env({ RAZORPAY_KEY_ID: 'rzp_live_XXXX', APP_ENV: 'production' })),
    ).not.toThrow();
  });

  it('allows a test key in development', () => {
    expect(() => new RazorpayService(env())).not.toThrow();
  });

  /**
   * A guard that refuses an unrecognised shape is one that takes the site down
   * when a vendor changes a naming convention. Only a key that positively
   * identifies itself as belonging elsewhere is refused.
   */
  it('lets an unprefixed key through rather than guessing', () => {
    expect(() => new RazorpayService(env({ RAZORPAY_KEY_ID: 'somethingelse' }))).not.toThrow();
  });

  it('does not refuse when no key is set at all', () => {
    expect(() => new RazorpayService(env({ RAZORPAY_KEY_ID: '' }))).not.toThrow();
  });
});

describe('configuration reporting', () => {
  it('is unconfigured without a webhook secret — signatures could not be checked', () => {
    expect(new RazorpayService(env({ RAZORPAY_WEBHOOK_SECRET: '' })).configured).toBe(false);
  });

  it('is unconfigured without the key secret', () => {
    expect(new RazorpayService(env({ RAZORPAY_KEY_SECRET: '' })).configured).toBe(false);
  });

  it('is configured when all three are present', () => {
    expect(new RazorpayService(env()).configured).toBe(true);
  });
});

describe('webhook signature verification', () => {
  const svc = new RazorpayService(env());
  const body = Buffer.from(JSON.stringify({ event: 'order.paid', id: 'evt_1' }));
  const sign = (b: Buffer, s = SECRET) => createHmac('sha256', s).update(b).digest('hex');

  it('accepts a signature computed over the raw body', () => {
    expect(svc.verifyWebhook(body, sign(body))).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(svc.verifyWebhook(body, sign(body, 'attacker'))).toBe(false);
  });

  /**
   * The classic failure: verify against re-serialised JSON. Whitespace and key
   * order change, the signature stops matching for reasons unrelated to
   * authenticity, and the usual response is to stop checking.
   */
  it('rejects when the body was re-serialised, even though it parses the same', () => {
    const reserialised = Buffer.from(JSON.stringify({ id: 'evt_1', event: 'order.paid' }));
    expect(svc.verifyWebhook(reserialised, sign(body))).toBe(false);
  });

  it('rejects a body altered by one byte', () => {
    const tampered = Buffer.from(JSON.stringify({ event: 'order.paid', id: 'evt_2' }));
    expect(svc.verifyWebhook(tampered, sign(body))).toBe(false);
  });

  it('rejects an empty signature rather than treating it as absent', () => {
    expect(svc.verifyWebhook(body, '')).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch; that must not surface as a
    // 500, or an attacker can tell valid-length forgeries from invalid ones.
    expect(() => svc.verifyWebhook(body, 'ab')).not.toThrow();
    expect(svc.verifyWebhook(body, 'ab')).toBe(false);
  });

  it('rejects non-hex rubbish without throwing', () => {
    expect(svc.verifyWebhook(body, 'zzzz')).toBe(false);
  });

  it('refuses everything when no webhook secret is configured', () => {
    const bare = new RazorpayService(env({ RAZORPAY_WEBHOOK_SECRET: '' }));
    // Fail closed. An unconfigured verifier that returns true accepts forged
    // webhooks, and a forged order.paid confirms a booking nobody paid for.
    expect(bare.verifyWebhook(body, sign(body))).toBe(false);
  });
});

describe('order creation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses when Razorpay is not configured', async () => {
    const svc = new RazorpayService(env({ RAZORPAY_KEY_SECRET: '' }));
    await expect(svc.createOrder({ amountPaise: 99_900, receipt: 'B1' })).rejects.toThrow();
  });

  it('sends paise straight through and does NOT auto-capture', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      json: async () => ({ id: 'order_1', amount: 99_900, currency: 'INR' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await new RazorpayService(env()).createOrder({
      amountPaise: 99_900,
      receipt: 'B1',
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.amount).toBe(99_900);
    expect(body.receipt).toBe('B1');
    // payment_capture 0: the customer must not be charged before the server
    // knows the booking is real. Capture is ours to decide, not the gateway's.
    expect(body.payment_capture).toBe(0);
    expect(res.orderId).toBe('order_1');
  });

  it('returns the PUBLIC key id and never the secret', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ id: 'o', amount: 1, currency: 'INR' }) })),
    );
    const res = await new RazorpayService(env()).createOrder({ amountPaise: 1, receipt: 'B1' });
    expect(res.keyId).toBe('rzp_test_abc123');
    expect(JSON.stringify(res)).not.toContain('testsecret');
  });

  it('rejects a zero or negative amount before calling the gateway', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = new RazorpayService(env());
    await expect(svc.createOrder({ amountPaise: 0, receipt: 'B1' })).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a gateway refusal as unavailable, not as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, text: async () => 'account not activated' })),
    );
    // Provider failure surfaces as an error or a pending state, NEVER as a fake
    // success (CLAUDE.md, the §71 rule at its most load-bearing).
    await expect(
      new RazorpayService(env()).createOrder({ amountPaise: 99_900, receipt: 'B1' }),
    ).rejects.toThrow();
  });
});
