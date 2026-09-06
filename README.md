# Stella Astrology

Astrology consultation marketplace for India. Paid consultations with named
astrologers, booked into scheduled slots.

**Read before writing code:**

| File | What it is |
|---|---|
| `CLAUDE.md` | settled decisions, hard rules, current phase |
| `docs/architecture/DECISION_LOG.md` | 32 ADRs — resolves the two source docs, which contradict each other in sixteen places |
| `docs/architecture/IMPLEMENTATION_PLAN.md` | build order, phase gates, staged beta |
| `docs/architecture/REPOSITORY_AUDIT.md` | what existed before the build started |
| `DESIGN.md` | tokens, type, layout rules, accessibility requirements |

`DECISION_LOG.md` takes precedence over `system_architecture.md`, which takes
precedence over `rough_plan.txt`. Do not resolve a contradiction between the two
source documents yourself — check the log, and if it is not covered there, ask.

---

## Local setup

Requires **Node 20** (see `.nvmrc`), plus MySQL 8 and Redis 7. Docker is
deliberately not used in V1, so both run natively.

```bash
nvm use                 # or install Node 20 by your preferred route
npm install

cp .env.example .env    # then fill in — real values are NEVER committed
```

### Databases

MySQL 8.4 and Redis 7 are already running on the project host. Locally you need
your own.

```bash
# MySQL — create a database per environment, never share one
mysql -u root -p -e "CREATE DATABASE stella_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Redis — use a distinct DB index per environment. Redis has no separation
# by default, so a staging test would otherwise drop production slot holds.
#   dev = 0, test = 1, staging = 2, production = 3
```

Then:

```bash
npm run db:generate --workspace services/api
npm run db:migrate  --workspace services/api
```

### Running

```bash
npm run dev --workspace @stella/customer-web   # :3000
npm run dev --workspace @stella/api            # :4000
```

nginx proxies `/` to `:3000` and `/api/v1` to `:4000`.

---

## Checks

```bash
npm test          # Vitest
npm run typecheck
npm run gates     # contrast lint + i18n parity + fixture containment
```

All three gates run without installing anything — they are dependency-free on
purpose, so a broken lockfile cannot silently disable them.

**Verify a gate works before trusting it.** A gate nobody has watched fail is
not a gate:

```bash
echo '.x{color:var(--accent)}' > apps/customer-web/app/probe.css
npm run gate:contrast          # must fail — gold is 2.96:1 on ivory
rm apps/customer-web/app/probe.css
```

---

## Things that will bite you

These are not style preferences. Each cost real time to find.

- **MySQL has no partial unique indexes.** A plain
  `UNIQUE(astrologer_id, slot_start)` permanently blocks a slot once a booking
  is cancelled. Use a generated column that is NULL when the row is not
  slot-occupying. Prisma's `@@unique` will not do this — it needs raw SQL.
  (ADR-029)
- **Prisma Migrate is forward-only.** It generates no down migrations, so a
  "rollback cleanly" check is a silent no-op unless you write down SQL yourself
  or verify by restore-from-snapshot.
- **Prisma maps `DateTime` to `DATETIME(3)`, which carries no timezone.** UTC is
  a code convention only. One raw `NOW()` breaks it.
- **Never gate content visibility on a scroll animation.** Animate transform,
  never opacity — an unadvanced `animation-timeline` leaves content permanently
  invisible while it still occupies layout height. (DESIGN.md §6)
- **CSS `order` does not move grid tracks.** Alternating a two-column layout
  with `order` leaves the item in the next track. Swap
  `grid-template-columns` instead. (DESIGN.md §5)
- **Money is integer paise.** Never a float.
- **Gold is never text and never a button fill.** The contrast lint enforces it.

---

## Secrets

Real values live in `/home/stellaastro/secrets/config.txt`, mode 600, outside
the document root. **Never commit them.** `.env.example` carries placeholders
only, and CI scans tracked files for credential-shaped strings.

If you find a credential in the repository, treat it as exposed: rotate it and
review the provider's activity log. Rotation closes the future; only the log
tells you about the past.
