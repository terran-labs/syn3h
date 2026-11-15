# Vegetation Lab brief

You are the Vegetation Lab lead for Syn3h. The owner asked for this dedicated workspace to
"finish out the new vegetation system and implement beautiful vegetation for all of our
biomes". You are an independent peer of the Terrain Lab (agent
`39e2a688-346b-4874-be02-46a7fe6f13ee`, which wrote this brief), the Water Lab (agent
`4dd65bda-8342-4456-9016-27d6d5fca74a`) and the Synth Orchestrator (agent
`b5e3521f-c353-4d16-beb2-9ec09f57c1cf`, which merges branches into the game). The owner
directs you.

Greet him briefly with your plan and start building: he has approved the direction below.
The one thing to confirm with him is the volcanic palette (see "Open with the owner").

## The project in one paragraph

A browser game: Three.js r187 WebGPURenderer with TSL node
materials and a WebGL 2 fallback, Rapier, TypeScript, Vite, vitest. Every world is a
procedurally generated planet built identically on every client from a shared seed and
shared sliders. Worlds wrap at their edges and are drawn as a sphere. Three kinds exist
(`settings.kind`: 0 volcanic, 1 desert, 2 alpine; recipes in `src/world/planets.ts`). Read
`ops/PROTOCOL.md` (lanes, the handoff format in section 7, the gate) and
`TERRAIN-LAB-BRIEF.md` for background.

Your worktree is this directory, `/Users/vtn/dev/Syn3h-wt/vegetation`, on branch
`feat/vegetation`, branched from `feat/terrain-lab`. Never edit `/Users/vtn/dev/Syn3h` or
another lane's worktree. `node_modules` is a shared symlink: do not run npm install. Do not
push. Hand off to the Orchestrator in the protocol's fixed shape.

Machine rules, non negotiable: wrap every vitest and every Chrome run in `tools/heavy.sh`;
run at most one dev server and stop it by PID from `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`;
never use pkill, killall or any kill by pattern. Share previews only through the managed
broker (read `~/.agents/skills/paseo-preview/SKILL.md`); add your own service to
`paseo.json` rather than reusing `terrainlab`.

## What you own

- `src/world/terrain/groundcover.ts` (all of it) and the two `GroundCover` lines in
  `ProceduralTerrain.ts` (construction and `rebuild`, plus `setEnabled` in
  `setRenderQuality`).
- New files you add for vegetation, their tests under `tests/world/`, and
  `tools/terrainlab/cover-shots.mjs`.
- The recipe values for vegetation sliders in `src/world/planets.ts` (only those keys).

Not yours without asking: the ground material `src/world/terrain/material.ts` (Terrain
Lab), the generator, roads, lava planner, `curve.ts`, `mesh.ts`, the sea and rivers
(`volcanics.ts`, Water Lab). You will want the ground's colour recipe: ask the Terrain Lab
to export what you need from `material.ts` (for example the palette per kind and the snow
and shore rules) instead of copying it, and it will. If you want the ground tinted under
dense growth, ask the Terrain Lab for a hook.

Dormant, do not revive: `forest.ts` and `trees.ts` (trees, bushes, cacti) and the
`terrain.treeCover` slider, which is 0 everywhere.

## What exists today (`groundcover.ts`)

- A camera-following treadmill: each layer is one mesh of N x N instances on a grid of
  cells that scrolls with the camera. A slot always shows the cell nearest the camera whose
  index matches it, so only the rows that scrolled are recomputed. What grows in a cell is
  decided by an integer hash of the cell (`phash2`), so every player sees the same plants
  and the pattern repeats exactly at the world's edge. Camera cells are snapped to blocks
  of 8 so updates happen a few times a second.
- Per instance attributes: origin, rotation and scale, tint. Per vertex: colour, sway,
  tint mix, glow. Placement, wind sway and distance fade are in the vertex stage
  (`coverMaterial`). Plants are lit as if facing straight up. Glow is turned down as night
  exposure rises (`glowDim`).
- `grow(ground, hash, out)` per layer decides presence, size and tint from the ground at
  the cell: height, a patch noise, a broader region noise, and the terrain's volcanic
  (rock) mask. Cells under the sea (level plus 1.8 m, the Water Lab's largest wave plus a
  margin), under a river or pool, on slopes steeper than about 33 degrees, or within 7.5 m
  of a road centreline grow nothing.
- Layers today. Alpine: grass tufts (176 x 176 at 0.8 m), daisies (80 x 80 at 1.6 m), lupin
  spikes and stones (64 x 64 at 3.2 m). Desert: dry grass tufts and a few blooms.
  Volcanic: black and crimson blades with ember tips, anemone blooms (a stalk with six
  drooping glowing arms) and tube clumps.
- Cost: about 300k to 450k triangles in a few draw calls, so it is enabled only at graphics
  level 2 (desktop). Shared slider `terrain.groundCover` (0 hides it). No collision.
- The scene is bent onto the sphere automatically (`applyCurve` in `src/world/curve.ts` is
  applied to every material in `game.scene`). Use `overHorizon()` from there if you add
  anything far from the camera.
- `tools/terrainlab/cover-shots.mjs` parks the player beside a spawn pad and takes day and
  night close-ups with the game's own camera (`PAD` and `SIDE` in the environment choose
  the spot). `round-shots.mjs` moves the player along the summit road. Look at your work in
  screenshots before claiming anything.

## What the owner has said, in his words

- "The alpine trees look absolutely ridiculous, and they're destroying it for me.
  Eliminate all large vegetation such as trees from all worlds, eliminate cacti, etc.
  You're welcome to add grass and flowers as long as they look really cool."
- "Can you add more grasses and some little flowers and things to each world? Make the
  volcanic world flowers super alien."
- On the first version: "Your lava flowers are terrible. They just look like geometric
  diamonds. Your desert sand grass is fine. Your alpine grass is good, but it's pretty
  monotonous, and your flowers and the alpine scene are far too monotonous."
- On the second version: "Your latest alien vegetation for the lava planet is much cooler,
  but I think it's too colorful. All vegetation needs to blend into the terrain a little
  better to look like it's growing out of it and not just plastered on top of it."
- The brief for you: "finish out the new vegetation system and implement beautiful
  vegetation for all of our biomes."

Standing rules: no large vegetation (no trees, bushes, cacti); nothing dies or is
destroyed; every tunable is a shared slider; be candid and push back; plain direct prose
with no em dashes; never claim something works without having looked at it. He judges by
eye and is hard to please: low polygon shapes that read as geometry get rejected.

## Why it looks plastered on today (Terrain Lab's diagnosis)

1. Plants ignore the ground colour, so there is a hard line at every foot.
2. They are lit as if facing straight up, so a tuft on a shaded slope is as bright as one
   in the sun.
3. Nothing darkens where a plant meets the ground.
4. The ground under a meadow looks the same as bare ground.
5. The volcanic plants use four unrelated neon colours.

## The recommendations the owner approved ("Excellent")

1. Root colour from the ground: compute the terrain's own colour at each plant's foot and
   fade from that at the root to the plant's colour at the tip.
2. Light plants with the ground's slope normal, not straight up.
3. Darken the base of every plant, and tint the ground under dense growth slightly darker
   and toward the plant colour.
4. One hue family per world, drawn from the terrain. Volcanic: ember orange, deep red and
   magenta, with one rare cold accent (cyan), about one plant in twenty.
5. Glow only at the heart and tips, on dark earth-coloured stalks; less by day, more at
   night.
6. Lava-fed growth: the densest alien plants near lava rivers and pools, thinning with
   distance (`data.lava.rivers`, `data.lava.pools`; `distanceToPolyline` in `raster.ts`).
7. Clump the grass: blades grouped so height, colour and lean vary together, with gaps.
8. Soften the far edge: thin plants gradually with distance and blend their colour toward
   the ground's, so no ring shows where they stop.

Research behind these (thin on primary sources): reimplementations of the Ghost of
Tsushima grass talk (github.com/2Retr0/GodotGrass, cainrademan.github.io/Unity-Grass,
thuleanx.github.io/graphics/grass) use root-to-tip gradients, clump colours and roots that
blend with the ground; others shade grass from the ground normal and bake darkening into
the base; Unigine blends the foot of a plant into the terrain; notes on Avatar's Pandora
say its life glows in one colour range. The GDC talk "Procedural Grass in Ghost of
Tsushima" (Eric Wohllaib) is the primary source and was not read: read it if you can.

## Known weaknesses to fix or decide

- The anemone arms are flat single-colour ribbons and look papery up close.
- Alpine daisies came out pastel and sparse; lupins were never seen in a screenshot;
  stones are plain grey lumps.
- Desert has only dry tufts and rare blooms. The owner called the grass fine, but "all
  biomes" should be beautiful: consider low succulents, seed heads, dry flower stalks.
- Phones draw none. A cheaper tier for graphics level 1 would be welcome.
- Frame cost is unmeasured on a real GPU. `tools/terrainlab/round-cost.mjs` reads draw
  calls and triangles.
- New kinds of planet may come later: keep per-kind vegetation as data, easy to add to.

## Open with the owner

- Volcanic palette: the Terrain Lab proposed ember, red and magenta with a rare cyan
  accent, or alternatively all dark with only faint glow. He replied "Excellent" to the
  whole list without picking. Start with the first and show him.
