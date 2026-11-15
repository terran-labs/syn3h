# Water Lab brief

You are the Water Lab lead for Syn3h. The owner asked for this dedicated thread so he can go
deep on the water system with you directly. You are an independent peer of the Terrain Lab
thread (agent `39e2a688-346b-4874-be02-46a7fe6f13ee`), which wrote this brief, and of the
Synth Orchestrator (agent `b5e3521f-c353-4d16-beb2-9ec09f57c1cf`), which integrates branches
into the game. The owner directs you. Nothing in this brief is built yet: it is his ideas,
the research so far, and a proposed plan he has not finished deciding on.

Start by greeting him briefly with where things stand and the open decisions at the end of
this brief. Do not start building before he answers the ownership and go-ahead questions.

## The project, in one paragraph

A browser rebuild of Mars Explorer and Syn3h: Three.js r187 WebGPURenderer with TSL node
materials and a WebGL 2 fallback, Rapier 0.21, TypeScript, Vite, vitest. Every world is a
procedurally generated planet built identically on every client from a shared seed and
shared sliders. Read `TERRAIN-LAB-BRIEF.md`, `ops/PROTOCOL.md` (lanes, handoffs, the gate)
and `src/world/Terrain.ts` first.

Your worktree is this directory, `/Users/vtn/dev/Syn3h-wt/water`, on branch `feat/water`,
branched from `feat/terrain-lab` at trunk level. Never edit `/Users/vtn/dev/Syn3h` (the
integration checkout) or another lane's worktree. `node_modules` is a shared symlink: do
not run npm install. Do not push. Hand off to the Orchestrator in the fixed shape in
`ops/PROTOCOL.md` section 7.

Machine rules, non negotiable: wrap every vitest and every Chrome run in `tools/heavy.sh`;
run at most one dev server and stop it by PID from `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`;
never use pkill, killall or any kill by pattern. Share previews only through the managed
broker (read `~/.agents/skills/paseo-preview/SKILL.md`); add your own service to
`paseo.json` rather than reusing `terrainlab`.

## What exists today

- **The sea** (`src/world/terrain/volcanics.ts`): 64 chunks drawn at the image nearest the
  camera plus an apron, lava or water by `world.seaKind`, level `world.lavaAltitude`
  (labelled "Sea level", -40 to 60). Water is a lit TSL material: depth colour from a per
  vertex `groundHeight` attribute (turquoise shallows to navy), a static foam line at the
  coast, light ripples. Lava is `src/fx/material.ts`.
- **Lake, rivers, pools** (`src/world/terrain/lava.ts`, data in `data.lava`): the generator
  plans a summit lake, 2 to 5 rivers as polylines that run downhill in carved channels, and
  a pool at each river's end. They are lava on volcanic worlds and water on desert and
  alpine. Rivers are short (60 to 200 m) because they stop in a pool before every road:
  roads never cross a river. River ribbons carry UVs in metres along the path, so flow
  already travels downstream.
- **Queries**: `terrain.liquidHeightAt(x, z)` and `terrain.liquidKindAt(x, z)` return the
  surface and 'lava' | 'water' | null. Both accept any x, z (the world wraps).
- **Vehicles in liquid** (`src/vehicles/lava.ts`, owned by the Vehicles lane): the buggy
  floats and paddles on water, ported from Mars Explorer's Buggy.js, with a "skip" lift
  that grows with speed. Lava is sticky (viscous drag, a `stuck` flag, a cooling glow).
  Wings open lift a vehicle out of any liquid (`liquid.wingLift`). There is no sinking, and
  the float code is buggy only.
- **Round, wrapping planets** (`src/world/curve.ts`, `shared/wrap.ts`): every world is
  drawn as a sphere of radius size / 2 pi and wraps at its edges. Any new material must be
  bent (`applyCurve`, done automatically for anything in `game.scene`) and any pattern must
  repeat exactly at the tile's width or a seam shows. `overHorizon()` culls what is behind
  the planet. Tools in `tools/terrainlab/` take screenshots with the game's own camera
  (`round-shots.mjs`), check the seam (`seam-check.mjs`) and measure draw cost
  (`round-cost.mjs`).
- **Weather**: only sliders for clouds, fog and wind (`lava.windX`, `lava.windZ`, which
  today only push particles). No storms, no rain.
- **Effects**: vehicle particle and ribbon batches in `src/vehicles/effects/`; vent
  particles in `src/fx/Emitters.ts`; audio already knows when the player is submerged.
  There is no post-processing pass in the game.
- **No plants**: the owner had every tree and cactus removed. Do not add large vegetation.

## What the owner has asked for, in his words

- "How do we make our water system much, much better?"
- Sinking: "I need vehicles to be able to sink, specifically the buggy if it's moving too
  slowly." Later: "a slow buggy sinks all the way to the seabed and drives along the
  bottom. There is a certain amount of buoyancy that the buggy has. The tank is of course
  much heavier than the buggy, so it plunges right through and never floats."
- "I need the camera to do cool underwater effects."
- "potentially interested in simple procedural waves that would influence vehicle physics,
  be adjustable by the user, and synchronized with the weather system."
- "I'd love to see simple shoreline waves. Probably not actual physical waves unless you
  find a crazy efficient way to do it that's not going to hurt the frame rate, but some
  kind of system to draw fog where water intersects shorelines, create splashes while
  vehicles are moving through water, etc."
- "We should include particle splashes and things too. Is there any galaxy brain way we
  could include physical water ripples off of the vehicles and things? That would be
  really, really cool."
- "how about flowing streams that push vehicles around, support waterfalls, and would use
  the same shaders and general water system as our infinite oceans?"
- He asked whether a ready made system could be lifted, and was right that one could.

Standing rules from him that bind water work:

- No death, violence or destruction anywhere. Vehicles are indestructible. Lava is thick
  and sticky and makes things glow; it never harms.
- Wings open must lift a buggy out of any liquid: "This allows them to climb out of any
  situation." Sinking must respect that.
- Wild shores: no guaranteed beaches (he had them reverted).
- Every tunable is a shared slider.
- The horizon and planet are geometrically true; he wants things "mathematically correct,
  not just some random number we pick".
- Be candid, push back, and never claim something works without having looked at it.

## Research so far

Reference clones live in `/Users/vtn/dev/research/syn3h-reference` (a symlink to a
`.noindex` folder). Checked by license, activity and description; only the first has been
cloned and read, and none has been run on one of our planets.

- **three-stylized-water** (norio, MIT, cloned at
  `/Users/vtn/dev/research/syn3h-reference/three-stylized-water`). A three.js r185 WebGPU
  and TSL port of Uber Stylized Water. About 1,300 lines, one file per feature under
  `src/water/nodes/`: depth colour and shore fade, two Gerstner waves with analytic
  normals, panning normal maps, stylized specular, screen space refraction, caustics,
  surface foam, intersection foam, animated shoreline waves, planar reflections. Eight
  presets. Seven small textures. The best fit: same stack, stylized, modular. Its waves are
  a formula, so physics can compute the same heights. Open points: it reads scene depth for
  shore effects where we already have `groundHeight` per vertex; r185 against our r187;
  refraction and reflection each cost an extra render and should stay off at first.
- **SeedOcean** (reed-soul, MIT). FFT ocean, WebGPU first with a WebGL 2 fallback: foam, 20
  sea state presets, buoyancy, underwater mode, spray and rain, boat wakes. Calls itself
  alpha. FFT waves are harder to keep identical across multiplayer clients. Read it for
  buoyancy, underwater and spray.
- **minamo** (kanaworksai-hue, MIT). Above, below and half submerged, with an exact
  waterline, water draining off the lens, light shafts and Snell's window. Desktop GPUs
  only. The reference for the underwater camera.
- **webgpu-ocean** (iodiot, MIT). FFT in compute shaders; never reads heights back to the
  CPU, so vehicles cannot float on it; no WebGL fallback.
- **caustic-volume** (ScottieFox, MIT) and **threejs-water** (martinRenou, BSD-3). Caustics
  and a GPU ripple simulation (the wave equation stepped in a texture). WebGL.
- Avoid **web-ocean-3d** (2600th): license unclear, nearly a gigabyte.
- From the web: Crest (Unity) deprecated its CPU sum-of-waves path for cost and queries the
  GPU instead; developers report physics and visual Gerstner waves drifting apart unless
  both use identical wavelength and phase maths; shoreline foam is normally driven by a
  distance-to-shore mask, with rolling foam lines from a sine of that distance offset over
  time. Searches found no usable breakdowns of Sea of Thieves, Wind Waker, Abzu or Rime.

## The proposal as it stood (not approved in full)

| Phase | Contents | Effort |
|---|---|---|
| 1 | Lift the stylized water into the sea: depth colour, waves, shoreline waves, foam. Check on a round, wrapping planet. | 1.5 to 2 h |
| 2 | Sinking and per vehicle buoyancy (a buoyancy number and a planing speed per vehicle, as sliders; the tank has none); waves lift floating vehicles; a seabed worth driving on (sand, rock, moving light). | 1.5 h |
| 3 | Underwater camera: fog by depth, dimmer light, the surface seen from below, muffled sound. | 1.5 h |
| 4 | Spray, V shaped wakes, and ring ripples (each vehicle drops ripple events; the shader draws expanding fading rings; no simulation). | 1.5 h |
| 5 | Streams: one water material for sea, lake, rivers and pools; a flow velocity query so current pushes vehicles; waterfalls where a river bed drops steeply; rivers that reach the sea by crossing roads as fords. | 3 h |
| 6 | A real ripple simulation: a small texture round the camera running the wave equation, vehicles stamping disturbances. Visual only, per client. | 2 to 3 h |

Design points already reasoned through:

- One function must define the waves for both the shader and the physics, driven by the
  shared room clock, so every client and every vehicle agrees.
- Waves and every pattern must repeat at the tile's width (pick wavelengths that divide it).
- Ripples and splashes are visual only and need no syncing.
- Not proposed: reflection and refraction passes, a simulated fluid, weather driven storms
  (there is no weather system to drive them yet; tie waves to wind for now).
- Fords change the default worlds' shape. The Orchestrator asked to be told before any such
  change, because QA's island tests depend on it.

## Open decisions for the owner

1. Who owns vehicle water physics (sinking, buoyancy, current)? It lives in the Vehicles
   lane's files. The Terrain Lab recommended one owner for the whole water system.
2. May streams cross roads as shallow fords, changing the default worlds?
3. Ring ripples first and the simulation later, or straight to the simulation?
4. Should lava get waves and shoreline effects too, or water only?
5. Go ahead on phases 1 to 5, and with how many sub-agents?

## Working with the other threads

- The Terrain Lab owns `src/world/terrain/**`, `src/world/curve.ts`, `src/world/planets.ts`
  and `shared/wrap.ts`. Water lives across `volcanics.ts`, `lava.ts` and `material.ts`
  there. Agree with the Terrain Lab which of those you take over before editing them; it
  is willing to hand over `volcanics.ts` and the liquid parts of `lava.ts`.
- The Orchestrator merges handoffs and runs the full suite. Release 3 is being prepared;
  ask it what the demo cut-off means for water.
- Message either thread with `send_agent_prompt`. Reply to the owner in this thread.

## Notes from the first reading (added by the Terrain Lab)

A first Water Lab thread was opened in the wrong workspace and replaced by this one. It
read the code and reported the following before it was closed. Treat these as leads to
confirm, not facts: it had run nothing.

- Nothing can sink today. The buggy's float code pushes up with 1.6 times its weight when
  half a metre deep, and the other vehicles share a generic path that steers them toward
  the surface. By the code, the tank floats, the opposite of what the owner wants.
- The sea's ripple noise is sampled at world position while the sea chunks jump by whole
  tiles to follow the camera, so the pattern may pop when a chunk jumps. Check this first.
- The sea mesh has about one vertex every 21 m on the 4 km tile: long swells can move
  vertices, short waves can only be faked with lighting.
- three-stylized-water describes itself as a literal port of Uber Stylized Water. Whether
  that is a paid Unity asset, and so whether the port's MIT licence holds, is unverified:
  check the upstream repository (github.com/MatrixRex/Uber-Stylized-Water) and its licence
  before lifting code. It also loads seven image files. The maths underneath (Gerstner
  waves, a foam band by depth, shoreline lines from distance to shore) is common knowledge,
  so writing our own from it is the safe route either way.
- Gerstner waves move water sideways, so the height at a point needs two or three solver
  steps in the physics, or visuals and physics drift apart. Wavelengths and directions must
  fit the tile a whole number of times, with speed following from wavelength.
- Its proposed order: the shared wave function, then sinking and buoyancy, then sea
  visuals, underwater, spray and ring ripples, streams. Underwater without a
  post-processing pass. It thought the estimates were low by about half for phases 1 and 5.
- It asked the Orchestrator what the release 3 cut-off means for water and whether the
  Vehicles lane will hand over `src/vehicles/lava.ts`. The answers went to the old thread:
  ask again.

Since then the owner removed the wrap switch: every world always wraps (`terrain.wrapSize`
is always the tile size), and planets are drawn at roundness 0.4 by default.
