import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { Money } from '../common/money';
import type { CreateAstrologerDto, UpdateAstrologerDto } from './astrologer.dto';

const ulid = monotonicFactory();

/** Admin lists are capped for the same reason the lead list is (ADR-031). */
const MAX_PAGE = 100;

/** What the PUBLIC endpoint is allowed to say about a practitioner. */
export interface PublicAstrologer {
  slug: string;
  nameHi: string;
  nameEn: string;
  headline: string | null;
  bio: string | null;
  experienceYears: number;
  languages: string[];
  specialisations: string[];
  /*
   * BOTH, and on purpose.
   *
   * sessionRatePaise is the canonical value — an integer, which is the whole
   * reason Money exists. sessionRateDisplay is a convenience for rendering.
   *
   * An earlier version returned only the formatted string, which is "₹1,250.50"
   * — a localised display string with a currency symbol and Indian digit
   * grouping. Putting that in an API payload forces every client to parse it
   * back into a number, and parsing a formatted currency string is exactly the
   * step where a float creeps back in.
   */
  sessionRatePaise: number;
  sessionRateDisplay: string;
  sessionMinutes: number;
}

const asStringArray = (v: Prisma.JsonValue | null): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Astrologer profiles (ADR-043).
 *
 * ADMIN-CREATED, with no self-signup: at a roster of twelve or fewer a KYC
 * pipeline costs more than it protects, so a human enters the profile and a
 * human decides when it goes live.
 *
 * TWO RULES SHAPE EVERY QUERY HERE:
 *
 * 1. The public surface is REAL OR EMPTY. A profile is invisible until someone
 *    publishes it, and a fixture is invisible to the public endpoint even in
 *    development. §13 and §71 both forbid an invented practitioner on a
 *    registered company's site — a customer could try to book a person who
 *    does not exist.
 *
 * 2. The rate is INTEGER PAISE, always. It arrives as a string, is parsed by
 *    Money, and is stored as an integer. It is also the CURRENT rate and
 *    nothing more: a booking freezes its own snapshot (Phase 6), because
 *    reading the price back through this column would rewrite the price of
 *    every past booking the moment someone edits it.
 */
@Injectable()
export class AstrologersService {
  private readonly log = new Logger(AstrologersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The public roster.
   *
   * isDevFixture: false is belt AND braces. The boot guard already refuses to
   * serve when fixtures exist under a production profile, but that guard
   * protects production only — without this filter a demo of the public page
   * in development would show twenty invented practitioners and look right.
   */
  async listPublic(): Promise<PublicAstrologer[]> {
    const rows = await this.prisma.astrologer.findMany({
      where: {
        publishedAt: { not: null },
        retiredAt: null,
        isDevFixture: false,
      },
      orderBy: [{ experienceYears: 'desc' }, { nameEn: 'asc' }],
      take: MAX_PAGE,
    });

    return rows.map((a) => ({
      slug: a.slug,
      nameHi: a.nameHi,
      nameEn: a.nameEn,
      headline: a.headline,
      bio: a.bio,
      experienceYears: a.experienceYears,
      languages: asStringArray(a.languages),
      specialisations: asStringArray(a.specialisations),
      sessionRatePaise: a.sessionRatePaise,
      sessionRateDisplay: Money.fromPaise(a.sessionRatePaise).format(),
      sessionMinutes: a.sessionMinutes,
    }));
  }

  /** The admin list: everything, including drafts, fixtures and retirees. */
  async listForAdmin(actor: AuditActor) {
    const rows = await this.prisma.astrologer.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_PAGE,
    });

    await this.audit.record(this.prisma, {
      action: 'astrologer.list',
      targetType: 'Astrologer',
      after: { count: rows.length },
      actor,
    });

    return rows.map((a) => ({
      id: a.id,
      slug: a.slug,
      nameHi: a.nameHi,
      nameEn: a.nameEn,
      experienceYears: a.experienceYears,
      languages: asStringArray(a.languages),
      specialisations: asStringArray(a.specialisations),
      sessionRatePaise: a.sessionRatePaise,
      sessionRateDisplay: Money.fromPaise(a.sessionRatePaise).format(),
      sessionMinutes: a.sessionMinutes,
      published: a.publishedAt !== null,
      retired: a.retiredAt !== null,
      isDevFixture: a.isDevFixture,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async create(dto: CreateAstrologerDto, actor: AuditActor) {
    // Parsed BEFORE the write, so a malformed rate fails as a 400 rather than
    // landing as a rounded number nobody asked for.
    const rate = Money.fromString(dto.sessionRate);
    if (rate.paise <= 0) {
      throw new ConflictException('A session rate must be greater than zero.');
    }

    const id = ulid();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.astrologer.create({
          data: {
            id,
            slug: dto.slug,
            nameHi: dto.nameHi,
            nameEn: dto.nameEn,
            headline: dto.headline ?? null,
            bio: dto.bio ?? null,
            experienceYears: dto.experienceYears,
            languages: dto.languages,
            specialisations: dto.specialisations,
            sessionRatePaise: rate.paise,
            sessionMinutes: dto.sessionMinutes,
            // Created as a DRAFT, always. Publishing is a separate, audited
            // decision — nothing reaches the public site as a side effect of
            // being typed in.
            publishedAt: null,
          },
        });

        await this.audit.record(tx, {
          action: 'astrologer.created',
          targetType: 'Astrologer',
          targetId: row.id,
          after: { slug: row.slug, sessionRatePaise: row.sessionRatePaise },
          actor,
        });
        return row;
      });

      this.log.log(`Created astrologer ${created.slug}`);
      return { id: created.id, slug: created.slug, published: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`The slug "${dto.slug}" is already in use.`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateAstrologerDto, actor: AuditActor) {
    const existing = await this.prisma.astrologer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('No such astrologer.');

    const data: Prisma.AstrologerUpdateInput = {};
    if (dto.nameHi !== undefined) data.nameHi = dto.nameHi;
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn;
    if (dto.headline !== undefined) data.headline = dto.headline;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.experienceYears !== undefined) data.experienceYears = dto.experienceYears;
    if (dto.languages !== undefined) data.languages = dto.languages;
    if (dto.specialisations !== undefined) data.specialisations = dto.specialisations;
    if (dto.sessionMinutes !== undefined) data.sessionMinutes = dto.sessionMinutes;

    let ratePaise: number | undefined;
    if (dto.sessionRate !== undefined) {
      const rate = Money.fromString(dto.sessionRate);
      if (rate.paise <= 0) {
        throw new ConflictException('A session rate must be greater than zero.');
      }
      ratePaise = rate.paise;
      data.sessionRatePaise = ratePaise;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.astrologer.update({ where: { id }, data });
      await this.audit.record(tx, {
        action: 'astrologer.updated',
        targetType: 'Astrologer',
        targetId: id,
        /*
         * A RATE CHANGE IS RECORDED WITH BOTH SIDES. It is the one field here
         * with money consequences, and "what did this cost last month" has to
         * be answerable from the trail rather than inferred. Past bookings keep
         * their own frozen snapshot regardless (§79) — this is the record of
         * the decision, not of the bookings.
         */
        ...(ratePaise !== undefined
          ? {
              before: { sessionRatePaise: existing.sessionRatePaise },
              after: { sessionRatePaise: ratePaise },
            }
          : { after: { fields: Object.keys(data) } }),
        actor,
      });
    });

    return { id, updated: true };
  }

  /**
   * Publish or unpublish.
   *
   * A separate call, and separately audited, because this is the moment a
   * profile becomes visible to the public — the single decision on this model
   * that has consequences outside the admin screen.
   */
  async setPublished(id: string, published: boolean, actor: AuditActor) {
    const existing = await this.prisma.astrologer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('No such astrologer.');

    if (published && existing.isDevFixture) {
      // The boot guard would catch this in production; refusing here means the
      // mistake is a clear 409 in development rather than a crash-loop later.
      throw new ConflictException(
        'This is development fixture data and cannot be published. Public ' +
          'pages are real or empty (ADR-036).',
      );
    }
    if (published && existing.retiredAt) {
      throw new ConflictException('A retired astrologer cannot be published.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.astrologer.update({
        where: { id },
        data: { publishedAt: published ? new Date() : null },
      });
      await this.audit.record(tx, {
        action: published ? 'astrologer.published' : 'astrologer.unpublished',
        targetType: 'Astrologer',
        targetId: id,
        before: { published: existing.publishedAt !== null },
        after: { published },
        actor,
      });
    });

    return { id, published };
  }
}
