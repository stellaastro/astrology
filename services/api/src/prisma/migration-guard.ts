import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma.service';

/**
 * Boot-time migration guard.
 *
 * WRITTEN AFTER TAKING PRODUCTION DOWN. A build that added `is_dev_fixture` to
 * the users table was deployed and restarted without the migration having been
 * applied. The fixture guard queried a column that did not exist, Prisma threw
 * P2022, and the API crash-looped behind a 502 for about two minutes. The
 * journal said:
 *
 *     column: 'stellaastro.users.is_dev_fixture'
 *
 * which is accurate and tells you almost nothing about what to do.
 *
 * So: compare the migrations on disk against the ones recorded in the
 * database, and if the code is ahead, say exactly that and name them. The
 * process still refuses to serve — running code against a schema it does not
 * match is worse than being down, and it fails in ways that corrupt data
 * rather than ways that page someone. The difference is the error message.
 *
 * This runs BEFORE FixtureGuard in the provider list, so the clear message
 * wins over the opaque one.
 */
@Injectable()
export class MigrationGuard implements OnApplicationBootstrap {
  private readonly log = new Logger(MigrationGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const dir = join(process.cwd(), 'prisma', 'migrations');
    if (!existsSync(dir)) {
      // Running from somewhere without the migrations folder — a test, or a
      // packaged deploy. Nothing to compare against, so say nothing.
      return;
    }

    let onDisk: string[];
    try {
      onDisk = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return;
    }
    if (onDisk.length === 0) return;

    let applied: string[];
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ migration_name: string }[]>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
      );
      applied = rows.map((r) => r.migration_name);
    } catch {
      // No _prisma_migrations table at all. That is a fresh database, which is
      // a different problem with its own loud failure; do not add noise here.
      return;
    }

    const pending = onDisk.filter((m) => !applied.includes(m));
    if (pending.length === 0) return;

    this.log.error(
      `REFUSING TO SERVE: ${pending.length} migration(s) exist in the code but ` +
        `have not been applied to this database:\n` +
        pending.map((m) => `    - ${m}`).join('\n') +
        `\n  Run:  npx prisma migrate deploy\n` +
        `  Then restart. Deploy order is MIGRATE, then restart — a build whose ` +
        `schema is ahead of the database fails on whichever query touches the ` +
        `missing column first, which is rarely the one that explains why.`,
    );
    process.exit(1);
  }
}
