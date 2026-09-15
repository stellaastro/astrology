# Stella Astrology

Astrology consultation marketplace for India. Paid consultations with named
astrologers, booked into scheduled slots.

**Read before writing code:**

| File | What it is |
|---|---|
| `CLAUDE.md` | settled decisions, hard rules, current phase |
| `docs/architecture/DECISION_LOG.md` | 36 ADRs — resolves the source docs, which contradict each other in sixteen places |
| `docs/architecture/EDITION_2_RECONCILIATION.md` | **read before acting on Edition 2.0** — what was adopted from it and what was not |
| `docs/architecture/DEVELOPMENT_DATA_PLAN.md` | synthetic roster, the three modes, and where the fake-data boundary is |
| `docs/architecture/IMPLEMENTATION_PLAN.md` | build order, phase gates, staged beta |
| `docs/architecture/REPOSITORY_AUDIT.md` | what existed before the build started |
| `DESIGN.md` | tokens, type, layout rules, accessibility requirements |

Precedence: `DECISION_LOG.md` → **Edition 2.0** → `system_architecture.md` →
`rough_plan.txt`. Do not resolve a contradiction between source documents
yourself — check the log, and if it is not covered there, ask.

**Edition 2.0 is dated 14 September 2026, so it looks current. It mostly is
not.** It plans a larger, different product — wallet, per-minute billing, six
apps, RabbitMQ — all of which three plan reviews deliberately removed, and its
repository audit describes a codebase that is not in this git history. Three
things were adopted from it: the palette, the typography and the staged
development-data approach. See ADR-033.

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

### Watching changes land — the review server

A second Next.js instance runs `next dev` on the project host, so a saved file
is visible in the browser within a second or two. No build, no deploy.

**https://www.stellaastro.com:8434** — basic auth, credentials in
`/home/stellaastro/secrets/config.txt` under `DEV_REVIEW_*`.

Production is untouched; it keeps serving the optimised build on `:3000`.

The live web service currently uses `.next-release-hero-objects-larger`, selected by
`/etc/systemd/system/stella-web.service.d/hero-release.conf` through
`NEXT_DIST_DIR`. This release includes the dedicated celestial foreground,
inward-tilted animated details, and automatic motion without controls. The
hero fits the viewport below the header, with a background that covers the
section. The rings and artwork have received a further 10% increase (stage scale .968); five detached celestial objects
rotate independently around their own centres, and the armillary globe is removed.
Pointer parallax remains disabled. The previous `.next-release-hero-objects`
build remains available for rollback. Future deployments
must build a new release directory and update the service's `NEXT_DIST_DIR`;
editing source or building `.next-prod` alone does not update the live service.


```bash
sudo systemctl status  stella-dev
sudo systemctl restart stella-dev      # after next.config.mjs or dependency changes
sudo systemctl stop    stella-dev      # frees ~350 MB when you are not reviewing
journalctl -u stella-dev -f            # compile errors land here first
```

**nodemon is deliberately not installed.** Next.js already has Fast Refresh,
which swaps changed components into the running page without losing state;
nodemon would replace that with slower full restarts. See
`infrastructure/dev-review/README.md`.

---

## Checks

```bash
npm test          # Vitest
npm run typecheck
npm run gates     # contrast + i18n parity + fixture containment + migrations
```

All four gates run without installing anything — they are dependency-free on
purpose, so a broken lockfile cannot silently disable them.

**Verify a gate works before trusting it.** A gate nobody has watched fail is
not a gate:

```bash
echo '.x{color:var(--accent)}' > apps/customer-web/app/probe.css
npm run gate:contrast          # must fail — saffron gold is 2.31:1 on ivory
rm apps/customer-web/app/probe.css
```

The contrast lint also guards three things that are not ratios, each of which
had already gone wrong once:

```bash
# a second tokens.css (the lint read one file, the browser rendered the other)
cp packages/design-system/tokens.css apps/customer-web/app/tokens.css
npm run gate:contrast          # must fail
rm apps/customer-web/app/tokens.css

# an rgba() that matches no token — these silently keep the OLD palette
echo '.y{background:rgba(247,241,227,.86)}' > apps/customer-web/app/probe.css
npm run gate:contrast          # must fail
rm apps/customer-web/app/probe.css
```

The third is `themeColor` in `layout.tsx`, which must equal `--surface`.

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
- **There must be exactly one `tokens.css`.** A byte-identical copy lived in
  `apps/customer-web/app/` until 2026-09-14: the lint read the package copy while
  the browser rendered the app copy, so a palette change could pass CI and never
  reach the site. Import `@stella/design-system/tokens.css`. The lint now fails
  if a second appears — and equally if an `rgba()` literal matches no token,
  because those silently keep the old palette.
- **Run git as `stellaastro`, or know why you can get away with root.** The
  services run as `stellaastro`; a file created by root that is not
  group-writable is one the running app cannot rewrite, and `next-env.d.ts`,
  `.gitignore` and `tsconfig.json` have each broken the dev server this way.
  Two settings now absorb it: `core.sharedRepository=group` makes git create
  group-writable files, and the setgid bit on every directory keeps the group
  as `stellaastro` whoever writes. Neither helps for tools outside git, so
  builds still run `sudo -u stellaastro`.
- **Deploying the web app means building a NEW release directory** and pointing
  `NEXT_DIST_DIR` at it in
  `/etc/systemd/system/stella-web.service.d/hero-release.conf`. Building
  `.next-prod` alone changes nothing that is served. Keep the live directory and
  one rollback target; prune the rest, because each is ~56 MB and they had
  reached 511 MB before anyone looked.
- **Money is integer paise.** Never a float.
- **Gold is never text and never a button fill.** Saffron gold is 2.31:1 on ivory
  — it fails harder than the gold it replaced. The contrast lint enforces it.

---

## Secrets

Real values live in `/home/stellaastro/secrets/config.txt`, mode 600, outside
the document root. **Never commit them.** `.env.example` carries placeholders
only, and CI scans tracked files for credential-shaped strings.

If you find a credential in the repository, treat it as exposed: rotate it and
review the provider's activity log. Rotation closes the future; only the log
tells you about the past.
