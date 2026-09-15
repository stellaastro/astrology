'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import s from '../admin.module.css';
import type { AdminAstrologer } from './page';

/**
 * One row, with its publish control.
 *
 * Publishing is the moment a profile becomes visible to the public, so it is a
 * deliberate button rather than a side effect of editing — which mirrors the
 * API, where it is a separate call with its own audit action.
 */
export default function AstrologerRow({ astrologer: a }: { astrologer: AdminAstrologer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState('');

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError('');
    const verb = a.published ? 'unpublish' : 'publish';
    try {
      const res = await fetch(`/api/v1/admin/astrologers/${a.id}/${verb}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.status === 409) {
        // The API refuses to publish fixtures and retired profiles. Show its
        // reason rather than a generic failure — the reason is the useful part.
        const body: unknown = await res.json().catch(() => null);
        const msg =
          body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : 'That profile cannot be published.';
        setError(msg);
      } else if (res.status === 401 || res.status === 403) {
        setError('Your session has expired. Reload and sign in again.');
      } else {
        // Never claim it worked. Nothing has changed on a non-2xx.
        setError(`Could not ${verb} (${res.status}). Nothing was changed.`);
      }
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Link this profile to a sign-in account.
   *
   * The account must already exist — the person signs in with Google once,
   * then an administrator links them. Creating an account here would mean
   * inventing a Google identity that cannot be verified.
   */
  async function link(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!email) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/v1/admin/astrologers/${a.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setLinking(false);
        setNotice('Linked. They can now sign in and see their profile.');
        router.refresh();
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      const msg =
        body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : '';
      // A 409 here is usually "they have not signed in yet", which is the
      // useful thing to say — not "conflict".
      setError(msg || `Could not link (${res.status}). Nothing was changed.`);
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const status = a.retired ? 'retired' : a.published ? 'live' : 'draft';
  const badgeClass =
    status === 'live' ? s.badgeLive : status === 'retired' ? s.badgeRetired : s.badgeDraft;

  return (
    <tr>
      <td>
        <span lang="hi">{a.nameHi}</span>
        <br />
        <span style={{ fontSize: '.85em' }}>
          {a.nameEn} · <code>{a.slug}</code>
        </span>
        {a.isDevFixture ? <> <span className={s.fixture}>sample</span></> : null}
      </td>
      <td>{a.experienceYears} yrs</td>
      <td>
        {a.sessionRateDisplay}
        <br />
        <span style={{ fontSize: '.85em' }}>per {a.sessionMinutes} min</span>
      </td>
      <td>
        <span className={`${s.badge} ${badgeClass}`}>{status}</span>
      </td>
      <td>
        <div className={s.rowActions}>
          <button
            className={s.action}
            type="button"
            onClick={() => { setLinking((v) => !v); setError(''); setNotice(''); }}
            disabled={busy}
          >
            {a.linked ? 'Relink account' : 'Link account'}
          </button>
          <button
            className={s.action}
            type="button"
            onClick={toggle}
            disabled={busy || a.retired || (a.isDevFixture && !a.published)}
            title={
              a.retired
                ? 'A retired profile cannot be published'
                : a.isDevFixture && !a.published
                  ? 'Sample data cannot be published — public pages are real or empty'
                  : undefined
            }
          >
            {busy ? '…' : a.published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
        {linking ? (
          <form onSubmit={link} style={{ marginTop: '.5rem', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            <label className="visually-hidden" htmlFor={`link-${a.id}`}>
              Account email for {a.nameEn}
            </label>
            <input
              id={`link-${a.id}`}
              name="email"
              type="email"
              required
              placeholder="their Google address"
              style={{
                minHeight: 'var(--tap)', padding: '0 .6rem', fontSize: 'var(--step--1)',
                border: '1px solid var(--ink-soft)', borderRadius: 'var(--radius)',
                background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-body)',
              }}
            />
            <button className={s.action} type="submit" disabled={busy}>
              {busy ? '…' : 'Link'}
            </button>
          </form>
        ) : null}

        {notice ? (
          <p role="status" style={{ margin: '.4rem 0 0', fontSize: '.85em', color: 'var(--leaf)' }}>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ margin: '.4rem 0 0', fontSize: '.85em', color: 'var(--cta)' }}>
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
