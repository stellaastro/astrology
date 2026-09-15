import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Boot-time fixture guard — the runtime half of ADR-026.
 *
 * CI evaluates code, not the row contents of a deployed database. You cannot
 * fail a build over data that exists in an environment, which is why the
 * original ADR-017 control ("CI fails if any is_dev_fixture row reaches
 * staging or production") was not implementable as written.
 *
 * So the control splits: CI keeps seed modules unreachable from application
 * code, and this refuses to serve if their output ever appears somewhere it
 * should not.
 *
 * THE TRADEOFF, stated because it is a real cost: this accepts DOWNTIME over
 * contaminated data. A fake astrologer carrying a painted-on five-star badge,
 * on a registered company's public site, is worse than an outage — and an
 * outage is loud, which a fake profile is not.
 */
@Injectable()
export class FixtureGuard implements OnApplicationBootstrap {
  private readonly log = new Logger(FixtureGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unknown';
    if (env === 'development' || env === 'test') return;

    /*
     * Every table that can carry fixtures, checked in one pass.
     *
     * A LIST rather than a hardcoded query, because the failure mode here is
     * silence: this guard checked only `leads` until astrologers landed, and a
     * guard that does not know about the table you just added reports "all
     * clear" while the fixtures sit there. Adding a fixture-bearing table
     * without adding it here is the mistake this shape is meant to make hard.
     */
    const counts = await Promise.all([
      this.prisma.lead.count({ where: { isDevFixture: true } })
        .then((n) => ['leads', n] as const),
      this.prisma.astrologer.count({ where: { isDevFixture: true } })
        .then((n) => ['astrologers', n] as const),
    ]);

    const contaminated = counts.filter(([, n]) => n > 0);
    if (contaminated.length === 0) return;

    const detail = contaminated.map(([t, n]) => `${n} in ${t}`).join(', ');
    this.log.error(
      `REFUSING TO SERVE: found development fixture row(s) (${detail}) while ` +
        `APP_ENV="${env}". Seed data has reached a non-development ` +
        `environment. Remove the rows, then restart. See ADR-026 — this is ` +
        `deliberate: downtime beats fake data on a live site. A fake ` +
        `astrologer on a registered company's site is someone attempting to ` +
        `book a person who does not exist.`,
    );
    // process.exit rather than throw: systemd restarts on failure, and a
    // crash-loop with this message in the journal is exactly the loud signal
    // this guard exists to produce.
    process.exit(1);
  }
}
