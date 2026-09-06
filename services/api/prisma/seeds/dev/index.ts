/**
 * Development seed data.
 *
 * ADR-026. The rule is *no fake data in production*, not *no seed data*: an
 * earlier revision deleted seeds entirely, which left nobody able to build or
 * demo a list or a calendar without real director records.
 *
 * Two guards, and neither is sufficient alone:
 *   - this file refuses to run outside development (below)
 *   - the CI gate (scripts/no-fixtures-in-prod.mjs) refuses to let seed modules
 *     be imported from application code
 *
 * The third control — a boot-time check that refuses to serve if fixture rows
 * appear under a non-development profile — lands with the Astrologer model in
 * Phase 4, because nothing seeded today carries an is_dev_fixture marker.
 *
 * Fixture identities use the reserved +9199999000NN block and example.invalid
 * addresses, which cannot receive mail. A seed that can email a real person is
 * a seed that eventually does.
 */
import { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';

const nextId = monotonicFactory();

function assertDevelopment(): void {
  // APP_ENV takes precedence; NODE_ENV is only the fallback when APP_ENV is
  // unset. An earlier version used
  //   APP_ENV !== 'development' && NODE_ENV !== 'development'
  // which let EITHER variable authorise the seed — so APP_ENV=production was
  // silently ignored while NODE_ENV stayed 'development', which is the normal
  // state of any Node process. Caught by actually running it, not by reading.
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'unset';
  if (env !== 'development') {
    throw new Error(
      `Refusing to seed: APP_ENV/NODE_ENV is "${env ?? 'unset'}", not "development". ` +
        `Seeds must never run against staging or production (ADR-026).`,
    );
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!/_dev(\?|$)/.test(url)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL does not point at a *_dev database. ` +
        `Environment separation is the whole control here.`,
    );
  }
}

export async function seed(prisma: PrismaClient): Promise<void> {
  assertDevelopment();

  // Enough rows to exercise list pagination and dense-vs-empty layout, which
  // is what fixtures are actually for now that discovery and ranking are cut.
  const LEADS = 25;
  const now = Date.now();

  for (let i = 0; i < LEADS; i++) {
    const email = `dev.lead.${String(i).padStart(2, '0')}@example.invalid`;
    await prisma.lead.upsert({
      where: { email },
      update: {},
      create: {
        id: nextId(),
        email,
        // Reserved test block. Never a number that could reach a person.
        phone: `+9199999000${String(i % 100).padStart(2, '0')}`,
        locale: i % 3 === 0 ? 'en' : 'hi',
        source: i % 4 === 0 ? 'referral' : 'direct',
        referralCode: i % 4 === 0 ? 'DEV-REF-01' : null,
        consentAt: new Date(now - i * 3_600_000),
        consentPolicyVersion: 'dev-1',
        // Half confirmed, half not: both states need to render.
        confirmedAt: i % 2 === 0 ? new Date(now - i * 3_500_000) : null,
        turnstileBypassed: i % 10 === 0,
        ip: '198.51.100.1', // TEST-NET-2, never routable
        userAgent: 'seed/dev',
        isDevFixture: true, // the boot guard looks for exactly this
      },
    });
  }

  console.log(`  seeded ${LEADS} development leads`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log('✓ dev seed complete'))
    .catch((err) => {
      console.error('✗ dev seed failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
