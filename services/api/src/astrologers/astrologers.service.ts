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
  experienceYears: number | null;
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
  sessionRatePaise: number | null;
  sessionRateDisplay: string | null;
  sessionMinutes: number;
  /** False when no rate is set: named on the site, but not yet bookable. */
  bookable: boolean;
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
   * FIXTURES ARE EXCLUDED UNLESS EXPLICITLY ALLOWED, and the switch is its own
   * variable rather than APP_ENV.
   *
   * ADR-036 wants dev and staging to be 100% synthetic — that is the point of
   * a review server: to see the page populated. But an unconditional filter
   * meant the review server showed an empty roster, and making it depend on
   * APP_ENV would collapse two independent controls into one variable: the
   * boot guard already keys on APP_ENV, so a single wrong value would disable
   * both at once and put invented practitioners on a live site.
   *
   * PUBLIC_SHOW_FIXTURES has to be set deliberately, and is set only in
   * .env.review. Getting APP_ENV wrong in production is not enough to expose
   * a fixture; someone would have to add this as well.
   */
  async listPublic(): Promise<PublicAstrologer[]> {
    const showFixtures = process.env.PUBLIC_SHOW_FIXTURES === 'true';

    const rows = await this.prisma.astrologer.findMany({
      where: {
        publishedAt: { not: null },
        retiredAt: null,
        ...(showFixtures ? {} : { isDevFixture: false }),
      },
      /*
       * INSERTION ORDER, not experience.
       *
       * Sorting by experienceYears desc reads well until every value is null —
       * which is the state the three founding directors are actually in — and
       * then it collapses to alphabetical and silently reorders real people on
       * a live page. It put the Executive Director third.
       *
       * createdAt is stable (an edit does not change it) and preserves the
       * order they were entered in, which is the order the site has always
       * shown. If the owner ever wants to reorder them deliberately, that is a
       * displayOrder column, not a sort key that happens to work.
       */
      orderBy: { createdAt: 'asc' },
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
      sessionRateDisplay:
        a.sessionRatePaise === null ? null : Money.fromPaise(a.sessionRatePaise).format(),
      sessionMinutes: a.sessionMinutes,
      // Named on the site without a price is a real state, not a broken one.
      bookable: a.sessionRatePaise !== null,
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
      sessionRateDisplay:
        a.sessionRatePaise === null ? null : Money.fromPaise(a.sessionRatePaise).format(),
      sessionMinutes: a.sessionMinutes,
      bookable: a.sessionRatePaise !== null,
      // So the admin row can say "Relink" rather than offering to link an
      // account that is already attached.
      linked: a.userId !== null,
      published: a.publishedAt !== null,
      retired: a.retiredAt !== null,
      isDevFixture: a.isDevFixture,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async create(dto: CreateAstrologerDto, actor: AuditActor) {
    /*
     * Parsed BEFORE the write, so a malformed rate fails as a 400 rather than
     * landing as a rounded number nobody asked for.
     *
     * Absent is allowed and means "not bookable yet". Zero is not: a rate of
     * zero would read as a free consultation, which is a decision nobody made.
     */
    let ratePaise: number | null = null;
    if (dto.sessionRate !== undefined) {
      const rate = Money.fromString(dto.sessionRate);
      if (rate.paise <= 0) {
        throw new ConflictException('A session rate must be greater than zero.');
      }
      ratePaise = rate.paise;
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
            experienceYears: dto.experienceYears ?? null,
            languages: dto.languages,
            specialisations: dto.specialisations,
            sessionRatePaise: ratePaise,
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
   * Links an astrologer profile to a sign-in account, and grants the role.
   *
   * THIS IS THE MISSING HALF OF 4.2. Profiles are admin-created, so `userId` is
   * null until someone does this — and until it is set, an astrologer who signs
   * in reaches nothing, because there is no way to tell which profile is theirs.
   *
   * The account must ALREADY EXIST, which means they have signed in once with
   * Google. Creating an account here would mean inventing a password nobody
   * chose, or a Google identity that cannot be verified. Same reasoning as
   * grant-role: sign in first, then be granted.
   *
   * The role and the link are set in ONE transaction. A profile linked to an
   * account with no role is a person who cannot reach their own page; a role
   * with no link is a person whose page does not know who they are. Both
   * half-states are confusing in exactly the way that wastes an afternoon.
   */
  async linkAccount(id: string, email: string, actor: AuditActor) {
    const normalised = email.trim().toLowerCase();

    const astrologer = await this.prisma.astrologer.findUnique({ where: { id } });
    if (!astrologer) throw new NotFoundException('No such astrologer.');

    const user = await this.prisma.user.findUnique({ where: { email: normalised } });
    if (!user) {
      throw new ConflictException(
        `No account for ${normalised}. They must sign in once with Google first, ` +
          `then this can be linked.`,
      );
    }

    // userId is @unique: one account, one profile. A clearer message than the
    // raw P2002 that would otherwise surface.
    const taken = await this.prisma.astrologer.findUnique({ where: { userId: user.id } });
    if (taken && taken.id !== id) {
      throw new ConflictException(
        `That account is already linked to ${taken.nameEn}. One account, one profile.`,
      );
    }

    const before = Array.isArray(user.roles) ? (user.roles as string[]) : [];
    const after = [...new Set([...before, 'astrologer'])].sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.astrologer.update({ where: { id }, data: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { roles: after } });

      await this.audit.record(tx, {
        action: 'astrologer.account.linked',
        targetType: 'Astrologer',
        targetId: id,
        // The user's ULID, not their address: the audit log holds no personal
        // data (ADR-040), and the id is what makes the link traceable anyway.
        before: { userId: astrologer.userId, roles: before },
        after: { userId: user.id, roles: after },
        actor,
      });
    });

    this.log.log(`Linked astrologer ${astrologer.slug} to user ${user.id}`);
    return { id, userId: user.id, roles: after };
  }

  /**
   * The profile belonging to the signed-in astrologer.
   *
   * Looked up BY userId, never by a parameter. An endpoint that took an id and
   * checked it afterwards is one refactor away from not checking.
   */
  async findForUser(userId: string) {
    const a = await this.prisma.astrologer.findUnique({ where: { userId } });
    if (!a) {
      throw new NotFoundException(
        'Your account is not linked to an astrologer profile yet. An ' +
          'administrator needs to link it.',
      );
    }
    return {
      id: a.id,
      slug: a.slug,
      nameHi: a.nameHi,
      nameEn: a.nameEn,
      headline: a.headline,
      bio: a.bio,
      experienceYears: a.experienceYears,
      languages: asStringArray(a.languages),
      specialisations: asStringArray(a.specialisations),
      sessionRatePaise: a.sessionRatePaise,
      sessionRateDisplay:
        a.sessionRatePaise === null ? null : Money.fromPaise(a.sessionRatePaise).format(),
      sessionMinutes: a.sessionMinutes,
      bookable: a.sessionRatePaise !== null,
      published: a.publishedAt !== null,
      retired: a.retiredAt !== null,
    };
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
