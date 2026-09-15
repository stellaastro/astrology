import type { Metadata } from 'next';
import LoginForm from './LoginForm';

/**
 * /admin/login — split card: brand on the left, form on the right.
 *
 * Two ways in, because there are two kinds of account (ADR-037, ADR-038):
 * the password account, and any Google account that has been granted a role.
 *
 * This page renders with no header and no footer — see BARE_ROUTES in
 * SiteChrome for why that exemption is narrow.
 *
 * EVERYTHING ON THE BRAND PANEL IS A CHECKABLE FACT. The entity name, the
 * registered CIN, the town and the email are all real. There is deliberately
 * no telephone number: none is recorded anywhere in this project, and §13's
 * ban on invented detail does not stop at ratings and testimonials.
 *
 * Noindex: an admin sign-in page has no business in search results, and a
 * crawler finding it only widens the surface someone can probe.
 */
export const metadata: Metadata = {
  title: 'Sign in — Stella Astrology',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLoginPage() {
  return (
    <div className="signin" lang="en">
      <div className="signinCard">
        <aside className="signinBrand">
          {/* Decorative: the wordmark states the name in text directly below,
              so alt text here would only repeat it to a screen reader. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="signinMark" src="/wheel.webp" alt="" width={104} height={104} />

          <h2>Stella Astrology</h2>
          <p className="signinPlace">Itarsi · Madhya Pradesh</p>

          <p className="signinPill">
            Stella Astrology Private Limited
            <br />
            CIN U96906MP2026PTC085281
          </p>

          <div className="signinRule" aria-hidden="true" />

          <address className="signinContact">
            <span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Itarsi, Madhya Pradesh, India
            </span>
            <span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              <a href="mailto:guruji@stellaastro.com">guruji@stellaastro.com</a>
            </span>
          </address>
        </aside>

        <div className="signinForm">
          <p className="eyebrow">Stella Astrology</p>
          <h1>Welcome back</h1>
          <p className="signinLede">Sign in with your registered account to continue.</p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
