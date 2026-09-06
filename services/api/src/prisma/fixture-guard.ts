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

    const count = await this.prisma.lead.count({ where: { isDevFixture: true } });
    if (count === 0) return;

    this.log.error(
      `REFUSING TO SERVE: found ${count} development fixture row(s) in the ` +
        `leads table while APP_ENV="${env}". Seed data has reached a ` +
        `non-development environment. Remove the rows, then restart. ` +
        `See ADR-026 — this is deliberate: downtime beats fake data on a live site.`,
    );
    // process.exit rather than throw: systemd restarts on failure, and a
    // crash-loop with this message in the journal is exactly the loud signal
    // this guard exists to produce.
    process.exit(1);
  }
}
