import {
  Controller, Headers, HttpCode, Param, Post, Req,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { Public, type AuthedRequest } from '../auth/auth.guard';
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

/**
 * Starting a payment. Signed in, and scoped to the caller's own booking.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('bookings/:id/order')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async order(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.payments.createOrder(id, req.user?.id ?? '', actorOf(req));
  }
}

/**
 * The Razorpay webhook.
 *
 * `@Public()` because Razorpay has no session — the SIGNATURE is the
 * authentication, and it is checked before anything else happens.
 *
 * THIS ROUTE NEEDS THE RAW BODY. `main.ts` keeps a copy on `req.rawBody` for
 * this path; verifying against re-serialised JSON changes whitespace and key
 * order, so the signature stops matching for reasons unrelated to authenticity
 * — and the usual response to that is to stop checking.
 *
 * DELIBERATELY NOT THROTTLED. Razorpay retries on a non-2xx, so rate-limiting
 * the webhook would turn a traffic spike into dropped payment confirmations,
 * and each drop is a customer charged for a booking that never confirmed. An
 * unsigned flood costs one HMAC per request, which is cheaper than that.
 */
@Public()
@Controller('payments/razorpay/webhook')
export class RazorpayWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    // No @Body(): this handler reads req.rawBody, and binding the parsed body
    // would only invite somebody to start trusting it.
    const raw = req.rawBody;
    if (!raw) {
      // Fail closed. Without the raw body the signature cannot be checked, and
      // processing anyway would accept forged webhooks — a forged
      // payment.authorized confirms a booking nobody paid for.
      throw new BadRequestException('Raw body unavailable; cannot verify signature.');
    }
    return this.payments.handleWebhook(raw, signature ?? '', eventId ?? '');
  }
}
