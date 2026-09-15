import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';

const ulid = monotonicFactory();

/**
 * The policies a person is asked about, and the version currently in force.
 *
 * VERSIONS ARE BUMPED BY HAND when the wording changes. Deriving a version from
 * a file hash would make an invisible whitespace edit look like a new policy
 * people must re-accept, and a deliberate rewording look like nothing happened
 * if the hash were cached.
 *
 * `recording` is its own policy, not a line inside `terms`. DPDP consent must
 * be specific: one checkbox covering terms, privacy and being recorded cannot
 * show which of the three a person agreed to, and being recorded is the one
 * most likely to be questioned.
 */
export const POLICIES = {
  terms: 'v1',
  privacy: 'v1',
  recording: 'v1',
} as const;

export type PolicyKind = keyof typeof POLICIES;

/** Required before an account exists. Recording is listed among them. */
export const REQUIRED_AT_REGISTRATION: PolicyKind[] = ['terms', 'privacy', 'recording'];

/**
 * Policy acceptance (ADR-050).
 *
 * Owner decision, 2026-09-15: the terms are shown as an itemised list before an
 * account is created, and consent to being recorded is one of those items.
 */
@Injectable()
export class PolicyService {
  private readonly log = new Logger(PolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records what someone agreed to at registration.
   *
   * A REFUSAL IS STORED. Declining to be recorded is a decision that has to be
   * relied on later; an absent row only says nobody asked.
   */
  async accept(
    userId: string,
    decisions: { policy: PolicyKind; accepted: boolean }[],
    ctx: { ip?: string | undefined; userAgent?: string | undefined },
    actor: AuditActor,
  ) {
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const d of decisions) {
        const version = POLICIES[d.policy];
        await tx.policyAcceptance.upsert({
          where: { userId_policy_version: { userId, policy: d.policy, version } },
          update: { accepted: d.accepted, acceptedAt: now, withdrawnAt: null },
          create: {
            id: ulid(),
            userId,
            policy: d.policy,
            version,
            accepted: d.accepted,
            acceptedAt: now,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent?.slice(0, 255) ?? null,
          },
        });
      }

      await this.audit.record(tx, {
        action: 'policy.accepted',
        targetType: 'User',
        targetId: userId,
        // Which policies and versions — never the person's address (ADR-040).
        after: {
          decisions: decisions.map((d) => ({
            policy: d.policy, version: POLICIES[d.policy], accepted: d.accepted,
          })),
        },
        actor,
      });
    });

    return { userId, recorded: decisions.length };
  }

  /**
   * Has this person accepted this policy AT THE VERSION NOW IN FORCE?
   *
   * The version check is the substance. Accepting v1 says nothing about a v2
   * that added recording — treating an old acceptance as covering new terms is
   * how consent quietly becomes fiction.
   */
  async hasAccepted(userId: string, policy: PolicyKind): Promise<boolean> {
    const row = await this.prisma.policyAcceptance.findUnique({
      where: { userId_policy_version: { userId, policy, version: POLICIES[policy] } },
    });
    return Boolean(row && row.accepted && !row.withdrawnAt);
  }

  /** Everything still outstanding for this account. */
  async outstanding(userId: string): Promise<PolicyKind[]> {
    const out: PolicyKind[] = [];
    for (const p of REQUIRED_AT_REGISTRATION) {
      if (!(await this.hasAccepted(userId, p))) out.push(p);
    }
    return out;
  }

  /** Withdrawal. The row stays as the record that it WAS withdrawn and when. */
  async withdraw(userId: string, policy: PolicyKind, actor: AuditActor) {
    const version = POLICIES[policy];
    const row = await this.prisma.policyAcceptance.findUnique({
      where: { userId_policy_version: { userId, policy, version } },
    });
    if (!row) throw new ConflictException('There is nothing to withdraw for that policy.');

    await this.prisma.$transaction(async (tx) => {
      await tx.policyAcceptance.update({ where: { id: row.id }, data: { withdrawnAt: new Date() } });
      await this.audit.record(tx, {
        action: 'policy.withdrawn',
        targetType: 'User',
        targetId: userId,
        after: { policy, version },
        actor,
      });
    });

    return { withdrawn: true, policy, version };
  }
}
