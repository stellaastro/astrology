import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { generateSlots, rulesCollide, type Slot, type WeeklyRule } from './slots';

const ulid = monotonicFactory();

/** How far ahead anyone may ask for slots. */
const MAX_HORIZON_DAYS = 90;

const MINUTES_IN_DAY = 24 * 60;

export interface RuleInput {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Availability (tasks 5.1, 5.2).
 *
 * Two kinds of fact, stored differently on purpose:
 *
 *   - a WEEKLY RULE is a statement about local clock time ("Tuesdays 09:00 to
 *     13:00"), stored as an IST wall-clock window
 *   - a BLOCK is a real interval in the world ("away this weekend"), stored as
 *     UTC instants
 *
 * Conflating them is the mistake that makes a schedule drift: a rule stored as
 * a UTC instant means something different every time some other country
 * changes its clocks.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static validateRule(r: RuleInput): void {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) {
      throw new BadRequestException('weekday must be 0 (Sunday) to 6 (Saturday).');
    }
    for (const [name, v] of [['startMinute', r.startMinute], ['endMinute', r.endMinute]] as const) {
      if (!Number.isInteger(v) || v < 0 || v > MINUTES_IN_DAY) {
        throw new BadRequestException(`${name} must be between 0 and ${MINUTES_IN_DAY}.`);
      }
    }
    if (r.startMinute >= r.endMinute) {
      // A window that ends before it starts silently produces no slots, which
      // looks like "nobody is available" rather than like a mistake.
      throw new BadRequestException('A window must end after it starts.');
    }
  }

  async listRules(astrologerId: string) {
    return this.prisma.availabilityRule.findMany({
      where: { astrologerId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async listBlocks(astrologerId: string) {
    return this.prisma.availabilityBlock.findMany({
      where: { astrologerId, endsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Replaces the whole weekly grid in one transaction.
   *
   * REPLACE, not merge. An availability editor shows the week as a whole, and
   * "these are my hours" is one statement — applying it as a series of adds and
   * removes leaves a window open where the grid is half old and half new, and
   * a booking taken in that window is taken against hours nobody set.
   */
  async replaceRules(astrologerId: string, rules: RuleInput[], actor: AuditActor) {
    const astrologer = await this.prisma.astrologer.findUnique({ where: { id: astrologerId } });
    if (!astrologer) throw new NotFoundException('No such astrologer.');

    for (const r of rules) AvailabilityService.validateRule(r);

    /*
     * MySQL HAS NO EXCLUSION CONSTRAINTS (ADR-045), so overlapping windows can
     * only be refused here. Two windows covering the same minute generate the
     * same slot twice, and a duplicated slot is a double booking waiting for
     * two customers to find it.
     */
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        if (rulesCollide(rules[i]!, rules[j]!)) {
          throw new ConflictException(
            `Two windows on the same day overlap. Merge them into one instead.`,
          );
        }
      }
    }

    const before = await this.prisma.availabilityRule.count({ where: { astrologerId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({ where: { astrologerId } });
      for (const r of rules) {
        await tx.availabilityRule.create({
          data: {
            id: ulid(),
            astrologerId,
            weekday: r.weekday,
            startMinute: r.startMinute,
            endMinute: r.endMinute,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'availability.rules.replaced',
        targetType: 'Astrologer',
        targetId: astrologerId,
        before: { windowCount: before },
        after: { windowCount: rules.length },
        actor,
      });
    });

    return this.listRules(astrologerId);
  }

  async addBlock(
    astrologerId: string,
    input: { startsAt: Date; endsAt: Date; reason?: string | undefined },
    actor: AuditActor,
  ) {
    const astrologer = await this.prisma.astrologer.findUnique({ where: { id: astrologerId } });
    if (!astrologer) throw new NotFoundException('No such astrologer.');

    if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
      throw new BadRequestException('Those dates are not valid.');
    }
    if (input.startsAt.getTime() >= input.endsAt.getTime()) {
      throw new BadRequestException('A block must end after it starts.');
    }

    const id = ulid();
    await this.prisma.$transaction(async (tx) => {
      await tx.availabilityBlock.create({
        data: {
          id,
          astrologerId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'availability.block.added',
        targetType: 'Astrologer',
        targetId: astrologerId,
        after: { startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() },
        actor,
      });
    });

    return { id };
  }

  async removeBlock(astrologerId: string, blockId: string, actor: AuditActor) {
    const block = await this.prisma.availabilityBlock.findUnique({ where: { id: blockId } });
    // Scoped to the astrologer: without this, anyone who may edit ONE
    // astrologer's availability could delete another's block by id.
    if (!block || block.astrologerId !== astrologerId) {
      throw new NotFoundException('No such block.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.availabilityBlock.delete({ where: { id: blockId } });
      await this.audit.record(tx, {
        action: 'availability.block.removed',
        targetType: 'Astrologer',
        targetId: astrologerId,
        before: { startsAt: block.startsAt.toISOString(), endsAt: block.endsAt.toISOString() },
        actor,
      });
    });

    return { removed: true };
  }

  /**
   * Bookable slots for an astrologer in a window.
   *
   * Refuses an unbookable astrologer rather than returning an empty list: "no
   * slots" and "this person has no price set" are different answers, and
   * collapsing them is how a caller concludes someone is merely busy.
   */
  async slotsFor(astrologerId: string, from: Date, to: Date): Promise<Slot[]> {
    const astrologer = await this.prisma.astrologer.findUnique({ where: { id: astrologerId } });
    if (!astrologer) throw new NotFoundException('No such astrologer.');

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Those dates are not valid.');
    }
    if (to.getTime() - from.getTime() > MAX_HORIZON_DAYS * 86_400_000) {
      throw new BadRequestException(`Ask for at most ${MAX_HORIZON_DAYS} days at a time.`);
    }

    const [rules, blocks] = await Promise.all([
      this.prisma.availabilityRule.findMany({ where: { astrologerId } }),
      this.prisma.availabilityBlock.findMany({
        where: { astrologerId, endsAt: { gte: from }, startsAt: { lte: to } },
      }),
    ]);

    return generateSlots({
      rules: rules.map((r): WeeklyRule => ({
        weekday: r.weekday,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
      })),
      blocks,
      sessionMinutes: astrologer.sessionMinutes,
      bufferMinutes: astrologer.bufferMinutes,
      from,
      to,
      now: new Date(),
    });
  }
}
