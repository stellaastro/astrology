# Repository Audit

**Date:** 2026-09-06
**Scope:** `/home/stellaastro/htdocs/www.stellaastro.com`
**Required by:** `rough_plan.txt` §74 (audit before implementation), §81 (do not
begin building until the audit and implementation plan are approved)

Every fact below was verified by running a command, not inferred. Where a prior
assessment was re-checked, that is stated.

---

## Headline finding

**This is a greenfield repository. There are zero source files.**

```
find . -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx'
       -o -name '*.py' -o -name '*.php' -o -name '*.dart' -o -name '*.sql'
→ 0
```

No `package.json`, no workspace manifest, no build tooling. The entire repository
is planning documents plus 23 MB of brand artwork. Nothing is running.

This matters for how the §74 checklist reads below: most detection points return
"absent", and that is the correct answer rather than a gap to be filled in later.

---

## §74 detection points

| # | Detect | Finding |
|---|---|---|
| 1 | Existing framework | **None.** No Next.js, NestJS, or any other framework present |
| 2 | Backend service | **None.** Nothing listening on :3000 or :4000 |
| 3 | Database schema | **None in the repo.** MySQL 8.4 Percona is *running* on the host but holds no Stella schema |
| 4 | Migrations | **None.** No migration directory, no ORM configured |
| 5 | Authentication | **None.** Firebase is provisioned as a vendor account but unused |
| 6 | API surface | **None.** No routes, no controllers, no OpenAPI document |
| 7 | UI / components | **None.** No pages, no component library, no CSS |
| 8 | Tests | **None.** No test files, no runner, no `## Testing` section in CLAUDE.md |
| 9 | CI/CD | **None.** No `.github/`, no pipeline, no deploy script |
| 10 | Dependencies | **None declared.** Node.js itself is not installed on the host |
| 11 | Secrets handling | **Remediated.** See below |
| 12 | Documentation | `CLAUDE.md`, `rough_plan.txt`, `system_architecture.md`, `docs/architecture/DECISION_LOG.md` |
| 13 | Coding conventions | **None established.** No linter, no formatter, no editorconfig |
| 14 | Deployment | nginx vhost exists and is live. Nothing behind it |
| 15 | Technical debt | Four items, below |

---

## What does exist

### Brand assets — 23 MB, the most valuable thing in the repository

| Location | Count | Note |
|---|---|---|
| `images/*.png`, `*.jpg` | 20 | includes `stella_hero_bg1.png`, the hero used by the design sketch |
| `images/icon_images/` | 74 | mixed decorative illustrations and portrait cards |
| `images/logo/stella.png` | 1 | circular Devanagari zodiac wheel |
| `images/stella_ltr_logo.png` | — | teardrop plaque lockup, **defective** (see debt 2) |

`stella_hero_bg1.png` is compositionally deliberate and better than expected: its
left ~45% is clean cream with faint ornament — a genuine text zone — with the
visual anchor to the right. The design review built the landing page around it
rather than replacing it.

### Live infrastructure, all idle

| Service | State |
|---|---|
| MySQL 8.4.11 Percona | running, no Stella schema |
| Redis 7.0.15 | running, unused, **no environment separation configured** |
| nginx | vhost live, valid TLS, `server_name stellaastro.com www.stellaastro.com www1.stellaastro.com` |
| Node.js, Docker, RabbitMQ, Flutter | **absent** |

**The site is currently down.** The vhost proxies `location /` to
`127.0.0.1:3000` and nothing is listening there, so every request returns 502.
Bringing it up is Phase 2, and that is also what unblocks Razorpay activation.

### Paid vendor accounts, provisioned and unused

ProKerala · AstrologyAPI · 100ms (including **SIP credentials**, implying a PSTN
fallback was contemplated) · Razorpay (live keys) · Firebase. All five are
costing money and returning nothing until Phase 7–8.

### Configuration

`.env.example` — 67 placeholder keys, no real values. `.gitignore` — 86 lines,
covering `.env*`, `config.txt`, service accounts, keystores and `rzp-key.csv`.

---

## Technical debt found

### 1. Secrets in the document root — remediated, rotation still outstanding

`config.txt` held live credentials (Razorpay `rzp_live_` key **and secret**,
100ms app secret and SIP password, a Firebase token, AstrologyAPI key and JWT,
MySQL and Gmail passwords) inside the nginx document root, in the directory whose
own instructions tell the reader to `git push` it to GitHub. The parent
`.gitignore` contained only `!.gitignore` and excluded nothing.

**Exposure re-verified 2026-09-06, not assumed.** The vhost has exactly two
location blocks: `location ~ /.well-known` (serving an empty directory) and
`location /` (proxying to :3000). A request for `/config.txt` would have matched
`location /`, been proxied, and returned 502. **The file was never web-served.**
The exposure route was shell access to the host plus the planned git push.

Moved to `/home/stellaastro/secrets/config.txt`, mode 600. **This is interim, not
a fix** — still plaintext on the same host that was the exposure vector, and it
is the single copy of every credential the project holds. Rotation and activity-
log review remain outstanding owner actions (see `DECISION_LOG.md`).

### 2. The wordmark asset is defective

`images/stella_ltr_logo.png` has a broken alpha channel: yellow and red fringing
around the entire silhouette and mottled colour noise inside the plaque, both
background-removal artifacts. On the ivory ground it renders as a dirty edge. It
is also gold-on-gold, which the project's own colour rule forbids.

Mitigated in ADR-025 by using the round mark plus a typeset wordmark. A clean
re-cut needs an original source that may not exist.

### 3. The portrait images cannot be used in production

`images/icon_images/chead-*.jpg` are AI-generated portrait cards with **five-star
rating badges baked into the pixels**. Using them for a real astrologer would be
a fake practitioner and a fake review simultaneously — forbidden by §13 and §71.
They are acceptable as development fixture avatars only. Real photographs of the
three directors are an outstanding owner action and they gate the landing page.

### 4. The two source documents contradict each other

`rough_plan.txt` and `system_architecture.md` disagree in sixteen places, none of
them flagged in either document. Resolved in `DECISION_LOG.md`, which now holds
32 ADRs and takes precedence over both. Neither source document has been edited,
so the disagreements are still there for anyone reading them directly — which is
why `CLAUDE.md` states the precedence order first.

---

## Consequences for the build

1. **Nothing to migrate, nothing to preserve, no legacy to accommodate.** Every
   architectural decision is free. That is unusual and worth using deliberately.
2. **No rollback target exists.** The repository is not under version control, so
   the first deploy has nothing to revert to. `git init` plus a tag is task 1.1.
3. **The audit found no reusable code**, so "reuse before building" applies to
   *libraries and platform features*, not to this repository.
4. **The most valuable existing assets are not technical** — the brand artwork,
   and the three directors' client relationships.

---

## Verification commands

Reproducible by anyone reading this:

```bash
cd /home/stellaastro/htdocs/www.stellaastro.com
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.dart' \) | wc -l   # 0
ls package.json 2>/dev/null || echo "no manifest"
ss -tlnp | grep -E ':3000|:4000' || echo "site down"
sudo awk '/location/,/}/' /etc/nginx/sites-enabled/*stellaastro*
du -sh images                                                                   # 23M
```
