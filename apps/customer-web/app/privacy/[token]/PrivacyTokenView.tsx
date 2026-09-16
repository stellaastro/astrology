'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import s from '../../admin/login/LoginForm.module.css';

interface ExportShape {
  email: string;
  phone: string | null;
  locale: string;
  source: string | null;
  referralCode: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  consent: { at: string; policyVersion: string };
  confirmedAt: string | null;
  turnstileBypassed: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

type State =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'access'; data: ExportShape }
  | { phase: 'confirm-erase' }
  | { phase: 'erased' }
  | { phase: 'error'; message: string };

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';

/**
 * The page the emailed link lands on.
 *
 * ERASURE IS NEVER DONE BY LOADING THIS PAGE. Opening it only asks. The delete
 * happens on a POST from the button below, because mail clients, link scanners
 * and corporate security proxies all prefetch links — an erasure on GET would
 * delete people's records before they clicked anything.
 */
export default function PrivacyTokenView({ token }: { token: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  // The link is single use, and React re-runs effects on mount in development.
  // Without this guard the second run spends the token and the page shows
  // "invalid" for a link that was perfectly good.
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/v1/public/privacy/${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (res.status === 400) return setState({ phase: 'invalid' });
        if (!res.ok) return setState({ phase: 'error', message: `We could not open that link right now (${res.status}).` });

        const body = (await res.json()) as { kind: string; data?: ExportShape };
        if (body.kind === 'erasure') return setState({ phase: 'confirm-erase' });
        if (body.data) return setState({ phase: 'access', data: body.data });
        setState({ phase: 'invalid' });
      } catch {
        setState({ phase: 'error', message: 'Could not reach the server.' });
      }
    })();
  }, [token]);

  async function erase() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/public/privacy/${encodeURIComponent(token)}/erase`, { method: 'POST' });
      if (res.ok) setState({ phase: 'erased' });
      else if (res.status === 400) setState({ phase: 'invalid' });
      else setState({ phase: 'error', message: `We could not complete that (${res.status}). Nothing has been deleted.` });
    } catch {
      setState({ phase: 'error', message: 'Could not reach the server. Nothing has been deleted.' });
    } finally {
      setBusy(false);
    }
  }

  const head = (title: string, lede: string) => (
    <div className="masthead" lang="en">
      <div className="wrap">
        <p className="eyebrow">Your data</p>
        <h1 className="pageTitle">{title}</h1>
        <p className="pageLede">{lede}</p>
      </div>
    </div>
  );

  if (state.phase === 'loading') {
    return <div className="page" lang="en"><div className="wrap"><p className="pageLede">Opening your link…</p></div></div>;
  }

  if (state.phase === 'invalid') {
    return (
      <>
        {head('That link is not valid.', 'It may have expired, or it may already have been used — these links work once and last 24 hours. Nothing has been changed.')}
        <div className="page" lang="en"><div className="wrap">
          <p className="pageActions"><Link className="btn" href="/privacy">Ask for a new link</Link></p>
        </div></div>
      </>
    );
  }

  if (state.phase === 'error') {
    return (
      <>
        {head('Something went wrong.', state.message)}
        <div className="page" lang="en"><div className="wrap">
          <p className="pageActions"><Link className="btnGhost" href="/privacy">Back</Link></p>
        </div></div>
      </>
    );
  }

  if (state.phase === 'erased') {
    return (
      <>
        {head('Deleted.', 'Your record is gone, along with the queued email that carried your address.')}
        <div className="page" lang="en"><div className="wrap">
          <p className="pageLede">
            What remains is a dated note that an erasure happened. It records that a
            record was deleted and when — it does not contain your address.
          </p>
          <p className="pageNote">
            One honest caveat: if we ever restore the database from a backup taken
            before today, your row could come back. Re-applying completed erasures
            after a restore is a written step in our runbook.
          </p>
          <p className="pageActions"><Link className="btn" href="/">Back to home</Link></p>
        </div></div>
      </>
    );
  }

  if (state.phase === 'confirm-erase') {
    return (
      <>
        {head('Delete your record?', 'Nothing has been deleted yet. This asks first, because links in emails get opened by scanners and previews as well as by people.')}
        <div className="page" lang="en"><div className="wrap">
          <div className="panel waitlistPanel">
            <p style={{ marginTop: 0 }}>
              This removes your waitlist record and the queued email that carries
              your address. You will not hear from us when bookings open.
            </p>
            <button className={s.submit} type="button" onClick={erase} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete my record'}
            </button>
          </div>
          <p className="pageActions"><Link className="btnGhost" href="/">No, leave it as it is</Link></p>
        </div></div>
      </>
    );
  }

  const d = state.data;
  return (
    <>
      {head('Everything we hold about you.', 'This is the whole record — nothing is summarised or left out.')}
      <div className="page" lang="en"><div className="wrap">
        <dl className="terms">
          {([
            ['Email address', d.email],
            ['Phone', d.phone ?? '— none held'],
            ['Language', d.locale],
            ['Signed up', fmt(d.createdAt)],
            ['Confirmed the address', d.confirmedAt ? fmt(d.confirmedAt) : '— not confirmed'],
            ['Consent given', `${fmt(d.consent.at)} (policy ${d.consent.policyVersion})`],
            ['Where you came from', d.source ?? '— not recorded'],
            ['Referral code', d.referralCode ?? '— none'],
            ['Campaign tags', [d.utm.source, d.utm.medium, d.utm.campaign].filter(Boolean).join(' · ') || '— none'],
            ['IP address at signup', d.ip ?? '— not recorded'],
            ['Browser at signup', d.userAgent ?? '— not recorded'],
          ] as const).map(([k, v]) => (
            <div className="term" key={k}>
              <dt lang="en">{k}</dt>
              <dd lang="en">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="pageNote">
          This link has now been used. If you want this again, ask for a new one —
          and if you would rather we deleted all of it, you can ask for that too.
        </p>
        <p className="pageActions"><Link className="btn" href="/privacy">Make another request</Link></p>
      </div></div>
    </>
  );
}
