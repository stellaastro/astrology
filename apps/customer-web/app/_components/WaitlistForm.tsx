'use client';

/**
 * Waitlist signup.
 *
 * Posts to /api/v1/public/leads. That endpoint returns a BYTE-IDENTICAL response
 * whether the address is new or already on the list, so this component must not
 * try to distinguish them either — a "you're already signed up" message here
 * would rebuild the enumeration oracle the API deliberately removed.
 *
 * The success copy says an email is coming, and one now is: the confirmation
 * mail actually sends (MailModule). Before that handler existed this text would
 * have been a lie, which is why it is worth saying out loud.
 *
 * No Turnstile widget: TURNSTILE_SITE_KEY is not configured, and the API
 * degrades open by design. When a key is set, render the widget and pass
 * `turnstileToken` — the DTO already accepts it.
 */

import { useId, useRef, useState } from 'react';
import s from './WaitlistForm.module.css';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const GENERIC_ERROR =
  'Something went wrong on our side. Please try again in a moment, or write to guruji@stellaastro.com.';

export default function WaitlistForm() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const emailId = useId();
  const consentId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'sending') return;

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const consent = form.get('consent') === 'on';

    if (!consent) {
      setState({ kind: 'error', message: 'Please tick the box so we know we may email you.' });
      return;
    }

    setState({ kind: 'sending' });

    try {
      const res = await fetch('/api/v1/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          consent,
          locale: document.documentElement.lang || 'hi',
          source: 'landing',
        }),
      });

      if (res.ok) {
        setState({ kind: 'done' });
        formRef.current?.reset();
        return;
      }

      if (res.status === 429) {
        setState({
          kind: 'error',
          message: 'That is a few too many attempts. Please wait a minute and try again.',
        });
        return;
      }

      if (res.status === 400) {
        // The API returns an array of human-readable validation messages.
        const body: unknown = await res.json().catch(() => null);
        const msg =
          body && typeof body === 'object' && Array.isArray((body as { message?: unknown }).message)
            ? String((body as { message: unknown[] }).message[0])
            : 'Please check the address and try again.';
        setState({ kind: 'error', message: msg });
        return;
      }

      setState({ kind: 'error', message: GENERIC_ERROR });
    } catch {
      // Network failure. Never claim success — the row may not exist.
      setState({ kind: 'error', message: GENERIC_ERROR });
    }
  }

  if (state.kind === 'done') {
    return (
      <div className={s.done} role="status">
        <p className={s.doneTitle}>एक ईमेल भेजा गया है।</p>
        <p lang="en">
          Check your inbox and click the link to confirm. If it does not arrive
          within a few minutes, look in your spam folder.
        </p>
      </div>
    );
  }

  return (
    <>
      <form className={s.form} onSubmit={onSubmit} ref={formRef} noValidate>
        {/* Label is visible and persistent — never a placeholder (DESIGN.md §8). */}
        <div className={s.field}>
          <label className={s.label} htmlFor={emailId} lang="en">
            Email address
          </label>
          <input
            className={s.input}
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            inputMode="email"
            aria-describedby={`${emailId}-hint`}
          />
          <p className={s.hint} id={`${emailId}-hint`} lang="en">
            We write once when bookings open. Nothing else.
          </p>
        </div>

        <div className={s.consent}>
          <input className={s.check} id={consentId} name="consent" type="checkbox" required />
          <label htmlFor={consentId} lang="en">
            You may email me about Stella Astrology consultations.
          </label>
        </div>

        <button className={s.submit} type="submit" disabled={state.kind === 'sending'} lang="en">
          {state.kind === 'sending' ? 'Sending…' : 'Join the waitlist'}
        </button>

        {/* aria-live so the message is announced, not just shown. */}
        <p className={s.status} role="alert" aria-live="polite" lang="en">
          {state.kind === 'error' ? state.message : ''}
        </p>
      </form>

      {/* Without JavaScript the fetch above cannot run. Say so, and give a route
          that works, rather than presenting a form that silently does nothing. */}
      <noscript>
        <p className={s.hint} lang="en">
          This form needs JavaScript. Email{' '}
          <a href="mailto:guruji@stellaastro.com">guruji@stellaastro.com</a> and we
          will add you by hand.
        </p>
      </noscript>
    </>
  );
}
