import type { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';
import { assertDevelopment } from './guard';

const nextId = monotonicFactory();

/**
 * The synthetic astrologer roster (ADR-036, task 1.9 as widened).
 *
 * WHY TWENTY AND NOT THREE. The launch roster is three directors, and building
 * against three is how the interesting bugs get missed: availability
 * collisions, an admin queue with a second page, two practitioners free at the
 * same minute, a rate that is not round. Twenty is enough to make those states
 * reachable in development. It is not a forecast.
 *
 * NONE OF THESE PEOPLE EXIST, and the data says so on its face: every name is
 * drawn from the reserved seed set below, and none is a director's. The three
 * real directors are entered through the same admin screens at launch, as
 * data, never as code.
 *
 * Every row carries BOTH markers:
 *   - isDevFixture, which the boot guard refuses to serve in production
 *   - fixtureDataset, so cleanup deletes only what this run created. Deleting
 *     "where is_dev_fixture" would take another dataset's rows with it.
 */
export const DATASET = 'dev-roster-v1';

/** Deterministic, so a reseed produces the same slugs and ids are stable. */
const GIVEN = [
  ['आदित्य', 'Aditya'], ['भारती', 'Bharati'], ['चेतन', 'Chetan'],
  ['दीपिका', 'Deepika'], ['ईशान', 'Eshan'], ['फाल्गुनी', 'Falguni'],
  ['गायत्री', 'Gayatri'], ['हरीश', 'Harish'], ['इंदिरा', 'Indira'],
  ['जयंत', 'Jayant'], ['कविता', 'Kavita'], ['लक्ष्मण', 'Lakshman'],
  ['मीनाक्षी', 'Meenakshi'], ['नरेश', 'Naresh'], ['ओंकार', 'Omkar'],
  ['प्रीति', 'Preeti'], ['राधिका', 'Radhika'], ['सुरेश', 'Suresh'],
  ['तनुजा', 'Tanuja'], ['उमेश', 'Umesh'],
] as const;

const SURNAME = [
  ['वर्मा', 'Verma'], ['गुप्ता', 'Gupta'], ['अय्यर', 'Iyer'],
  ['देसाई', 'Desai'], ['रेड्डी', 'Reddy'],
] as const;

const LANGUAGES = [
  ['hi'], ['hi', 'en'], ['hi', 'en', 'mr'], ['hi', 'bh'], ['hi', 'en', 'ta'],
] as const;

const SPECIALISATIONS = [
  ['kundli', 'marriage'],
  ['career', 'education'],
  ['kundli', 'muhurta', 'vastu'],
  ['health', 'remedies'],
  ['marriage', 'matchmaking', 'kundli'],
  ['career', 'business', 'muhurta'],
] as const;

/**
 * Rates in PAISE, and deliberately not all round numbers.
 *
 * A roster where every price ends in 00 never exercises the rounding rule or
 * the tax split, and those are the calculations that must be right. 78900 =
 * ₹789.00; 125050 = ₹1250.50.
 */
const RATES_PAISE = [49900, 78900, 99900, 125050, 150000, 249975] as const;

export async function seedAstrologers(prisma: PrismaClient): Promise<number> {
  // Guards itself rather than trusting index.ts to have done it. This function
  // is exported, so "the caller checked" is true only until someone imports it
  // directly — which is exactly what the CI gate refuses to allow.
  assertDevelopment();

  const now = Date.now();
  let created = 0;

  for (let i = 0; i < GIVEN.length; i++) {
    const given = GIVEN[i]!;
    const surname = SURNAME[i % SURNAME.length]!;
    const slug = `${given[1]}-${surname[1]}`.toLowerCase();

    await prisma.astrologer.upsert({
      where: { slug },
      update: {},
      create: {
        id: nextId(),
        slug,
        nameHi: `${given[0]} ${surname[0]}`,
        nameEn: `${given[1]} ${surname[1]}`,
        headline: 'Sample profile — not a real practitioner',
        bio:
          'SAMPLE DATA. This profile was generated for development and does ' +
          'not describe a real person. It exists so screens can be built and ' +
          'tested before the real roster is entered.',
        // 3 to 32 years, so the "new practitioner" and "very senior" ends of
        // the range both render.
        experienceYears: 3 + ((i * 7) % 30),
        languages: [...LANGUAGES[i % LANGUAGES.length]!],
        specialisations: [...SPECIALISATIONS[i % SPECIALISATIONS.length]!],
        sessionRatePaise: RATES_PAISE[i % RATES_PAISE.length]!,
        // Not all 30: a 45 and 60 minute slot must not be a special case that
        // only appears in production.
        sessionMinutes: [30, 30, 45, 60][i % 4]!,
        /*
         * NEGATIVE CASES ARE SEEDED DELIBERATELY, not left to chance:
         *   - two unpublished, so the admin list has drafts and the public
         *     endpoint has something it must refuse to show
         *   - one retired, so "past bookings still resolve to a real row" has
         *     something to resolve to
         * Seeding only the happy path is how the empty and error states ship
         * having never been looked at.
         */
        publishedAt: i < 2 ? null : new Date(now - i * 86_400_000),
        retiredAt: i === 4 ? new Date(now - 3 * 86_400_000) : null,
        isDevFixture: true,
        fixtureDataset: DATASET,
      },
    });
    created++;
  }

  return created;
}

/**
 * Removes only THIS dataset's rows.
 *
 * Scoped by fixtureDataset rather than by isDevFixture: a reseed must never be
 * able to delete fixtures another dataset created, and "delete all the fake
 * ones" is exactly the command that does.
 */
export async function clearAstrologers(prisma: PrismaClient): Promise<number> {
  assertDevelopment();
  const res = await prisma.astrologer.deleteMany({
    where: { isDevFixture: true, fixtureDataset: DATASET },
  });
  return res.count;
}
