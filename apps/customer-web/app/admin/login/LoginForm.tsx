'use client';

import { useState } from 'react';
import s from './LoginForm.module.css';

/**
 * The sign-in form.
 *
 * One message for every failure, matching the API: it never says whether the
 * account exists. Repeating the API's wording here rather than inventing a
 * friendlier one keeps that property intact — a client that said "no such user"
 * would undo the work the server does to avoid saying it.
 */
export default function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
          <label className={s.label} htmlFor="admin-email">Email address</label>
          <input
            className={s.input}
            id="admin-email"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="admin-password">Password</label>
          <input
            className={s.input}
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button className={s.submit} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
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
