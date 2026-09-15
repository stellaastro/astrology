/**
 * The email that verifies a DPDP access or erasure request.
 *
 * It has to do one awkward job well: tell someone who did NOT ask for this
 * that they can ignore it. Anyone can type an address into the request form,
 * so a proportion of these land in the inboxes of people who did nothing —
 * and for an erasure request, a confused recipient clicking through would
 * delete their own record.
 *
 * Hence: what was asked for, who can ignore it, and no action required to
 * decline. Deleting nothing is the default outcome of doing nothing.
 */
export interface PrivacyVerificationInput {
  email: string;
  kind: 'access' | 'erasure';
  token: string;
  baseUrl: string;
}

export function privacyVerification(input: PrivacyVerificationInput): {
  subject: string;
  text: string;
} {
  const url = `${input.baseUrl}/privacy/${input.token}`;
  const isErasure = input.kind === 'erasure';

  const subject = isErasure
    ? 'Confirm your request to delete your Stella Astrology record'
    : 'Your request for a copy of your Stella Astrology record';

  const what = isErasure
    ? 'delete the record we hold for this address'
    : 'send you a copy of the record we hold for this address';

  const text = [
    'Someone asked us to ' + what + '.',
    '',
    'If that was you, open this link:',
    url,
    '',
    'The link works once and expires in 24 hours.',
    '',
    isErasure
      ? 'Opening it will show you what will be deleted and ask you to confirm. ' +
        'Nothing is deleted until you confirm.'
      : 'Opening it will show you everything we hold.',
    '',
    'IF THIS WAS NOT YOU, ignore this email. Anyone can type an address into',
    'our form, so a request on its own proves nothing and changes nothing.',
    'Doing nothing leaves your record exactly as it is.',
    '',
    'Stella Astrology Private Limited, Itarsi, Madhya Pradesh',
    'guruji@stellaastro.com',
  ].join('\n');

  return { subject, text };
}
