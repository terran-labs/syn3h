# Bots and Daydream

Self-driving comes in three layers, shared by bots and by the player's own vehicle:

| Layer | File | Job |
|---|---|---|
| Mind | `mind/Mind.ts`, `mind/personality.ts` | Chooses what to do, by seeded personality: take a road, climb to the summit, strike out for unseen ground, tail another vehicle, donuts, weaving, a pause for the view. Checks the ground ahead and steers round liquid, cliffs and the world edge. Gives up on a place it cannot reach. Never teleports. |
| Navigator | `nav/` (route planner), `navigation.ts` (road graph) | Turns "from here to there" into a route this kind of vehicle can travel. |
| Pilot | `pilot/` | Turns "head for this point at this speed" into the vehicle's own controls. One per kind of vehicle. Writes an `InputState` and nothing else. |

The contracts are in `pilot/types.ts`.

## Daydream

`Daydream.ts`. After `daydream.seconds` (default 15, 0 is off) with no key, touch, click,
wheel or gamepad input while playing, a Mind takes the player's controls. Any input hands
them straight back, with the wings or hover mode as the player left them. It writes to
`game.input` where the keyboard and touch stick write, so physics, networking and replay
see an ordinary player. It is idle in the lobby, in menus and in a hidden tab. The bot
manager owns it (`bots.daydream`), so the composition root needs no wiring.

- `?daydream=5` sets the idle time from the URL, for a quick look or an automated check.
- A `mira:daydream` event on `window` (`detail.active`) announces each change. The chase
  camera listens and runs `core/CameraDirector.ts`: chase, orbit, fly-by, crane and low
  tracking shots, cutting away when a hill hides the car. `camera.daydreamShots` turns the
  shots off.
- The settings slider is `createDaydreamControl()` in `daydreamControl.ts`: 10 seconds at the
  far left, 5 minutes at the last stop before the right end, off at the far right.
- Capture: `node tools/drive-capture.mjs --scenario tools/scenarios/daydream.json`.

## Bot character

Each bot gets a `Personality` from the world seed and its id (boldness, curiosity,
sociability, mischief, patience) and a Mind. `bots.freeSpirit` sets the share of time it
follows its own agenda instead of chasing: 0 is relentless pursuit, 1 never
chases. `brain.mood` says which it is doing; `brain.mind.caption` says what.

# Pursuit

Add these lines to the composition root after creating the local player:

```ts
import { BotManager } from './bots/BotManager'

const bots = game.add(new BotManager(game, terrain, player))
bots.setTargets([player])
```

Include `bots` in the `window.mira` debug handles if desired. The module registers the Bots parameters; `params.set('bots.count', 5)` spawns five bots on the next rendered frame. Count defaults to four, with a mixed fleet of buggies, a hovercraft and a jet. The slider accepts up to sixteen, while local graphics budgets cap active host bots at two, four or eight. Import `src/bots/params.ts` on a server that validates shared parameters, or move those declarations into shared code during integration.

Every client may create a manager. Networking must set `manager.remote = true` on non-hosts before simulation; this immediately disposes all managed effects, brains and vehicles. Remote managers never spawn bots. Networking owns its separate remote copies. Host takeover spawns fresh vehicles on the next update. `isLocal = false` prevents keyboard reads here; it does not prevent the vehicle's forces from running. Do not give a host-owned bot a remote interpolation controller on the same host.

`bots.setTargets([player, ...remoteVehicles])` replaces available targets. Target mode 0 follows the explicit local player; mode 1 selects the nearest supplied vehicle, excluding itself. Add `...bots.vehicles` to that list if bots should chase each other. Refresh the list after joins, leaves or population changes. `game.remove(bots)` unregisters every brain and vehicle and removes their Rapier bodies.

The controller writes `input.fire` in one-step pulses when the fire interval passes and the terrain ray is clear. Actual firing requires the weapon system. The placeholder vehicle has no weapon implementation.

## Pursuit controller

- Steering: wrapped yaw, 20 degree steering scale, 2 degree dead zone, full steering within 15 metres, 0.6 steering limit beyond that, forward throttle and reversed steering while backing out.
- Pursue the local player and check movement every 1.5 seconds; reverse below one metre of movement. Checks are staggered deterministically by bot index.
- Refresh target selection every two seconds and choose the nearest other vehicle.
- Independent drive/fire switches and terrain-obstructed firing on a one-second interval.
- Bots are added and removed by reconciling a population parameter, with no network RPCs and no wait for materialization effects.

Positive input X means right, so the yaw error uses the negative-Z forward vector directly. Tests check both turn directions with the bot initially facing away from its target.

## Recovery and limits

The safety probe checks terrain bounds and optional `terrain.liquidHeightAt(x, z)` before driving ahead or reversing. Momentum can still carry a vehicle into lava. A bot tries to crawl toward dry ground for `bots.recoveryTime` seconds, then asks the manager to return it to a dry spawn point. The same vehicle, body, name and effects remain attached. Sustained immobility and a flipped orientation also request recovery. Turning off driving disables recovery.

Road guidance uses the public `roadPaths()` or older `data.roads` seam. It connects nearby approach, foot-ring, spiral and summit nodes only when their heights agree. Replacing the road array on regeneration invalidates the graph. Roads farther than 70 metres from either endpoint are ignored. Route queries run every 0.4 seconds; `bots.roadSpeed` and `bots.roadCornerSpeed` govern braking, and lateral variation narrows on a road. Road pursuit stays on its route near a target and queues behind aligned traffic. The four-seed, three-speed summit sweep reaches the top with all 48 bots and no recorded falls. Alpine and desert roads are climbable, but traffic and recovery steering can still send a bot over an edge; see `tools/island-acceptance.md`.

Spawns use deterministic index/tick offsets around the player, reject steep slopes and wet ground, and keep five metres between new bots. If no valid position is available, the manager leaves the count below the requested value and retries on subsequent frames. Bots use stable hue offsets, target velocity prediction, lateral approach offsets and nearby ally avoidance. Corner braking above `bots.cornerSpeed` reduces overshoot. Self-flying jets use forward flight on long, aligned, clear legs, and hover for turns and nearby destinations. Headless contact tests cover both the placeholder and Mira buggy.

Run `tools/heavy.sh npx vitest run tests/bots --maxWorkers=2` for headless Rapier tests. With Vite on port 5186, `node src/bots/smoke.mjs` sets five bots through the public parameter API, waits for real contact, captures screenshots, then clears the population.

Host bots attach shared vehicle effects with `local: false`; effects are disposed before the body. A monotonic lifetime ID and the world seed supply `uniqueBotName` (one given name, unique among the bots and the player; the role is hidden, from `botIdentity`), so removing and replacing an array slot does not reuse the old identity.

## Optional integration hooks

`BotManager.setGear(hooks)` connects host bot decisions to the gear system. Hooks provide
allowed gear, nearby Pester threats and an action callback. Decisions include reaction
delays, per-bot timing and line-of-sight checks. Big Red charges before release; Yoink is
held briefly; Bungee is released after a short reel. Disabling gear or losing a target
cancels the active action. With no hooks, ordinary tag-beam behavior is unchanged.

Pester avoidance currently steers wheeled bots only. Jets and hovercraft retain their
existing pilots. A dodge waits for a reaction delay and checks terrain along the proposed
turn; it cannot grant invulnerability or teleport a vehicle.

`setRaces(hooks)` and `applyRace(state)` connect the host race director to canonical room
state. See `tools/bot-race-integration.md` for eligibility, timing and UI wiring. No hooks
means no automatic race starts, so integration must install them on the ordinary entry.
