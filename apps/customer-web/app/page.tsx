/**
 * Landing page.
 *
 * Header and footer live in app/layout.tsx so every route carries the brand,
 * the entity name and the no-professional-advice disclaimer. This file owns
 * only the page's own sections.
 *
 * Every statement here is true and checkable. Nothing is a placeholder dash,
 * a rating, a review count, a user total or a testimonial (§13). The three
 * astrologers are named because their names are confirmed; their experience,
 * specialisations and fees are NOT shown because those have not been supplied
 * and inventing them is precisely what §13 forbids.
 *
 * There is deliberately no email capture form: the leads endpoint does not
 * exist yet (Phase 2) and a form that silently discards submissions is worse
 * than no form. A mailto link is honest about where the message goes.
 */

import StellaHero from './_components/StellaHero';
import WaitlistForm from './_components/WaitlistForm';

const ASTROLOGERS = [
  { hi: 'शिवपाल सिंह', en: 'Shivpal Singh', role: 'Executive Director' },
  { hi: 'कृष्ण कुमार साहू', en: 'Krishn Kumar Sahu', role: 'Director' },
  { hi: 'अशोक कुमार शर्मा', en: 'Ashok Kumar Sharma', role: 'Director' },
] as const;

export default function Home() {
  return (
    <>
      <StellaHero />

      {/* Billing terms. Gold-ruled STACKED ROWS, not a three-column feature
          grid — DESIGN.md §5 names that grid as the single most recognisable
          AI-generated layout.

          Everything here is settled architecture (ADR-023 pay-at-booking,
          ADR-024 slot-based). What is deliberately absent is the price and the
          refund policy: those are owner decisions (O3, O4) and inventing either
          is exactly what §13 forbids. */}
      <section id="terms">
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

          <ol className="steps">
            <li lang="en">
              <b>Choose your astrologer.</b> Each one is named, with their
              experience and the languages they speak.
            </li>
            <li lang="en">
              <b>Pick a time that suits you.</b> You see their actual
              availability and choose a slot, rather than waiting for a callback.
            </li>
            <li lang="en">
              <b>Pay for that slot.</b> The amount is shown before you confirm.
            </li>
            <li lang="en">
              <b>Speak at the appointed time.</b> The consultation happens in
              your browser — nothing to install.
            </li>
          </ol>
        </div>
      </section>

      <section id="astrologers">
        <div className="wrap">
          <div className="sechead">
            <h2>हमारे संस्थापक ज्योतिषी</h2>
            <p lang="en">
              Three practising astrologers, named and accountable. Full
              profiles, availability and fees will be published when bookings
              open.
            </p>
          </div>

          {ASTROLOGERS.map((a, i) => (
            <article className="person" key={a.en}>
              <span lang="en">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{a.hi}</h3>
                <p lang="en">
                  {a.en} · {a.role}
                </p>
              </div>
            </article>
          ))}
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
          <WaitlistForm />
        </div>
      </section>
    </>
  );
}
