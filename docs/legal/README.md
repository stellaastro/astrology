# Legal documents

Each policy is stored **at a version**, and `PolicyService.POLICIES` names the
version currently in force. A `PolicyAcceptance` row points at one of these, so
"what did they agree to" has an answer a year later.

**Never edit a version in place once it has been shown to anyone.** Add a new
file and bump the version. Editing in place makes every existing acceptance a
record of text that no longer exists.

| File | Policy key | Version | Status |
|---|---|---|---|
| `customer-terms-v1.md` | `terms` | v1 | Superseded by v2. Kept — never delete a version anyone may have accepted |
| `customer-terms-v2.md` | `terms` | v2 | **Draft — amended to match built behaviour. Needs legal review** |

## What v2 changed, and why

v1 promised three things the platform does not do. A terms document is a
promise to a customer, so describing billing that does not happen is a
misdescription rather than a wording preference.

| Clause | v1 said | v2 says | Matches |
|---|---|---|---|
| §1 | six services including chat, reports, compatibility | scheduled **voice consultations**; others "may be introduced" | only voice is built |
| §3 | mobile number, **OTP** | **Google Sign-In**, no password held by STELLA | ADR-037; customer rows carry `passwordHash: null` |
| §7 | **per-minute**, on connected duration | **by the appointment** — and says plainly that ending early is not refunded on that basis | ADR-024; `bookings.price_paise` is frozen at booking |
| §8 | a **prepaid wallet** to load and maintain | **no wallet, no held funds**; paid in full at booking | ADR-023 |
| §9 | duration "used for calculating charges" | same records kept, but **explicitly not what determines the charge** — they exist for attendance and disputes | `consultations.astrologer_joined_at` / `customer_joined_at` |
| §10 | chat billed by time or message | **chat is not currently offered** | chat vs voice is an open Phase 8 decision |
| §18 | refunds "to original method **or wallet**" | original method only | no wallet exists |
| §32.5–7 | wallet balance; recording "where disclosed" | appointment pricing; recording consent **asked separately** | `RecordingConsent`, ADR-048 |

Also corrected: the preamble ("adding money to your wallet"), §14 ("wallet
activity") and §21 ("OTP authentication"), which carried the same assumptions.

**v2 is not legal advice.** It was written by engineering to remove
misdescriptions. A lawyer must review it.

## Two clauses describe behaviour that is BUILT BUT NOT YET LIVE

§7 and §8 describe payment at booking. The booking schema exists; **payments are
Phase 7 and not implemented**. That is fine only because the site is not taking
bookings — the Terms go live with the product, not before it.

## Still unfilled in v2

**Unfilled placeholders**, still. Effective Date, Last Updated, Grievance
Officer name, registered entity name, registered address, grievance email,
support contact. The IT Rules require a named grievance officer with contact
details; the Consumer Protection (E-Commerce) Rules require seller identity. A
terms page with `[Name]` in it is worse than no page.

**§6 and §19 ratings and reviews** are described as shown on profiles. None
exist. The clauses are permissive ("may display"), so they are not false — but
nothing may render a rating until it derives from real data (§13).

**The O4 refund policy and the GSTIN** are still outstanding.

## What IS in force

The registration consent, exactly as the document specifies it:

1. **18+ and agreement to the Terms and Privacy Policy** — one checkbox.
2. **Consent to processing information provided for consultations** — separate.

**Recording consent is NOT collected here**, on the document's own instruction:
it is presented separately at or before each consultation. That is the
`RecordingConsent` model (ADR-048), a row per party per consultation.
