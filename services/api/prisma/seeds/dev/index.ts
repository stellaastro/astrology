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
 * The third control is the boot-time check (FixtureGuard) that refuses to serve
 * if fixture rows appear under a non-development profile. It now covers leads
 * AND astrologers — a fake practitioner on a registered company's live site is
 * someone attempting to book a person who does not exist, which is the worst
 * thing seed data can do here.
 *
 * Fixture identities use the reserved +9199999000NN block and example.invalid
 * addresses, which cannot receive mail. A seed that can email a real person is
 * a seed that eventually does.
 */
import { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';
import { seedAstrologers, DATASET } from './astrologers';
import { seedCustomers, DATASET as CUSTOMER_DATASET } from './customers';
import { assertDevelopment } from './guard';

const nextId = monotonicFactory();

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

  const astrologers = await seedAstrologers(prisma);
  console.log(`  seeded ${astrologers} development astrologers (dataset ${DATASET})`);

  const customers = await seedCustomers(prisma);
  console.log(`  seeded ${customers} development customers (dataset ${CUSTOMER_DATASET})`);
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
