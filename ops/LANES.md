# Lanes

Who owns what, and whether anyone is home. Checked by the Foreman on Saturday 14 November
at 4:30pm Pacific, corrected by the Orchestrator at 4:40pm. The Orchestrator corrects this file's ownership column; the Foreman
refreshes the thread column on each sweep.

| Lane | Branch | Thread at 7:00pm | Owns |
|---|---|---|---|
| Orchestrator | `build/weekend` | Running; release 1 candidate m13.1 frozen, waiting on the Cloudflare token | Merges, full test suite, previews, dashboard, `main.ts` wiring, `ops/STATE.md`, `vite.config.ts`, `paseo.json`, `package.json`, `tools/smoke.mjs`, production releases |
| Foreman | `ops/foreman` | Running | `ops/**` except `ops/STATE.md` |
| Terrain Lab | `feat/terrain-lab` | Running, with the owner; preview on 32783 is back | Island generator, planet recipes, lava, fog defaults, `src/world/terrain/volcanics.ts`, `tools/terrainlab` |
| Vehicles (Codex 1) | `feat/vehicles2` | Running again on a Claude account, with two helpers: Zorb mode, and a stepped frame governor | Shared vehicle code: `Vehicle.ts`, `unityBody.ts`, `lava.ts`, `index.ts`, shared skins, `src/vehicles/effects/` |
| Bots, Performance and QA (Codex 2) | `feat/fx` | Running: iPad black screen, graphics level switch, diagnostic overlay | Bots, camera (`ChaseCamera.ts`), graphics levels (`quality.ts`), `resume.ts`, QA sweeps, `tools/drive-capture.mjs`, `tools/serve-stable.mjs`, `tools/manual-reload.mjs` |
| UX (thread named Codex 3) | `feat/audio` | Running, with the owner | Lobby, HUD, menus, demo features, `src/audio/**`, `src/ui/data/**`, sky colour and time of day defaults |
| Multiplayer | `feat/net` | Not listed as running at 7:00pm; rear-end shove dispatched | Networking, room server, modes, release and domain tooling, `docs/CUTOVER.md` |
| Syn3h buggy | `veh/buggy` | Running, with the owner, and one helper: wheel motors and wing struts | `Syn3hBuggy.ts`, its skin, model, test and `buggy.*` defaults |
| Jet | `veh/jet` | Running, with the owner | See its brief on `veh/jet` |
| Hovercraft | `veh/hovercraft` | Not listed at 7:00pm | See its brief on `veh/hovercraft` |
| Tank | `veh/tank` | Running, with the owner | See its brief on `veh/tank` |
| Music | trunk | New thread started by the owner at 6:28pm; synthesised adaptive score merged as the default music | Soundtrack |
| Classic buggy | `veh/classic-buggy` | Closed by the owner. Off the MVP | See `TODO.md` at the repo root |

Retired branches, fully merged and far behind: `feat/sky`, `feat/terrain`, `feat/buggy`.

## Notes

- The five vehicle branches and `feat/net` were each 9 to 23 commits behind `build/weekend`
  at 4:30pm. Each must merge `build/weekend` before its first change.
- A vehicle lead and the Vehicles lane both touch `src/vehicles/`. The fence between them is
  in each `VEHICLE-BRIEF.md`: per vehicle files to the lead, shared files to Vehicles.
- Accounts: Claude 1 and Codex 1, 2 and 3. The owner has since moved the UX, Multiplayer
  and vehicle lead threads to a second Claude account himself. Agents start nothing on it.
