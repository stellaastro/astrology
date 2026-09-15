import type { Metadata } from 'next';
import PrivacyTokenView from './PrivacyTokenView';

export const metadata: Metadata = {
  title: 'Your data — Stella Astrology',
  robots: { index: false, follow: false, nocache: true },
};

export default async function PrivacyTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PrivacyTokenView token={token} />;
}
