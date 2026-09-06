import { Injectable, Logger } from '@nestjs/common';
import { monotonicFactory } from 'ulid';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Monotonic, not the plain ulid().
 *
 * A plain ULID draws a fresh random suffix every call, so two events generated
 * in the same millisecond sort arbitrarily. For an audit log that is a real
 * loss: you want to order events by id alone, without leaning on the timestamp
 * column, and you want ties inside a millisecond to resolve deterministically.
 * monotonicFactory increments the suffix instead, so ids sort by creation
 * order even under a burst. Module-level because it has to keep that state.
 */
const nextId = monotonicFactory();

export interface AuditActor {
  id?: string | undefined;
  role?: string | undefined;
  ip?: string | undefined;
  sessionId?: string | undefined;
}

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string | undefined;
  before?: unknown;
  after?: unknown;
  reason?: string | undefined;
  actor?: AuditActor | undefined;
}

/**
 * Append-only audit log.
 *
 * Two rules, both learned the hard way in review:
 *
 * 1. A FAILED AUDIT WRITE ABORTS THE ENCLOSING TRANSACTION.
 *    The reviewed plan originally let the audit write fail quietly, on the very
 *    surface built to prove the audit trail works. If the log cannot record
 *    that something happened, the something must not happen. This service
 *    therefore never swallows an error, and callers must pass the transaction
 *    client so the abort actually rolls the business write back.
 *
 * 2. APPEND-ONLY IS ENFORCED BY GRANTS, NOT BY THIS CLASS.
 *    There is no update() or delete() here, but that is a convenience, not a
 *    guarantee — anything holding a Prisma client could still issue one. The
 *    real control is the database user having INSERT and SELECT on
 *    audit_events and nothing else. See docs/architecture/DECISION_LOG.md.
 *    A log the application can rewrite is not an audit log.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  /**
   * Records an audited action.
   *
   * @param tx MUST be the transaction client when the audited change is part
   *   of a transaction. Passing the base client instead means the audit row
   *   commits independently, so a rolled-back change leaves a log entry saying
   *   it happened — worse than no log, because it is confidently wrong.
   */
  async record(
    tx: Prisma.TransactionClient | PrismaClient,
    entry: AuditEntry,
  ): Promise<string> {
    const id = nextId();
    try {
      await tx.auditEvent.create({
        data: {
          id,
          actorId: entry.actor?.id ?? null,
          actorRole: entry.actor?.role ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId ?? null,
          before: (entry.before ?? null) as Prisma.InputJsonValue,
          after: (entry.after ?? null) as Prisma.InputJsonValue,
          reason: entry.reason ?? null,
          ip: entry.actor?.ip ?? null,
          sessionId: entry.actor?.sessionId ?? null,
        },
      });
      return id;
    } catch (err) {
      // Deliberately loud, deliberately rethrown. Do not add a catch upstream
      // that turns this into a warning: the point is that the business write
      // does not survive an unrecordable action.
      this.log.error(
        `AUDIT WRITE FAILED for ${entry.action} on ${entry.targetType}` +
          `${entry.targetId ? `:${entry.targetId}` : ''} — aborting the ` +
          `transaction. An action that cannot be audited must not complete.`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}
