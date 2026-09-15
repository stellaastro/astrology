# Stella Astrology — Design System

**Status:** Accepted 2026-09-06 · derived from a working sketch, not from theory
**Reference build:** `~/.gstack/projects/www.stellaastro.com/designs/landing-hero-20260905/sketch.html`
**Rendered at:** `v3-desktop.png` · `v3-tablet.png` · `v3-mobile.png` · `v4-astrologers.png`

Every value here was used in a page that was rendered and looked at. Contrast
ratios are measured, not estimated. Where a rule exists because something broke,
the breakage is recorded — those are the rules people otherwise remove.

---

## 1. Colour

**Adopted from the Edition 2.0 brand system, 2026-09-14 (ADR-034.)** Verified
against `images/logo/stella.png` — the zodiac wheel contains every one of these
six colours: ivory panels, lotus cream, saffron gold ornament, a terracotta
centre field, leaf green foliage and deep umber Devanagari. It contains **no
blue**, which is why the source documents' navy/sapphire direction stays void
(ADR-001).

```css
:root{
  /* surfaces */
  --surface:     #FFF8E8;   /* warm ivory — brand ground                */
  --surface-2:   #FFFDF8;   /* card surface                             */
  --cream:       #F4E1BA;   /* lotus cream — highlighted bands          */
  /* text and action */
  --ink:         #48251C;   /* deep umber  12.75:1 on ivory — AAA       */
  --ink-soft:    #6E4A38;   /* derived      7.35:1 — AA                 */
  --cta:         #A94424;   /* terracotta   5.61:1 — AA — buttons/links */
  --cta-hover:   #8E3A1E;   /* derived      7.15:1                      */
  --visited:     #72301C;   /* derived      9.21:1                      */
  /* accent and status */
  --accent:      #D99A16;   /* saffron gold 2.31:1 — ORNAMENT ONLY      */
  --leaf:        #4E682A;   /* leaf green   5.95:1 — status/secondary   */
  --rule:        rgba(217,154,22,.38);
  /* dark surfaces */
  --dark-ground: #48251C;   --dark-panel:  #5C3225;
  --dark-text:   #FFF8E8;   /* 12.75:1 — AAA                            */
  --dark-soft:   #E3D5C0;   /*  9.34:1 — AA                             */
  --dark-muted:  #C4AE97;   /*  6.33:1 — AA — legal and footnotes       */
  --dark-border: #75503F;
}
```

**Edition 2.0 supplies six colours; the build needs sixteen.** It has no
secondary-text, visited-link, hover or dark-surface values. The five derived
tokens stay inside the umber/terracotta hue family and were each chosen by
measurement, not by eye.

`#FFFAF0` — Edition 2.0's "lighter page background" — is **deliberately not
tokenised**. It sits within 1% of `--surface`, and an unused token is a future
inconsistency. Add it if something genuinely needs it.

### The gold rule — now stricter

**Gold is never text and never a button fill.** Saffron gold is **2.31:1** on
ivory. It fails WCAG AA at every text size, and it fails *harder* than the
previous gold did at 2.96:1 — so adopting the new palette **tightened** this
rule rather than relaxing it.

Permitted only as hairline rules, thin borders and ornament.

Enforced by a **CI contrast lint**, not by discipline, because gold is the
brand's most recognisable colour and someone will reach for it as a heading
within weeks. A supplied mockup already does exactly this — small-caps gold
display text on ivory. It is not buildable as drawn; use `--ink-soft`, or put
it on a dark ground.

Verify the lint works:

```bash
echo '.x{color:var(--accent)}' > apps/customer-web/app/probe.css
npm run gate:contrast      # must fail
rm apps/customer-web/app/probe.css
```

### Lotus cream is a content surface, and it is the thin one

`--cta` on `--cream` is **4.61:1** — AA by a margin of 0.11. It is real and it
passes, but nothing about it is comfortable: darkening the cream or lightening
the terracotta by a hair breaks it silently. **The lint now checks this pair**
rather than trusting anyone to remember.

### Dark surfaces

Sections may invert to `--dark-ground` — `#site` bands and the sign-in page both
do. Text on umber is ivory (`--dark-text`, 12.75:1) or `--dark-soft` (9.34:1).

**Two measured traps, both of which bite one shade away from something safe:**

- **Terracotta dies on dark.** `--cta` on `--dark-ground` is **2.27:1**. The
  normal button cannot survive a dark band. Where the sign-in page keeps its
  terracotta button, it is because the button sits on an ivory *panel*
  (5.84:1 on `--surface-2`), not on the umber — the panel is carrying the
  contrast, so it is structural rather than decoration.
- **"Gold is fine on dark" is only true of one dark.** `#D99A16` is 5.51:1 on
  `--dark-ground` and **4.43:1 on `--dark-panel`, which fails AA.** An earlier
  version of this section said gold "becomes permissible for text and buttons"
  on dark, full stop, which would have failed silently on the panel shade.

**In practice gold is still never text and never a fill**, on any surface. The
contrast lint bans `color:`/`background: var(--accent)` everywhere and that gate
is worth more than the flourish, so bands use gold only as gradients, borders,
hairlines and SVG stroke — all of which the lint permits by design. The
`MUST_FAIL_AA` list in `scripts/contrast-lint.mjs` holds the panel case, so if
anyone ever relaxes the ban, that pairing fails loudly instead of shipping.

### Background treatment

The ground is **warm ivory with a soft botanical watermark** — lotus petals and
leaves, drawn large, held at very low contrast against `--surface`. It reads as
texture, not as illustration. Two constraints:

- **It must never compete with text.** Keep it under roughly 6% effective
  contrast against `--surface`; if a headline sitting on it becomes harder to
  scan, the pattern is too strong. The measured ratios in this section assume a
  flat ground, and a busy watermark quietly invalidates them.
- **It must not become a background image request on mobile.** Indian 4G is the
  target network. Use a tiling asset or an inline SVG, sized in kilobytes.

The zodiac wheel is the **single visual anchor** and appears once per page. Two
ornaments of that weight compete and neither wins.

**Built 2026-09-15** as `apps/customer-web/public/botanical.svg` — a 6 KB tiling
SVG of lotus rosettes, generated so the petals are genuinely radially symmetric
and the tile genuinely repeats. It is **fixed rather than scrolling**, so the
ground stays still while content moves over it and reads as printed stock rather
than as wallpaper. Held at **6%** on ivory and cream, 10% on umber, where gold
needs more to register at all. The gold in that file is a literal, so
`contrast-lint.mjs` checks it still equals `--accent`.

---

## 2. Typography

**Serif display, sans body (ADR-035).** Three families, each doing one job.

```css
--font-display-lat: "Cormorant Garamond", Georgia, serif;   /* Latin headings  */
--font-display-dev: "Tiro Devanagari Hindi", Georgia, serif;/* देवनागरी headings */
--font-body:        "Mukta", system-ui, sans-serif;         /* all body + UI   */
```

- **Mukta** (Ek Type) is a Devanagari-and-Latin superfamily. One family covers
  both scripts, so **body copy needs no `:lang()` switch** — only headings switch.
- **Tiro Devanagari Hindi** is a real Devanagari text serif designed for extended
  reading. Hindi is the default in India; it must be first-class, not a fallback.
- **Cormorant Garamond** carries the heritage warmth of the gold brand for Latin
  display. It is light at small sizes — use 500/600, which is why body moved to
  Mukta.

**Inter, Roboto, Arial and system stacks remain rejected.** Adopting a sans body
does not resurrect Inter: it has **no Devanagari coverage at all**, which is
disqualifying on a Hindi-first product. That is the reason — not inertia.

Mark up mixed content with `lang` on every run — `lang="en"` on Latin passages
inside Hindi pages — so screen readers switch voice **and headings pick the right
display face**. This is not optional polish; a Hindi headline announced in an
English voice is unintelligible, and one set in a Latin serif falls back to a
stack never designed for the script.

**Open visual check:** `--step-0` is `1.0625rem` because Cormorant is light at
body size. Mukta is sturdier and may read correctly at `1rem`. Decide by looking
at the rendered page, not by reasoning about it.

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

**Button.** Terracotta fill (`--cta`), ivory text, 2px radius, `min-height: 44px`,
padding `.7rem 1.35rem`. Hover `--cta-hover`. Focus `3px solid var(--ink)` with
`3px` offset. On dark surfaces the fill becomes gold with ink text.

**Link.** `--cta` terracotta. **Visited links must differ** — `--visited`.
Retaining the visited state is a usability requirement, not a stylistic choice.

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

Full-bleed, one composition. The left ~45% is a text zone; the right ~55% is an
**animated celestial scene** whose single anchor is an antique gold zodiac astrolabe.
Budget: one eyebrow, one headline, one supporting sentence, one CTA group, one
scene. No cards.

Implemented in `apps/customer-web/app/_components/` — `StellaHero.tsx` (layout,
copy), `StellaHero.module.css` (all hero styling),
`CelestialArt.tsx` (the artefacts).

### Three layers, and why

1. **Sky** — `/hero-sky.webp`, static. Painted artwork dropped into
   `images/herosection/` is picked up automatically by `build-assets.mjs`; with
   none present it writes a palette-matched gradient so the page never 404s and
   never looks unfinished.
2. **Veil** — an ivory gradient so the copy stays readable over the painted sky
   without hiding it.
3. **Stage** — a square coordinate space holding every animated object. All
   artefacts are positioned in `%`, so one `max-width` scales the composition.

### Celestial foreground

The hero uses six transparent WebP assets exported from
`images/celestial/separated-sheet.png`: the main dial, full moon, Saturn, Mars,
jade planet and crescent. The right-hand armillary globe has been removed.
The original `assembly.png` remains available as the source reference.
The asset builder removes the generated sheet's neutral checkerboard backdrop
and extracts each object independently; the sheet and prompt are tracked.

The full stage uses scale(.968), another 10% increase from scale(.88).
All layers share the fixed inward perspective tilt. The five satellite objects
are spatially detached from the main dial and rotate about their own centres
at independent speeds (42–96 seconds), with alternating directions. The SVG
dial and orbital beads retain their existing animation. Reduced motion disables
all rotations. No pointer tracking is used.

The hero fills the viewport below the shared 84px header. Its stage is bounded
by available height, with a compact stacked layout on mobile. Very short or
zoomed windows can grow vertically to keep content accessible. The supplied
landscape covers the section at every breakpoint.

### Orbits: the bead follows the ellipse you can see

A rotating wrapper traces a **circle**, not an ellipse. The orbit layer is
therefore squashed (`rotate(θ) scaleY(k)`), which turns both the ring's
`border-radius: 50%` and the bead's circular path into the *same* ellipse; the
bead then applies `scaleY(1/k)` to stay round.

**Only the bead's wrapper rotates.** If the stage rotated, every object would
swing together and the scene would read as one spinning graphic.

### Motion rules

- **Entrance animation is declared only inside
  `@media (prefers-reduced-motion: no-preference)`.** Declaring it globally and
  disabling it under `reduce` would leave `fill-mode: both` holding
  `opacity: 0` — the DESIGN.md §6 failure, in a new place.
- Animations run automatically without play/pause controls or pointer parallax.
- Reduced motion is honoured by **CSS, not component state** — state arrives
  after hydration and would let one animated frame through first.

**Below 900px** the split stops working: the copy takes the full measure, the
scene moves beneath it, and the jade planet, crescent and third orbit are
dropped. The wheel stays. The hero becomes `display: block` to stack the content.


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

- **≥861px** — brand left, section links right, terracotta CTA last. Current section
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

**Resolved 2026-09-14 — Devanagari sign names are canonical.** The supplied
zodiac wheel labels every sign in Devanagari (मेष · वृषभ · मिथुन · कर्क …) and
none in Western glyphs. So Devanagari is the house convention and `♈♉♊` are the
outlier; where a Latin reader needs them, they are a secondary gloss, never the
primary label. The Kundli pages no longer have a choice to make.
