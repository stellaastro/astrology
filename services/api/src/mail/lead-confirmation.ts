/**
 * The waitlist confirmation email.
 *
 * Kept as data, not a template engine: there is one message, and a dependency
 * that renders it would be larger than the thing it renders.
 *
 * Written in the lead's own locale. Hindi is the default in India (ADR-012),
 * and an email that arrives in English to someone who chose Hindi reads as a
 * different company than the page they signed up on.
 *
 * It promises nothing that does not exist. There is no launch date, no "your
 * spot is reserved", and no offer — the waitlist is a list, and saying more
 * would be the kind of invented claim §13 forbids.
 */

export interface ConfirmationContent {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function leadConfirmation(url: string, locale: string): ConfirmationContent {
  const hi = locale === 'hi';
  const safeUrl = esc(url);

  const subject = hi
    ? 'अपना ईमेल पते की पुष्टि करें — Stella Astrology'
    : 'Confirm your email — Stella Astrology';

  const lines = hi
    ? {
        greeting: 'नमस्ते,',
        body:
          'आपने Stella Astrology की प्रतीक्षा सूची में शामिल होने के लिए यह ईमेल पता दिया है। ' +
          'पुष्टि करने के लिए नीचे दिए गए लिंक पर क्लिक करें।',
        cta: 'ईमेल की पुष्टि करें',
        fallback: 'यदि बटन काम न करे, तो यह पता ब्राउज़र में खोलें:',
        ignore:
          'यदि आपने यह अनुरोध नहीं किया, तो इस ईमेल को अनदेखा करें। आपका पता सूची में नहीं जोड़ा जाएगा।',
        sign: 'Stella Astrology · इटारसी, मध्य प्रदेश',
      }
    : {
        greeting: 'Hello,',
        body:
          'This email address was given to join the Stella Astrology waitlist. ' +
          'Confirm it using the link below.',
        cta: 'Confirm my email',
        fallback: 'If the button does not work, open this address in your browser:',
        ignore:
          'If you did not ask for this, ignore this email. Your address will not be added to the list.',
        sign: 'Stella Astrology · Itarsi, Madhya Pradesh',
      };

  const text = [
    lines.greeting,
    '',
    lines.body,
    '',
    url,
    '',
    lines.ignore,
    '',
    lines.sign,
  ].join('\n');

  /* Inline styles and a table-free layout: email clients strip <style> blocks
     and many still render flexbox unpredictably. The brand palette is repeated
     literally here because an email cannot read the site's CSS tokens. */
  const html = `<!doctype html>
<html lang="${hi ? 'hi' : 'en'}">
<body style="margin:0;padding:24px;background:#FFF8E8;color:#48251C;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;">
  <div style="max-width:520px;margin:0 auto;">
    <p style="margin:0 0 18px;letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#4E682A;">Stella Astrology</p>
    <p style="margin:0 0 14px;">${esc(lines.greeting)}</p>
    <p style="margin:0 0 22px;">${esc(lines.body)}</p>
    <p style="margin:0 0 22px;">
      <a href="${safeUrl}" style="display:inline-block;padding:13px 22px;background:#A94424;color:#FFF8E8;text-decoration:none;border-radius:2px;">${esc(lines.cta)}</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;color:#6E4A38;">${esc(lines.fallback)}</p>
    <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#A94424;">${safeUrl}</a></p>
    <p style="margin:0 0 22px;font-size:13px;color:#6E4A38;">${esc(lines.ignore)}</p>
    <p style="margin:0;padding-top:16px;border-top:1px solid rgba(217,154,22,.38);font-size:12px;color:#6E4A38;">${esc(lines.sign)}</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
