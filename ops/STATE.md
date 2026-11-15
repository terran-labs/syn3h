# Orchestrator state

Written by the Orchestrator. Refreshed at each milestone tag. A fresh or compacted
Orchestrator should be able to resume from this file, `ops/BACKLOG.md`, `ops/LANES.md` and
`ops/PROTOCOL.md` alone. Times are Pacific; read the clock with `date`, never from memory.

Last refreshed: Saturday 14 November, 4:35pm PST. Demo: Sunday noon PST.

## Where things are

- Integration checkout: `/Users/vtn/dev/Syn3h`, branch `build/weekend`. Only the Orchestrator
  edits it. `main` is fast-forwarded to it at each milestone.
- Remote: `origin` = https://github.com/terran-labs/syn3h (public). Push `build/weekend`,
  `main` and tags after each milestone: `git branch -f main build/weekend && git push origin --all && git push origin --tags`.
- Tags: `m00-proposal` to `m08-sound-and-spiral-road`. Next is `m09`.
- Tests: `npx tsc --noEmit` and `npx vitest run --maxWorkers=2` (234 passing). Smoke:
  `node tools/smoke.mjs https://vorton-previews.tail285f88.ts.net:32782/ /tmp/x.png`
  (it appends `?autoplay=1`). `node --test tools/serve-stable.test.mjs` for the stable server.

## Previews (managed broker, workspace `wks_cfcb37521a420b78`)

Helper: `node ~/.local/share/vorteo-native-preview/paseo-preview.mjs <start|restart|stop|status> <script> --workspace wks_cfcb37521a420b78`.
Scripts are in `paseo.json`.

| Script | URL | Notes |
|---|---|---|
| `dashboard` | https://vorton-previews.tail285f88.ts.net:32781/ | `dashboard/server.mjs` reads `dashboard/status.json` live and stamps the time itself. Restart after editing `server.mjs`. |
| `game` | https://vorton-previews.tail285f88.ts.net:32782/ | Vite dev server. A plugin in `vite.config.ts` spawns the room server on 8787 and proxies `/ws`. Restart after server or protocol changes. Merges show a reload notice instead of reloading. |
| `stable` | none | BLOCKED. `tools/promote-stable.sh "note"` builds a frozen snapshot in `../Syn3h-stable/<id>` and `tools/serve-stable.mjs` serves it (29 net checks pass), but the broker answers `failed: CalledProcessError` when asked to start a third service for this workspace. Cause unknown; possibly a per workspace limit. Do not work around the broker. |

Terrain Lab runs its own preview on port 32783.

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
| Classic buggy | 25c9c763-6966-410d-a9f9-0714245088d6 | `.../2jg65r8u/veh-classic-buggy`, `veh/classic-buggy` | 5204 | PAUSED by the owner Saturday 4:57pm for the night. No code changes. Notes: twitchy at speed, tiny in the chase camera. |
| Tank | 1e12b353-8e53-4aaa-8784-7d148ebf9c28 | `.../2jg65r8u/veh-tank`, `veh/tank` | 5205 | PAUSED by the owner Saturday 4:57pm for the night. No code changes. Notes: climbs walls (tracks push about 5x its weight), pods dangle when airborne, spiral climb untested. |

Retired in-process subagents (work merged): buggy `af96d3463a8b76592`, multiplayer
`a1eae81e1306386c5`, terrain `a299bf2f70ffc6287`, sky `a9fb1d017a64aab40`. Retired branches:
`feat/sky`, `feat/terrain`, `feat/buggy`.

## Rules that have bitten us

- Machine load reached 69 on Saturday at 4:53pm with ten lanes active. Every heavy job goes
  through `tools/heavy.sh <command>` (three machine-wide slots). One dev server per lane.
- Role briefs live on each lane's own branch, not on trunk: a brief on trunk gives every
  other lane an add/add conflict.

- Account rule from the owner: Claude 1 and Codex 1, 2, 3 only. Never Claude 2. This thread
  cannot launch workers (its preset is pinned to Claude 2); the owner or Foreman starts
  threads and the Orchestrator directs them by message.
- Never `pkill` by name: it once killed the preview's room server. Stop by PID.
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
- Cloudflare access from the owner. Deploy is `npm run build && npx wrangler deploy` from
  `build/weekend`; then give the address to UX for the share card and QR.
- Nobody has driven the game by hand or heard the sound.
- Lobby vehicle change reloads the page (a deliberate shortcut in `main.ts`).
- Remote players are not yet in `audio.setVehicles` (bots are).
- Mid-range laptop and phone frame rates unmeasured.
- Owner to revoke the Google Maps, Bing and WRLD keys in `legacy-unity-syn3h-client`.
