# Moving the game to mira.cc

The owner decided on 22 November 2026 that the game moves to **mira.cc**, the apex. On 23
November he asked for the address to move at once, before the rename from Syn3h to Mira, which
waits for the new logo. This page covers the address only. Hostnames are attached and redirected
with `tools/domain.sh` (runbook: `docs/DOMAIN-TOOL.md`). The Worker, its Durable Objects and the R2
bucket keep their names, so rooms, frozen versions and the workers.dev addresses carry on
unchanged.

## Where things stand

Done by the Orchestrator with `tools/domain.sh`, 23 November:

- mira.cc is a Custom Domain on the Worker `syn3h`, beside www.syn3h.com.
- www.mira.cc has a proxied placeholder record and a Single Redirect rule sending it to mira.cc
  (302, path and query kept). It never serves the game: a second origin would have its own
  storage and invites.
- The old addresses: a Single Redirect rule on the syn3h.com zone sends syn3h.com and
  www.syn3h.com to mira.cc, live since 23 November (see "The old-address rule").

Facts about the old zone (Orchestrator, 23 November): the apex record is
`A syn3h.com -> 199.34.228.77`, proxied, the old Weebly site, whose Apache answered the earlier 301
to www (keeping the scheme, dropping the path). A wildcard `*.syn3h.com` points at the same
address, not proxied. The Single Redirect rule runs at Cloudflare's edge before any origin, so it
replaces that 301 without changing a record, and the game no longer depends on the Weebly site. The
apex record must stay **proxied** for the rule to apply. MX and TXT, and the api, data, packages,
releases and admin records, are not touched.

## The old-address rule

A page already open on www.syn3h.com keeps using its own origin after the rule goes on:

- its room socket at `wss://www.syn3h.com/ws` (browsers never follow a redirect on a WebSocket
  handshake: the WHATWG WebSockets Standard sets the handshake's redirect mode to "error"),
- `/status` and `/presence`,
- the lazily imported script chunks under `/assets/`, and `/v/versions.json` for the update
  notice. A redirect to another origin breaks these: module scripts and `fetch` are CORS requests,
  and the redirected response on mira.cc carries no `Access-Control-Allow-Origin`.

So the rule redirects **navigations only**: a page opened at an old address moves to mira.cc, and
everything an already open page fetches is answered where it is. Both hosts reach the same Worker
and Durable Object namespace, so a player on the old address and one on mira.cc share rooms until
the old page reloads.

The rule as live (Orchestrator, 23 November; ruleset `3fa1fb90`, rule `5c0f5d88`, "Old addresses
to mira.cc"), expression:

    (http.host in {"syn3h.com" "www.syn3h.com"}) and not (http.request.uri.path in {"/ws" "/status" "/presence"}) and (any(http.request.headers["sec-fetch-mode"][*] eq "navigate") or (not (len(http.request.headers["sec-fetch-mode"]) >= 0) and (http.request.uri.path eq "/" or ends_with(http.request.uri.path, "/") or ends_with(http.request.uri.path, ".html"))))

Target `concat("https://mira.cc", http.request.uri.path)`, status 302, query string kept. In
words: a navigation always redirects. A request with no `Sec-Fetch-Mode` header, as from an older
browser or a script, redirects only for document paths (`/`, a path ending in `/`, or `.html`).
`cors`, `no-cors` and `same-origin` requests never redirect, so an open page's chunks and fetches
keep working. The checks `tools/release.sh` runs after acceptance send the headers of a
navigation and of an open page's fetch, matching this rule.

**The bare syn3h.com.** Since 22 November 2026, 5:29 pm PST, the apex record is a proxied
placeholder (`AAAA 100::`) with no origin, and the Worker is not attached to it. The rule fires on
it directly: every navigation to the bare domain is one 302 to mira.cc. Any other request there,
such as a cors fetch of `/v/versions.json`, answers 522, because there is no origin behind the
placeholder. That is acceptable: no page was ever open on the bare domain (it always redirected to
www), so nothing fetches from it. `tools/release.sh` therefore checks only its navigation redirect;
the open-page fetch and socket checks run on www.syn3h.com alone.

The old Weebly record is exported under `Syn3h-stable/dns/20261122-172834-syn3h.com` and can be
restored with `tools/domain.sh restore`. Before the placeholder, the rule did not fire on the apex:
requests reached the Weebly origin, whose own 301 sent them to www.syn3h.com and only then to
mira.cc. That went away with the placeholder, so it was tied to the Weebly origin; the mechanism is
unexplained.

**Considered and not built: CORS as a second line of defence** (the Foreman, 23 November: the rule
redirects navigations only, so nothing a page fetches is redirected). If any non-navigation request were
redirected anyway, the mira.cc answer would need `Access-Control-Allow-Origin`. Two places would
add it:

- Static files under `/assets/`, `/brand/` and `/fonts/` never reach the Worker (`run_worker_first`
  in `wrangler.toml` lists only `/ws`, `/status`, `/presence`, `/`, `/index.html`, `/build.json`,
  `/models/*` and `/v/*`). Workers static assets read a `_headers` file at the root of the assets
  directory, so `public/_headers` with `Access-Control-Allow-Origin: *` on `/assets/*` would cover
  the chunks. Confirm `_headers` support in Cloudflare's static assets documentation before
  relying on it.
- `/v/versions.json`, `/build.json` and `/models/*` reach the Worker, which could set the same
  header in `serveVersioned`.

Everything there is public and requests carry no credentials, so `*` exposes nothing. A rule that
redirects navigations only makes this unnecessary; it is worth building only if the rule cannot be
made that precise, and it can be removed once no page from before the switch is still open.

## What this release changes (branch ops/mira-domain-only)

- `node tools/switch-domain.mjs` moved every syn3h.com address to mira.cc outside history and
  `tools/domain.sh` (126 addresses in 35 files): share-card tags in `index.html`, the Worker's
  frozen-version links, `PRIMARY_URL`, the live-build lookups and the rollback check in
  `tools/release.sh` and `tools/rollback.sh`, the public check, the workflow default, `PLAY_URL`
  in the notes tool, dashboard links, README, NOTICE and tests. `--check` lists what is left; all
  of it is explained.
- `tools/release.sh` checks mira.cc as the primary address, with rollback on failure. After
  acceptance it checks, loudly but without undoing the release: a navigation to www.mira.cc,
  www.syn3h.com or syn3h.com redirects to mira.cc with its path and query; an open page's own fetch
  of `/v/versions.json` on www.syn3h.com answers 200; `wss://www.syn3h.com/ws` still upgrades.
- Release notes of versions up to v26.11.2204, the last one live at the old address, keep
  "live at https://www.syn3h.com/" in their release line (`playUrl` in `tools/release-notes.mjs`).
- The client never named its address: invites and QR codes are built from `location.origin`, and
  `/ws`, `/status`, `/presence` and `/v/versions.json` are relative.

## Later

- After a quiet week, the redirect rules go from 302 to **301**. Browsers cache a 301 indefinitely,
  which is why it waits.
- www.syn3h.com stays attached to the Worker while pages from before the switch may be open (a day
  is plenty), and syn3h.com stays registered and redirecting for years: printed QR codes, old
  invites and published release notes link to it.
- The rename (Syn3h to Mira) follows on top of this, with name rules only.

## What happens to links

- **Room and invite links** (`?room=...&world=...`) keep their path and query through the
  redirect, so they open the same room on mira.cc: the same Durable Object.
- **Version links** (`?v=26.11.1503`, `/v/<version>/...`) are kept; the Worker serves the frozen
  version from R2 as before.
- **Installed home-screen icons** pointing at syn3h.com follow the redirect.
- **Preferences**: browser storage belongs to an origin, so a player's first visit to mira.cc
  starts with fresh settings, name and saved worlds.
