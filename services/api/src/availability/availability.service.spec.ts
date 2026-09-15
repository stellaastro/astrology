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

function harness(astrologer: Record<string, unknown> | null = ASTROLOGER) {
  const tx = {
    availabilityRule: { deleteMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    availabilityBlock: { create: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) },
  };
  const prisma = {
    astrologer: { findUnique: vi.fn(async () => astrologer) },
    availabilityRule: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    availabilityBlock: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
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
