# Lanes

Who owns what, and whether anyone is home. Checked by the Foreman on Saturday 14 November
at 4:30pm Pacific, corrected by the Orchestrator at 4:40pm. The Orchestrator corrects this file's ownership column; the Foreman
refreshes the thread column on each sweep.

| Lane | Branch | Thread at 4:40pm | Owns |
|---|---|---|---|
| Orchestrator | `build/weekend` | Running (Claude 1, Fable) | Merges, full test suite, previews, dashboard, `main.ts` wiring, `ops/STATE.md`, `vite.config.ts`, `paseo.json`, `package.json`, `tools/smoke.mjs` |
| Foreman | `ops/foreman` | Running | `ops/**` except `ops/STATE.md` |
| Terrain Lab | `feat/terrain-lab` | Idle since 4:24pm, merged | Island generator, lava, fog defaults, `src/world/terrain/volcanics.ts`, `tools/terrainlab` |
| Vehicles (Codex 1) | `feat/vehicles2` | Running: fewer draw calls for bots and remote vehicles | Shared vehicle code: `Vehicle.ts`, `unityBody.ts`, `lava.ts`, `index.ts`, shared skins, `src/vehicles/effects/` |
| Bots, Performance and QA (Codex 2) | `feat/fx` | Idle since about 4:35pm, merged | Bots, camera (`ChaseCamera.ts`), graphics levels (`quality.ts`), `resume.ts`, QA sweeps, `tools/drive-capture.mjs`, `tools/serve-stable.mjs`, `tools/manual-reload.mjs` |
| UX (Codex 3) | `feat/audio` | Running: brighter first impression | Lobby, HUD, menus, demo features, `src/audio/**`, `src/ui/data/**`, sky colour and time of day defaults |
| Multiplayer | `feat/net` | Started 4:35pm (Claude 1, Opus) | Networking, room server, modes, deployment |
| Syn3h buggy | `veh/buggy` | Started 4:34pm (Claude 1, Opus) | `Syn3hBuggy.ts`, its skin, model, test and `buggy.*` defaults |
| Classic buggy | `veh/classic-buggy` | Paused by the owner at 4:57pm | See its `VEHICLE-BRIEF.md` |
| Jet | `veh/jet` | Started 4:35pm (Claude 1, Opus) | See its `VEHICLE-BRIEF.md` |
| Hovercraft | `veh/hovercraft` | Started 4:35pm (Claude 1, Opus) | See its `VEHICLE-BRIEF.md` |
| Tank | `veh/tank` | Paused by the owner at 4:57pm | See its `VEHICLE-BRIEF.md` |

Retired branches, fully merged and far behind: `feat/sky`, `feat/terrain`, `feat/buggy`.

## Notes

- The five vehicle branches and `feat/net` were each 9 to 23 commits behind `build/weekend`
  at 4:30pm. Each must merge `build/weekend` before its first change.
- A vehicle lead and the Vehicles lane both touch `src/vehicles/`. The fence between them is
  in each `VEHICLE-BRIEF.md`: per vehicle files to the lead, shared files to Vehicles.
- Accounts allowed by the owner: Claude 1 and Codex 1, 2 and 3. Never Claude 2.
