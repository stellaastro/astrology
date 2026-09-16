'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import s from './admin.module.css';

/**
 * Navigation between admin surfaces.
 *
 * It exists because there are now two of them. With one page there was nothing
 * to navigate to; with two and no nav, the only way to reach the second is to
 * know its URL — which is how an admin screen quietly becomes unused.
 */
const LINKS = [
  { href: '/admin', label: 'Waitlist' },
  { href: '/admin/astrologers', label: 'Astrologers' },
] as const;

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className={s.nav} aria-label="Admin sections">
      {LINKS.map((l) => {
        // Exact match, not startsWith: '/admin' is a prefix of every admin
        // route, so startsWith would mark Waitlist current on every page.
        const current = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={current ? `${s.navLink} ${s.navLinkCurrent}` : s.navLink}
            aria-current={current ? 'page' : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
