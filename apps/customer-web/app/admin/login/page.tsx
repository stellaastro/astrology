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
    <div className="page" lang="en">
      <div className="wrap">
        <p className="eyebrow">Stella</p>
        <h1 className="pageTitle">Sign in</h1>
        <LoginForm />
      </div>
    </div>
  );
}
