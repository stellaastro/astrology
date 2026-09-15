import {
  Body, Controller, Get, Post, Param, Req, HttpCode, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrivacyService } from './privacy.service';
import { OpenPrivacyRequestDto } from './privacy.dto';
import { Public } from '../auth/auth.guard';

/**
 * The single reply the open endpoint ever gives.
 *
 * It says what was done, not what was found. "If we hold a record for that
 * address, a link is on its way" is true whether or not we do, which is the
 * only wording that does not turn this into a way to ask whether a named
 * person is on an astrology waitlist.
 */
const UNIFORM_OPEN_RESPONSE = {
  status: 'sent' as const,
  message:
    'If we hold a record for that address, we have emailed a link to it. ' +
    'The link is valid for 24 hours and can be used once.',
};

@Public()
@Controller('public/privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /**
   * Open an access or erasure request.
   *
   * Rate limited harder than signup: this endpoint sends mail to an address
   * chosen by the caller, so an unthrottled version is a way to use Stella to
   * post mail at someone.
   */
  @Post('requests')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async open(@Body() dto: OpenPrivacyRequestDto, @Req() req: Request) {
    await this.privacy.open(dto.email, dto.kind, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return UNIFORM_OPEN_RESPONSE;
  }

  /**
   * Read a request, and for an access request serve the data.
   *
   * GET is safe here and destructive nowhere: erasure is POST-only below.
   * That distinction is not pedantry — mail clients, link scanners and
   * corporate security proxies all prefetch links, so an erasure behind GET
   * would delete people's records before they ever clicked anything.
   */
  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async read(@Param('token') token: string, @Req() req: Request) {
    const reqRow = await this.privacy.resolve(token);
    if (!reqRow) throw new BadRequestException('That link is not valid, has already been used, or has expired.');

    if (reqRow.kind === 'erasure') {
      // Nothing is deleted yet. The caller confirms with a POST.
      return { kind: 'erasure' as const, status: 'confirm' as const };
    }

    const data = await this.privacy.exportFor(reqRow.id, reqRow.leadId, { ip: req.ip });
    if (!data) throw new BadRequestException('That link is not valid, has already been used, or has expired.');
    return { kind: 'access' as const, status: 'served' as const, data };
  }

  /** Execute an erasure. POST only — see the note on read(). */
  @Post(':token/erase')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async erase(@Param('token') token: string, @Req() req: Request) {
    const reqRow = await this.privacy.resolve(token);
    if (!reqRow || reqRow.kind !== 'erasure') {
      throw new BadRequestException('That link is not valid, has already been used, or has expired.');
    }

    const done = await this.privacy.erase(reqRow.id, reqRow.leadId, { ip: req.ip });
    if (!done) throw new BadRequestException('That link is not valid, has already been used, or has expired.');

    return {
      status: 'erased' as const,
      message:
        'Your record has been deleted, along with the queued email that ' +
        'carried your address. What remains is a dated note that an erasure ' +
        'happened, which does not contain your address.',
    };
  }
}
