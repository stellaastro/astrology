import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SignOut from '../admin/SignOut';
import AvailabilityEditor, { type Block, type Rule } from './AvailabilityEditor';
import s from '../admin/admin.module.css';

/**
 * /astrologer — what an astrologer sees (task 4.2).
 *
 * Dropping Flutter removed the astrologer app and nothing replaced it. This is
 * where a practitioner actually uses the system.
 *
 * WHAT IS DELIBERATELY NOT HERE. The availability editor is Phase 5, upcoming
 * bookings are Phase 6 and the join link is Phase 8 — none of those models
 * exists. Screens built against models that do not exist are how a demo gets
 * mistaken for a working feature, which this project has a rule about (§71).
 * So the page says what is coming and shows nothing that pretends to work.
 */
export const metadata: Metadata = {
  title: 'Your profile — Stella Astrology',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

interface SelfProfile {
  slug: string;
  nameHi: string;
  nameEn: string;
  headline: string | null;
  experienceYears: number | null;
  languages: string[];
  specialisations: string[];
  sessionRateDisplay: string | null;
  sessionMinutes: number;
  bookable: boolean;
  published: boolean;
  retired: boolean;
}

export default async function AstrologerPage() {
  const jar = await cookies();
  const inbound = await headers();
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const prefix = process.env.API_GLOBAL_PREFIX ?? 'api/v1';

  const forwarded = inbound.get('x-forwarded-for') ?? '';
  const res = await fetch(`${base}/${prefix}/astrologer/me`, {
    headers: {
      cookie: jar.toString(),
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      ...(inbound.get('user-agent') ? { 'user-agent': inbound.get('user-agent') as string } : {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401) redirect('/admin/login');

  // 403 means signed in without the role; 404 means the account is not linked
  // to a profile. Both are "an administrator needs to do something", and
  // saying which is more useful than a generic refusal.
  if (res.status === 403 || res.status === 404) {
    return (
      <>
        <div className="masthead" lang="en">
          <div className="wrap">
            <p className="eyebrow">Astrologer</p>
            <h1 className="pageTitle">Not set up yet.</h1>
            <p className="pageLede">
              Your account is signed in, but it is not linked to an astrologer
              profile. An administrator needs to link it before this page can
              show anything.
            </p>
          </div>
        </div>
        <div className="page" lang="en">
          <div className="wrap">
            <p className="pageActions"><SignOut /></p>
          </div>
        </div>
      </>
    );
  }

  if (!res.ok) throw new Error(`Could not load your profile (${res.status})`);
  const me = (await res.json()) as SelfProfile;

  /*
   * Availability is fetched separately and tolerantly: a failure here should
   * cost the astrologer the editor, not the whole page. Their profile is still
   * worth showing.
   */
  let rules: Rule[] = [];
  let blocks: Block[] = [];
  let availabilityFailed = false;
  try {
    const av = await fetch(`${base}/${prefix}/astrologer/availability`, {
      headers: {
        cookie: jar.toString(),
        ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      },
      cache: 'no-store',
    });
    if (av.ok) {
      const body = (await av.json()) as { rules?: Rule[]; blocks?: Block[] };
      rules = body.rules ?? [];
      blocks = body.blocks ?? [];
    } else {
      availabilityFailed = true;
    }
  } catch {
    availabilityFailed = true;
  }

  const status = me.retired ? 'retired' : me.published ? 'live' : 'draft';

  return (
    <>
      <div className="masthead" lang="en">
        <div className="wrap">
          <div className={s.head}>
            <div>
              <p className="eyebrow">Astrologer</p>
              <h1 className="pageTitle" lang="hi">{me.nameHi}</h1>
              <p className="pageLede">
                {me.nameEn}
                {me.headline ? <> · {me.headline}</> : null}
              </p>
            </div>
            <SignOut />
          </div>
        </div>
      </div>

      <div className="page" lang="en">
        <div className="wrap">
          <dl className="terms">
            <div className="term">
              <dt>On the site</dt>
              <dd>
                {status === 'live'
                  ? 'Your profile is visible to visitors.'
                  : status === 'retired'
                    ? 'Your profile is retired and not shown.'
                    : 'Your profile is a draft and is not shown to anyone yet.'}
              </dd>
            </div>
            <div className="term">
              <dt>Session</dt>
              <dd>
                {/* No price is a real state, not a broken one — it is still an
                    owner decision. Saying "not set" is honest; "₹0" would not
                    be. */}
                {me.sessionRateDisplay
                  ? `${me.sessionRateDisplay} for ${me.sessionMinutes} minutes`
                  : 'No rate set yet, so you cannot be booked. An administrator sets this.'}
              </dd>
            </div>
            <div className="term">
              <dt>Experience</dt>
              <dd>
                {me.experienceYears !== null
                  ? `${me.experienceYears} years`
                  : 'Not recorded yet.'}
              </dd>
            </div>
            <div className="term">
              <dt>Languages</dt>
              <dd>{me.languages.length ? me.languages.join(', ') : 'Not recorded yet.'}</dd>
            </div>
            <div className="term">
              <dt>Specialisations</dt>
              <dd>{me.specialisations.length ? me.specialisations.join(', ') : 'Not recorded yet.'}</dd>
            </div>
          </dl>

          {availabilityFailed ? (
            <p className="pageNote" role="alert">
              We could not load your availability just now. Please refresh — your
              existing hours have not been changed.
            </p>
          ) : (
            <AvailabilityEditor initialRules={rules} initialBlocks={blocks} />
          )}

          <p className="pageNote">
            Seeing upcoming bookings and joining a consultation are still being
            built. They are not here yet, and this page would rather say so than
            show you controls that do nothing. The details above — your rate,
            experience and specialisations — are changed by an administrator.
          </p>
        </div>
      </div>
    </>
  );
}
