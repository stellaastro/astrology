# Data retention policy

**Status:** in force · **Adopted:** 2026-09-15 (ADR-041) · **Owner:** Vasantharaj

Enforced by `RetentionService` and run daily at 04:00 IST by the scheduler.
Every horizon below is overridable by environment variable, but **the defaults
in the code are the policy** — a policy that only exists in a config file
nobody has set is not a policy.

## What is held, and for how long

| Data | Horizon | Variable | Why |
|---|---|---|---|
| **Unconfirmed lead** | **30 days** | `RETENTION_UNCONFIRMED_LEAD_DAYS` | They never confirmed the address, so consent was never verified, and they are uncontactable by design (ADR-028). Holding an unverified address indefinitely has no purpose to point at |
| **Confirmed lead** | **no automatic deletion** | `RETENTION_CONFIRMED_LEAD_DAYS` | **Deliberately unset — see below** |
| **Delivered outbox message** | **30 days** | `RETENTION_DELIVERED_OUTBOX_DAYS` | Payloads carry the recipient's address. Without this the outbox quietly becomes the longest-lived copy of everyone's address in the system |
| **Spent/expired privacy request** | **7 days** | `RETENTION_PRIVACY_REQUEST_DAYS` | It names a lead and serves no further purpose once used. The audit event is the durable record that a request was made |
| **Audit event** | **never deleted** | — | Append-only. It holds no personal data — see below |

**Development fixtures are never reaped**, at any horizon. A seed row is not
anyone's personal data, and silently deleting the synthetic roster mid-phase
would look like a bug in whatever phase was using it.

## The one horizon that is deliberately absent

**Confirmed leads have no default expiry, and that is a decision rather than an
oversight.** Someone who confirmed their address asked to be told when bookings
open. Deleting them at an arbitrary twelve or twenty-four months would silently
break the only promise the waitlist makes, and the person would never know why
the email never came.

How long that promise lasts is a business and legal question, not an
engineering one. **This is an owner decision** and it should be made before the
waitlist has been open long enough for the answer to matter. The mechanism is
built, tested and switched off; setting `RETENTION_CONFIRMED_LEAD_DAYS`
enables it with no code change.

## Why the audit log is exempt

The audit log is append-only, so anything written to it cannot be erased. That
is in direct tension with the right to erasure — and the tension is resolved at
the source rather than by exception: **the audit log holds no personal data.**

A lead's audit events record the action, the time, the actor's IP and the
lead's ULID. They do not record the address, and `leads.service` has a test
that fails if anyone puts it back. So erasing the lead row genuinely erases the
person, and the audit trail still proves what happened and when.

Until 2026-09-15 this was not true: `lead.create` wrote the signup address into
the event. That made complete erasure impossible and it was fixed as part of
ADR-040. Eleven audit rows written before the fix still carry addresses; all
eleven are `@stellaastro.com` verification accounts on the company's own
domain, and none belongs to a member of the public.

## What a purge does not cover

- **Backups.** A restore from a nightly dump re-introduces rows deleted since
  that dump. Erasure requests completed since the most recent restore point
  must be re-applied after any restore — this is in the breach and restore
  runbooks, and is the usual reason an erasure appears to "come back".
- **Mail already delivered.** Once a confirmation email is in someone's inbox,
  it is theirs. Nothing here reaches it.
