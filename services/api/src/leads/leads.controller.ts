import {
  Body, Controller, Get, Post, Query, Req, HttpCode, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { LeadsService, UNIFORM_RESPONSE } from './leads.service';
import { CreateLeadDto } from './create-lead.dto';

@Controller('public/leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /**
   * Public waitlist signup.
   *
   * 200, not 201: the response is deliberately identical whether a row was
   * created or the address was already present, and a 201 would leak which.
   *
   * Rate limited per IP. `trust proxy` is set in main.ts, so req.ip is the real
   * client rather than 127.0.0.1 — without that every request looks local and
   * the limit applies to nginx instead of the visitor.
   */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@Body() dto: CreateLeadDto, @Req() req: Request) {
    return this.leads.create(dto, req.ip, req.get('user-agent') ?? undefined);
  }

  /** Double opt-in confirmation, reached from the emailed link. */
  @Get('confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async confirm(@Query('token') token?: string) {
    if (!token || token.length !== 43) {
      throw new BadRequestException('That confirmation link is not valid.');
    }
    const res = await this.leads.confirm(token);
    switch (res.status) {
      case 'confirmed':
        return { status: 'confirmed', message: 'Thank you — your email is confirmed.' };
      case 'already':
        return { status: 'confirmed', message: 'Your email was already confirmed.' };
      case 'invalid':
        // Says something true. Telling someone with a mistyped or truncated
        // link that they are confirmed would leave them believing a thing that
        // is not so, which is worse than the non-existent probing risk.
        throw new BadRequestException(
          'That confirmation link is not valid. It may have been truncated by your email client — try copying the full address.',
        );
    }
  }
}

export { UNIFORM_RESPONSE };
