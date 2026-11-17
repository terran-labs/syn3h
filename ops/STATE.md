# Orchestrator state

Last verified: 2026-11-17 06:30 PST, by the Orchestrator. A replacement resumes from here.

## Authority

Only the Orchestrator integrates and deploys, on the Foreman's word (Foreman agent
c5dc3811-9bca-4a79-9c81-bcdfdf66908d). Overnight releases are authorized; the owner is asleep.
Every release goes through staging, the dry run and the load gate (one-minute load under 12
for two minutes). A failed live check rolls back by itself; then stop and report, do not retry.

## Production

Live: v26.11.1704 (release-42), source e0145f7a, frozen copy 20261117-052057-e0145f7a,
Worker version 64840a85, at https://www.syn3h.com/ since 17 November 05:37 PST. Main is
d96e10f5 (the release record plus the merged test-browser change, tooling only).

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
1. typecheck, full suite, production build, and the build again with
   SYN3H_RELEASE_VERSION=<version> (it validates the player digest: summary under 70
   characters, two to five bullets);
2. tools/runtime-assets-check.mjs (zero model requests; it went unrun once and failed for a
   whole release, so it is a standing step);
3. the browser checks for the tier (lobby: galaxy, lobby-labels, lobby-logo,
   wordmark-roundtrip, boot-veil, big-bang; chat: chat-check --bots), and the two-player smoke;
4. notes in release-notes/releases/<version>.md with every section (Features, Fixes,
   Handling, Play, Performance, Known issues) and the player digest; release.sh does not
   check the sections yet, the publish tool does;
5. staging: freeze, carry frozen versions, deploy with --config wrangler.staging.toml,
   settle (check-public-build five passes in a row), frozen-versions check, three full smokes
   with shot evidence (a Chrome crash is a rerun);
6. fast-forward main, tag m-<name>-<version>, tools/release.sh <n> "note" --dry-run, restore
   ../Syn3h-stable/current, the load gate, tools/release.sh <n> "note";
7. after RELEASE OK: correct the release time in the notes, check-public-build --feed on both
   addresses, commit history and stats, push main and the three tags, then
   `node tools/release-notes.mjs publish <version> --latest --dry-run` and `--yes-publish`.

The script used tonight for steps 5 and 6 is /tmp/orch-ship-1704.sh (copy and adapt).

release.sh now: settle() before each smoke; DEPLOYED set at the deploy and cleared at
acceptance; any exit while set (failure, error, INT, TERM) rolls back to the last release in
../Syn3h-stable/releases.tsv, verifies both addresses and restores the stable pointer.
SYN3H_RELEASE_STUB=1 and SYN3H_RELEASE_FORCE_FAIL=smoke prove that path without Cloudflare.
The room ticks hill and race time on its own Durable Object alarm (fix/koth-server-tick).

## Open branches

| Branch | Tip | Owner (agent) | Waits on |
|---|---|---|---|
| reliability/staging | in progress | Orchestrator | item 2 below; Foreman reviews the diff before use |
| ux/touch-aim | 6ab92907 | touch builder c66af21c | the owner trying it on a phone; it also fixes the two phone-layout overlaps |
| ux/hud-column | after a25c7ec5 | HUD builder 4308ed12 | the owner's review; carries a chat-check wait fix |
| veh/tank, veh/loft-editor | | | do not merge (Foreman) |
| perf/smooth-entry | | smooth-entry builder | held |
| build/weekend | | | delete after about 16:10 on 17 November if it is an ancestor of main |

tests/ui/phone-layout.mjs fails on main on two real overlaps (jet landscape throttle-down over
.hud-navigation; iPad .hud-navigation over the hill-winner announcement) until ux/touch-aim
ships; keep it out of blocking steps.

## Reliability list (Foreman's order)

1. Done, merged d96e10f5: smoke pages get one browser each and the Low level; viewport stays
   960x540 (labels keep clear of the HUD at 640x360). A contention run (8 against 8 with
   galaxy.mjs looping) is pending a report.
2. In progress on reliability/staging: staging folded into release.sh (deploy, settle, frozen
   versions, smoke with crash-is-a-rerun and a cap, then production), wrangler.staging.toml
   committed, the notes-sections check before tagging, and rollback.sh recording what it did so
   the automatic rollback target is right after a hand rollback. Prove with the stub and one
   dry run; send the Foreman the diff before a real release uses it.
3. The short public check (proposal section 1).
4. Workers Logs on, with head sampling (section 5).
5. A GitHub Actions second vantage point (section 4): workflow_dispatch only, no secrets.
Also listed: roll_back ignores INT and TERM (done in release.sh); the rollback verification
retries its smoke after settling (done). The full proposal is /tmp/orch-reliability-proposal.md.

## Operations

All tests, builds and headless browsers run through tools/heavy.sh (three slots). Never kill
processes you did not start. Do not move research_notes/ or reports/ in the integration
checkout. Published notes never start with an "(AI Generated)" line, and builds are named by
full version.
