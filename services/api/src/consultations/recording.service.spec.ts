import { describe, it, expect, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecordingService } from './recording.service';

function arg<T>(fn: unknown, call: number, index: number): T {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const c = calls[call];
  if (!c) throw new Error(`expected at least ${call + 1} call(s)`);
  return c[index] as T;
}

const consent = (party: string, over: Record<string, unknown> = {}) => ({
  id: 'C-' + party, consultationId: 'S1', party, userId: 'U-' + party,
  granted: true, policyVersion: 'v1', decidedAt: new Date(), withdrawnAt: null, ...over,
});

function harness(opts: {
  consents?: Record<string, unknown>[];
  recording?: Record<string, unknown> | null;
  assessment?: Record<string, unknown> | null;
  reviewerProfile?: { id: string } | null;
  modality?: string;
} = {}) {
  const tx = {
    recordingConsent: { upsert: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    recording: { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    consultationAssessment: { update: vi.fn(async () => ({})) },
  };
  const prisma = {
    consultation: {
      findUnique: vi.fn(async () => ({ id: 'S1', modality: opts.modality ?? 'voice' })),
      findMany: vi.fn(async () => []),
    },
    chatMessage: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 3 })),
    },
    recordingConsent: {
      findMany: vi.fn(async () => opts.consents ?? []),
      findUnique: vi.fn(async () => (opts.consents ?? [])[0] ?? null),
    },
    recording: {
      findUnique: vi.fn(async () => (opts.recording === undefined ? null : opts.recording)),
      update: vi.fn(async () => ({})),
    },
    consultationAssessment: {
      findUnique: vi.fn(async () => opts.assessment ?? null),
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    astrologer: { findUnique: vi.fn(async () => opts.reviewerProfile ?? null) },
    $transaction: vi.fn(async (cb: never) => (cb as (t: unknown) => Promise<unknown>)(tx)),
  };
  const audit = { record: vi.fn(async () => 'AE1') };
  return { svc: new RecordingService(prisma as never, audit as never), prisma, tx, audit };
}

describe('no consent, no recording', () => {
  it('refuses when NOBODY has been asked — absence is not consent', async () => {
    const h = harness({ consents: [] });
    const gate = await h.svc.mayRecord('S1');
    expect(gate.allowed).toBe(false);
    await expect(h.svc.startRecording('S1', {})).rejects.toThrow(ConflictException);
    expect(h.tx.recording.create).not.toHaveBeenCalled();
  });

  it('refuses when only ONE party consented', async () => {
    const h = harness({ consents: [consent('astrologer')] });
    const gate = await h.svc.mayRecord('S1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/customer/);
    await expect(h.svc.startRecording('S1', {})).rejects.toThrow(ConflictException);
  });

  it('refuses when a party DECLINED', async () => {
    const h = harness({ consents: [consent('astrologer'), consent('customer', { granted: false })] });
    const gate = await h.svc.mayRecord('S1');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/declined/);
  });

  it('refuses when a party WITHDREW', async () => {
    const h = harness({ consents: [consent('astrologer'), consent('customer', { withdrawnAt: new Date() })] });
    expect((await h.svc.mayRecord('S1')).allowed).toBe(false);
  });

  it('allows only when both granted and neither withdrew', async () => {
    const h = harness({ consents: [consent('astrologer'), consent('customer')] });
    expect((await h.svc.mayRecord('S1')).allowed).toBe(true);
    await expect(h.svc.startRecording('S1', {})).resolves.toMatchObject({ status: 'pending' });
  });

  it('fails LOUDLY rather than silently not recording', async () => {
    const h = harness({ consents: [] });
    // A consultation that quietly is not being recorded looks identical to one
    // that is, and nobody discovers the difference until it matters.
    await expect(h.svc.startRecording('S1', {})).rejects.toThrow(/Cannot record/);
  });

  it('stores a REFUSAL rather than leaving it blank', async () => {
    const h = harness();
    await h.svc.recordConsent('S1', { party: 'customer', userId: 'U1', granted: false, policyVersion: 'v1' }, {});
    const call = arg<{ create: { granted: boolean } }>(h.tx.recordingConsent.upsert, 0, 0);
    // "Never replied" and "said no" are different facts.
    expect(call.create.granted).toBe(false);
    expect(arg<{ action: string }>(h.audit.record, 0, 1).action).toBe('recording.consent.refused');
  });

  it('never writes an address into the consent audit event', async () => {
    const h = harness();
    await h.svc.recordConsent('S1', { party: 'customer', userId: 'U1', granted: true, policyVersion: 'v1' }, {});
    expect(JSON.stringify(h.audit.record.mock.calls)).not.toContain('@');
  });
});

describe('withdrawal deletes the audio', () => {
  it('deletes the recording and clears the object key', async () => {
    const h = harness({
      consents: [consent('customer')],
      recording: { id: 'R1', consultationId: 'S1', status: 'stored', objectKey: 'rec/S1.mp4' },
    });
    const res = await h.svc.withdrawConsent('S1', 'customer', {});
    expect(res.withdrawn).toBe(true);
    const upd = arg<{ data: Record<string, unknown> }>(h.tx.recording.update, 0, 0).data;
    expect(upd.status).toBe('deleted');
    // Cleared, so nothing can point at an object that should not exist.
    expect(upd.objectKey).toBeNull();
    expect(upd.deletedReason).toBe('consent_withdrawn');
  });

  it('returns the object key so the caller can remove it from R2', async () => {
    const h = harness({ recording: { id: 'R1', consultationId: 'S1', status: 'stored', objectKey: 'rec/S1.mp4' } });
    const { objectKey } = await h.svc.deleteRecording('S1', 'erasure_request', {});
    // Marking the row deleted while the object survives is not deletion.
    expect(objectKey).toBe('rec/S1.mp4');
  });

  it('is idempotent — deleting twice is not an error', async () => {
    const h = harness({ recording: { id: 'R1', consultationId: 'S1', status: 'deleted', objectKey: null } });
    await expect(h.svc.deleteRecording('S1', 'expired', {})).resolves.toEqual({ objectKey: null });
  });
});

describe('a machine result is a draft', () => {
  it('lands as machine_done, never as a published finding', async () => {
    const h = harness({ recording: { id: 'R1' } });
    await h.svc.submitMachineAssessment('S1', { abuseFlagged: true, abuseConfidence: 91 });
    const call = arg<{ create: { status: string }; update: { status: string } }>(h.prisma.consultationAssessment.upsert, 0, 0);
    expect(call.create.status).toBe('machine_done');
    expect(call.update.status).toBe('machine_done');
    expect(call.create.status).not.toBe('published');
  });

  it('shows an astrologer ONLY published assessments', async () => {
    const h = harness();
    await h.svc.publishedForAstrologer('A1');
    const q = arg<{ where: Record<string, unknown> }>(h.prisma.consultationAssessment.findMany, 0, 0);
    // Not even "pending" — that tells someone they are under suspicion without
    // telling them of what.
    expect(q.where.status).toBe('published');
  });
});

describe('the reviewer may not be the subject', () => {
  const assessment = {
    id: 'AS1', consultationId: 'S1', status: 'machine_done', abuseFlagged: true,
    consultation: { booking: { astrologerId: 'A1' } },
  };

  it('REFUSES when the reviewer is the astrologer being assessed', async () => {
    const h = harness({ assessment, reviewerProfile: { id: 'A1' } });
    // At roster 3 they are otherwise the only available reviewer, which is the
    // four-eyes gap in task 6.9.
    await expect(
      h.svc.review('S1', { reviewerId: 'U-A1', verdict: 'dismissed' }, {}),
    ).rejects.toThrow(ForbiddenException);
    expect(h.tx.consultationAssessment.update).not.toHaveBeenCalled();
  });

  it('allows a reviewer who is a different astrologer', async () => {
    const h = harness({ assessment, reviewerProfile: { id: 'A2' } });
    await expect(h.svc.review('S1', { reviewerId: 'U-A2', verdict: 'upheld' }, {})).resolves.toBeDefined();
  });

  it('allows a reviewer who is not an astrologer at all', async () => {
    const h = harness({ assessment, reviewerProfile: null });
    await expect(h.svc.review('S1', { reviewerId: 'U-admin', verdict: 'upheld' }, {})).resolves.toBeDefined();
  });

  it('publishes only on an upheld verdict', async () => {
    const h = harness({ assessment, reviewerProfile: null });
    await h.svc.review('S1', { reviewerId: 'U-admin', verdict: 'dismissed' }, {});
    expect(arg<{ data: { status: string } }>(h.tx.consultationAssessment.update, 0, 0).data.status).toBe('dismissed');
  });

  it('records both the machine result and the human verdict in the audit', async () => {
    const h = harness({ assessment, reviewerProfile: null });
    await h.svc.review('S1', { reviewerId: 'U-admin', verdict: 'dismissed', grade: 4 }, {});
    const e = arg<{ before: Record<string, unknown>; after: Record<string, unknown> }>(h.audit.record, 0, 1);
    // "The machine said abuse, a human disagreed" has to stay answerable.
    expect(e.before.machineFlagged).toBe(true);
    expect(e.after.verdict).toBe('dismissed');
  });

  it.each([0, 6, 2.5])('rejects a grade of %s', async (grade) => {
    const h = harness({ assessment, reviewerProfile: null });
    await expect(
      h.svc.review('S1', { reviewerId: 'U-admin', verdict: 'upheld', grade }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('404s when there is nothing to review', async () => {
    const h = harness({ assessment: null });
    await expect(h.svc.review('S9', { reviewerId: 'U1', verdict: 'upheld' }, {})).rejects.toThrow(NotFoundException);
  });
});

describe('chat consultations (ADR-051)', () => {
  it('refuses to append a message to a VOICE consultation', async () => {
    const h = harness({ modality: 'voice' });
    await expect(
      h.svc.appendMessage('S1', { sender: 'customer', senderUserId: 'U1', body: 'hello' }),
    ).rejects.toThrow(ConflictException);
  });

  it('appends to a chat consultation', async () => {
    const h = harness({ modality: 'chat' });
    await expect(
      h.svc.appendMessage('S1', { sender: 'customer', senderUserId: 'U1', body: 'hello' }),
    ).resolves.toHaveProperty('id');
  });

  it('refuses an empty message rather than storing a blank row', async () => {
    const h = harness({ modality: 'chat' });
    await expect(
      h.svc.appendMessage('S1', { sender: 'customer', senderUserId: 'U1', body: '   ' }),
    ).rejects.toThrow(ConflictException);
  });

  it('redaction empties the body but KEEPS the row', async () => {
    const h = harness({ modality: 'chat' });
    const n = await h.svc.redactTranscript('S1', 'erasure_request', {});
    expect(n).toBe(3);
    const call = arg<{ data: Record<string, unknown>; where: Record<string, unknown> }>(
      h.prisma.chatMessage.updateMany, 0, 0);
    expect(call.data.body).toBe('');
    expect(call.data.redactedAt).toBeInstanceOf(Date);
    // Already-redacted messages are not touched again.
    expect(call.where.redactedAt).toBeNull();
  });

  it('withdrawing consent redacts the transcript, not just the audio', async () => {
    const h = harness({
      modality: 'chat',
      consents: [consent('customer')],
      recording: { id: 'R1', consultationId: 'S1', status: 'stored', objectKey: 'k' },
    });
    await h.svc.withdrawConsent('S1', 'customer', {});
    // A chat consultation has no audio file; the transcript IS the record.
    expect(h.prisma.chatMessage.updateMany).toHaveBeenCalled();
  });

  it('erasure reaches chat transcripts that have no recording row', async () => {
    const h = harness({ modality: 'chat' });
    h.prisma.recording.findMany = vi.fn(async () => []) as never;
    h.prisma.consultation.findMany = vi.fn(async () => [{ id: 'S1' }]) as never;
    await h.svc.deleteForCustomer('CUST1', {});
    // The recording loop would never reach a chat consultation — it has no
    // recording row at all.
    expect(h.prisma.chatMessage.updateMany).toHaveBeenCalled();
  });

  it('a redacted message reads back with no body but still exists', async () => {
    const h = harness({ modality: 'chat' });
    h.prisma.chatMessage.findMany = vi.fn(async () => [
      { id: 'M1', sender: 'customer', sentAt: new Date('2026-01-01T00:00Z'), body: 'kept', redactedAt: null },
      { id: 'M2', sender: 'astrologer', sentAt: new Date('2026-01-01T00:01Z'), body: '', redactedAt: new Date() },
    ]) as never;
    const t = await h.svc.transcript('S1');
    expect(t[0]).toMatchObject({ body: 'kept', redacted: false });
    // The shape of the conversation survives; the content does not.
    expect(t[1]).toMatchObject({ body: null, redacted: true, sender: 'astrologer' });
  });
});
