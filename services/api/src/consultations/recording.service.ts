import {
  Injectable, Logger, NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';

const ulid = monotonicFactory();

/** Matches the R2 lifecycle rule on `stella-recordings`. */
export const RETENTION_DAYS = 30;

export type Party = 'astrologer' | 'customer';
export type Verdict = 'upheld' | 'dismissed';

/**
 * Recording, consent and assessment (ADR-048).
 *
 * TWO PROPERTIES ARE ENFORCED HERE RATHER THAN DOCUMENTED, because both are
 * things a reasonable person would otherwise get wrong under time pressure:
 *
 * 1. NO CONSENT, NO RECORDING. Both parties must have granted, and neither may
 *    have withdrawn. The default is not to record. A recording taken without
 *    consent is a liability rather than an asset — under DPDP a voice recording
 *    is personal data, and consultation audio is the most sensitive kind this
 *    business will hold.
 *
 * 2. A MACHINE RESULT IS A DRAFT. Automated analysis over Hindi and regional
 *    languages, on astrology vocabulary, will produce false positives. Telling
 *    an astrologer that software judged them abusive is defamatory when it is
 *    wrong. Nothing reaches them until a human has reviewed it — and that human
 *    may not be the astrologer being assessed.
 */
@Injectable()
export class RecordingService {
  private readonly log = new Logger(RecordingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records one party's answer.
   *
   * A REFUSAL IS STORED, not treated as silence. "They never replied" and "they
   * said no" are different facts, and only one of them is a decision.
   */
  async recordConsent(
    consultationId: string,
    input: { party: Party; userId: string; granted: boolean; policyVersion: string },
    actor: AuditActor,
  ) {
    const consultation = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!consultation) throw new NotFoundException('No such consultation.');

    await this.prisma.$transaction(async (tx) => {
      await tx.recordingConsent.upsert({
        where: { consultationId_party: { consultationId, party: input.party } },
        update: {
          granted: input.granted,
          policyVersion: input.policyVersion,
          decidedAt: new Date(),
          withdrawnAt: null,
        },
        create: {
          id: ulid(),
          consultationId,
          party: input.party,
          userId: input.userId,
          granted: input.granted,
          policyVersion: input.policyVersion,
          decidedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        action: input.granted ? 'recording.consent.granted' : 'recording.consent.refused',
        targetType: 'Consultation',
        targetId: consultationId,
        // The party and the policy version, never the person's address.
        after: { party: input.party, policyVersion: input.policyVersion },
        actor,
      });
    });

    return { consultationId, party: input.party, granted: input.granted };
  }

  /**
   * May this consultation be recorded?
   *
   * BOTH parties, granted, not withdrawn. Absence is refusal: a missing row is
   * someone who was never asked, and never asked is not consent.
   */
  async mayRecord(consultationId: string): Promise<{ allowed: boolean; reason: string }> {
    const consents = await this.prisma.recordingConsent.findMany({ where: { consultationId } });

    for (const party of ['astrologer', 'customer'] as const) {
      const c = consents.find((x) => x.party === party);
      if (!c) return { allowed: false, reason: `The ${party} has not been asked yet.` };
      if (!c.granted) return { allowed: false, reason: `The ${party} declined to be recorded.` };
      if (c.withdrawnAt) return { allowed: false, reason: `The ${party} withdrew consent.` };
    }
    return { allowed: true, reason: 'Both parties consented.' };
  }

  /**
   * Opens a recording row. Refuses without consent.
   *
   * Returns the row the provider's callback will later fill in with an object
   * key — the recording does not exist until it is stored.
   */
  async startRecording(consultationId: string, actor: AuditActor) {
    const gate = await this.mayRecord(consultationId);
    if (!gate.allowed) {
      // A 409 with the reason, not a silent no-op: a consultation that quietly
      // is not being recorded looks identical to one that is.
      throw new ConflictException(`Cannot record. ${gate.reason}`);
    }

    const existing = await this.prisma.recording.findUnique({ where: { consultationId } });
    if (existing) return { id: existing.id, status: existing.status };

    const id = ulid();
    await this.prisma.$transaction(async (tx) => {
      await tx.recording.create({
        data: {
          id,
          consultationId,
          status: 'pending',
          expiresAt: new Date(Date.now() + RETENTION_DAYS * 86_400_000),
        },
      });
      await this.audit.record(tx, {
        action: 'recording.started',
        targetType: 'Consultation',
        targetId: consultationId,
        after: { recordingId: id, retentionDays: RETENTION_DAYS },
        actor,
      });
    });

    return { id, status: 'pending' };
  }

  /** The provider stored the file. */
  async markStored(
    consultationId: string,
    input: { objectKey: string; durationSeconds?: number; sizeBytes?: number },
  ) {
    const rec = await this.prisma.recording.findUnique({ where: { consultationId } });
    if (!rec) throw new NotFoundException('No recording was started for that consultation.');

    await this.prisma.recording.update({
      where: { id: rec.id },
      data: {
        objectKey: input.objectKey,
        durationSeconds: input.durationSeconds ?? null,
        sizeBytes: input.sizeBytes ?? null,
        status: 'stored',
      },
    });
    return { id: rec.id, status: 'stored' };
  }

  /**
   * Withdrawal, and the deletion it obliges.
   *
   * Withdrawing consent that leaves the audio in place is not withdrawal. The
   * consent row stays — as the record that it WAS withdrawn and when — and the
   * recording goes.
   */
  async withdrawConsent(consultationId: string, party: Party, actor: AuditActor) {
    const consent = await this.prisma.recordingConsent.findUnique({
      where: { consultationId_party: { consultationId, party } },
    });
    if (!consent) throw new NotFoundException('There is no consent to withdraw.');

    await this.prisma.$transaction(async (tx) => {
      await tx.recordingConsent.update({
        where: { id: consent.id },
        data: { withdrawnAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'recording.consent.withdrawn',
        targetType: 'Consultation',
        targetId: consultationId,
        after: { party },
        actor,
      });
    });

    await this.deleteRecording(consultationId, 'consent_withdrawn', actor);
    // A chat consultation has no audio file; its transcript IS the record.
    await this.redactTranscript(consultationId, 'consent_withdrawn', actor);
    return { withdrawn: true };
  }

  /**
   * Marks a recording deleted and returns the object key the caller must remove
   * from R2.
   *
   * The database row is kept, emptied: "there was a recording and it was
   * deleted on this date for this reason" is the fact an erasure request has to
   * be able to demonstrate. The KEY is cleared, so nothing can point at an
   * object that should no longer exist.
   */
  async deleteRecording(
    consultationId: string,
    reason: 'consent_withdrawn' | 'erasure_request' | 'expired',
    actor: AuditActor,
  ): Promise<{ objectKey: string | null }> {
    const rec = await this.prisma.recording.findUnique({ where: { consultationId } });
    if (!rec || rec.status === 'deleted') return { objectKey: null };

    const key = rec.objectKey;
    await this.prisma.$transaction(async (tx) => {
      await tx.recording.update({
        where: { id: rec.id },
        data: { status: 'deleted', deletedAt: new Date(), deletedReason: reason, objectKey: null },
      });
      await this.audit.record(tx, {
        action: 'recording.deleted',
        targetType: 'Consultation',
        targetId: consultationId,
        after: { reason },
        actor,
      });
    });

    this.log.log(`Recording for consultation ${consultationId} deleted (${reason})`);
    return { objectKey: key };
  }

  /**
   * Appends a message to a chat consultation (ADR-051).
   *
   * THE SENDER IS ALWAYS A PERSON. `sender` is 'astrologer' or 'customer' and
   * nothing else — no 'system', no 'bot'. Clause 1 of the Terms states that a
   * customer in a chat consultation is writing to a named human, and a
   * machine-authored row in this table would make that false.
   */
  async appendMessage(
    consultationId: string,
    input: { sender: Party; senderUserId: string; body: string },
  ) {
    const c = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!c) throw new NotFoundException('No such consultation.');
    if (c.modality !== 'chat') {
      throw new ConflictException('That consultation is a voice call, not a chat.');
    }
    const body = input.body.trim();
    if (!body) throw new ConflictException('An empty message cannot be sent.');

    const id = ulid();
    await this.prisma.chatMessage.create({
      data: { id, consultationId, sender: input.sender, senderUserId: input.senderUserId, body, sentAt: new Date() },
    });
    return { id };
  }

  /**
   * The transcript. Redacted messages come back without their body.
   *
   * The ROW survives redaction so the shape of the conversation — who sent how
   * many, and when — stays answerable for a dispute, without the content being
   * readable.
   */
  async transcript(consultationId: string) {
    const rows = await this.prisma.chatMessage.findMany({
      where: { consultationId },
      orderBy: { sentAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      sender: m.sender,
      sentAt: m.sentAt.toISOString(),
      body: m.redactedAt ? null : m.body,
      redacted: m.redactedAt !== null,
    }));
  }

  /**
   * Redacts a transcript — the chat equivalent of deleting an audio file.
   *
   * Clause 10 puts a chat transcript under the same retention as a recording,
   * so the same things must reach it: a withdrawn consent, a DPDP erasure, and
   * the thirty-day horizon. Bodies are emptied rather than rows dropped.
   */
  async redactTranscript(
    consultationId: string,
    reason: 'consent_withdrawn' | 'erasure_request' | 'expired',
    actor: AuditActor,
  ): Promise<number> {
    const res = await this.prisma.chatMessage.updateMany({
      where: { consultationId, redactedAt: null },
      data: { body: '', redactedAt: new Date() },
    });
    if (res.count > 0) {
      await this.audit.record(this.prisma, {
        action: 'chat.transcript.redacted',
        targetType: 'Consultation',
        targetId: consultationId,
        after: { reason, messages: res.count },
        actor,
      });
      this.log.log(`Redacted ${res.count} chat message(s) for ${consultationId} (${reason})`);
    }
    return res.count;
  }

  /**
   * Every recording belonging to one customer, deleted.
   *
   * THE ERASURE PATH MUST REACH AUDIO. ADR-040's erasure deletes a lead row and
   * the outbox payloads that carry the address; a customer who has had
   * consultations also has recordings of their voice, which are more sensitive
   * than the address ever was. An erasure that leaves those behind is not one.
   *
   * Returns the object keys the caller removes from R2 — marking rows deleted
   * while the audio survives is theatre.
   */
  async deleteForCustomer(customerId: string, actor: AuditActor): Promise<string[]> {
    const recordings = await this.prisma.recording.findMany({
      where: {
        status: { not: 'deleted' },
        consultation: { booking: { customerId } },
      },
      select: { consultationId: true },
    });

    const keys: string[] = [];
    for (const r of recordings) {
      const { objectKey } = await this.deleteRecording(r.consultationId, 'erasure_request', actor);
      if (objectKey) keys.push(objectKey);
    }

    /*
     * AND THE CHAT TRANSCRIPTS. An erasure that removed someone's audio but
     * left every word they typed is not an erasure — and a chat consultation
     * has no recording row at all, so the loop above would never reach it.
     */
    const chats = await this.prisma.consultation.findMany({
      where: { modality: 'chat', booking: { customerId }, messages: { some: { redactedAt: null } } },
      select: { id: true },
    });
    for (const c of chats) {
      await this.redactTranscript(c.id, 'erasure_request', actor);
    }

    if (recordings.length > 0) {
      this.log.log(`Erasure: deleted ${recordings.length} recording(s) for customer ${customerId}`);
    }
    return keys;
  }

  /**
   * Rows whose audio R2 has already expired.
   *
   * R2's own lifecycle rule removes the OBJECT after 30 days. This reconciles
   * the database with that, so a row does not keep pointing at a key the
   * bucket no longer has — "deleted" and "the file quietly vanished" look the
   * same from a query otherwise.
   */
  async reconcileExpired(): Promise<number> {
    const stale = await this.prisma.recording.findMany({
      where: { status: 'stored', expiresAt: { lt: new Date() } },
      select: { consultationId: true },
    });
    for (const r of stale) {
      await this.deleteRecording(r.consultationId, 'expired', { id: 'scheduler', role: 'cli' });
    }
    return stale.length;
  }

  /**
   * Stores what the machine thought. NEVER visible to the astrologer.
   *
   * Lands as `machine_done`, which is a queue position, not a verdict.
   */
  async submitMachineAssessment(
    consultationId: string,
    input: { abuseFlagged: boolean; abuseConfidence?: number; notes?: string },
  ) {
    const c = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!c) throw new NotFoundException('No such consultation.');

    const id = ulid();
    await this.prisma.consultationAssessment.upsert({
      where: { consultationId },
      update: {
        status: 'machine_done',
        abuseFlagged: input.abuseFlagged,
        abuseConfidence: input.abuseConfidence ?? null,
        machineNotes: input.notes ?? null,
      },
      create: {
        id,
        consultationId,
        status: 'machine_done',
        abuseFlagged: input.abuseFlagged,
        abuseConfidence: input.abuseConfidence ?? null,
        machineNotes: input.notes ?? null,
      },
    });
    return { consultationId, status: 'machine_done' };
  }

  /**
   * A human reviews it. THIS is where a finding becomes a finding.
   *
   * THE REVIEWER MAY NOT BE THE ASTROLOGER BEING ASSESSED. At a roster of three
   * they are otherwise the only available reviewer, and someone adjudicating a
   * complaint about themselves is not review (task 6.9 / owner action O5).
   */
  async review(
    consultationId: string,
    input: { reviewerId: string; verdict: Verdict; notes?: string; grade?: number },
    actor: AuditActor,
  ) {
    const assessment = await this.prisma.consultationAssessment.findUnique({
      where: { consultationId },
      include: { consultation: { include: { booking: { select: { astrologerId: true } } } } },
    });
    if (!assessment) throw new NotFoundException('No assessment to review.');

    const astrologerId = assessment.consultation.booking.astrologerId;
    const reviewerProfile = await this.prisma.astrologer.findUnique({
      where: { userId: input.reviewerId },
      select: { id: true },
    });
    if (reviewerProfile && reviewerProfile.id === astrologerId) {
      throw new ForbiddenException(
        'You cannot review an assessment of your own consultation. Someone else must.',
      );
    }

    if (input.grade !== undefined && (input.grade < 1 || input.grade > 5 || !Number.isInteger(input.grade))) {
      throw new ConflictException('A grade must be a whole number from 1 to 5.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.consultationAssessment.update({
        where: { consultationId },
        data: {
          // `published` is the only status the astrologer ever sees.
          status: input.verdict === 'upheld' ? 'published' : 'dismissed',
          reviewerId: input.reviewerId,
          reviewedAt: new Date(),
          reviewerVerdict: input.verdict,
          reviewerNotes: input.notes ?? null,
          grade: input.grade ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'consultation.assessment.reviewed',
        targetType: 'Consultation',
        targetId: consultationId,
        before: { status: assessment.status, machineFlagged: assessment.abuseFlagged },
        after: { verdict: input.verdict, grade: input.grade ?? null },
        actor,
      });
    });

    return { consultationId, verdict: input.verdict };
  }

  /**
   * What an astrologer may see about themselves.
   *
   * Published assessments only. A machine result that no human has confirmed is
   * not shown at all — not even as "pending", which would tell them they are
   * under suspicion without telling them of what.
   */
  async publishedForAstrologer(astrologerId: string) {
    const rows = await this.prisma.consultationAssessment.findMany({
      where: {
        status: 'published',
        consultation: { booking: { astrologerId } },
      },
      select: {
        id: true, grade: true, reviewerNotes: true, reviewedAt: true,
        consultationId: true,
      },
      orderBy: { reviewedAt: 'desc' },
      take: 50,
    });
    return rows;
  }
}
