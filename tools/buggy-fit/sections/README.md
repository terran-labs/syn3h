# Buggy body from section lofts (R&D)

Lane rd/buggygen-sections. How close a section-loft generator gets to the `Body` node of
`public/models/buggy-boxarm.glb` (5,805 triangles), and what each step costs. The run-time
generator and its data are in `src/vehicles/buggygen/sections/`; everything here is offline.

```sh
npx tsx tools/buggy-fit/sections/fit.ts write 16 15            # refit dataA.ts and dataB.ts
npx tsx tools/buggy-fit/sections/fit.ts sweep 0.03             # Level B error against stations and radii
npx tsx tools/buggy-fit/sections/measure.ts src/vehicles/buggygen/sections/levelC.ts levelC
npx tsx tools/buggy-fit/sections/lods.ts src/vehicles/buggygen/sections/levelC.ts levelC-lods
npx tsx tools/buggy-fit/sections/slices.ts                     # contact sheet of Z slices
```

Pictures go to `/tmp/buggy-fit/sections/`: in each sheet the top two rows are the reference
and the bottom two the candidate (side, top, front, rear, front quarter, rear quarter).

## What the reference is

Slicing at 0.1 m steps along Z: one closed outline per station describes the hull from nose
to tail, except where

- the cockpit opening (z -0.6 to 0.65) leaves the top open with a chrome lip curling inward;
- the side scoops (z -0.3 to 0.3) are real recesses whose lips overhang, so a ray from the
  section centre crosses the outline more than once;
- the rear wing (y above 0.9, z 1.62 to 2.05) is a separate closed loop over the tail, joined
  by end plates that grow out of two thin fins on the rear haunches;
- the lamps are small faces of the shell with chrome bezels.

Decomposition used: one polar hull loft, a wing loft, two end plate lofts, and ellipse
features drawn on the hull grid for the opening, rim, stripe, scoops and lamps.

## Results

Measured by `measure.ts` (20,000 area-weighted samples each way, point to triangle; IoU of
400 px orthographic silhouettes; roles = share of reference samples whose nearest candidate
triangle has the reference's role). gzip is the minified esbuild bundle of the level's module,
its data and `loft.ts`, three left out. Build is the mean of five detail 0 builds in Node.

| level | numbers | gzip B | triangles d0/d1/d2 | build ms | ref to cand mean / p95 cm | cand to ref mean / p95 cm | IoU side / top / front | roles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: 9 superellipse stations | 63 | 1,932 | 5,632 / 1,040 / 220 | 17 | 5.3 / 25.1 | 3.6 / 10.3 | 0.876 / 0.886 / 0.873 | 75% |
| B: 16 stations x 15 radii | 272 | 2,383 | 5,632 / 1,040 / 220 | 18 | 2.8 / 19.0 | 2.1 / 7.1 | 0.948 / 0.945 / 0.901 | 78% |
| C: B plus features, wing, plates | 375 | 3,299 | 5,972 / 1,132 / 316 | 26 | 1.3 / 4.6 | 1.1 / 3.9 | 0.967 / 0.965 / 0.929 | 80% |

The reference-to-candidate p95 stays near 19 cm for A and B because neither has the wing or
the cockpit lip; C's wing brings it to 4.6 cm.

### Level B sweep (lambda 0.03, plain tagging, no features)

| stations | radii | numbers | data gzip B | ref to cand mean | p95 | cand to ref mean | p95 | IoU side | top | front |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 7 | 72 | 177 | 4.8 | 20.6 | 3.4 | 9.6 | 0.892 | 0.906 | 0.857 |
| 8 | 11 | 104 | 235 | 3.5 | 21.1 | 2.6 | 8.0 | 0.902 | 0.943 | 0.883 |
| 8 | 15 | 136 | 283 | 3.2 | 19.7 | 2.4 | 8.3 | 0.904 | 0.936 | 0.898 |
| 8 | 21 | 184 | 365 | 3.1 | 20.2 | 2.3 | 8.0 | 0.903 | 0.950 | 0.899 |
| 12 | 7 | 108 | 245 | 4.7 | 20.6 | 3.6 | 11.4 | 0.930 | 0.906 | 0.863 |
| 12 | 11 | 156 | 322 | 3.2 | 19.4 | 2.4 | 6.7 | 0.945 | 0.949 | 0.897 |
| 12 | 15 | 204 | 408 | 3.0 | 19.7 | 2.1 | 6.4 | 0.950 | 0.940 | 0.906 |
| 12 | 21 | 276 | 529 | 2.8 | 19.8 | 1.9 | 5.5 | 0.943 | 0.954 | 0.906 |
| 16 | 7 | 144 | 310 | 4.6 | 20.6 | 3.3 | 10.5 | 0.928 | 0.908 | 0.853 |
| 16 | 11 | 208 | 417 | 3.1 | 18.7 | 2.2 | 6.3 | 0.937 | 0.949 | 0.887 |
| 16 | 15 | 272 | 528 | 2.8 | 19.0 | 1.8 | 6.3 | 0.946 | 0.945 | 0.901 |
| 16 | 21 | 368 | 684 | 2.7 | 19.1 | 1.7 | 5.7 | 0.952 | 0.959 | 0.905 |
| 24 | 7 | 216 | 441 | 4.6 | 20.7 | 3.4 | 11.3 | 0.932 | 0.908 | 0.862 |
| 24 | 11 | 312 | 608 | 3.0 | 19.1 | 2.3 | 8.5 | 0.931 | 0.953 | 0.878 |
| 24 | 15 | 408 | 769 | 2.8 | 19.2 | 1.9 | 6.5 | 0.943 | 0.946 | 0.908 |
| 24 | 21 | 552 | 1011 | 2.6 | 19.4 | 1.6 | 5.8 | 0.948 | 0.960 | 0.908 |
| 32 | 7 | 288 | 578 | 4.6 | 20.9 | 3.5 | 11.8 | 0.932 | 0.909 | 0.858 |
| 32 | 11 | 416 | 793 | 3.0 | 18.7 | 2.4 | 10.5 | 0.920 | 0.954 | 0.871 |
| 32 | 15 | 544 | 1004 | 2.7 | 19.0 | 1.9 | 6.9 | 0.935 | 0.947 | 0.899 |
| 32 | 21 | 736 | 1321 | 2.5 | 19.1 | 1.5 | 5.5 | 0.951 | 0.962 | 0.912 |

Error stops falling at about 12 stations and 11 radii (156 numbers). More stations buy
nothing because the CR blend between stations is not the limit; the polar outline is. More
radii help the fins and fender peaks slowly. Every Level B point is far under the 2,000 number
limit; the curve is flat well before it.

## How it looks (be blunt)

- Level A is a smooth lumpy pod with the right length, width and stance. No fenders, fins,
  wing, cockpit or scoops. It reads as "a car shape", not as this buggy.
- Level B has the right proportions, the front fender humps, the rear haunches and the tail
  fins, but the shell looks crumpled: polar radii fitted per slice wobble between stations,
  and the outline has to bridge the cockpit opening, so the top is a closed hump. No wing.
- Level C is recognisably the buggy in the side, top and quarter views: open cockpit with a
  chrome rim, centre stripe, wing on plates, dark scoop ovals, lamps. Still ugly up close: the
  shell keeps B's crumpled waviness, the cockpit edge is serrated where snapped vertices meet
  unsnapped ones (the rim band is about one cell wide), scoops are painted dark ovals rather
  than recesses, the headlights are flat dabs without bezels, and the tail lights are small.
- Detail 1 keeps the features but they are coarse (cells are 15 cm). Detail 2 drops them and
  is a silhouette with the wing.

## What lofts cannot reach, and why

- Overhangs and re-entrant edges: the cockpit lip curling inward and the scoop lips. A polar
  section is a single radius per angle; anything a ray crosses twice is lost. Superellipses
  are worse. Fix would need offset lofts (an inner skin) or sections that are general closed
  curves, not star shapes.
- Sharp creases: fender peaks and the haunch fins are thin features at a few angles. Uniform
  angle spacing needs many radii to catch them, and Catmull-Rom rounds them.
- Openings with depth: skipping cells makes a hole in a zero-thickness shell; the reference
  has walls inside its scoops. A recess would need a second loft or an inset on the grid.
- Feature edges that do not follow grid lines: vertex snapping hides most of the staircase,
  but where two edges are closer than a cell they fight.

## Editor handles

- Level A: all meaningful. Station z (length, overhangs), half width, top (deck height),
  bottom (floor), centre Y (nose droop, tail lift), the two exponents (squareness of deck and
  floor). A slider set of 7 x 9.
- Level B: z and centre Y per station are handles; the radii are fit coefficients. A few are
  readable (the radius straight up is deck height, straight out is half width) but most are
  shape terms best exposed as sculpt pins, not sliders.
- Level C features: all handles. Cockpit centre, length and width, rim width; stripe width;
  lamp position and size; scoop position and size; wing span, chord, height and thickness;
  plate spacing. Positions were read by hand from the reference's material bounds.

## Under the shared referee

`tools/buggy-fit/compare.ts --part body --detail 0` (merged from rd/buggygen-harness):

| level | numbers | gzip B | mean mm | p95 mm | max mm | normal deg | IoU mean / min (8 views) | closed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 63 | 1,932 | 44.3 | 218.2 | 416.4 | 23.8 | 0.874 / 0.834 | yes |
| B | 272 | 2,383 | 25.0 | 157.6 | 403.6 | 20.7 | 0.927 / 0.884 | yes |
| C | 375 | 3,299 | 12.2 | 43.5 | 133.5 | 20.5 | 0.950 / 0.925 | no: 52 open edges, the cockpit cut |

Model files for comparison: buggy-boxarm.glb is 148,408 bytes gzip.
