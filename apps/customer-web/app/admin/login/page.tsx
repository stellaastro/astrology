import type { Metadata } from 'next';
import LoginForm from './LoginForm';

/**
 * /admin/login
 *
 * Two ways in, because there are two kinds of account (ADR-037, ADR-038):
 * the password account, and any Google account that has been granted a role.
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
      <div className="signinInner">
        <div className="signinHead">
          {/* Decorative: the page already says "Stella Astrology" in text
              directly below, so alt text here would only repeat it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wheel.webp" alt="" width={74} height={74} />
          <p className="eyebrow">Stella Astrology</p>
          <h1>Sign in</h1>
          <p>Administrator access</p>
        </div>
        <div className="signinPanel">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
