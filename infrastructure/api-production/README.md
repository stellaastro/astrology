# Production environment for the API

The live API reads **`/home/stellaastro/secrets/api.production.env`**, selected by
the systemd drop-in in this directory. The repo's `.env` is the **development**
default and is no longer read in production.

## The bug this fixes

`stella-api.service` carried:

```
EnvironmentFile=/home/stellaastro/htdocs/www.stellaastro.com/.env
Environment=NODE_ENV=production
```

systemd lets `EnvironmentFile=` override `Environment=`, so the unit's own
`NODE_ENV=production` was being silently replaced by `development` from that
file — along with `APP_ENV=development` and a `DATABASE_URL` pointing at
`stellaastro_dev`.

Consequences, all of which were live:

- The public API wrote real waitlist signups into the **development database**,
  alongside 25 synthetic fixture rows.
- The ADR-026 fixture guard reads `APP_ENV`. Seeing `development`, it returned
  early and permitted those fixtures. The guard was not broken; it was told it
  was in development.
- `stellaastro`, the production database, existed with **zero tables** — it had
  never been migrated.

Setting `DATABASE_URL` in the drop-in was **not** enough: an empty
`EnvironmentFile=` is required first, because it resets the inherited list.
Without the reset the dev file is still read and still wins.

## How it is wired now

| Layer | Value |
|---|---|
| `EnvironmentFile=` | reset to empty, then `/home/stellaastro/secrets/api.production.env` |
| `ENV_FILE` | the same file, for NestJS `ConfigModule` (`src/app.module.ts`) |
| `APP_ENV` | `production` — this is what arms the fixture guard |
| `DATABASE_URL` | `stellaastro` (production), migrated |
| `REDIS_URL` | db index **3**, so a staging test cannot drop production keys |

Both layers point at one file on purpose. Selecting the whole file is
unambiguous in a way that overriding individual variables was not.

## Files

| Where it lives | Copy here |
|---|---|
| `/etc/systemd/system/stella-api.service.d/production-env.conf` | `production-env.conf` |
| `/home/stellaastro/secrets/api.production.env` | `api.production.env.example` — **keys only**, every value a placeholder |

Editing the copies here changes nothing. Copy to the real path, then
`systemctl daemon-reload && systemctl restart stella-api`.

## Verifying after a change

```bash
# 1. the process must actually have production values
sudo tr '\0' '\n' < /proc/$(systemctl show stella-api -p MainPID --value)/environ \
  | grep -E '^(APP_ENV|NODE_ENV|DATABASE_URL)='

# 2. a signup must land in production, not dev
curl -s -X POST https://www.stellaastro.com/api/v1/public/leads \
  -H 'Content-Type: application/json' \
  -d '{"email":"routing-check@stellaastro.com","consent":true}'
# then confirm the row is in stellaastro and NOT stellaastro_dev, and delete it
```

Check the database the signup landed in — not just that the request returned
200. A 200 was returned throughout the entire period the rows were going to the
wrong database.
