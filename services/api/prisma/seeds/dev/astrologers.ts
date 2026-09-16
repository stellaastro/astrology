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
  // Widened 2026-09-15. Twenty exercised the states; forty makes the admin
  // list, the roster page and the scheduling screens behave like real ones
  // rather than like a demo that fits on a single screen.
  ['विनोद', 'Vinod'], ['यामिनी', 'Yamini'], ['ज़ुबिन', 'Zubin'],
  ['अंजलि', 'Anjali'], ['बृजेश', 'Brijesh'], ['चारुलता', 'Charulata'],
  ['धीरज', 'Dheeraj'], ['एलीना', 'Eleena'], ['फिरोज़', 'Firoz'],
  ['गिरिजा', 'Girija'], ['हेमा', 'Hema'], ['ईशिता', 'Ishita'],
  ['जगदीश', 'Jagdish'], ['कीर्ति', 'Kirti'], ['लीला', 'Leela'],
  ['मनोहर', 'Manohar'], ['नंदिनी', 'Nandini'], ['ओमप्रकाश', 'Omprakash'],
  ['पल्लवी', 'Pallavi'], ['रमेश', 'Ramesh'],
] as const;

const SURNAME = [
  ['वर्मा', 'Verma'], ['गुप्ता', 'Gupta'], ['अय्यर', 'Iyer'],
  ['देसाई', 'Desai'], ['रेड्डी', 'Reddy'], ['जोशी', 'Joshi'],
  ['मिश्रा', 'Mishra'], ['नायर', 'Nair'], ['पटेल', 'Patel'],
  ['त्रिपाठी', 'Tripathi'], ['बोस', 'Bose'],
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

/**
 * Weekly windows, varied on purpose (task 5.1).
 *
 * A roster where everyone works identical hours never produces two
 * practitioners free at the same minute, never produces a day with nobody
 * available, and never produces a window too short for the session length —
 * which are exactly the states booking has to handle.
 */
const SHAPES: readonly (readonly { weekday: number; startMinute: number; endMinute: number }[])[] = [
  // Weekday mornings.
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 13 * 60 })),
  // Evenings, including the weekend.
  [0, 2, 4, 6].map((weekday) => ({ weekday, startMinute: 18 * 60, endMinute: 21 * 60 })),
  // Split day, two windows — the case a naive editor collapses into one.
  [1, 3, 5].flatMap((weekday) => [
    { weekday, startMinute: 10 * 60, endMinute: 12 * 60 },
    { weekday, startMinute: 16 * 60, endMinute: 19 * 60 },
  ]),
  // Weekend only.
  [0, 6].map((weekday) => ({ weekday, startMinute: 11 * 60, endMinute: 17 * 60 })),
  // A single short window: with a 60-minute session this yields exactly one slot.
  [3].map((weekday) => ({ weekday, startMinute: 20 * 60, endMinute: 21 * 60 })),
] as const;

/**
 * NOTE ON RESEEDING AFTER CHANGING THE NAME LISTS.
 *
 * The upsert is keyed on `slug`, which is DERIVED from the given name and
 * surname. Widening the surname list on 2026-09-15 changed the derivation, so
 * the existing twenty no longer matched their new slugs and the reseed added
 * forty more alongside them — 55 rows instead of 40.
 *
 * A seed keyed on derived data does not update in place when the derivation
 * changes; it accumulates. Clear the dataset first:
 *
 *     clearAstrologers(prisma)   // scoped to fixtureDataset, never to
 *                                // isDevFixture alone
 *
 * which is precisely why every fixture row carries a dataset id (ADR-036).
 */
export async function seedAstrologers(prisma: PrismaClient): Promise<number> {
  // Guards itself rather than trusting index.ts to have done it. This function
  // is exported, so "the caller checked" is true only until someone imports it
  // directly — which is exactly what the CI gate refuses to allow.
  assertDevelopment();

  const now = Date.now();
  let created = 0;

  for (let i = 0; i < GIVEN.length; i++) {
    const given = GIVEN[i]!;
    // 40 names over 11 surnames: the stride keeps every slug distinct.
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

    // Availability, so the schedule screens have something to render. Skipped
    // for two of them: "this astrologer has set no hours" is a state the UI has
    // to handle and it will not appear if every fixture has a full week.
    const row = await prisma.astrologer.findUnique({ where: { slug }, select: { id: true } });
    if (row && i % 9 !== 0) {
      await prisma.availabilityRule.deleteMany({ where: { astrologerId: row.id } });
      for (const w of SHAPES[i % SHAPES.length]!) {
        await prisma.availabilityRule.create({
          data: { id: nextId(), astrologerId: row.id, ...w },
        });
      }

      /*
       * A block on a day this astrologer ACTUALLY WORKS.
       *
       * The first version put every block a fixed week out, which landed on
       * weekdays for someone who only works weekends — so the block hid
       * nothing and the "away" state never appeared anywhere. A fixture that
       * cannot change the answer is not testing anything.
       */
      if (i % 4 === 0) {
        const shape = SHAPES[i % SHAPES.length]!;
        const worksOn = new Set(shape.map((w) => w.weekday));
        const IST_MS = 330 * 60_000;

        // Walk forward to the next date whose IST weekday is one they work.
        let day = new Date(now + 86_400_000);
        for (let guard = 0; guard < 14; guard++) {
          if (worksOn.has(new Date(day.getTime() + IST_MS).getUTCDay())) break;
          day = new Date(day.getTime() + 86_400_000);
        }

        const ist = new Date(day.getTime() + IST_MS);
        // Midnight IST on that date, expressed as the UTC instant it names.
        const from = new Date(
          Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 0, -330),
        );

        await prisma.availabilityBlock.deleteMany({ where: { astrologerId: row.id } });
        await prisma.availabilityBlock.create({
          data: {
            id: nextId(),
            astrologerId: row.id,
            startsAt: from,
            endsAt: new Date(from.getTime() + 86_400_000),
            reason: 'Sample block — away for the day',
          },
        });
      }
    }

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
