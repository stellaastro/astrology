import { Injectable, Logger } from '@nestjs/common';
import { monotonicFactory } from 'ulid';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const nextId = monotonicFactory();

/** Max attempts before a message is parked for a human. */
export const MAX_ATTEMPTS = 8;

export type OutboxHandler = (payload: unknown, topic: string) => Promise<void>;

/**
 * Transactional outbox.
 *
 * The problem it solves: a Razorpay webhook must confirm a booking, email the
 * customer and notify the astrologer. Those side effects are not transactional
 * with the database write. Do them inline and a crash between the commit and
 * the email leaves a confirmed booking nobody was told about; do them before
 * the commit and a rollback leaves an email about a booking that does not
 * exist.
 *
 * The outbox makes the intent to send part of the same transaction as the
 * business write, then delivers separately. Delivery is AT LEAST ONCE, never
 * exactly once — handlers must be idempotent. That is a property of the world,
 * not of this implementation: any system that retries can deliver twice.
 *
 * This was cut from the plan once, on the reasoning that it only mattered for
 * per-minute billing. That inverted when the model became pay-at-booking, which
 * needs it more (ADR-030).
 */
@Injectable()
export class OutboxService {
  private readonly log = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enqueues inside the caller's transaction.
   *
   * @param tx MUST be the transaction client. Passing the base client defeats
   *   the entire point: the message would commit independently of the business
   *   write, so a rolled-back booking could still send a confirmation email.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    topic: string,
    payload: unknown,
    availableAt = new Date(),
  ): Promise<string> {
    const id = nextId();
    await tx.outboxMessage.create({
      data: { id, topic, payload: payload as Prisma.InputJsonValue, availableAt },
    });
    return id;
  }

  register(topic: string, handler: OutboxHandler): void {
    if (this.handlers.has(topic)) {
      throw new Error(`Outbox topic "${topic}" already has a handler`);
    }
    this.handlers.set(topic, handler);
  }

  /**
   * Delivers one batch. Returns counts rather than throwing, so a single bad
   * message cannot stop the queue.
   */
  async dispatchBatch(
    limit = 20,
    now = new Date(),
  ): Promise<{ delivered: number; failed: number; parked: number }> {
    const due = await this.prisma.outboxMessage.findMany({
      where: { processedAt: null, availableAt: { lte: now }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { availableAt: 'asc' },
      take: limit,
    });

    let delivered = 0;
    let failed = 0;
    let parked = 0;

    for (const msg of due) {
      const handler = this.handlers.get(msg.topic);
      if (!handler) {
        // An unregistered topic is a deployment mistake, not a message fault.
        // Leave it queued rather than burning attempts on it.
        this.log.warn(`No handler registered for outbox topic "${msg.topic}"`);
        continue;
      }

      try {
        await handler(msg.payload, msg.topic);
        await this.prisma.outboxMessage.update({
          where: { id: msg.id },
          data: { processedAt: new Date(), attempts: msg.attempts + 1, lastError: null },
        });
        delivered++;
      } catch (err) {
        const attempts = msg.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);

        if (attempts >= MAX_ATTEMPTS) {
          // Parked, NOT deleted and NOT marked processed. A message that could
          // not be delivered is evidence; discarding it hides the failure.
          this.log.error(
            `Outbox message ${msg.id} (${msg.topic}) parked after ${attempts} ` +
              `attempts: ${message}. Needs a human.`,
          );
          parked++;
        } else {
          failed++;
        }

        await this.prisma.outboxMessage.update({
          where: { id: msg.id },
          data: {
            attempts,
            lastError: message.slice(0, 2000),
            availableAt: new Date(now.getTime() + backoffMs(attempts)),
          },
        });
      }
    }

    return { delivered, failed, parked };
  }

  /** Messages that exhausted their attempts and need attention. */
  async parked(): Promise<number> {
    return this.prisma.outboxMessage.count({
      where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } },
    });
  }
}

/**
 * Exponential backoff with jitter, capped at an hour.
 *
 * Jitter matters: without it, a downstream outage that fails 200 messages at
 * once makes all 200 retry at the same instant, which is how a recovering
 * service gets knocked over again.
 */
export function backoffMs(attempts: number): number {
  const base = Math.min(1000 * 2 ** attempts, 3_600_000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}
