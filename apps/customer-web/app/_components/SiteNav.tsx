'use client';

/**
 * Site navigation: inline links on desktop, a sticky bottom bar below 860px.
 *
 * Client-side only because it marks the section currently in view. Without
 * JavaScript the links still render and still work — they are ordinary anchors.
 *
 * Every destination resolves. Horoscope, Panchang and "Our Services" are absent
 * on purpose: those routes do not exist, and dead links on a registered
 * company's live site are worse than a shorter menu.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from './SiteNav.module.css';

/** [href, English label, short label for the bottom bar] */
const ITEMS: ReadonlyArray<readonly [string, string, string]> = [
  ['/#astrologers', 'Astrologers', 'Astrologers'],
  ['/#how', 'How it works', 'How'],
  ['/kundli', 'Kundli', 'Kundli'],
];

export default function SiteNav() {
  const [active, setActive] = useState<string>('');

  /* Marks whichever section is in view. IntersectionObserver rather than a
     scroll handler, so this costs nothing per frame. */
  useEffect(() => {
    const ids = ['astrologers', 'how', 'waitlist'];
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(`#${visible.target.id}`);
      },
      // Middle band of the viewport: a section counts as current when it is
      // actually being read, not when its first pixel appears.
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  const isCurrent = (href: string) => href.endsWith(active) && active !== '';

  return (
    <>
      <nav className={s.desktop} aria-label="Main">
        {ITEMS.map(([href, label]) => (
          <Link
            key={href}
            className={s.link}
            href={href}
            lang="en"
            {...(isCurrent(href) ? { 'aria-current': 'true' as const } : {})}
          >
            {label}
          </Link>
        ))}
        <Link className={s.cta} href="/#waitlist" lang="en">
          Join the waitlist
        </Link>
      </nav>

      {/* Sticky bottom bar below 860px. Separate element rather than a
          re-ordered copy, because the two need different labels and hit areas. */}
      <nav className={s.bar} aria-label="Main, mobile">
        {ITEMS.map(([href, , short]) => (
          <Link
            key={href}
            className={s.barLink}
            href={href}
            lang="en"
            {...(isCurrent(href) ? { 'aria-current': 'true' as const } : {})}
          >
            {short}
          </Link>
        ))}
        <Link className={s.barCta} href="/#waitlist" lang="en">
          Waitlist
        </Link>
      </nav>
    </>
  );
}
