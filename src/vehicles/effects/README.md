# Vehicle effects

Attach after `game.add(vehicle)` and dispose before removing the vehicle:

```ts
import { attachVehicleEffects, createWeaponEffects } from './vehicles/effects'
const disposeEffects = attachVehicleEffects(game, terrain, player, { local: true })
// Before game.remove(player):
disposeEffects()
```

In `main.ts`, insert the attach call immediately after `game.add(player)`. Remote-player creation and bot creation use the same call with `local: false`; retain the returned function with that actor and call it before removing the actor. No vehicle classes, factory, networking or weapon authority are modified here. The optional test Vite plugin wires only the local player for captures.

All attached actors share capped buffers: 1,024 track quads, 256 trail quads, and 600 desktop, 240 mobile or 60 safe-level particle slots. Quality changes rebuild particle buffers. Six shared draws cover these buffers; each vehicle adds four small lamp meshes. Only local vehicles receive a spotlight, without shadows. Last-disposer cleanup removes the shared system and disposes geometry, materials and textures. Repeated disposal is safe. `game.scene.userData.vehicleEffects` exposes capacities, emitted count and CPU update timing, not GPU timing.

Buggy contacts use `getWheelEffects()` in FL, FR, RL, RR order. Each entry supplies grounded state, world point, world normal and absolute lateral slip. `landedThisStep` is sampled after every physics step, with `landingImpact` setting the puff strength. Fallback terrain projection supports older vehicles. Dust and tracks are suppressed over liquid; entering liquid emits one small capped splash/steam approximation. This is new behavior, not a recovered Syn3h effect.

## Source and adaptations

Sources are the read-only Syn3h client Assets tree. Original textures were copied into `public/models/effects`; thruster glow uses the previously recovered HoverGlow texture.

| Effect | Recovered values | Browser adaptation |
| --- | --- | --- |
| Tracks | `_Core/Scripts/VhiclSkidmarks.cs`: 1,024 marks, width .5, offset .04, spacing .75, intensity divided by two | Fades over 60 seconds; classic width .3; rings reject teleport bridges |
| Slip intensity | Buggy `VhiclBuggy.cs` lines 316-322: lateral speed greater than forward speed times .3 gives input magnitude times .5 plus .25 | Lower-slip fallback uses .5, since material friction is not exposed |
| Jet main exhaust | `terra.jet.prefab`: 100/s, life .3, size 1, speed 10, growth -.95 | Throttle scales size and speed; original controller particle section is commented out |
| Jet hover exhaust | 25/s per nozzle, life 1, size .2/.3, spread .4, growth 2 | Reconstructs commented controller intent, max(.1, throttle times .3) size |
| Hovercraft exhaust | Prefab 100/s, life .3, size .8, speed 7 | Throttle-scaled, shares jet particle batch |
| Hovercraft dust | Prefab 50/s, life 1, size .3, ellipsoid 1.3 by 1.8 | Samples terrain beneath craft and fades with height |
| Headlights | Warm light (1,.9965517,.875), range 50, cone 60 degrees; material emission (2.447059,2.858824,3) | One local light replaces paired spots; Three intensity adapted to visible ground lighting at night |
| Tail lights | Original emission (2,0,0) | Braking increases red emission; fixture placements outside buggy are approximate |
| Wing trails | No vehicle TrailRenderer components or leftTrail/rightTrail fields in these snapshots | New subtle .1 m wide, .8 s trails; approximate tips, accent colour |

Particle alpha uses a smooth sine approximation to the original five-key fade. Particles use world-space birth positions and inherit vehicle velocity. Wheels use speed and slip to grow dust. Original exhaust glow cones already supplied by the jet model remain in place. Ground dust, landing puffs and wing trails are cosmetic reconstructions where no active source implementation survives.

## Laser handoff

`VhiclLaser.cs` in this snapshot is entirely commented out. Prefabs and materials still give the intended look:

* LaserAuto uses Plasma Green, one-second trail, width .5 to .2, very small minimum vertex spacing (.0001), transparent ends with an opaque middle. Its shot pitch is 1.3.
* LaserSnipe uses Plasma Red, one-second trail, width 2 to 1, minimum vertex spacing 3, opaque leading body fading at the tail. Its shot pitch is .5.
* Both reference `_Core/Audio/LaserShot.mp3`, volume 1, attenuation range 1 to 500.
* PlasmaSparks emits four particles, size .4 to .7, life .8, random lateral velocity 3, growth 2. This hook approximates its spread; it does not reproduce stretched billboards or gravity.

Current `Lasers.ts` uses fixed three-metre red/orange cylinders and orange spherical impacts. To match Syn3h, replace those with additive textured green auto and red snipe trails using the prefab widths and lifetime, and use four textured impact sparks. Keep collision and networking authoritative. Do not change hit detection to follow the visible trail.

```ts
const effects = createWeaponEffects(game)
effects.muzzle(worldOrigin, worldDirection, isSnipe)
effects.impact(worldHit, worldNormal, isSnipe)
// On weapon-system teardown:
effects.dispose()
```

Call muzzle only for fresh shots, including fresh replicated shots, rather than old replayed projectiles. Call impact once when an authoritative hit is accepted. The hook supplies green/red original plasma textures and bounded particles, but deliberately leaves sound and projectile ownership with the weapon system. The short muzzle flash is a new approximation. Impact sound was not established from these assets, so no substitute sound is claimed as original.

## Verification

Use `SYN3H_TEST_EFFECTS=1 npx vite --port 5185 --strictPort --config tests/vehicles2/vite.config.ts`. The test plugin adds effects without editing the coordinator's main entry. Run `node tests/vehicles2/effects-browser.mjs` for local/remote light ownership, weapon rendering, quality reduction and disposal checks. Six `tools/scenarios/effects-*` scenarios run through `tools/drive-capture.mjs` for noon/night motion.

Verified handoff locations at this branch's integration baseline: local player `src/main.ts:38`; remote creation `src/net/index.ts:439`, replacement `:467`, removal `:352`, `:452`, `:464`; bot creation `src/bots/BotManager.ts:43`, removal `:53`, `:58`. Store disposers beside each actor, including replacement paths.

Evidence is under `/tmp/syn3h-vehicles2/effects-{buggy,jet,hovercraft}-{noon,night}/contact-sheet.png`. All six runs captured seven frames without browser errors. The hovercraft dune capture exposes an existing steep airborne pose and abrupt braking; this effects change does not alter its physics. `effects-performance.json` records 100 browser samples: effects CPU mean .041 ms, total scene frame mean 80.9 ms on the test host. These numbers do not isolate GPU overhead or demonstrate a target frame rate. Lifecycle checks confirm one local spot, zero remote spots, 60 safe-level slots and complete last-disposer cleanup. Typecheck passes. The full 191-test suite passes with two workers; the default parallel run hit four terrain timing limits during concurrent browser work.
