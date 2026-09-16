'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import s from '../admin/admin.module.css';
import f from '../admin/login/LoginForm.module.css';

/**
 * The availability editor (task 4.2, the deliverable Phase 5 deferred).
 *
 * ALL TIMES HERE ARE IST WALL-CLOCK, because that is how an astrologer thinks
 * about their week and how the rule is stored (ADR-045). No conversion happens
 * in this component: minutes-from-midnight in, minutes-from-midnight out. A
 * timezone conversion in the editor would be a second place for the offset to
 * be applied, and applying it twice is the classic way a schedule slips by
 * five and a half hours.
 */

export interface Rule { id?: string; weekday: number; startMinute: number; endMinute: number }
export interface Block { id: string; startsAt: string; endsAt: string; reason: string | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** 570 -> "09:30". The value an <input type="time"> wants. */
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "09:30" -> 570. Returns null rather than NaN, which would reach the API. */
function toMinutes(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export default function AvailabilityEditor({
  initialRules,
  initialBlocks,
}: {
  initialRules: Rule[];
  initialBlocks: Block[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const addWindow = (weekday: number) => {
    setSaved(false);
    // 09:00–13:00 is a sane opening guess, not a hidden default: it appears in
    // the inputs where it can be seen and changed before saving.
    setRules((r) => [...r, { weekday, startMinute: 9 * 60, endMinute: 13 * 60 }]);
  };

  const removeWindow = (index: number) => {
    setSaved(false);
    setRules((r) => r.filter((_, i) => i !== index));
  };

  const setTime = (index: number, field: 'startMinute' | 'endMinute', value: string) => {
    const minutes = toMinutes(value);
    if (minutes === null) return;
    setSaved(false);
    setRules((r) => r.map((x, i) => (i === index ? { ...x, [field]: minutes } : x)));
  };

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);

    // Caught here as well as on the server, so the message names the day rather
    // than being a generic 400 from a round trip.
    for (const r of rules) {
      if (r.startMinute >= r.endMinute) {
        setError(`${DAYS[r.weekday]}: the finish time must be after the start time.`);
        setBusy(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/v1/astrologer/availability/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          rules: rules.map((r) => ({
            weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute,
          })),
        }),
      });

      if (res.ok) {
        setSaved(true);
        router.refresh();
        return;
      }

      const body: unknown = await res.json().catch(() => null);
      const msg =
        body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : '';

      /*
       * A 409 here is the useful one. It is either two windows overlapping, or
       * the 5.3 guard refusing a change that would strand a booking someone has
       * already paid for. Both messages name the problem, so show the server's
       * words rather than "conflict".
       */
      if (res.status === 409) setError(msg || 'That change conflicts with something. Nothing was saved.');
      else if (res.status === 400) setError(msg || 'Please check the times above.');
      else if (res.status === 401 || res.status === 403) setError('Your session has expired. Reload and sign in again.');
      else if (res.status === 404) setError('Your account is not linked to an astrologer profile yet.');
      else setError(`Could not save (${res.status}). Nothing was changed.`);
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const byDay = (d: number) =>
    rules.map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === d);

  return (
    <div className="panel" style={{ marginTop: 'var(--s4)' }}>
      <h2 style={{ fontSize: 'var(--step-2)', marginBottom: '.4rem' }}>Your weekly hours</h2>
      <p className={f.note} style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
        All times are India Standard Time. These repeat every week — use a block
        below for a one-off absence.
      </p>

      {DAYS.map((name, weekday) => {
        const windows = byDay(weekday);
        return (
          <div
            key={name}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 7rem) 1fr',
              gap: 'var(--s2)',
              alignItems: 'start',
              padding: 'var(--s2) 0',
              borderTop: '1px solid var(--rule)',
            }}
          >
            <strong style={{ fontWeight: 500 }}>{name}</strong>
            <div>
              {windows.length === 0 ? (
                <p style={{ margin: '0 0 .4rem', color: 'var(--ink-soft)', fontSize: 'var(--step--1)' }}>
                  Not working
                </p>
              ) : (
                windows.map(({ r, i }) => (
                  <div key={i} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap' }}>
                    <label className="visually-hidden" htmlFor={`start-${i}`}>{name} start time</label>
                    <input
                      id={`start-${i}`} type="time" value={toTime(r.startMinute)}
                      onChange={(e) => setTime(i, 'startMinute', e.target.value)}
                      style={{ minHeight: 'var(--tap)', padding: '0 .5rem', border: '1px solid var(--ink-soft)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-body)' }}
                    />
                    <span aria-hidden="true">to</span>
                    <label className="visually-hidden" htmlFor={`end-${i}`}>{name} finish time</label>
                    <input
                      id={`end-${i}`} type="time" value={toTime(r.endMinute)}
                      onChange={(e) => setTime(i, 'endMinute', e.target.value)}
                      style={{ minHeight: 'var(--tap)', padding: '0 .5rem', border: '1px solid var(--ink-soft)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-body)' }}
                    />
                    <button className={s.action} type="button" onClick={() => removeWindow(i)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
              <button className={s.action} type="button" onClick={() => addWindow(weekday)}>
                Add hours
              </button>
            </div>
          </div>
        );
      })}

      <div className={s.rowActions} style={{ marginTop: 'var(--s3)' }}>
        <button className={f.submit} type="button" onClick={save} disabled={busy} style={{ width: 'auto' }}>
          {busy ? 'Saving…' : 'Save my hours'}
        </button>
      </div>

      {saved ? (
        <p role="status" style={{ margin: '.6rem 0 0', color: 'var(--leaf)', fontSize: 'var(--step--1)' }}>
          Saved. These are the hours customers can book.
        </p>
      ) : null}
      <p className={f.status} role="alert" aria-live="polite">{error}</p>

      {initialBlocks.length > 0 ? (
        <>
          <h3 style={{ fontSize: 'var(--step-1)', marginTop: 'var(--s4)' }}>Time off</h3>
          <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', color: 'var(--ink-soft)', fontSize: 'var(--step--1)' }}>
            {initialBlocks.map((b) => (
              <li key={b.id}>
                {new Date(b.startsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}
                {' to '}
                {new Date(b.endsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}
                {b.reason ? ` — ${b.reason}` : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
