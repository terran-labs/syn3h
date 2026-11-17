# Vehicle effects

Attach after `game.add(vehicle)` and dispose before removing the vehicle:

```ts
import { attachVehicleEffects, createWeaponEffects } from './vehicles/effects'
const disposeEffects = attachVehicleEffects(game, terrain, player, { local: true })
// Before game.remove(player):
disposeEffects()
```

In `main.ts`, insert the attach call immediately after `game.add(player)`. Remote-player creation and bot creation use the same call with `local: false`; retain the returned function with that actor and call it before removing the actor. No vehicle classes, factory, networking or weapon authority are modified here. The optional test Vite plugin wires only the local player for captures.

All attached actors share capped buffers: 1,024 track quads, 256 trail quads, and 600 desktop, 240 mobile or 60 safe-level particle slots. Quality changes rebuild particle buffers. Seven shared draws cover the particle/ribbon buffers and one instanced lamp batch. Four lamp instances per vehicle add no per-vehicle draw calls; the batch is capped at 128 vehicles. Only local vehicles receive road spotlights, without shadows. The buggy has one beam at each front lamp, sharing the previous total intensity; other vehicles keep one central beam. Last-disposer cleanup removes the shared system and disposes geometry and materials. Repeated disposal is safe. `game.scene.userData.vehicleEffects` exposes capacities, emitted count and CPU update timing, not GPU timing.

Buggy contacts use `getWheelEffects()` in FL, FR, RL, RR order. Each entry supplies grounded state, world point, world normal and absolute lateral slip. `landedThisStep` is sampled after every physics step, with `landingImpact` setting the puff strength. Fallback terrain projection supports older vehicles. Dust and tracks are suppressed over liquid; entering liquid emits one small capped splash/steam approximation.

## Tyre marks and dust by surface

Set by the owner on 15 and 16 November 2026: marks and dust take their look from the ground, marks are subtle (noticed on a second look), and only the Mire's mud keeps heavy ruts. For each wheel the emitter asks `terrain.surfaceAt(x, z)` once a frame (`src/world/terrain/surface.ts`: dust, sand, grass, mud, snow, ice, glass, regolith, rock, road, track). `groundTone.ts` turns the surface and the planet's palette (`terrain.lookIndex()`, `palettes.ts`) into a ground colour, cached per planet and surface. `treads.ts` tones it for the mark (darker and greyer on soil and grass, pale and frosty on ice and snow) and for the dust (sand coloured and plenty on sand, a little fine pale spray on ice and snow, few flecks on grass, sparse grit on rock). Wet ground within 0.6 m of water takes a darker print and throws almost no spray. Lava shores classify as rock: a faint grey scuff.

Marks are one draw call in one 1,024 quad ring. Per vertex: tint, alpha (eased with how much the wheel slides or brakes, so a mark strengthens along its length), tread depth, ground normal, and metres from where the mark began and to where it ended. The shader (`markEnvelope` in `sprites.ts`) fades every mark to nothing at both edges, over its first and last 1.2 m, and gradually over its life; the tread pattern is faint and gives way to a plain smear from 8 to 30 m away. Marks are lit like the terrain (standard, rough, shadowed), so a shade of the ground's colour sits on it at the right brightness by day and night. Expired quads collapse to nothing. Segments lengthen with speed (0.75 m, up to 2.5 m from 25 m/s), so at 20 m/s the ring holds about 500 m of track per wheel (about 25 s of straight driving) instead of 190 m. Plain rolling on soft ground leaves a clear pair of tracks (about 10 to 15 per cent darker than the ground from the chase camera, measured by `tools/tyre-contrast.mjs`); sliding and braking darken them further, and hard rock and ice stay faint until a wheel slides. Strength, edge softness and lifetime are `gfx.tyreMarks.*` in the Graphics group; Minimal quality draws none and Low keeps them shorter. Buggy wheels and the tank's two tracks use the same path. `tests/vehicles2/treads.test.ts` holds the invariants; `tools/tyre-marks-check.mjs` captures and measures.

## World seams

Every world wraps. When the local player crosses a tile edge, `Vehicle.shiftBy` moves it a whole tile and dispatches `{ type: 'tileshift', dx, dz }` on `vehicle.object`. The effects attached with `local: true` then call `shift(dx, dz)` on every shared batch (tyre marks, trails, dust, exhaust, weapon sparks) and move that vehicle's own mark and trail history by the same vector, so everything behind the player stays behind it and its marks carry on unbroken. A shift rewrites the stored world positions in place and uploads each buffer once; frames without a shift cost nothing. A uniform offset was rejected: it would add work to every vertex on every frame, and every later emit would have to subtract the running offset. Any other vehicle the terrain re-images near the player leaves its marks where they are and starts its history again. The Syn3h buggy's motor sparks are emitted in the vehicle's own frame and need nothing.

## Generated looks

No effect loads an image. Dust, skid marks, green and red plasma, and the thruster glow as an exhaust particle are shader-generated looks in `sprites.ts`; no effect images are shipped. Each particle gets its own noise pattern from its birth time and slot, and the pattern drifts as it ages. The noise uses one octave at the safe graphics level and two above it. `maps.ts` generates the tank tread map once at run time. `tests/vehicles2/no-images.test.ts` fails if vehicle code loads an image again. No vehicle bitmap exceptions remain; the guard also inspects GLB image and texture declarations.

Dust takes the tint it is passed. Tyre marks have soft shoulders, tread ribs and patchiness rather than flat bands.

| Effect | Values | Browser adaptation |
| --- | --- | --- |
| Tracks | 1,024 marks, width .5, offset .04, spacing .75, intensity divided by two | Colour, strength, tread pattern, width and lifetime come from the ground under each wheel (`treads.ts`, below); classic width .3; rings reject teleport bridges |
| Slip intensity | Buggy: lateral speed greater than forward speed times .3 gives input magnitude times .5 plus .25 | Lower-slip fallback uses .5, since material friction is not exposed |
| Jet main exhaust | 100/s, life .3, size 1, speed 10, growth -.95 | Throttle scales size and speed |
| Jet hover exhaust | 25/s per nozzle, life 1, size .2/.3, spread .4, growth 2 | Size max(.1, throttle times .3) |
| Hovercraft exhaust | 100/s, life .3, size .8, speed 7 | Throttle-scaled, shares jet particle batch |
| Hovercraft dust | 50/s, life 1, size .3, ellipsoid 1.3 by 1.8 | Samples terrain beneath craft and fades with height |
| Headlights | Warm light (1,.9965517,.875), range 50, cone 60 degrees; material emission (2.447059,2.858824,3) | One local light; Three intensity adapted to visible ground lighting at night |
| Tail lights | Emission (2,0,0) | Braking increases red emission; fixture placements outside buggy are approximate |
| Wing trails | None | Subtle .1 m wide, .8 s trails; approximate tips, accent colour |

Particle alpha uses a smooth sine fade. Particles use world-space birth positions and inherit vehicle velocity. Wheels use speed and slip to grow dust. Exhaust glow cones already supplied by the jet model remain in place. Ground dust, landing puffs and wing trails are cosmetic.

## Laser handoff

The intended laser look:

* LaserAuto uses Plasma Green, one-second trail, width .5 to .2, very small minimum vertex spacing (.0001), transparent ends with an opaque middle. Its shot pitch is 1.3.
* LaserSnipe uses Plasma Red, one-second trail, width 2 to 1, minimum vertex spacing 3, opaque leading body fading at the tail. Its shot pitch is .5.
* Both play their shot at volume 1, attenuation range 1 to 500.
* PlasmaSparks emits four particles, size .4 to .7, life .8, random lateral velocity 3, growth 2. This hook approximates its spread; it does not reproduce stretched billboards or gravity.

Current `Lasers.ts` uses fixed three-metre red/orange cylinders and orange spherical impacts. For the intended look, replace those with additive green auto and red snipe plasma trails using the widths and lifetime above, and use four plasma impact sparks. Keep collision and networking authoritative. Do not change hit detection to follow the visible trail.

```ts
const effects = createWeaponEffects(game)
effects.muzzle(worldOrigin, worldDirection, isSnipe)
effects.impact(worldHit, worldNormal, isSnipe)
// On weapon-system teardown:
effects.dispose()
```

Call muzzle only for fresh shots, including fresh replicated shots, rather than old replayed projectiles. Call impact once when an authoritative hit is accepted. The hook supplies generated green and red plasma sprites and bounded particles, but deliberately leaves sound and projectile ownership with the weapon system. The short muzzle flash is a new approximation.

## Verification

Use `SYN3H_TEST_EFFECTS=1 npx vite --port 5185 --strictPort --config tests/vehicles2/vite.config.ts`. The test plugin adds effects without editing the coordinator's main entry. Run `node tests/vehicles2/effects-browser.mjs` for local/remote light ownership, weapon rendering, quality reduction and disposal checks. Six `tools/scenarios/effects-*` scenarios run through `tools/drive-capture.mjs` for noon/night motion.

Verified handoff locations at this branch's integration baseline: local player `src/main.ts:38`; remote creation `src/net/index.ts:439`, replacement `:467`, removal `:352`, `:452`, `:464`; bot creation `src/bots/BotManager.ts:43`, removal `:53`, `:58`. Store disposers beside each actor, including replacement paths.

Evidence is under `/tmp/syn3h-vehicles2/effects-{buggy,jet,hovercraft}-{noon,night}/contact-sheet.png`. All six runs captured seven frames without browser errors. The hovercraft dune capture exposes an existing steep airborne pose and abrupt braking; this effects change does not alter its physics. `effects-performance.json` records 100 browser samples: effects CPU mean .041 ms, total scene frame mean 80.9 ms on the test host. These numbers do not isolate GPU overhead or demonstrate a target frame rate. Lifecycle checks confirm one local spot, zero remote spots, 60 safe-level slots and complete last-disposer cleanup. Typecheck passes. The full 191-test suite passes with two workers; the default parallel run hit four terrain timing limits during concurrent browser work.

## Night visibility follow-up

The 50 m range and 60 degree cone remain. The local spotlight now starts at y .35 and aims at (0, -.8, -22) in the vehicle frame, with 1600 candela at night (1800 for the jet). Its old 80 candela and lower aim produced almost no visible pool under inverse-square falloff. The terrain already receives standard spot lighting, so no terrain shader change is needed. Remote vehicles still receive no spotlight.

Shared vehicle materials receive a small night-only paint fill and a cool edge term on batched surfaces. Daylight and standalone viewers retain their previous shading; transparent glass is untouched. This is an art-directed visibility aid. It adds no lights or submissions and does not change world exposure or the environment map.

The updated tyre slip value does not suppress rolling tracks or dry-ground dust: both depend on speed and grounded contact, with slip affecting intensity and plume size. No threshold change was needed. Captures and measurements are recorded in `tests/vehicles2/night-effects.md`.
