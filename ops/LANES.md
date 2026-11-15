# Lanes

Who owns what, and whether anyone is home. Checked by the Foreman on Saturday 14 November
at 4:30pm Pacific, corrected by the Orchestrator at 4:40pm. The Orchestrator corrects this file's ownership column; the Foreman
refreshes the thread column on each sweep.

| Lane | Branch | Thread at 6:00pm | Owns |
|---|---|---|---|
| Orchestrator | `build/weekend` | Idle since 5:56pm, waiting on Cloudflare access; untagged merges on trunk | Merges, full test suite, previews, dashboard, `main.ts` wiring, `ops/STATE.md`, `vite.config.ts`, `paseo.json`, `package.json`, `tools/smoke.mjs`, production releases |
| Foreman | `ops/foreman` | Running | `ops/**` except `ops/STATE.md` |
| Terrain Lab | `feat/terrain-lab` | Running; its two helpers errored at 5:30pm and were not restarted | Island generator, planet recipes, lava, fog defaults, `src/world/terrain/volcanics.ts`, `tools/terrainlab` |
| Vehicles (Codex 1) | `feat/vehicles2` | Running: classic buggy contact fix, alpine road | Shared vehicle code: `Vehicle.ts`, `unityBody.ts`, `lava.ts`, `index.ts`, shared skins, `src/vehicles/effects/` |
| Bots, Performance and QA (Codex 2) | `feat/fx` | Running: alpine and desert bot runs | Bots, camera (`ChaseCamera.ts`), graphics levels (`quality.ts`), `resume.ts`, QA sweeps, `tools/drive-capture.mjs`, `tools/serve-stable.mjs`, `tools/manual-reload.mjs` |
| UX (thread named Codex 3) | `feat/audio` | Idle since 5:58pm; planets in the lobby merged | Lobby, HUD, menus, demo features, `src/audio/**`, `src/ui/data/**`, sky colour and time of day defaults |
| Multiplayer | `feat/net` | Running: loss study, venue fallback | Networking, room server, modes, release and domain tooling, `docs/CUTOVER.md` |
| Syn3h buggy | `veh/buggy` | Running | `Syn3hBuggy.ts`, its skin, model, test and `buggy.*` defaults |
| Jet | `veh/jet` | Idle, waiting on the owner's drive | See its brief on `veh/jet` |
| Hovercraft | `veh/hovercraft` | Idle, waiting on the owner's drive | See its brief on `veh/hovercraft` |
| Tank | `veh/tank` | Idle, waiting on the owner's drive | See its brief on `veh/tank` |
| Classic buggy | `veh/classic-buggy` | Closed by the owner. Off the MVP | See `TODO.md` at the repo root |

Retired branches, fully merged and far behind: `feat/sky`, `feat/terrain`, `feat/buggy`.

## Notes

- The five vehicle branches and `feat/net` were each 9 to 23 commits behind `build/weekend`
  at 4:30pm. Each must merge `build/weekend` before its first change.
- A vehicle lead and the Vehicles lane both touch `src/vehicles/`. The fence between them is
  in each `VEHICLE-BRIEF.md`: per vehicle files to the lead, shared files to Vehicles.
- Accounts: Claude 1 and Codex 1, 2 and 3. The owner has since moved the UX, Multiplayer
  and vehicle lead threads to a second Claude account himself. Agents start nothing on it.
