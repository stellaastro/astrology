import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SignOut from './SignOut';
import s from './admin.module.css';

/**
 * /admin — the waitlist.
 *
 * A server component, so the lead data never passes through the browser as
 * JSON the page then renders: it arrives already rendered. The session cookie
 * is forwarded on the server's own request to the API.
 *
 * AUTHORISATION IS THE API'S JOB, NOT THIS PAGE'S. This renders whatever the
 * API returns and redirects on a 401/403. A page that decided for itself who
 * may see leads would be a second, weaker copy of the rule — and the one an
 * attacker would go around.
 */
export const metadata: Metadata = {
  title: 'Waitlist — Stella Astrology',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

interface Lead {
  id: string;
  email: string;
  phone: string | null;
  locale: string;
  source: string | null;
  confirmedAt: string | null;
  createdAt: string;
  isDevFixture: boolean;
}

interface Page {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  leads: Lead[];
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page = '1' } = await searchParams;
  const jar = await cookies();
  const inbound = await headers();
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const prefix = process.env.API_GLOBAL_PREFIX ?? 'api/v1';

  /*
   * FORWARD THE REAL CLIENT IP. This request originates on the server, so
   * without this the API sees 127.0.0.1 and the audit trail records localhost
   * for every page view — which is exactly the field that makes the trail worth
   * keeping. The API trusts X-Forwarded-For only from loopback ('trust proxy'
   * in main.ts), so this cannot be spoofed by a visitor.
   */
  const forwarded = inbound.get('x-forwarded-for') ?? '';
  const res = await fetch(`${base}/${prefix}/admin/leads?page=${encodeURIComponent(page)}&pageSize=25`, {
    headers: {
      cookie: jar.toString(),
      ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
      ...(inbound.get('user-agent') ? { 'user-agent': inbound.get('user-agent') as string } : {}),
    },
    cache: 'no-store',
  });

  // 401 means sign in; 403 means signed in without the role. Both send you to
  // the login page, which is the only useful destination either way.
  if (res.status === 401 || res.status === 403) redirect('/admin/login');
  if (!res.ok) throw new Error(`Could not load the waitlist (${res.status})`);

  const data = (await res.json()) as Page;
  const confirmed = data.leads.filter((l) => l.confirmedAt).length;

  return (
    <div className="page" lang="en">
      <div className="wrap">
        <div className={s.head}>
          <div>
            <p className="eyebrow">Waitlist</p>
            <h1 className="pageTitle">{data.total} {data.total === 1 ? 'person' : 'people'}</h1>
          </div>
          <SignOut />
        </div>

        <p className={s.summary}>
          {confirmed} of {data.leads.length} shown have confirmed their address.
          Only confirmed addresses are contactable.
          {' '}
          <a className={s.export} href={`/${prefix}/admin/leads/export.csv`}>Download CSV</a>
        </p>

        {data.leads.length === 0 ? (
          <p className={s.empty}>
            Nobody has signed up yet. This is the real count, not a placeholder.
          </p>
        ) : (
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Locale</th>
                  <th scope="col">Source</th>
                  <th scope="col">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.email}
                      {l.isDevFixture ? <span className={s.fixture}>sample</span> : null}
                    </td>
                    <td>
                      {l.confirmedAt
                        ? <span className={s.ok}>confirmed</span>
                        : <span className={s.pending}>unconfirmed</span>}
                    </td>
                    <td>{l.locale}</td>
                    <td>{l.source ?? '—'}</td>
                    <td>{fmt(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.pages > 1 ? (
          <nav className={s.pager} aria-label="Pages">
            {data.page > 1 ? <a href={`/admin?page=${data.page - 1}`}>Previous</a> : <span>Previous</span>}
            <span>Page {data.page} of {data.pages}</span>
            {data.page < data.pages ? <a href={`/admin?page=${data.page + 1}`}>Next</a> : <span>Next</span>}
          </nav>
        ) : null}

        <p className={s.note}>
          Every view of this page is recorded with your account, the time and
          your IP address. Downloading the CSV is recorded separately.
        </p>
      </div>
    </div>
  );
}
