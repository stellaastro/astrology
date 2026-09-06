import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service';

/**
 * Pulls `data` out of the first create() call, with a real error if the mock
 * was never called. noUncheckedIndexedAccess makes calls[0] possibly-undefined,
 * which is correct — asserting it away with ! would hide a genuine failure.
 */
function firstCreateData(fn: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = fn.mock.calls[0];
  if (!call) throw new Error('expected auditEvent.create to have been called');
  return (call[0] as { data: Record<string, unknown> }).data;
}

/** Minimal stand-in for the Prisma transaction client. */
const makeTx = (createImpl?: () => Promise<unknown>) => ({
  auditEvent: { create: vi.fn(createImpl ?? (async () => ({}))) },
});

describe('AuditService', () => {
  let svc: AuditService;

  beforeEach(() => {
    svc = new AuditService();
  });

  it('writes an event and returns its ULID', async () => {
    const tx = makeTx();
    const id = await svc.record(tx as never, {
      action: 'lead.read',
      targetType: 'Lead',
      targetId: 'abc',
    });

    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID, Crockford base32
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    const data = firstCreateData(tx.auditEvent.create);
    expect(data.action).toBe('lead.read');
    expect(data.targetType).toBe('Lead');
    expect(data.targetId).toBe('abc');
    expect(data.id).toBe(id);
  });

  it('records the actor: who, from where, in which session', async () => {
    const tx = makeTx();
    await svc.record(tx as never, {
      action: 'lead.export',
      targetType: 'Lead',
      actor: {
        id: 'user-1',
        role: 'admin:super',
        ip: '203.0.113.9',
        sessionId: 'sess-1',
      },
    });

    const data = firstCreateData(tx.auditEvent.create);
    expect(data.actorId).toBe('user-1');
    expect(data.actorRole).toBe('admin:super');
    expect(data.ip).toBe('203.0.113.9');
    expect(data.sessionId).toBe('sess-1');
  });

  it('captures before and after state for mutations', async () => {
    const tx = makeTx();
    await svc.record(tx as never, {
      action: 'astrologer.rate.change',
      targetType: 'Astrologer',
      targetId: 'a-1',
      before: { ratePaise: 100000 },
      after: { ratePaise: 150000 },
      reason: 'Owner approved increase',
    });

    const data = firstCreateData(tx.auditEvent.create);
    expect(data.before).toEqual({ ratePaise: 100000 });
    expect(data.after).toEqual({ ratePaise: 150000 });
    expect(data.reason).toBe('Owner approved increase');
  });

  it('normalises absent optional fields to null, not undefined', async () => {
    // undefined would make Prisma omit the column rather than write NULL,
    // which reads identically in most code but differently in a query.
    const tx = makeTx();
    await svc.record(tx as never, { action: 'a', targetType: 'T' });

    const data = firstCreateData(tx.auditEvent.create);
    for (const k of ['actorId', 'actorRole', 'targetId', 'reason', 'ip', 'sessionId']) {
      expect(data[k], k).toBeNull();
    }
  });

  /**
   * The finding this service exists for. A silent audit failure was the one
   * "critical gap" the plan review flagged as fail-invisible.
   */
  describe('when the audit write fails', () => {
    it('rethrows so the enclosing transaction aborts', async () => {
      const boom = new Error('audit_events is not writable');
      const tx = makeTx(async () => {
        throw boom;
      });

      await expect(
        svc.record(tx as never, { action: 'lead.create', targetType: 'Lead' }),
      ).rejects.toThrow('audit_events is not writable');
    });

    it('never resolves to a sentinel value that a caller might ignore', async () => {
      const tx = makeTx(async () => {
        throw new Error('denied');
      });

      const result = await svc
        .record(tx as never, { action: 'x', targetType: 'Y' })
        .then(
          () => 'RESOLVED',
          () => 'REJECTED',
        );

      // If this ever reads RESOLVED, an unrecordable action could complete.
      expect(result).toBe('REJECTED');
    });
  });

  it('generates distinct, time-ordered ids for successive events', async () => {
    const tx = makeTx();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await svc.record(tx as never, { action: 'a', targetType: 'T' }));
    }
    expect(new Set(ids).size).toBe(5);
    // ULIDs are lexicographically sortable by generation time.
    expect([...ids].sort()).toEqual(ids);
  });
});
