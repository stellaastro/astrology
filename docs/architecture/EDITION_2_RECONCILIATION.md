# Edition 2.0 — reconciliation

**Date:** 2026-09-14 · **Decision:** ADR-033 · **Status:** Accepted

On 14 September 2026 a documentation package arrived: *Stella Architecture &
Delivery Blueprint, Edition 2.0* — eight Markdown files plus a 41-page PDF.

This document records what was adopted from it, what was not, and why. It exists
because Edition 2.0 is **newer than every ADR in the decision log**, which makes
it the single most likely thing to be mistaken for the current plan by someone
reading by date.

**Adopted:** the colour palette (ADR-034), the typography structure (ADR-035),
and the staged development-data approach (ADR-036).

**Not adopted:** everything else.

---

## 1. Where the current plan is ahead

| Dimension | Edition 2.0 | Here | Why |
|---|---|---|---|
| **Scale** | 10,000 accounts, ~1,000 concurrent, open marketplace | 3 astrologers (directors), 12–15 concurrent | Its own **H14** flags the figure as unvalidated and never resolves it. ADR-008 did. Every downstream sizing decision inherits the error |
| **Path to revenue** | Stage 1 Identity + KYC → Stage 2 first funded chat | Phase 2 public entry **unblocks Razorpay**; revenue at Phase 8 | Razorpay activation is the longest external wait and **requires a live public site**. Edition 2.0 parks it behind a full auth + KYC pipeline while the domain stays dark |
| **KYC** | Quarantine → scan → immutable promotion → reviewer streaming, *before revenue* | Manual admin creation, ≤12 astrologers | The design is excellent (§3). As a precondition to first revenue at roster 3 it is months of work protecting three directors from themselves |
| **Money model** | Wallet + double-entry ledger + holds + auto-recharge mandates | Razorpay per-booking, paid at booking (ADR-023) | A wallet **is stored value**, and its own **H07** makes stored value a legal dependency. Per-booking removes it from the critical path |
| **Billing** | Per-minute metering; **H03/H04** leave prorating, start/stop, pause, reconnect and chat-inactivity open | Slot-based (ADR-024) | Four unresolved money questions gate its first paid feature. Slot billing **dissolves all four by construction** rather than deferring them |
| **Applications** | Six — 3 Next.js + 3 React Native/Expo | One web app, role-guarded routes (ADR-022) | Six apps at roster 3. Native is deferred, not cancelled |
| **Realtime** | Agora | 100ms + a **Phase 1 mobile-browser spike** | It plans native apps, so it never tests browser WebRTC. Web-only rests entirely on that spike, which is why it is a gate and not an assumption |
| **Operations** | Redis + RabbitMQ + Docker | MySQL outbox + in-process scheduler; no Docker, no RabbitMQ | At 12–15 concurrent, RabbitMQ is an operational liability with no operator |

---

## 2. Nine things Edition 2.0 does not contain

Each is already an ADR, a task or working code here.

| Missing | Here |
|---|---|
| **Backups.** Names RPO ≤1h / RTO ≤4h as a target, says drills must demonstrate it, then specifies **no backup task, schedule, destination or restore rehearsal** in 41 pages | ADR-032, task 1.4, scripts written |
| **MySQL has no partial unique indexes.** Designs bookings and consultations without confronting it — the highest-risk schema detail in the project | ADR-029 |
| **Reschedule.** Never mentioned. The most common support request in every appointment business | task 6.6 |
| **Four-eyes on no-show and refund adjudication.** States the principle abstractly, never notices that at roster 3 the adjudicator *is* the astrologer | O5 + task 6.9 |
| **DPDP.** India's data protection act is never named; H15 is generic privacy. The obligation starts with the first lead stored | task 3.6 |
| **TRAI DLT registration.** Says "choose actual SMS senders" with no lead-time awareness — that lead time is why the waitlist is email-primary | task 2.1 |
| **Razorpay category risk.** Astrology sits near the restricted list. Never raised | O6 |
| **Enforced contrast.** Advises "test actual text/background pairs", then publishes **eight hex values and zero ratios** | `scripts/contrast-lint.mjs` |
| **Content economics.** Daily horoscope is 8,760 passages/year (buy); Kundli interpretation ~300 (own). Both vendors' republication licences unconfirmed | plan §7 |

---

## 3. What Edition 2.0 genuinely contributes

A comparison that only flatters the incumbent is not a comparison.

1. **The brand system.** Adopted — ADR-034 and ADR-035. Verified against the
   logo, where all six colours appear. It is **more logo-faithful** than what it
   replaced.
2. **`STORAGE_PLAN.md`'s KYC lifecycle is the best single document in the
   package.** Quarantine → scan → promote to an immutable key → verify the copy
   before marking ready; `document_access_events`; "issuing a link is not proof
   of every download"; rejecting a stale reviewer decision. **Retained verbatim
   as the Phase 9+ blueprint.** Nothing here supersedes it — it is not yet due.
3. **The three development modes** articulate the fixture boundary more clearly
   than ADR-026 did. Adopted as ADR-036.
4. **Storage adapter selects provider by file category** — a good seam, and a
   reminder that the R2 decision covered KYC only.

---

## 4. The audit discrepancy

Edition 2.0's `REPOSITORY_AUDIT.md` presents itself as the evidence base for the
whole package. It describes revision `c7873a961ecb2805fc44c5ec2cc537523c681bc9`
with ten service pages and working `/api/numerology` and `/api/tarot` endpoints,
and inventories Numerology and Tarot as **"Implemented"**.

**Verified on this machine, 2026-09-14:**

| Claim | Check | Result |
|---|---|---|
| revision `c7873a9…` | `git cat-file -t` | not in this history |
| `stella-services` tree | filesystem search | absent |
| source archive | filesystem search | absent |
| `/kundli`, `/tarot`, `/numerology` routes | directory search | absent |
| applications present | `ls apps/` | `customer-web` only |

**Conclusion.** Edition 2.0's audit chapter describes a different project. That
does not make the rest of the package worthless — the storage design and the
brand system stand on their own — but it means **its "current state" chapter
cannot be used as evidence about this repository.**

**Open action.** The owner holds a source archive and is sending it. When it
arrives, review before writing anything those pages already contain: the
numerology arithmetic, the tarot draw logic, and ten pages of service copy and
FAQs are plausibly reusable, and the copy alone is real writing time.

---

## 5. If you are reading this because you found Edition 2.0 first

Then it worked. Read **ADR-033**, then `CLAUDE.md`'s precedence block.

Short version: do not build a wallet, a per-minute metering timer, a second
application, or a KYC pipeline because Edition 2.0 asks for them. Three plan
reviews removed each one deliberately, and the reasons are recorded in the
decision log.
