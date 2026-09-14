import type { Metadata, Viewport } from 'next';
// Tokens come from the workspace package, never a copy inside this app. A
// duplicate here meant the lint checked one file and the browser rendered
// another (ADR-034). scripts/contrast-lint.mjs now fails if one reappears.
import '@stella/design-system/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.stellaastro.com'),
  title: 'Stella Astrology — ज्योतिष परामर्श',
  description:
    'Scheduled consultations with named, practising astrologers. Itarsi, Madhya Pradesh.',
  icons: { icon: '/favicon.png' },
  openGraph: {
    title: 'Stella Astrology',
    description: 'Scheduled consultations with named, practising astrologers.',
    locale: 'hi_IN',
    type: 'website',
  },
  // No indexing until there is a real page with real content. A holding page
  // ranking for the brand name is worse than not ranking yet.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Must track --surface in tokens.css. Next needs a literal here, so this is
  // the one unavoidable duplicate; contrast-lint.mjs checks the two agree.
  themeColor: '#FFF8E8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // lang="hi" is the default per ADR-012. Latin runs carry lang="en" so a
    // screen reader switches voice rather than reading English in a Hindi one.
    <html lang="hi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Serif display + Mukta body (ADR-035). Mukta covers Devanagari AND
            Latin, so body copy needs no per-script switch; only headings do. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Mukta:wght@400;500;600&family=Tiro+Devanagari+Hindi&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
