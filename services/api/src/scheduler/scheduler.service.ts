import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxService } from '../outbox/outbox.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RetentionService } from '../privacy/retention.service';
import { BookingsService } from '../bookings/bookings.service';

/**
 * Recurring work.
 *
 * The plan cut the scheduler once, reasoning it only mattered under per-minute
 * billing. That inverted (ADR-030). Pay-at-booking needs timers MORE, and the
 * jobs below are only the ones due now — these arrive as later phases land:
 *
 *   Phase 6  T-24h and T-1h booking reminders (the compensating control for
 *            dropping WhatsApp) — waits on TRAI DLT registration
 *   Phase 6  no-show detection window
 *   Phase 7  refund-window expiry
 *
 * The abandoned-checkout reaper landed with task 6.10 and is below.
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
    private readonly retention: RetentionService,
    private readonly bookings: BookingsService,
  ) {}

  /**
   * The abandoned-checkout reaper (task 6.10).
   *
   * A customer opens Razorpay, closes the tab, and the slot stays held for
   * ever without this. At roster 3 that is a visible part of the sellable week.
   *
   * EVERY MINUTE, which is roughly HOLD_MINUTES/15 of extra delay on average —
   * a slot is returned to sale within a minute of its hold lapsing. Running it
   * rarely would make the effective hold longer than the advertised one, and
   * "your slot is held for 15 minutes" has to be true in the direction that
   * costs the business, not only in the direction that costs the customer.
   *
   * The sweep is idempotent and its WHERE clause re-checks the status, so a
   * tick that overlaps a payment confirmation loses to the payment.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'bookings.expire-holds' })
  async expireAbandonedHolds(): Promise<void> {
    try {
      await this.bookings.expireHolds();
    } catch (err) {
      this.log.error('Hold expiry failed', err instanceof Error ? err.stack : String(err));
    }
  }

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

  /**
   * Data retention (ADR-041, task 3.7).
   *
   * Daily, and deliberately NOT hourly: this deletes people's records, so a
   * mistake in a horizon should have a day to be noticed rather than an hour.
   * The horizons live in RetentionService; the reasoning is in
   * docs/policies/DATA_RETENTION.md.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'retention.purge' })
  async purgeExpiredData(): Promise<void> {
    try {
      await this.retention.purge();
    } catch (err) {
      this.log.error('Retention purge failed', err instanceof Error ? err.stack : String(err));
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
