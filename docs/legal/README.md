# Legal documents

Each policy is stored **at a version**, and `PolicyService.POLICIES` names the
version currently in force. A `PolicyAcceptance` row points at one of these, so
"what did they agree to" has an answer a year later.

**Never edit a version in place once it has been shown to anyone.** Add a new
file and bump the version. Editing in place makes every existing acceptance a
record of text that no longer exists.

| File | Policy key | Version | Status |
|---|---|---|---|
| `customer-terms-v1.md` | `terms` | v1 | **Draft — not publishable, see below** |

## Why v1 is not publishable yet

**Unfilled placeholders.** Effective Date, Last Updated, Grievance Officer name,
registered entity name, registered address, grievance email, support contact.
The IT Rules require a named grievance officer with contact details; the
Consumer Protection (E-Commerce) Rules require seller identity. A terms page
with `[Name]` in it is worse than no page.

**Three clauses describe a product this codebase does not build.** These are not
wording preferences — a terms document is a promise to a customer, and
describing billing that does not happen is a misdescription:

| Clause | Says | This product |
|---|---|---|
| §7, §9 | consultations charged **per minute**, on "billable duration" | **Slot-based.** A booked 30-minute slot bills for the slot (ADR-024). DESIGN.md §9 explicitly forbids advertising per-minute billing |
| §8 | a **prepaid wallet** customers top up | **No wallet, no ledger** (ADR-023). Razorpay per booking, paid at booking. A wallet is stored value and carries its own regulatory weight — three plan reviews removed it deliberately |
| §3 | registration by **mobile number / OTP** | **Google sign-in** (ADR-037). Phone OTP was dropped and Firebase with it |

Two more to settle before publication:

- **§10 chat consultations** are described. Chat versus voice is an open Phase 8
  blocker; only voice is being built.
- **§6 and §19 ratings and reviews** are described as shown on profiles. None
  exist, and §13 forbids inventing them — so the clause is fine as a future
  provision but nothing may render a rating until it derives from real data.

## What IS in force

The registration consent, exactly as the document specifies it:

1. **18+ and agreement to the Terms and Privacy Policy** — one checkbox.
2. **Consent to processing information provided for consultations** — separate.

**Recording consent is NOT collected here**, on the document's own instruction:
it is presented separately at or before each consultation. That is the
`RecordingConsent` model (ADR-048), a row per party per consultation.
