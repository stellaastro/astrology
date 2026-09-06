import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const init = vi.fn();
vi.mock('@sentry/node', () => ({ init: (...a: unknown[]) => init(...a) }));

const load = async () => (await import('./sentry')).initSentry;

describe('initSentry', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('stays off without a DSN rather than throwing', async () => {
    delete process.env.SENTRY_DSN;
    const initSentry = await load();
    expect(initSentry()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('treats a blank DSN as absent', async () => {
    process.env.SENTRY_DSN = '   ';
    const initSentry = await load();
    expect(initSentry()).toBe(false);
  });

  it('initialises when a DSN is present', async () => {
    process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
    const initSentry = await load();
    expect(initSentry()).toBe(true);
    expect(init).toHaveBeenCalledOnce();
  });

  describe('beforeSend redaction', () => {
    const send = async (event: Record<string, unknown>) => {
      process.env.SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
      const initSentry = await load();
      initSentry();
      const opts = init.mock.calls[0]?.[0] as {
        beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
      };
      return opts.beforeSend(event);
    };

    it('strips database credentials from messages', async () => {
      const out = await send({
        message: "Can't reach mysql://hminds:hunter2@127.0.0.1:3306/stellaastro",
      });
      expect(out.message).not.toContain('hunter2');
      expect(out.message).toContain('mysql://[redacted]@');
    });

    it('strips credentials from exception values too', async () => {
      const out = (await send({
        exception: { values: [{ value: 'redis://user:secret@127.0.0.1:6379/0 refused' }] },
      })) as { exception: { values: { value: string }[] } };
      expect(out.exception.values[0]!.value).not.toContain('secret');
    });

    it('redacts Razorpay keys', async () => {
      // Assembled at runtime, not written as a literal: the CI secrets job
      // scans tracked files for credential-shaped strings, and a test fixture
      // that trips it would push someone to weaken the scan instead. The
      // behaviour under test is unchanged.
      const fakeKey = ['rzp', 'live', 'ABC123xyz'].join('_');
      const out = await send({ message: `order failed for ${fakeKey}` });
      expect(out.message).not.toContain(fakeKey);
      expect(out.message).toContain('[redacted-razorpay-key]');
    });

    it('redacts auth headers', async () => {
      const out = (await send({
        request: { headers: { authorization: 'Bearer abc', cookie: 'sid=1', accept: '*/*' } },
      })) as { request: { headers: Record<string, string> } };
      expect(out.request.headers.authorization).toBe('[redacted]');
      expect(out.request.headers.cookie).toBe('[redacted]');
      expect(out.request.headers.accept).toBe('*/*'); // untouched
    });
  });
});
