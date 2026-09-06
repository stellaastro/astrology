# Credential rotation runbook

**Status:** authorised 2026-09-06, in progress
**Why now:** the repository is public. It contains no credential values, but it
names which live credentials were exposed. Rotating makes that a historical
note rather than a live weakness.

Work top to bottom. The first two are the ones that can cost money.

---

## Before you start

Nothing here breaks the live site. `www.stellaastro.com` serves a holding page
that touches none of these. The API uses only the database credential, which is
item 4 — expect about thirty seconds of API downtime when that one changes.

---

## 1. Razorpay — live key and secret  · CRITICAL

Dashboard → Settings → API Keys → **Regenerate Live Key**.

- Download the new key and secret when shown. **The secret is displayed once.**
- Razorpay does not invalidate the old key until you confirm, so there is no
  window where payments break — but nothing is charging cards yet anyway.
- Send me `RAZOR_LIVE_KEY` and `RAZOR_LIVE_SECRET`; I update `config.txt`.

**Also do this:** Dashboard → Settings → Activity / API logs. Look for any API
call you do not recognise since the exposure. Rotation closes the future; the
log is the only thing that tells you about the past.

## 2. 100ms — app secret and SIP password  · CRITICAL

Dashboard → Developer → **App Secret → Regenerate**. SIP credentials are under
the same section.

Nothing consumes these yet — the video spike has not been run — so regenerating
is free of consequence right now. That will stop being true at Phase 8.

Check the session logs for rooms you did not create.

## 3. Google / Gmail app password  · HIGH

Google Account → Security → 2-Step Verification → **App passwords**.

- **Revoke** the existing app password for `guruji@stellaastro.com`.
- Create a new one, 16 characters. Store it **without spaces** — Google displays
  it in groups of four for readability, SMTP takes it unbroken.
- Send it to me; I update `SMTP_PASSWORD` in both `config.txt` and `.env`.

Also check Security → Recent activity for sign-ins you do not recognise.

## 4. MySQL — application user  · HIGH

This one I can do, and it needs about thirty seconds of API downtime. Say the
word and I will:

1. Generate a strong random password (not a dictionary word plus a year — the
   current one is `Bank@0225`, which is the shape a cracker tries first).
2. `ALTER USER` in MySQL, update `config.txt` and `.env`, restart the API.
3. Verify `/api/v1/health/ready` returns `database: ok`.

**While in there, two things worth fixing at the same time:**

- The account is `hminds@'%'` — it accepts connections from **any host**. It
  should be `hminds@'localhost'`, since only this server connects.
- MySQL is bound to `*:3306`, listening on every network interface rather than
  just localhost. Combined with a `%`-scoped account and a weak password, that
  is the risky combination. I started checking whether your firewall blocks 3306
  externally and the command was declined, so **I do not know whether it is
  actually reachable from the internet** — worth establishing either way.

## 5. OpenAI API keys  · MEDIUM

Two keys were pasted into a chat transcript on 2026-09-05 while attempting
design mockups. platform.openai.com → API keys → revoke both.

Neither is used by anything in the codebase. Image generation never worked —
it needs organisation verification, which is a separate account-level step.

## 6. Lower priority

- **AstrologyAPI** key and MCP token — dashboard → API credentials.
- **ProKerala** client secret — dashboard → applications.
- **Firebase** phone-verification token — Firebase Console → project settings.

None are in use yet. Rotate before launch rather than today.

---

## After rotation

Send me the new values and I will update `/home/stellaastro/secrets/config.txt`
and `.env` together, then verify the API still connects. Do not commit any of
them: `.gitignore` covers both files and CI scans tracked files for
credential-shaped strings, but the real control is not putting them there.

**The plaintext file is still an interim arrangement.** `config.txt` remains the
single unencrypted copy of every credential, on the same host that was the
original exposure vector. A secrets manager or environment injection is the
actual fix, and it is on the lead-time list.
