# Pursuit bots

Add these lines to the composition root after creating the local player:

```ts
import { BotManager } from './bots/BotManager'

const bots = game.add(new BotManager(game, terrain, player))
bots.setTargets([player])
```

Include `bots` in the `window.syn3h` debug handles if desired. The module registers the Bots parameters; `params.set('bots.count', 5)` spawns five bots on the next rendered frame. Count defaults to zero. The slider accepts up to sixteen, while local graphics budgets cap active host bots at two, four or eight. Import `src/bots/params.ts` on a server that validates shared parameters, or move those declarations into shared code during integration.

Every client may create a manager. Networking must set `manager.remote = true` on non-hosts before simulation; this immediately disposes all managed effects, brains and vehicles. Remote managers never spawn bots. Networking owns its separate remote copies. Host takeover spawns fresh vehicles on the next update. `isLocal = false` prevents keyboard reads here; it does not prevent the vehicle's forces from running. Do not give a host-owned bot a remote interpolation controller on the same host.

`bots.setTargets([player, ...remoteVehicles])` replaces available targets. Target mode 0 follows the explicit local player; mode 1 selects the nearest supplied vehicle, excluding itself. Add `...bots.vehicles` to that list if bots should attack each other. Refresh the list after joins, leaves or population changes. `game.remove(bots)` unregisters every brain and vehicle and removes their Rapier bodies.

The controller writes `input.fire` in one-step pulses when the fire interval passes and the terrain ray is clear. Actual firing requires the weapon system. The placeholder vehicle has no weapon implementation.

## Port sources

- `VhiclBot.cs:35-55`: wrapped yaw, 20 degree steering scale, 2 degree dead zone, full steering within 15 metres, 0.6 steering limit beyond that, forward throttle and reversed steering while backing out.
- `VhiclBot.cs:59-74`: pursue the local player and check movement every 1.5 seconds; reverse below one metre of movement. Random initial scheduling is replaced by deterministic index staggering.
- `VehicleBot.js:11-25`: refresh target selection every two seconds and choose the nearest other vehicle.
- `VehicleBot.js:61,118-126`: independent drive/fire switches and terrain-obstructed firing on a one-second interval.
- `Game.js:1005-1038`: add/remove numbered bots. The new manager reconciles a population parameter instead of creating network RPCs or waiting for materialization effects.

Positive input X means right, so the yaw error uses the negative-Z forward vector directly. Tests check both turn directions with the bot initially facing away from its target.

## Recovery and limits

The added safety probe checks terrain bounds and optional `terrain.liquidHeightAt(x, z)` before driving ahead or reversing. Momentum can still carry a vehicle into lava. Uphill pursuit follows optional road centrelines from `roadPaths()` or the older `data.roads` shape; roads farther than 70 metres from the bot or 45 metres from the target are ignored. Terrain without the optional liquid query provides no lava avoidance. After sustained immobility or a flipped orientation, recovery tries terrain spawn points and teleports only to dry ground. Turning off driving also disables recovery.

Spawns use deterministic index/tick offsets around the player, reject steep slopes and wet ground, and keep five metres between new bots. If no valid position is available, the manager leaves the count below the requested value and retries on subsequent frames. Bots use stable hue offsets, target velocity prediction, lateral approach offsets and nearby ally avoidance. Corner braking above `bots.cornerSpeed` reduces overshoot. No wings are deployed, matching the active Syn3h bot logic. Headless contact tests cover both the placeholder and Syn3h buggy.

Run `npx vitest run tests/bots` for headless Rapier tests. With Vite on port 5186, `node src/bots/smoke.mjs` sets five bots through the public parameter API, waits for real contact, captures screenshots, then clears the population.

Host bots attach shared vehicle effects with `local: false`; effects are disposed before the body. A monotonic lifetime ID and the world seed supply `generateName`, so removing and replacing an array slot does not reuse the old identity.
