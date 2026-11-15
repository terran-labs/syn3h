# Vehicle lab

The vehicle lab is the shared page for previewing and judging vehicle models. It shows any
vehicle that has an exhibit file, in a generated photo studio, with the controls every lane
needs: compare designs, orbit or sit in the cockpit, switch lamps and night, step through detail
levels, read triangle and draw call counts, stress test many copies, repaint and animate.

It is a developer tool. The production build has one entry, `index.html`, so neither
`vehicle-lab.html` nor `src/dev/vehicleLab/` ships in the game.

## Open it

Run the dev server and open:

- `/vehicle-lab.html?vehicle=buggy`: the buggy body gallery (round by round).
- `/vehicle-lab.html?vehicle=game-skins`: the real in-game Syn3h and Mars Explorer skins.

`/buggy-bodies.html` still works: it redirects to the buggy exhibit and turns `?round=N` into
`?group=N`.

## Controls

On a wide screen (iPad landscape, desktop) every control group shows at once. On a phone the
groups sit behind five tabs (Designs, Camera, Lights, Motion, Paint), and the notes card shows
only the name and stats until you tap it. Every button is at least 44 px square.

**Designs**

- Numbered design buttons show one design.
- **Side by side** lines up every design in the group, first on the left seen from the front.
- **Round 1, Round 2...** (the exhibit's group label) reload the page on that group. The last
  group is the default.

**Camera**

- Drag to orbit, pinch or scroll to zoom, two fingers or right drag to pan.
- **Front, Rear, Side, Top, Low** frame the design. Front and Rear are three quarter views; in
  side by side they become near head on so no car hides another.
- **Turntable** spins the stage slowly.
- **Cockpit** eases the camera to the driver's eye, looking forward, and hides the canopy. Drag
  to look around from the seat. Press again to ease back out to where you were. Shown only when
  the model has a cockpit, and not in side by side or stress mode.

**Lights**

- **Night** darkens the studio and turns the headlights on.
- **Headlights** switches the lamps. At night the beams light the floor.
- **Brake** holds the brake: tail lamps brighten.
- **Floor** cycles **Gloss** (a dark mirror floor, a real reflection pass, so it shows animation
  and lamps) and **Shadow** (a matte floor that shows the contact shadow and costs nothing).

**Motion**

- **Motion** animates the vehicle: throttle and steering cycle gently and the exhibit moves its
  suspension, wheels, gear and so on.
- **Detail** cycles Auto, then each detail level. Auto picks by camera distance with the
  exhibit's thresholds, as the game would. The card shows the level in use.
- **×1, ×10, ×25, ×50** places copies of the current design on a grid and shows the total
  triangles, draw calls and frame time. Copies are static clones at the current detail level
  without headlight beams. The frame time is a rough local measurement: it is capped by the
  display rate, so also read the render call time beside it.
- Exhibit controls follow, for example **Wheels** on the buggy or **Wings** and **Shading** on the
  game skins. In side by side a change applies to every design that has the control.

**Paint**

- **Own colours** restores each design's built colours.
- Swatches set the body and accent colours. **Pick** sets the body to any colour.

## Stats

The card always shows triangles and draw calls for the current design at the detail level in
use. In side by side it lists each design and the total; in stress mode it shows totals for all
copies. Counts cover visible meshes only:

- triangles from the index count, or vertex count for unindexed geometry, divided by three;
- an InstancedMesh counts as one draw and its triangles once per instance;
- a mesh with material groups draws once per group; a transparent double sided material draws
  twice, as three renders it;
- shadow and reflection passes are not counted, nor is frustum culling.

## URL parameters

| Parameter | Meaning |
| --- | --- |
| `vehicle=<id>` | Exhibit id, default `buggy`. |
| `design=<id or n or all>` | A design by id or 1 based position; `all` for side by side. |
| `group=<name>` | Design group, default the last. |
| `view=Front\|Rear\|Side\|Top\|Low` | Camera preset. |
| `az=<deg>&el=<deg>&dist=<m>` | Camera azimuth from the nose toward +X, elevation, distance. Each is optional; they override `view`. |
| `lod=auto\|<name>\|<n>` | Detail level by name (`Far`) or 0 based index. |
| `night=1` | Night studio, headlights on. |
| `headlights=0\|1` | Override the headlights. |
| `brake=1` | Brake held. |
| `floor=gloss\|shadow` | Floor. |
| `color=<hex>[,<hex>]` | Body colour and optional accent, for example `color=b3140f,101014`. |
| `motion=1` | Start with Motion on. |
| `cockpit=1` | Start in the cockpit. |
| `stress=10\|25\|50` | Start with stress copies. |
| `still=1` | Hide the interface, stop motion and the turntable, render the mirror at full resolution. |
| `webgl=1` | Force three's WebGL 2 backend, as the game's flag does. |
| `wheels=<id>` | Buggy only: start with a wheel option from `labs/buggy-wheels/index.json`. |

## Capture API

`window.vehicleLab`, for scripted screenshots (see the Playwright pattern in `tools/smoke.mjs`):

| Call | Effect |
| --- | --- |
| `ready` | True once the first design has rendered a few frames. |
| `designs` | Design ids in the current group. |
| `show(i)` | Show design `i` (0 based). Returns a promise. |
| `sideBySide(on)` | Side by side on or off. Returns a promise. |
| `view(name)` | Camera preset. |
| `orbit(az, el, dist?)` | Camera by angles in degrees; distance defaults to a fit. |
| `look(position, target)` | Camera at `[x, y, z]` looking at `[x, y, z]`. |
| `setNight(on)`, `setHeadlights(on)`, `setBraking(on)` | Lights. |
| `setMotion(on)`, `setTurntable(on)`, `setFloor('Gloss' \| 'Shadow')` | As the buttons. |
| `setLod(i)` | Detail level index, or -1 for Auto. |
| `paint(body, accent)` | Colours as numbers. |
| `cockpit(on)` | Ease in or out. The promise resolves when the camera arrives. |
| `stress(n)` | 1, 10, 25 or 50 copies. |
| `stats()` | Design, detail level, triangles and draws per design, stress totals, frame and render call times, backend. |
| `frames(n)` | Promise that resolves after `n` more frames. |

Example:

```js
await page.goto(`${base}/vehicle-lab.html?vehicle=buggy&night=1&brake=1`)
await page.waitForFunction(() => window.vehicleLab?.ready)
await page.evaluate(async () => { vehicleLab.orbit(70, 32, 13); await vehicleLab.frames(20) })
await page.screenshot({ path: '/tmp/night.png' })
```

## Add your vehicle

1. Create `src/dev/vehicleLab/exhibits/<yours>.ts` exporting a `LabExhibit` (types in
   `src/dev/vehicleLab/types.ts`).
2. Add it to the list in `src/dev/vehicleLab/exhibits/index.ts`.
3. Open `/vehicle-lab.html?vehicle=<your id>`.

Your model follows the game frame: nose toward -Z, Y up, metres, origin at the vehicle origin.
Report `groundY`, the height of the ground contact relative to the origin (negative when the
origin is above the ground); the lab lifts the model onto the floor. Everything else is optional:
leave out `lods` and there is no Detail button, leave out `cockpit` and there is no Cockpit
button.

Keep the model's materials your own business. For procedural models,
`src/dev/vehicleLab/materials.ts` has the standard preview set the tank studies used (car paint
with clear coat, accent, chrome, glass, rubber, dark metal, emissive lamps) plus
`updateLamps` and `addHeadlightBeams`. The lab supplies the softbox environment that makes paint
and chrome shine, so do not add your own environment map.

`update(dt, state)` runs every frame: do not allocate in it. `state.animate` says whether Motion
is on; `state.throttle` (0.1 to 1 while animating) and `state.steer` (-0.8 to 0.8) cycle gently.

A minimal exhibit:

```ts
import * as THREE from 'three/webgpu'
import { addHeadlightBeams, previewMaterials, updateLamps } from '../materials'
import type { LabExhibit } from '../types'

export const hover: LabExhibit = {
  id: 'hover',
  title: 'Syn3h hovercraft',
  async designs() {
    return [{ id: 'base', name: 'Base hull', notes: ['First blockout'] }]
  },
  async build() {
    const m = previewMaterials(0x1553c8, 0x15171a)
    const object = new THREE.Group()
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.9, 2.4, 8, 24).rotateX(Math.PI / 2), m.paint)
    const lamps = [-.5, .5].map(x => new THREE.Mesh(new THREE.CircleGeometry(.12, 16), m.headlight).translateX(x).translateZ(-2.1))
    object.add(hull, ...lamps)
    const beams = addHeadlightBeams(object, lamps.map(l => l.position))
    let lift = 0
    return {
      object,
      groundY: -.9,
      setColors: (body, accent) => { m.paint.color.set(body); m.accent.color.set(accent) },
      resetColors: () => { m.paint.color.set(0x1553c8); m.accent.color.set(0x15171a) },
      update(dt, state) {
        lift = state.animate ? Math.sin(state.time * 3) * .05 : 0
        hull.position.y = lift
        updateLamps(state, [m.headlight], [m.tail])
        beams.update(state)
      },
      cockpit: { eye: new THREE.Vector3(0, .6, -.4) },
      controls: [{ kind: 'toggle', id: 'hover.skirt', label: 'Skirt', value: true, onChange: on => { hull.visible = on } }],
      dispose() { beams.dispose(); hull.geometry.dispose(); Object.values(m).forEach(x => x.dispose()) },
    }
  },
}
```

To add detail levels, return `lods: ['Near', 'Far']`, `setLod(i)` that swaps visibility between
your near and far meshes, and optionally `lodDistances: [30]` (the distance at which level 1
begins). To compare variations, return several designs; give them a `group` to review in rounds.

## Files

| File | What |
| --- | --- |
| `vehicle-lab.html` | Page and styles. |
| `src/dev/vehicleLab/lab.ts` | The lab: state, interface, camera, cockpit, stress, frame loop, capture API. |
| `src/dev/vehicleLab/types.ts` | The exhibit interface. |
| `src/dev/vehicleLab/logic.ts` | Pure parts (stats, groups, URL parameters, Auto detail), tested in `tests/dev/`. |
| `src/dev/vehicleLab/studio.ts` | Softbox environment, key light, day and night, floors. |
| `src/dev/vehicleLab/materials.ts` | Preview materials, lamps and headlight beams. |
| `src/dev/vehicleLab/exhibits/` | One file per vehicle, and the registry. |

## Buggy exhibit extras

- **Canopy** cycles between the force field (the design intent: `forceField()` in `materials.ts`, reusable for any shield or canopy) and plain glass.
- **Wheels** cycles the tyre options listed in `labs/buggy-wheels/index.json`, built by `tools/buggy-bodies/wheels.py`. `?wheels=<id>` picks one from the URL.
- A body file may bring its own `Strut` (suspension linkage) and `Sockets` (the fittings where the linkage meets the body). Bodies marked `gameResolution` in `labs/buggy-bodies/index.json` are at the triangle count that would ship.
