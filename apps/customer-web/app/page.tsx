/**
 * Landing page.
 *
 * Header and footer live in app/layout.tsx so every route carries the brand,
 * the entity name and the no-professional-advice disclaimer. This file owns
 * only the page's own sections.
 *
 * Every statement here is true and checkable. Nothing is a placeholder dash,
 * a rating, a review count, a user total or a testimonial (§13).
 *
 * The astrologers are READ FROM THE DATABASE (task 4.3). Their experience,
 * specialisations and fees render only if those columns hold something — they
 * are still owner action O3, and inventing them is precisely what §13 forbids.
 *
 * There is deliberately no email capture form: the leads endpoint does not
 * exist yet (Phase 2) and a form that silently discards submissions is worse
 * than no form. A mailto link is honest about where the message goes.
 */

import StellaHero from './_components/StellaHero';
import WaitlistForm from './_components/WaitlistForm';

interface PublicAstrologer {
  slug: string;
  nameHi: string;
  nameEn: string;
  headline: string | null;
  experienceYears: number | null;
  languages: string[];
  specialisations: string[];
  sessionRateDisplay: string | null;
  sessionMinutes: number;
  bookable: boolean;
}

/**
 * The founding astrologers, from the database (task 4.3, ADR-044).
 *
 * They were a hardcoded array until 2026-09-15. They are now rows, entered
 * through the same admin screens any later astrologer will use — which is the
 * point: the launch roster stops being a special case in code.
 *
 * CACHED for five minutes rather than fetched per request. The names are the
 * one piece of substance on this page, and an API blip should not blank the
 * section; a stale copy of three names that have not changed since incorporation
 * is strictly better than an empty band.
 *
 * ON FAILURE IT RETURNS EMPTY, and the section says so honestly. It does NOT
 * fall back to a hardcoded copy: two sources of truth for who works here is
 * exactly the drift this task removed.
 */
async function getAstrologers(): Promise<PublicAstrologer[] | null> {
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const prefix = process.env.API_GLOBAL_PREFIX ?? 'api/v1';
  try {
    const res = await fetch(`${base}/${prefix}/public/astrologers`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { astrologers?: PublicAstrologer[] };
    return body.astrologers ?? [];
  } catch {
    return null;
  }
}

export default async function Home() {
  const astrologers = await getAstrologers();
  return (
    <>
      <StellaHero />

      {/* Billing terms. Gold-ruled STACKED ROWS, not a three-column feature
          grid — DESIGN.md §5 names that grid as the single most recognisable
          AI-generated layout.

          On lotus cream, so the page changes surface immediately after the
          hero instead of running one ivory field to the footer. Text on cream
          is measured, not assumed: --ink 10.49:1, --ink-soft 6.05:1.

          Everything here is settled architecture (ADR-023 pay-at-booking,
          ADR-024 slot-based). What is deliberately absent is the price and the
          refund policy: those are owner decisions (O3, O4) and inventing either
          is exactly what §13 forbids. */}
      <section id="terms" className="band-cream">
        <div className="wrap">
          <div className="sechead">
            <h2>शुल्क कैसे लगेगा</h2>
            <p lang="en">
              How charging will work when bookings open. No hidden meter, and
              nothing starts without you choosing it.
            </p>
          </div>

          <dl className="terms">
            <div className="term">
              <dt lang="en">You book a slot, not minutes</dt>
              <dd lang="en">
                A thirty-minute appointment is charged as a thirty-minute
                appointment. There is no per-minute timer running while you
                think, and no charge for a pause in the conversation.
              </dd>
            </div>
            <div className="term">
              <dt lang="en">You pay when you book</dt>
              <dd lang="en">
                The full amount is taken at the time you reserve the slot, so
                nothing is owed afterwards and there is no balance to top up.
              </dd>
            </div>
            <div className="term">
              <dt lang="en">You see the price before you pay</dt>
              <dd lang="en">
                The astrologer, the time and the amount are all shown on the
                booking screen. Prices are not published yet because bookings
                are not open yet.
              </dd>
            </div>
            <div className="term">
              <dt lang="en">Cancellations</dt>
              <dd lang="en">
                The cancellation and refund terms are still being settled, and
                they will be published here in full before the first booking is
                taken. We would rather leave this blank than guess at it.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* How it works. Four steps, same stacked-row treatment. */}
      <section id="how">
        <div className="wrap">
          <div className="sechead">
            <h2>यह कैसे काम करेगा</h2>
            <p lang="en">
              Scheduled appointments with a named person — not a queue, and not
              whoever happens to be free.
            </p>
          </div>

          {/* Each <li> wraps its content in a single <div>, and that is
              load-bearing rather than tidiness. `.steps li` is a two-track
              grid; a bare text node beside the <b> becomes a THIRD grid item
              and lands in the 3rem counter track on the next row. It rendered
              80px wide — one word per line — and shipped that way, because the
              CSS reads perfectly correctly. Same failure as the `order` bug in
              DESIGN.md §5: only visible when rendered. */}
          <ol className="steps">
            <li lang="en">
              <div>
                <b>Choose your astrologer.</b> Each one is named, with their
                experience and the languages they speak.
              </div>
            </li>
            <li lang="en">
              <div>
                <b>Pick a time that suits you.</b> You see their actual
                availability and choose a slot, rather than waiting for a
                callback.
              </div>
            </li>
            <li lang="en">
              <div>
                <b>Pay for that slot.</b> The amount is shown before you
                confirm.
              </div>
            </li>
            <li lang="en">
              <div>
                <b>Speak at the appointed time.</b> The consultation happens in
                your browser — nothing to install.
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* The founders sit on deep umber. This is the emotional centre of the
          page — three named people who are the entire product — and inverting
          the surface is what makes three of them read as an editorial choice
          rather than as an empty marketplace (DESIGN.md §5).

          Note what is NOT here: no gold text and no terracotta button. Gold on
          umber is 5.51:1 and would pass, but the contrast lint bans gold as
          text everywhere and that gate is worth more than the flourish. */}
      <section id="astrologers" className="band-dark">
        <div className="wrap">
          <div className="sechead">
            <h2>हमारे संस्थापक ज्योतिषी</h2>
            <p lang="en">
              Three practising astrologers, named and accountable. Full
              profiles, availability and fees will be published when bookings
              open.
            </p>
          </div>

          {astrologers === null ? (
            /* The API did not answer. Say that, rather than showing a
               hardcoded copy — this page has one source of truth for who
               works here, and a fallback would quietly become a second. */
            <p lang="en" style={{ color: 'var(--dark-soft)' }}>
              We could not load our astrologers just now. Please refresh in a
              moment.
            </p>
          ) : (
            astrologers.map((a, i) => (
              <article className="person" key={a.slug}>
                <span lang="en">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{a.nameHi}</h3>
                  <p lang="en">
                    {a.nameEn}
                    {a.headline ? <> · {a.headline}</> : null}
                    {/* Experience and price appear ONLY when they exist. No
                        placeholder dash, no "20+ years", nothing invented —
                        these are still owner action O3. */}
                    {a.experienceYears !== null ? <> · {a.experienceYears} years</> : null}
                    {a.sessionRateDisplay ? (
                      <> · {a.sessionRateDisplay} / {a.sessionMinutes} min</>
                    ) : null}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* The waitlist. This is the one thing the page can actually DO today —
          the endpoint is live and the confirmation email really sends. */}
      <section id="waitlist">
        <div className="wrap">
          <div className="sechead">
            <h2>प्रतीक्षा सूची में शामिल हों</h2>
            <p lang="en">
              Bookings are not open yet. Leave your email and we will write to
              you once you can choose a time with one of our astrologers — and
              not for any other reason.
            </p>
          </div>
          {/* A panel, because DESIGN.md §4's test for one is that the card IS
              the interaction — which a form is, and a paragraph in a box is
              not. It also stops the fields floating loose on the page ground. */}
          <div className="panel waitlistPanel">
            <WaitlistForm />
          </div>
        </div>
      </section>
    </>
  );
}
