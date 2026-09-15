# The review server

**https://www.stellaastro.com:8434** — basic auth, then sign in.
Credentials are in `/home/stellaastro/secrets/config.txt`.

It runs the **synthetic roster** against the **dev database**. Nothing you do
there can reach production.

## What you will see

| | Review server (:8434) | Production (:443) |
|---|---|---|
| Database | `stellaastro_dev` | `stellaastro` |
| API | `stella-api-dev`, port 4001 | `stella-api`, port 4000 |
| Astrologers | 20 synthetic, 17 published | the 3 real directors |
| Customers | 30 synthetic | none yet |
| Waitlist | 25 synthetic leads | the real list |
| Fixtures on public pages | **shown** | **impossible** |

Every synthetic astrologer is labelled *Sample profile — not a real
practitioner* on the page itself, so a screenshot cannot be mistaken for the
live site.

## Why it was rebuilt, 2026-09-15

The review vhost proxied `/api/v1` to port **4000 — the production API**. So
the review server displayed production data, and **any form submitted there
wrote to the production database.** A review server that mutates production is
worse than no review server.

It now has its own API process on 4001, reading `.env.review`, which points at
`stellaastro_dev`. The unit sets `InaccessiblePaths=/home/stellaastro/secrets`,
so that process cannot read the production credentials even if misconfigured.

## Why fixtures are visible here and nowhere else

ADR-036 wants dev and staging 100% synthetic — seeing the page populated is the
entire point of a review server. But the public roster excludes fixtures by
default, so this is opted into by `PUBLIC_SHOW_FIXTURES=true`, set **only** in
`.env.review`.

**That variable is deliberately not `APP_ENV`.** The boot guard already keys on
`APP_ENV`; making this key on it too would mean one wrong value disabled both
controls at once and put invented practitioners on a live site. Getting
`APP_ENV` wrong in production is not enough — someone would have to add
`PUBLIC_SHOW_FIXTURES` as well.

## Reseeding

```bash
cd services/api
APP_ENV=development npm run db:seed
```

Idempotent. Seeds refuse to run unless `APP_ENV=development` **and**
`DATABASE_URL` ends in `_dev` — both, not either.

## Two caches that will confuse you

1. **Next's fetch cache is on disk** (`.next/cache/fetch-cache`) and survives a
   restart. After changing what the API returns, a stale page can persist for
   the full revalidate window; `rm -rf .next/cache/fetch-cache` then restart.
2. **The landing page is ISR with a five-minute revalidate.** If the API is
   down when it revalidates, the "could not load" state is cached — including
   for several minutes after the API recovers.
