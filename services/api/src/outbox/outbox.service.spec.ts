import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxService, MAX_ATTEMPTS, backoffMs } from './outbox.service';

type Row = {
  id: string; topic: string; payload: unknown; attempts: number;
  lastError: string | null; availableAt: Date; processedAt: Date | null;
};

function makePrisma(seed: Row[] = []) {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]));
  return {
    rows,
    outboxMessage: {
      create: vi.fn(async ({ data }: never) => {
        const d = data as unknown as Partial<Row>;
        const row: Row = {
          id: d.id!, topic: d.topic!, payload: d.payload, attempts: 0,
          lastError: null, availableAt: d.availableAt ?? new Date(), processedAt: null,
        };
        rows.set(row.id, row);
        return row;
      }),
      findMany: vi.fn(async ({ where, take }: never) => {
        const w = where as unknown as {
          availableAt: { lte: Date }; attempts: { lt: number };
        };
        return [...rows.values()]
          .filter((r) => r.processedAt === null && r.availableAt <= w.availableAt.lte && r.attempts < w.attempts.lt)
          .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
          .slice(0, take as unknown as number);
      }),
      update: vi.fn(async ({ where, data }: never) => {
        const id = (where as unknown as { id: string }).id;
        const row = rows.get(id)!;
        Object.assign(row, data as object);
        return row;
      }),
      count: vi.fn(async () =>
        [...rows.values()].filter((r) => r.processedAt === null && r.attempts >= MAX_ATTEMPTS).length),
    },
  };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'm1', topic: 'booking.confirmed', payload: { id: 'b1' }, attempts: 0,
  lastError: null, availableAt: new Date(0), processedAt: null, ...over,
});

describe('OutboxService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: OutboxService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new OutboxService(prisma as never);
  });

  it('enqueues through the caller transaction, not its own client', async () => {
    const tx = { outboxMessage: { create: vi.fn(async () => ({})) } };
    const id = await svc.enqueue(tx as never, 'booking.confirmed', { id: 'b1' });

    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // The whole point: it must land in the caller's transaction so a rolled
    // back booking cannot leave a queued confirmation email.
    expect(tx.outboxMessage.create).toHaveBeenCalledOnce();
    expect(prisma.outboxMessage.create).not.toHaveBeenCalled();
  });

  it('delivers a due message and marks it processed', async () => {
    prisma = makePrisma([row()]);
    svc = new OutboxService(prisma as never);
    const handler = vi.fn(async () => {});
    svc.register('booking.confirmed', handler);

    const res = await svc.dispatchBatch(10, new Date(1000));

    expect(handler).toHaveBeenCalledWith({ id: 'b1' }, 'booking.confirmed');
    expect(res.delivered).toBe(1);
    expect(prisma.rows.get('m1')!.processedAt).toBeInstanceOf(Date);
  });

  it('does not deliver a message scheduled for the future', async () => {
    prisma = makePrisma([row({ availableAt: new Date(10_000) })]);
    svc = new OutboxService(prisma as never);
    const handler = vi.fn(async () => {});
    svc.register('booking.confirmed', handler);

    const res = await svc.dispatchBatch(10, new Date(1000));
    expect(handler).not.toHaveBeenCalled();
    expect(res.delivered).toBe(0);
  });

  it('retries with backoff when a handler throws, and does not mark it processed', async () => {
    prisma = makePrisma([row()]);
    svc = new OutboxService(prisma as never);
    svc.register('booking.confirmed', async () => {
      throw new Error('smtp unreachable');
    });

    const res = await svc.dispatchBatch(10, new Date(1000));

    expect(res.failed).toBe(1);
    const r = prisma.rows.get('m1')!;
    expect(r.processedAt).toBeNull();
    expect(r.attempts).toBe(1);
    expect(r.lastError).toBe('smtp unreachable');
    expect(r.availableAt.getTime()).toBeGreaterThan(1000);
  });

  it('parks a message after MAX_ATTEMPTS rather than deleting it', async () => {
    prisma = makePrisma([row({ attempts: MAX_ATTEMPTS - 1 })]);
    svc = new OutboxService(prisma as never);
    svc.register('booking.confirmed', async () => {
      throw new Error('permanently broken');
    });

    const res = await svc.dispatchBatch(10, new Date(1000));

    expect(res.parked).toBe(1);
    const r = prisma.rows.get('m1')!;
    // Still present, still unprocessed. A message that could not be delivered
    // is evidence — discarding it would hide the failure.
    expect(r.processedAt).toBeNull();
    expect(r.attempts).toBe(MAX_ATTEMPTS);
    expect(await svc.parked()).toBe(1);
  });

  it('stops retrying once parked', async () => {
    prisma = makePrisma([row({ attempts: MAX_ATTEMPTS })]);
    svc = new OutboxService(prisma as never);
    const handler = vi.fn(async () => {});
    svc.register('booking.confirmed', handler);

    await svc.dispatchBatch(10, new Date(1000));
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves an unregistered topic queued instead of burning its attempts', async () => {
    prisma = makePrisma([row({ topic: 'not.registered' })]);
    svc = new OutboxService(prisma as never);

    const res = await svc.dispatchBatch(10, new Date(1000));

    expect(res).toEqual({ delivered: 0, failed: 0, parked: 0 });
    // A missing handler is a deployment mistake, not a bad message.
    expect(prisma.rows.get('m1')!.attempts).toBe(0);
  });

  it('one failing message does not stop the rest of the batch', async () => {
    prisma = makePrisma([
      row({ id: 'm1', topic: 'a' }),
      row({ id: 'm2', topic: 'b' }),
      row({ id: 'm3', topic: 'a' }),
    ]);
    svc = new OutboxService(prisma as never);
    svc.register('a', async () => {});
    svc.register('b', async () => {
      throw new Error('boom');
    });

    const res = await svc.dispatchBatch(10, new Date(1000));

    expect(res.delivered).toBe(2);
    expect(res.failed).toBe(1);
  });

  it('refuses a duplicate handler registration', () => {
    svc.register('t', async () => {});
    expect(() => svc.register('t', async () => {})).toThrow(/already has a handler/);
  });

  describe('backoff', () => {
    it('grows with attempts', () => {
      const a = Array.from({ length: 50 }, () => backoffMs(1));
      const b = Array.from({ length: 50 }, () => backoffMs(5));
      expect(Math.min(...b)).toBeGreaterThan(Math.max(...a));
    });

    it('is jittered, so a batch of failures does not retry in lockstep', () => {
      const values = new Set(Array.from({ length: 50 }, () => backoffMs(5)));
      expect(values.size).toBeGreaterThan(1);
    });

    it('caps at an hour', () => {
      expect(backoffMs(100)).toBeLessThanOrEqual(3_600_000);
    });
  });
});
