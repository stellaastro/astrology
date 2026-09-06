# Stella Astrology

Astrology consultation marketplace for India. The business is **paid
consultation with named human astrologers**, booked into scheduled slots. Free
tools (Kundli, Panchang, horoscope) are the long-term acquisition channel but
are **deferred past first revenue** — see Phase, below.

Launch roster is **three astrologers, all company directors**. Most sizing
mistakes in the source documents come from assuming a roster that does not
exist.

## Source-of-truth precedence

Two planning documents disagree in sixteen places. Precedence is:

1. `docs/architecture/DECISION_LOG.md` — **read this first, it resolves the conflicts**
2. `system_architecture.md` — Volume I, newer
3. `rough_plan.txt` — master spec, oldest

Never resolve a contradiction between the two source docs on your own. Check
the decision log; if it is not covered there, ask.

## Settled decisions — do not re-litigate

Revised 2026-09-06 after three plan reviews. **Five rows changed.** If a source
document, an older ADR, or your own instinct disagrees with this table, the table
wins — check `DECISION_LOG.md` for the reasoning before proposing otherwise.

| Area | Decision |
|---|---|
| Palette | Ivory & Gold from the logo. **No navy, no sapphire** — the spec's blue direction is void (ADR-001) |
| Gold | Accent, rules and ornament **only**. Never text, never a CTA fill — measured 2.96:1 on ivory. A CI contrast lint enforces this |
| CTA | Bronze `#904000` on ivory `#F7F1E3` (6.4:1) |
| Type | **Tiro Devanagari Hindi + Cormorant Garamond.** Two families. Inter is rejected — no Devanagari coverage (ADR-025) |
| Backend | NestJS + TypeScript. Not FastAPI, not Pydantic |
| Web | Next.js (customer + admin). Admin is a role-guarded route group, not a separate app |
| Mobile | **Web-only for V1.** Flutter is deferred, not cancelled (ADR-022 supersedes ADR-007) |
| Payments | **Razorpay per-booking, paid at booking. No wallet, no ledger in V1** (ADR-023 supersedes ADR-006) |
| Billing | **Slot-based, not per-minute.** A booked 30-minute slot bills for the slot (ADR-024) |
| Modality | **Scheduled appointments.** On-demand sits behind a ≥3-on-duty coverage gate (ADR-021) |
| Astrology | ProKerala via `AstrologyProvider` interface. Internal engine is a later swap |
| Realtime | 100ms via `RealtimeProvider`. Not Agora. **Web SDK — mobile-browser WebRTC is untested and spiked in Phase 1** |
| Storage | Cloudflare R2, S3-compatible, private buckets + signed URLs only |
| Recording | Off in V1; seam retained |
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
- No invented user counts, ratings or testimonials on the landing page (§13).
- Migrations for every schema change. Never alter schema silently.
- Feature work goes on `feature/*` branches, never straight to `main` (§57).
- Financial, security, KYC and astrology-engine code needs review before landing (§59).

## Phase

**Phase 0 — documentation, in progress.** The plan is approved. Build order:

```
1 Foundation → 2 Public entry (unblocks Razorpay) → 3 Identity →
4 Astrologers → 5 Availability → 6 Booking → 7 Payments →
8 Consultation = FIRST REVENUE
```

Two things to know before touching anything:

1. **Six owner actions block everything**, none of them engineering — credential
   rotation, the paying-clients question, directors' photos and pricing, the
   refund policy, a non-astrologer admin, and two outside questions (Razorpay
   category, GST principal-versus-agent). See §1 of the plan.
2. **In Phase 2 the three astrologers are static page content, not database
   rows.** They become real rows in Phase 4. Do not build a schema for them
   early.

Free tools (Kundli, horoscope, panchang) are **deferred past first revenue** —
they are acquisition infrastructure for a scale that does not exist at roster 3.

Full plan: `/root/.claude/plans/sparkling-greeting-acorn.md`.

# gstack

For all web browsing, use the `/browse` skill from gstack. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.
