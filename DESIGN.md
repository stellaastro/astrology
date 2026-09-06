# Stella Astrology — Design System

**Status:** Accepted 2026-09-06 · derived from a working sketch, not from theory
**Reference build:** `~/.gstack/projects/www.stellaastro.com/designs/landing-hero-20260905/sketch.html`
**Rendered at:** `v3-desktop.png` · `v3-tablet.png` · `v3-mobile.png` · `v4-astrologers.png`

Every value here was used in a page that was rendered and looked at. Contrast
ratios are measured, not estimated. Where a rule exists because something broke,
the breakage is recorded — those are the rules people otherwise remove.

---

## 1. Colour

Derived from `images/logo/stella.png`. The logo contains ivory, gold, terracotta,
sage green and coral. It contains **no blue**, which is why the source documents'
navy/sapphire direction is void (ADR-001).

```css
:root{
  --surface:   #F7F1E3;   /* ivory ground                              */
  --surface-2: #FBF7EE;   /* raised panel                              */
  --ink:       #2B1B10;   /* 14.8:1 on ivory — AAA                     */
  --ink-soft:  #6B5643;   /*  5.1:1 on ivory — AA                      */
  --cta:       #904000;   /* bronze, 6.4:1 — AA — buttons and links    */
  --accent:    #C08000;   /* gold, 2.96:1 — ORNAMENT ONLY              */
  --sage:      #6E7A52;   /* logo leaves — botanical detail only       */
  --coral:     #D9705C;   /* hero flowers — botanical detail only      */
  --rule:      rgba(192,128,0,.38);
}
```

### The gold rule

**Gold is never text and never a button fill.** At 2.96:1 on ivory it fails WCAG
AA for any text size. It is permitted only as hairline rules, thin borders and
ornament.

This is enforced by a **CI contrast lint**, not by discipline. The lint exists
because gold is the brand's most recognisable colour and someone will reach for
it as a heading within weeks. Verify the lint works by deliberately writing
`color: var(--accent)` on body text and confirming the build fails.

Measured 2.96 confirms the 2.95 figure recorded in ADR-001 independently.

### Dark surfaces

The waitlist section inverts to `--ink` ground. On dark, gold **becomes**
permissible for text and buttons — `#C08000` on `#2B1B10` is high contrast. The
rule is about gold on ivory, not gold in general.

---

## 2. Typography

Two families. Each chosen for the script it serves, not for decoration.

```css
--dev: "Tiro Devanagari Hindi", Georgia, serif;   /* all Devanagari       */
--lat: "Cormorant Garamond", Georgia, serif;       /* Latin display + text */
```

- **Tiro Devanagari Hindi** is a real Devanagari text serif designed for extended
  reading. Hindi is the default language in India, so it must be first-class
  rather than whatever the fallback stack produces.
- **Cormorant Garamond** carries the heritage warmth of the gold brand for Latin.
  It is light at small sizes — use 500/600 weight or step up a size for body copy.

**Inter, Roboto, Arial and system stacks are rejected.** Inter specifically is
the documented "gave up on typography" signal, and it has **no Devanagari
coverage at all**, which is disqualifying on a Hindi-first product.

Mark up mixed content with `lang` on every run — `lang="en"` on Latin passages
inside Hindi pages — so screen readers switch voice. This is not optional
polish; a Hindi headline announced in an English voice is unintelligible.

### Scale

```
--step--1: .95rem     small / labels
--step-0:  1.0625rem  body
--step-1:  1.3rem     lead
--step-2:  1.65rem    h3 small
--step-3:  2.15rem    h3
--step-4:  2.9rem     h2
--step-5:  3.9rem     h1   (2.45rem below 860px)
```

Body text is never below 16px. Line height 1.7 for body, 1.28 for headings.

---

## 3. Space

8px base.

```
--s1: .5rem   --s2: 1rem    --s3: 1.5rem
--s4: 2.5rem  --s5: 4rem    --s6: 6rem
```

`--maxw: 1180px` content width. `--tap: 44px` minimum touch target — applies to
every link, button and form control, including inline text links in the footer.

---

## 4. Components

**Button.** Bronze fill, ivory text, 2px radius, `min-height: 44px`, padding
`.7rem 1.35rem`. Hover `#7A3600`. Focus `3px solid var(--ink)` with `3px` offset.
On dark surfaces the fill becomes gold with ink text.

**Link.** `--cta` bronze. **Visited links must differ** — `#6E3200`. Retaining
the visited state is a usability requirement, not a stylistic choice.

**Form field.** Label is **always visible and persistent**. Placeholder-as-label
is forbidden: the label must remain readable once the field has content. Hint
text sits below the field, not inside it.

**Rules and ornament.** `1px solid var(--rule)` — the gold hairline is the
primary structural device. It separates editorial bands, term rows and numbered
steps. This is what carries the brand into layout without using gold as text.

**Cards: avoid.** The page uses gold-ruled rows and full-width bands instead. A
card must earn its existence by being the interaction itself.

---

## 5. Layout patterns

### Editorial bands, not a card grid

Three astrologers in a card grid built for twelve reads as an empty marketplace.
Full-width alternating bands make three look like an editorial choice.

**Alternate by swapping grid tracks, never by `order`.**

```css
.band{ grid-template-columns: minmax(0,300px) 1fr }
.band:nth-of-type(even){ grid-template-columns: 1fr minmax(0,300px) }
.band:nth-of-type(even) .photo{ grid-column:2; grid-row:1 }
.band:nth-of-type(even) .who  { grid-column:1; grid-row:1 }
```

**Why this rule exists.** The first version used `order: 2`. `order` changes
visual sequence but **not which grid track an item occupies**, so on alternating
bands the 300px photo landed in the `1fr` track and rendered at double size while
the text was squeezed into 300px. Caught by rendering, invisible when reading.

This layout deliberately stops scaling past roughly eight astrologers. That is
the point — at that roster, discovery becomes real and a grid becomes correct.

### Stacked rows, not three columns

The three-column feature row (icon, bold title, two lines of description,
repeated symmetrically) is the single most recognisable AI-generated layout.
Where three related items must be presented, use gold-ruled stacked rows with the
label left and description right.

### Hero

Full-bleed, one composition. The left ~45% is a text zone created by a cream
gradient over `stella_hero_bg1.png`; the gold zodiac wheel on the right is the
single visual anchor. Budget: one eyebrow, one headline, one supporting sentence,
one CTA group, one image. No cards.

**Below 860px the composition collapses** — a left-text/right-art layout does not
survive portrait. The art becomes a 32vh top band cropped to `object-position:
72% center`, with text below on solid cream.

---

## 6. Motion

Three, and no more. All inside `@media (prefers-reduced-motion: no-preference)`.

1. Hero text rises on load — staggered 80ms.
2. Astrologer bands settle on scroll.
3. Buttons and links transition on hover and focus.

### Never gate content visibility on a scroll animation

```css
/* WRONG — blanked all three astrologer bands */
@keyframes fade{ from{opacity:0} to{opacity:1} }
.band{ animation: fade .8s ease both; animation-timeline: view() }

/* RIGHT — degrades to "already in place" */
@keyframes settle{ from{transform:translateY(10px)} to{transform:none} }
.band{ animation: settle .8s ease both; animation-timeline: view() }
```

`animation-timeline: view()` with `fill-mode: both` holds the `from` state
whenever the timeline never advances. On an opacity fade that means
`opacity: 0` — the elements occupy layout height and never paint. The entire
trust section of the landing page was invisible and the CSS looked correct.

**Animate transform. Never opacity.**

---

## 7. Navigation

Must pass the trunk test: cover everything except the navigation and a visitor
can still identify the site, the current section, and the primary action.

- **≥861px** — brand left, section links right, bronze CTA last. Current section
  marked with `box-shadow: inset 0 -2px 0 var(--accent)`, not colour alone.
- **≤860px** — section links are hidden, so a **sticky bottom bar** replaces
  them: three section links plus a wider CTA, each `min-height: 44px`. Hiding the
  links with `display:none` and providing nothing else fails the trunk test on
  the viewport carrying most Indian traffic.
- **768px tablet is undefined** and is an open decision.

---

## 8. Accessibility — required, not aspirational

- Visible persistent labels on every field. Never placeholder-as-label.
- `lang` on every Devanagari and Latin run.
- ARIA landmarks: `header`, `nav` with `aria-label`, `main`, `footer`. Skip link
  first in the DOM.
- 44px minimum touch targets.
- Visible focus rings — `3px solid var(--ink)`, offset `3px`. Never `outline:none`.
- Visited links visually distinct.
- Body text ≥16px, contrast ≥4.5:1.
- Headings sit closer to the section they introduce than to the one above.
- Keyboard order tested by hand, and a screen reader verified to announce Hindi
  in a Hindi voice. Automated checks catch roughly a third of real issues.

---

## 9. Content rules that constrain design

- **No star ratings, review counts, user totals or testimonials** until they
  derive from real data (§13). At launch none of these exist.
- **The CTA must match what the page does.** While the site takes emails, the
  button says "be first to book", not "book a consultation". An earlier draft
  promised a calendar months before one would exist.
- **Do not advertise per-minute billing.** Billing is slot-based (ADR-024).
  "Pay only for what you used" is not true under this model.
- **Legal pages are English only.** Machine-translated regulated disclosure text
  is worse than English.
- Placeholder content must look like a placeholder. `— वर्ष` and `₹— / 30 मिनट`
  read as errors, which is correct: they are blocking on owner input.

---

## 10. Brand marks

Use the **round zodiac mark plus a typeset wordmark** in Cormorant.

`images/stella_ltr_logo.png` is not usable: broken alpha channel with yellow and
red fringing around the whole silhouette, mottled noise inside the plaque, and
gold-on-gold lettering. Both supplied marks are also unreadable below roughly
60px, so the compact mark is the roundel regardless of the wordmark's fate.

**Unresolved:** the logo labels zodiac signs in Devanagari (मेष, वृषभ, मिथुन);
the hero uses Western glyphs (♈♉♊). Two visual languages on one brand. The
Kundli pages will force a choice.
