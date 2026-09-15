/**
 * Stella Astrology — hero.
 * Layout, artwork and decorative motion render without client JavaScript.
 * CSS honours reduced motion from the first paint.
 */

import Link from 'next/link';
import s from './StellaHero.module.css';
import {
  CelestialDial,
  ArrowUpRight,
  Constellation,
  Spark,
} from './CelestialArt';

/** Scattered stars: [left%, top%, size px, animation delay s]. */
const STARS: ReadonlyArray<readonly [number, number, number, number]> = [
  [6, 20, 11, 0], [17, 8, 8, -1.4], [31, 74, 9, -2.8], [45, 5, 7, -4.2],
  [58, 88, 10, -0.7], [78, 15, 8, -3.5], [91, 58, 11, -2.1], [69, 46, 6, -5.6],
];

export default function StellaHero() {
  return (
    <section
      className={s.hero}
      aria-labelledby="hero-title"
    >
      <div className={s.sky} aria-hidden="true" />
      <div className={s.veil} aria-hidden="true" />

      <div className={s.inner}>
        <div className={s.copy}>
          <p className={s.eyebrow}>
            <Spark className={s.spark} />
            <span lang="en">Ancient wisdom. Personal guidance.</span>
          </p>

          <h1 id="hero-title" className={s.title} lang="en">
            Your life.
            <br />
            Your journey.
            <em>Written in the stars.</em>
          </h1>

          <p className={s.lede} lang="en">
            Explore astrology, understand your birth chart, and find guidance for
            your next chapter.
          </p>

          <div className={s.actions}>
            <Link className={s.primary} href="/kundli" lang="en">
              Explore Kundli
              <ArrowUpRight className={s.arrow} />
            </Link>
            <a className={s.secondary} href="mailto:guruji@stellaastro.com" lang="en">
              Contact Stella
            </a>
          </div>

          <p className={s.topics} lang="en">
            Birth charts<b>·</b>Panchang<b>·</b>Personal guidance
          </p>
        </div>

        {/* The whole stage is decorative: it repeats nothing the copy says. */}
        <div className={s.stageWrap}>
          <div className={s.stage} aria-hidden="true">
            <div className={s.halo} />
            {/* A shared inward-facing plane tilts the artwork, engraving, stars
                and orbital paths together; their animations remain independent. */}
            <div className={s.celestialPlane}>
              <CelestialDial className={s.dial} />
              <span className={`${s.annotation} ${s.annotationTop}`}>As above, so below</span>
              <span className={`${s.annotation} ${s.annotationBottom}`}>A universe within you</span>
              <Constellation className={s.constellation} />

              {/* Orbits. Only .orbitSpin turns — the stage never does. */}
              <div className={`${s.orbit} ${s.orbitA}`}>
                <div className={s.ring} />
                <div className={s.orbitSpin}><span className={s.bead} /></div>
              </div>
              <div className={`${s.orbit} ${s.orbitB}`}>
                <div className={s.ring} />
                <div className={s.orbitSpin}><span className={s.bead} /></div>
              </div>
              <div className={`${s.orbit} ${s.orbitC}`}>
                <div className={s.ring} />
                <div className={s.orbitSpin}><span className={s.bead} /></div>
              </div>

              {STARS.map(([left, top, size, delay]) => (
                <span
                  key={`star-${left}-${top}`}
                  className={s.star}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: size,
                    height: size,
                    animationDelay: `${delay}s`,
                  }}
                >
                  <Spark />
                </span>
              ))}

              <div className={s.artwork}>
                {/* The dial and each satellite are separate transparent assets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={s.mainDial} src="/celestial-main-dial.webp"
                  alt="" width={560} height={605} fetchPriority="high" />
                {(['moon', 'saturn', 'mars', 'jade', 'crescent'] as const).map((object) => (
                  <div key={object} className={`${s.satellite} ${s[object]}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/celestial-${object}.webp`} alt="" width={400} height={400} decoding="async" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={s.discovery} lang="en"><span /><Spark />Discover a little clarity.<span /></div>

    </section>
  );
}
