import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  id: string;
  role: string;
  ip?: string | undefined;
  sessionId?: string | undefined;
}

/** Hard ceiling. A page size of 10000 is an export, and exports are audited
 *  differently from browsing — see exportCsv. */
export const MAX_PAGE = 100;

/**
 * Reading the waitlist.
 *
 * EVERY READ IS AUDITED WITH A REAL ACTOR. This is the surface the audit store
 * was built for: the list is every person who gave us an email address, and
 * "who looked at it, when, from where" has to be answerable. Task 3.5 says so
 * and DPDP expects it.
 *
 * The confirmation token is never selected. It is a bearer credential — anyone
 * holding it can confirm that address — and an admin has no reason to see one.
 */
@Injectable()
export class AdminLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: Actor,
    opts: { page?: number; pageSize?: number; confirmed?: boolean | undefined },
  ) {
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const pageSize = Math.min(MAX_PAGE, Math.max(1, Math.floor(opts.pageSize ?? 25)));

    const where =
      opts.confirmed === undefined
        ? {}
        : opts.confirmed
          ? { confirmedAt: { not: null } }
          : { confirmedAt: null };

    const [total, rows] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          phone: true,
          locale: true,
          source: true,
          referralCode: true,
          consentAt: true,
          consentPolicyVersion: true,
          confirmedAt: true,
          createdAt: true,
          isDevFixture: true,
          // Deliberately absent: confirmationToken (a bearer credential), ip
          // and userAgent (not needed to browse; included only in an export,
          // which is audited as such).
        },
      }),
    ]);

    await this.write(actor, 'admin.leads.list', {
      page,
      pageSize,
      returned: rows.length,
      total,
      filter: opts.confirmed === undefined ? 'all' : opts.confirmed ? 'confirmed' : 'unconfirmed',
    });

    return { page, pageSize, total, pages: Math.ceil(total / pageSize) || 1, leads: rows };
  }

  /**
   * CSV export.
   *
   * A separate audit action from browsing, on purpose: an export takes the data
   * out of the system, and "someone paged through the list" and "someone took a
   * copy of every address" are not the same event to an investigator.
   */
  async exportCsv(actor: Actor): Promise<string> {
    const rows = await this.prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        email: true,
        phone: true,
        locale: true,
        source: true,
        referralCode: true,
        confirmedAt: true,
        consentAt: true,
        consentPolicyVersion: true,
        createdAt: true,
        isDevFixture: true,
      },
    });

    await this.write(actor, 'admin.leads.export', { rows: rows.length, format: 'csv' });

    const header = [
      'email', 'phone', 'locale', 'source', 'referral_code',
      'confirmed_at', 'consent_at', 'consent_policy_version', 'created_at', 'is_dev_fixture',
    ];

    const body = rows.map((r) =>
      [
        r.email, r.phone ?? '', r.locale, r.source ?? '', r.referralCode ?? '',
        r.confirmedAt?.toISOString() ?? '', r.consentAt.toISOString(), r.consentPolicyVersion,
        r.createdAt.toISOString(), r.isDevFixture ? 'true' : 'false',
      ].map(csvCell).join(','),
    );

    return [header.join(','), ...body].join('\r\n');
  }

  /** Audit writes here use their own transaction and are NOT allowed to fail
   *  silently — an unrecorded read of the whole mailing list is the thing this
   *  endpoint exists to make impossible. */
  private async write(actor: Actor, action: string, after: Record<string, unknown>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        action,
        targetType: 'Lead',
        after,
        actor: { id: actor.id, role: actor.role, ip: actor.ip, sessionId: actor.sessionId },
      });
    });
  }
}

/**
 * CSV escaping.
 *
 * The leading-character guard is the one people miss: a cell beginning =, +, -
 * or @ is executed as a formula when the file is opened in Excel or Sheets.
 * An address like `=cmd|'/c calc'!A1@example.com` is a real attack, and the
 * values here are attacker-supplied by definition — anyone can type anything
 * into the signup form.
 */
export function csvCell(value: string): string {
  const s = String(value ?? '');
  const risky = /^[=+\-@\t\r]/.test(s);
  const needsQuotes = risky || /[",\r\n]/.test(s);
  const body = risky ? `'${s}` : s;
  return needsQuotes ? `"${body.replace(/"/g, '""')}"` : body;
}
