# Volcanic effects

Register systems after creating terrain. All constructors attach their own meshes to the scene.

```ts
import { LavaSurface } from './fx/LavaSurface'
import { LavaFlow, traceDownhill } from './fx/LavaFlow'
import { Emitters } from './fx/Emitters'

const lake = game.add(new LavaSurface(game.scene, terrain))
const path = traceDownhill(terrain, { x: ventX, z: ventZ }, {
  step: 2, maxSteps: 256, stopHeight: worldLavaAltitude.value,
})
if (path.length >= 2) game.add(new LavaFlow(game.scene, terrain, path, 4))
const vents = game.add(new Emitters(game.scene))
vents.addVent({ x: ventX, y: terrain.heightAt(ventX, ventZ), z: ventZ }, {
  kind: 'smoke', radius: 2, height: 20, intensity: 1,
})
```

`game.remove(system)` disposes its geometry and material. `vents.clear()` removes every vent and particle mesh. Recreate surfaces and rivers after terrain regeneration because shoreline heights and ribbon vertices are sampled at construction. Altitude changes update the surface and shoreline uniform live.

The parameter module registers the Lava group when effects are imported. A server validating world parameters must import `src/fx/params.ts` too, or relocate these declarations to shared code during integration. Colour is three linear RGB controls because the existing registry supports numbers and booleans.

The downhill tracer terminates at flats or local minima; it does not invent uphill routes across a caldera rim. Ribbon points should be close enough for the local terrain detail. Two vertices per cross section cannot represent a ridge crossing the middle of a wide river. The lake shoreline uses a 128 by 128 sampled grid, so it is approximate on a large world.

Particles use three instanced billboard batches, 48 particles per vent, and a default global cap of 2400. A 50-vent scene therefore uses 2400 particles in three draws. Birth time, seed, position and vent settings upload only when the population or budget changes. Each frame updates time and wind uniforms. Smoke is softly blended but particles within a batch are not depth sorted. No lights or bloom passes are added; lava and fire output HDR colour independently of sunlight.

Run `npx vite --port 5186 --strictPort` and `node src/fx/smoke.mjs` for both-backend screenshots and timing. Timing reports CPU update plus render submission and frame interval, not isolated GPU time or phone performance. Query flags on `fx.html`: `webgl`, `night`, `stress` (50 vents).
