/**
 * Holding page.
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

const ASTROLOGERS = [
  { hi: 'शिवपाल सिंह', en: 'Shivpal Singh', role: 'Executive Director' },
  { hi: 'कृष्ण कुमार साहू', en: 'Krishn Kumar Sahu', role: 'Director' },
  { hi: 'अशोक कुमार शर्मा', en: 'Ashok Kumar Sharma', role: 'Director' },
] as const;

export default function Home() {
  return (
    <>
      <header className="top">
        <div className="topin">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mark.webp" alt="Stella Astrology" width={44} height={44} />
            <span>
              <b lang="en">Stella</b>
              <i lang="en">Astrology</i>
            </span>
          </div>
        </div>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="heroart" src="/hero-mobile.webp" alt="" />

      <main>
        <section className="hero" aria-labelledby="h1">
          <div className="heroin">
            <div className="herotext">
              <p className="eyebrow rise" lang="en">
                Itarsi, Madhya Pradesh
              </p>
              <h1 id="h1" className="rise">
                ज्योतिष परामर्श,
                <br />
                शीघ्र आरंभ।
              </h1>
              <p className="sub rise" lang="en">
                Stella Astrology is preparing to open scheduled consultations
                with named, practising astrologers. You will choose the time,
                and know the price before you pay.
              </p>
              <p className="rise">
                <a className="contact" href="mailto:guruji@stellaastro.com">
                  guruji@stellaastro.com
                </a>
              </p>
            </div>
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
      </main>

      <footer>
        <div className="wrap">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mark.webp" alt="" width={44} height={44} />
            <span>
              <b lang="en">Stella</b>
              <i lang="en">Astrology</i>
            </span>
          </div>
          <p className="legal" lang="en">
            STELLA ASTROLOGY PRIVATE LIMITED · Itarsi, Madhya Pradesh
            <br />
            <a href="mailto:guruji@stellaastro.com">guruji@stellaastro.com</a>
            <br />
            <em>
              For guidance and entertainment. Not a substitute for professional
              medical, legal or financial advice.
            </em>
          </p>
        </div>
      </footer>
    </>
  );
}
