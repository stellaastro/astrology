import type { PrismaClient } from '@prisma/client';
import { monotonicFactory } from 'ulid';
import { assertDevelopment } from './guard';

const nextId = monotonicFactory();

/**
 * Synthetic customers (ADR-036).
 *
 * A CUSTOMER IS A USER with no admin and no astrologer role. There is no
 * separate table: identity is one thing (ADR-037), and what a person may do is
 * their roles. So these are User rows — which is exactly why User needed a
 * fixture marker before this file could exist.
 *
 * NONE OF THESE PEOPLE EXIST. Every address is @example.invalid, a reserved
 * TLD that cannot receive mail and cannot be registered by anyone. A seed that
 * can email a real person is a seed that eventually does.
 *
 * NO PASSWORDS, deliberately. Customers sign in with Google (ADR-037) and the
 * password column is null for everyone except the admin. Giving fixtures a
 * password would model something the product does not have.
 */
export const DATASET = 'dev-customers-v1';

/** Deterministic, so a reseed produces the same accounts. */
const GIVEN = [
  ['अनिल', 'Anil'], ['बबीता', 'Babita'], ['चंद्रा', 'Chandra'], ['दिव्या', 'Divya'],
  ['एकता', 'Ekta'], ['फरहान', 'Farhan'], ['गीता', 'Geeta'], ['हेमंत', 'Hemant'],
  ['इरा', 'Ira'], ['जतिन', 'Jatin'], ['कमला', 'Kamla'], ['लता', 'Lata'],
  ['मोहन', 'Mohan'], ['नेहा', 'Neha'], ['ओजस', 'Ojas'], ['पूजा', 'Pooja'],
  ['राहुल', 'Rahul'], ['सीमा', 'Seema'], ['तरुण', 'Tarun'], ['उषा', 'Usha'],
  ['विक्रम', 'Vikram'], ['यश', 'Yash'], ['ज़ोया', 'Zoya'], ['अदिति', 'Aditi'],
  ['भावना', 'Bhavna'], ['चेतना', 'Chetna'], ['दीपक', 'Deepak'], ['एषा', 'Esha'],
  ['गौरव', 'Gaurav'], ['हिना', 'Hina'],
] as const;

export async function seedCustomers(prisma: PrismaClient): Promise<number> {
  assertDevelopment();

  const now = Date.now();
  let created = 0;

  for (let i = 0; i < GIVEN.length; i++) {
    const g = GIVEN[i]!;
    const email = `dev.customer.${String(i).padStart(2, '0')}@example.invalid`;

    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        id: nextId(),
        email,
        name: `${g[1]} ${['Sharma', 'Patel', 'Nair', 'Bose', 'Khan'][i % 5]}`,
        // A stable fake Google subject. Real ones are numeric strings; this
        // shape matches without colliding with anything Google would issue.
        googleSub: `dev-sub-${String(i).padStart(4, '0')}`,
        passwordHash: null,     // customers have no password (ADR-037)
        roles: [],              // no roles at all — that is what a customer is
        /*
         * NEGATIVE CASES, seeded deliberately rather than left to chance:
         *   - two disabled accounts, so "this account is disabled" has
         *     something to render and the session guard has something to deny
         *   - a spread of last-login times including never, so an empty state
         *     and a stale state both appear
         * Seeding only the happy path is how the error states ship unlooked at.
         */
        disabledAt: i === 3 || i === 17 ? new Date(now - i * 86_400_000) : null,
        lastLoginAt: i % 7 === 0 ? null : new Date(now - i * 3_600_000),
        createdAt: new Date(now - i * 86_400_000),
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
 * Scoped by fixtureDataset, never by isDevFixture alone: "delete all the fake
 * ones" would take another dataset's rows with it, and on the users table it
 * would be one typo away from taking real accounts.
 */
export async function clearCustomers(prisma: PrismaClient): Promise<number> {
  assertDevelopment();
  const res = await prisma.user.deleteMany({
    where: { isDevFixture: true, fixtureDataset: DATASET },
  });
  return res.count;
}
