# Vehicle lab

The vehicle lab is the shared page for previewing and judging vehicle models. Its sidebar lists
every vehicle: the design studies and every vehicle the game can build. Pick one and its Options
tree lets you change everything about it: view, lights, detail level, paint, motion, its own
controls and the game parameters that belong to it. It all happens in a generated photo studio,
with live triangle and draw call counts.

It is a developer tool. The production build has one entry, `index.html`, so neither
`vehicle-lab.html` nor `src/dev/vehicleLab/` ships in the game.

## Open it

Run the dev server and open `/vehicle-lab.html`. It opens on the first vehicle in the sidebar.
Every selection rewrites the URL, so copying the address bar reproduces the view.

- `?vehicle=buggy`: the next Syn3h buggy design studies, round by round.
- `?vehicle=game-buggy`, `game-buggy-classic`, `game-jet`, `game-hovercraft`, `game-tank`: the
  vehicles as the game builds them.

Old links keep working. `/buggy-bodies.html?round=N` opens round N of the design studies.
`?vehicle=game-skins` opens the in-game Syn3h buggy, and `&design=classic` opens the Mars
Explorer buggy instead.

## Every vehicle shows up by itself

There are two ways in, and neither needs an edit to the lab:

1. **A vehicle in the game.** Add the kind to `createVehicle` and to `VEHICLE_KINDS` in
   `src/vehicles/index.ts`. `exhibits/gameVehicles.ts` makes one exhibit per entry: it builds the
   real vehicle with `createVehicle`, in a private physics world with a flat ground slab. It
   drops the vehicle with no input until it settles, then fixes the body so it cannot fall or
   drive away. From then on the lab keeps running the vehicle's fixed step and visual update, and
   Motion feeds its input, so wheels, wings, gear and lamps move as far as they can without the
   body moving. The vehicle runs as a remote copy, so Far shows what other players see.
2. **A design study or any other model.** Drop a file in `src/dev/vehicleLab/exhibits/` that
   exports a `LabExhibit` (see "Add an exhibit" below). `registry.ts` collects every exhibit any
   file there exports, named or default, singly or in an array. The sidebar orders them by
   `order`, then title.

## The sidebar

On a wide screen the sidebar sits on the left and the vehicle is framed in the space beside it.
The menu button at its top folds it to a slim rail and back. On a phone, or on a tablet held
upright, it becomes a bottom sheet instead: closed, it shows only a header naming the vehicle,
and the same button opens it to just over half the screen, scrollable. The vehicle is always
framed in the visible area. Every target is at least 44 px.

**Vehicles** lists exhibits under section headings (Design studies, In the game). A vehicle with
groups (the studies' rounds) opens to them, latest first and open, older ones marked "older".
Each group, or each vehicle without groups, has **Compare all N**, which shows its designs side
by side, first on the left seen from the front. A design carried over from an earlier round is
marked "pick". A vehicle with one design is a single entry.

Under the tree, the **Options** tree starts with an info panel (heading, design name, notes, live
counts) and continues with collapsible sections. Each remembers whether it was open:

- **View**: Front, Rear, Side, Top and Low presets (Front and Rear are three quarter views; when
  comparing they become near head on so no car hides another), **Turntable**, **Cockpit** and
  **Floor**. Cockpit eases the camera to the driver's eye, looking forward, and hides the canopy.
  Drag to look around from the seat; switch it off to ease back out. It shows only when the model
  has a cockpit, and not when comparing or with stress copies. **Floor** is **Gloss** (a dark
  mirror floor, a real reflection pass, so it shows animation and lamps) or **Shadow** (a matte
  floor that shows the contact shadow and costs nothing).
- **Lights**: **Night** darkens the studio and turns the headlights on, **Headlights** switches
  the lamps (at night the beams light the floor), **Brake** holds the brake.
- **Detail**: **Level** is Auto or a named level. Auto picks by camera distance with the
  exhibit's thresholds, as the game would. Below it are the live counts and **Stress copies**:
  ×10, ×25 or ×50 copies of the design on a grid, with total counts, frame time and render call
  time. Copies are static clones at the current level without headlight beams. The frame time is
  a rough local measurement, capped by the display rate.
- **Paint**: **Own colours** restores each design's built colours; swatches and the **Body** and
  **Accent** colour inputs repaint every design.
- **Motion**: throttle and steering cycle gently and the vehicle animates what it can.
- The exhibit's own controls, under the headings it gives them (for the studies, **Canopy** and
  **Wheels**; for game vehicles, **Input**). When comparing, a change applies to every design
  that has the control.
- **Parameters**: the game parameters that belong to the vehicle (see below), each with its
  label, value and a reset that appears once it differs from the default, plus **Reset all**.

All controls are real form controls: switches, segmented choices (arrow keys move between
segments), sliders with a numeric readout, colour inputs. They work from the keyboard with a
visible focus ring.

## Parameters

The game declares its tunable values with `defineParam` in `shared/params.ts`. The Parameters
section lists the ones that belong to the selected vehicle and changes them live in this page
only; nothing is saved. Most are physics, so they show no change on a vehicle held still; visual
ones such as Vehicle shading change the model at once.

Which belong (`vehicleParams` in `tree.ts`): take the exhibit's `family`, or its id if it has no
family. Game vehicles use their kind as the family. The family's first word (`buggy-classic`
gives `buggy`) must equal the parameter id's prefix (`buggy.power`), start with it (`hovercraft`
and `hover.thrust`), or equal its group name (`Tank`). `gfx.vehicleShading` is added for every
vehicle. Shared world groups (Lava, Liquid, Zorb) act on every vehicle and stay in the game's own
settings panel. An exhibit can set `paramGroups` to name groups, id prefixes or full ids instead,
or `[]` for none; the design studies use `[]` because body studies have no physics. A parameter
whose label matches the hidden word list (`HIDDEN_LABEL` in `tree.ts`) is never listed.

## Stats

The info panel and the Detail section show triangles and draw calls for the current design at
the detail level in use; when comparing, the total for all designs; with stress copies, the
total for all copies. Counts cover visible meshes only:

- triangles from the index count, or vertex count for unindexed geometry, divided by three;
- an InstancedMesh counts as one draw and its triangles once per instance;
- a mesh with material groups draws once per group; a transparent double sided material draws
  twice, as three renders it;
- shadow and reflection passes are not counted, nor is frustum culling.

## URL parameters

| Parameter | Meaning |
| --- | --- |
| `vehicle=<id>` | Exhibit id (or an alias), default the first in the sidebar. |
| `design=<id or n or all>` | A design by id or 1 based position; `all` for side by side. |
| `group=<name>` | Design group, default the last. `round=` is read as `group=`. |
| `view=Front\|Rear\|Side\|Top\|Low` | Camera preset. |
| `az=<deg>&el=<deg>&dist=<m>` | Camera azimuth from the nose toward +X, elevation, distance. Each is optional; they override `view`. |
| `lod=auto\|<name>\|<n>` | Detail level by name (`Far`) or 0 based index. |
| `night=1` | Night studio, headlights on. |
| `headlights=0\|1` | Override the headlights. |
| `brake=1` | Brake held. |
| `floor=gloss\|shadow` | Floor. |
| `color=<hex>[,<hex>]` | Body colour and optional accent, for example `color=b3140f,101014`. |
| `motion=1` | Start with Motion on. |
| `idle=<seconds>` | Seconds without input before the lab runs by itself (default 15; 0 turns it off). Scripted browsers and `still=1` default to off. |
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
| `vehicles()` | Every vehicle in the sidebar: id, title, section, groups and design ids. |
| `select(vehicle, design?, group?)` | Selects a vehicle without reloading; `design` may be an id, a 1 based position or `all`. Returns a promise. |
| `exhibit`, `designs` | The current exhibit id and the design ids in the current group. |
| `show(i)` | Show design `i` (0 based). Returns a promise. |
| `sideBySide(on)` | Side by side on or off. Returns a promise. |
| `view(name)` | Camera preset. |
| `orbit(az, el, dist?)` | Camera by angles in degrees; distance defaults to a fit. |
| `look(position, target)` | Camera at `[x, y, z]` looking at `[x, y, z]`. |
| `setNight(on)`, `setHeadlights(on)`, `setBraking(on)` | Lights. |
| `setMotion(on)`, `setTurntable(on)`, `setFloor('Gloss' \| 'Shadow')` | As the buttons. |
| `setIdle(seconds)`, `idle()` | Set the wait before the idle show (0 is off), and read whether it is running. |
| `setLod(i)` | Detail level index, or -1 for Auto. |
| `sidebar(open)` | Shows or hides the sidebar (on a phone, opens or closes the sheet). |
| `param(id, value?)` | Sets a game parameter; with no value, resets it. |
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

## Add an exhibit

A vehicle the game builds needs no exhibit (see above). For design studies or a model the game
cannot build yet:

1. Create `src/dev/vehicleLab/exhibits/<yours>.ts` exporting a `LabExhibit` (types in
   `src/dev/vehicleLab/types.ts`). That is all; it appears in the sidebar.
2. Optionally give it a `section` (sidebar heading), an `order`, a `family` or `paramGroups`
   for the Parameters section, and `aliases` for old URL ids.
3. Open `/vehicle-lab.html?vehicle=<your id>`.

Your model follows the game frame: nose toward -Z, Y up, metres, origin at the vehicle origin.
Report `groundY`, the height of the ground contact relative to the origin (negative when the
origin is above the ground); the lab lifts the model onto the floor. Everything else is optional:
leave out `lods` and there is no Level choice, leave out `cockpit` and there is no Cockpit
switch. Controls you return in `controls` appear in the Options tree under their `group`
heading (default 'Vehicle').

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
      controls: [{ kind: 'toggle', id: 'hover.skirt', label: 'Skirt', group: 'Hull', value: true, onChange: on => { hull.visible = on } }],
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
| `src/dev/vehicleLab/lab.ts` | The lab: selection, sidebar, camera, cockpit, stress, frame loop, capture API. |
| `src/dev/vehicleLab/registry.ts` | Collects every exhibit in `exhibits/`. |
| `src/dev/vehicleLab/tree.ts` | Pure sidebar model: registration, tree, selection and URL, parameter mapping. |
| `src/dev/vehicleLab/ui.ts` | Form control builders for the sidebar. |
| `src/dev/vehicleLab/types.ts` | The exhibit interface. |
| `src/dev/vehicleLab/logic.ts` | Pure parts (stats, groups, URL parameters, Auto detail), tested in `tests/dev/`. |
| `src/dev/vehicleLab/studio.ts` | Softbox environment, key light, day and night, floors. |
| `src/dev/vehicleLab/materials.ts` | Preview materials, lamps and headlight beams. |
| `src/dev/vehicleLab/exhibits/` | One file per exhibit: `buggy.ts` (design studies), `gameVehicles.ts` (every game vehicle). |

## Design studies extras

- **Canopy** cycles between the force field (the design intent: `forceField()` in `materials.ts`, reusable for any shield or canopy) and plain glass.
- **Wheels** (the Tyres choice) picks among the tyre options listed in `labs/buggy-wheels/index.json`, built by `tools/buggy-bodies/wheels.py`. `?wheels=<id>` picks one from the URL.
- A body file may bring its own `Strut` (suspension linkage) and `Sockets` (the fittings where the linkage meets the body). Bodies marked `gameResolution` in `labs/buggy-bodies/index.json` are at the triangle count that would ship.
- A round's picks are generic: an entry in `labs/buggy-bodies/index.json` with `alsoIn: [rounds]`
  appears first in those rounds, marked as the pick they build on, and `basedOn: <id>` names the
  body an entry was built on (in its notes and the round heading). Without any marks, Wide body
  carries into the rounds after round 1 as before. A round opens on its first design that is
  not carried over.

## The live lab

There is one lab link for everyone, served by the `lab` preview service (`tools/lab-live.mjs`).
It shows trunk plus the latest commit of every `veh/*` branch, rebuilt within about fifteen
seconds of any of them moving, with no merge queue in between. So:

- To show a design, commit it to your vehicle branch. Nothing else. Do not make or share a
  preview page of your own for a vehicle.
- The sidebar footer lists the branches the live lab is built from. A branch that does not
  merge cleanly is named there with the conflicting files and is left out until it does; merge
  trunk into your branch to fix it. An exhibit file that fails to load is named there too, and
  the other vehicles still show.
- Never delete or overwrite a round. Every version stays viewable: add a new group (round) and
  leave the old ones in place. Old rounds are tagged "older" and collapsed in the sidebar.
- Put design studies under `section: 'Design studies'` so they sit together.

## Driving the controls, and the idle show

The lab reads the keyboard and the first connected gamepad with the game's own mapping
(`src/core/Input.ts`): A/D or left/right steer, W/S or up/down drive (pitch for aircraft),
Q/E yaw, R/F the jet's throttle; on a gamepad the left stick, the triggers and the right stick.
Models see the result in `LabState` as `steer`, `throttle`, `pitch` and `yaw`, eased so parts
move smoothly, with `animate` true while anything is moving them.

Left alone for 15 seconds, the lab runs by itself: the stage turns slowly, the controls cycle
gently and now and then the camera rises or dips. Any key, pointer movement, touch, wheel or
gamepad input stops it at once and leaves the camera where it is. Scripted captures are exempt:
a browser driven by Playwright (`navigator.webdriver`) or opened with `still=1` never starts the
show unless `idle=<seconds>` or `setIdle()` asks for it. The Turntable toggle still forces a
constant turn.
