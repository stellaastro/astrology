import { describe, it, expect, vi, afterEach } from 'vitest';
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

const USER = { id: 'U1', email: 'a@example.invalid', roles: [] as string[] };

function harness(found: Record<string, unknown> | null = ROW, user: typeof USER | null = USER) {
  const tx = {
    astrologer: { create: vi.fn(async () => ROW), update: vi.fn(async () => ROW) },
    user: { update: vi.fn(async () => USER) },
  };
  const prisma = {
    astrologer: {
      findMany: vi.fn(async () => [ROW]),
      findUnique: vi.fn(async () => found),
      create: vi.fn(async () => ROW),
      update: vi.fn(async () => ROW),
    },
    user: { findUnique: vi.fn(async () => user) },
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
    delete process.env.PUBLIC_SHOW_FIXTURES;
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

describe('named but not bookable', () => {
  /*
   * The state the three founding directors are actually in: real, named,
   * already public — and with no price, because that is owner action O3 and it
   * has not arrived. A model that required a rate meant the REAL people could
   * not be entered while twenty invented ones could.
   */
  it('creates a profile with no rate and no experience', async () => {
    const h = harness();
    // The keys are ABSENT, not set to undefined: exactOptionalPropertyTypes
    // treats those as different, and absent is what a real request sends.
    const bare = dto();
    delete (bare as Partial<CreateAstrologerDto>).sessionRate;
    delete (bare as Partial<CreateAstrologerDto>).experienceYears;
    await h.svc.create(bare, {});
    const data = arg<{ data: Record<string, unknown> }>(h.tx.astrologer.create, 0, 0).data;
    expect(data.sessionRatePaise).toBeNull();
    expect(data.experienceYears).toBeNull();
  });

  it('reports such a profile as not bookable, with no invented price', async () => {
    const h = harness();
    h.prisma.astrologer.findMany = vi.fn(async () => [
      { ...ROW, publishedAt: new Date(), sessionRatePaise: null, experienceYears: null },
    ]) as never;
    const [out] = await h.svc.listPublic();
    expect(out?.bookable).toBe(false);
    expect(out?.sessionRatePaise).toBeNull();
    // Not "₹0.00", which would read as a free consultation nobody offered.
    expect(out?.sessionRateDisplay).toBeNull();
    expect(out?.experienceYears).toBeNull();
  });

  it('still refuses a rate of zero — absent and free are different', async () => {
    const h = harness();
    await expect(h.svc.create(dto({ sessionRate: '0' }), {})).rejects.toThrow(ConflictException);
  });

  it('marks a profile WITH a rate as bookable', async () => {
    const h = harness();
    h.prisma.astrologer.findMany = vi.fn(async () => [{ ...ROW, publishedAt: new Date() }]) as never;
    const [out] = await h.svc.listPublic();
    expect(out?.bookable).toBe(true);
    expect(out?.sessionRateDisplay).toBe('₹1,250.50');
  });
});

describe('linking a profile to an account (task 4.2)', () => {
  it('sets the link and grants the astrologer role in ONE transaction', async () => {
    const h = harness();
    const out = await h.svc.linkAccount('A1', 'a@example.invalid', {});
    expect(out.roles).toContain('astrologer');
    expect(h.tx.astrologer.update).toHaveBeenCalledWith({ where: { id: 'A1' }, data: { userId: 'U1' } });
    expect(h.tx.user.update).toHaveBeenCalled();
    // One transaction: a link without a role is someone who cannot reach their
    // own page, and a role without a link is a page that does not know them.
    expect(h.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('keeps roles additive rather than replacing them', async () => {
    const h = harness(ROW, { ...USER, roles: ['admin:support'] });
    const out = await h.svc.linkAccount('A1', 'a@example.invalid', {});
    expect(out.roles).toEqual(['admin:support', 'astrologer']);
  });

  it('refuses when the account does not exist yet', async () => {
    const h = harness(ROW, null);
    // Creating one here would mean inventing a password nobody chose or a
    // Google identity that cannot be verified.
    await expect(h.svc.linkAccount('A1', 'nobody@example.invalid', {})).rejects.toThrow(ConflictException);
    expect(h.tx.astrologer.update).not.toHaveBeenCalled();
  });

  it('refuses to link one account to a second profile', async () => {
    const h = harness();
    h.prisma.astrologer.findUnique = vi.fn(async (q: { where: Record<string, unknown> }) =>
      q.where.userId ? { ...ROW, id: 'OTHER', nameEn: 'Someone Else' } : ROW) as never;
    await expect(h.svc.linkAccount('A1', 'a@example.invalid', {})).rejects.toThrow(/already linked/);
  });

  it('never writes the address into the audit event', async () => {
    const h = harness();
    await h.svc.linkAccount('A1', 'a@example.invalid', {});
    // The audit log holds no personal data (ADR-040); the ULID is what makes
    // the link traceable.
    expect(JSON.stringify(h.audit.record.mock.calls)).not.toContain('@');
  });
});

describe('the astrologer own-profile lookup', () => {
  it('looks up by userId, never by a supplied id', async () => {
    const h = harness();
    h.prisma.astrologer.findUnique = vi.fn(async () => ROW) as never;
    await h.svc.findForUser('U1');
    expect(h.prisma.astrologer.findUnique).toHaveBeenCalledWith({ where: { userId: 'U1' } });
  });

  it('explains what to do when the account is not linked', async () => {
    const h = harness();
    h.prisma.astrologer.findUnique = vi.fn(async () => null) as never;
    await expect(h.svc.findForUser('U9')).rejects.toThrow(/not linked/);
  });
});

describe('PUBLIC_SHOW_FIXTURES', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('is OFF by default — an unset variable must never expose fixtures', async () => {
    delete process.env.PUBLIC_SHOW_FIXTURES;
    const h = harness();
    await h.svc.listPublic();
    expect(arg<{ where: Record<string, unknown> }>(h.prisma.astrologer.findMany, 0, 0).where.isDevFixture)
      .toBe(false);
  });

  it.each(['1', 'yes', 'TRUE', 'development', ''])(
    'stays off for %s — only the exact string "true" opts in',
    async (value) => {
      process.env.PUBLIC_SHOW_FIXTURES = value;
      const h = harness();
      await h.svc.listPublic();
      expect(arg<{ where: Record<string, unknown> }>(h.prisma.astrologer.findMany, 0, 0).where.isDevFixture)
        .toBe(false);
    },
  );

  it('shows fixtures when set to exactly "true"', async () => {
    process.env.PUBLIC_SHOW_FIXTURES = 'true';
    const h = harness();
    await h.svc.listPublic();
    // The key must be ABSENT, not set to true: `isDevFixture: true` would show
    // ONLY fixtures and hide the real roster.
    expect('isDevFixture' in arg<{ where: Record<string, unknown> }>(h.prisma.astrologer.findMany, 0, 0).where)
      .toBe(false);
  });
});
