# buggy-fit

Measures how close a code-generated buggy gets to the loaded one. Developer tooling: nothing
here ships in the game.

## Reference parts

`reference.ts` reads `public/models/buggy-boxarm.glb` and `public/models/buggy.glb` with no
dependencies and returns each part the game uses, in the frame `LoadedBuggySkin` uses it:

| part | source node | frame |
| --- | --- | --- |
| body, sockets, interior, canopy | buggy-boxarm.glb Body, Sockets, Interior, Canopy | game frame: +X right, +Y up, -Z forward, metres |
| strut, shock | buggy-boxarm.glb Strut, Shock | the part's own frame (hub at origin, span along +Y) |
| stator | buggy.glb RimSimple | recentred on its bounding box centre, wheel axle along X |
| wings | buggy.glb Wings | rotY(pi) * rotX(pi/2), plus its mirror in X (rewound) |

`statorNear` (buggy.glb Rim, recentred) is also returned for reference; the game no longer draws it.

```sh
npx tsx tools/buggy-fit/reference.ts   # part names, triangle counts, materials, bounds
```

```ts
import { loadReference, toBufferGeometry } from './reference'
const ref = loadReference()          // { body: { positions, indices, materials, ... }, ... }
ref.body.materials[t]                 // material name of triangle t
const geometry = await toBufferGeometry(ref.body)   // three.js, groups by material
```

## Candidates

A candidate is a TypeScript module that default-exports

```ts
{ id: string, build(detail: 0 | 1 | 2): { part, role: string, geometry: THREE.BufferGeometry }[], numbers?: number }
```

with `part` one of the names above. Several entries may share a part (one per role); they are
merged for measurement. Import three as `three` (not `three/webgpu`) so the module runs in Node.

## Compare

```sh
npx tsx tools/buggy-fit/compare.ts tools/buggy-fit/placeholder.ts                 # every part the candidate builds
npx tsx tools/buggy-fit/compare.ts src/vehicles/buggygen/mine.ts --part body --detail 0 --out /tmp/buggy-fit/mine
npx tsx tools/buggy-fit/compare.ts src/vehicles/buggygen/mine.ts --no-images      # numbers only, about a second
```

Per part and overall it reports, in `report.json` and `report.md` in the output directory
(default `/tmp/buggy-fit/<id>-d<detail>`):

- symmetric surface distance from 20,000 area-weighted samples on each surface (`--samples`):
  mean, 95th percentile and maximum, in mm and as a percentage of the reference part's bounding
  diagonal, plus the two one-way means (reference to candidate shows missing features,
  candidate to reference shows extra ones);
- mean normal deviation in degrees, between each sample's face and the nearest face on the
  other surface. Orientation counts, so a wrongly wound or inward facing candidate scores near
  180. The reference Interior is an inward facing tub, so match its winding;
- silhouette IoU at 512 by 512 from the six axis views and two three quarter views, each view
  and mean and worst;
- bounding box size and centre deltas (mm), enclosed volume and its delta (meaningful only for
  closed parts; the reference body is several overlapping shells);
- triangle counts, closure and winding of the candidate (vertices welded at 0.01 mm);
- build time, the median of 7 builds after 2 warm-up builds;
- code cost: the candidate module bundled by esbuild with its local imports, three external,
  minified and gzipped at level 9. Compare with buggy.glb 139,281 and buggy-boxarm.glb 148,408
  bytes gzip.

Overall rows weigh each part equally, whatever its size.

### Images

For each part and view, `<part>-<view>.png` (2400 by 636): reference (blue grey), candidate
(sand) and the candidate coloured by distance to the reference, green on it and red at 2% of the
reference diagonal or beyond. On that third panel the reference silhouette is outlined in cyan
and reference area the candidate leaves uncovered is dark blue. Faces seen from behind are
magenta in every panel: an open shell seen from inside, or wrong winding. `<part>-sheet.png`
stacks all eight views. Images take a few seconds per part; `--no-images` skips them.

## Self-test

```sh
npx tsx tools/buggy-fit/selftest.ts
```

A tool check, not a blocking test: each reference part against itself (zero distance, IoU 1),
against a copy moved 10 mm (centre moves 10 mm, no distance above 10 mm), and a unit cube
against one grown 10 mm per face (mean 10 mm, volume up 6.12%).

## Vehicle lab exhibit

`src/dev/vehicleLab/exhibits/buggyFit.ts` shows the reference parts and a candidate assembled
the same way at rest (hubs, struts and shocks at the four corners, generated tyres for
context), with the shared vehicle shading. Run the dev server and open:

- `/vehicle-lab.html?vehicle=buggy-fit`: the reference parts (the loaded model).
- `/vehicle-lab.html?vehicle=buggy-fit&design=<module>`: a candidate, named by its file in
  `src/vehicles/buggygen/` without `.ts`. Any module there whose default export has `build`
  is listed.
- `/vehicle-lab.html?vehicle=buggy-fit&design=placeholder`: `tools/buggy-fit/placeholder.ts`.
- `&design=all`: reference and every candidate side by side.

A candidate's Options have **Show** (Candidate, Reference, Overlay: the reference as a cyan
wireframe drawn over the candidate) and **Wings (open)**. Detail Level passes to `build()`.
The page fetches the two model files to build the reference with `glb.ts`, the same code the
harness measures with; it is a developer page and does not ship.

Scripted shot (dev server on port 5297):

```sh
tools/heavy.sh node tools/lab-shot.mjs http://127.0.0.1:5297/ /tmp/buggy-fit/lab \
  'overlay=vehicle=buggy-fit&design=placeholder@35,22,8~fit.show:2'
```
