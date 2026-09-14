# Development data plan

**Date:** 2026-09-14 · **Decision:** ADR-036 (extends ADR-026) · **Status:** Accepted

Adapted from Edition 2.0's `DEVELOPMENT_DATA_PLAN.md`, one of three things
adopted from that package (see `EDITION_2_RECONCILIATION.md`).

---

## The rule

> **Fake data, real everything else.**
>
> The records are synthetic. The database, the authorization, the constraints,
> the state machine, the arithmetic and the API contract are genuine.
>
> **A screen powered by a fixture is never evidence that the integration works.**

`CLAUDE.md` §71 forbids mock astrologers, balances, payment success and
calculations **outside explicit dev adapters**. Nothing here relaxes that. This
document defines what "inside a dev adapter" means and where the edge is.

---

## Build against a fully synthetic roster

**Owner's direction, 2026-09-14.** Set the three directors' real data aside.
Build the entire product against dummy astrologers, customers, bookings,
consultations, payments and KYC.

**What it unblocks.** O3 — photographs, credentials, experience, specialisations
and per-session price — had gated Phase 4 onward and has not arrived. With a
synthetic roster, Phases 4–8 proceed at full speed and the real three are entered
through the same admin screens at launch, **as data rather than code**. O3 now
gates only the public page, and therefore Razorpay.

**It is also better for privacy.** The directors' real names and mobile numbers
never enter a development database, a seed file, or a test recipient list.

**Scope: ~20 dummy astrologers.** Three is too few to surface availability
collisions, scheduling conflicts, admin queue behaviour or the no-show path —
those bugs only appear at volume. Vary languages, specialisations and rates.

**Seed the failures too**, as first-class fixtures, not afterthoughts: no
astrologer available · insufficient funds · payment failed · duplicate webhook ·
rejected KYC · scanner unavailable · astrologer cancellation · dropped call ·
unauthorized access · worker restart. Include empty and loading states, not just
populated dashboards.

---

## The one boundary

**Dev and staging are 100% synthetic. `www.stellaastro.com` in production is real
or empty.**

A fake astrologer profile on a registered company's live paid-consultation site
means a customer can attempt to book a person who does not exist. §13 and §71
both forbid it. `images/icon_images/chead-*.jpg` ship with **baked-in five-star
rating badges** — the failure arriving pre-made.

The holding page already handles this correctly: real names, and placeholder
dashes (`— वर्ष`, `₹— / 30 मिनट`) where owner data is missing. Those read as
errors because they *are* blocked inputs, which is honest.

Enforced by the `is_dev_fixture` boot guard (ADR-026), which refuses to serve
when fixture rows are present under a non-development profile. Downtime beats
fake data on a live site.

---

## Three modes

| Mode | Data | Services | When |
|---|---|---|---|
| **1 · Interface demo** | Deterministic fixtures, visibly labelled | Mock adapters | Building screens before a backend slice exists |
| **2 · Integrated dev** | Synthetic rows in **real MySQL**, synthetic documents in a **private R2 dev bucket** | Real authorization, constraints and state transitions; **provider sandboxes** | **The default for every phase** |
| **3 · Staging rehearsal** | Synthetic, release configuration | Controlled provider sessions, approved test accounts | Phase exit, before anything goes live |

Mode 1 is a temporary scaffold, not a destination. **Phase exit requires mode 2
or mode 3 evidence — never mode 1.**

---

## Controls

### 1. Dataset IDs

Every synthetic row carries a dataset ID so cleanup deletes only its own records
and can never reach a real one. Stable fixture IDs and deterministic timestamps,
so scenarios reproduce.

### 2. Production refuses mock adapters

Not "should not be configured" — the API **fails to boot** under a production
profile when a mock payment, identity or consultation provider is selected. Same
posture as the fixture guard.

### 3. Synthetic KYC

Files read **`SAMPLE / NOT VALID`** visibly, contain no real personal data, and
live in a **separate private R2 dev bucket** — not `stella-backups` — under its
own scoped token. A backup script has no business reading identity documents, and
a KYC token has no business reading backups.

**Never copy a real person's document into development.**

### 4. Sandbox callbacks get live rigour

Signature verification, deduplication and replay protection apply to sandbox
webhooks exactly as to live ones. **A sandbox webhook trusted because it is "only
a test" is how the live one gets trusted too.** Repeated callbacks must not
double-apply.

### 5. Recipient safety

**Never send an OTP, SMS or email to an invented number or address.** Invented
numbers belong to real people. Use owned test accounts, provider test
destinations, or a local sink.

This is live today: the directors' real mobile numbers are in the build plan and
must never become test recipients.

### 6. Arithmetic is tested against known results

Billing, tax and commission are verified against **hand-computed expected
values**, never against whatever the code currently returns. Integer paise, the
agreed rounding rule, the tax split — each with a fixture whose expected value
was worked out independently. `services/api/src/common/money.spec.ts` is the
pattern.

### 7. Simulated sessions are not evidence

Mock call and chat states are **acceptable for building screens and forbidden as
proof**. Phase 8 does not pass until it has run against real 100ms, on a real
handset, per the Phase 1 spike. Record this as an explicit exit criterion so a
working mock is never mistaken for a working feature.

### 8. Failure surfaces honestly

A sandbox or provider outage produces an error or a pending state. **It must
never fall through to a fake success.** This is §71 at its most load-bearing,
because it sits on the money path.

---

## Astrology calculations (post-revenue)

Whenever the engine lands: reference cases approved by a named astrologer, with
numeric tolerances **agreed before** results are compared. Chart and calendar
fixtures are for layout only — a fabricated Panchang must never be shown as the
real timings for a real city and date.

---

## Verification

| Control | How it is proven |
|---|---|
| Mock refusal | Boot under a production profile with a mock provider — **must fail to start** |
| Fixture containment | `npm run gate:fixtures`; then add a seed row without a dataset ID and confirm failure |
| Public boundary | Load the landing page against a seeded database — **only the three real directors may appear** |
| Boot guard | `APP_ENV=production` with fixture rows present — API refuses to serve |
| Webhook rigour | Replay a sandbox webhook twice → one effect; send a bad signature → rejected |

A guard nobody has watched refuse is not a guard.
