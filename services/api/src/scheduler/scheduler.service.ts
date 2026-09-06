import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxService } from '../outbox/outbox.service';
import { IdempotencyService } from '../idempotency/idempotency.service';

/**
 * Recurring work.
 *
 * The plan cut the scheduler once, reasoning it only mattered under per-minute
 * billing. That inverted (ADR-030). Pay-at-booking needs timers MORE, and the
 * jobs below are only the ones due now — these arrive as later phases land:
 *
 *   Phase 6  abandoned-checkout reaper — a customer opens Razorpay, closes the
 *            tab, and the slot stays held forever without this
 *   Phase 6  T-24h and T-1h booking reminders (the compensating control for
 *            dropping WhatsApp)
 *   Phase 6  no-show detection window
 *   Phase 7  refund-window expiry
 *
 * SINGLE INSTANCE ONLY. @nestjs/schedule runs in-process, so two API replicas
 * would run every job twice — double emails, double reaping. That is fine
 * today (one process, one box) and becomes wrong the moment a second replica
 * exists. At that point this needs a database advisory lock or a real queue,
 * and the check below is what should catch it.
 */
@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);
  private outboxRunning = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Outbox delivery. Every 10s: fast enough that a booking confirmation feels
   * immediate, slow enough not to hammer MySQL when the queue is empty.
   *
   * The re-entrancy guard matters — a slow batch must not overlap with the
   * next tick, or the same message gets delivered twice concurrently.
   */
  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'outbox.dispatch' })
  async dispatchOutbox(): Promise<void> {
    if (this.outboxRunning) {
      this.log.warn('Outbox batch still running, skipping this tick');
      return;
    }
    this.outboxRunning = true;
    try {
      const res = await this.outbox.dispatchBatch();
      if (res.delivered || res.failed || res.parked) {
        this.log.log(
          `Outbox: ${res.delivered} delivered, ${res.failed} retrying, ${res.parked} parked`,
        );
      }
    } catch (err) {
      // Never let a scheduler job throw: an unhandled rejection here takes the
      // process down and the site with it.
      this.log.error('Outbox dispatch failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.outboxRunning = false;
    }
  }

  /** Parked messages need a human. Hourly is often enough to notice. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'outbox.parked-alert' })
  async alertParked(): Promise<void> {
    try {
      const count = await this.outbox.parked();
      if (count > 0) {
        this.log.error(
          `${count} outbox message(s) parked after exhausting retries. These ` +
            `will not be delivered without intervention.`,
        );
      }
    } catch (err) {
      this.log.error('Parked check failed', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Expired idempotency keys. Off the request path deliberately. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'idempotency.purge' })
  async purgeIdempotencyKeys(): Promise<void> {
    try {
      const count = await this.idempotency.purgeExpired();
      if (count > 0) this.log.log(`Purged ${count} expired idempotency key(s)`);
    } catch (err) {
      this.log.error('Idempotency purge failed', err instanceof Error ? err.stack : String(err));
    }
  }
}
