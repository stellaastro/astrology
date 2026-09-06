import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeadsService, UNIFORM_RESPONSE } from './leads.service';
import type { CreateLeadDto } from './create-lead.dto';

const dto = (over: Partial<CreateLeadDto> = {}): CreateLeadDto =>
  ({ email: 'a@example.invalid', consent: true, ...over }) as CreateLeadDto;

/**
 * Reads `data` from a mock's first call. noUncheckedIndexedAccess makes
 * calls[0] possibly-undefined, which is correct — a bare `!` would hide a
 * mock that was never called and turn a real failure into a confusing one.
 */
function firstData(fn: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = fn.mock.calls[0];
  if (!call) throw new Error('expected the mock to have been called');
  return (call[0] as { data: Record<string, unknown> }).data;
}

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '6' });

function harness(opts: { txImpl?: (cb: unknown) => Promise<unknown> } = {}) {
  const created = { id: 'L1', email: 'a@example.invalid', locale: 'hi' };
  const tx = {
    lead: { create: vi.fn(async () => created), update: vi.fn(async () => created) },
  };
  const prisma = {
    $transaction: vi.fn(opts.txImpl ?? (async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx))),
    lead: { findUnique: vi.fn(async () => null) },
  };
  const audit = { record: vi.fn(async () => 'A1') };
  const outbox = { enqueue: vi.fn(async () => 'O1') };
  const turnstile = { verify: vi.fn(async () => ({ verdict: 'pass' as const })) };
  const svc = new LeadsService(prisma as never, audit as never, outbox as never, turnstile as never);
  return { svc, prisma, tx, audit, outbox, turnstile, created };
}

describe('LeadsService.create', () => {
  it('creates a lead and returns the uniform response', async () => {
    const h = harness();
    await expect(h.svc.create(dto(), '203.0.113.1', 'UA')).resolves.toEqual(UNIFORM_RESPONSE);
    expect(h.tx.lead.create).toHaveBeenCalledOnce();
  });

  it('stores consent as a timestamp plus a policy version, never a bare boolean', async () => {
    const h = harness();
    await h.svc.create(dto());
    const data = firstData(h.tx.lead.create);
    expect(data.consentAt).toBeInstanceOf(Date);
    expect(data.consentPolicyVersion).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('queues the confirmation email INSIDE the transaction', async () => {
    const h = harness();
    await h.svc.create(dto());
    // Must receive the tx client, not the base client: a rolled-back signup
    // cannot be allowed to leave a queued email.
    expect(h.outbox.enqueue).toHaveBeenCalledWith(h.tx, 'lead.confirm', expect.anything());
  });

  it('writes an audit event for the creation', async () => {
    const h = harness();
    await h.svc.create(dto(), '203.0.113.9');
    expect(h.audit.record).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ action: 'lead.create', targetType: 'Lead' }),
    );
  });

  it('issues a 43-character confirmation token', async () => {
    const h = harness();
    await h.svc.create(dto());
    const data = firstData(h.tx.lead.create) as Record<string, string>;
    expect(data.confirmationToken).toHaveLength(43);
  });

  /* ── The enumeration fix ────────────────────────────────────── */

  it('returns the SAME response for a duplicate address', async () => {
    const h = harness({ txImpl: async () => { throw knownError('P2002'); } });
    const res = await h.svc.create(dto());
    expect(res).toEqual(UNIFORM_RESPONSE);
  });

  it('does not resend on a duplicate, so the form cannot mail-bomb an address', async () => {
    const h = harness({ txImpl: async () => { throw knownError('P2002'); } });
    await h.svc.create(dto());
    expect(h.outbox.enqueue).not.toHaveBeenCalled();
  });

  /* ── Turnstile: fail vs degraded ────────────────────────────── */

  it('accepts the signup when Turnstile times out, flagging the row', async () => {
    const h = harness();
    h.turnstile.verify.mockResolvedValueOnce({ verdict: 'degraded', reason: 'timeout' } as never);
    await h.svc.create(dto());
    const data = firstData(h.tx.lead.create);
    expect(data.turnstileBypassed).toBe(true);
    // A Cloudflare outage must not take down the only signup path.
    expect(h.tx.lead.create).toHaveBeenCalledOnce();
  });

  it('rejects when Turnstile actively fails, without creating a row', async () => {
    const h = harness();
    h.turnstile.verify.mockResolvedValueOnce({ verdict: 'fail', reason: 'invalid-input-response' } as never);
    const res = await h.svc.create(dto());
    expect(h.tx.lead.create).not.toHaveBeenCalled();
    // Same response shape: telling a bot which check it failed helps it pass.
    expect(res).toEqual(UNIFORM_RESPONSE);
  });

  /* ── Referral codes are advisory ────────────────────────────── */

  it('ignores a malformed referral code rather than failing the signup', async () => {
    const h = harness();
    await expect(h.svc.create(dto({ referralCode: 'not a code!!' }))).resolves.toEqual(UNIFORM_RESPONSE);
    const data = firstData(h.tx.lead.create);
    expect(data.referralCode).toBeNull();
  });

  it('keeps a well-formed referral code', async () => {
    const h = harness();
    await h.svc.create(dto({ referralCode: 'DEV-REF_01' }));
    const data = firstData(h.tx.lead.create);
    expect(data.referralCode).toBe('DEV-REF_01');
  });

  /* ── Database failures say something true, never a raw 500 ──── */

  it.each([
    ['P1001', 'unreachable'],
    ['P1002', 'timed out'],
    ['P2024', 'pool exhausted'],
  ])('surfaces %s (%s) as a 503 with a usable message', async (code) => {
    const h = harness({ txImpl: async () => { throw knownError(code); } });
    await expect(h.svc.create(dto())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  /* ── The critical one ───────────────────────────────────────── */

  it('does NOT report success when the audit write fails', async () => {
    // AuditService rethrows, the transaction rolls back, no lead exists.
    // Returning UNIFORM_RESPONSE here would tell someone they had joined a
    // list they are not on — the fail-invisible case the review flagged.
    const h = harness({ txImpl: async () => { throw new Error('audit_events is not writable'); } });
    await expect(h.svc.create(dto())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('LeadsService.confirm', () => {
  it('confirms an unconfirmed lead', async () => {
    const h = harness();
    h.prisma.lead.findUnique.mockResolvedValueOnce({ id: 'L1', confirmedAt: null } as never);
    await expect(h.svc.confirm('t'.repeat(43))).resolves.toEqual({ status: 'confirmed' });
  });

  it('reports an already-confirmed lead truthfully rather than pretending', async () => {
    const h = harness();
    h.prisma.lead.findUnique.mockResolvedValueOnce({ id: 'L1', confirmedAt: new Date() } as never);
    await expect(h.svc.confirm('t'.repeat(43))).resolves.toEqual({ status: 'already' });
  });

  it('reports an unknown token as invalid, not as success', async () => {
    const h = harness();
    h.prisma.lead.findUnique.mockResolvedValueOnce(null as never);
    await expect(h.svc.confirm('t'.repeat(43))).resolves.toEqual({ status: 'invalid' });
  });

  it('keeps the token so a second click is distinguishable from a bad link', async () => {
    const h = harness();
    h.prisma.lead.findUnique.mockResolvedValueOnce({ id: 'L1', confirmedAt: null } as never);
    await h.svc.confirm('t'.repeat(43));
    const data = firstData(h.tx.lead.update);
    expect(data).not.toHaveProperty('confirmationToken');
    expect(data.confirmedAt).toBeInstanceOf(Date);
  });

  it('audits the confirmation', async () => {
    const h = harness();
    h.prisma.lead.findUnique.mockResolvedValueOnce({ id: 'L1', confirmedAt: null } as never);
    await h.svc.confirm('t'.repeat(43));
    expect(h.audit.record).toHaveBeenCalledWith(h.tx, expect.objectContaining({ action: 'lead.confirm' }));
  });
});
