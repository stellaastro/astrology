import SiteNav from './SiteNav';

/**
 * Header and footer, shared by every route.
 *
 * These used to live inside app/page.tsx, which meant /kundli rendered with no
 * brand and no legal footer. Anything added here appears on every page, which
 * is the point: the entity name, the grievance route and the
 * no-professional-advice disclaimer are not optional per-page decorations.
 *
 * The nav carries only destinations that resolve. Horoscope, Panchang and
 * "Our Services" are absent because those routes do not exist — dead links on a
 * company's live site are worse than a shorter menu.
 */

export function SiteHeader() {
  return (
    <header className="top">
      <div className="topin">
        <a className="brand" href="/" aria-label="Stella Astrology — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.webp" alt="" width={44} height={44} />
          <span>
            <b lang="en">Stella</b>
            <i lang="en">Astrology</i>
          </span>
        </a>
        <SiteNav />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
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
  );
}
