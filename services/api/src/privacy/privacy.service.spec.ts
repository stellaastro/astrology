import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PrivacyService } from './privacy.service';

/**
 * The two properties that matter most here, and why:
 *
 *  - The request endpoint must not become a way to ask whether a named person
 *    is on an astrology waitlist. So an unknown address must do NOTHING —
 *    no row, no mail, no audit event — because every one of those is a
 *    side-channel someone could time or observe.
 *
 *  - Erasure must be complete. Three places held a copy of the address, and
 *    the tests below pin all three: the lead row, the outbox payload, and the
 *    audit event. The audit one is the trap, because the audit log is
 *    append-only — anything written there cannot be erased afterwards.
 */

/*
 * The double CARRIES an address on purpose. An earlier version of this file
 * used { id, locale } only, which meant the "no address in the audit event"
 * tests could not fail: there was no address present to leak. Verified by
 * writing the leak back in and watching them go red.
 */
/**
 * Reads one argument from one recorded call.
 *
 * vi.fn() infers a zero-length argument tuple for `async () => x`, so indexing
 * calls[0][0] is a type error under this tsconfig even though it is exactly
 * what the assertion needs. Going through unknown is the same trick
 * leads.service.spec.ts uses, and the throw keeps a never-called mock from
 * surfacing as a confusing undefined instead of a clear failure.
 */
function arg<T>(fn: unknown, call: number, index: number): T {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected the mock to have been called at least ${call + 1} time(s)`);
  return c[index] as T;
}

const LEAD = { id: 'L1', locale: 'hi', email: 'a@example.invalid' };

function harness(lead: { id: string; locale: string } | null = LEAD) {
  const tx = {
    privacyRequest: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    lead: { delete: vi.fn(async () => ({})) },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  const prisma = {
    lead: { findUnique: vi.fn(async () => lead) },
    privacyRequest: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx)),
  };
  const audit = { record: vi.fn(async () => 'A1') };
  const outbox = { enqueue: vi.fn(async () => 'O1') };
  const svc = new PrivacyService(prisma as never, audit as never, outbox as never);
  return { svc, prisma, tx, audit, outbox };
}

/** Every argument any spy was called with, flattened to one string. */
const allArgs = (...spies: { mock: { calls: unknown[][] } }[]): string =>
  JSON.stringify(spies.flatMap((s) => s.mock.calls));

describe('PrivacyService.open', () => {
  it('does nothing at all for an address we do not hold', async () => {
    const h = harness(null);
    await h.svc.open('nobody@example.invalid', 'access', {});
    // No row, no mail, no audit — each of these would be an oracle.
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.outbox.enqueue).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('normalises the address before looking it up', async () => {
    const h = harness();
    await h.svc.open('  A@Example.Invalid  ', 'access', {});
    expect(h.prisma.lead.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'a@example.invalid' } }),
    );
  });

  it('stores only the HASH of the token, and emails the raw one', async () => {
    const h = harness();
    await h.svc.open('a@example.invalid', 'erasure', { ip: '203.0.113.9' });

    const stored = arg<{ data: Record<string, string> }>(h.tx.privacyRequest.create, 0, 0);
    const mailed = arg<{ token: string }>(h.outbox.enqueue, 0, 2);

    expect(stored.data.tokenHash).toHaveLength(64);
    expect(stored.data.tokenHash).toBe(createHash('sha256').update(mailed.token).digest('hex'));
    // The raw token must never be what is written down.
    expect(stored.data.tokenHash).not.toBe(mailed.token);
  });

  it('never writes the address into the audit event', async () => {
    const h = harness();
    await h.svc.open('a@example.invalid', 'access', {});
    expect(allArgs(h.audit.record)).not.toContain('@');
  });

  it('sets an expiry in the future', async () => {
    const h = harness();
    await h.svc.open('a@example.invalid', 'access', {});
    const stored = arg<{ data: { expiresAt: Date } }>(h.tx.privacyRequest.create, 0, 0);
    expect(stored.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('PrivacyService.resolve', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'P1',
    leadId: 'L1',
    kind: 'erasure',
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    ...over,
  });

  it('returns null for an empty or unknown token', async () => {
    const h = harness();
    await expect(h.svc.resolve('')).resolves.toBeNull();
    await expect(h.svc.resolve('nope')).resolves.toBeNull();
  });

  it('looks the token up by hash, never by value', async () => {
    const h = harness();
    await h.svc.resolve('some-token');
    expect(h.prisma.privacyRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: createHash('sha256').update('some-token').digest('hex') },
      }),
    );
  });

  it('refuses an already-used link', async () => {
    const h = harness();
    h.prisma.privacyRequest.findUnique = vi.fn(async () => row({ completedAt: new Date() })) as never;
    await expect(h.svc.resolve('t')).resolves.toBeNull();
  });

  it('refuses an expired link', async () => {
    const h = harness();
    h.prisma.privacyRequest.findUnique = vi.fn(async () => row({ expiresAt: new Date(Date.now() - 1) })) as never;
    await expect(h.svc.resolve('t')).resolves.toBeNull();
  });

  it('accepts a live, unused link', async () => {
    const h = harness();
    h.prisma.privacyRequest.findUnique = vi.fn(async () => row()) as never;
    await expect(h.svc.resolve('t')).resolves.toEqual({ id: 'P1', leadId: 'L1', kind: 'erasure' });
  });
});

describe('PrivacyService.erase', () => {
  it('returns false when there is nothing to erase', async () => {
    const h = harness(null);
    await expect(h.svc.erase('P1', 'L1', {})).resolves.toBe(false);
    expect(h.tx.lead.delete).not.toHaveBeenCalled();
  });

  it('deletes the lead', async () => {
    const h = harness();
    await expect(h.svc.erase('P1', 'L1', {})).resolves.toBe(true);
    expect(h.tx.lead.delete).toHaveBeenCalledWith({ where: { id: 'L1' } });
  });

  it('purges the outbox rows that carry the address', async () => {
    const h = harness();
    await h.svc.erase('P1', 'L1', {});
    const sql = arg<string>(h.tx.$executeRawUnsafe, 0, 0);
    expect(sql).toMatch(/DELETE FROM outbox_messages/i);
    expect(arg<string>(h.tx.$executeRawUnsafe, 0, 1)).toBe('L1');
  });

  it('writes the audit event BEFORE deleting, so a failed write aborts', async () => {
    const order: string[] = [];
    const h = harness();
    h.audit.record = vi.fn(async () => { order.push('audit'); return 'A1'; }) as never;
    h.tx.lead.delete = vi.fn(async () => { order.push('delete'); return {}; }) as never;
    await h.svc.erase('P1', 'L1', {});
    expect(order).toEqual(['audit', 'delete']);
  });

  it('leaves NO trace of the address in the audit event', async () => {
    const h = harness();
    await h.svc.erase('P1', 'L1', {});
    const written = allArgs(h.audit.record);
    expect(written).not.toContain('@');
    // Not a hash of it either: a SHA-256 of an address is reversible for any
    // address someone already suspects, which is the residue erasure removes.
    expect(written).not.toMatch(/[0-9a-f]{64}/);
    expect(written).toContain('lead.erased');
  });
});

describe('PrivacyService.exportFor', () => {
  const lead = {
    id: 'L1', email: 'a@example.invalid', phone: null, locale: 'hi', source: null,
    referralCode: null, utmSource: null, utmMedium: null, utmCampaign: null,
    consentAt: new Date('2026-01-01T00:00:00Z'), consentPolicyVersion: 'v1',
    confirmedAt: null, turnstileBypassed: false, ip: '203.0.113.1', userAgent: 'UA',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('returns everything held, including the IP and user agent', async () => {
    const h = harness();
    h.prisma.lead.findUnique = vi.fn(async () => lead) as never;
    const out = await h.svc.exportFor('P1', 'L1', {});
    // An access response that quietly drops the technical fields is not one.
    expect(out).toMatchObject({
      email: 'a@example.invalid',
      ip: '203.0.113.1',
      userAgent: 'UA',
      consent: { at: '2026-01-01T00:00:00.000Z', policyVersion: 'v1' },
    });
  });

  it('burns the link so it cannot be replayed from the mailbox', async () => {
    const h = harness();
    h.prisma.lead.findUnique = vi.fn(async () => lead) as never;
    await h.svc.exportFor('P1', 'L1', {});
    const upd = arg<{ data: { completedAt: Date } }>(h.tx.privacyRequest.update, 0, 0);
    expect(upd.data.completedAt).toBeInstanceOf(Date);
  });
});
