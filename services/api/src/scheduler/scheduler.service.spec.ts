import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchedulerService } from './scheduler.service';

const makeOutbox = () => ({
  dispatchBatch: vi.fn(async () => ({ delivered: 0, failed: 0, parked: 0 })),
  parked: vi.fn(async () => 0),
});
const makeIdem = () => ({ purgeExpired: vi.fn(async () => 0) });

describe('SchedulerService', () => {
  let outbox: ReturnType<typeof makeOutbox>;
  let idem: ReturnType<typeof makeIdem>;
  let svc: SchedulerService;

  beforeEach(() => {
    outbox = makeOutbox();
    idem = makeIdem();
    svc = new SchedulerService(outbox as never, idem as never);
  });

  it('dispatches the outbox on tick', async () => {
    await svc.dispatchOutbox();
    expect(outbox.dispatchBatch).toHaveBeenCalledOnce();
  });

  /**
   * Overlapping ticks would deliver the same message twice concurrently, which
   * for a booking confirmation means two emails.
   */
  it('skips a tick while the previous batch is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    outbox.dispatchBatch.mockImplementationOnce(async () => {
      await gate;
      return { delivered: 1, failed: 0, parked: 0 };
    });

    const first = svc.dispatchOutbox();
    await svc.dispatchOutbox(); // second tick lands mid-flight

    expect(outbox.dispatchBatch).toHaveBeenCalledOnce();
    release();
    await first;
  });

  it('releases the guard after a batch, so later ticks run', async () => {
    await svc.dispatchOutbox();
    await svc.dispatchOutbox();
    expect(outbox.dispatchBatch).toHaveBeenCalledTimes(2);
  });

  /**
   * An unhandled rejection in a cron job takes the process down, and with it
   * the API. Every job must swallow-and-log rather than throw.
   */
  it('never throws when the outbox dispatch fails', async () => {
    outbox.dispatchBatch.mockRejectedValueOnce(new Error('database gone'));
    await expect(svc.dispatchOutbox()).resolves.toBeUndefined();
  });

  it('releases the guard even when the batch throws', async () => {
    outbox.dispatchBatch.mockRejectedValueOnce(new Error('boom'));
    await svc.dispatchOutbox();
    await svc.dispatchOutbox();
    expect(outbox.dispatchBatch).toHaveBeenCalledTimes(2);
  });

  it('never throws when the parked check fails', async () => {
    outbox.parked.mockRejectedValueOnce(new Error('nope'));
    await expect(svc.alertParked()).resolves.toBeUndefined();
  });

  it('never throws when the idempotency purge fails', async () => {
    idem.purgeExpired.mockRejectedValueOnce(new Error('nope'));
    await expect(svc.purgeIdempotencyKeys()).resolves.toBeUndefined();
  });

  it('purges expired idempotency keys', async () => {
    idem.purgeExpired.mockResolvedValueOnce(7);
    await svc.purgeIdempotencyKeys();
    expect(idem.purgeExpired).toHaveBeenCalledOnce();
  });
});
