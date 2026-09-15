import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SignOut from '../SignOut';
import AdminNav from '../AdminNav';
import AstrologerRow from './AstrologerRow';
import NewAstrologer from './NewAstrologer';
import s from '../admin.module.css';

/**
 * /admin/astrologers
 *
 * A server component, for the same reason the waitlist page is one: the list
 * arrives already rendered rather than as JSON the browser then draws.
 *
 * AUTHORISATION IS THE API'S JOB. This renders what the API returns and
 * redirects on 401/403. A page that decided for itself who may create a
 * practitioner profile would be a second, weaker copy of the rule.
 */
export const metadata: Metadata = {
  title: 'Astrologers — Stella Astrology',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export interface AdminAstrologer {
  id: string;
  slug: string;
  nameHi: string;
  nameEn: string;
  experienceYears: number;
  languages: string[];
  specialisations: string[];
  sessionRatePaise: number;
  sessionRateDisplay: string;
  sessionMinutes: number;
  published: boolean;
  retired: boolean;
  isDevFixture: boolean;
  createdAt: string;
}

export default async function AdminAstrologersPage() {
  const jar = await cookies();
  const inbound = await headers();
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const prefix = process.env.API_GLOBAL_PREFIX ?? 'api/v1';

  // Forward the real client IP, or the audit trail records localhost for every
  // page view — the field that makes the trail worth keeping.
  const forwarded = inbound.get('x-forwarded-for') ?? '';
  const res = await fetch(`${base}/${prefix}/admin/astrologers`, {
    headers: {
      cookie: jar.toString(),
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      ...(inbound.get('user-agent') ? { 'user-agent': inbound.get('user-agent') as string } : {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401 || res.status === 403) redirect('/admin/login');
  if (!res.ok) throw new Error(`Could not load astrologers (${res.status})`);

  const { astrologers } = (await res.json()) as { astrologers: AdminAstrologer[] };
  /*
   * What the PUBLIC endpoint would actually return — fixtures excluded.
   *
   * The first version counted published && !retired, which on a seeded
   * database reported "17 visible on the public site" while the public roster
   * returned zero, because every row was a fixture. An admin number that
   * disagrees with the thing it describes is worse than no number: it is the
   * one a person would act on.
   */
  const live = astrologers.filter((a) => a.published && !a.retired && !a.isDevFixture).length;
  const fixtures = astrologers.filter((a) => a.isDevFixture).length;

  return (
    <>
      <div className="masthead" lang="en">
        <div className="wrap">
          <div className={s.head}>
            <div>
              <p className="eyebrow">Astrologers</p>
              <h1 className="pageTitle">
                {astrologers.length} {astrologers.length === 1 ? 'profile' : 'profiles'}
              </h1>
            </div>
            <SignOut />
          </div>
          <AdminNav />
        </div>
      </div>

      <div className="page" lang="en">
        <div className="wrap">
          <p className={s.summary}>
            {live} visible on the public site. A profile is created as a draft
            and stays invisible until you publish it.
            {fixtures > 0 ? (
              <>
                {' '}
                {fixtures} of these are <strong>sample data</strong> and can
                never be published — the public page is real or empty.
              </>
            ) : null}
          </p>

          {astrologers.length === 0 ? (
            <p className={s.empty}>
              No profiles yet. This is the real count, not a placeholder — and
              the public page shows nothing rather than inventing anyone.
            </p>
          ) : (
            <div className={s.scroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Experience</th>
                    <th scope="col">Rate</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {astrologers.map((a) => (
                    <AstrologerRow key={a.id} astrologer={a} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <NewAstrologer />

          <p className={s.note}>
            Every view of this page, and every profile created, edited or
            published, is recorded with your account, the time and your IP
            address.
          </p>
        </div>
      </div>
    </>
  );
}
