'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import s from '../admin.module.css';
import f from '../login/LoginForm.module.css';

/**
 * Create a profile.
 *
 * THE RATE FIELD IS TEXT, not <input type="number">. A number input hands back
 * a float, and a float is exactly what integer-paise Money exists to keep off
 * the money path — the API takes a string and parses it, so sending one is the
 * whole point. inputMode="decimal" still gets the numeric keypad on a phone.
 *
 * Languages and specialisations are comma-separated text for now. At a roster
 * of twelve a chip picker would be more UI than the problem deserves; it earns
 * its place when discovery lands, which is deferred past first revenue.
 */
export default function NewAstrologer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    const form = new FormData(e.currentTarget);
    const csv = (k: string) =>
      String(form.get(k) ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);

    try {
      const res = await fetch('/api/v1/admin/astrologers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          slug: String(form.get('slug') ?? '').trim(),
          nameHi: String(form.get('nameHi') ?? '').trim(),
          nameEn: String(form.get('nameEn') ?? '').trim(),
          headline: String(form.get('headline') ?? '').trim() || undefined,
          experienceYears: Number(form.get('experienceYears') ?? 0),
          languages: csv('languages'),
          specialisations: csv('specialisations'),
          // A string, deliberately. See the note on this component.
          sessionRate: String(form.get('sessionRate') ?? '').trim(),
          sessionMinutes: Number(form.get('sessionMinutes') ?? 30),
        }),
      });

      if (res.status === 201) {
        setOpen(false);
        router.refresh();
        return;
      }

      const body: unknown = await res.json().catch(() => null);
      const msg =
        body && typeof body === 'object' && 'message' in body
          ? // class-validator returns an array of messages; join them so the
            // person sees every field that is wrong, not just the first.
            (Array.isArray((body as { message: unknown }).message)
              ? ((body as { message: string[] }).message).join(' ')
              : String((body as { message: unknown }).message))
          : '';

      if (res.status === 409) setError(msg || 'That slug is already in use.');
      else if (res.status === 400) setError(msg || 'Please check the fields above.');
      else if (res.status === 401 || res.status === 403) setError('Your session has expired. Reload and sign in again.');
      else setError(`Could not create the profile (${res.status}). Nothing was saved.`);
    } catch {
      setError('Could not reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <p style={{ marginTop: 'var(--s4)' }}>
        <button className={s.action} type="button" onClick={() => setOpen(true)}>
          Add an astrologer
        </button>
      </p>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 'var(--s4)', maxWidth: '44rem' }}>
      <h2 style={{ fontSize: 'var(--step-2)', marginBottom: 'var(--s3)' }}>New profile</h2>

      <form onSubmit={onSubmit} noValidate>
        <div className={f.field}>
          <label className={f.label} htmlFor="na-nameHi">Name in Devanagari</label>
          <input className={f.input} id="na-nameHi" name="nameHi" lang="hi" required
                 style={{ paddingLeft: '.85rem' }} />
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-nameEn">Name in Latin script</label>
          <input className={f.input} id="na-nameEn" name="nameEn" required
                 style={{ paddingLeft: '.85rem' }} />
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-slug">URL slug</label>
          <input className={f.input} id="na-slug" name="slug" required
                 placeholder="shivpal-singh" pattern="[a-z0-9]+(-[a-z0-9]+)*"
                 style={{ paddingLeft: '.85rem' }} />
          <p className={f.note} style={{ borderTop: 0, paddingTop: '.3rem', marginTop: '.3rem' }}>
            Lowercase letters, digits and hyphens. Stable once published —
            changing it later breaks every link anyone has shared.
          </p>
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-headline">Headline (optional)</label>
          <input className={f.input} id="na-headline" name="headline" maxLength={160}
                 style={{ paddingLeft: '.85rem' }} />
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-experienceYears">Years of practice</label>
          <input className={f.input} id="na-experienceYears" name="experienceYears"
                 type="number" min={0} max={80} required defaultValue={10}
                 style={{ paddingLeft: '.85rem' }} />
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-languages">Languages</label>
          <input className={f.input} id="na-languages" name="languages" required
                 placeholder="hi, en" style={{ paddingLeft: '.85rem' }} />
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-specialisations">Specialisations</label>
          <input className={f.input} id="na-specialisations" name="specialisations" required
                 placeholder="kundli, marriage" style={{ paddingLeft: '.85rem' }} />
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-sessionRate">Rate per session (₹)</label>
          <input className={f.input} id="na-sessionRate" name="sessionRate" required
                 type="text" inputMode="decimal" placeholder="1250.50"
                 pattern="\d+(\.\d{1,2})?" style={{ paddingLeft: '.85rem' }} />
          <p className={f.note} style={{ borderTop: 0, paddingTop: '.3rem', marginTop: '.3rem' }}>
            Rupees, up to two decimal places. Stored to the paisa.
          </p>
        </div>

        <div className={f.field}>
          <label className={f.label} htmlFor="na-sessionMinutes">Session length (minutes)</label>
          <input className={f.input} id="na-sessionMinutes" name="sessionMinutes"
                 type="number" min={15} max={180} step={5} required defaultValue={30}
                 style={{ paddingLeft: '.85rem' }} />
          <p className={f.note} style={{ borderTop: 0, paddingTop: '.3rem', marginTop: '.3rem' }}>
            A booked slot bills for the slot, so this is the billed unit.
          </p>
        </div>

        <div className={s.rowActions}>
          <button className={f.submit} type="submit" disabled={busy} style={{ width: 'auto' }}>
            {busy ? 'Saving…' : 'Create as draft'}
          </button>
          <button className={s.action} type="button" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
        </div>

        <p className={f.status} role="alert" aria-live="polite">{error}</p>
      </form>
    </div>
  );
}
