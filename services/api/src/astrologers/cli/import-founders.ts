/**
 * Enters the three founding directors as real rows (task 4.3).
 *
 *   node dist/astrologers/cli/import-founders.js [--publish]
 *
 * WHY A CLI AND NOT THE ADMIN SCREEN. The screen exists and is the right tool
 * for every astrologer after these three. But this is a one-off migration of
 * content that was hardcoded in app/page.tsx, and running it through the admin
 * API would record the owner's account as having typed it in. The audit trail
 * should say what actually happened: a CLI run on the host, moving existing
 * public content into the database.
 *
 * WHAT IT DOES NOT DO. It enters names and company office and NOTHING ELSE.
 * Years of practice, credentials, specialisations, photographs and the
 * per-session price are owner action O3 and have not been supplied. Filling
 * them with plausible values is exactly what §13 forbids, and the schema now
 * allows them to be null precisely so the real people can exist without them
 * (ADR-044).
 *
 * Idempotent: re-running overwrites nothing.
 */
import { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

/**
 * Exactly the three names the landing page has shown since Phase 2,
 * transcribed unchanged. This is not new information — it is the same public
 * content, moved from a TypeScript array into the table it belongs in.
 */
const FOUNDERS = [
  { slug: 'shivpal-singh', nameHi: 'शिवपाल सिंह', nameEn: 'Shivpal Singh', headline: 'Executive Director' },
  { slug: 'krishn-kumar-sahu', nameHi: 'कृष्ण कुमार साहू', nameEn: 'Krishn Kumar Sahu', headline: 'Director' },
  { slug: 'ashok-kumar-sharma', nameHi: 'अशोक कुमार शर्मा', nameEn: 'Ashok Kumar Sharma', headline: 'Director' },
] as const;

async function main(): Promise<void> {
  const publish = process.argv.includes('--publish');
  const prisma = new PrismaClient();

  try {
    for (const f of FOUNDERS) {
      const existing = await prisma.astrologer.findUnique({ where: { slug: f.slug } });

      if (existing) {
        // Never overwrite. If the owner has since added real credentials
        // through the admin screen, a re-run must not wipe them.
        console.log(`  ${f.slug}: already present (${existing.publishedAt ? 'published' : 'draft'}) — left untouched`);

        if (publish && !existing.publishedAt) {
          await prisma.$transaction(async (tx) => {
            await tx.astrologer.update({ where: { id: existing.id }, data: { publishedAt: new Date() } });
            await tx.auditEvent.create({
              data: {
                id: ulid(),
                action: 'astrologer.published',
                targetType: 'Astrologer',
                targetId: existing.id,
                before: { published: false },
                after: { published: true },
                actorId: null,
                actorRole: 'cli',
                reason: 'import-founders --publish',
                ip: null,
                sessionId: null,
              },
            });
          });
          console.log(`  ${f.slug}: published`);
        }
        continue;
      }

      const id = ulid();
      await prisma.$transaction(async (tx) => {
        await tx.astrologer.create({
          data: {
            id,
            slug: f.slug,
            nameHi: f.nameHi,
            nameEn: f.nameEn,
            headline: f.headline,
            // Everything below is deliberately ABSENT, not zero. O3.
            experienceYears: null,
            sessionRatePaise: null,
            languages: [],
            specialisations: [],
            bio: null,
            photoKey: null,
            publishedAt: publish ? new Date() : null,
            // These are REAL people. Marking them as fixtures would make the
            // boot guard refuse to serve production.
            isDevFixture: false,
          },
        });
        await tx.auditEvent.create({
          data: {
            id: ulid(),
            action: 'astrologer.created',
            targetType: 'Astrologer',
            targetId: id,
            after: { slug: f.slug, source: 'import-founders', published: publish },
            actorId: null,
            actorRole: 'cli',
            reason: 'Migrating the Phase 2 static founder content to rows (task 4.3)',
            ip: null,
            sessionId: null,
          },
        });
      });
      console.log(`  ${f.slug}: created${publish ? ' and published' : ' as draft'}`);
    }

    const live = await prisma.astrologer.count({
      where: { publishedAt: { not: null }, retiredAt: null, isDevFixture: false },
    });
    console.log(`\n  visible on the public site: ${live}`);
    if (!publish) console.log('  (re-run with --publish to make them visible)');
    console.log(
      '\n  Still missing, and deliberately not invented: years of practice,\n' +
      '  credentials, specialisations, photographs and the per-session price.\n' +
      '  Those are owner action O3. Add them through /admin/astrologers.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('import-founders failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
