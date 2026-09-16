import { describe, it, expect, vi } from 'vitest';

/**
 * A DELIBERATELY UNUSUAL TEST, because the property it guards cannot be
 * observed the usual way.
 *
 * `verifyWebhook` must compare the expected and given HMACs in constant time.
 * Replacing `timingSafeEqual` with `===` changes NO observable behaviour — the
 * same signatures pass, the same ones fail — so every ordinary test still
 * passes. I checked: that mutation was the one survivor of thirteen.
 *
 * What `===` changes is how LONG the comparison takes, in proportion to how
 * many leading bytes matched. That leaks, byte by byte, how much of a forged
 * signature was right, which is enough to construct a valid one given enough
 * attempts. A timing measurement inside a test is far too noisy to assert on,
 * so the honest options were to leave the property enforced by code review
 * alone, or to assert on the mechanism.
 *
 * This asserts on the mechanism. It couples the test to the implementation on
 * purpose: here the implementation IS the requirement.
 */
describe('webhook signatures are compared in constant time', () => {
  it('routes the comparison through crypto.timingSafeEqual', async () => {
    const calls: unknown[][] = [];
    vi.doMock('node:crypto', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:crypto')>();
      return {
        ...actual,
        timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
          calls.push([a, b]);
          return actual.timingSafeEqual(a, b);
        },
      };
    });

    vi.resetModules();
    const { RazorpayService } = await import('./razorpay.service');
    const { createHmac } = await import('node:crypto');

    const secret = 'whsec';
    const svc = new RazorpayService({
      RAZORPAY_KEY_ID: 'rzp_test_a',
      RAZORPAY_KEY_SECRET: 's',
      RAZORPAY_WEBHOOK_SECRET: secret,
      APP_ENV: 'development',
    } as NodeJS.ProcessEnv);

    const body = Buffer.from('{"event":"payment.authorized"}');
    const sig = createHmac('sha256', secret).update(body).digest('hex');

    expect(svc.verifyWebhook(body, sig)).toBe(true);
    expect(calls.length).toBe(1);

    vi.doUnmock('node:crypto');
    vi.resetModules();
  });
});
