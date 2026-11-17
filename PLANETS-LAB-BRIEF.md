# Planets Lab brief

You are the Planets Lab lead for Syn3h. The owner wants "a few more planets circling the
sun in the lobby" and approved six new ones: "I love every single one of these. Build
them. The low-gravity moon is going to be super fun as well." You are an independent peer
of the Terrain Lab (agent `39e2a688-346b-4874-be02-46a7fe6f13ee`, which wrote this brief and
owns the generator), the Water Lab (`4dd65bda-8342-4456-9016-27d6d5fca74a`), the Vegetation
Lab (`3946754f-a80a-45ef-b45c-e7413b381e1c`) and the Synth Orchestrator
(`b5e3521f-c353-4d16-beb2-9ec09f57c1cf`, which merges). The owner directs you. Hard
deadline: noon Sunday Pacific, handed to judges. He removed the earlier cut-off and wants
things built and landed as fast as possible.

Greet him briefly and start building. Show him each planet as it lands through your own
preview. Nothing below is built yet; the design is the Terrain Lab's and was read from the
code, not tried.

## Ground rules

Three.js r187 WebGPU and TSL, TypeScript, Vite, vitest. Worlds are generated identically on
every client from a seed and shared sliders, wrap at their edges and are drawn as a sphere.
Read `ops/PROTOCOL.md` (handoff format in section 7, the gate) and `TERRAIN-LAB-BRIEF.md`.

Worktree: this directory, `/Users/vtn/dev/Syn3h-wt/planets`, branch `feat/planets` (off
`feat/terrain-lab` at 8edfb57, which is ahead of trunk). Never edit `/Users/vtn/dev/Syn3h`
or another lane's worktree. Do not run npm install. Do not push. Wrap every vitest and
Chrome run in `/Users/vtn/dev/Syn3h/tools/heavy.sh`; one dev server, stopped by PID from
`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`; never pkill or killall. Previews only through the
broker (`~/.agents/skills/paseo-preview/SKILL.md`), with your own service in `paseo.json`.

Owner rules: nothing dies or is destroyed; no trees, bushes or cacti; every tunable is a
shared slider; candour and pushback; plain prose with no em dashes; never claim something
works without having looked at it. He judges by eye and rejects shapes that read as
geometry.

## Ownership for this job

The Terrain Lab hands you, for the planets work: `src/world/planets.ts`,
`src/world/planetMap.ts`, `src/world/terrain/settings.ts`, the PALETTES and `setLook` in
`src/world/terrain/material.ts`, `centreProfile` and the per-kind branches in
`src/world/terrain/generate.ts`, the `lightLake` method in `ProceduralTerrain.ts`, the
`dry` switch in `lava.ts` (see below), and `tests/world/planets.test.ts`,
`planetMap.test.ts`. Tell the Terrain Lab before changing anything else in the generator,
roads or the river planner. Do not touch `groundcover.ts` (Vegetation Lab) or
`volcanics.ts` and the liquid queries (Water Lab): ask them.

## How a planet is defined today

- `src/world/planets.ts`: `PLANETS` is a list of recipes `{ id, label, blurb, centre,
  swatch, values }`. `applyPlanet(id, seed)` applies the values through the shared
  parameter registry. The lobby picker and the painted lobby spheres (`planetMap.ts`) read
  `PLANETS`, so a new entry appears in the lobby by itself. `currentPlanet()` matches the
  live world to a recipe by `terrain.kind`; `encodeWorld` and share links depend on it.
- `terrain.kind` (0 volcanic, 1 desert, 2 alpine) currently decides everything at once: the
  centre's shape (`centreProfile`: a concave cone, a two-tier mesa, a horn), the mountain
  style (terraced cellular massifs, flat-topped buttes, ridged ranges), the ground palette
  (`PALETTES[kind]` in material.ts, copied by hand in planetMap.ts), snow (alpine only, from
  36 percent of the summit height), whether the lake and rivers are lava (kind 0 only),
  vents (kind 0 only), fords (not kind 0), and which grass and flowers grow.
- Other levers already shared sliders: `world.seaKind` (0 lava, 1 water),
  `world.lavaAltitude` (sea level, -40 to 60), `terrain.planetSize` (0, 1, 2 = 1, 2, 4 km),
  `terrain.landShare` (0.3 to 0.85), `terrain.islandRadius`, `terrain.coastWobble`,
  `terrain.volcanoHeight`, `volcanoRadius`, `calderaSize`, `mesaHeight` (mountain height),
  `cragDensity`, `spireHeight`, `duneHeight`, `roughness`, `terrain.groundCover`,
  `terrain.fords`, `world.curve` (roundness, default 0.71), `world.gravity` (9.81 default,
  0.81 to 18.81, live), and the sky and weather sliders with four presets in
  `src/world/sky/presets.ts` ('Mars day', 'Earthlike', 'Mire green', 'Violet dusk').

## Recommended design (Terrain Lab's, untested)

1. Keep `terrain.kind` as the SHAPE (0 cone with crater, 1 mesa, 2 horn) and add a new
   world parameter `terrain.look` (0 to 8) for the palette. Existing recipes set look equal
   to kind. `setLook` takes the look; `currentPlanet()` matches on look; planetMap paints
   with the look's palette. Then a new planet is a shape plus a look plus slider values.
2. Add `terrain.snowLine` (fraction of the summit height where snow starts; 2 means none):
   alpine 0.36, ice moon about 0.02 so snow lies everywhere. Tie the tundra and painted
   flowers in material.ts to look 2 only.
3. Add `terrain.dry` (0 or 1): no lake, rivers, pools or vents (make `lavaPass` and
   `ventsPass` return empty data; `summit().lake` is already allowed to be null). Lower the
   minimum of `world.lavaAltitude` from -40 to -80 so a dry world can sink its sea below
   the deepest ground (the sea floor is at -60).
4. Fix `applyPlanet`: it only applies the recipe's own values, so a slider one recipe sets
   and another does not (gravity, dry, snow, size) would leak from planet to planet. Before
   applying, reset every key that appears in ANY recipe to its registered default. The
   Orchestrator asked for exactly this. Add a test: apply the Moon, then Alpine, and assert
   gravity is 9.81 again.
5. New looks need palettes in two places (material.ts and the hand copy in planetMap.ts);
   better, move the palette table to a small file with no three import that both use.

## The six planets the owner approved

| Planet | What he was promised | Suggested recipe |
|---|---|---|
| Archipelago | A small water world: dozens of low sandy islands in turquoise shallows, land about a third of the surface. Made for hovercraft and jets. Centre: a lagoon atoll ringed by a reef road. | shape mesa, low (height about 120); planetSize 0; landShare 0.3; high coastWobble; low mountains, no spires; tropical palette (sand, bright green, pale rock); water sea; 'Earthlike' sky |
| Ice moon | Blue-white ice plains, pale cliffs, a dark cold sea, under the violet dusk sky. Snow everywhere. Centre: a frozen crater with a geyser field. | shape cone with a wide crater, or horn; ice palette; snowLine about 0.02; water sea; 'Violet dusk' sky; ground cover 0 |
| Obsidian | Black glass ground with tall needle spires everywhere, faint magenta seams, a lava sea glowing between them. Centre: a ring of giant shards round a lava pit. | shape cone (lava lake, vents); obsidian palette; spireHeight and cragDensity high; lava sea; 'Violet dusk' or 'Mars day' sky |
| Badlands | Almost all land: a maze of terraced red buttes and canyons, with rivers at the bottom instead of a sea. Centre: the tallest butte, with a spiral road. | shape mesa; landShare 0.85; mesaHeight and cragDensity high; red palette; water, sea level low; fords on would suit it |
| Moon | Grey dust and craters under a black sky with no haze, in low gravity. Centre: a giant impact crater with a central peak. | shape cone, low and wide with the largest crater; dry 1; sea level -80; grey palette; `world.gravity` 1.62 (real Moon) or about 2.9; sky with rayleigh 0, mie 0, clouds 0, fog 0, stars up; ground cover 0. Real crater fields are a new generator feature (about 1.5 hours): ask the Terrain Lab or build it in the shape pass with periodic noise (`pperlin`, `phash2` in noise.ts; every pattern must repeat at the tile's width). |
| Mire (was Methane swamp) | Warm green haze, murky green-brown water, reeds, low mesas in mist. Centre: a reed plateau. | shape mesa, low; olive and ochre palette; 'Mire green' sky; heavier fog; water sea for now, and ask the Water Lab for a third sea colour (teal green) |

Low gravity will stress things other lanes own (suspension and jumps, the jet's hover, the
hovercraft cushion, wing lift out of liquid, the upright rescue, bots). Report what you
see to the Orchestrator; do not fix vehicles yourself.

New planets inherit their shape's grass and flowers (ice would get alpine meadow, the Moon
alien flowers), so set `terrain.groundCover` 0 where that is wrong and tell the Vegetation
Lab which looks need their own cover.

## Checks and tools

`tests/world/planets.test.ts` already checks that every recipe only sets parameters that
exist and are in range, and that each planet generates flat spawn pads and a road to the
summit on three seeds: it will cover new recipes automatically, so keep it passing and
extend it. In `tools/terrainlab/`: `round-shots.mjs` and `cover-shots.mjs` take screenshots
with the game's own camera, `pad-view.ts` computes whether the centre shows from the spawn
pads, `world-report.ts` reports land share and timing, `seam-check.mjs` drives across the
world's edges. Open any world with `?autoplay=1&world=<id>.<seed>&room=<fresh name>`.
`planets.html` shows the painted lobby spheres. Generation must stay under 150 ms at the
2 km size (the timing test enforces it).
