# Buggy body as a control cage

R&D lane, 16 November 2026. The buggy `Body` (5,805 triangles in `buggy-boxarm.glb`) rebuilt
as a coarse triangle cage plus run-time Loop subdivision with sharp edges. Nothing here is
wired into the game.

What would ship, in `src/vehicles/buggygen/cage/`:

- `subdivide.ts`: Loop subdivision with crease edges, no dependencies. Edges are sharp when
  tagged, open, non-manifold or between two roles; a vertex on two sharp edges slides along
  them, a vertex on three or more stays put. Each step is a stencil, so the offline fitter
  uses the same code as the game.
- `generator.ts`: mirrors the half cage, subdivides `levels[detail]` times, writes one
  geometry per role with corner normals split at 40 degrees and at role borders.
- `cage60.ts` ... `cage500.ts`: generated data, integer millimetres, half body (x >= 0).
  The 250 and 500 cages draw the 60 point cage at detail 2.

Offline (this folder, never shipped): `glb.ts` reads the reference, `decimate.ts` does quadric
edge collapse on the half body with border planes and a mirror plane rule, `fit.ts` moves the
cage so its subdivided surface lands on the reference, `render.ts` draws PNG sheets,
`build.ts` runs it all.

    npx tsx tools/buggy-fit/cage/build.ts            # writes the cages, images to /tmp/buggy-fit/cage
    npx tsx tools/buggy-fit/compare.ts src/vehicles/buggygen/cage/cage250.ts --part body --detail 0

## Results (harness `compare.ts`, detail 0)

| cage | stored points | numbers | gzip bundle B | triangles d0 / d1 / d2 | build ms | mean / p95 / max mm | silhouette IoU | editable? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cage60 | 60 | 642 | 2,983 | 3,296 / 824 / 206 | 2 | 12.8 / 37 / 102 | 0.959 | yes |
| cage120 | 120 | 1,314 | 3,896 | 6,816 / 1,704 / 426 | 4 | 6.3 / 18 / 77 | 0.976 | yes, with effort |
| cage250 | 250 (+60 far) | 3,390 | 6,734 | 3,696 / 924 / 206 | 2 | 3.4 / 10 / 31 | 0.985 | barely |
| cage500 | 500 (+60 far) | 6,082 | 10,485 | 7,552 / 1,888 / 206 | 5 | 1.7 / 5 / 28 | 0.993 | no |

Build ms is the best of 20 in Node on the dev Mac; the harness median is 4 to 11 ms with other
lanes loading the machine. Gzip bundle is generator, subdivision and data, minified.

Baselines: `buggy-boxarm.glb` is 148,408 bytes gzip. The half reference body retyped as
integer millimetre JSON (1,509 points, 16,139 numbers) is 21,578 bytes gzip of data alone.

Quantisation: storing at a 2 mm or 5 mm grid instead of 1 mm moves the mean by 0.1 to 0.4 mm
and saves only 3 to 9 percent of the data bytes, because the face indices dominate.

## Honest placement

- 60 points: a generator. A person could drag these points in an editor and see the body
  respond. It loses the headlight bezels, shrinks the tail lamps to slivers and turns the side
  scoop into a wedge.
- 120 points: still editable, about 2 KB of data. Reads as the buggy; lamps are simplified.
- 250 points: close to the reference (3.4 mm mean), but the cage is an irregular decimation
  with sliver triangles. Nobody would edit it by hand point by point; it would need region
  handles on top.
- 500 points: the reference retyped at a third of its vertex count. An asset in disguise.

## What did not work

- The reference is not one clean subdivision step to reverse: it is a single triangulated
  mesh with valence 3 to 16 vertices and 87 open edges, so the cages come from decimation.
- Matching reference samples back to the nearest fine vertex (`reverse`) makes each fitting
  round worse for 120 points and up; it is kept only for the 60 point cage.
- Pulling cage points toward their neighbours (`fair`) shrinks the body. An edge length
  term in decimation (`SHAPE`) cost accuracy without making the cage visibly more regular.
- Every cage carries some wrinkles from sliver triangles; the fitted surface follows the
  reference's own faceting.
