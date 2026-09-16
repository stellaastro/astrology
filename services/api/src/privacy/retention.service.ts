import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Data retention (ADR-041, task 3.7).
 *
 * "We keep your data until we do not need it" is not a retention policy; a
 * retention policy is a number and a job that enforces it. What follows is the
 * job. The numbers and their reasoning are in docs/policies/DATA_RETENTION.md,
 * and one of them is deliberately absent — see CONFIRMED_LEAD_DAYS below.
 *
 * Everything here is overridable by environment variable so the horizon can be
 * changed without a deploy, but the DEFAULTS are the policy. A policy that
 * only exists in a config file nobody has set is not a policy.
 */

/** An unconfirmed lead is uncontactable by design (ADR-028) and unverified. */
const UNCONFIRMED_LEAD_DAYS = Number(process.env.RETENTION_UNCONFIRMED_LEAD_DAYS ?? 30);

/** A delivered outbox row keeps its payload, and payloads carry addresses. */
const DELIVERED_OUTBOX_DAYS = Number(process.env.RETENTION_DELIVERED_OUTBOX_DAYS ?? 30);

/** A spent or expired privacy request still names a lead. */
const PRIVACY_REQUEST_DAYS = Number(process.env.RETENTION_PRIVACY_REQUEST_DAYS ?? 7);

/**
 * CONFIRMED leads have NO default horizon, and that is a decision, not an
 * oversight. Someone who confirmed their address asked to be told when
 * bookings open; deleting them at an arbitrary 12 or 24 months would silently
 * break the one promise the waitlist makes. How long that promise lasts is a
 * business and legal question for the owner (see O4's neighbours in the plan),
 * so the mechanism is here and switched off. Set the variable to enable it.
 */
const CONFIRMED_LEAD_DAYS = Number(process.env.RETENTION_CONFIRMED_LEAD_DAYS ?? 0);

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number): Date => new Date(Date.now() - days * DAY_MS);

export interface PurgeResult {
  unconfirmedLeads: number;
  confirmedLeads: number;
  outboxMessages: number;
  privacyRequests: number;
}

@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async purge(): Promise<PurgeResult> {
    const result: PurgeResult = {
      unconfirmedLeads: 0,
      confirmedLeads: 0,
      outboxMessages: 0,
      privacyRequests: 0,
    };

    /*
     * Fixtures are excluded from every count. A dev seed is not someone's
     * personal data and the retention clock has nothing to say about it —
     * and silently reaping the synthetic roster mid-phase would look like a
     * bug in whatever phase was using it.
     */
    if (UNCONFIRMED_LEAD_DAYS > 0) {
      const r = await this.prisma.lead.deleteMany({
        where: {
          confirmedAt: null,
          isDevFixture: false,
          createdAt: { lt: ago(UNCONFIRMED_LEAD_DAYS) },
        },
      });
      result.unconfirmedLeads = r.count;
    }

    if (CONFIRMED_LEAD_DAYS > 0) {
      const r = await this.prisma.lead.deleteMany({
        where: {
          confirmedAt: { not: null, lt: ago(CONFIRMED_LEAD_DAYS) },
          isDevFixture: false,
        },
      });
      result.confirmedLeads = r.count;
    }

    /*
     * Delivered outbox rows. These keep their payload for ever by default, and
     * a lead.confirm payload contains an email address — so without this the
     * outbox quietly becomes the longest-lived copy of everyone's address in
     * the system. Only PROCESSED rows: an undelivered message still has work
     * to do however old it is.
     */
    if (DELIVERED_OUTBOX_DAYS > 0) {
      const r = await this.prisma.outboxMessage.deleteMany({
        where: {
          processedAt: { not: null, lt: ago(DELIVERED_OUTBOX_DAYS) },
        },
      });
      result.outboxMessages = r.count;
    }

    // Spent or expired privacy requests. They name a lead and serve no further
    // purpose; the audit event is the durable record that one was made.
    if (PRIVACY_REQUEST_DAYS > 0) {
      const cutoff = ago(PRIVACY_REQUEST_DAYS);
      const r = await this.prisma.privacyRequest.deleteMany({
        where: {
          OR: [
            { completedAt: { not: null, lt: cutoff } },
            { expiresAt: { lt: cutoff } },
          ],
        },
      });
      result.privacyRequests = r.count;
    }

    const total =
      result.unconfirmedLeads + result.confirmedLeads + result.outboxMessages + result.privacyRequests;
    if (total > 0) {
      this.log.log(
        `Retention purge: ${result.unconfirmedLeads} unconfirmed lead(s), ` +
          `${result.confirmedLeads} confirmed lead(s), ${result.outboxMessages} outbox row(s), ` +
          `${result.privacyRequests} privacy request(s)`,
      );
    }
    return result;
  }

  /** The horizons in force, for the runbook and for tests. */
  static horizons() {
    return {
      unconfirmedLeadDays: UNCONFIRMED_LEAD_DAYS,
      confirmedLeadDays: CONFIRMED_LEAD_DAYS,
      deliveredOutboxDays: DELIVERED_OUTBOX_DAYS,
      privacyRequestDays: PRIVACY_REQUEST_DAYS,
    };
  }
}
