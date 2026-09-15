import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AstrologersService } from './astrologers.service';
import type { CreateAstrologerDto } from './astrologer.dto';

/**
 * Two properties carry this file:
 *
 *  1. THE PUBLIC ROSTER IS REAL OR EMPTY. A fixture must never reach it, and
 *     neither must a draft or a retired practitioner. §13 and §71 forbid an
 *     invented practitioner on a registered company's site — a customer could
 *     otherwise try to book a person who does not exist.
 *
 *  2. THE RATE NEVER BECOMES A FLOAT. It arrives as a string, is parsed by
 *     Money, and is stored as integer paise. "1250.50" must land as 125050,
 *     not 125049.99999.
 */

function arg<T>(fn: unknown, call: number, index: number): T {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected the mock to have been called at least ${call + 1} time(s)`);
  return c[index] as T;
}

const ROW = {
  id: 'A1', slug: 'aditya-verma', nameHi: 'आदित्य', nameEn: 'Aditya Verma',
  headline: null, bio: null, experienceYears: 10,
  languages: ['hi', 'en'], specialisations: ['kundli'],
  sessionRatePaise: 125050, sessionMinutes: 30,
  publishedAt: null, retiredAt: null, isDevFixture: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function harness(found: Record<string, unknown> | null = ROW) {
  const tx = { astrologer: { create: vi.fn(async () => ROW), update: vi.fn(async () => ROW) } };
  const prisma = {
    astrologer: {
      findMany: vi.fn(async () => [ROW]),
      findUnique: vi.fn(async () => found),
      create: vi.fn(async () => ROW),
      update: vi.fn(async () => ROW),
    },
    $transaction: vi.fn(async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx)),
  };
  const audit = { record: vi.fn(async () => 'AE1') };
  const svc = new AstrologersService(prisma as never, audit as never);
  return { svc, prisma, tx, audit };
}

const dto = (over: Partial<CreateAstrologerDto> = {}): CreateAstrologerDto =>
  ({
    slug: 'aditya-verma', nameHi: 'आदित्य', nameEn: 'Aditya Verma',
    experienceYears: 10, languages: ['hi'], specialisations: ['kundli'],
    sessionRate: '1250.50', sessionMinutes: 30, ...over,
  }) as CreateAstrologerDto;

describe('the public roster is real or empty', () => {
  it('asks for published, non-retired, non-fixture rows only', async () => {
    const h = harness();
    await h.svc.listPublic();
    const q = arg<{ where: Record<string, unknown> }>(h.prisma.astrologer.findMany, 0, 0);
    expect(q.where.publishedAt).toEqual({ not: null });
    expect(q.where.retiredAt).toBeNull();
    // Belt AND braces: the boot guard only protects production, so without
    // this a development demo would show invented practitioners and look right.
    expect(q.where.isDevFixture).toBe(false);
  });

  it('refuses to publish development fixture data', async () => {
    const h = harness({ ...ROW, isDevFixture: true });
    await expect(h.svc.setPublished('A1', true, {})).rejects.toThrow(ConflictException);
    expect(h.tx.astrologer.update).not.toHaveBeenCalled();
  });

  it('refuses to publish a retired astrologer', async () => {
    const h = harness({ ...ROW, retiredAt: new Date() });
    await expect(h.svc.setPublished('A1', true, {})).rejects.toThrow(ConflictException);
  });

  it('allows UNpublishing a fixture — only publishing is restricted', async () => {
    const h = harness({ ...ROW, isDevFixture: true, publishedAt: new Date() });
    await expect(h.svc.setPublished('A1', false, {})).resolves.toEqual({ id: 'A1', published: false });
  });

  it('creates every profile as a draft', async () => {
    const h = harness();
    await h.svc.create(dto(), {});
    const data = arg<{ data: Record<string, unknown> }>(h.tx.astrologer.create, 0, 0).data;
    // Nothing reaches the public site as a side effect of being typed in.
    expect(data.publishedAt).toBeNull();
  });
});

describe('the rate never becomes a float', () => {
  it('stores "1250.50" as 125050 paise', async () => {
    const h = harness();
    await h.svc.create(dto({ sessionRate: '1250.50' }), {});
    expect(arg<{ data: { sessionRatePaise: number } }>(h.tx.astrologer.create, 0, 0).data.sessionRatePaise)
      .toBe(125050);
  });

  it.each([
    ['1250', 125000],
    ['1250.5', 125050],
    ['0.01', 1],
    ['249975.99', 24997599],
  ])('parses %s to %i paise', async (input, paise) => {
    const h = harness();
    await h.svc.create(dto({ sessionRate: input }), {});
    expect(arg<{ data: { sessionRatePaise: number } }>(h.tx.astrologer.create, 0, 0).data.sessionRatePaise)
      .toBe(paise);
  });

  it('rejects a rate of zero rather than storing a free consultation', async () => {
    const h = harness();
    await expect(h.svc.create(dto({ sessionRate: '0' }), {})).rejects.toThrow(ConflictException);
    expect(h.tx.astrologer.create).not.toHaveBeenCalled();
  });

  it('refuses sub-paise precision instead of rounding it quietly', async () => {
    const h = harness();
    // Money.fromString is the guard; the DTO regex is the other half.
    await expect(h.svc.create(dto({ sessionRate: '10.001' }), {})).rejects.toThrow();
  });

  it('returns the canonical paise integer AND a display string', async () => {
    const h = harness();
    h.prisma.astrologer.findMany = vi.fn(async () => [{ ...ROW, publishedAt: new Date() }]) as never;
    const [out] = await h.svc.listPublic();
    // The integer is the truth a client should compute with.
    expect(out?.sessionRatePaise).toBe(125050);
    // The string is for rendering only — note it is localised, which is
    // precisely why it must not be the only thing returned.
    expect(out?.sessionRateDisplay).toBe('₹1,250.50');
  });
});

describe('audit', () => {
  it('records a rate change with BOTH sides', async () => {
    const h = harness();
    await h.svc.update('A1', { sessionRate: '2000.00' }, {});
    const entry = arg<{ before?: unknown; after?: unknown; action: string }>(h.audit.record, 0, 1);
    expect(entry.action).toBe('astrologer.updated');
    // "What did this cost last month" must be answerable from the trail.
    expect(entry.before).toEqual({ sessionRatePaise: 125050 });
    expect(entry.after).toEqual({ sessionRatePaise: 200000 });
  });

  it('audits publishing separately from editing', async () => {
    const h = harness();
    await h.svc.setPublished('A1', true, {});
    expect(arg<{ action: string }>(h.audit.record, 0, 1).action).toBe('astrologer.published');
  });

  it('404s for an astrologer that does not exist', async () => {
    const h = harness(null);
    await expect(h.svc.update('nope', { nameEn: 'x' }, {})).rejects.toThrow(NotFoundException);
    await expect(h.svc.setPublished('nope', true, {})).rejects.toThrow(NotFoundException);
  });
});
