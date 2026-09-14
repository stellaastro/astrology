'use client';

/**
 * Stella Astrology — hero.
 *
 * Client-side only because of three interactive concerns: the pause control,
 * the pointer parallax, and reporting whether the OS already asked for reduced
 * motion. Everything else — layout, artwork, and all decorative animation — is
 * CSS, so the hero renders complete and animated with JavaScript disabled.
 *
 * Reduced motion is honoured by a CSS media query, NOT by this component's
 * state. State arrives after hydration, which would let one animated frame
 * through first; the media query is correct from the very first paint.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import s from './StellaHero.module.css';
import {
  Armillary,
  ArrowUpRight,
  CelestialDefs,
  Constellation,
  Crescent,
  JadePlanet,
  Moon,
  Saturn,
  Spark,
  TerracottaPlanet,
} from './CelestialArt';

/** Scattered stars: [left%, top%, size px, animation delay s]. */
const STARS: ReadonlyArray<readonly [number, number, number, number]> = [
  [6, 20, 11, 0], [17, 8, 8, -1.4], [31, 74, 9, -2.8], [45, 5, 7, -4.2],
  [58, 88, 10, -0.7], [78, 15, 8, -3.5], [91, 58, 11, -2.1], [69, 46, 6, -5.6],
];

const PARALLAX_PX = 8;

export default function StellaHero() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  /* Mirror the OS preference so the control can explain itself. The CSS has
     already applied it; this is only for the label and to disable parallax. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const resetParallax = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty('--px', '0px');
    el.style.setProperty('--py', '0px');
  }, []);

  /* Pointer parallax. Fine pointers only — on a touch screen there is no hover
     position to read, and the listener would fire on every scroll-drag. */
  useEffect(() => {
    if (reduced || paused) {
      resetParallax();
      return;
    }
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const el = stageRef.current;
        if (!el) return;
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        el.style.setProperty('--px', `${(-x * PARALLAX_PX).toFixed(2)}px`);
        el.style.setProperty('--py', `${(-y * PARALLAX_PX).toFixed(2)}px`);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame.current);
      resetParallax();
    };
  }, [reduced, paused, resetParallax]);

  const motionOff = paused || reduced;

  return (
    <section
      className={s.hero}
      aria-labelledby="hero-title"
      data-motion={motionOff ? 'paused' : 'running'}
    >
      <CelestialDefs />

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
          <div className={s.stage} ref={stageRef} aria-hidden="true">
            <div className={s.halo} />
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

            {/* position wrapper > float wrapper > spin wrapper */}
            <div className={`${s.place} ${s.wheel}`}>
              <div className={s.spin}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={s.wheelImg}
                  src="/wheel.webp"
                  alt=""
                  width={700}
                  height={700}
                  fetchPriority="high"
                />
              </div>
            </div>

            <div className={`${s.place} ${s.saturn}`}>
              <div className={s.float} style={{ animationDuration: '13s' }}>
                <Saturn />
              </div>
            </div>

            <div className={`${s.place} ${s.moon}`}>
              <div className={s.float} style={{ animationDuration: '9s', animationDelay: '-3s' }}>
                <Moon />
              </div>
            </div>

            <div className={`${s.place} ${s.marsPlace}`}>
              <div className={s.float} style={{ animationDuration: '11s', animationDelay: '-6s' }}>
                <TerracottaPlanet />
              </div>
            </div>

            <div className={`${s.place} ${s.jade}`}>
              <div className={s.float} style={{ animationDuration: '14s', animationDelay: '-2s' }}>
                <JadePlanet />
              </div>
            </div>

            <div className={`${s.place} ${s.crescent}`}>
              <div className={s.float} style={{ animationDuration: '10s', animationDelay: '-5s' }}>
                <Crescent />
              </div>
            </div>

            <div className={`${s.place} ${s.armillary}`}>
              <div className={s.float} style={{ animationDuration: '12s', animationDelay: '-7s' }}>
                <Armillary />
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className={s.motionToggle}
        onClick={() => setPaused((v) => !v)}
        aria-pressed={paused}
        disabled={reduced}
        lang="en"
      >
        {reduced
          ? 'Motion reduced by your system settings'
          : paused
            ? 'Play animation'
            : 'Pause animation'}
      </button>
    </section>
  );
}
