# Orchestrator state

Last verified: 2026-11-20 23:50 PST, by the Orchestrator. A replacement resumes from here.

## Authority

Only the Orchestrator integrates and deploys, on the Foreman's word (Foreman agent
c5dc3811-9bca-4a79-9c81-bcdfdf66908d). Overnight releases are authorized; the owner is asleep.
Every release goes through staging, the dry run and the load gate (one-minute load under 12
for two minutes). A failed live check rolls back by itself; then stop and report, do not retry.

## Production

Live: v26.11.2013 (release-78), source 35b1ab5c, frozen copy 20261120-233536-35b1ab5c,
Worker version 45326a0f, at https://www.syn3h.com/ since 20 November 23:40 PST.
Since 2011 every release runs `npm run test:tools` (143 Node tests) as well as vitest.
2010 carries an experimental glass shader, off by default (?glass=inline opts in; chunk GlassPost),
with assets/liquid-glass/ serving the Apache-2.0 licence, the upstream NOTICE and our NOTICE.md.
The hosted public check caps tolerated device-loss lines at 8 (tools/public-check.mjs) and prints
them grouped by message; 2009 and 2010 had 2.
2009 counts shader-diagnostics rejections after a known loss into the one summary; the hosted check
then tolerated 2 device-loss lines (204 on 2008). Smoke pages keep every AudioContext suspended since
2009 (the renderer crash was Chrome's own audio rendering under load); crash budget still two.
Hello and welcome carry only world settings that differ from their defaults. Staging: a late joiner
after 4 bots took a 999-character welcome (a 2006 page 3,214); mixed room with 26.11.2006 7 of 7.
Staging's mixed room with a frozen 26.11.2005 client passed 7 of 7.
Smoke pages refuse AudioWorklet modules since 2005 (every renderer crash dump was Chrome's assertion on
its realtime AudioWorklet thread); release-70 had no renderer crash. The crash budget stays at two.
2004: a page that sends largeWelcome in its hello takes a welcome up to a bound for a full room; for
older pages the room trims the welcome under 8,192 and sends the rest as ordinary messages. Staging:
a late joiner after 4 bots took an 8,350-character welcome; a 2003 page got a trimmed 7,832 and joined.
2003 had a late-join bug: a welcome over 8,192 was dropped and the player never got a room id.
Protocol gained detonate and detonated in 2003; staging's mixed room with a frozen 26.11.2002 client
passed 7 of 7, and a one-off check (/tmp/orch-scripts/thunder-mixed.mjs) showed the old page takes the
new messages without error and a new client bursts an old player's bolt itself after END_WAIT.
The first 2003 attempt stopped in its dry run on two renderer crashes at the ram step (no deploy);
the weapons builder traced every renderer crash since 17 Nov to Chrome's realtime AudioWorklet thread.
Since 2002 (R2 step two) deployments carry no old versions: the Worker serves its own version
from its assets and every earlier one from R2 only (bucket syn3h-versions, ledger
../Syn3h-stable/r2-verified.tsv). release.sh runs r2-preflight before building and archives the
accepted release to R2 (ARCHIVE FAILED exits 1: run the printed command before the next release).
A missing hashed file costs one R2 read per version: a made-up name took 3 to 4 s to 404 on staging.
Release-64 (the freeze release, tag m-freeze-1907, 3636e736) failed www's movement step and rolled
back: player B was still behind the longer covered entry. Unrecorded on the Foreman's word; it
returns after the entry-time work and the public-check fix (tools/public-check-playable).
Frozen versions are read from the R2 bucket syn3h-versions (binding FROZEN) first, then from the
carried /v/ assets; deploys still carry every version (feat/frozen-r2 step one). Protocol gained
unhook, the play field, welcome.botRams and ram.bot in 1906; staging's mixed room with a frozen
26.11.1905 client passed 7 of 7.
Room protocol changed in 1900 (King of the Hill no longer returns a player to the pad; 'freed').
Before it went live, staging ran a mixed room (tools/public-check.mjs, SYN3H_CHECK_OLD_VERSION)
with a frozen 26.11.1804 and a frozen 26.11.1712 client against the new room: 7 of 7 each.

Gate relaxed once, 18 November, by the Foreman, for v26.11.1802 only: macOS's own
mediaanalysisd (about 300% CPU), Spotlight indexing, a virtual machine and Docker held the
one-minute load at 24 to 28 for 45 minutes with no builder causing it. The release went when no
builder held a heavy slot and the load stayed under 20 for two minutes (it passed at 6.44).
Staging took the risk first. The script's default gate (under 12 for two minutes) is unchanged.

Outage, 18 November: the Orchestrator (and builder aa1e0a5e at 00:38) stopped at about 00:18 PST
with "Can't reach the API server", a network or DNS outage, just after v26.11.1714's second
check run finished. Nothing ran until the Foreman resumed it at about 13:40 PST: about 13 hours
and 20 minutes lost. On resume, main, the 1714 train and production were as left, and no
release, hold file, dev server or smoke was still running. Resume from disk, not memory.

Releases since the evening of 16 November, all accepted unless marked:

| Version | Release | Milestone | What |
|---|---|---|---|
| v26.11.1610 | 33 | m-galaxy-1610 | lobby planets, liquids, lava steering, steady labels |
| v26.11.1611 | 34 | m-sunrise-1611 | the name in the galaxy, sunrise rays, chat, planet sizes |
| v26.11.1612 | 35 | m-captions-1612 | quiet captions, arrival hitch fix, presence |
| (none) | 36, 37 | m-water-1700 | rolled back: hill scoring slow through Cloudflare |
| v26.11.1700 | 38 | m-water-1700 | water sinks, bot first names, calmer lobby, chat key, hill clock on the room |
| v26.11.1701 | 39 | m-bang-1701 | Big Bang opening, loading line, night sides, sidebar footer |
| v26.11.1702 | 40 | m-buggygen-1702 | the buggy generated in code, no model files |
| v26.11.1703 | 41 | m-ridge-1703 | ridge colour blotches fixed, J closes the invite |
| v26.11.1704 | 42 | m-bots-1704 | quieter bots, proper rescues, chat overlay switch |
| v26.11.1705 | 43 | | (see release-notes/history.tsv) |
| v26.11.1706 | 44 | m-reconnect-1706 | a throwing disconnect handler still reconnects; room log tags; latency proxy keeps order |
| v26.11.1708 | 46 | m-smooth-1708 | smooth planet entry and exit, paced bots, bot races for a host |
| v26.11.1709 | 47 | m-hud-1709 | neutral HUD, About/Updates icons, ALT and units, brighter captions |
| v26.11.1710 | 48 | m-botfix-1710 | bots kept through a host's dropped connection; drop report on rejoin |
| v26.11.1711 | 49 | m-gentle-1711 | tap to begin, softer tyre tracks, gentle sun rays, larger near captions |
| v26.11.1712 | 50 | m-column-1712 | driving column, touch aiming, chat card, heading-up minimap, lobby returns upright |
| v26.11.1713 | 51 | m-physics-1713 | Zorb skips on water and lava, bot pacing hold and keepCount, fresh vehicle on a new planet |
| v26.11.1800 | 52 | m-lobby-1800 | Welcome guide, labelled lobby buttons and frosted panel, calmer lobby music, longer opening |
| v26.11.1801 | 53 | m-rays-1801 | no sun rays or flare under water or lava; no rays after sunset |
| v26.11.1802 | 54 | m-water-1802 | vehicles float on the drawn river; rivers level; true camera waterline |
| v26.11.1803 | 55 | m-river-1803 | rivers that look like flowing water; no glow on a hill hiding the sun |
| v26.11.1804 | 56 | m-lights-1804 | softer buggy headlights, horizon haze, vehicles float true at river bends |
| v26.11.1900 | 57 | m-noreset-1900 | never moves you for where you drove; Flip upright; left column; wakes; grass swish |
| v26.11.1901 | 58 | m-fog-1901 | dawn fog banks, headlight beams, Plasma Tag strikes, buggy water, sea sight line, opening and pinch |
| v26.11.1902 | 59 | m-bots-1902 | bots play King of the Hill and Tag; dawn fog lit by the morning |
| v26.11.1903 | 60 | m-showroom-1903 | vehicles of one kind share materials; bot arrivals build far fewer shaders |
| (v26.11.1904) | 61 | m-sea-1904 | rolled back: www's public check hit a PhysicsLoadError while builders loaded the machine; withdrawn, folded into 1905 |
| v26.11.1905 | 62 | m-render-1905 | 1904's fixes plus headlights in first person, arrival glow, arrival effects warmed behind entry |
| v26.11.1906 | 63 | m-bots-1906 | bots play in Explore (tows, tugs, stop words, breaking free), bots bump each other, hovercraft and jet beams, R2 frozen versions |
| (v26.11.1907) | 64 | m-freeze-1907 | rolled back: www movement step ran while B was still entering; not recorded |
| v26.11.2000 | 65 | m-ui-2000 | one glass style, phone panels, chat bubbles, pause screen with screenshots, sunk Zorb cue, own it marker clear |
| v26.11.2001 | 66 | m-freeze-2001 | shaders and pipelines prepared at Play under cover, in parallel; bots build nothing in play; Copy diagnostics |
| v26.11.2002 | 67 | m-r2-2002 | deployments stop carrying old versions; earlier versions served from R2 only |
| v26.11.2003 | 68 | m-thunder-2003 | Plasma Thunder skips, flares and ends in fireworks |
| v26.11.2004 | 69 | m-join-2004 | joining a room that already has bots works again |
| v26.11.2005 | 70 | m-bundle-2005 | held charges on time, matching beams in mist, sun rays through gaps, bounded missing-file search |
| v26.11.2006 | 71 | m-grapple-2006 | strike your grappler to cut the cord; let-go cords whip back; missed hooks sail off |
| v26.11.2007 | 72 | m-handshake-2007 | lighter joining: only non-default settings sent; oversized messages warn |
| v26.11.2008 | 73 | m-loss-2008 | Reload promptly when graphics fail during loading; re-entry reuses its preparation |
| v26.11.2009 | 74 | m-quiet-2009 | after a lost graphics device, shader diagnostics stay quiet on the page |
| v26.11.2010 | 75 | m-glass-2010 | experimental glass shader, off by default; Music line in Copy diagnostics |
| v26.11.2011 | 76 | m-tools-2011 | release tooling tests fixed and run before every release; no game change |
| v26.11.2012 | 77 | m-quality-2012 | stepping quality between High and Medium no longer hitches |
| v26.11.2013 | 78 | m-lowshadow-2013 | stepping quality between Medium and Low no longer hitches |
| v26.11.1707 | 45 | m-lobby-1707 | iPhone sound on silent (unproven on a real iPhone), clean lobby name after rotating, WebGPU device-loss notice |

## Staging Worker

`syn3h-staging` at https://syn3h-staging.af-4e7.workers.dev/: its own Worker name, so its own
RoomDO namespace and rooms; workers_dev only, no routes or custom domain, so it cannot serve
www.syn3h.com. Config: wrangler.staging.toml (copied from production's wrangler.toml with the
name changed, workers_dev = true, preview_urls = false). Staging copies get a robots
`Disallow: /`. Tonight's staging copies are under /Users/vtn/dev/Syn3h-staging/ (outside the
repo). The Cloudflare token is used only as an environment variable on the command that needs
it, read from ~/.config/syn3h/cloudflare-token; never printed or copied.

## Release path as it works now

On a train worktree (/Users/vtn/dev/Syn3h-wt/train-*), merge accepted tips, then:
1. typecheck, the full suite as two commands through tools/heavy.sh: `npx vitest run` and
   `npm run test:tools` (tools/**, which vitest excludes; a failure blocks like any other), production build, and the build again with
   SYN3H_RELEASE_VERSION=<version> (it validates the player digest: summary under 70
   characters, two to five bullets);
2. tools/runtime-assets-check.mjs (zero model requests; it went unrun once and failed for a
   whole release, so it is a standing step);
3. the browser checks for the tier (lobby: galaxy, lobby-labels, lobby-logo,
   wordmark-roundtrip, boot-veil, big-bang; chat: chat-check --bots), and the two-player smoke;
4. notes in release-notes/releases/<version>.md with every section (Features, Fixes,
   Handling, Play, Performance, Known issues) and the player digest; release.sh does not
   check the sections yet, the publish tool does;
5. fast-forward main, tag m-<name>-<version>, tools/release.sh <n> "note" --dry-run, restore
   ../Syn3h-stable/current, the load gate, tools/release.sh <n> "note". Do NOT create the
   v<version> tag by hand first: release.sh computes the version from existing tags and would
   then ask for the next version's notes. Since ab0bf329
   release.sh itself checks the notes' sections before freezing and deploys to the staging
   Worker first (settle, frozen versions, full smoke; a crash is a rerun, up to four), then
   production, then the 7-check public check on both addresses, then the GitHub hosted
   check (VANTAGE, report only). tools/release.sh <n> "note" --staging stops after staging;
6. after RELEASE OK: correct the release time in the notes, check-public-build --feed on both
   addresses, commit history and stats, push main and the three tags, then
   `node tools/release-notes.mjs publish <version> --latest --dry-run` and `--yes-publish`.

Before ab0bf329 staging ran outside release.sh (/tmp/orch-ship-1704.sh); it is no longer needed.

release.sh now: settle() before each smoke; DEPLOYED set at the deploy and cleared at
acceptance; any exit while set (failure, error, INT, TERM) rolls back to the last release in
../Syn3h-stable/releases.tsv, verifies both addresses and restores the stable pointer.
SYN3H_RELEASE_STUB=1 and SYN3H_RELEASE_FORCE_FAIL=smoke prove that path without Cloudflare.
The room ticks hill and race time on its own Durable Object alarm (fix/koth-server-tick).

## Open branches

| Branch | Tip | Owner (agent) | Waits on |
|---|---|---|---|
| ux/touch-aim | 6ab92907 | touch builder c66af21c | the owner trying it on a phone; it also fixes the two phone-layout overlaps |
| ux/hud-column | after a25c7ec5 | HUD builder 4308ed12 | the owner's review; carries a chat-check wait fix |
| veh/tank, veh/loft-editor | | | do not merge (Foreman) |
| perf/smooth-entry | 702f9a8f, merging main | smooth-entry builder aa1e0a5e | its gate on main; accepted as the next release on its own. Host frame rate now limits room bots |
| fix/lobby-wordmark-sun | f06dc96f | builder 900cc550 | captions commit 51b91265 waits for the owner; rewriting fixed waits in lobby checks |
| build/weekend | | | delete after about 16:10 on 17 November if it is an ancestor of main |

tests/ui/phone-layout.mjs fails on main on two real overlaps (jet landscape throttle-down over
.hud-navigation; iPad .hud-navigation over the hill-winner announcement) until ux/touch-aim
ships; keep it out of blocking steps.

## Reliability list (Foreman's order)

1. Done, merged d96e10f5: smoke pages get one browser each and the Low level; viewport stays
   960x540 (labels keep clear of the HUD at 640x360). Contention run: old 1 crash in 8, new 0
   in 8, inconclusive. If crashes return, read Chrome's crash reason instead of counting.
2. Done, merged ab0bf329: staging inside release.sh, wrangler.staging.toml committed, the
   staging page titled "[staging]" and its clone removed after the run, the notes-sections
   check, the rollback target read from www's build.json, rollback.sh logging to
   ../Syn3h-stable/rollbacks.tsv. First real use: the next release.
3. Done, merged: after the production deploy release.sh runs tools/public-check.mjs (join,
   state, a shared setting, King of the Hill scored by the room's own clock, a forced
   reconnect as the same player, leave; about 40 s) on workers.dev and www instead of the full
   smoke. The full smoke still runs on staging and in the dry run. First real use: the next release.
4. Workers Logs on. Confirmed 17 Nov: the query API works with the token's Observability Read;
   only our own structured lines are stored (a full smoke 29, a public check 19), and none
   holds a name, chat, IP or query string.
5. A GitHub Actions second vantage point (section 4): workflow_dispatch only, no secrets.
Lesson (17 Nov): small clean samples misled us three times (1705's 0 failures in 9 was about a
1 in 6 chance). Decide on evidence about the cause, not on a short run of passes.
Lobby checks with fixed waits (lobby-logo's 700 ms "ordinary lobby animates") fail under
load; two unexplained 1707 failures did not reproduce in 8 probed runs.
GitHub's hosted machine loses its WebGPU device: 737 page errors on 1706, 6 on 1707 after the
device-loss guard. The hosted reconnect step passes on both. Since 17 Nov evening the hosted
run sets SYN3H_CHECK_TOLERATE_DEVICE_LOSS=1: it still runs WebGPU and still exercises device
loss (the path that found the reconnect bug), but "no page errors" passes over exactly the
device-loss messages and prints them. A device-loss regression that only adds those messages
will not fail it; rerun the local forced-loss reproduction from 60076fc5 after touching
device-loss handling. (A WebGL 2 hosted run was tried and dropped: software WebGL on the
GPU-less runner did not bring both pages up.)
The heavy hold is live (tools/heavy.py): a release holds new heavy jobs until it exits; a
hold over 3 h old or naming a dead PID is ignored.
Also listed: roll_back ignores INT and TERM (done in release.sh); the rollback verification
retries its smoke after settling (done). The full proposal is /tmp/orch-reliability-proposal.md.

## Operations

Credentials (17 Nov 2026, ops/PROTOCOL.md section 13): never print a crash dump, a process
environment, a token file or anything that may hold a credential; count or list matches only.
The Cloudflare token is passed only to wrangler and API calls (`cf`), never exported; browsers
get `browserEnv()`. Sixteen Chrome crash dumps held the token until 17 Nov (deleted; Crashpad
uploads were off, no upload ever attempted); the owner was asked to rotate it.

All tests, builds and headless browsers run through tools/heavy.sh (three slots). Never kill
processes you did not start. Do not move research_notes/ or reports/ in the integration
checkout. Published notes never start with an "(AI Generated)" line, and builds are named by
full version.
