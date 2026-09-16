'use client';

import { useState } from 'react';
import s from '../admin/login/LoginForm.module.css';

type Kind = 'access' | 'erasure';

/**
 * Opens a DPDP request.
 *
 * The success message says what was DONE, not what was FOUND — "if we hold a
 * record for that address, we've sent a link" is true either way. Saying "we
 * don't have you" would turn this form into a way to ask whether a named
 * person is on an astrology waitlist, which is the same oracle the waitlist
 * form is careful not to be.
 */
export default function PrivacyRequestForm() {
  const [kind, setKind] = useState<Kind>('access');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/v1/public/privacy/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(form.get('email') ?? '').trim(), kind }),
      });

      if (res.ok) {
        setSent(true);
      } else if (res.status === 429) {
        setError('Too many requests. Please wait a minute and try again.');
      } else if (res.status === 400) {
        setError('That does not look like a valid email address.');
      } else {
        // Never claim success we did not get. A silent failure here means a
        // statutory request that nobody ever received.
        setError(`We could not send that right now (${res.status}). Please try again, or write to guruji@stellaastro.com.`);
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p role="status">
        If we hold a record for that address, we have emailed a link to it. The
        link works once and expires in 24 hours. If nothing arrives, we do not
        have a record for that address.
      </p>
    );
  }

  return (
    <form className={s.form} onSubmit={onSubmit} noValidate>
      <fieldset className={s.field} style={{ border: 0, padding: 0, margin: '0 0 1.5rem' }}>
        <legend className={s.label} style={{ padding: 0 }}>What would you like?</legend>
        <label className={s.note} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', minHeight: 44, margin: 0 }}>
          <input type="radio" name="kind" value="access" checked={kind === 'access'}
                 onChange={() => setKind('access')} />
          A copy of what you hold about me
        </label>
        <label className={s.note} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', minHeight: 44, margin: 0 }}>
          <input type="radio" name="kind" value="erasure" checked={kind === 'erasure'}
                 onChange={() => setKind('erasure')} />
          Delete my record
        </label>
      </fieldset>

      <div className={s.field}>
        <label className={s.label} htmlFor="privacy-email">Email address</label>
        <div className={s.control}>
          <input className={s.input} id="privacy-email" name="email" type="email"
                 autoComplete="email" placeholder="The address you signed up with"
                 style={{ paddingLeft: '.85rem' }} required />
        </div>
      </div>

      <button className={s.submit} type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Email me the link'}
      </button>

      <p className={s.status} role="alert" aria-live="polite">{error}</p>
    </form>
  );
}
