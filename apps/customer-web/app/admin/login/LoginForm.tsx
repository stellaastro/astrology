'use client';

import { useState } from 'react';
import s from './LoginForm.module.css';

/**
 * The sign-in form.
 *
 * There is deliberately NO "forgot password?" link, though the reference
 * layout has one. No password-reset flow exists — no reset endpoint, no token
 * table, no email template — so the link would go nowhere. A dead link on a
 * sign-in page is worse than its absence: it makes someone who has genuinely
 * forgotten their password wait for a mail that is never sent. Build the flow,
 * then add the link.
 *
 * One message for every failure, matching the API: it never says whether the
 * account exists. Repeating the API's wording here rather than inventing a
 * friendlier one keeps that property intact — a client that said "no such user"
 * would undo the work the server does to avoid saying it.
 */
export default function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The session arrives as an httpOnly cookie; nothing is read from the
        // body, so a script on this page can never lift the credential.
        credentials: 'same-origin',
        body: JSON.stringify({
          email: String(form.get('email') ?? '').trim(),
          password: String(form.get('password') ?? ''),
        }),
      });

      if (res.ok) {
        // A full navigation, not a router push: the server components on the
        // next page need the new cookie on their own request.
        window.location.href = '/admin';
        return;
      }

      /*
       * Only 401 means the credentials were wrong. Anything else is OUR fault,
       * and saying "incorrect password" would send someone off to re-check a
       * password that was fine — which is exactly what happened while building
       * this: a 404 from a misrouted proxy was reported as a bad password.
       */
      if (res.status === 401) {
        const body: unknown = await res.json().catch(() => null);
        const msg =
          body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : 'Email or password is incorrect.';
        setError(msg);
      } else if (res.status === 429) {
        setError('Too many attempts. Please wait a minute and try again.');
      } else {
        setError(`Sign-in is unavailable right now (${res.status}). Your password was not the problem.`);
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <div className={s.field}>
          {/* Persistent visible label, never a placeholder — DESIGN.md §4.
              The placeholder is a hint ALONGSIDE the label, not instead of it:
              once the field has content a placeholder-as-label is gone, and
              with it any way to know what the field was. */}
          <label className={s.label} htmlFor="admin-email">Email address</label>
          <div className={s.control}>
            <svg className={s.icon} width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            <input
              className={s.input}
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="Registered email address"
              required
            />
          </div>
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="admin-password">Password</label>
          <div className={s.control}>
            <svg className={s.icon} width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <input
              className={`${s.input} ${s.inputReveal}`}
              id="admin-password"
              name="password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              required
            />
            {/* type="button" so it never submits the form. aria-pressed rather
                than a changing label, so a screen reader announces the STATE
                rather than only the next action. */}
            <button
              className={s.reveal}
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-pressed={reveal}
              aria-controls="admin-password"
              aria-label={reveal ? 'Hide password' : 'Show password'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
                {reveal ? <path d="m4 20 16-16" /> : null}
              </svg>
            </button>
          </div>
        </div>

        <button className={s.submit} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
          {busy ? null : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          )}
        </button>

        <p className={s.status} role="alert" aria-live="polite">{error}</p>
      </form>

      <p className={s.or}>or</p>

      {/* A link, not a fetch: this is a full redirect to Google and back. */}
      <a className={s.google} href="/api/v1/auth/google?next=admin">Sign in with Google</a>

      <p className={s.note}>
        A Google account only works here once it has been granted a role.
      </p>
    </>
  );
}
