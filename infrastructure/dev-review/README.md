# Review server

A second Next.js instance running `next dev`, so changes are visible the moment
a file is saved — no build, no deploy, no restart.

**https://www.stellaastro.com:8434** — basic auth, credentials in
`/home/stellaastro/secrets/config.txt` under `DEV_REVIEW_*`.

Production is untouched: it keeps serving the optimised build from
`stella-web.service` on `:3000`.

---

## Why not nodemon

nodemon restarts a Node process when files change. Next.js already has **Fast
Refresh**, which swaps changed components into the running page in a couple of
hundred milliseconds without losing scroll position or component state. Putting
nodemon in front of it would replace that with full restarts — strictly slower,
and it would lose the page state that makes reviewing useful.

`next dev` is the tool for this. nodemon is not installed.

---

## The two collisions this had to avoid

Both would have taken production down, and neither is obvious.

1. **`next dev` writes to `.next/` — the same directory `next start` serves
   from.** Running both out of one checkout means every file change overwrites
   the live build mid-request. The dev service therefore sets
   `NEXT_DIST_DIR=.next-dev`, which `apps/customer-web/next.config.mjs` reads.
   Local development, CI and the production build all still use `.next`.

2. **Fast Refresh runs over a WebSocket.** Without `Upgrade` and `Connection`
   headers on the proxy the page loads perfectly and simply never updates —
   which reads as "hot reload is broken" rather than "the proxy dropped the
   upgrade". Both headers are set in the vhost.

---

## Why it is behind a password

`next dev` serves unminified source and renders a stack-trace overlay into the
page when something throws. That is exactly what a reviewer wants and exactly
what should not be readable by anyone who finds an open port on a registered
company's domain.

So: basic auth, plus `X-Robots-Tag: noindex, nofollow, noarchive` in case the
auth is ever removed without thinking. The unit also sets
`InaccessiblePaths=/home/stellaastro/secrets` — the production service does not
need that, but a service that prints stack traces to a browser does.

Port **8434** sits inside the `8433:8443` range ufw already allows, so no
firewall change was needed. 8443 is CloudPanel.

---

## Operating it

```bash
sudo systemctl status  stella-dev      # is it up
sudo systemctl restart stella-dev      # after changing next.config.mjs or deps
sudo systemctl stop    stella-dev      # free ~350 MB when not reviewing
journalctl -u stella-dev -f            # compile errors appear here first
```

It is `enabled`, so it returns after a reboot.

**Changes that need a restart:** `next.config.mjs`, `package.json` dependencies,
environment variables. Everything in `app/` — components, CSS modules,
`globals.css`, page content — is picked up automatically.

**First load of a route takes several seconds** because a dev build compiles on
demand. That is the dev server, not the site. The production site is unaffected
and still responds in well under 100ms.

---

## Files

| Where it lives | Copy here |
|---|---|
| `/etc/systemd/system/stella-dev.service` | `stella-dev.service` |
| `/etc/nginx/sites-enabled/stella-dev.conf` | `nginx-stella-dev.conf` |
| `/etc/nginx/stella-dev.htpasswd` | not copied — it is a credential |

These copies exist so the setup is reproducible. **Editing them here changes
nothing** — copy to the real path and `systemctl daemon-reload` or
`nginx -t && systemctl reload nginx`.

Kept in a separate nginx file from the CloudPanel-managed vhost so a panel
rewrite cannot clobber it.
