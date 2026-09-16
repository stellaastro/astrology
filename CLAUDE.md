# Stella Astrology

Astrology consultation marketplace for India. The business is **paid
consultation with named human astrologers**, booked into scheduled slots. Free
tools (Kundli, Panchang, horoscope) are the long-term acquisition channel but
are **deferred past first revenue** — see Phase, below.

Launch roster is **three astrologers, all company directors**. Most sizing
mistakes in the source documents come from assuming a roster that does not
exist.

## Source-of-truth precedence

Three planning documents disagree. Precedence is:

1. `docs/architecture/DECISION_LOG.md` — **read this first, it resolves the conflicts**
2. **Edition 2.0** (`Stella_Website_Apps_and_Services_Plan.pdf` + its eight
   Markdown files) — newest by date, and **mostly superseded**. See below.
3. `system_architecture.md` — Volume I
4. `rough_plan.txt` — master spec, oldest

Never resolve a contradiction between source docs on your own. Check the
decision log; if it is not covered there, ask.

### Edition 2.0 — read this before acting on it (ADR-033)

Dated 14 September 2026, so it *looks* current. **It plans a different, larger
product**, and its repository-audit chapter describes a codebase that is not in
this git history. Being newest does not make it authoritative.

| Edition 2.0 says | Reality here |
|---|---|
| Wallet + double-entry ledger | **No wallet, no ledger.** Razorpay per-booking (ADR-023) |
| Per-minute metering | **Slot-based billing** (ADR-024) |
| Six apps (3 web + 3 Expo) | **One web app**, role-guarded routes (ADR-022) |
| Agora · RabbitMQ · Docker · Redis | **100ms**; MySQL outbox; no RabbitMQ, no Docker |
| KYC pipeline before revenue | **Manual admin creation** at roster ≤12 |
| 10,000 accounts, ~1,000 concurrent | **~12–15 concurrent** (ADR-008) |

**Three things are adopted from it, and only three:** the colour palette
(ADR-034), the typography structure (ADR-035) and the staged development-data
approach (ADR-036). Its `STORAGE_PLAN.md` KYC lifecycle is kept as the **Phase 9+
blueprint** — good work, not yet due.

If you find yourself building a wallet, a metering timer or a second app because
Edition 2.0 asked for it: stop. Three plan reviews removed those deliberately.

## Settled decisions — do not re-litigate

Revised 2026-09-06 after three plan reviews. **Five rows changed.** If a source
document, an older ADR, or your own instinct disagrees with this table, the table
wins — check `DECISION_LOG.md` for the reasoning before proposing otherwise.

| Area | Decision |
|---|---|
| Palette | **Edition 2.0 brand system** (ADR-034): warm ivory `#FFF8E8` · lotus cream `#F4E1BA` · saffron gold `#D99A16` · terracotta `#A94424` · leaf green `#4E682A` · deep umber `#48251C`. Confirmed present in the logo. **No navy, no sapphire** (ADR-001) |
| Gold | Accent, rules and ornament **only**. Never text, never a CTA fill — measured **2.31:1** on ivory, so this binds *harder* than before. A CI contrast lint enforces it |
| CTA | Terracotta `#A94424` on ivory `#FFF8E8` (5.61:1). On lotus cream it is **4.61:1** — AA by 0.11, and the lint guards that pair |
| Type | **Serif display, sans body** (ADR-035): Cormorant Garamond (Latin headings) · Tiro Devanagari Hindi (Devanagari headings) · **Mukta** (all body and UI, covers both scripts). Inter still rejected — no Devanagari coverage |
| Dev data | **Fully synthetic roster** in dev and staging — astrologers, customers, bookings, KYC (ADR-036). Production public pages are **real or empty**, never invented practitioners |
| Auth | **Google sign-in for customers** (ADR-037) — phone OTP dropped, Firebase dropped with it. **Two admin identities** (ADR-038): `guruji@stellaastro.com` via Google, which carries Google's own 2FA and is the **preferred** route; `admin@stellaastro.com` password-only as **break-glass**. ADR-018's MFA requirement is still superseded, not met — the single-factor path stays open. Revisit before Phase 7. **Grant roles with `grant-role.ts`, never by hand-written SQL** — the CLI writes the audit row |
| Sessions | **Server-side rows**, not signed tokens (ADR-039). Revocation must be a lookup the server can change. The guard denies by default — a route is public only if it says `@Public()` |
| Backend | NestJS + TypeScript. Not FastAPI, not Pydantic |
| Web | Next.js (customer + admin). Admin is a role-guarded route group, not a separate app |
| Mobile | **Web-only for V1.** Flutter is deferred, not cancelled (ADR-022 supersedes ADR-007) |
| Payments | **Razorpay per-booking, paid at booking. No wallet, no ledger in V1** (ADR-023 supersedes ADR-006) |
| Billing | **Voice: slot-based** — a booked 30-minute slot bills for the slot (ADR-024). **Chat: per minute** (ADR-052, owner decision 2026-09-16), with the four metering questions answered explicitly in `billing/chat-billing.ts`: meter starts on the astrologer's first message, total rounded up **once**, silence charged only to 2 minutes, a <90s drop does not stop it. **A chat booking MUST have a maximum duration** — per-minute cannot be collected at booking, and with no wallet the only route is authorise-the-cap-then-capture-the-actual, which needs a number. `bookings.price_paise` is the charge for voice and the **authorised ceiling** for chat; `captured_paise` is what was taken |
| Modality | **Scheduled appointments, voice AND chat** (ADR-051, owner decision 2026-09-15). Chat is a **named human astrologer** in a chat-style UI — never a bot; `ChatMessage.sender` admits only `astrologer`/`customer`. Charged **per session like voice**, reusing the booking and slot model: per-message bundles would be the wallet ADR-023 removed, per-minute the metering ADR-024 removed. A chat transcript carries the **same retention, review and erasure** obligations as an audio recording. On-demand still sits behind a ≥3-on-duty coverage gate (ADR-021) |
| Astrology | ProKerala via `AstrologyProvider` interface. Internal engine is a later swap |
| Realtime | **100ms via `RealtimeProvider`** (ADR-047). Not Agora. **A room per consultation, never a shared one** — one room puts two concurrent consultations in the same call. Tokens minted server-side per request; the app secret never reaches a browser. Credentials are `HMS_*` in env, not `100MS_*`: a variable name cannot begin with a digit. **Mobile-browser WebRTC is still untested — task 1.5 needs real handsets on Indian 4G and the whole web-only bet rests on it** |
| Storage | Cloudflare R2, S3-compatible, private buckets + signed URLs only. **One bucket per job, isolated at the provider, never by prefix** (ADR-042): `stella-kyc` (real KYC, nothing else) · `stella-kyc-dev` (synthetic, every file marked SAMPLE/NOT VALID) · `stella-backups` (dumps, binlogs, encrypted secrets). Two prefixes in one bucket share a blast radius; buckets do not. **Do not add a bucket without adding it to `docs/architecture/R2_BUCKETS.md` first, with a stated purpose** |
| Recording | **Reversed by the owner 2026-09-15 (ADR-048): audio consultations ARE recorded**, kept 30 days in `stella-recordings` (R2-enforced expiry), screened and assessed. **Blocked on two owner decisions before anything records:** the consent wording (a recording without consent is a liability, not an asset — DPDP), and who reviews a flagged call, since at roster 3 the astrologer assessed is also the only available reviewer. **A machine output is a flag for a human, never a finding delivered to the astrologer** |
| Locale | Auto-detect, Hindi default in India. **Legal pages stay English** — machine-translated disclosure text is worse than English |
| Scale | **~12–15 concurrent consultations.** Launch roster is 3, soft-launch gate is 8–12. The old ~50 figure was sized to a roster that does not exist (ADR-008 corrected) |

## Hard rules

- **Secrets never enter the repo.** Real values live in `/home/stellaastro/secrets/config.txt` (mode 600, outside the docroot). Use `.env`; update `.env.example` with placeholders only.
- **Never touch live financial credentials.** Rotation is done by Stella personnel.
- Server is authoritative for payment success, booking state, commission, payout, KYC status and permissions. Never trust the client (§78).
- Financial history is immutable. **V1 has no ledger** (ADR-023), but booking rows carry a **price snapshot and tax columns frozen at creation** — never recompute or edit them after payment (§79).
- **Never gate content visibility on a scroll animation.** Animate transform, never opacity — an unadvanced `animation-timeline` leaves content permanently invisible (ADR-025).
- **MySQL has no partial unique indexes.** Slot uniqueness uses a generated column that is NULL when the row is not slot-occupying (ADR-029).
- AI never computes planetary positions. It interprets structured output only (§15, §32).
- No mock astrologers, mock balances, fake payment success or fake calculations outside explicit dev adapters (§71).
- **Fake data, real everything else** (ADR-036). Dev and staging run on a fully synthetic roster — that is intended. What must stay real in every environment: the database, authorization, constraints, the state machine, the arithmetic and the API contract. **A screen driven by a fixture is never evidence that the integration works.** Sandbox webhooks get the same signature verification as live ones. Provider failure surfaces as an error or a pending state — never as a fake success.
- **Never send an OTP, SMS or email to an invented number or address.** Invented numbers belong to real people. Use owned test accounts, provider test destinations or a local sink. The directors' real mobile numbers must never become test recipients.
- No invented user counts, ratings or testimonials on the landing page (§13).
- **Personal data never enters the audit log.** It is append-only, so anything
  written there can never be erased — which would make DPDP erasure impossible
  and "we deleted your data" false. Audit the actor, the action and the target's
  ULID; never the email, phone or a hash of either (ADR-040). `leads.service`
  and `privacy.service` both have tests that fail if it comes back.
- Migrations for every schema change. Never alter schema silently.
- Feature work goes on `feature/*` branches, never straight to `main` (§57).
- Financial, security, KYC and astrology-engine code needs review before landing (§59).

## Phase

**Phase 5 — availability. NOT complete: 5.1 is API-only, 5.3 is open.**
Phase 6 has its schema and nothing else. Build order:

```
1 Foundation → 2 Public entry (unblocks Razorpay) → 3 Identity →
4 Astrologers → 5 Availability → 6 Booking → 7 Payments →
8 Consultation = FIRST REVENUE
```

**Done:** Phase 1 in full. Phase 2's landing page (six sections), waitlist
endpoint, double opt-in with a real confirmation email, `/confirm`, navigation
with a mobile sticky bar, and the accessibility pass. The site is live and the
waitlist works end to end.

**Phase 3 in full:** server-side sessions and a deny-by-default guard (ADR-039),
Google sign-in (ADR-037), two admin identities (ADR-038), the audited admin lead
read and CSV export, **DPDP access and erasure** (ADR-040) and **enforced data
retention** (ADR-041). 3.1 and 3.4 (Firebase OTP and its rate limiting) are
**moot, not skipped** — phone OTP was dropped with Firebase in ADR-037.

**Phase 4 so far (ADR-043):** the `Astrologer` model, admin create/update/
publish endpoints, a public roster that is real-or-empty, and the 20-strong
synthetic roster (task 1.9 as widened). Profiles are **admin-created and draft
by default** — publishing is a separate, audited decision.

**4.2 and 4.3 done (ADR-044).** The three directors are real rows and the
landing page reads them from the database. `/astrologer` is the practitioner's
own surface; an admin links a profile to a signed-in account, which grants the
`astrologer` role.

**4.2's three named deliverables are NOT built and that is deliberate** — the
availability editor is Phase 5, upcoming bookings Phase 6, the join link Phase
8. None of those models exists yet, and the page says so rather than showing
controls that do nothing.

**Still open in Phase 4:**

- **4.4** recruiting. Not engineering; owner action per O5.
- **O3 still blocks the detail.** The directors are named and published, but
  their experience, credentials, specialisations, photographs and per-session
  price are absent — deliberately null, not zero. Until the price exists they
  are **publishable but not bookable**, which is a real state the model now
  carries. Add them through `/admin/astrologers`.

**Availability (ADR-045):** weekly rules are **IST wall-clock**, blocks are
**UTC instants**, and the difference is load-bearing. The inter-slot buffer
widens the stride, never the session — billing is per slot, so a buffer that
lengthened the session would overcharge. Overlapping windows are refused in the
service because MySQL has no exclusion constraints.

### Phase 5 status — audited 2026-09-16, NOT complete

| | State |
|---|---|
| **5.1** weekly grid + blocks | **API done, NO UI.** `/astrologer` still says availability is "being built", so a practitioner cannot set their own hours — only an admin can, by calling the endpoint. This is also 4.2's deferred "availability editor" |
| **5.2** inter-slot buffers | **Done** |
| **5.3** shrink must not orphan paid bookings | **NOT done, and NO LONGER BLOCKED.** It was deferred because no booking model existed; one does now. `availability.service` mentions bookings only in comments — `replaceRules` and `addBlock` will happily delete the hours a paid booking sits in |

### Phase 6 status — schema only

6.1–6.5 are the schema and are done and verified (generated column, durable
hold columns, idempotency key, price snapshot and tax columns, UTC slots).
**There is no bookings module, no service and no endpoint** — nothing can
create a booking. 6.6 reschedule, 6.7 overrun policy, 6.8 no-show detector and
6.10 the reaper are all unbuilt. 6.9's four-eyes exists only for *abuse review*
(ADR-049), not for no-show or refund adjudication. 6.11 waits on TRAI DLT.

**The rate column is the CURRENT rate only.** Phase 6 bookings freeze their own
price snapshot; never read a past booking's price back through
`astrologers.session_rate_paise` (§79).

**Still open in Phase 2:**

- **2.8 legal pages — customer Terms SUPPLIED 2026-09-15**, stored at
  `docs/legal/customer-terms-v1.md`. **Still not publishable.** The placeholders
  are unfilled (effective date, grievance officer, entity name, registered
  address, grievance email) and the IT Rules require a named grievance officer.
  **Three clauses describe a product this codebase does not build** — §7/§9
  per-minute billing (ADR-024 is slot-based), §8 a prepaid wallet (ADR-023 has
  none), §3 mobile/OTP registration (ADR-037 is Google sign-in). A terms page is
  a promise to a customer; describing billing that does not happen is a
  misdescription. See `docs/legal/README.md`. Still needs GSTIN and the O4
  refund policy.
- 2.14 referral codes · 2.15 a real transactional email provider · 2.16 signup
  counters. All P2.

**Two open decisions recorded elsewhere, repeated here because they are easy to
miss:**

1. **How long confirmed leads are kept is unanswered** — the retention mechanism
   ships switched off for them, deliberately, because deleting someone who asked
   to hear when bookings open would silently break the waitlist's only promise
   (ADR-041). Owner decision; `RETENTION_CONFIRMED_LEAD_DAYS` turns it on.
2. **The audit log is documented as append-only but nothing enforces it** — no
   triggers, no grant restrictions. Code never updates or deletes it, so the
   property holds by convention only.

**The review server (:8434) now has its own API and database.** It runs the
synthetic roster against `stellaastro_dev` via `stella-api-dev` on port 4001.
Until 2026-09-15 it proxied to the production API, so it showed production data
and **any form submitted there wrote to production**. See
`docs/REVIEW_SERVER.md`.

**Three operational facts that bite:**

1. **Deploying the web app means building a NEW release directory** and pointing
   `NEXT_DIST_DIR` at it in the `stella-web` systemd drop-in. Building
   `.next-prod` alone changes nothing that is served.
2. **The API's production environment comes from
   `/home/stellaastro/secrets/api.production.env`**, not the repo `.env` — which
   is the development default and points at `stellaastro_dev`. See
   `infrastructure/api-production/README.md`.

3. **MIGRATE BEFORE YOU RESTART.** Restarting the API with a build whose schema
   is ahead of the database took production down for two minutes on 2026-09-15:
   Prisma threw P2022 on a missing column and the service crash-looped behind a
   502. `MigrationGuard` now refuses to boot and names the pending migrations,
   but the order is still migrate → build → restart.

Free tools (Kundli, horoscope, panchang) are **deferred past first revenue** —
they are acquisition infrastructure for a scale that does not exist at roster 3.

Full plan: `/root/.claude/plans/sparkling-greeting-acorn.md`.

# gstack

For all web browsing, use the `/browse` skill from gstack. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.
