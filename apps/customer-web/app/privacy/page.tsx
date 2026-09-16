import type { Metadata } from 'next';
import PrivacyRequestForm from './PrivacyRequestForm';

/**
 * /privacy — make a DPDP access or erasure request (ADR-040).
 *
 * This is NOT the privacy policy. That page is task 2.8 and is parked pending
 * owner input (GSTIN, grievance officer, refund terms), and none of it can be
 * written from invention. This page is the working mechanism for the two
 * rights the system can actually serve today, which does not depend on that
 * text existing.
 */
export const metadata: Metadata = {
  title: 'Your data — Stella Astrology',
  description: 'Request a copy of the data Stella Astrology holds about you, or ask us to delete it.',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <>
      <div className="masthead" lang="en">
        <div className="wrap">
          <p className="eyebrow">Your data</p>
          <h1 className="pageTitle">See it, or delete it.</h1>
          <p className="pageLede">
            The only thing we hold today is what you gave the waitlist form:
            your email address, and the technical details of that one request.
            You can ask for a copy of it, or ask us to delete it.
          </p>
        </div>
      </div>

      <div className="page" lang="en">
        <div className="wrap">
          <div className="panel waitlistPanel">
            <PrivacyRequestForm />
          </div>

          <p className="pageNote">
            We send the link to the address you type, and it works once. That is
            the only way we can tell it is really you — a waitlist entry has no
            account and no password, so control of the address is the only thing
            there is to check.
          </p>
        </div>
      </div>
    </>
  );
}
