import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * /confirm?token=… — where the emailed confirmation link lands.
 *
 * The API endpoint returns JSON. Sending someone from their inbox to a page of
 * raw JSON is not a confirmation experience, so this page calls the API on the
 * server and says, in words, what happened.
 *
 * It reports three honest outcomes, never a blanket "you're confirmed". Telling
 * someone whose link was truncated by their mail client that they are on the
 * list would leave them believing something untrue — which is worse than asking
 * them to try again.
 */

export const metadata: Metadata = {
  title: 'Confirm your email — Stella Astrology',
  robots: { index: false, follow: false },
};

// The token is single-use-ish and personal; never let a proxy cache the result.
export const dynamic = 'force-dynamic';

type Outcome = 'confirmed' | 'invalid' | 'unavailable';

async function confirm(token: string | undefined): Promise<Outcome> {
  if (!token) return 'invalid';

  // Internal call: the API is on the same host, so this skips a public round
  // trip and keeps working if the public hostname is ever in flux.
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const prefix = process.env.API_GLOBAL_PREFIX ?? 'api/v1';

  try {
    const res = await fetch(
      `${base}/${prefix}/public/leads/confirm?token=${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (res.ok) return 'confirmed';
    if (res.status === 400) return 'invalid';
    // 5xx, or anything else: this is OUR fault, not a bad link. Saying "invalid"
    // would send someone off to re-check a link that was fine.
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const COPY: Record<Outcome, { title: string; lede: string; note?: string }> = {
  confirmed: {
    title: 'Your email is confirmed.',
    lede:
      'Thank you. You are on the waitlist, and we will write to you when bookings open.',
    note: 'We will not use this address for anything else.',
  },
  invalid: {
    title: 'That link is not valid.',
    lede:
      'It may have been truncated by your email client, or already replaced by a newer one. Try copying the full address from the email into your browser.',
    note: 'If it still does not work, write to us and we will confirm you by hand.',
  },
  unavailable: {
    title: 'We could not confirm that just now.',
    lede:
      'Something on our side is not responding. Your link is still good — please try again in a few minutes.',
    note: 'Nothing was lost; this did not remove you from anything.',
  },
};

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const outcome = await confirm(token);
  const copy = COPY[outcome];

  return (
    <div className="page" lang="en">
      <div className="wrap">
        <p className="eyebrow">Waitlist</p>
        <h1 className="pageTitle">{copy.title}</h1>
        <p className="pageLede">{copy.lede}</p>

        <p className="pageActions">
          <Link className="btn" href="/">Back to home</Link>
          <a className="btnGhost" href="mailto:guruji@stellaastro.com">
            guruji@stellaastro.com
          </a>
        </p>

        {copy.note ? <p className="pageNote">{copy.note}</p> : null}
      </div>
    </div>
  );
}
