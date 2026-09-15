import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { monotonicFactory } from 'ulid';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { TurnstileService } from '../turnstile/turnstile.service';
import type { CreateLeadDto } from './create-lead.dto';

const nextId = monotonicFactory();

/** The current consent wording. Bump when the privacy policy text changes. */
export const CONSENT_POLICY_VERSION = '2026-09-06.1';

/**
 * The ONE response every signup returns.
 *
 * Byte-identical whether the address is new, already on the list, or already
 * confirmed. A distinct reply would turn the public form into an oracle for
 * "is this person a Stella customer" — and on an astrology consultation
 * service, that is sensitive: people do not advertise that they are seeking
 * guidance about a marriage or an illness.
 */
export const UNIFORM_RESPONSE = Object.freeze({
  status: 'ok' as const,
  message: 'Thank you. Please check your email to confirm.',
});

export type LeadResult = typeof UNIFORM_RESPONSE;

@Injectable()
export class LeadsService {
  private readonly log = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly turnstile: TurnstileService,
  ) {}

  async create(dto: CreateLeadDto, ip?: string, userAgent?: string): Promise<LeadResult> {
    // Bot check first. A `fail` is rejected; a `degraded` proceeds with a flag,
    // because a Cloudflare outage must not take down the only signup path.
    const check = await this.turnstile.verify(dto.turnstileToken, ip);
    if (check.verdict === 'fail') {
      // Deliberately the same shape as success. Telling a bot which check it
      // failed helps it pass next time, and a false positive against a real
      // person at least leaves them with a sensible message.
      this.log.warn(`Turnstile rejected a signup: ${check.reason}`);
      return UNIFORM_RESPONSE;
    }
    const bypassed = check.verdict === 'degraded';
    if (bypassed) {
      this.log.warn(`Signup accepted without bot verification: ${check.reason}`);
    }

    const token = randomBytes(32).toString('base64url'); // 43 chars

    try {
      await this.prisma.$transaction(async (tx) => {
        // Referral codes are advisory. An unknown code must never cost someone
        // their signup — it is a marketing attribution field, not a gate.
        let referralCode: string | null = dto.referralCode ?? null;
        if (referralCode && !/^[A-Za-z0-9_-]{1,32}$/.test(referralCode)) {
          this.log.warn(`Ignoring malformed referral code on signup`);
          referralCode = null;
        }

        const created = await tx.lead.create({
          data: {
            id: nextId(),
            email: dto.email,
            phone: dto.phone ?? null,
            locale: dto.locale ?? 'hi',
            source: dto.source ?? null,
            referralCode,
            utmSource: dto.utmSource ?? null,
            utmMedium: dto.utmMedium ?? null,
            utmCampaign: dto.utmCampaign ?? null,
            consentAt: new Date(),
            consentPolicyVersion: CONSENT_POLICY_VERSION,
            confirmationToken: token,
            turnstileBypassed: bypassed,
            ip: ip ?? null,
            userAgent: userAgent ?? null,
          },
        });

        // Inside the transaction, so a rolled-back signup cannot leave a queued
        // email about a lead that does not exist.
        await this.outbox.enqueue(tx, 'lead.confirm', {
          leadId: created.id,
          email: created.email,
          locale: created.locale,
          token,
        });

        // A failed audit write ABORTS this transaction. An action that cannot
        // be recorded must not complete.
        await this.audit.record(tx, {
          action: 'lead.create',
          targetType: 'Lead',
          targetId: created.id,
          after: { email: created.email, locale: created.locale, bypassed },
          actor: { ip },
        });
      });

      return UNIFORM_RESPONSE;
    } catch (err) {
      return this.handleWriteError(err, dto.email);
    }
  }

  /**
   * Every failure path the review mapped. The rule: a duplicate is
   * indistinguishable from success, and everything else says something true
   * rather than leaking a 500.
   */
  private handleWriteError(err: unknown, email: string): LeadResult {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 — unique violation on email. Already on the list.
      if (err.code === 'P2002') {
        // Same response, no resend: a repeated submission must not let someone
        // use the form to mail-bomb an address they do not own.
        this.log.log('Duplicate signup — returning the uniform response');
        return UNIFORM_RESPONSE;
      }
      // P1001/P1002 — cannot reach the database, or it timed out.
      if (err.code === 'P1001' || err.code === 'P1002') {
        this.log.error(`Database unreachable during signup: ${err.code}`);
        throw new ServiceUnavailableException(
          'We could not save your details just now. Please try again in a moment.',
        );
      }
      // P2024 — connection pool exhausted.
      if (err.code === 'P2024') {
        this.log.error('Connection pool exhausted during signup');
        throw new ServiceUnavailableException(
          'We are busier than usual. Please try again in a moment.',
        );
      }
    }

    if (err instanceof Prisma.PrismaClientInitializationError) {
      this.log.error(`Database initialisation failed: ${err.message}`);
      throw new ServiceUnavailableException(
        'We could not save your details just now. Please try again in a moment.',
      );
    }

    // Anything else — including an audit write failure, which is the one the
    // review flagged as fail-invisible. It arrives here having already been
    // logged loudly by AuditService, and the transaction is rolled back, so no
    // lead exists. Never swallow this into a success response.
    this.log.error(
      `Signup failed for a reason not otherwise handled`,
      err instanceof Error ? err.stack : String(err),
    );
    throw new ServiceUnavailableException(
      'We could not save your details just now. Please try again in a moment.',
    );
  }

  /**
   * Double opt-in. An unconfirmed lead is not contactable.
   *
   * The token is deliberately NOT cleared on use. Clearing it makes a second
   * click indistinguishable from a broken link, which forces the endpoint to
   * either lie ("confirmed!") to someone whose link is genuinely bad, or leak
   * nothing useful to anyone. Retaining it costs nothing: the token grants only
   * "confirm this address", which is idempotent and inert once done. There is
   * no probing risk either — it is 43 characters of randomness.
   */
  async confirm(token: string): Promise<{ status: 'confirmed' | 'already' | 'invalid' }> {
    const lead = await this.prisma.lead.findUnique({ where: { confirmationToken: token } });
    if (!lead) return { status: 'invalid' };
    if (lead.confirmedAt) return { status: 'already' };

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: lead.id },
        data: { confirmedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'lead.confirm',
        targetType: 'Lead',
        targetId: lead.id,
        before: { confirmedAt: null },
        after: { confirmedAt: new Date().toISOString() },
      });
    });

    return { status: 'confirmed' };
  }
}
