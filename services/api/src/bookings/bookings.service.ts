import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { AvailabilityService } from '../availability/availability.service';
import { authorisationCeilingPaise } from '../billing/chat-billing';

const ulid = monotonicFactory();

/**
 * STATUSES THAT OCCUPY THE SLOT.
 *
 * This list MUST stay in step with the CASE expression in
 * `20260915151218_add_bookings/migration.sql`, which computes `slot_key` as
 * NULL for exactly `cancelled` and `expired`. It is expressed here as the
 * complement — "everything except these two" — so adding a status later
 * (`completed`, `no_show`, anything else) occupies the slot by default, which
 * is the safe direction: a new status that forgot to occupy would silently
 * allow a double booking.
 */
export const NON_OCCUPYING_STATUSES = ['cancelled', 'expired'] as const;

/**
 * How long a hold survives without payment.
 *
 * Fifteen minutes, because the hold has to outlive the ENTIRE Razorpay flow
 * and UPI collect requests pend for minutes while the customer opens a banking
 * app (task 6.2). The instinct is a short TTL, as if this were a cache; it is
 * not. A hold that lapses while the customer is authorising the payment takes
 * money for a slot somebody else now owns.
 *
 * The other direction has a cost too — a slot held by an abandoned checkout is
 * a slot nobody can buy — which is what the reaper is for, not what a short
 * TTL is for.
 */
export const HOLD_MINUTES = 15;

/**
 * Reschedule limits. Both are POLICY, not physics, and O4 may move them.
 *
 * The cutoff exists because moving a booking ten minutes before it starts
 * strands an astrologer who is already sitting in front of a microphone. The
 * count exists because a booking that can be moved without limit is a slot
 * held indefinitely for free.
 */
export const MAX_RESCHEDULES = 3;
export const RESCHEDULE_CUTOFF_MINUTES = 120;

export type Modality = 'voice' | 'chat';
export type CancelledBy = 'customer' | 'astrologer' | 'admin' | 'system';

/** The tax split, which Phase 7 computes and a confirmed booking may not lack. */
export interface TaxSnapshot {
  taxableValuePaise: number;
  taxRateBp: number;
  taxAmountPaise: number;
  sacCode: string;
  placeOfSupply: string;
}

interface PriceSnapshot {
  pricePaise: number;
  sessionMinutes: number;
  chatRatePerMinutePaise: number | null;
}

/**
 * Bookings (tasks 6.2, 6.3, 6.6, 6.10).
 *
 * The state machine, and the only place a booking changes state:
 *
 *     held ──confirm──▶ confirmed ──▶ completed | no_show
 *      │  └──reaper───▶ expired
 *      └──cancel──▶ cancelled        confirmed ──cancel──▶ cancelled
 *
 * Two invariants carry the whole module, and neither is enforced by being
 * careful:
 *
 *   1. ONE OCCUPYING BOOKING PER SLOT is enforced by the unique index on the
 *      generated `slot_key` column (ADR-029), not by the availability check
 *      below. The check produces a civil error message; the index is what
 *      makes the guarantee. Anything that reads "check then insert" in this
 *      file is a courtesy, and the `catch` around the insert is the guard.
 *   2. THE PRICE IS FROZEN AT CREATION (§79). Nothing here recomputes it —
 *      not on reschedule, not on confirm. Reading it back through
 *      `astrologers.session_rate_paise` would rewrite the price of every past
 *      booking the moment somebody edits a rate.
 */
@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * The price snapshot for this modality, or a refusal explaining what is
   * missing.
   *
   * VOICE freezes an amount: the slot is the product and the price is known.
   * CHAT freezes an AUTHORISED CEILING and the per-minute rate (ADR-052).
   * Per-minute cannot be collected at booking because the amount is not yet
   * knowable, and with no wallet the only route is authorise-the-cap then
   * capture-the-actual — which needs a cap.
   */
  private static priceFor(
    astrologer: {
      sessionMinutes: number;
      sessionRatePaise: number | null;
      chatRatePerMinutePaise: number | null;
      chatMaxMinutes: number;
    },
    modality: Modality,
  ): PriceSnapshot {
    if (modality === 'voice') {
      if (astrologer.sessionRatePaise === null) {
        // "Publishable but not bookable" is a real state (O3): the directors
        // are listed without a price on purpose. Saying so is better than
        // charging zero or inventing a number.
        throw new ConflictException('This astrologer has no session price set and cannot be booked yet.');
      }
      return {
        pricePaise: astrologer.sessionRatePaise,
        sessionMinutes: astrologer.sessionMinutes,
        chatRatePerMinutePaise: null,
      };
    }

    if (astrologer.chatRatePerMinutePaise === null) {
      throw new ConflictException('This astrologer has no chat rate set and cannot be booked for chat yet.');
    }

    /*
     * THE SLOT IS THE CONTAINER, so the authorised minutes are clamped to it.
     *
     * A 30-minute slot with `chatMaxMinutes` of 45 would otherwise authorise a
     * chat that runs a quarter of an hour into the next customer's time. The
     * astrologer configuration is the real defect there; clamping keeps the
     * booking honest while it persists, and the clamp is logged so the
     * misconfiguration is visible rather than absorbed.
     */
    const minutes = Math.min(astrologer.chatMaxMinutes, astrologer.sessionMinutes);
    return {
      pricePaise: authorisationCeilingPaise(minutes, astrologer.chatRatePerMinutePaise),
      sessionMinutes: minutes,
      chatRatePerMinutePaise: astrologer.chatRatePerMinutePaise,
    };
  }

  /**
   * Is this exact instant a slot this astrologer is offering?
   *
   * Asks `slotsFor` for a one-millisecond window and requires an EXACT match,
   * which tests alignment, the weekly window, blocks and past-ness in one go —
   * all by the same code that produced the slot the customer clicked on. A
   * looser test here ("is it inside a window?") would accept 09:07 on a grid
   * of half hours and put a booking somewhere the astrologer never offered.
   */
  private async isOffered(astrologerId: string, slotStart: Date): Promise<boolean> {
    const slots = await this.availability.slotsFor(
      astrologerId,
      slotStart,
      new Date(slotStart.getTime() + 1),
    );
    return slots.some((s) => s.startsAt.getTime() === slotStart.getTime());
  }

  /**
   * Creates a HELD booking (tasks 6.2, 6.3).
   *
   * The hold is the DATABASE ROW, not a Redis key. Redis is a UI optimisation
   * and nothing more: a hold that disappears when a cache evicts is not a hold.
   *
   * `idempotencyKey` is REQUIRED rather than optional. A double-click creating
   * two Razorpay orders for one slot is the most likely incident at launch, and
   * an optional guard is one the client omits on the day it matters. The unique
   * index on `slot_key` protects the SLOT; this protects the CUSTOMER'S CARD.
   */
  async hold(
    input: { customerId: string; slug: string; slotStart: Date; modality: Modality },
    idempotencyKey: string,
    actor: AuditActor,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 64) {
      throw new BadRequestException('An Idempotency-Key header of at most 64 characters is required.');
    }
    if (input.modality !== 'voice' && input.modality !== 'chat') {
      throw new BadRequestException('modality must be "voice" or "chat".');
    }
    if (Number.isNaN(input.slotStart.getTime())) {
      throw new BadRequestException('That is not a valid slot time.');
    }

    /*
     * REPLAY FIRST, before anything that could object to the booking this
     * request itself created.
     *
     * Found by exercising the real endpoint: a double-click held the slot, and
     * the second request was then refused by the occupancy check below —
     * telling the customer their own booking had "just been taken". A client
     * that surfaced that honestly would send them to pick a different slot, and
     * they would end up with two.
     *
     * SCOPED BY CUSTOMER, because `idempotencyKey` is globally unique on the
     * table: an unscoped lookup would hand somebody else's booking to anyone
     * who guessed a key. (IdempotencyService closes the same hole one layer
     * down by hashing the customer id into the request body — this must not be
     * the place that reopens it.)
     */
    const replay = await this.prisma.booking.findFirst({
      where: { idempotencyKey, customerId: input.customerId },
    });
    if (replay) return BookingsService.describe(replay);

    const showFixtures = process.env.PUBLIC_SHOW_FIXTURES === 'true';
    const astrologer = await this.prisma.astrologer.findFirst({
      where: {
        slug: input.slug,
        publishedAt: { not: null },
        retiredAt: null,
        ...(showFixtures ? {} : { isDevFixture: false }),
      },
      select: {
        id: true,
        sessionMinutes: true,
        sessionRatePaise: true,
        chatRatePerMinutePaise: true,
        chatMaxMinutes: true,
      },
    });
    // Same answer a nonexistent slug gets — a draft or retired profile must not
    // be discoverable through the booking endpoint after being hidden from the
    // public one.
    if (!astrologer) throw new NotFoundException('No such astrologer.');

    const price = BookingsService.priceFor(astrologer, input.modality);
    if (input.modality === 'chat' && price.sessionMinutes < astrologer.chatMaxMinutes) {
      this.log.warn(
        `Astrologer ${astrologer.id} has chatMaxMinutes=${astrologer.chatMaxMinutes} ` +
          `but a ${astrologer.sessionMinutes}-minute slot; the chat authorisation was ` +
          `clamped to the slot. Fix the profile.`,
      );
    }

    /*
     * OCCUPANCY IS CHECKED BEFORE AVAILABILITY, and the order is the whole
     * value of this query.
     *
     * `slotsFor` now filters out slots that are already sold, so by the time
     * `isOffered` runs, a booked slot and a slot that never existed look
     * identical to it. Asking here first is what lets a customer be told "that
     * time has just been taken" — which is true, actionable and different from
     * "that is not a time this astrologer works". Run the other way round, this
     * query is dead code with a passing test beside it.
     *
     * It is still a courtesy rather than the guarantee: two simultaneous
     * requests both pass it, and the unique index is what rejects the loser.
     */
    const taken = await this.prisma.booking.findFirst({
      where: {
        astrologerId: astrologer.id,
        slotStart: input.slotStart,
        status: { notIn: [...NON_OCCUPYING_STATUSES] },
        // Belt to the replay check's braces: "somebody ELSE has this slot".
        idempotencyKey: { not: idempotencyKey },
      },
      select: { id: true },
    });
    if (taken) throw new ConflictException('That time has just been taken. Choose another slot.');

    if (!(await this.isOffered(astrologer.id, input.slotStart))) {
      throw new ConflictException('That time is not available. Choose another slot.');
    }

    const slotEnd = new Date(input.slotStart.getTime() + price.sessionMinutes * 60_000);

    const result = await this.idempotency.run(
      'booking.create',
      idempotencyKey,
      {
        customerId: input.customerId,
        slug: input.slug,
        slotStart: input.slotStart.toISOString(),
        modality: input.modality,
      },
      async () => {
        const id = ulid();
        const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.booking.create({
              data: {
                id,
                astrologerId: astrologer.id,
                customerId: input.customerId,
                slotStart: input.slotStart,
                slotEnd,
                modality: input.modality,
                status: 'held',
                pricePaise: price.pricePaise,
                sessionMinutes: price.sessionMinutes,
                chatRatePerMinutePaise: price.chatRatePerMinutePaise,
                holdExpiresAt,
                idempotencyKey,
              },
            });
            await this.audit.record(tx, {
              action: 'booking.held',
              targetType: 'Booking',
              targetId: id,
              // Ids, times and amounts only. A customer's name or email here
              // could never be erased again (ADR-040).
              after: {
                astrologerId: astrologer.id,
                slotStart: input.slotStart.toISOString(),
                modality: input.modality,
                pricePaise: price.pricePaise,
              },
              actor,
            });
          });
        } catch (err) {
          throw BookingsService.slotRace(err);
        }

        return {
          id,
          astrologerId: astrologer.id,
          slotStart: input.slotStart.toISOString(),
          slotEnd: slotEnd.toISOString(),
          modality: input.modality,
          status: 'held',
          sessionMinutes: price.sessionMinutes,
          pricePaise: price.pricePaise,
          chatRatePerMinutePaise: price.chatRatePerMinutePaise,
          holdExpiresAt: holdExpiresAt.toISOString(),
        };
      },
    );

    return result.value;
  }

  /** The wire shape of a booking. One definition, so a replay matches a create. */
  private static describe(b: {
    id: string;
    astrologerId: string;
    slotStart: Date;
    slotEnd: Date;
    modality: string;
    status: string;
    sessionMinutes: number;
    pricePaise: number;
    chatRatePerMinutePaise: number | null;
    holdExpiresAt: Date | null;
  }) {
    return {
      id: b.id,
      astrologerId: b.astrologerId,
      slotStart: b.slotStart.toISOString(),
      slotEnd: b.slotEnd.toISOString(),
      modality: b.modality,
      status: b.status,
      sessionMinutes: b.sessionMinutes,
      pricePaise: b.pricePaise,
      chatRatePerMinutePaise: b.chatRatePerMinutePaise,
      holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Turns a duplicate-slot error into an answer a customer can act on.
   *
   * P2002 on `slot_key` means the unique index refused a second occupying
   * booking for the same astrologer and instant — the race this module's whole
   * design is built around, working exactly as intended. Letting it escape as a
   * 500 would report the guard as an outage.
   */
  private static slotRace(err: unknown): unknown {
    const code = (err as { code?: string }).code;
    const target = String((err as { meta?: { target?: unknown } }).meta?.target ?? '');
    if (code === 'P2002' && target.includes('slot_key')) {
      return new ConflictException('That time has just been taken. Choose another slot.');
    }
    return err;
  }

  /**
   * Confirms a paid booking. Phase 7's Razorpay webhook is the intended caller.
   *
   * THERE IS DELIBERATELY NO CUSTOMER-FACING ROUTE TO THIS. The server is
   * authoritative for payment success (§78); a client that can say "I paid" is
   * a client that can book for free.
   *
   * THE TAX SPLIT IS REQUIRED, per the schema's own invariant: under
   * pay-at-booking the invoice is issued at booking, and adding a tax split to
   * already-paid rows is the uncorrectable retrofit the plan exists to avoid.
   * An unpaid held row may carry nulls; a paid one may not.
   *
   * THE HOLD CLOCK IS NOT CONSULTED. If the reaper has not yet flipped this
   * row, the slot is still ours and a payment that landed a second late must
   * still succeed — refusing after taking the money is worse than honouring a
   * slightly stale hold. If the reaper HAS flipped it, the status check below
   * fails loudly, because the slot may already have been resold and Phase 7
   * must refund rather than double-book.
   */
  async confirm(bookingId: string, tax: TaxSnapshot, actor: AuditActor) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('No such booking.');
    if (booking.status !== 'held') {
      throw new ConflictException(
        `This booking is "${booking.status}" and cannot be confirmed. If a payment ` +
          `succeeded against it, that payment must be refunded.`,
      );
    }
    for (const [name, v] of [
      ['taxableValuePaise', tax.taxableValuePaise],
      ['taxRateBp', tax.taxRateBp],
      ['taxAmountPaise', tax.taxAmountPaise],
    ] as const) {
      if (!Number.isInteger(v) || v < 0) {
        throw new BadRequestException(`${name} must be a non-negative integer number of paise.`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          // Cleared so a confirmed booking can never be picked up by the
          // reaper's `holdExpiresAt < now` sweep.
          holdExpiresAt: null,
          ...tax,
        },
      });
      await this.audit.record(tx, {
        action: 'booking.confirmed',
        targetType: 'Booking',
        targetId: bookingId,
        before: { status: 'held' },
        after: { status: 'confirmed', pricePaise: booking.pricePaise, taxAmountPaise: tax.taxAmountPaise },
        actor,
      });
    });

    return { id: bookingId, status: 'confirmed' };
  }

  /**
   * Cancels a booking and frees the slot.
   *
   * CANCELLING IS ALWAYS ALLOWED while the slot has not started. Refusing a
   * late cancellation does not make anybody turn up; it only stops the
   * astrologer finding out. What varies with lead time is the REFUND, which is
   * Phase 7 and owner action O4 — so this records who cancelled and how much
   * notice they gave, and decides nothing about the money.
   */
  async cancel(
    bookingId: string,
    by: CancelledBy,
    reason: string | undefined,
    actor: AuditActor,
    opts: { customerId?: string; astrologerId?: string } = {},
  ) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('No such booking.');

    // Ownership is checked HERE rather than in the controller so that every
    // route into cancellation gets the same check, including ones added later.
    if (opts.customerId && booking.customerId !== opts.customerId) {
      throw new NotFoundException('No such booking.');
    }
    if (opts.astrologerId && booking.astrologerId !== opts.astrologerId) {
      throw new NotFoundException('No such booking.');
    }

    if (booking.status !== 'held' && booking.status !== 'confirmed') {
      throw new ConflictException(`This booking is "${booking.status}" and cannot be cancelled.`);
    }

    const noticeMinutes = Math.round((booking.slotStart.getTime() - Date.now()) / 60_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: by,
          cancelReason: reason?.slice(0, 200) ?? null,
          holdExpiresAt: null,
        },
      });
      await this.audit.record(tx, {
        action: 'booking.cancelled',
        targetType: 'Booking',
        targetId: bookingId,
        before: { status: booking.status },
        after: {
          status: 'cancelled',
          cancelledBy: by,
          // The refund policy turns on this number, so it is recorded at the
          // moment it was true rather than recomputed later from a slot time
          // that a reschedule may since have moved.
          noticeMinutes,
          wasPaid: booking.status === 'confirmed',
        },
        actor,
      });
    });

    return { id: bookingId, status: 'cancelled', noticeMinutes };
  }

  /**
   * Moves a booking to a different slot (task 6.6).
   *
   * THIS IS ONE UPDATE, not a create-then-cancel pair.
   *
   * The plan says to acquire the new slot before releasing the old and never
   * the reverse, and a single UPDATE of `slot_start` is the strongest form of
   * that: MySQL recomputes the generated `slot_key` as part of the same
   * statement, so either the new slot was free and the move happened, or the
   * unique index rejected the whole statement and the booking still holds its
   * ORIGINAL slot. There is no instant at which the customer holds neither, and
   * none at which they hold both.
   *
   * Moving the row also keeps the price snapshot, the payment linkage and the
   * booking id attached to the thing the customer thinks of as their booking. A
   * new row would need the price copied across, and a copied price snapshot is
   * a recomputed price waiting to happen (§79).
   */
  async reschedule(
    bookingId: string,
    newSlotStart: Date,
    actor: AuditActor,
    opts: { customerId?: string; astrologerId?: string } = {},
  ) {
    if (Number.isNaN(newSlotStart.getTime())) {
      throw new BadRequestException('That is not a valid slot time.');
    }

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('No such booking.');
    if (opts.customerId && booking.customerId !== opts.customerId) {
      throw new NotFoundException('No such booking.');
    }
    if (opts.astrologerId && booking.astrologerId !== opts.astrologerId) {
      throw new NotFoundException('No such booking.');
    }

    if (booking.status !== 'held' && booking.status !== 'confirmed') {
      throw new ConflictException(`This booking is "${booking.status}" and cannot be moved.`);
    }
    if (newSlotStart.getTime() === booking.slotStart.getTime()) {
      throw new BadRequestException('That is the slot this booking is already in.');
    }
    if (booking.rescheduleCount >= MAX_RESCHEDULES) {
      throw new ConflictException(
        `This booking has already been moved ${MAX_RESCHEDULES} times. Cancel and book again.`,
      );
    }

    const noticeMinutes = (booking.slotStart.getTime() - Date.now()) / 60_000;
    if (noticeMinutes < RESCHEDULE_CUTOFF_MINUTES) {
      throw new ConflictException(
        `A booking can only be moved more than ${RESCHEDULE_CUTOFF_MINUTES} minutes ` +
          `before it starts. Cancel it instead.`,
      );
    }

    // The new slot is checked against the SAME astrologer. Moving a booking to
    // a different practitioner is not a reschedule — it is a different
    // consultation with a different person, at a price that may not match.
    if (!(await this.isOffered(booking.astrologerId, newSlotStart))) {
      throw new ConflictException('That time is not available. Choose another slot.');
    }

    // Duration comes from the FROZEN snapshot, not from the astrologer's
    // current sessionMinutes: a booking bought as 30 minutes stays 30 minutes
    // even if the profile has since moved to 45.
    const newSlotEnd = new Date(newSlotStart.getTime() + booking.sessionMinutes * 60_000);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            slotStart: newSlotStart,
            slotEnd: newSlotEnd,
            rescheduleCount: { increment: 1 },
          },
        });
        await this.audit.record(tx, {
          action: 'booking.rescheduled',
          targetType: 'Booking',
          targetId: bookingId,
          before: { slotStart: booking.slotStart.toISOString() },
          after: {
            slotStart: newSlotStart.toISOString(),
            rescheduleCount: booking.rescheduleCount + 1,
            wasPaid: booking.status === 'confirmed',
          },
          actor,
        });
      });
    } catch (err) {
      throw BookingsService.slotRace(err);
    }

    return {
      id: bookingId,
      slotStart: newSlotStart.toISOString(),
      slotEnd: newSlotEnd.toISOString(),
      rescheduleCount: booking.rescheduleCount + 1,
    };
  }

  /**
   * The abandoned-checkout reaper (task 6.10).
   *
   * A customer opens Razorpay, closes the tab, and without this the slot stays
   * held for ever — which at roster 3 is a visible chunk of the week gone.
   *
   * Row by row rather than one `updateMany`, on purpose: each expiry is a slot
   * being returned to sale and belongs in the audit log as its own event. The
   * batch limit keeps a backlog from turning one tick into a long transaction.
   */
  async expireHolds(now = new Date(), limit = 200): Promise<{ expired: number }> {
    const stale = await this.prisma.booking.findMany({
      where: { status: 'held', holdExpiresAt: { lt: now } },
      select: { id: true, astrologerId: true, slotStart: true },
      take: limit,
      orderBy: { holdExpiresAt: 'asc' },
    });

    let expired = 0;
    for (const b of stale) {
      // The status is re-checked inside the WHERE clause, and the audit row is
      // written in the SAME transaction as the flip. A payment that confirmed
      // this booking between the read above and the write below therefore wins:
      // updateMany matches nothing, the transaction records nothing, and we
      // leave it alone. Expiring a slot somebody has just paid for is the one
      // outcome worth engineering against here.
      const flipped = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.booking.updateMany({
          where: { id: b.id, status: 'held' },
          data: { status: 'expired' },
        });
        if (count === 0) return false;

        await this.audit.record(tx, {
          action: 'booking.expired',
          targetType: 'Booking',
          targetId: b.id,
          before: { status: 'held' },
          after: {
            status: 'expired',
            astrologerId: b.astrologerId,
            slotStart: b.slotStart.toISOString(),
          },
          actor: { id: 'scheduler', role: 'system' },
        });
        return true;
      });
      if (flipped) expired++;
    }

    if (expired > 0) this.log.log(`Expired ${expired} abandoned hold(s), freeing their slots`);
    return { expired };
  }

  async listForCustomer(customerId: string, opts: { upcomingOnly?: boolean } = {}) {
    return this.prisma.booking.findMany({
      where: {
        customerId,
        ...(opts.upcomingOnly ? { slotStart: { gte: new Date() } } : {}),
      },
      orderBy: { slotStart: 'desc' },
      take: 100,
      include: { astrologer: { select: { slug: true, nameEn: true, nameHi: true } } },
    });
  }

  async listForAstrologer(astrologerId: string, opts: { upcomingOnly?: boolean } = {}) {
    return this.prisma.booking.findMany({
      where: {
        astrologerId,
        // An astrologer's list is a work schedule, so the statuses that do not
        // occupy the slot are noise rather than information.
        status: { notIn: [...NON_OCCUPYING_STATUSES] },
        ...(opts.upcomingOnly ? { slotStart: { gte: new Date() } } : {}),
      },
      orderBy: { slotStart: 'asc' },
      take: 100,
      select: {
        id: true,
        slotStart: true,
        slotEnd: true,
        status: true,
        modality: true,
        sessionMinutes: true,
        rescheduleCount: true,
      },
    });
  }
}
