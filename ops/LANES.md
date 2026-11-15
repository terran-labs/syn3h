# Lanes

Who owns what, and whether anyone is home. Checked by the Foreman on Saturday 14 November
at 4:30pm Pacific. The Orchestrator corrects this file's ownership column; the Foreman
refreshes the thread column on each sweep.

| Lane | Branch | Thread at 4:30pm | Owns |
|---|---|---|---|
| Orchestrator | `build/weekend` | Running (Claude 1, Fable) | Merges, full test suite, previews, dashboard, `main.ts` wiring, `ops/STATE.md` |
| Foreman | `ops/foreman` | Running | `ops/**` except `ops/STATE.md` |
| Terrain Lab | `feat/terrain-lab` | Idle since 4:24pm, merged | Island generator, lava, fog, `tools/terrainlab` |
| Vehicles (Codex 1) | `feat/vehicles2` | Idle since 4:06pm, merged | Shared vehicle code: `Vehicle.ts`, `unityBody.ts`, `lava.ts`, `index.ts`, shared skins, `src/vehicles/effects/` |
| Bots, Performance and QA (Codex 2) | `feat/fx` | Running, 2 commits unmerged | Bots, camera, graphics levels, QA sweeps, stable channel |
| UX (Codex 3) | `feat/audio` | Idle since 4:25pm, merged | Lobby, HUD, menus, demo features, sound |
| Multiplayer | `feat/net` | Started 4:35pm (Claude 1, Opus) | Networking, room server, modes, deployment |
| Syn3h buggy | `veh/buggy` | Started 4:34pm (Claude 1, Opus) | `Syn3hBuggy.ts`, its skin, model, test and `buggy.*` defaults |
| Classic buggy | `veh/classic-buggy` | Started 4:35pm (Claude 1, Opus) | See its `VEHICLE-BRIEF.md` |
| Jet | `veh/jet` | Started 4:35pm (Claude 1, Opus) | See its `VEHICLE-BRIEF.md` |
| Hovercraft | `veh/hovercraft` | Started 4:35pm (Claude 1, Opus) | See its `VEHICLE-BRIEF.md` |
| Tank | `veh/tank` | Started 4:35pm (Claude 1, Opus) | See its `VEHICLE-BRIEF.md` |

Retired branches, fully merged and far behind: `feat/sky`, `feat/terrain`, `feat/buggy`.

## Notes

- The five vehicle branches and `feat/net` were each 9 to 23 commits behind `build/weekend`
  at 4:30pm. Each must merge `build/weekend` before its first change.
- A vehicle lead and the Vehicles lane both touch `src/vehicles/`. The fence between them is
  in each `VEHICLE-BRIEF.md`: per vehicle files to the lead, shared files to Vehicles.
- Accounts allowed by the owner: Claude 1 and Codex 1, 2 and 3. Never Claude 2.
