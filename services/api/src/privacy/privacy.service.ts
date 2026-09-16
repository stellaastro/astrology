import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';

const ulid = monotonicFactory();

/** How long an emailed privacy link stays usable. */
const TTL_MS = 24 * 60 * 60 * 1000;

export type PrivacyKind = 'access' | 'erasure';

/**
 * What we hand back for an access request. Everything the lead row holds about
 * a person, with nothing omitted — an access response that quietly drops the
 * IP and user-agent is not an access response.
 */
export interface PrivacyExport {
  email: string;
  phone: string | null;
  locale: string;
  source: string | null;
  referralCode: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  consent: { at: string; policyVersion: string };
  confirmedAt: string | null;
  turnstileBypassed: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * DPDP access and erasure for waitlist leads (ADR-040).
 *
 * THE PROBLEM THIS SOLVES: a lead has no account, so there is no session to
 * authenticate a request with. The only thing a person can prove is control of
 * the address — which is exactly what double opt-in already proves — so a
 * request is verified by emailing a one-time link to the address in question.
 *
 * Consequences that shape everything below:
 *
 * 1. THE REQUEST ENDPOINT IS AN ENUMERATION ORACLE IF IT IS NOT CAREFUL.
 *    "We have sent you a link" versus "we hold nothing for you" tells an
 *    attacker whether a named person is on an astrology waitlist. On this
 *    service that is sensitive. The reply is byte-identical either way, for
 *    the same reason the signup endpoint's is (ADR-028).
 *
 * 2. ERASURE MUST BE COMPLETE OR IT MUST NOT CLAIM TO BE.
 *    Three places held a copy of the address, and only one of them was the
 *    lead row: the outbox payload of the confirmation email, and the audit
 *    event written at signup. The audit event is the dangerous one, because
 *    the audit log is append-only — so the fix was to stop writing the address
 *    there at all rather than to delete it afterwards. See leads.service.
 */
@Injectable()
export class PrivacyService {
  private readonly log = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Start a request. ALWAYS returns void — the caller sends one fixed reply
   * whatever happened here, so nothing about the outcome reaches the client.
   */
  async open(email: string, kind: PrivacyKind, ctx: RequestContext): Promise<void> {
    const normalised = email.trim().toLowerCase();

    const lead = await this.prisma.lead.findUnique({
      where: { email: normalised },
      select: { id: true, locale: true },
    });

    // No such address: do nothing, say nothing, and take roughly the same time
    // doing it. There is no row to create and no mail to send.
    if (!lead) return;

    const token = randomBytes(32).toString('base64url'); // 43 chars

    await this.prisma.$transaction(async (tx) => {
      await tx.privacyRequest.create({
        data: {
          id: ulid(),
          tokenHash: PrivacyService.hash(token),
          leadId: lead.id,
          kind,
          expiresAt: new Date(Date.now() + TTL_MS),
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent?.slice(0, 255) ?? null,
        },
      });

      // The mail goes through the outbox so a dead SMTP server retries rather
      // than silently dropping someone's statutory request.
      await this.outbox.enqueue(tx, 'privacy.verify', {
        leadId: lead.id,
        email: normalised,
        locale: lead.locale,
        kind,
        token,
      });

      await this.audit.record(tx, {
        action: 'privacy.request.opened',
        targetType: 'Lead',
        targetId: lead.id,
        after: { kind },          // never the address — see the class comment
        actor: { ip: ctx.ip },
      });
    });
  }

  /**
   * Look up a request by its emailed token. Returns null for anything that is
   * not a live, unused, unexpired request — the caller must not distinguish
   * between those cases for the person holding the link.
   */
  async resolve(token: string): Promise<{ id: string; leadId: string; kind: PrivacyKind } | null> {
    if (!token) return null;

    const row = await this.prisma.privacyRequest.findUnique({
      where: { tokenHash: PrivacyService.hash(token) },
      select: { id: true, leadId: true, kind: true, expiresAt: true, completedAt: true },
    });

    if (!row) return null;
    // Single use. A link that still works after it has been used is a link
    // that works for whoever reads that mailbox next.
    if (row.completedAt) return null;
    if (row.expiresAt <= new Date()) return null;

    return { id: row.id, leadId: row.leadId, kind: row.kind as PrivacyKind };
  }

  /** Everything held about this person. */
  async exportFor(requestId: string, leadId: string, ctx: RequestContext): Promise<PrivacyExport | null> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    await this.prisma.$transaction(async (tx) => {
      await tx.privacyRequest.update({
        where: { id: requestId },
        data: { completedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'privacy.access.served',
        targetType: 'Lead',
        targetId: leadId,
        actor: { ip: ctx.ip },
      });
    });

    return {
      email: lead.email,
      phone: lead.phone,
      locale: lead.locale,
      source: lead.source,
      referralCode: lead.referralCode,
      utm: { source: lead.utmSource, medium: lead.utmMedium, campaign: lead.utmCampaign },
      consent: {
        at: lead.consentAt.toISOString(),
        policyVersion: lead.consentPolicyVersion,
      },
      confirmedAt: lead.confirmedAt ? lead.confirmedAt.toISOString() : null,
      turnstileBypassed: lead.turnstileBypassed,
      ip: lead.ip,
      userAgent: lead.userAgent,
      createdAt: lead.createdAt.toISOString(),
    };
  }

  /**
   * Erase. Returns false if there was nothing to erase.
   *
   * ORDER MATTERS. The audit event is written BEFORE the delete, inside the
   * same transaction, because a failed audit write must abort the whole thing
   * — an erasure nobody can prove happened is as bad as one that did not.
   *
   * What the audit event does NOT contain is the address, or a hash of it. A
   * SHA-256 of an email address is trivially reversible for any address someone
   * already suspects, so keeping one would leave behind exactly the residue
   * erasure exists to remove. The lead's ULID is enough to show that a specific
   * record was erased, on a date, in response to a specific request.
   */
  async erase(requestId: string, leadId: string, ctx: RequestContext): Promise<boolean> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
    if (!lead) return false;

    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        action: 'lead.erased',
        targetType: 'Lead',
        targetId: leadId,
        before: { requestId },
        reason: 'DPDP erasure request, verified by email',
        actor: { ip: ctx.ip },
      });

      /*
       * The outbox keeps every message it has ever delivered, payload and all,
       * and the confirmation payload carries the address. Without this, the
       * lead row would be gone and the address would still be sitting in
       * outbox_messages — so "we have deleted your data" would be false.
       *
       * Raw SQL because Prisma cannot filter on a JSON path in MySQL.
       */
      await tx.$executeRawUnsafe(
        `DELETE FROM outbox_messages WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.leadId')) = ?`,
        leadId,
      );

      // privacy_requests cascade with the lead, including this one.
      await tx.lead.delete({ where: { id: leadId } });
    });

    this.log.log(`Erased lead ${leadId} under DPDP request ${requestId}`);
    return true;
  }
}
