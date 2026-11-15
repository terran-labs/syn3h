# Orchestrator state

Written by the Orchestrator. Refreshed at each milestone tag. A fresh or compacted
Orchestrator should be able to resume from this file, `ops/BACKLOG.md`, `ops/LANES.md` and
`ops/PROTOCOL.md` alone. Times are Pacific; read the clock with `date`, never from memory.

Last refreshed: Saturday 14 November, 8:45pm PST. Demo: Sunday noon PST.

## Where things are

- Integration checkout: `/Users/vtn/dev/Syn3h`, branch `build/weekend`. Only the Orchestrator
  edits it. `main` is fast-forwarded to it at each milestone.
- Remote: `origin` = https://github.com/terran-labs/syn3h (public). Push `build/weekend`,
  `main` and tags after each milestone: `git branch -f main build/weekend && git push origin --all && git push origin --tags`.
- Tags: `m00-proposal` to `m13-night-glow-camera` (e4f2580). m13 is the release 1 candidate
  (dry run passed 6:34pm, frozen as `../Syn3h-stable/20261114-183353-e4f2580`); m12
  (87e9e34) is the rollback target. Trunk is ahead of m13 at cced254 (wings lift, ram flag
  follow-up, phone guest lobby); next tag is `m14`, held for the Vehicles lane's wing-lift
  fixes (fast water skip, release into flight).
- Tests: `npx tsc --noEmit` and `tools/heavy.sh npx vitest run --maxWorkers=2` (365 passing at
  cced254). Smoke: `node tools/smoke.mjs https://vorton-previews.tail285f88.ts.net:32782/ /tmp/x.png`
  (it appends `?autoplay=1`; for `?vehicle=jet` it holds R and W, because W alone is pitch).
  `node --test tools/serve-stable.test.mjs` for the stable server.

## Previews (managed broker, workspace `wks_cfcb37521a420b78`)

Helper: `node ~/.local/share/vorteo-native-preview/paseo-preview.mjs <start|restart|stop|status> <script> --workspace wks_cfcb37521a420b78`.
Scripts are in `paseo.json`.

| Script | URL | Notes |
|---|---|---|
| `dashboard` | https://vorton-previews.tail285f88.ts.net:32781/ | `dashboard/server.mjs` reads `dashboard/status.json` live and stamps the time itself. Restart after editing `server.mjs`. |
| `game` | https://vorton-previews.tail285f88.ts.net:32782/ | Vite dev server. A plugin in `vite.config.ts` spawns the room server on 8787 and proxies `/ws`. Restart after server or protocol changes. Merges show a reload notice instead of reloading. |
| `stable` | none | BLOCKED. `tools/promote-stable.sh "note"` builds a frozen snapshot in `../Syn3h-stable/<id>` and `tools/serve-stable.mjs` serves it (29 net checks pass), but the broker answers `failed: CalledProcessError` when asked to start a third service for this workspace. Cause unknown; possibly a per workspace limit. Do not work around the broker. |

Terrain Lab runs its own preview on port 32783.

## Preview outage, closed

All previews were down from 5:00pm to 6:38pm PST Saturday (tailnet scope change from the
owner's own iPad; the Foreman re-pinned the broker on his word). Dashboard and game were
restarted with `start` and verified through their links at 6:40pm. Broker commands are
allowed again, one at a time; if one hangs past 60 s stop it by PID and read
`~/.local/share/vorteo-native-preview/https-broker.stderr.log`.

The sound crash fix (cd0fe52) is verified on a local server: eight bots, then `gfx.level` 1
and `bots.count` 0, three rounds, physics still stepping, no errors.

## Lanes

Hand work to Codex and peer threads with `mcp__paseo__send_agent_prompt` (agent id). The
three subagents are in-process (Agent tool) and are resumed with `SendMessage`; they do not
survive a new Orchestrator thread, and their roles have moved to the peer lanes.

| Lane | Agent id | Worktree and branch | Dev port | Doing now |
|---|---|---|---|---|
| Foreman | c5dc3811-9bca-4a79-9c81-bcdfdf66908d | `/Users/vtn/dev/.vorteo/worktrees/2jg65r8u/foreman`, `ops/foreman` | none | Owner's conversation. Directs the Orchestrator only. Owns `ops/**` except this file. |
| Terrain Lab | 39e2a688-346b-4874-be02-46a7fe6f13ee | `.../2jg65r8u/terrain-lab`, `feat/terrain-lab` | 5191 | Owner's direct line. Last merged 59b9857 (spiral road). Bots on roads unverified. |
| Vehicles, shared code (Codex 1) | 8b09a27b-c89d-46b1-9e52-0951e4bd020f | `/Users/vtn/dev/Syn3h-wt/vehicles2`, `feat/vehicles2` | 5185 | See "Dispatched" below. Keep available for vehicle leads' requests. |
| Bots, Performance, QA (Codex 2) | 1e6bdac4-cef1-44c7-9768-1eae4b85ef3d | `/Users/vtn/dev/Syn3h-wt/fx`, `feat/fx` | 5186 | All delivered and merged through b7371e4. Idle. |
| UX and sound (Codex 3) | ba7d0154-b4d0-4b69-9008-805456c9fdde | `/Users/vtn/dev/Syn3h-wt/audio`, `feat/audio` | 5187 | See "Dispatched" below. |
| Multiplayer | 1aea4dff-9b45-4b17-ba36-116438350f17 | `/Users/vtn/dev/Syn3h-wt/net`, `feat/net` | 5183, room 8791 | New. Deployment prep, the 342 ms delay reading. |
| Syn3h buggy | 12abdd19-b672-40d7-938a-be2ab2339315 | `.../2jg65r8u/veh-buggy`, `veh/buggy` | 5201 | New. |
| Jet | e73e5ed4-a32d-468e-a2cc-cfda3c196288 | `.../2jg65r8u/veh-jet`, `veh/jet` | 5202 | New. |
| Hovercraft | 43191a2c-f8f5-4da4-b147-423a10dff345 | `.../2jg65r8u/veh-hovercraft`, `veh/hovercraft` | 5203 | New. |
| Classic buggy | 25c9c763-6966-410d-a9f9-0714245088d6 | `.../2jg65r8u/veh-classic-buggy`, `veh/classic-buggy` | 5204 | CLOSED by the owner Saturday about 5:10pm: off the MVP. Left a post-MVP TODO.md at the repo root. No code changes. Notes: twitchy at speed, tiny in the chase camera. |
| Tank | 1e12b353-8e53-4aaa-8784-7d148ebf9c28 | `.../2jg65r8u/veh-tank`, `veh/tank` | 5205 | RUNNING again: the owner wrote to it himself at 5:08pm, which supersedes the pause. Earlier notes: No code changes. Notes: climbs walls (tracks push about 5x its weight), pods dangle when airborne, spiral climb untested. |

Retired in-process subagents (work merged): buggy `af96d3463a8b76592`, multiplayer
`a1eae81e1306386c5`, terrain `a299bf2f70ffc6287`, sky `a9fb1d017a64aab40`. Retired branches:
`feat/sky`, `feat/terrain`, `feat/buggy`.

## Releases

- RELEASE 3 GATE (agreed with the Foreman, 8:40pm). Cut from trunk only when all hold:
  (1) Multiplayer's two-browser seam check, the Vehicles lane's per-vehicle seam review and
  QA's bots-on-wrap all pass; (2) the owner has driven across a seam and seen the opening
  view, the Dark Star look, Zorb and the paint; (3) the release opens on a world where the
  volcano is visible from the spawn pad: if round planets cannot do that at the default size,
  the default stays flat (`world.curve` 0) for release 3 and round is a lobby choice;
  (4) every vehicle is clean on the frozen build in Chrome and WebKit, and the dry run passes
  on the final tag. If not all true by 9am Sunday, the demo runs release 2 and the rest is
  shown on the preview from this Mac. The score ships as default only on the owner's word
  (latest: "still ok, still no chills").
- DEPLOY RULES: no release while anyone is playing, and none after 10am Sunday without the
  owner's word. About five minutes after a deploy every occupied room is reset: players
  reconnect in about a second, world settings survive, scores, round, "it" and host restart
  (docs/CUTOVER.md, "Releasing while people are playing"). The Foreman's sweeps end at
  9:30pm Saturday; after that digests and this file are the record. The Foreman has asked the
  owner about a 9:30pm feature freeze; until answered, nothing new starts that cannot be
  finished and gated tonight.
- LIVE: release-2 = `m14.2-release2` (bc8cb48, branch `release/2`): m14 plus gallery models
  out of the build, the recorded default track, the jet texture race fix (fe45b14) and the
  buggy wheels-forward fix (0add867). Shipped 8:07pm PST. Worker version 747d2041, frozen copy
  `../Syn3h-stable/20261114-200625-bc8cb48`. Back to release 1 in seconds: `tools/rollback.sh`
  from this checkout with the token in the environment. Release branches are cut from a tag
  and take cherry-picked fixes only, so trunk can carry unseen features. Releases are run
  from the release worktree; `Syn3h-wt/Syn3h-stable` is now a link to `../Syn3h-stable`.
- MERGING: never merge in this checkout (the live preview serves it). Merge and test in the
  staging worktree `/Users/vtn/dev/Syn3h-wt/staging` (branch `staging`, vite on port 5179 with
  `SYN3H_NO_ROOM_SERVER=1`), then `git merge --ff-only staging` here. A conflicted merge here
  broke the preview for two minutes at 7:40pm.
- Before any release: check every vehicle on the frozen build in WebKit 2388 as well as
  Chrome (`/tmp/syn3h-research/tools/webkit2.mjs` pattern). The jet black screen in Safari
  was invisible to Chrome smoke.
- PREVIOUS: release-1 = `m13.1-steering` (ee73e41, branch `release/1`, worktree
  `/Users/vtn/dev/Syn3h-wt/release`): m13 plus the buggy steering and upright ram flag fixes.
  https://www.syn3h.com/ (Custom Domain, attached 7:13pm PST) and
  https://syn3h.af-4e7.workers.dev/. Worker `syn3h`, versions 9c01cffa (release) and bde1abd6
  (with the domain). Frozen copy `../Syn3h-stable/20261114-190707-ee73e41`. DNS export
  `../Syn3h-stable/dns/20261114-190836`. Undo the cutover (old site back at www), from this
  checkout with the token in the environment:
  `tools/domain.sh rollback ../Syn3h-stable/dns/20261114-190836 www.syn3h.com`.
  There is no earlier Worker release to roll back to. Only www is attached; the apex still
  points at the old host, which redirects it to www.
- The token (`~/.config/syn3h/cloudflare-token`) expires Monday 16 November at midnight
  Pacific and can edit every Worker in the account, including the owner's
  `aubreyfalconer-com`: touch nothing but the Worker named `syn3h`.
- Release 2 will be `m14` from trunk. Foreman's order of importance: iPad black screen
  findings, wing-lift fixes, rear-end shove, share tags on www (all on trunk except an iPad
  cause). New features stay out unless the owner has seen or heard them. Tell the Foreman
  before shipping. Release from the integration checkout so the store is `../Syn3h-stable`
  (releasing from the release worktree wrote to `Syn3h-wt/Syn3h-stable`; both copies exist).
- Broker commands can take over a minute when lanes queue behind each other: wait up to
  150 s before stopping a helper; stopping at 60 s left the dashboard half restarted.
- Wrapping, curved world (owner's order via Terrain Lab, 7:20pm): lands in every lane behind
  `terrain.wrapSize` and `world.curve`. Ships to the public only when complete in every lane,
  the seam passes two-player, bot chase and ram checks, and the owner has driven across a
  seam; otherwise the demo runs the last release without it. Decision point 9am Sunday.

- `tools/release.sh <n> "note"` from a clean, tagged integration checkout: freezes the build,
  deploys from the frozen copy with wrangler, runs the two player network test against the
  public address, tags `release-<n>`. `--dry-run` does everything but deploy and passed on
  m11-rc1 (direct and through 150 ms latency). `tools/rollback.sh` puts the previous one back.
- Cloudflare: workers.dev subdomain is `af-4e7` (release 1 will be
  https://syn3h.af-4e7.workers.dev/), no Worker named `syn3h` exists, plan was free at 6:20pm
  and the owner is upgrading to Workers Paid. Access arrives as one API token in the file
  `~/.config/syn3h/cloudflare-token` (mode 600), not there at 6:40pm. Read it into
  `CLOUDFLARE_API_TOKEN` for the release and domain commands only; never echo it or write it
  to a log, commit or this file. Keep the WebSocket relay; no WebRTC tonight.
- CUTOVER ORDERED: the owner said "Cut over ASAP" at 6:25pm (relayed by the Foreman, recorded
  in ops/DECISIONS.md), waiving "after he has seen release 1". When the token exists, in
  order: (1) verify the token (tokens/verify active) and that the syn3h.com zone is visible,
  else stop; (2) `tools/release.sh 1 "note"` from the tagged candidate, all checks green;
  (3) only then `tools/domain.sh export`, confirm it touches only web records at
  www.syn3h.com, `tools/domain.sh attach release-1 www.syn3h.com --owner-approved` (www only,
  never the apex, never MX or TXT); (4) runbook checks incl. apex still redirects and MX/TXT
  match the export; (5) send the Foreman the address, tag, each check result, export path
  and rollback command. Stop and report on any failed check, on non-web records at www, or
  on anything outside the runbook. If the plan is still free, say so but do not block.
  Ship m13 as release 1 and cut over without waiting for m14 (Foreman, 6:57pm). m14 goes
  out as release 2 once green and dry run: tell the Foreman before shipping it. After a
  verified cutover the share tags move to https://www.syn3h.com in the next release.
- syn3h.com: `tools/domain.sh` and `docs/CUTOVER.md`. Never part of a normal release.
- Local verification while previews are down: `npx vite --host 127.0.0.1 --port 5173 --strictPort`
  in the integration checkout (it spawns the room server on 8787), then
  `tools/heavy.sh node tools/smoke.mjs http://127.0.0.1:5173/ /tmp/x.png`. Stop both by PID.

## Standing owner decisions (see ops/DECISIONS.md for the record)

- Syn3h is the reference, not Mars Explorer. Every world is an island. Sliders for everything.
- No death or violence in any world (Saturday about 5:10pm): lava is sticky and makes things
  glow, vehicles are indestructible, nothing is "eliminated". Routed to Multiplayer, Vehicles,
  UX and Bots. Laser tag is unchanged until he answers the Foreman's question: no lane may
  rename or remove lasers on its own reading.
- Classic buggy is off the MVP and its lane is closed; tank lane is paused.
- Accounts: Claude 1 and Codex 1, 2, 3. Never start anything on Claude 2. Observed, not yet
  confirmed by him: the owner himself has switched the UX, jet and hovercraft threads to
  Claude 2. Threads he switches may stay there.

## Recent owner decisions (after 6pm Saturday)

- Shores stay wild (guaranteed beaches were built and reverted).
- "Buggies should float very aggressively when their force field wings are deployed. This
  allows them to climb out of any situation." Built by the Vehicles lane: `liquid.wingLift`
  (world, default 18), `Vehicle.canLiftOut` for a HUD hint "Space: wings to lift out".
- Laser tag is "tag beams"; no weapon or death words in player text.
- UX thread (Codex 3): send it nothing until the Foreman relays the owner's answer. Its
  queue: the wings hint from `player.canLiftOut`, absolute og:image and og:url, and making
  "R to lift off" obvious on the jet (W alone does nothing on a parked jet).

## Closed defects

Buggy teleport immobility (c201e46), verified by 30 of 30 two-player rams; upright buggies no
longer flag as inverted on a ram (8cb4a14, Multiplayer to rerun `tools/ram-inverted-repro.mjs`
once its handoff merges); night glow; shore camera.

## Rules that have bitten us

- Machine load reached 69 on Saturday at 4:53pm with ten lanes active. Every heavy job goes
  through `tools/heavy.sh <command>` (three machine-wide slots). One dev server per lane.
- Role briefs live on each lane's own branch, not on trunk: a brief on trunk gives every
  other lane an add/add conflict.

- Account rule from the owner: Claude 1 and Codex 1, 2, 3 only. Never Claude 2. This thread
  cannot launch workers (its preset is pinned to Claude 2); the owner or Foreman starts
  threads and the Orchestrator directs them by message.
- `pkill` and `killall` are forbidden outright, for every lane. Twice on Saturday a name-based
  kill did damage: once it took down the preview's room server, and at 5:30pm a malformed
  `pkill -f` (macOS treats every extra word as another pattern) terminated every lane's dev
  and room servers plus the owner's Chrome, Claude app and the Vorteo host daemons. Stop a
  process with `kill <pid>` after finding the PID with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`.
- Headless Chrome frame rates are misleading (84 ms headless against 8 ms headed for the
  same scene). Do not report them as game performance.
- Merge conflicts in `src/audio/index.ts` and `src/ui/Shell.ts` have gone to the UX lane's
  version. `src/main.ts` is the Orchestrator's; builders send wiring lines.
- After `git merge`, always run `npx tsc --noEmit`: seams break at types first.
- Hand written times were wrong for hours on the dashboard. Use `date`.

## Wiring owned by the Orchestrator

`src/main.ts` (composition root), `vite.config.ts`, `paseo.json`, `package.json`,
`dashboard/**`, `tools/smoke.mjs`, `tools/promote-stable.sh`, `ops/STATE.md`.

## Owed and open

- Stable channel has no link (see Previews). Cloudflare deploy would replace it.
- Multiplayer handoff pending (8d3c67a and later on feat/net): tag beam night colour, room
  hardening, interpolation delay cap, venue fallback runbook, loss and stall report.
- Nobody has driven the game by hand or heard the sound.
- Lobby vehicle change reloads the page (a deliberate shortcut in `main.ts`).
- Remote players are not yet in `audio.setVehicles` (bots are).
- Mid-range laptop and phone frame rates unmeasured.
- Owner to revoke the Google Maps, Bing and WRLD keys in `legacy-unity-syn3h-client`.
