import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FixtureGuard } from './fixture-guard';

const makePrisma = (fixtureCount: number) => ({
  lead: { count: vi.fn(async () => fixtureCount) },
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
});
