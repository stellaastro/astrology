import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { BookingsService, type Modality } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { Roles, type AuthedRequest } from '../auth/auth.guard';
import { SESSION_COOKIE } from '../auth/session.service';

function actorOf(req: AuthedRequest) {
  const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
  const raw = cookies[SESSION_COOKIE];
  return {
    id: req.user?.id ?? 'unknown',
    role: req.user?.roles?.[0] ?? 'unknown',
    ip: req.ip,
    sessionId: raw ? createHash('sha256').update(raw).digest('hex').slice(0, 16) : undefined,
  };
}

interface HoldBody { slug?: string; slotStart?: string; modality?: Modality }
interface CancelBody { reason?: string }
interface RescheduleBody { slotStart?: string }

/**
 * A customer's own bookings.
 *
 * Every route is scoped by the session's user id, and the scoping is passed
 * DOWN INTO the service rather than checked here: an ownership check that lives
 * in the controller is one that a second controller forgets.
 *
 * THERE IS NO CONFIRM ROUTE, deliberately. A booking becomes confirmed when
 * Razorpay says the money arrived (Phase 7), never because a browser said so —
 * the server is authoritative for payment success (§78), and a client that can
 * declare payment is a client that can book for free.
 */
@Controller('bookings')
/*
 * NO @Roles HERE, and that is the decoration, not an omission.
 *
 * There is no 'customer' role: a Google sign-in grants `roles: []` and a
 * customer is simply a signed-in person (ADR-037). The guard denies by default,
 * so bare @Controller already means "must be signed in" — requiring a
 * 'customer' role would 403 every real customer on the site.
 */
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  async mine(@Req() req: AuthedRequest, @Query('upcoming') upcoming?: string) {
    const rows = await this.bookings.listForCustomer(req.user?.id ?? '', {
      upcomingOnly: upcoming === 'true',
    });
    return {
      bookings: rows.map((b) => ({
        id: b.id,
        astrologer: { slug: b.astrologer.slug, nameEn: b.astrologer.nameEn, nameHi: b.astrologer.nameHi },
        slotStart: b.slotStart.toISOString(),
        slotEnd: b.slotEnd.toISOString(),
        status: b.status,
        modality: b.modality,
        sessionMinutes: b.sessionMinutes,
        pricePaise: b.pricePaise,
        capturedPaise: b.capturedPaise,
        chatRatePerMinutePaise: b.chatRatePerMinutePaise,
        rescheduleCount: b.rescheduleCount,
        holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Holds a slot.
   *
   * Rate-limited hard: an unthrottled hold endpoint lets one script hold every
   * slot on the roster, which takes the whole business offline without touching
   * a payment. The slot index stops a DOUBLE booking; it does nothing about a
   * thousand SINGLE ones.
   */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async hold(
    @Body() body: HoldBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    if (!body.slug || !body.slotStart) {
      throw new BadRequestException('slug and slotStart are required.');
    }
    if (!idempotencyKey) {
      throw new BadRequestException(
        'An Idempotency-Key header is required so a retry cannot create a second booking.',
      );
    }
    return this.bookings.hold(
      {
        customerId: req.user?.id ?? '',
        slug: body.slug,
        slotStart: new Date(body.slotStart),
        modality: body.modality ?? 'voice',
      },
      idempotencyKey,
      actorOf(req),
    );
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() body: CancelBody, @Req() req: AuthedRequest) {
    return this.bookings.cancel(id, 'customer', body.reason, actorOf(req), {
      customerId: req.user?.id ?? '',
    });
  }

  @Post(':id/reschedule')
  async reschedule(@Param('id') id: string, @Body() body: RescheduleBody, @Req() req: AuthedRequest) {
    if (!body.slotStart) throw new BadRequestException('slotStart is required.');
    return this.bookings.reschedule(id, new Date(body.slotStart), actorOf(req), {
      customerId: req.user?.id ?? '',
    });
  }
}

/**
 * The practitioner's own diary (task 4.2's second deliverable).
 *
 * The astrologer id comes from the SESSION, never the URL — the same reason
 * AstrologerAvailabilityController exists separately from the admin one.
 */
@Controller('astrologer/bookings')
@Roles('astrologer')
export class AstrologerBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
  ) {}

  private async mine(req: AuthedRequest): Promise<string> {
    const a = await this.prisma.astrologer.findUnique({
      where: { userId: req.user?.id ?? '' },
      select: { id: true },
    });
    if (!a) throw new NotFoundException('Your account is not linked to an astrologer profile yet.');
    return a.id;
  }

  @Get()
  async list(@Req() req: AuthedRequest, @Query('upcoming') upcoming?: string) {
    const id = await this.mine(req);
    const rows = await this.bookings.listForAstrologer(id, { upcomingOnly: upcoming !== 'false' });
    return {
      bookings: rows.map((b) => ({
        id: b.id,
        slotStart: b.slotStart.toISOString(),
        slotEnd: b.slotEnd.toISOString(),
        status: b.status,
        modality: b.modality,
        sessionMinutes: b.sessionMinutes,
        rescheduleCount: b.rescheduleCount,
      })),
    };
  }

  /**
   * An astrologer cancelling their own booking.
   *
   * Recorded as `cancelledBy: 'astrologer'`, which is the whole point of that
   * column: a customer cancelling two hours ahead and an astrologer cancelling
   * two minutes ahead are the same row today and must never be the same refund.
   */
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() body: CancelBody, @Req() req: AuthedRequest) {
    const astrologerId = await this.mine(req);
    return this.bookings.cancel(id, 'astrologer', body.reason, actorOf(req), { astrologerId });
  }
}

/** Admin oversight. At roster ≤12 a human resolving a booking by hand is normal. */
@Controller('admin/bookings')
@Roles('admin')
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('astrologer/:astrologerId')
  async forAstrologer(@Param('astrologerId') astrologerId: string) {
    return { bookings: await this.bookings.listForAstrologer(astrologerId, { upcomingOnly: false }) };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() body: CancelBody, @Req() req: AuthedRequest) {
    return this.bookings.cancel(id, 'admin', body.reason, actorOf(req));
  }

  @Post(':id/reschedule')
  async reschedule(@Param('id') id: string, @Body() body: RescheduleBody, @Req() req: AuthedRequest) {
    if (!body.slotStart) throw new BadRequestException('slotStart is required.');
    return this.bookings.reschedule(id, new Date(body.slotStart), actorOf(req));
  }
}
