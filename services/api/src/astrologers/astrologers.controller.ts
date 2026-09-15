import {
  Body, Controller, Get, Param, Patch, Post, Req, HttpCode,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { AstrologersService } from './astrologers.service';
import { CreateAstrologerDto, UpdateAstrologerDto } from './astrologer.dto';
import { Public, Roles, type AuthedRequest } from '../auth/auth.guard';
import { SESSION_COOKIE } from '../auth/session.service';

/**
 * The public roster.
 *
 * Returns published, non-retired, non-fixture profiles only — the filtering is
 * in the service, where it cannot be forgotten by a second caller.
 */
@Public()
@Controller('public/astrologers')
export class PublicAstrologersController {
  constructor(private readonly astrologers: AstrologersService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list() {
    return { astrologers: await this.astrologers.listPublic() };
  }
}

/**
 * Astrologer administration.
 *
 * Not @Public(): the app-wide guard denies by default and @Roles narrows it to
 * admins. Creating a practitioner profile decides who a customer can pay, so
 * it sits behind the same door as reading every customer's email address.
 */
@Controller('admin/astrologers')
@Roles('admin')
export class AdminAstrologersController {
  constructor(private readonly astrologers: AstrologersService) {}

  private actor(req: AuthedRequest) {
    const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
    const raw = cookies[SESSION_COOKIE];
    return {
      id: req.user?.id ?? 'unknown',
      role: req.user?.roles?.[0] ?? 'unknown',
      ip: req.ip,
      // The session's identity WITHOUT the credential, so two actions can be
      // tied to one sitting without the audit log storing a usable cookie.
      sessionId: raw ? createHash('sha256').update(raw).digest('hex').slice(0, 16) : undefined,
    };
  }

  @Get()
  async list(@Req() req: AuthedRequest) {
    return { astrologers: await this.astrologers.listForAdmin(this.actor(req)) };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateAstrologerDto, @Req() req: AuthedRequest) {
    return this.astrologers.create(dto, this.actor(req));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAstrologerDto,
    @Req() req: AuthedRequest,
  ) {
    return this.astrologers.update(id, dto, this.actor(req));
  }

  /** Publishing is its own call because it is its own decision. */
  @Post(':id/publish')
  @HttpCode(200)
  async publish(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.astrologers.setPublished(id, true, this.actor(req));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  async unpublish(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.astrologers.setPublished(id, false, this.actor(req));
  }
}
