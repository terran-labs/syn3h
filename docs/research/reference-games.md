# Reference games: what they are built from

Inspected on 2026-11-14. Bruno Simon's site was read from its public source. Teleoperator
was read from the JavaScript it ships to the browser, which still contains its developer
comments and its credits screen.

## bruno-simon.com (Folio 2025)

Source: [brunosimon/folio-2025](https://github.com/brunosimon/folio-2025), MIT, last pushed
2026-11-04.

| Layer | Choice | Evidence |
| --- | --- | --- |
| Renderer | Three.js 0.187 `WebGPURenderer`, `forceWebGL: false` | `sources/Game/Rendering.js:40` |
| Shading | TSL node materials, custom stylised lighting, not PBR | `sources/Game/Materials/`, `Ligthing.js` |
| Physics | Rapier 0.19 (`@dimforge/rapier3d`) | `package.json` |
| Vehicle | Rapier's ray cast vehicle controller, four wheels | `Physics/PhysicsVehicle.js:69` |
| Audio | Howler 2.2 | `sources/Game/Audio.js` |
| Debug UI | Tweakpane 4, a slider for nearly every constant | throughout |
| Build | Vite 8, plain JavaScript | `package.json` |
| Assets | glTF through glTF Transform, compressed textures, a compress script | `scripts/compress.js` |
| Server | One WebSocket with msgpack messages | `sources/Game/Server.js:44` |

What explains the things you liked:

- **Fast load.** A small authored world, aggressively compressed models and textures, and
  no PBR texture sets. The terrain is one Blender mesh plus one data texture.
- **Lighting and style.** One directional light with a single shadow map (2048 on high
  quality, 512 on low). A custom material computes a core shadow, a coloured bounce light
  and a tinted shadow colour, all driven by a day cycle (`Ligthing.js` 83-91). Nothing is
  baked, which is why time of day can change. This is the technique to copy.
- **Terrain and water.** The terrain colour comes from a gradient lookup blended with grass
  by a data texture (`Terrain.js` 93-114). Water is a flat surface shader, and physics
  bodies simply get heavy damping below the water line (`Physics/Physics.js`, `update`).
- **Runs on a phone.** Low object count, one shadow map, quality tiers.
- **Game loop.** The readme documents an explicit ordered tick: inputs, pre physics,
  physics, post physics, view, then visuals. Worth adopting as is.

Where we should differ:

- Folio steps physics with the frame's delta time (`world.timestep = ticker.deltaScaled`).
  That is fine for a single player toy. We need a fixed step, because our
  vehicle constants assume one and because networked ramming needs every client to behave alike.
- Rapier's vehicle controller models a road car. It cannot express a hovercraft, a jet or a
  tracked tank, and our buggy is its own raycast model anyway.
- Folio's server is not a multiplayer vehicle sync. Do not expect to lift netcode from it.

## teleoperator.mindblown.ai

No public source. Findings come from `boot.js` (16 KB, commented) and `app.js` (4.2 MB).

| Layer | Finding | Evidence |
| --- | --- | --- |
| Renderer | Three.js r186, WebGPU with hand written WGSL | `REVISION` constant is "186"; WGSL in bundle |
| Fallback | Three's WebGL renderer when WebGPU or an adapter is missing | boot.js comment "(glfb)" |
| Physics | Custom arcade car model. No Rapier, Cannon, Jolt, Havok or Ammo in the bundle | string search |
| City data | Baked offline from OpenStreetMap via the Overpass API | credits screen |
| Terrain | USGS 3DEP elevation, 1/3 arc second, public domain | credits screen |
| Trees | San Francisco's Street Tree List open dataset | credits screen |
| Geometry | meshoptimizer and glTF Transform are credited. Whether it uses Three's `BatchedMesh` could not be told apart from the bundled library code | credits screen |
| Build | esbuild, with Blender, sharp and glTF Transform in the pipeline | credits screen |
| Multiplayer | The host platform's room service, brokered through `postMessage` | `pod.js` |

The important correction to a natural assumption: **Teleoperator does not stream Google's
photorealistic tiles.** Its San Francisco is a custom model generated ahead of time from
open data and shipped as its own optimised files. That is why the roads are flat and
drivable, why it loads quickly, and why it has no per session map bill. It is also why it
is one city: the comments reference "round 31" and "gen68", so that pipeline took a lot of
iteration.

Lessons worth taking:

- **Device tiers.** It classifies the device before loading anything: desktop, mobile, or
  "safe". The comments record that iOS kills a tab at roughly 1 to 1.5 GB, so the mobile
  tier is budgeted to about 0.6 GB.
- **Crash recovery.** A flag is set when loading starts and cleared when the game is up. If
  the flag is still set on the next load, the last attempt died, and it starts one quality
  level lower. Cheap and effective on iPhones.
- **WebGPU on iOS** needs iOS 26, per its own comments.
- Its multiplayer rides a proprietary platform, so there is nothing to reuse there.

## What both agree on

Three.js with the WebGPU renderer, a WebGL fallback, heavy asset compression, quality tiers,
and hand tuned vehicle feel exposed through debug sliders. Neither uses a general purpose
game engine, and neither does real time networked physics.
