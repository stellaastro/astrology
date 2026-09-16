import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Retention deletes people's records on a timer, so the tests that matter are
 * the ones about what it must NOT delete.
 *
 * The module reads its horizons at import time, so each case re-imports with
 * the environment it needs rather than mutating a shared constant.
 */
/** See the note on the same helper in privacy.service.spec.ts. */
function whereOf(fn: unknown, call = 0): Record<string, unknown> {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected the mock to have been called at least ${call + 1} time(s)`);
  return (c[0] as { where: Record<string, unknown> }).where;
}

const saved = { ...process.env };

async function load(env: Record<string, string> = {}) {
  process.env = { ...saved, ...env };
  vi.resetModules();
  const mod = await import('./retention.service');
  const prisma = {
    lead: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    outboxMessage: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    privacyRequest: { deleteMany: vi.fn(async () => ({ count: 3 })) },
  };
  return { svc: new mod.RetentionService(prisma as never), prisma, RetentionService: mod.RetentionService };
}

afterEach(() => { process.env = { ...saved }; });

describe('RetentionService', () => {
  it('never reaps development fixtures', async () => {
    const h = await load();
    await h.svc.purge();
    for (let i = 0; i < h.prisma.lead.deleteMany.mock.calls.length; i++) {
      const where = whereOf(h.prisma.lead.deleteMany, i);
      // A dev seed is not anyone's personal data, and silently reaping the
      // synthetic roster mid-phase would look like a bug in that phase.
      expect(where.isDevFixture).toBe(false);
    }
  });

  it('deletes unconfirmed leads past the horizon', async () => {
    const h = await load({ RETENTION_UNCONFIRMED_LEAD_DAYS: '30' });
    const res = await h.svc.purge();
    expect(res.unconfirmedLeads).toBe(1);
    expect(whereOf(h.prisma.lead.deleteMany).confirmedAt).toBeNull();
  });

  it('does NOT delete confirmed leads by default', async () => {
    const h = await load();
    const res = await h.svc.purge();
    // Someone who confirmed asked to be told when bookings open. Deleting them
    // on an invented horizon would silently break the waitlist's only promise,
    // so the mechanism ships switched off until the owner sets a number.
    expect(res.confirmedLeads).toBe(0);
    expect(h.prisma.lead.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('deletes confirmed leads once a horizon is set', async () => {
    const h = await load({ RETENTION_CONFIRMED_LEAD_DAYS: '365' });
    const res = await h.svc.purge();
    expect(res.confirmedLeads).toBe(1);
    expect(h.prisma.lead.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('only purges outbox rows that were actually delivered', async () => {
    const h = await load();
    await h.svc.purge();
    const processedAt = whereOf(h.prisma.outboxMessage.deleteMany).processedAt as { not?: unknown };
    // An undelivered message still has work to do, however old it is.
    expect(processedAt.not).toBeNull();
  });

  it('can be switched off entirely', async () => {
    const h = await load({
      RETENTION_UNCONFIRMED_LEAD_DAYS: '0',
      RETENTION_DELIVERED_OUTBOX_DAYS: '0',
      RETENTION_PRIVACY_REQUEST_DAYS: '0',
    });
    const res = await h.svc.purge();
    expect(res).toEqual({ unconfirmedLeads: 0, confirmedLeads: 0, outboxMessages: 0, privacyRequests: 0 });
    expect(h.prisma.lead.deleteMany).not.toHaveBeenCalled();
  });

  it('reports the horizons in force', async () => {
    const h = await load({ RETENTION_UNCONFIRMED_LEAD_DAYS: '14' });
    expect(h.RetentionService.horizons().unconfirmedLeadDays).toBe(14);
  });
});
