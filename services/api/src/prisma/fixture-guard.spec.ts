import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FixtureGuard } from './fixture-guard';

/**
 * Both fixture-bearing tables. The guard checked only `leads` until the
 * astrologer roster landed, and a guard that does not know about the table you
 * just added reports "all clear" while the fixtures sit there.
 */
const makePrisma = (leads: number, astrologers = 0) => ({
  lead: { count: vi.fn(async () => leads) },
  astrologer: { count: vi.fn(async () => astrologers) },
});

describe('FixtureGuard', () => {
  const env = { ...process.env };
  // process.exit returns never, which a mock cannot satisfy; the cast keeps
  // the spy usable without weakening anything real.
  let exit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never) as never;
  });
  afterEach(() => {
    process.env = { ...env };
    exit.mockRestore();
  });

  it('does not even query in development', async () => {
    process.env.APP_ENV = 'development';
    const prisma = makePrisma(99);
    await new FixtureGuard(prisma as never).onApplicationBootstrap();
    expect(prisma.lead.count).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('does not fire in test', async () => {
    process.env.APP_ENV = 'test';
    const prisma = makePrisma(5);
    await new FixtureGuard(prisma as never).onApplicationBootstrap();
    expect(exit).not.toHaveBeenCalled();
  });

  it('serves normally in production when there are no fixtures', async () => {
    process.env.APP_ENV = 'production';
    const prisma = makePrisma(0);
    await new FixtureGuard(prisma as never).onApplicationBootstrap();
    expect(prisma.lead.count).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
  });

  /** The behaviour the ADR trades downtime for. */
  it('refuses to serve when fixtures reach production', async () => {
    process.env.APP_ENV = 'production';
    await new FixtureGuard(makePrisma(3) as never).onApplicationBootstrap();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('refuses in staging too — staging gets shared and indexed', async () => {
    process.env.APP_ENV = 'staging';
    await new FixtureGuard(makePrisma(1) as never).onApplicationBootstrap();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('treats an unset environment as unsafe rather than assuming development', async () => {
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;
    await new FixtureGuard(makePrisma(1) as never).onApplicationBootstrap();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('refuses when the fixtures are astrologers and the leads table is clean', async () => {
    // The case the guard missed by construction until Phase 4: a table it did
    // not know to check. A fake practitioner on a registered company's site is
    // someone attempting to book a person who does not exist.
    process.env.APP_ENV = 'production';
    const prisma = makePrisma(0, 20);
    await new FixtureGuard(prisma as never).onApplicationBootstrap();
    expect(prisma.astrologer.count).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
