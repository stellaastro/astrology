# Stella Astrology — Architecture Decision Log

**Status:** Accepted — resolved with Mr Vasantharaj, 2026-09-05
**Supersedes:** conflicting statements in `rough_plan.txt` and `system_architecture.md`

## How to read this file

`rough_plan.txt` (the "master specification") and `system_architecture.md`
(Volume I) disagree in sixteen places. Where they conflict, **this file wins**.
Neither source document has been edited; this log records which side was chosen
and why, so no future reader has to guess.

Precedence: `DECISION_LOG.md` → `system_architecture.md` → `rough_plan.txt`.

---

## ADR-001 — Brand palette is Ivory & Gold, derived from the logo

**Status:** Accepted
**Conflict:** `rough_plan.txt` §65 and `system_architecture.md` Part XXIX both
specify *Midnight Navy* primary + *Royal/Sapphire Blue* secondary. §13, §66 and
§67 call for a "deep blue navbar" and a "blue mountain landscape" hero.

**Evidence.** All four supplied brand assets were sampled programmatically.
There is no blue anywhere in the brand:

| Asset | Dominant hues | Character |
|---|---|---|
| `images/logo/stella.png` | 36–45° gold, `#902000`–`#C06000` bronze/terracotta, `#F0E0C0` ivory | warm |
| `images/stella_ltr_logo.png` | 26–47° gold, `#703000`–`#905000` deep bronze | warm |
| `images/stella_hero_bg1.png` | 30–45°, 85% luminance warm ivory | warm |
| `images/stella_hero_bg.png` | hue 300 but only 15–21% saturation | warm grey-mauve |

No blue-hue cluster appears in the top 12 colours of any asset. No mountain
image exists. The spec's visual direction describes artwork that was never
produced.

**Decision.** Drop navy and sapphire entirely. The palette derives from the
logo: ivory surfaces, bronze/terracotta ink and CTAs, gold as accent only.

**Contrast constraint (non-negotiable).** §46 requires WCAG compliance while
§13 requires a gold CTA. Measured, those are incompatible:

| Foreground on ivory `#F0E0C0` | Ratio | Verdict |
|---|---|---|
| logo gold `#C08000` | 2.55 | **fails** |
| bright gold `#F0C000` | 1.32 | **fails** |
| deep bronze `#804000` | 6.08 | passes AA |
| terracotta `#902000` | 6.74 | passes AA |
| warm ink `#2B1B10` | 12.73 | passes AA |

Therefore **gold is never used for text or as a CTA fill** — only for rules,
borders, ornament and iconography. CTAs use bronze `#904000`.

**Tokens.**

```
--surface           #F7F1E3   ivory ground
--surface-raised    #FFFFFF   cards
--ink               #2B1B10   headings / body
--ink-muted         #6B5844   secondary text
--cta               #904000   bronze fill
--cta-hover         #702F00
--accent            #C08000   gold — rules/ornament, NEVER text
--ornament          #F0C000   bright gold highlight
--sacred            #4E6B2E   leaf green (from logo)
```

Verified against the `--surface #F7F1E3` ground:

| Token | Ratio | Verdict |
|---|---|---|
| `--ink` `#2B1B10` | 14.72 | passes AA |
| `--cta` `#904000` | 6.39 | passes AA |
| `--ink-muted` `#6B5844` | 6.01 | passes AA |
| `--sacred` `#4E6B2E` | 5.38 | passes AA |
| `--accent` `#C08000` | 2.95 | **fails — ornament only, by design** |

White on the bronze CTA is 7.19:1.

**Consequence.** Themes 1, 2, 3 and 5 in §13 (Midnight Cosmic, Royal Sapphire,
Sky Mountain, Twilight Purple) are dropped. Theme 4 (Ivory & Gold) becomes the
product. `stella_hero_bg1.png` is the hero (warm cream — matches the logo);
`stella_hero_bg.png` is rejected as it introduces a lavender hue absent from
the brand. The token architecture of §65 is retained so themes remain possible.

---

## ADR-002 — Admin uses a dark warm-ink variant of the same tokens

**Status:** Accepted
**Conflict:** §69 requires Admin to differ visually from the consumer app, but
ADR-001 selects a single light palette.

**Decision.** Admin keeps the *same semantic token names* with a dark value
map. Gold becomes usable as a CTA fill on dark, which it never is on ivory:

| On admin ground `#1A120B` | Ratio | Verdict |
|---|---|---|
| ivory ink `#F5EAD6` | 15.52 | passes AA |
| bright gold `#F0C000` | 10.79 | passes AA |
| muted `#A08A6A` | 5.58 | passes AA |
| gold CTA `#C08000` | 5.57 | passes AA |

**Consequence.** §69's "dark navy" becomes dark warm-ink, consistent with
ADR-001. One component library, two value maps — no second design system.

---

## ADR-003 — NestJS + TypeScript is the primary backend

**Status:** Accepted
**Conflict:** `rough_plan.txt` §6 specifies a "FastAPI API" and §50 mandates
Pydantic schemas; §5 hedges with "Node js, Python". `system_architecture.md`
Part III / ADR-001 specifies NestJS.

**Decision.** NestJS + TypeScript owns all business and financial logic.

**Rationale.** Shared types, validation and API contracts with the Next.js
customer web and admin web apps; strong module boundaries suited to the modular
monolith of §6; native WebSocket gateway for the self-hosted chat of Part VIII.

**Consequence.** §50's "Pydantic schemas" is void — OpenAPI is generated from
NestJS decorators instead. Python is retained only for the astrology engine
service should it later be built internally (ADR-004).

---

## ADR-004 — External astrology provider for V1; ProKerala primary

**Status:** Accepted
**Conflict:** §15 states the primary engine is an "internal professional-grade
calculation service" with external providers used "for validation/reference
where required". In reality no ephemeris exists, while **two** external
providers are provisioned.

**Decision.** V1 calculations come from **ProKerala**, reached through an
`AstrologyProvider` interface. AstrologyAPI is implemented as a secondary
adapter for cross-checking only. An internal Swiss Ephemeris engine may replace
the primary later without changing any caller.

**Rationale.** ProKerala is Vedic-native, uses OAuth2 client credentials, ships
an official SDK, and covers kundli, dasha, dosha, nakshatra, panchang, muhurta
and matching — close to a 1:1 map onto §14's free-Kundli scope. Building Lahiri
ayanamsa, divisional charts, Vimshottari dasha, Panchang, Muhurta and
Ashtakoota internally is months of specialist work requiring a practising Vedic
astrologer to validate.

**Correction.** The AstrologyAPI sample in `config.txt` requests a **Western**
horoscope with **Placidus** houses, contradicting §15's Vedic/Lahiri
requirement. That sample must not be used as an integration template.

**Constraint.** §14 reproducibility is binding regardless of provider: every
calculation stores provider identity, engine version, ayanamsa, coordinates,
timezone, parameters and timestamp.

---

## ADR-005 — 100ms is the realtime provider

**Status:** Accepted
**Conflict:** §5 and §25 name Agora. `system_architecture.md` Part IX says
"Agora/100ms". `config.txt` contains a provisioned 100ms account — room,
template, app key/secret, subdomain and SIP credentials. No Agora credentials
exist anywhere.

**Decision.** Implement Part IX's `RealtimeProvider` interface with
`HundredMsRealtimeProvider` as the V1 implementation. Agora remains swappable.

**Consequence.** §5 and §25 are corrected to read 100ms. Media never transits
the VPS. Provider secrets stay server-side; clients receive only short-lived
signed tokens per §25.

---

## ADR-006 — Wallet is non-refundable service credit

**Status: SUPERSEDED 2026-09-05 by ADR-023 (per-booking payment, no wallet).**
The reasoning below stands and becomes live again when a wallet is actually
needed — at roster 8–12, or whenever stored value earns its place. It is
superseded on *timing*, not on substance: the CA opinion this ADR waits for has
no date, and V1 no longer needs one because Razorpay per-booking requires no
stored value and no ledger.

**Conflict:** §26 mandates a full stored-value Wallet + Ledger, while §27
explicitly flags that stored-value wallets and auto-recharge carry
payment/regulatory implications and forbids the engineering team from reaching
a legal conclusion.

**Decision.** Build toward **non-refundable consultation credit**: a recharge
buys credit usable only inside Stella, never withdrawable to a customer bank
account.

**This is a product decision, not a legal opinion.** A stored-value INR balance
may constitute a Prepaid Payment Instrument requiring RBI authorisation. The
non-withdrawable model is the pattern commonly used to stay outside that
regime, but **Stella's CA/legal counsel must confirm before launch.** This ADR
records an assumption; it does not certify compliance.

**Consequence.** §26's ledger architecture is unchanged — Wallet + Ledger +
Transaction + Settlement, atomic transactions, idempotency, row-level locking,
append-only events, compensating entries. Only the customer-withdrawal endpoint
is omitted, and it stays behind a feature flag. Terms & Conditions must state
non-refundability prominently before any money is accepted.

**Open:** §28 auto-recharge requires a Razorpay-supported mandate (UPI Autopay
or e-mandate). Not started until ADR-006 is legally confirmed.

---

## ADR-007 — Customer mobile and astrologer mobile are both Flutter

**Status: SUPERSEDED 2026-09-05 by ADR-022 (web-only for V1).** Flutter remains
the chosen mobile framework for when native apps are built; this ADR is
superseded on *timing* only. V1 ships web-only, which removes Apple and Google
developer accounts, first store review, ADR-013's icon-rejection risk, ADR-010's
one-device policy, and the entire Dart-codegen mitigation below from the path to
first revenue. **The OpenAPI annotation lint still ships in Phase 1; only Dart
client *generation* is deferred**, because a generated client with zero
consumers rots or gets switched off.

**Conflict:** Three-way. `rough_plan.txt` §5 says Flutter (customer) + React
Native/Expo (astrologer). `system_architecture.md` Part III says React Native
for both. The project owner specifies Flutter.

**Decision.** Flutter for both mobile applications.

**Consequence — important.** This partially defeats the "TypeScript everywhere"
rationale in Part III. Dart cannot consume `packages/shared-types`,
`packages/validation` or `packages/api-contracts` as TypeScript.

**Mitigation (binding).** The **OpenAPI document becomes the single source of
truth** for the client/server contract, not the TS packages. CI generates a
Dart client from the same OpenAPI spec that produces the TS client. Contract
drift is therefore caught by codegen rather than by hand-synchronised types.
`packages/api-contracts` is the real cross-language boundary.

---

## ADR-008 — Scale target is ~50 concurrent consultations, not 1,000

**Status:** Accepted
**Conflict:** §55 requires design for "1,000 concurrent consultation sessions"
against 10,000 registered users. Part VIII describes "roughly 100 customers and
20–50 astrologers"; Phase 24 sets beta at 50–100 customers, 10–20 astrologers.

**Analysis.** A consultation occupies one astrologer. 1,000 concurrent
consultations therefore requires roughly 1,000 simultaneously-online
astrologers — two orders of magnitude beyond the stated roster. The §55 figure
is unachievable by arithmetic, not by engineering.

**Decision.** Target 10,000 registered users, ~1,000 concurrent *connected*
users, and **~50 concurrent billed consultations**, sized to a 50–100
astrologer roster.

**Correction, 2026-09-05.** The ~50 figure corrected an unachievable number to a
merely wrong one. It was sized against a 50–100 astrologer roster that does not
exist: launch is **3 astrologers** and the soft-launch gate is **8–12**. A
consultation occupies one astrologer, so the real ceiling at launch is 3
concurrent and 8–12 after the roster gate. **§62 load tests should target 12–15
concurrent, not 50** — testing 4× the real ceiling wastes effort that belongs on
concurrency *correctness* (double-booking, double-settlement, lost updates under
row locks), which is where the actual risk lives at this scale.

**Consequence.** §55 is corrected. A single well-specified VPS is adequate, as
Part XXV already anticipates. Kubernetes and multi-region remain excluded per
§55 and Part XXXIV.

---

## ADR-009 — Merged roadmap with Admin pulled forward to Phase 4

**Status:** Accepted
**Conflict:** `rough_plan.txt` §73 sequences chat consultation at Phase 6 but
wallet/payment/ledger at Phase 8 — consultations become possible before they
can be billed. `system_architecture.md` Part XXXI corrects this. Both, however,
place the Admin Command Center at Phase 18/20, while astrologer KYC approval
(Phase 3/4) structurally requires an admin UI to function.

**Decision.** Adopt Part XXXI's 25-phase order, with one insertion: a **minimal
Admin shell at Phase 4** providing exactly the astrologer application review,
KYC approval and suspension controls that Phase 4 depends on. The full Command
Center still lands at Phase 20.

**Rationale.** Without this, astrologers would be approved by direct SQL for
most of the build — which would bypass the audit trail §37 makes mandatory.

---

## ADR-010 — Device policy binds the mobile install, not the web session

**Status:** Accepted
**Conflict:** §52 mandates "one active device" per customer, while §8 specifies
a full customer web application including wallet and consultations. A customer
using a phone and a laptop violates §52 as literally written.

**Decision.** The one-device rule binds the **registered mobile app install** —
the account-sharing vector §52 actually targets. Web receives ordinary
revocable sessions with device listing and new-device alerts.

**Consequence.** §52's "secure device registration + replacement workflow +
session revocation" is implemented in full for mobile. §52's caution that raw
device ID must not be the only security mechanism is retained.

---

## ADR-011 — Firebase is the identity provider; Stella stores no passwords

**Status:** Accepted
**Conflict:** §36 lists both "Secure password hashing" and "Firebase
Authentication" as requirements.

**Decision.** Firebase Authentication with phone + OTP is primary, per Part VI.
Stella stores **no password hashes at all** for customers.

**Rationale.** With phone-OTP as the primary factor there is no password to
hash. Retaining a password store would add credential-stuffing surface for no
benefit.

**Consequence.** §36's "secure password hashing" applies only to any future
password-based admin path. Per Part VI, Firebase authenticates identity only —
Stella's MySQL remains authoritative for status, roles, wallet, birth profiles,
consultations, permissions and KYC. Admin MFA per §36 is unaffected.

---

## ADR-012 — Auto-detected locale, Hindi default in India

**Status:** Accepted
**Conflict:** §45 requires English + Hindi i18n but never names a default.

**Decision.** Detect device/browser locale. Indian users default to **Hindi**;
all others to English. A visible manual switch is always present.

**Rationale.** The company operates from Itarsi, Madhya Pradesh, and the supplied
zodiac asset is labelled in Devanagari. §80's international-expansion path stays
open via the same key architecture.

**Consequence.** §45's prohibition on hardcoded UI text is binding from the
first commit — including in Flutter, which needs its own ARB-based catalogue
fed from the same translation keys.

---

## ADR-013 — Zodiac wheel is the app icon

**Status: DORMANT while V1 is web-only (ADR-022).** There is no app icon and no
store review until native apps are built, so reservation 2 below cannot bite
yet. Reservation 1 (legibility at small sizes) **is live now and confirmed** —
see ADR-025: the wheel is unreadable below roughly 60px, so the web favicon and
header use the simplified lotus-and-star roundel rather than the full wheel.

**Conflict:** The project owner designates `images/logo/stella.png` (the
12-segment zodiac wheel) as the app logo, while `stella_ltr_logo.png` carries
the S/A monogram lockup.

**Decision.** Use the zodiac wheel as the app icon and favicon, as directed.

**Recorded reservations** (raised, considered, overruled by the owner):

1. **Legibility.** The wheel carries twelve Devanagari rashi labels. At 48px
   launcher size and 16px favicon size these are not resolvable. The icon set
   must be reviewed at true size before store submission.
2. **Store review.** The centre bears a swastika — a sacred Hindu symbol,
   entirely correct in a Vedic astrology context. It is nonetheless a
   documented friction point in Apple and Google review, and for the
   international audience §80 anticipates. A monogram fallback icon should be
   prepared in case review requires one.

---

## ADR-014 — Cloudflare R2 for object storage

**Status:** Accepted
**Conflict:** §5 and §31 specify AWS S3, but no S3 credentials exist in any
configuration, and hosting is a Hostinger VPS behind Cloudflare.

**Decision.** Cloudflare R2, via the S3-compatible API.

**Rationale.** Cloudflare already fronts the platform per §5; R2 has no egress
fees; the S3-compatible API means §5's and §31's wording still holds and AWS
remains a drop-in alternative.

**Constraint.** §31 is binding: all buckets private, no public URLs ever.
Access is exclusively through short-lived signed URLs (300s default). KYC
objects are classified KYC/RESTRICTED per Part XIX.

---

## ADR-015 — No call recording in V1

**Status:** Accepted
**Conflict:** §35 requires recording consent and Part XX specifies a full
consent-gated encrypted recording pipeline with audited playback.

**Decision.** Recording is **off** in V1. The consent fields, the
`RealtimeProvider.getRecording()` seam and the storage classification are all
built, so it can be enabled later without rework.

**Rationale.** Removes a large privacy, storage and legal surface from the
critical path to first revenue.

**Consequence.** Session **metadata** — start, pause, resume, end, billable
seconds — is still recorded in full per §51, which covers the majority of
billing disputes without holding sensitive content.

---

## ADR-016 — Monorepo, Part XXIV layout, in the existing GitHub repo

**Status:** Accepted
**Conflict:** `rough_plan.txt` §7 gives a Python-shaped tree
(`backend/app/main.py`, `modules/`); `system_architecture.md` Part XXIV gives
`apps/` + `services/` + `packages/`.

**Decision.** Part XXIV's layout, in `github.com/stellaastro/astrology`.

```
apps/       customer-web (Next.js), admin-web (Next.js),
            customer-mobile (Flutter), astrologer-mobile (Flutter)
services/   api (NestJS), astrology-engine (future), workers
packages/   api-contracts (OpenAPI — cross-language SoT), shared-types,
            validation, design-system, config, utilities
infrastructure/  docker, nginx, mysql, redis, rabbitmq, deployment
docs/       architecture, database, api, security, payments, astrology,
            operations, product
```

**Consequence.** §7's `backend/` tree is void — it presumed FastAPI, which
ADR-003 replaced. §7's `views/` and `routes/` directories under `customer-web`
are also void, as they describe neither the Next.js App Router nor Pages
Router.

---

## ADR-017 — Duplicate astrologers are DEV-only fixtures, never production rows

**Status: AMENDED 2026-09-05 by ADR-026.** Two corrections, one in each
direction:

1. **The count and purpose were wrong.** 17 duplicates existed to exercise
   discovery, filtering and ranking — features that were subsequently cut as
   scale complexity at roster 3. Needing fabricated data to exercise a feature is
   evidence the feature is ahead of the business. Fixtures now exist for a
   narrower, honest reason: list pagination, empty-versus-dense layout, and
   repeatable Playwright fixtures. The count follows from that, and it is small.
2. **Control 4 as written is not implementable.** CI evaluates code, not the row
   contents of a deployed database — you cannot fail a build over data that
   exists in an environment. Replaced by a **boot-time guard**: the application
   refuses to serve if `is_dev_fixture` rows are present under a non-development
   profile, plus a seed script that refuses to run outside development.
   **Accepted tradeoff: downtime over contaminated data**, because a fake
   astrologer carrying a painted-on five-star badge on a registered company's
   site is worse than an outage. Note this keeps a development-only column in
   the production schema permanently.

Everything else below stands, including the photography rule.

**Context.** Three real astrologers are confirmed (roster held at
`/home/stellaastro/secrets/astrologers-roster.md`, not in this repo). Building
discovery, filtering, ranking and matching against three records would not
exercise those features, so the owner authorised duplicate astrologers "for the
time being".

**Constraint.** `rough_plan.txt` §71 forbids mock astrologers reaching
production, and §13 forbids invented ratings and testimonials — but §71
explicitly permits mocks "behind explicit development adapters" using "seeded
development data clearly marked as DEV".

**Decision.** Duplicates exist as **development fixtures only**, under four
controls:

1. **Location.** `services/api/prisma/seeds/dev/` — never in a production
   migration. Seeds run only when `APP_ENV=development`.
2. **Marking.** Every seeded row carries `is_dev_fixture = true` and a
   `DEV —` display-name prefix. The column exists in the schema so production
   queries can exclude it, and so a stray fixture is visible on sight.
3. **Synthetic identity.** Fixture phone numbers come from the reserved
   `+9199999000NN` block. Real numbers are never used in fixtures.
4. **CI gate.** A build check fails the pipeline if any row with
   `is_dev_fixture = true` exists in a staging or production database, and if
   any seed file is imported outside a development bundle.

**Photography.** The portraits in `images/icon_images/chead-*.jpg` are
AI-generated and have **five-star rating badges baked into the image**. They
are usable as dev fixture avatars. They must never represent a real astrologer
in production — that would be a fake astrologer and a fake review
simultaneously (§13, §71). Real photographs are required for the three
founders before launch.

**Landing page.** §66's "Featured Astrologers" section shows only real,
approved astrologers — three at launch. No count, rating average or testimonial
is displayed until it derives from real data (§13).

---

## ADR-018 — One identity, additive roles, step-up MFA for admin

**Status:** Accepted — **owner confirmation requested**
**Context.** All three founding astrologers are company officers. Krishn Kumar
Sahu's astrologer mobile is also the registered company contact in
`rough_plan.txt` §1. Each therefore needs both an astrologer identity and an
admin identity, on one phone number.

**Problem.** Firebase phone authentication yields one identity per number. The
specification treats customer, astrologer and admin as three applications
(§10–§12), which implicitly assumes three separate people.

**Decision.** A single Stella user identity per phone number, carrying an
**additive set of roles** (`astrologer`, `admin:*`). Firebase authenticates the
number; Stella's database remains authoritative for roles, per Part VI.

Accessing any admin surface requires **step-up re-authentication with MFA**,
satisfying §36's mandatory Super Admin MFA without forcing MFA on the
astrologer app's routine login. The §52 one-device rule (ADR-010) binds the
astrologer app install; admin access is web, with its own revocable session.

**Rationale.** Duplicate accounts per person would fragment the audit trail
§37 requires and make it impossible to answer "who did this" reliably.

---

## ADR-019 — Founder consultations run the full commission path

**Status:** Accepted — **rate is a decision for Stella's CA**
**Context.** At launch every astrologer is also a director. Platform commission
charged on their consultations is a related-party transaction with accounting
and tax consequences.

**Decision.** No special-casing in code. The founder rate is **configuration,
not logic** — set to whatever Stella's CA advises, including zero.

**Rationale.** Special-casing founders in code would leave the commission and
settlement paths untested by the very consultations happening at launch.

**RESTATED 2026-09-05.** Two clauses contradicted the revenue-first reordering
and are corrected here rather than left to be discovered:

1. **"Flows through the ordinary §29 commission rules engine"** — the rules
   engine is deferred (ADR-024). At roster 3, where the astrologers are the
   owners, commission is a **fixed-rate field** on the booking row and a monthly
   bank transfer, not an engine. The engine earns its place past ~20 astrologers.
2. **"Before any *earning*"** — as written, this made verified payout accounts a
   hard prerequisite that first revenue would cross, because payout execution is
   deferred to after first revenue. Corrected to **before any *payout***. Money
   can be earned and recorded before the payout rail exists; it cannot be
   disbursed before it. Manual admin-created KYC satisfies §30's substance at
   roster ≤12.

---

## ADR-020 — KYC approval requires a second officer (four-eyes)

**Status:** Accepted
**Context.** The founding astrologers are also the administrators who approve
astrologer KYC. Self-approval is possible as the workflow is specified in §31.

**Decision.** KYC approval is rejected when the approving admin is the subject
of the application. A different officer must approve.

**Rationale.** §37 requires every privileged action to be audited, but an audit
log that faithfully records self-approval is still a control weakness.

**AMENDED 2026-09-05 — twice, and both amendments matter.**

1. **The rule as written is theatre.** "Approver is not the applicant" is
   satisfied by Director A approving Director B. Related parties approving each
   other meets the letter and defeats the purpose. The guard must assert the
   **approver holds no astrologer role at all**, which requires provisioning at
   least one non-astrologer admin identity — an unassigned owner action (O5), and
   the contractor cannot be that person.
2. **It is scoped to the wrong control.** KYC approval happens **once**, for
   three known directors — low risk, high ceremony. The acute related-party gap
   is elsewhere and was unguarded: **refunds, no-show adjudication and ledger
   adjustments**, where a customer complaint about a consultation would be judged
   by the admin who *gave* that consultation. Four-eyes on those is the control
   that makes the refund policy enforceable, and it must exist **before the first
   paid booking** (task 6.9), not as a later document.

---

# ADRs 021–032 — from the plan reviews, 2026-09-05/06

Produced by `/plan-ceo-review`, `/plan-eng-review` and `/plan-design-review`,
each with an adversarial outside voice. Eight of these reverse a decision made
earlier the same day; two correct outright errors. Where that happened it is
said plainly, because a decision log that hides its reversals is worth less than
one that shows them.

## ADR-021 — Scheduled booking is the launch modality

**Status:** Accepted
**Decision.** Booked appointments are the launch experience. On-demand "connect
now" sits behind a runtime coverage rule: enabled per language × specialisation
bucket only when **≥3 astrologers are on duty in that bucket**.

**Why.** Industry guidance puts the minimum roster for 24/7 on-demand coverage at
40–50 astrologers. Stella launches with 3. On-demand at that roster means the
modal customer experience is a failed match — the bottleneck is human supply, not
software, so no amount of engineering fixes it. Scheduling converts a supply
shortage into a normal booking flow, and predictable hours are the strongest
lever on recruiting the supply everything else depends on.

**Consequence.** The full consultation state machine is still built. Only
*initiation* changes; billing and lifecycle are untouched.

## ADR-022 — Web-only for V1

**Status:** Accepted — supersedes ADR-007 on timing
**Decision.** V1 ships as web only. No Flutter apps.

**Why.** 100ms has a web SDK, so voice and video work in a browser. Scheduled
booking plus SMS reminders removes the push-notification argument. The three
astrologers are directors with laptops, and admin is a role-guarded route group
in the same Next.js app. Four frontends for three astrologers is not defensible.

**Removed from the critical path:** Apple and Google developer accounts, first
store review, ADR-013's icon-rejection risk, ADR-010's one-device policy, and
Dart client generation.

**Accepted risk, and it is real.** Indian consultation customers expect a native
app. More urgently, the entire bet rests on mobile-browser WebRTC — iOS Safari,
no background audio on app-switch, permission prompts, Indian 4G — which is
**untested**. Task 1.5 spikes this in week 1. `config.txt` already carries 100ms
**SIP credentials**, so a PSTN dial-in fallback was evidently contemplated; that
is the hedge.

## ADR-023 — Razorpay per-booking, paid at booking. No wallet, no ledger.

**Status:** Accepted — supersedes ADR-006 on timing
**Decision.** Customers pay per booking through Razorpay, **at the time of
booking**. No stored value, no double-entry ledger in V1.

**Why the wallet had to go.** The argument for building the ledger early was that
commission cannot be retrofitted into immutable history. That is true — and the
identical argument applies to **GST basis, rate, SAC code, place of supply and
TDS treatment**, none of which are decided and all of which require a CA opinion
that has no date. Shipping "tax-basis columns" treated columns as the hard part.
They are not; the *postings* are. So the ledger was gated on the same unbounded
item, and the correct conclusion was not "build it earlier" but **do not accept
money in a form that needs a ledger until the CA answers**. Razorpay per-booking
needs none: their records are the audit trail, GST-invoiced and reconciled.

**Why pay-at-booking specifically.** A no-show on an unpaid booking burns an hour
of the scarcest asset in the business for nothing, and dropping WhatsApp made
no-shows likelier. Paying at booking also means revenue lands at Phase 7, not
Phase 8.

**Consequence.** Refund economics must be modelled before the policy is set: the
gateway fee on the original payment is generally not returned, so every
astrologer no-show costs Stella that fee; and refunds draw against settlement
balance at T+2/T+3, so a same-week refund at low volume can fail for insufficient
funds.

## ADR-024 — Slot-based billing, not per-minute metering

**Status:** Accepted
**Decision.** A booked 30-minute slot bills for the slot. No per-minute meter.

**Why.** Per-minute billing is an on-demand mechanic. Under scheduled
appointments it answers a question nobody asked and creates one nobody had: if a
customer books 30 minutes and leaves at 10, is the astrologer paid for the
reserved slot or the used minutes? Slot pricing answers it by construction and
protects astrologer income, which is the stated retention lever.

**What this removes from the foundation:** metering, hold-then-release of funds,
partial-minute rules, and the monotonic-clock requirement for billing ticks —
all of which existed solely to serve per-minute billing.

**Consequence — copy is constrained by this.** The landing page may not advertise
"pay only for what you used". It is not true under this model. Commission is a
**fixed-rate field**, not a rules engine (see restated ADR-019).

**Open:** overrun. A 30-minute slot running 40 eats the next customer. Slot
billing has no overage by construction, so this resolves as either a hard room
close or mandatory inter-slot buffers (task 6.7).

## ADR-025 — Design system: Ivory & Gold, measured

**Status:** Accepted
**Decision.** Tokens, type and space as recorded in `DESIGN.md`, derived from a
working sketch rendered at three viewports rather than from description.

Contrast measured, not estimated: ink `#2B1B10` **14.8:1**, soft ink `#6B5643`
**5.1:1**, bronze CTA `#904000` **6.4:1**, gold `#C08000` **2.96:1**. The last
confirms ADR-001's figure and is why gold is ornament only, enforced by a CI
contrast lint.

**Type: Tiro Devanagari Hindi + Cormorant Garamond.** Two families, each chosen
for the script it serves. Inter is explicitly rejected — it is the documented
"gave up on typography" signal and has no Devanagari coverage at all, which
matters on a Hindi-first product.

**Brand marks.** Use the round zodiac mark plus a **typeset** wordmark.
`stella_ltr_logo.png` has a broken alpha channel — yellow and red fringing around
the entire silhouette, mottled noise inside the plaque — and is gold-on-gold,
which the colour rule forbids. Re-cutting needs a source that may not exist.

**Two rules learned by rendering, not by reading:**
- **Never gate content visibility on a scroll animation.** An opacity fade driven
  by `animation-timeline: view()` with `fill-mode: both` holds `opacity: 0`
  whenever the timeline never advances — the elements occupy layout height and
  never paint. It blanked all three astrologer bands. Animate transform.
- **`order` does not move grid tracks.** Alternating a two-column layout with
  `order: 2` leaves the item in the next track, so a 300px photo landed in the
  `1fr` column at double size. Swap `grid-template-columns` instead.

## ADR-026 — Dev seeds exist; fake data in production does not

**Status:** Accepted — amends ADR-017
**Decision.** Environment-gated development seeds, small, with a **boot-time
guard** that refuses to serve when `is_dev_fixture` rows appear under a
non-development profile, plus a seed script that refuses to run outside
development. The rule is *no fake data in production*, not *no seed data*.

**Why both directions were wrong once.** 17 fixtures existed to test features
that were then cut. Deleting them entirely then left the contractor unable to
build the booking calendar, write repeatable Playwright fixtures, or demo
anything without real director data. The middle position is the correct one.

## ADR-027 — Public pages precede identity

**Status:** Accepted — reverses a decision made the same day
**Decision.** The public landing page and legal pages ship **before** the
identity phase. Only the admin *read* of leads is deferred until identity exists.

**Why the first ordering was wrong.** Identity was put first because the admin
lead view writes audit events that need an actor. True — but that applies to the
admin read, not the public write, which needs no auth at all. The effect was to
park **Razorpay merchant activation** — which requires a live, reachable site
carrying terms, pricing and a refund policy — behind an entire auth system, while
the domain stayed dark during the exact window the directors work their network.

**Consequence.** In Phase 2 the three astrologers are **static page content**,
not database rows. They become real rows in Phase 4.

## ADR-028 — Email is the primary lead contact; phone is optional

**Status:** Accepted
**Decision.** The waitlist collects email as the required field.

**Why.** After WhatsApp was dropped, SMS became the only channel — and commercial
SMS in India requires TRAI DLT entity and template registration, which takes
weeks and has not started. Every phone number collected would have been
uncontactable. **Note the trade honestly:** email dodges DLT but picks up its own
lead-time item, because deliverability needs SPF/DKIM/DMARC on the domain and a
warm-up. Gmail SMTP caps near 500/day and is not a transactional mail solution.

**Requires double opt-in.** The enumeration fix (identical responses for new and
existing addresses) combined with unique-on-email otherwise lets anyone squat an
address and silently lock out its real owner.

## ADR-029 — Slot uniqueness via a generated column

**Status:** Accepted — **corrects an error in an earlier recommendation**
**Decision.** Slot uniqueness is enforced by a **stored generated column that is
NULL when the row is not slot-occupying**, carrying a unique index.

**The error.** The first recommendation was a plain
`UNIQUE(astrologer_id, slot_start)`. That is a PostgreSQL pattern. **MySQL 8 has
no partial or filtered unique indexes**, so a cancelled or payment-failed booking
would occupy that slot forever — nobody could ever book 4pm again, and the
failure would surface as astrologers asking why their afternoons vanished.
Prisma's `@@unique` emits a plain index and does not help.

**The mechanism.** MySQL permits unlimited NULLs in a unique index, so a column
that is NULL for non-active rows yields exactly the filtered uniqueness needed.
Requires raw SQL in the migration and a comment explaining the invariant, because
it is not self-evident.

**Related:** the durable hold is the **database row**. Redis is a UI optimisation
only, with its own DB index and key prefix per environment — currently
unseparated, so a staging test would drop production holds. A short Redis TTL is
wrong: the hold must outlive the whole Razorpay flow, and UPI collect pends for
minutes.

## ADR-030 — Scheduler and outbox are foundation, not deferrals

**Status:** Accepted — **corrects an error in an earlier recommendation**
**Decision.** The delayed-job scheduler and the transactional outbox ship in
Phase 1.

**The error.** Both were cut from the foundation with the stated reason that they
"only became retrofit-ruinous under per-minute billing, which is now gone." That
reasoning inverted when the billing model changed. Pay-at-booking needs them
**more**: an abandoned checkout leaves a PENDING booking holding a slot forever
without a reaper; SMS reminders are scheduled jobs by definition; no-show windows
and refund windows are timers; and a payment webhook that must confirm a booking,
email the customer and notify the astrologer is exactly the at-least-once
side-effect problem — now sitting on the money path.

**General rule this produced.** When a plan reverses a core model, re-check every
deferral whose stated reason cited the old model.

## ADR-031 — Astrologer surfaces live in admin-web for V1

**Status:** Accepted
**Decision.** Availability editing, upcoming bookings and the join link are
role-guarded routes inside the admin web app.

**Why this ADR exists at all.** Dropping Flutter (ADR-022) removed the astrologer
app, and **nothing replaced it** — no phase described where an astrologer sets
their hours, sees who booked them, or joins a call. Left implicit, an external
contractor builds the customer side and stops. At roster 3, where all three
astrologers are also administrators, one app serving both roles is honest and
cheap.

**Accepted debt.** This conflates two roles. When non-director astrologers join
at the 8–12 gate, they will need separating, and that separation is real work.

## ADR-032 — Backup and restore

**Status:** Accepted
**Decision.** Nightly MySQL dumps to Cloudflare R2, binlogs for point-in-time
recovery, **plus the R2 objects themselves and the secrets file**, and one
rehearsed restore before launch.

**Why this ADR exists.** Three planning documents, twenty-three ADRs and twenty
phases contained **no mention of backups, retention, point-in-time recovery or
restore rehearsal** — while asserting an RPO of 1 hour and an RTO of 4 hours.
Everything lives on one VPS with one MySQL instance. An untested backup is not a
backup, and here there was not even an untested one.

**Note.** `/home/stellaastro/secrets/config.txt` is currently the single
plaintext copy of every credential the project holds. It must be in the backup
set, and the plaintext-on-host arrangement is an interim state pending a secrets
manager.

### Verified and corrected 2026-09-06 — the promise did not hold as written

This ADR asserted binlogs for point-in-time recovery. **Binary logging was
explicitly disabled**, so PITR was impossible and the real RPO was 24 hours, not
the 1 hour §54 claims.

`/etc/mysql/mysql.conf.d/mysqld.cnf` carried `disable_log_bin`. The evidence
chain, before touching anything: `binlog.000001` and `.000002` dated 9 Aug with
`binlog.index` listing only those two, while mysqld had restarted 31 Aug 10:36 —
and a restart always rotates to a new binlog file when logging is on. The absent
`binlog.000003` was the tell.

**Fixed** (config backed up to `/root/mysqld.cnf.backup.20260906-103159`):

```ini
server_id = 1
log_bin = binlog
binlog_format = ROW
binlog_row_image = FULL
binlog_expire_logs_seconds = 1209600   # 14 days
sync_binlog = 1
```

Verified by restart: `binlog.000003` was created, `binlog.index` updated, mysqld
8.4.11 started clean. The stale August files fell outside the 14-day window and
were purged automatically — the retention policy working on its first run.

### A second finding, not what was being looked for

`innodb_flush_log_at_trx_commit` was **2**: committed transactions went to the OS
cache and were fsync'd roughly once per second. A host crash or power loss
silently loses **up to one second of committed transactions**.

That is a defensible tuning choice for a content site. It is the wrong one for a
system whose ADRs declare financial history immutable and whose Phase 7 takes
payments — "immutable" is worth little if a commit can evaporate. **Changed to
1** (fsync at every commit), paired with `sync_binlog = 1` for a fully durable
configuration. At this transaction volume the write cost is irrelevant;
correctness is not.

**Not verified at runtime.** `SHOW VARIABLES` could not be run: the MySQL
credential stored in `config.txt` (`hminds@localhost`) is **rejected** — parsing
was confirmed correct, so the stored value is stale or was changed outside the
file. Worth resolving before O1 rotation, or a value that is already wrong gets
rotated. The config file and a clean start are the evidence for this setting;
the created binlog file is direct evidence for the other.

---

## Security remediation (completed 2026-09-05)

`config.txt` held live credentials — Razorpay `rzp_live_` key **and secret**,
100ms app secret and SIP password, a Firebase phone-verification token,
AstrologyAPI key and JWT, the MySQL password and the Gmail/payout passwords —
inside the nginx document root, in the directory the file itself instructs the
reader to `git push` to GitHub. The parent `.gitignore` contained only
`!.gitignore`, so it excluded nothing.

This violated §58 rules 12 and 13 ("never hardcode secrets", "never expose
credentials").

**Done:**

- `config.txt` moved to `/home/stellaastro/secrets/config.txt`, mode `600`,
  outside the document root.
- Comprehensive `.gitignore` added, covering `.env*`, `config.txt`, service
  accounts, keystores and `rzp-key.csv`.
- `.env.example` added with placeholder keys only, mapped to these ADRs.

**Assessed:** the site's nginx vhost proxies `location /` to `127.0.0.1:3000`
rather than serving the directory statically, and nothing is currently listening
on that port. The file was therefore **not** publicly served. The exposure route
was the planned git push, not the web.

**Repository made public 2026-09-06.** This section is therefore world-readable.
It contains no credential values — every commit was checked — but it does name
which live credentials were exposed. Rotation was already required; publication
put a clock on it. **Rotation authorised and in progress from 2026-09-06.**
Once complete, everything below describes history rather than a live weakness.

**Outstanding — owner action required.** The following must be rotated in their
respective dashboards by Stella personnel. Claude does not touch live financial
credentials:

| Credential | Where | Priority |
|---|---|---|
| Razorpay live key + secret | Razorpay Dashboard → API Keys | **critical** |
| 100ms app secret + SIP password | 100ms Dashboard → Developer | **critical** |
| MySQL user password | Server / hosting panel | high |
| Gmail app password | Google Account → App Passwords | high |
| AstrologyAPI key + MCP token | AstrologyAPI dashboard | medium |
| ProKerala client secret | ProKerala dashboard | medium |
| Firebase phone-verification token | Firebase Console | medium |
| **Two OpenAI project keys** — pasted into a chat transcript 2026-09-05 while attempting design mockups; stored at `~/.gstack/openai.json` mode 600 | platform.openai.com → API keys | high |

**Also outstanding:** review the Razorpay, 100ms and Gmail **activity logs** for
unauthorised use during the exposure window. Rotation closes the future; the logs
are the only way to know whether anything happened in the past. This is cheap and
standard after credential exposure, and it was missing from the original
remediation.

**Interim state, not a fix.** `config.txt` is still plaintext on the same host
that was the exposure vector — mode 600 only stops non-root local users, and the
exposure route was shell access. It is also the single copy of every credential
the project holds, so it must be in the backup set (ADR-032). The real fix is
environment injection or a secrets manager.

---

## Corrections to company details

For legal footers, T&Cs and the Razorpay merchant record:

- `config.txt` names **Mr Shivpal Singh, Executive Director**;
  `rough_plan.txt` §1 omits him. Confirm the authoritative director list.
- Both documents say **Hoshangabad**. That district was officially renamed
  **Narmadapuram** in 2021. Confirm which name appears on the certificate of
  incorporation, and use that verbatim in legal text.

---

## Still open

Rewritten 2026-09-06 against the consolidated eight-phase build order. The
earlier version referenced phases 8/9/13/17 from a roadmap that no longer exists.

**Resolved since the last revision:** ADR-018 identity model confirmed (one
identity, additive roles, step-up MFA) · real astrologer roster confirmed, 3
directors · ORM chosen (Prisma) · ADR-006 legal confirmation **no longer blocks
anything**, because ADR-023 removed the wallet from V1.

| # | Question | Blocks | Owner |
|---|---|---|---|
| 1 | **Do the three directors have paying consultation clients today?** A "no" reopens the validation-wedge approach and reshapes the plan | everything — answer first | Vasantharaj |
| 2 | **Photographs, credentials, years of practice, specialisations, per-session price** for all three | Phase 2 landing → Razorpay activation | Vasantharaj |
| 3 | **Cancellation / refund policy**, with the gateway-fee cost modelled | Phase 2 legal pages, Phase 7 refunds | Vasantharaj |
| 4 | **Non-astrologer admin identity** — the four-eyes rule is void without one, and the contractor cannot be that person | Phase 3 | Vasantharaj |
| 4b | **Turn on `enforce_admins` on the `main` branch protection** the day Hungry Minds get repository access. Protection currently blocks collaborators but not admins — verified by pushing directly to main and watching it succeed with only a warning. CLAUDE.md §57/§59 are unenforced for admins until this is flipped | when the team joins | Vasantharaj |
| 5 | **Recruiting owner** — longest-lead item in the project, currently unowned | Phase 4 onward | Vasantharaj |
| 6 | **Does Razorpay accept the business category?** Astrology sits near their restricted list | Phase 7 — ask before building | Vasantharaj |
| 7 | **GST: is Stella principal or agent, and what goes on the invoice?** Determines the Phase 6 tax columns | Phase 6 migration | CA |
| 8 | **Chat or voice for first revenue?** Voice is the 100ms SDK; chat is a self-hosted WebSocket build. Entirely different work | Phase 8 scoping | Vasantharaj |
| 9 | **Content licence from ProKerala and AstrologyAPI** — may we store, cache and republish? Decides whether horoscope pages are cached files or live API calls | free-tools page architecture | Vasantharaj |
| 10 | Commission rate — related-party, fixed-rate field per restated ADR-019 | Phase 7 | CA |
| 11 | Is RazorpayX onboarded? Separate from the payments account. **Note: payout does not gate first revenue** — at roster 3 the payees are the directors, which is a bank transfer | post-revenue | Vasantharaj |
| 12 | Sentry covers Next.js only; the NestJS project is unprovisioned | Phase 1 task 1.12 | — |
| 13 | Authoritative director list, and Hoshangabad versus Narmadapuram | legal copy | Vasantharaj |
| 14 | Tablet navigation at 768px; and which zodiac glyph system is canonical — the logo uses Devanagari sign names, the hero uses Western glyphs | Phase 2; Kundli pages later | — |
| 15 | Can `stella_ltr_logo.png` be re-cut from a clean source, or does the typeset wordmark become permanent? | Phase 2 | Vasantharaj |
| 16 | Success criteria — straw values proposed (40 paid consultations, ≥25 distinct customers, ≥25% rebooking in 60 days, plus share of bookings naming a specific astrologer) | launch review | Vasantharaj |
| 17 | AI provider and budget — no AI credentials provisioned | post-revenue, content phase | Vasantharaj |
