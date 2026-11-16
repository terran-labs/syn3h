# Production release and syn3h.com cutover

Two separate steps, each with its own command, so the first can never touch the domain.

1. **Release** a tagged milestone to the Worker's workers.dev address: `tools/release.sh`.
2. **Cut over** www.syn3h.com (and optionally the apex) to that release, only after the owner
   has seen it and said so in his thread: `tools/domain.sh`.

Rollback exists for both. Nothing here runs `wrangler login`; the operator supplies access.

## Access

The token lives in `~/.config/syn3h/cloudflare-token`: outside the repository, mode 600, one
line, no expiry, scoped as the table below shows. `tools/release.sh`, `tools/rollback.sh` and
`tools/domain.sh` load it from there (through `tools/cloudflare-token.sh`) when
`CLOUDFLARE_API_TOKEN` is unset. It is never committed, printed or copied, and it is the
owner's to reissue: replace the file's one line and nothing else changes.

`npx wrangler login` on this machine is enough for step 1. Step 2 calls the Cloudflare API
directly and needs `CLOUDFLARE_API_TOKEN`. One token can serve both. Create it in the
dashboard (My Profile > API Tokens > Create Token), starting from the **Edit Cloudflare
Workers** template, and scope it:

| Permission | Scope | Why |
|---|---|---|
| Account: Workers Scripts: Edit | the account | deploy, Durable Objects, version rollback, Custom Domains API |
| Account: Account Settings: Read | the account | wrangler reads the account |
| User: User Details: Read, User: Memberships: Read | | wrangler identifies the token's account |
| Zone: Workers Routes: Edit | syn3h.com only | attaching a Worker to the zone's hostnames |
| Zone: DNS: Edit | syn3h.com only | export, remove and restore the www and apex web records |
| Zone: Zone: Read | syn3h.com only | look up the zone id |
| Zone: Single Redirect: Read, Zone: Page Rules: Read | syn3h.com only | optional: save today's apex to www redirect with the export |

Restrict the zone permissions to syn3h.com rather than all zones. The Worker and the zone must
be in the same Cloudflare account. I could not confirm from Cloudflare's documentation whether
Custom Domains need Workers Routes: Edit on top of Workers Scripts: Edit, so the table includes
both. If the first `export` or `attach` reports a permission error, the API response names the
missing one.

## Step 1: release to workers.dev

From the integration checkout, clean, on a green milestone tag:

    tools/release.sh 1 "first production release"

It freezes the build into `../Syn3h-stable/<id>` (and repoints `current`), uploads everything
except source maps, deploys from the frozen copy, waits for the address to answer, runs
`tools/net-smoke.mjs` against it and fails loudly on any check. On success it records the
release in `../Syn3h-stable/releases.tsv`, creates the local tag `release-1` and prints the line
for `ops/RELEASES.md`. Then open the printed address on a phone and join a room by QR.

`tools/release.sh 1 "note" --dry-run` does all of this except the deploy: it serves the frozen
copy with `wrangler dev --local` and smoke tests it directly and through 150 ms of latency.

Things the first real deploy will meet:

- **workers.dev subdomain.** If the account has never registered one, wrangler stops (it is
  not interactive here) with a link to the dashboard onboarding page. Registering it is an
  account level choice of a public name (`<name>.workers.dev`); the owner should pick it. The
  release then lives at `https://syn3h.<name>.workers.dev/`.
- **Worker name `syn3h`.** If the account already has a Worker by that name, the deploy
  replaces it. Check Workers & Pages first.
- **Durable Objects.** The `v1` migration creates the SQLite backed `RoomDO` class, which the
  Workers Free plan supports. No prompt.
- **Assets.** About 55 files; the largest is about 5.5 MB, under the 25 MiB per file and 20,000
  file limits. Static asset requests are free and unlimited.
- **Free plan request budget.** Durable Objects on the Free plan allow 100,000 requests a day,
  with 20 incoming WebSocket messages counted as one request, and fail with errors once it is
  spent until 00:00 UTC (4pm Pacific). Each player sends about 21 messages a second (a bit over
  one request a second), and the host sends 20 a second per bot. Eight people and four bots
  use about 12 requests a second, which is roughly 2.3 hours of play a day; sixteen people,
  about 1.7 hours. The day that ends 4pm Sunday covers both tonight's testing and the demo.
  The Workers Paid plan ($5 a month) removes this ceiling. That is the owner's decision.

Roll a release back to the one before it, instantly and without rebuilding:

    tools/rollback.sh             # or: tools/rollback.sh release-1

This uses Worker versions, which include the static assets. Custom Domains are not part of a
version: after a cutover, the domain stays attached and serves whichever version is current.
For the same reason, later `tools/release.sh` deploys (whose config lists no routes) leave the
domain attached; wrangler only touches Custom Domains when the config lists some.

## Releasing while people are playing

A release does not drop anyone at the moment of the deploy, and it does not leave them alone
either. What Cloudflare does (Durable Objects changelog of 30 October 2026, and "Use
WebSockets" in the Durable Objects documentation):

- A room nobody is in gets the new code the next time someone joins it.
- A room with players in it is an active Durable Object. By default its code update is
  deferred: it keeps running the **old** room code for up to 5 minutes while Cloudflare waits
  for it to go idle, which a room in play never does. Then it is reset. Deferral is best
  effort: the reset can come sooner.
- The reset closes every socket in that room at once. Each player's game reconnects by itself
  (under a second in our reconnect check) and stays where it was.

What a room keeps across that reset, measured with `tools/deploy-reset-check.mjs`: the world
(every shared slider, the seed, the game mode). What it loses: scores and the round in
progress, who is "it", and who is host: players come back with new ids, the first one back
becomes host, and a slider lock is released. During the 5 minutes before the reset, pages
loaded fresh run the new client against the old room code.

So:

1. **Do not release during a demo or a round that matters.** Release before people arrive,
   or between sessions when rooms are empty.
2. If a release must go out with people playing, choose the moment: deploy with
   `tools/release.sh <n> "note" --immediate`, which passes
   `--durable-objects-code-update-mode immediate`, so every room blinks once, now, instead
   of five minutes later without warning. Say "the game will blink for a second" first.
3. After any release with people connected, start a fresh round: scores were reset.
4. A release that changes the wire protocol (`PROTOCOL_VERSION`) must not go out with people
   playing at all: old pages and new rooms refuse each other until the page reloads.

## Step 2: cut over syn3h.com

Today: syn3h.com's DNS is on Cloudflare, the apex redirects to www, www serves the existing
site, and the zone carries Google mail (MX and TXT) records.

**Recommended scope: www.syn3h.com only.** Single Redirect rules run before Workers, so the
apex keeps redirecting to www, and www becomes the game. Only the www web record changes. The
apex, its redirect and every mail record stay exactly as they are. Attach the apex too only if
the redirect is to go.

1. **Owner's word.** He has seen release N on workers.dev and said "cut over" in his thread.
2. **Export the zone.**

       tools/domain.sh export

   This saves `records.json` (every record, with ids), `zone.bind` (the zone file) and, if the
   token may read them, the redirect and page rules, under `../Syn3h-stable/dns/<time>/`. It
   lists the web records at syn3h.com and www.syn3h.com: the only records the cutover touches.
   Read that list. MX and TXT records are never removed or restored by these tools.
3. **Attach.**

       tools/domain.sh attach release-N www.syn3h.com --owner-approved

   It refuses without `--owner-approved`, without an export from the last two hours, for any
   host other than syn3h.com or www.syn3h.com, and for a release not recorded by
   `release.sh`. It then:
   - removes the A, AAAA or CNAME records at www.syn3h.com, printing each one (a Custom
     Domain cannot share its hostname with them; left in place, a non interactive wrangler
     deploy would override them silently, which is why the script removes them visibly first)
   - redeploys the same frozen copy with a generated `wrangler.domain.toml`: the release's
     own `wrangler.toml` plus `workers_dev = true` (so the workers.dev address keeps working)
     and one `custom_domain = true` route per host. Cloudflare creates the DNS record and the
     certificate.
   - if the deploy fails, restores the removed records itself
   - runs the checks below, and prints the exact rollback command
4. **Checks** (also on their own: `tools/domain.sh check www.syn3h.com`):
   - `https://www.syn3h.com/` answers 200 over HTTPS (it waits up to five minutes for the
     certificate)
   - a WebSocket upgrades at `wss://www.syn3h.com/ws`
   - `tools/net-smoke.mjs https://www.syn3h.com/` passes
   - by hand: `https://syn3h.com/` still redirects to www and lands on the game
   - by hand: a phone scans the QR on the projector and joins. Invite links and QR codes are
     built from `location.origin`, so open the projector page on www.syn3h.com and they follow.
   - by hand: paste `https://www.syn3h.com/` into a chat app and see the share card. Its
     `og:image` is currently the relative `/brand/share.png` with no `og:url`; crawlers that
     follow the Open Graph spec need an absolute URL, so the UX lane should make both absolute
     (`https://www.syn3h.com/...`) before the cutover.
   - mail: `dig MX syn3h.com` and `dig TXT syn3h.com` match the export
   - done on trunk for release 2: switch `og:url`, `og:image`
     and `twitter:image` in `index.html` from the workers.dev address to
     `https://www.syn3h.com` (UX lane; `tests/ui/share.test.ts` keeps them on one origin)

## If a check fails after the attach

Rule set by the Foreman after the first cutover (14 November, 7:15pm PST). On a failed
post-attach check, stop all further changes and take up to five minutes to establish whether
the failure is ours or is the old origin still being served from Cloudflare's cache
(`curl -sD - https://www.syn3h.com/` showing the old site's title or an `x-host` header from
the old host; a 406 on the WebSocket came from there the first time and cleared in about a
minute). Roll back if the failure is ours, or if it has not cleared in five minutes.

## Rollback of the cutover

    tools/domain.sh rollback ../Syn3h-stable/dns/<time> www.syn3h.com

It detaches the Custom Domain (Cloudflare removes the record it created), then recreates the
www records exactly as exported (type, content, proxied, TTL, comment). The old site is back as
soon as DNS answers, normally within a minute on a proxied record. The certificate Cloudflare
issued for the Custom Domain stays under SSL/TLS > Edge Certificates; it is harmless and can be
deleted later. If the script cannot run, the same rollback by hand: Workers & Pages > syn3h >
Settings > Domains & Routes, remove www.syn3h.com; then DNS > Records, add back the records
listed in `records.json` for www.syn3h.com.
