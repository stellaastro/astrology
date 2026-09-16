import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';

function arg<T>(fn: unknown, call: number, index: number): T {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected at least ${call + 1} call(s)`);
  return c[index] as T;
}

const ASTROLOGER = { id: 'A1', sessionMinutes: 30, bufferMinutes: 0 };

function harness(
  astrologer: Record<string, unknown> | null = ASTROLOGER,
  opts: { bookings?: Record<string, unknown>[] } = {},
) {
  const tx = {
    availabilityRule: { deleteMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    availabilityBlock: { create: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) },
  };
  const prisma = {
    astrologer: { findUnique: vi.fn(async () => astrologer) },
    availabilityRule: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    availabilityBlock: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    // slotsFor asks for OCCUPIED slots; orphanedBy asks for upcoming bookings.
    // Both land here, so a test steers whichever it needs.
    booking: { findMany: vi.fn(async () => opts.bookings ?? []) },
    $transaction: vi.fn(async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx)),
  };
  const audit = { record: vi.fn(async () => 'AE1') };
  return { svc: new AvailabilityService(prisma as never, audit as never), prisma, tx, audit };
}

const win = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute });

/** The next Monday strictly in the future, as a one-day UTC window. */
function nextMonday(): { from: Date; to: Date } {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
  return { from: d, to: new Date(d.getTime() + 86_400_000) };
}

describe('weekly rules', () => {
  it('REFUSES overlapping windows — MySQL cannot', () => {
    const h = harness();
    // Two windows covering the same minute generate the same slot twice, and a
    // duplicated slot is a double booking waiting for two customers to find it.
    return expect(
      h.svc.replaceRules('A1', [win(1, 540, 780), win(1, 700, 900)], {}),
    ).rejects.toThrow(ConflictException);
  });

  it('allows windows that merely touch', async () => {
    const h = harness();
    await expect(h.svc.replaceRules('A1', [win(1, 540, 720), win(1, 720, 900)], {})).resolves.toBeDefined();
  });

  it('allows the same hours on different days', async () => {
    const h = harness();
    await expect(h.svc.replaceRules('A1', [win(1, 540, 780), win(2, 540, 780)], {})).resolves.toBeDefined();
  });

  it('rejects a window that ends before it starts', async () => {
    const h = harness();
    // Silently produces no slots, which reads as "nobody is available" rather
    // than as a mistake.
    await expect(h.svc.replaceRules('A1', [win(1, 780, 540)], {})).rejects.toThrow(BadRequestException);
  });

  it('rejects a zero-length window', async () => {
    const h = harness();
    await expect(h.svc.replaceRules('A1', [win(1, 540, 540)], {})).rejects.toThrow(BadRequestException);
  });

  it.each([-1, 7, 1.5])('rejects weekday %s', async (weekday) => {
    const h = harness();
    await expect(h.svc.replaceRules('A1', [win(weekday, 540, 780)], {})).rejects.toThrow(BadRequestException);
  });

  it('rejects a minute beyond the end of the day', async () => {
    const h = harness();
    await expect(h.svc.replaceRules('A1', [win(1, 540, 1441)], {})).rejects.toThrow(BadRequestException);
  });

  it('REPLACES the grid in one transaction rather than merging', async () => {
    const h = harness();
    await h.svc.replaceRules('A1', [win(1, 540, 780)], {});
    // Applying a week as a series of adds and removes leaves a window where the
    // grid is half old and half new, and a booking taken then is taken against
    // hours nobody set.
    expect(h.tx.availabilityRule.deleteMany).toHaveBeenCalledWith({ where: { astrologerId: 'A1' } });
    expect(h.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('validates BEFORE deleting anything', async () => {
    const h = harness();
    await expect(h.svc.replaceRules('A1', [win(1, 780, 540)], {})).rejects.toThrow();
    // A bad payload must not clear the existing grid on its way to failing.
    expect(h.tx.availabilityRule.deleteMany).not.toHaveBeenCalled();
  });

  it('404s for an astrologer that does not exist', async () => {
    const h = harness(null);
    await expect(h.svc.replaceRules('nope', [win(1, 540, 780)], {})).rejects.toThrow(NotFoundException);
  });
});

describe('blocks', () => {
  it('rejects a block that ends before it starts', async () => {
    const h = harness();
    await expect(
      h.svc.addBlock('A1', { startsAt: new Date('2026-09-20T00:00Z'), endsAt: new Date('2026-09-19T00:00Z') }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unparseable dates rather than storing an Invalid Date', async () => {
    const h = harness();
    await expect(
      h.svc.addBlock('A1', { startsAt: new Date('nonsense'), endsAt: new Date('2026-09-19T00:00Z') }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('will not delete another astrologer’s block by id', async () => {
    const h = harness();
    h.prisma.availabilityBlock.findUnique = vi.fn(async () => ({
      id: 'B1', astrologerId: 'SOMEONE_ELSE', startsAt: new Date(), endsAt: new Date(),
    })) as never;
    await expect(h.svc.removeBlock('A1', 'B1', {})).rejects.toThrow(NotFoundException);
    expect(h.tx.availabilityBlock.delete).not.toHaveBeenCalled();
  });
});

describe('slot lookup', () => {
  it('refuses a horizon beyond 90 days', async () => {
    const h = harness();
    await expect(
      h.svc.slotsFor('A1', new Date('2026-01-01T00:00Z'), new Date('2026-12-31T00:00Z')),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes the astrologer’s own session and buffer to the generator', async () => {
    const h = harness({ id: 'A1', sessionMinutes: 45, bufferMinutes: 15 });
    h.prisma.availabilityRule.findMany = vi.fn(async () => [
      { weekday: 1, startMinute: 540, endMinute: 720 },
    ]) as never;
    /*
     * A FUTURE window, and computed rather than hardcoded: slotsFor drops
     * slots that have already ended using the real clock, so a fixed date in
     * this file becomes a passing-then-failing test the day it goes past. The
     * first upcoming Monday is always in the future.
     */
    const { from, to } = nextMonday();
    const slots = await h.svc.slotsFor('A1', from, to);
    // 09:00-12:00 with 45+15 stride: 09:00, 10:00, 11:00. Each 45 minutes long.
    expect(slots).toHaveLength(3);
    expect(slots[0]!.endsAt.getTime() - slots[0]!.startsAt.getTime()).toBe(45 * 60_000);
  });

  it('only fetches blocks that could touch the window', async () => {
    const h = harness();
    const { from, to } = nextMonday();
    await h.svc.slotsFor('A1', from, to);
    const q = arg<{ where: Record<string, unknown> }>(h.prisma.availabilityBlock.findMany, 0, 0);
    expect(q.where).toMatchObject({ astrologerId: 'A1' });
  });
});

describe('5.3 — availability must not orphan a paid booking', () => {
  /** A Monday 10:00-10:30 IST booking, well in the future. */
  function futureMonday() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 14);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    // 10:00 IST = 04:30 UTC on that date.
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4, 30));
    return { slotStart: start, slotEnd: new Date(start.getTime() + 30 * 60_000) };
  }

  const booked = (status: string) => ({ id: 'B1', status, ...futureMonday() });
  const mondayMorning = win(1, 9 * 60, 13 * 60);

  it('REFUSES a rule change that would strand a confirmed booking', async () => {
    const h = harness(ASTROLOGER, { bookings: [booked('confirmed')] });
    // The astrologer drops Mondays. Someone has paid for Monday 10:00.
    await expect(h.svc.replaceRules('A1', [win(2, 9 * 60, 13 * 60)], {})).rejects.toThrow(ConflictException);
    // And refuses BEFORE clearing the grid.
    expect(h.tx.availabilityRule.deleteMany).not.toHaveBeenCalled();
  });

  it('names the stranded bookings so the operator knows what to move', async () => {
    const h = harness(ASTROLOGER, { bookings: [booked('confirmed')] });
    await expect(h.svc.replaceRules('A1', [], {})).rejects.toThrow(/paid booking/i);
  });

  it('ALLOWS a change that still covers the booking', async () => {
    const h = harness(ASTROLOGER, { bookings: [booked('confirmed')] });
    await expect(h.svc.replaceRules('A1', [mondayMorning], {})).resolves.toBeDefined();
  });

  it('allows a change that only strands an UNPAID hold', async () => {
    const h = harness(ASTROLOGER, { bookings: [booked('held')] });
    // A hold is someone mid-checkout and lapses on its own. Blocking an
    // astrologer from changing their hours over one would be worse.
    await expect(h.svc.replaceRules('A1', [win(2, 9 * 60, 13 * 60)], {})).resolves.toBeDefined();
  });

  it('REFUSES a block placed over a paid booking', async () => {
    const h = harness(ASTROLOGER, { bookings: [booked('confirmed')] });
    h.prisma.availabilityRule.findMany = vi.fn(async () => [
      { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
    ]) as never;
    const { slotStart } = futureMonday();
    await expect(
      h.svc.addBlock('A1', {
        startsAt: new Date(slotStart.getTime() - 3_600_000),
        endsAt: new Date(slotStart.getTime() + 3_600_000),
      }, {}),
    ).rejects.toThrow(ConflictException);
    expect(h.tx.availabilityBlock.create).not.toHaveBeenCalled();
  });

  it('allows a block on a day with no bookings', async () => {
    const h = harness(ASTROLOGER, { bookings: [booked('confirmed')] });
    h.prisma.availabilityRule.findMany = vi.fn(async () => [
      { weekday: 1, startMinute: 9 * 60, endMinute: 13 * 60 },
    ]) as never;
    const { slotStart } = futureMonday();
    // A week later — nothing booked there.
    await expect(
      h.svc.addBlock('A1', {
        startsAt: new Date(slotStart.getTime() + 7 * 86_400_000),
        endsAt: new Date(slotStart.getTime() + 7 * 86_400_000 + 3_600_000),
      }, {}),
    ).resolves.toBeDefined();
  });

  it('asks only for future bookings that still occupy their slot', async () => {
    const h = harness(ASTROLOGER, { bookings: [] });
    await h.svc.replaceRules('A1', [], {});
    const q = arg<{ where: { status: { in: string[] }; slotStart: { gte: Date } } }>(
      h.prisma.booking.findMany, 0, 0);

    // Cancelled and expired bookings released their slot and cannot be
    // orphaned by anything.
    expect(q.where.status.in).toEqual(['held', 'confirmed']);

    /*
     * And the PAST is excluded in the QUERY, which is the only place it can be
     * tested here: a consultation that already happened cannot be orphaned by
     * tomorrow's schedule, and refusing on those grounds would freeze the
     * calendar for ever.
     *
     * An earlier version of this file asserted the behaviour by handing the
     * service a past booking and expecting it to be ignored — but the test
     * double returns whatever it is given regardless of the where clause, so
     * that test was checking the double, not the code. The database applies
     * this filter; the assertion that it was ASKED for is the honest one.
     */
    expect(q.where.slotStart.gte).toBeInstanceOf(Date);
    expect(q.where.slotStart.gte.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

/**
 * FOUND BY EXERCISING THE REAL ENDPOINT during Phase 6.
 *
 * generateSlots knows only about rules and blocks — it describes when the
 * astrologer WORKS, not when they are FREE. The public list was therefore
 * offering times that were already sold, and every customer who picked one was
 * told to choose again. Not a safety problem (the unique index on the generated
 * column is what prevents the double booking) but it is the difference between
 * a calendar and a lottery.
 */
describe('slots already sold are not offered', () => {
  const { from, to } = nextMonday();
  const rules = [win(1, 540, 660)]; // Monday 09:00-11:00 IST -> 4 half-hour slots

  function slotHarness(bookings: Record<string, unknown>[] = []) {
    const h = harness(ASTROLOGER, { bookings });
    h.prisma.availabilityRule.findMany = vi.fn(async () => rules) as never;
    return h;
  }

  it('offers every slot when nothing is booked', async () => {
    const h = slotHarness();
    expect(await h.svc.slotsFor('A1', from, to)).toHaveLength(4);
  });

  it('removes a slot an occupying booking holds', async () => {
    const all = await slotHarness().svc.slotsFor('A1', from, to);
    const taken = all[1]!.startsAt;
    const h = slotHarness([{ slotStart: taken }]);
    const left = await h.svc.slotsFor('A1', from, to);
    expect(left).toHaveLength(3);
    expect(left.map((s) => s.startsAt.getTime())).not.toContain(taken.getTime());
  });

  it('asks only for OCCUPYING statuses — book, cancel, rebook must work (ADR-029)', async () => {
    const h = slotHarness();
    await h.svc.slotsFor('A1', from, to);
    const calls = (h.prisma.booking.findMany as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const where = (calls[0]![0] as { where: { status: { notIn: string[] } } }).where;
    // Mirrors the generated column's CASE. A cancelled booking must return its
    // slot to sale, which is the entire point of the NULL-when-inactive trick.
    expect(where.status.notIn).toEqual(['cancelled', 'expired']);
  });
});
