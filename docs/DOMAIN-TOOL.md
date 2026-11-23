# tools/domain.sh

How the game's hostnames are attached, redirected and rolled back, as of 23 November 2026. The
history of the first cutover is in `docs/CUTOVER.md`; its `attach release-N` command is gone.

## What changed, and why

The old `attach` redeployed a release's frozen copy with a wrangler config listing only the
hosts named. Wrangler publishes Custom Domains with `replace_state=true` and
`override_scope: true` (`publishCustomDomains` in `node_modules/wrangler/wrangler-dist/cli.js`),
which replaces the Worker's whole set of Custom Domains, so attaching mira.cc that way would have
detached www.syn3h.com and taken the game down. A wrong release number would also have rolled
production back. Now:

- `attach` never deploys. It attaches one hostname through the Custom Domains API
  (`PUT /accounts/{account}/workers/domains` with `hostname`, `service: "syn3h"` and `zone_id`;
  the API reference lists `environment` only as a deprecated response field). It lists the
  Worker's domains before and after, and fails loudly, naming the command to re-attach, if any
  host attached before is missing.
- Cloudflare documents that a Custom Domain cannot share its hostname with a CNAME, and says
  nothing about A or AAAA records. So `attach` removes the A, AAAA or CNAME records at that one
  hostname itself, only if they are in the export and unchanged since, and says which.
- www.mira.cc is never a Custom Domain (it would serve the game on a second origin, with its own
  storage and invites). `redirect-www` gives it a proxied `AAAA 100::` record, Cloudflare's
  documented address for a hostname with no origin, and one Single Redirect rule:
  `(http.host eq "www.mira.cc")` to `concat("https://mira.cc", http.request.uri.path)`, 302,
  query kept. No page was ever opened on www.mira.cc, so its `/ws` needs no exception.
- The zone is `--zone` or `MIRA_DOMAIN_ZONE` (syn3h.com by default, or the zone of the host
  named), and only syn3h.com and mira.cc are allowed.
- Every changing step has `--dry-run`, which prints each changing call (method, address, body)
  and makes none. With a token it still reads; without one it reads the export. The token is
  never printed.

Tests: `tools/domain.test.mjs`, against a stand-in API.

## Where to run it

From a clean checkout of the reviewed commit: the main checkout (`/Users/vtn/dev/Syn3h`), or a
worktree made for the run, with `MIRA_DOMAIN_STORE` set. Never from a builder's worktree. A shell
reads a script as it runs it, so an edit made there mid-run changes the rest of the run: on
23 November a `check mira.cc` run from the builder's worktree ended in "unexpected EOF" when the
builder edited `tools/domain.sh` underneath it. It could as easily have been mid-attach.
Builders: once a tip is handed over to run, make further changes in another worktree.

The exports live in `../Syn3h-stable/dns/`, computed from the repository's parent: from a
worktree under `Syn3h-wt` that would be `Syn3h-wt/Syn3h-stable`, the wrong directory, hence
`MIRA_DOMAIN_STORE`.

## New names and cached "no such name"

On 23 November, `redirect-www` created www.mira.cc's placeholder a minute after `clean-parking`
had deleted its parking record. In that minute the machine's resolver looked the name up, cached
"no such name", and kept answering it from cache, so the two-minute wait for the redirect failed
although the redirect worked. Now:

- `redirect-www` replaces the parking record itself: the placeholder goes in first and the
  parking A record comes out after, so the name never stops resolving (A and AAAA records may
  share a name; a CNAME may not, so a parking CNAME is removed first).
- Its wait, and `check www.mira.cc`, connect through the address a public resolver (1.1.1.1)
  gives, not through this machine's resolver, and say so when the two disagree.

## What check accepts

- The host itself must serve the game (200 with a valid certificate), or, once its zone sends
  players to mira.cc, answer 301 or 302 to `https://mira.cc/...`. Either way `wss://<host>/ws` must
  upgrade. So after the old-address rule is live (`docs/MIRA-CUTOVER.md`, step 7),
  `check www.syn3h.com` reports the redirect and the socket and stops there, instead of waiting
  five minutes for a 200 that will not come.
- Every host attached in the newest export of either zone must still be attached, and must
  serve the game or redirect to mira.cc with its socket still upgrading: www.syn3h.com stays
  attached after the switch only so that pages left open there keep their room.
- `tools/release.sh` runs `MIRA_SHORT_CHECK=1 tools/domain.sh check ...` after every production
  deploy. There, a failed API read (the route to Cloudflare's API has failed transiently before)
  only warns. A list that was read and lacks a host fails the check, as every API failure does
  outside the short check.
- The socket is checked with curl: a 101 answer to an upgrade request at `/ws`.

## mira.cc, step by step

Run each changing step with `--dry-run` first and read what it prints.

| Step | Command | Undo |
| --- | --- | --- |
| Export the zone and the Worker's domains | `tools/domain.sh export --zone mira.cc` | nothing changed |
| Attach the apex | `tools/domain.sh attach mira.cc --owner-approved` | `tools/domain.sh rollback <export> mira.cc` |
| Check it: certificate, 200, `/ws`, www.syn3h.com still attached and serving, net-smoke | `tools/domain.sh check mira.cc` | |
| Redirect www, replacing its parking record in the same step (it checks the 302 itself) | `tools/domain.sh redirect-www --owner-approved` | `tools/domain.sh redirect-www-rollback <export>`, then `tools/domain.sh restore <export> www.mira.cc` |
| Check www | `tools/domain.sh check www.mira.cc` | |
| Export again, then delete the remaining parking record at `*.mira.cc` (it lists what it will delete) | `tools/domain.sh clean-parking` to read the list, then `--confirm-delete` | `tools/domain.sh restore <export> '*.mira.cc'` |

This is the order for a fresh zone. mira.cc was done on 23 November in the earlier order
(clean-parking before redirect-www), which is what met the cached "no such name" above.

`rollback` refuses to detach any host that was attached when its export was taken, so it can
never detach www.syn3h.com. Whether detaching also removes the DNS record Cloudflare made is not
documented; if it does not, restoring the exported record reports a conflict, and the dashboard
shows which record to remove.
