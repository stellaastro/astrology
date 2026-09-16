import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  BookingsService,
  HOLD_MINUTES,
  MAX_RESCHEDULES,
  RESCHEDULE_CUTOFF_MINUTES,
} from './bookings.service';

function arg<T>(fn: unknown, call: number, index: number): T {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected at least ${call + 1} call(s)`);
  return c[index] as T;
}

const SLOT = new Date('2027-03-02T04:30:00.000Z'); // 10:00 IST, far future
const ASTROLOGER = {
  id: 'A1',
  sessionMinutes: 30,
  sessionRatePaise: 150_000,
  chatRatePerMinutePaise: null as number | null,
  chatMaxMinutes: 30,
};

function harness(
  opts: {
    astrologer?: Record<string, unknown> | null;
    /** Slots the availability service will offer. Defaults to SLOT alone. */
    offered?: Date[];
    booking?: Record<string, unknown> | null;
    /** An earlier booking made with the same idempotency key by the same customer. */
    replay?: Record<string, unknown> | null;
    taken?: Record<string, unknown> | null;
    stale?: Record<string, unknown>[];
    createThrows?: unknown;
    updateThrows?: unknown;
    updateManyCount?: number;
  } = {},
) {
  const tx = {
    booking: {
      create: vi.fn(async () => {
        if (opts.createThrows) throw opts.createThrows;
        return {};
      }),
      update: vi.fn(async () => {
        if (opts.updateThrows) throw opts.updateThrows;
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: opts.updateManyCount ?? 1 })),
    },
  };
  const prisma = {
    astrologer: {
      findFirst: vi.fn(async () =>
        opts.astrologer === undefined ? ASTROLOGER : opts.astrologer,
      ),
    },
    booking: {
      findUnique: vi.fn(async () => opts.booking ?? null),
      // hold() calls findFirst twice: once to replay its own earlier attempt,
      // then once to see whether anybody else occupies the slot.
      findFirst: vi
        .fn()
        .mockImplementationOnce(async () => opts.replay ?? null)
        .mockImplementation(async () => opts.taken ?? null),
      findMany: vi.fn(async () => opts.stale ?? []),
    },
    $transaction: vi.fn(async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx)),
  };
  const audit = { record: vi.fn(async () => 'AE1') };
  const idempotency = {
    // Pass-through: the real class has its own tests. What matters here is
    // WHICH key and body the service hands it, asserted below.
    run: vi.fn(async (_s: string, _k: string, _b: unknown, work: () => Promise<unknown>) => ({
      executed: true,
      value: await work(),
    })),
  };
  const availability = {
    slotsFor: vi.fn(async () =>
      (opts.offered ?? [SLOT]).map((d) => ({
        startsAt: d,
        endsAt: new Date(d.getTime() + 1_800_000),
      })),
    ),
  };
  return {
    svc: new BookingsService(
      prisma as never,
      audit as never,
      idempotency as never,
      availability as never,
    ),
    prisma,
    tx,
    audit,
    idempotency,
    availability,
  };
}

const held = (over: Record<string, unknown> = {}) => ({
  id: 'B1',
  astrologerId: 'A1',
  customerId: 'C1',
  slotStart: SLOT,
  slotEnd: new Date(SLOT.getTime() + 1_800_000),
  status: 'held',
  pricePaise: 150_000,
  sessionMinutes: 30,
  rescheduleCount: 0,
  ...over,
});

const TAX = {
  taxableValuePaise: 127_119,
  taxRateBp: 1800,
  taxAmountPaise: 22_881,
  sacCode: '998399',
  placeOfSupply: 'UP',
};

describe('holding a slot (6.2, 6.3)', () => {
  const ok = { customerId: 'C1', slug: 'x', slotStart: SLOT, modality: 'voice' as const };

  it('holds an offered slot and freezes the price', async () => {
    const h = harness();
    const res = await h.svc.hold(ok, 'key-1', {});
    expect(res.status).toBe('held');
    expect(res.pricePaise).toBe(150_000);
    expect(res.sessionMinutes).toBe(30);
  });

  it('sets a hold that outlives the Razorpay flow', async () => {
    const h = harness();
    const res = await h.svc.hold(ok, 'key-1', {});
    const minutes = (Date.parse(res.holdExpiresAt ?? '') - Date.now()) / 60_000;
    // UPI collect pends for minutes. A hold that lapses mid-payment takes
    // money for a slot somebody else now owns.
    expect(minutes).toBeGreaterThan(HOLD_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(HOLD_MINUTES);
  });

  it('REQUIRES an idempotency key — the guard cannot be optional', async () => {
    const h = harness();
    await expect(h.svc.hold(ok, '', {})).rejects.toThrow(BadRequestException);
  });

  it('passes the slot and customer to the idempotency body, not just the key', async () => {
    const h = harness();
    await h.svc.hold(ok, 'key-1', {});
    const body = arg<Record<string, unknown>>(h.idempotency.run, 0, 2);
    // Reusing a key with a DIFFERENT slot must be rejected as a client bug
    // rather than silently returning the first booking.
    expect(body.slotStart).toBe(SLOT.toISOString());
    expect(body.customerId).toBe('C1');
  });

  it('refuses a time the astrologer does not offer', async () => {
    const h = harness({ offered: [] });
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow(ConflictException);
  });

  it('refuses a MISALIGNED time inside an open window', async () => {
    // 09:07 on a grid of half hours. A looser "is it inside a window?" test
    // would accept this and book somewhere the astrologer never offered.
    const h = harness({ offered: [SLOT] });
    const off = new Date(SLOT.getTime() + 7 * 60_000);
    await expect(h.svc.hold({ ...ok, slotStart: off }, 'key-1', {})).rejects.toThrow(ConflictException);
  });

  it('refuses an astrologer with no price — publishable is not bookable', async () => {
    const h = harness({ astrologer: { ...ASTROLOGER, sessionRatePaise: null } });
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow(ConflictException);
  });

  it('is NOT FOUND for a draft, retired or unknown astrologer alike', async () => {
    const h = harness({ astrologer: null });
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow(NotFoundException);
  });

  it('refuses a slot an occupying booking already holds', async () => {
    const h = harness({ taken: { id: 'B0' } });
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow(ConflictException);
  });

  /**
   * Ordering, not politeness. slotsFor now filters sold slots out, so if
   * availability were checked first a booked slot would be indistinguishable
   * from a time the astrologer never works — and the occupancy query above
   * would be dead code with a passing test beside it.
   */
  it('says a sold slot was TAKEN, not that it does not exist', async () => {
    const h = harness({ taken: { id: 'B0' }, offered: [] });
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow(/just been taken/);
  });

  it('asks only about OCCUPYING statuses — a cancelled booking frees its slot', async () => {
    const h = harness();
    await h.svc.hold(ok, 'key-1', {});
    // Call 1, not 0: call 0 is the replay lookup added after the real endpoint
    // showed a double-click being told its own booking had been taken.
    const where = arg<{ where: { status: { notIn: string[] } } }>(h.prisma.booking.findFirst, 1, 0).where;
    // Must mirror the generated column's CASE exactly: book, cancel, rebook
    // is the test that catches the MySQL partial-index mistake (ADR-029).
    expect(where.status.notIn).toEqual(['cancelled', 'expired']);
  });

  /**
   * The check above is a courtesy; THIS is the guarantee. Two simultaneous
   * requests both pass the read, and the unique index on the generated column
   * rejects the loser.
   */
  /**
   * FOUND BY EXERCISING THE REAL ENDPOINT, not by a unit test.
   *
   * A double-click held the slot, and the second request was refused by the
   * occupancy check — telling the customer their OWN booking had just been
   * taken. A client that surfaced that honestly would send them to pick a
   * different slot, and they would end up with two bookings. Which is the exact
   * incident task 6.3 exists to prevent.
   */
  it('REPLAYS the caller own booking instead of calling it a clash', async () => {
    const h = harness({
      replay: {
        id: 'B-EARLIER',
        astrologerId: 'A1',
        slotStart: SLOT,
        slotEnd: new Date(SLOT.getTime() + 1_800_000),
        modality: 'voice',
        status: 'held',
        sessionMinutes: 30,
        pricePaise: 150_000,
        chatRatePerMinutePaise: null,
        holdExpiresAt: new Date(),
      },
      taken: { id: 'B-EARLIER' },
    });
    const res = await h.svc.hold(ok, 'key-1', {});
    expect(res.id).toBe('B-EARLIER');
    // And it must not have booked anything a second time.
    expect(h.tx.booking.create).not.toHaveBeenCalled();
  });

  it('scopes the replay lookup to the CALLER, not just the key', async () => {
    const h = harness();
    await h.svc.hold(ok, 'key-1', {});
    const where = arg<{ where: Record<string, unknown> }>(h.prisma.booking.findFirst, 0, 0).where;
    // idempotency_key is globally unique on the table, so an unscoped lookup
    // would hand somebody else's booking to anyone who guessed a key.
    expect(where).toEqual({ idempotencyKey: 'key-1', customerId: 'C1' });
  });

  it('excludes the caller own key from the occupancy check too', async () => {
    const h = harness();
    await h.svc.hold(ok, 'key-1', {});
    const where = arg<{ where: Record<string, unknown> }>(h.prisma.booking.findFirst, 1, 0).where;
    expect(where.idempotencyKey).toEqual({ not: 'key-1' });
  });

  it('turns the slot index violation into a civil 409, not a 500', async () => {
    const h = harness({
      createThrows: Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: ['slot_key'] },
      }),
    });
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow(ConflictException);
  });

  it('does NOT swallow an unrelated database error as a taken slot', async () => {
    const h = harness({ createThrows: new Error('connection lost') });
    // Reporting an outage as "that time has just been taken" sends the
    // customer to click another slot that will fail the same way.
    await expect(h.svc.hold(ok, 'key-1', {})).rejects.toThrow('connection lost');
  });

  it('keeps personal data out of the audit row (ADR-040)', async () => {
    const h = harness();
    await h.svc.hold(ok, 'key-1', {});
    const entry = arg<{ after: Record<string, unknown> }>(h.audit.record, 0, 1);
    const written = JSON.stringify(entry.after);
    expect(written).not.toContain('C1');
    expect(entry.after.astrologerId).toBe('A1');
  });
});

describe('chat bookings authorise a ceiling (ADR-052)', () => {
  const chat = { customerId: 'C1', slug: 'x', slotStart: SLOT, modality: 'chat' as const };

  it('freezes the ceiling and the per-minute rate', async () => {
    const h = harness({
      astrologer: { ...ASTROLOGER, chatRatePerMinutePaise: 5_000, chatMaxMinutes: 30 },
    });
    const res = await h.svc.hold(chat, 'key-1', {});
    expect(res.pricePaise).toBe(150_000); // 30 × 5000, the MOST they can be charged
    expect(res.chatRatePerMinutePaise).toBe(5_000);
  });

  it('CLAMPS the ceiling to the slot — a chat cannot bill into the next customer', async () => {
    const h = harness({
      astrologer: { ...ASTROLOGER, chatRatePerMinutePaise: 5_000, chatMaxMinutes: 45 },
    });
    const res = await h.svc.hold(chat, 'key-1', {});
    expect(res.sessionMinutes).toBe(30);
    expect(res.pricePaise).toBe(150_000);
  });

  it('refuses chat when no per-minute rate is set', async () => {
    const h = harness();
    await expect(h.svc.hold(chat, 'key-1', {})).rejects.toThrow(ConflictException);
  });

  it('leaves the per-minute rate null on a voice booking', async () => {
    const h = harness();
    const res = await h.svc.hold({ ...chat, modality: 'voice' }, 'key-1', {});
    expect(res.chatRatePerMinutePaise).toBeNull();
  });
});

describe('confirming (Phase 7 is the only caller)', () => {
  it('confirms a held booking and clears the hold clock', async () => {
    const h = harness({ booking: held() });
    await h.svc.confirm('B1', TAX, {});
    const data = arg<{ data: Record<string, unknown> }>(h.tx.booking.update, 0, 0).data;
    expect(data.status).toBe('confirmed');
    // Or the reaper's `holdExpiresAt < now` sweep could expire a paid booking.
    expect(data.holdExpiresAt).toBeNull();
  });

  it('REFUSES without the tax split — the schema invariant, enforced', async () => {
    const h = harness({ booking: held() });
    await expect(
      h.svc.confirm('B1', { ...TAX, taxAmountPaise: undefined as never }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  /**
   * If the reaper already expired this row, the slot may have been resold.
   * Confirming anyway would double-book; Phase 7 must refund instead.
   */
  it('refuses to confirm an expired hold, loudly', async () => {
    const h = harness({ booking: held({ status: 'expired' }) });
    await expect(h.svc.confirm('B1', TAX, {})).rejects.toThrow(ConflictException);
  });

  it('does NOT consult the hold clock — a payment a second late still wins', async () => {
    const h = harness({ booking: held({ holdExpiresAt: new Date(Date.now() - 60_000) }) });
    // Refusing after the money was taken is worse than honouring a stale hold.
    await expect(h.svc.confirm('B1', TAX, {})).resolves.toMatchObject({ status: 'confirmed' });
  });
});

describe('cancelling', () => {
  it('records WHO cancelled and how much notice they gave', async () => {
    const h = harness({ booking: held({ status: 'confirmed' }) });
    const res = await h.svc.cancel('B1', 'astrologer', 'unwell', {});
    const entry = arg<{ after: Record<string, unknown> }>(h.audit.record, 0, 1);
    expect(entry.after.cancelledBy).toBe('astrologer');
    // The refund policy turns on this, so it is frozen at the moment it was
    // true rather than recomputed later from a slot a reschedule has moved.
    expect(entry.after.noticeMinutes).toBe(res.noticeMinutes);
    expect(entry.after.wasPaid).toBe(true);
  });

  it('allows a late cancellation — refusing does not make anybody turn up', async () => {
    const soon = new Date(Date.now() + 60_000);
    const h = harness({ booking: held({ slotStart: soon, status: 'confirmed' }) });
    await expect(h.svc.cancel('B1', 'customer', undefined, {})).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it("hides another customer's booking behind NOT FOUND, not FORBIDDEN", async () => {
    const h = harness({ booking: held({ customerId: 'SOMEONE-ELSE' }) });
    // 403 would confirm the booking exists, turning the id into an oracle.
    await expect(
      h.svc.cancel('B1', 'customer', undefined, {}, { customerId: 'C1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to cancel an already-cancelled booking', async () => {
    const h = harness({ booking: held({ status: 'cancelled' }) });
    await expect(h.svc.cancel('B1', 'customer', undefined, {})).rejects.toThrow(ConflictException);
  });

  it('truncates a long reason rather than failing the cancellation', async () => {
    const h = harness({ booking: held() });
    await h.svc.cancel('B1', 'customer', 'x'.repeat(500), {});
    const data = arg<{ data: { cancelReason: string } }>(h.tx.booking.update, 0, 0).data;
    expect(data.cancelReason).toHaveLength(200);
  });
});

describe('rescheduling (6.6)', () => {
  const future = new Date(Date.now() + 10 * 86_400_000);
  const target = new Date(future.getTime() + 3_600_000);

  const movable = (over: Record<string, unknown> = {}) =>
    held({ slotStart: future, slotEnd: new Date(future.getTime() + 1_800_000), ...over });

  it('moves the SAME row, so the price snapshot travels with it', async () => {
    const h = harness({ booking: movable(), offered: [target] });
    const res = await h.svc.reschedule('B1', target, {});
    expect(res.slotStart).toBe(target.toISOString());
    // One UPDATE: a create-then-cancel pair would need the price copied, and a
    // copied price snapshot is a recomputed price waiting to happen (§79).
    expect(h.tx.booking.create).not.toHaveBeenCalled();
    const data = arg<{ data: Record<string, unknown> }>(h.tx.booking.update, 0, 0).data;
    expect(data.pricePaise).toBeUndefined();
  });

  it('keeps the FROZEN duration, not the astrologer current one', async () => {
    const h = harness({ booking: movable({ sessionMinutes: 30 }), offered: [target] });
    // The profile has since moved to 45 minutes; this booking was sold as 30.
    h.prisma.astrologer.findFirst.mockResolvedValueOnce({ ...ASTROLOGER, sessionMinutes: 45 });
    const res = await h.svc.reschedule('B1', target, {});
    expect(Date.parse(res.slotEnd) - Date.parse(res.slotStart)).toBe(30 * 60_000);
  });

  it('turns a taken destination into a 409 and LEAVES THE ORIGINAL SLOT HELD', async () => {
    const h = harness({
      booking: movable(),
      offered: [target],
      updateThrows: Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: ['slot_key'] },
      }),
    });
    // The single UPDATE is what guarantees this: MySQL recomputes slot_key in
    // the same statement, so the move either happened or never started. There
    // is no instant at which the customer holds neither slot.
    await expect(h.svc.reschedule('B1', target, {})).rejects.toThrow(ConflictException);
  });

  it('refuses a destination the astrologer does not offer', async () => {
    const h = harness({ booking: movable(), offered: [] });
    await expect(h.svc.reschedule('B1', target, {})).rejects.toThrow(ConflictException);
  });

  it('checks the destination against the SAME astrologer', async () => {
    const h = harness({ booking: movable(), offered: [target] });
    await h.svc.reschedule('B1', target, {});
    // Moving to a different practitioner is not a reschedule — it is a
    // different consultation, at a price that may not match.
    expect(arg<string>(h.availability.slotsFor, 0, 0)).toBe('A1');
  });

  it('refuses inside the cutoff — an astrologer is already at the microphone', async () => {
    const soon = new Date(Date.now() + (RESCHEDULE_CUTOFF_MINUTES - 10) * 60_000);
    const h = harness({ booking: movable({ slotStart: soon }), offered: [target] });
    await expect(h.svc.reschedule('B1', target, {})).rejects.toThrow(ConflictException);
  });

  it('refuses past the reschedule limit — an unlimited move is a free hold', async () => {
    const h = harness({ booking: movable({ rescheduleCount: MAX_RESCHEDULES }), offered: [target] });
    await expect(h.svc.reschedule('B1', target, {})).rejects.toThrow(ConflictException);
  });

  it('counts the move', async () => {
    const h = harness({ booking: movable({ rescheduleCount: 1 }), offered: [target] });
    const res = await h.svc.reschedule('B1', target, {});
    expect(res.rescheduleCount).toBe(2);
    const data = arg<{ data: { rescheduleCount: unknown } }>(h.tx.booking.update, 0, 0).data;
    expect(data.rescheduleCount).toEqual({ increment: 1 });
  });

  it('refuses a move to the slot it is already in', async () => {
    const h = harness({ booking: movable(), offered: [future] });
    await expect(h.svc.reschedule('B1', future, {})).rejects.toThrow(BadRequestException);
  });

  it('refuses to move a cancelled booking', async () => {
    const h = harness({ booking: movable({ status: 'cancelled' }), offered: [target] });
    await expect(h.svc.reschedule('B1', target, {})).rejects.toThrow(ConflictException);
  });
});

describe('the abandoned-checkout reaper (6.10)', () => {
  it('expires a lapsed hold and frees its slot', async () => {
    const h = harness({ stale: [{ id: 'B1', astrologerId: 'A1', slotStart: SLOT }] });
    const res = await h.svc.expireHolds();
    expect(res.expired).toBe(1);
    const data = arg<{ data: { status: string } }>(h.tx.booking.updateMany, 0, 0).data;
    // 'expired' is one of the two statuses the generated column maps to NULL,
    // which is what actually returns the slot to sale.
    expect(data.status).toBe('expired');
  });

  it('asks only for LAPSED HELD bookings', async () => {
    const h = harness();
    const now = new Date('2027-01-01T00:00:00.000Z');
    await h.svc.expireHolds(now);
    const where = arg<{ where: Record<string, unknown> }>(h.prisma.booking.findMany, 0, 0).where;
    expect(where.status).toBe('held');
    expect(where.holdExpiresAt).toEqual({ lt: now });
  });

  /**
   * The race that matters: a payment confirms the booking between the read and
   * the write. Expiring a slot somebody has just paid for is the one outcome
   * worth engineering against here.
   */
  it('LOSES to a payment that confirmed the booking mid-sweep', async () => {
    const h = harness({
      stale: [{ id: 'B1', astrologerId: 'A1', slotStart: SLOT }],
      updateManyCount: 0,
    });
    const res = await h.svc.expireHolds();
    expect(res.expired).toBe(0);
    // And nothing is recorded: an audit row saying a paid booking expired
    // would be a permanent, unerasable lie.
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('re-checks the status in the WHERE clause, not only in the read', async () => {
    const h = harness({ stale: [{ id: 'B1', astrologerId: 'A1', slotStart: SLOT }] });
    await h.svc.expireHolds();
    const where = arg<{ where: Record<string, unknown> }>(h.tx.booking.updateMany, 0, 0).where;
    expect(where).toEqual({ id: 'B1', status: 'held' });
  });

  it('caps the batch so a backlog is not one long transaction', async () => {
    const h = harness();
    await h.svc.expireHolds(new Date(), 50);
    expect(arg<{ take: number }>(h.prisma.booking.findMany, 0, 0).take).toBe(50);
  });
});
