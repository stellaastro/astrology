# Implementation Plan

**Status:** Approved 2026-09-06
**Required by:** `rough_plan.txt` §81 — no building until the audit and this plan
are approved. The audit is `REPOSITORY_AUDIT.md`; the decisions are
`DECISION_LOG.md` (32 ADRs).

**Team:** Hungry Minds (Basti) building, one technical lead overseeing.
**Reality:** three astrologers, all company directors. Zero source files today.
**Model:** scheduled appointments · web-only · Razorpay per-booking · **paid at
booking** · slot-based pricing. No wallet, no ledger, no metering, no native apps.

---

## Read this first

This plan is the output of three reviews (`/plan-ceo-review`,
`/plan-eng-review`, `/plan-design-review`), each with an adversarial second
reviewer. Twenty-nine decisions changed; eight reversed a choice made earlier the
same day and two corrected outright errors. The plan is materially **smaller**
than the source documents describe.

Three things a newcomer gets wrong if nobody says them:

1. **Six owner actions block everything, and none are engineering.** See §1.
2. **In Phase 2 the three astrologers are static page content, not database
   rows.** They become rows in Phase 4. Do not build a schema for them early.
3. **Free tools are deferred past first revenue.** Kundli, horoscope and panchang
   are acquisition infrastructure for a scale that does not exist at roster 3.

---

## 1. Blocking owner actions

| # | Action | Blocks |
|---|---|---|
| **O1** | Rotate exposed credentials; review provider activity logs | everything touching money |
| **O2** | Do the directors have paying clients today? | a "no" reshapes the plan |
| **O3** | Photographs, credentials, experience, specialisations, per-session price | Phase 2 → Razorpay activation |
| **O4** | Cancellation / refund policy, gateway fee modelled | Phase 2 legal, Phase 7 refunds |
| **O5** | Name a non-astrologer admin, and a recruiting owner | Phase 3, Phase 4 |
| **O6** | Razorpay business category; GST principal-versus-agent | Phase 6 schema, Phase 7 |

### The critical path is not engineering

```
O3 photos + credentials ─┐
O3 per-session price      ├──▶ Phase 2 landing + legal LIVE
O4 refund policy         ─┘              │
                                         ▼
                            Razorpay merchant submission
                                         │ weeks, external
                                         ▼
                                   activation ──▶ Phase 7 payments
```

Engineering cannot shorten this. It starts the day the photographs arrive.

---

## 2. Build order

```
1  Foundation      monorepo · CI · envs · git+GitHub · systemd · nginx /api
                   backups · dev seeds · SPIKE: 100ms in a mobile browser
                   substrate: integer-paise Money · append-only audit ·
                   idempotency keys · delayed-job scheduler ·
                   transactional outbox · OpenAPI-from-DTOs lint
2  Public entry    landing + legal + waitlist       → UNBLOCKS RAZORPAY
                   no auth. Astrologers are STATIC page content.
3  Identity        Firebase OTP · roles · server-side sessions · step-up MFA
                   + the audited admin lead read deferred from Phase 2
4  Astrologers     profiles (admin-created) + astrologer routes in admin-web
                   [START RECRUITING — longest-lead item in the project]
5  Availability    weekly grid · manual blocks · inter-slot buffers
6  Booking         slot reservation · reschedule · no-show · reminders
                   schema carries price AND tax columns from this migration
7  Payments        Razorpay per-booking · tax computation · webhooks · refunds
8  Consultation    100ms web SDK                    = FIRST REVENUE
──────────────────────────────────────────────────────────────────────
THEN  Kundli · horoscope · panchang · wallet + ledger · KYC automation ·
      discovery · native apps · trust & safety
```

**Why public entry precedes identity.** Only the admin *read* of leads needs an
audit actor; the public *write* needs no auth. Identity-first parked Razorpay
activation — the longest external wait — behind an entire auth system while the
domain stayed dark (ADR-027).

**Security hardening and performance are per-slice exit criteria, not phases,**
plus one pentest before beta. Two exceptions move early: OTP rate limiting lands
in Phase 3 (unthrottled OTP is a *billing* DoS, and India leads SMS-pumping
fraud), and DPDP rights endpoints land in Phase 3 because the obligation starts
with the first lead stored in Phase 2.

---

## 3. Phase gates

A phase is done when its P1 tasks pass and its exit criteria hold.

| Phase | Exit criteria |
|---|---|
| 1 | CI red on a deliberately broken gate · a restore from R2 diffs clean · the 100ms mobile spike has a verdict |
| 2 | `www.stellaastro.com` returns 200 · a lead round-trips to MySQL · duplicate submission is byte-identical · Razorpay submission filed |
| 3 | Admin read writes an audit event with a real actor · disabling a Firebase user kills the live session |
| 4 | Three real astrologer rows · an astrologer can log in and see their own page |
| 5 | An astrologer sets their own week without a developer |
| 6 | Book → cancel → rebook the same slot succeeds · double-submit yields one booking |
| 7 | A real ₹10 payment settles and reconciles · a refund completes |
| 8 | A paid consultation completes end to end on a real handset |

---

## 4. Parallel lanes

```
Lane A  git/GitHub/branch protection → CI gates → systemd/deploy      infra
Lane B  design tokens → landing UI → legal pages                      frontend
Lane C  Prisma schema → leads endpoint → error paths                  backend
Lane D  100ms mobile-browser spike                                    independent
```

All four start together. B and C converge at the waitlist form and touch
`packages/design-system` only through tokens, so conflict risk is low. **D gates
nothing in Phases 1–3 but gates the entire web-only bet**, so start it first.

---

## 5. Lead-time items — external, start immediately

Razorpay merchant onboarding *(needs the live site from Phase 2)* · confirm
Razorpay accepts the category · transactional email provider + SPF/DKIM/DMARC
warm-up · TRAI DLT registration *(delegable)* · directors' photos and credentials
*(delegable, gates Phase 2)* · Cloudflare R2 account (`S3_ENDPOINT` is blank) ·
`staging.stellaastro.com` DNS + certificate · secrets manager to replace the
plaintext interim · CA answer on GST · written content-licence answers from
ProKerala and AstrologyAPI · directors' interpretation corpora.

Several of these take longer than the phases they gate. None are engineering.

---

## 6. Staged beta

| Stage | Roster | Users | Gate to exit |
|---|---|---|---|
| 0 internal | 3 | ~10 | 25 completed bookings · every state exercised including failure paths · **zero manual database corrections** · 7 clean reconciliation days. **Real money at small denominations** — test mode never exercises settlement or bank timing |
| 1 closed | 3 | 30–50 | appointment-only · refund, dispute and no-show rates · does anyone rebook? |
| **roster gate** | **8–12 non-director** | | recruiting started at Phase 4 |
| 2 | 8–12 | | first real four-eyes KYC · first third-party payout |
| 3 soft launch | | | on-demand enabled per coverage rule · one language, one metro |

---

## 7. What is deliberately not being built

Kundli, horoscope, panchang, muhurta *(after first revenue)* · wallet and ledger
*(per-booking avoids the CA dependency — ADR-023)* · Flutter apps *(web-only V1 —
ADR-022)* · discovery, filtering, ranking *(scale complexity at roster 3)* · KYC
automation *(manual creation covers ≤12)* · commission rules engine *(fixed-rate
field)* · WhatsApp *(Meta approval lead time; SMS reminders are the compensating
control)* · call recording *(seam retained)* · post-consultation summaries
*(schema fields reserved so no later migration touches immutable history)* ·
on-demand matching *(behind a roster-coverage gate)* · Docker · RabbitMQ.

Each of these has a recorded reason. None were dropped for convenience.

---

## 8. Success criteria — straw values, owner to confirm

Within 60 days of launch: **40 paid consultations, from ≥25 distinct customers,
with ≥25% booking a second time.** Below that, stop and revisit the premise
rather than building the next phase.

Plus one metric that tests the positioning rather than the mechanics: **the share
of first bookings that name a specific astrologer** versus taking any available
slot. The revenue numbers above would be satisfied by any working positioning, so
they do not test the named-astrologer hypothesis at all.

---

## 9. Task detail

The full task list — 60 numbered tasks with priorities, the review that surfaced
each, and the one-line reason it exists — lives in the working plan at
`/root/.claude/plans/sparkling-greeting-acorn.md` §5.

Traceability: each task carries a `(ceo)`, `(eng)` or `(design)` tag so a reader
can see which review produced it without reading three transcripts.
