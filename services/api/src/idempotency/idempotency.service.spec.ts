import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/** In-memory stand-in for the idempotencyKey table, incl. unique-key behaviour. */
function makePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    idempotencyKey: {
      findUnique: vi.fn(async ({ where }: never) => rows.get((where as never as { key: string }).key) ?? null),
      upsert: vi.fn(async ({ where, create, update }: never) => {
        const k = (where as never as { key: string }).key;
        const existing = rows.get(k);
        rows.set(k, existing
          ? { ...existing, ...(update as Record<string, unknown>) }
          : (create as Record<string, unknown>));
        return rows.get(k);
      }),
      update: vi.fn(async ({ where, data }: never) => {
        const k = (where as never as { key: string }).key;
        rows.set(k, { ...rows.get(k), ...(data as Record<string, unknown>) });
        return rows.get(k);
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}

describe('IdempotencyService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: IdempotencyService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new IdempotencyService(prisma as never);
  });

  it('runs the work on first call', async () => {
    const work = vi.fn(async () => ({ bookingId: 'b1' }));
    const res = await svc.run('booking.create', 'k1', { slot: 'x' }, work);

    expect(work).toHaveBeenCalledOnce();
    expect(res.executed).toBe(true);
    expect(res.value).toEqual({ bookingId: 'b1' });
  });

  /** The launch incident this exists to prevent. */
  it('does NOT run the work twice for a repeated key — the double-click case', async () => {
    const work = vi.fn(async () => ({ razorpayOrderId: 'order_1' }));

    const first = await svc.run('booking.create', 'k1', { slot: 'x' }, work);
    const second = await svc.run('booking.create', 'k1', { slot: 'x' }, work);

    expect(work).toHaveBeenCalledOnce(); // one order, not two
    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);
    expect(second.value).toEqual({ razorpayOrderId: 'order_1' });
  });

  it('returns the stored response, so the client sees the same booking twice', async () => {
    await svc.run('booking.create', 'k1', { slot: 'x' }, async () => ({ id: 'b1' }));
    const replay = await svc.run('booking.create', 'k1', { slot: 'x' }, async () => ({
      id: 'SHOULD_NOT_BE_USED',
    }));
    expect(replay.value).toEqual({ id: 'b1' });
  });

  it('rejects the same key with a different body instead of returning the wrong result', async () => {
    await svc.run('booking.create', 'k1', { slot: 'x' }, async () => ({ id: 'b1' }));

    await expect(
      svc.run('booking.create', 'k1', { slot: 'DIFFERENT' }, async () => ({ id: 'b2' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hashes bodies stably, so key order does not look like a different request', async () => {
    const a = IdempotencyService.hash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = IdempotencyService.hash({ a: 1, nested: { x: 1, y: 2 }, b: 2 });
    expect(a).toBe(b);
  });

  it('treats array order as significant, because it is', async () => {
    expect(IdempotencyService.hash([1, 2])).not.toBe(IdempotencyService.hash([2, 1]));
  });

  it('scopes keys so a booking key cannot collide with a webhook key', async () => {
    const work1 = vi.fn(async () => 'booking');
    const work2 = vi.fn(async () => 'webhook');

    await svc.run('booking.create', 'same-key', { a: 1 }, work1);
    await svc.run('razorpay.webhook', 'same-key', { a: 1 }, work2);

    expect(work1).toHaveBeenCalledOnce();
    expect(work2).toHaveBeenCalledOnce(); // not suppressed by the other scope
  });

  it('rejects a concurrent duplicate while the first is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(async () => {
      await gate;
      return { id: 'b1' };
    });

    const inflight = svc.run('booking.create', 'k1', { slot: 'x' }, slow);
    await vi.waitFor(() => expect(prisma.rows.size).toBe(1));

    await expect(
      svc.run('booking.create', 'k1', { slot: 'x' }, async () => ({ id: 'b2' })),
    ).rejects.toBeInstanceOf(ConflictException);

    release();
    await inflight;
  });

  /**
   * A crashed attempt must be retryable. Marking it complete would mean a
   * booking that was never created can never be created.
   */
  it('retries an expired in-progress key rather than treating it as done', async () => {
    prisma.rows.set('booking.create:k1', {
      key: 'booking.create:k1',
      scope: 'booking.create',
      requestHash: IdempotencyService.hash({ slot: 'x' }),
      status: 'in_progress',
      expiresAt: new Date(Date.now() - 1000), // died earlier
    });

    const work = vi.fn(async () => ({ id: 'b-retry' }));
    const res = await svc.run('booking.create', 'k1', { slot: 'x' }, work);

    expect(work).toHaveBeenCalledOnce();
    expect(res.executed).toBe(true);
  });

  it('marks the key completed only after the work resolves', async () => {
    await svc.run('booking.create', 'k1', { slot: 'x' }, async () => ({ id: 'b1' }));
    expect(prisma.rows.get('booking.create:k1')?.status).toBe('completed');
  });

  it('leaves the key in_progress when the work throws, so it can be retried', async () => {
    await expect(
      svc.run('booking.create', 'k1', { slot: 'x' }, async () => {
        throw new Error('razorpay unreachable');
      }),
    ).rejects.toThrow('razorpay unreachable');

    // Not 'completed' — a failed attempt must not look successful.
    expect(prisma.rows.get('booking.create:k1')?.status).toBe('in_progress');
  });
});
