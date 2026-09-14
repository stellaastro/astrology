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

const ASTROLOGERS = [
  { hi: 'शिवपाल सिंह', en: 'Shivpal Singh', role: 'Executive Director' },
  { hi: 'कृष्ण कुमार साहू', en: 'Krishn Kumar Sahu', role: 'Director' },
  { hi: 'अशोक कुमार शर्मा', en: 'Ashok Kumar Sharma', role: 'Director' },
] as const;

export default function Home() {
  return (
    <>
      <StellaHero />

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
    </>
  );
}
