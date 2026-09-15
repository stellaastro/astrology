# Runbook — personal data breach

**Status:** in force · **Adopted:** 2026-09-15 (ADR-040) · **Owner:** Vasantharaj

India's Digital Personal Data Protection Act requires notifying **the Data
Protection Board and every affected person** of a personal data breach. The
Act sets **no materiality threshold** — unlike GDPR, there is no "unlikely to
result in a risk" exemption to reason your way into. If personal data was
exposed, it is notifiable.

This runbook exists because that decision must not be made for the first time
at 2am by whoever noticed.

## What counts

Any unauthorised access to, disclosure of, or loss of personal data. Today that
means the `leads` table and its columns: **email, phone, IP address, user
agent, consent record**. It also means:

- a database dump or backup reaching anywhere it should not
- `/home/stellaastro/secrets/` being read by anyone outside Stella
- the admin waitlist page or CSV export being reached without authorisation
- an outbox payload, log or error report carrying addresses off the box

**Losing data counts too.** An unrecoverable database with no working backup is
a reportable breach, not merely an outage.

## First hour

1. **Stop the bleeding before investigating.** Revoke the credential, take the
   endpoint down, or stop the service. A longer outage is cheaper than a larger
   breach.
2. **Do not delete anything.** Not logs, not rows, not the compromised key.
   Evidence is what makes the later steps possible, and the audit log is
   append-only for exactly this reason.
3. **Write down the clock.** When it started, when it was noticed, how. The
   notification deadline runs from discovery, and "we are not sure when we
   found out" is the worst possible position.
4. **Revoke sessions** if any account may be involved:
   `SessionService.revokeAllForUser`, or delete the rows. Sessions are server
   rows precisely so this is a lookup you can change (ADR-039).

## Establishing scope

Answer these in writing, with queries, not from memory:

- **Which rows?** `SELECT COUNT(*) FROM leads` is the upper bound. Narrow it.
- **Which people?** Every affected person must be told individually.
- **Which fields?** Addresses alone is different from addresses plus IPs.
- **How long was it open?** Check nginx access logs and `audit_events`.
- **Was it read, or only reachable?** Both are notifiable; the distinction
  matters for what you tell people, not for whether you tell them.

`audit_events` is the primary source. Every admin read of the waitlist and
every CSV export is recorded there with an actor and an IP, which is what makes
"was this accessed" answerable rather than a guess.

## Notifying

1. **The Data Protection Board**, in the prescribed form, without delay.
2. **Every affected person**, individually. Say what happened, what data, what
   you have done, and what they should do. Do not minimise and do not wait for
   certainty about the cause — the cause can follow.
3. **Razorpay and any other processor** if their data or keys are involved.

Drafting these is the grievance officer's job. **That officer has not been
appointed** (task 2.8, owner action) — which is a gap in this runbook and is
recorded here rather than hidden.

## Afterwards

- Rotate every credential in the blast radius. Rotation of live financial
  credentials is done by Stella personnel, never by a contractor or an agent.
- **Re-apply any erasure requests completed since the restore point.** A
  restore from backup re-introduces rows that were erased after the dump was
  taken. This is the usual reason an erasure appears to "come back", and
  missing it turns one incident into two.
- Write the incident up: timeline, cause, what stopped it, what would have
  caught it sooner.

## Standing gaps

Recorded honestly, because a runbook that implies readiness it does not have is
worse than none:

- **No grievance officer is appointed.** Owner action, part of task 2.8.
- **No monitoring alerts on bulk reads.** A CSV export of every lead is audited
  but nothing pages anyone. Until then, detection is manual.
- **Backup restore has not been rehearsed** end to end (task 1.4).
