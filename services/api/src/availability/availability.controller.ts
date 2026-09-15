import {
  Body, Controller, Delete, Get, Param, Put, Post, Query, Req, HttpCode,
  ForbiddenException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { AvailabilityService, type RuleInput } from './availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public, Roles, type AuthedRequest } from '../auth/auth.guard';
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

/** Body shapes, validated in the service so one rule lives in one place. */
interface ReplaceRulesBody { rules?: RuleInput[] }
interface AddBlockBody { startsAt?: string; endsAt?: string; reason?: string }

/**
 * An astrologer editing their OWN availability (task 4.2, 5.1).
 *
 * The astrologer id comes from the SESSION, never from the URL. This is the
 * whole reason this controller exists separately from the admin one: an
 * endpoint that takes an id and checks ownership afterwards is one refactor
 * away from not checking.
 */
@Controller('astrologer/availability')
@Roles('astrologer')
export class AstrologerAvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
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
  async mineNow(@Req() req: AuthedRequest) {
    const id = await this.mine(req);
    const [rules, blocks] = await Promise.all([
      this.availability.listRules(id),
      this.availability.listBlocks(id),
    ]);
    return { rules, blocks };
  }

  @Put('rules')
  async replace(@Body() body: ReplaceRulesBody, @Req() req: AuthedRequest) {
    const id = await this.mine(req);
    return { rules: await this.availability.replaceRules(id, body.rules ?? [], actorOf(req)) };
  }

  @Post('blocks')
  @HttpCode(201)
  async addBlock(@Body() body: AddBlockBody, @Req() req: AuthedRequest) {
    const id = await this.mine(req);
    if (!body.startsAt || !body.endsAt) throw new BadRequestException('startsAt and endsAt are required.');
    return this.availability.addBlock(
      id,
      { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), reason: body.reason },
      actorOf(req),
    );
  }

  @Delete('blocks/:blockId')
  async removeBlock(@Param('blockId') blockId: string, @Req() req: AuthedRequest) {
    const id = await this.mine(req);
    return this.availability.removeBlock(id, blockId, actorOf(req));
  }
}

/** An admin editing anyone's availability — at roster ≤12 this is normal. */
@Controller('admin/astrologers/:id/availability')
@Roles('admin')
export class AdminAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  async get(@Param('id') id: string) {
    const [rules, blocks] = await Promise.all([
      this.availability.listRules(id),
      this.availability.listBlocks(id),
    ]);
    return { rules, blocks };
  }

  @Put('rules')
  async replace(@Param('id') id: string, @Body() body: ReplaceRulesBody, @Req() req: AuthedRequest) {
    return { rules: await this.availability.replaceRules(id, body.rules ?? [], actorOf(req)) };
  }

  @Post('blocks')
  @HttpCode(201)
  async addBlock(@Param('id') id: string, @Body() body: AddBlockBody, @Req() req: AuthedRequest) {
    if (!body.startsAt || !body.endsAt) throw new BadRequestException('startsAt and endsAt are required.');
    return this.availability.addBlock(
      id,
      { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), reason: body.reason },
      actorOf(req),
    );
  }

  @Delete('blocks/:blockId')
  async removeBlock(
    @Param('id') id: string,
    @Param('blockId') blockId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.availability.removeBlock(id, blockId, actorOf(req));
  }
}

/**
 * Public slot lookup — what a customer sees when choosing a time.
 *
 * By SLUG, not id: this is the same identifier the public profile uses, and
 * exposing internal ids on a public route invites enumeration for no benefit.
 */
@Public()
@Controller('public/astrologers/:slug/slots')
export class PublicSlotsController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async slots(
    @Param('slug') slug: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const showFixtures = process.env.PUBLIC_SHOW_FIXTURES === 'true';
    const a = await this.prisma.astrologer.findFirst({
      where: {
        slug,
        publishedAt: { not: null },
        retiredAt: null,
        ...(showFixtures ? {} : { isDevFixture: false }),
      },
      select: { id: true, sessionMinutes: true, sessionRatePaise: true },
    });
    // A draft, retired or fixture profile is NOT FOUND to the public, not
    // "no slots" — the same answer an unknown slug gets, so this cannot be
    // used to discover which profiles exist but are unpublished.
    if (!a) throw new NotFoundException('No such astrologer.');

    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(start.getTime() + 14 * 86_400_000);

    const slots = await this.availability.slotsFor(a.id, start, end);
    return {
      sessionMinutes: a.sessionMinutes,
      // Without a price nothing here can be booked, and saying so is more
      // useful than returning times that lead nowhere.
      bookable: a.sessionRatePaise !== null,
      slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    };
  }
}
