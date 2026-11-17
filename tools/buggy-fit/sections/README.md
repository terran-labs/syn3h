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

## Round 2: a designed hull instead of fitted radii (16 November 2026, night)

The owner judged Level C "much lower visual quality than the current loaded buggy". This
round dropped the free-radius hull and rebuilt `levelC.ts` (same module and id, so the lab's
Skins group, `design=generated-loft`, shows it). The round 1 grid version is kept as
`levelCgrid.ts` (id `sections-C-grid`).

What changed:

- **Hull (`hull.ts`, `dataHull.ts`).** Each section's half outline runs through five named
  points: floor edge, widest point, shoulder peak, deck valley, crown. Cubic segments join
  them, with creases at the floor edge and the shoulder and smooth tangents elsewhere. Each
  of the nine numbers is a Catmull-Rom curve through 12 keys along Z. `fitHull.ts` fits the
  keys globally by coordinate descent against reference slices every 4 cm, with a bending
  penalty and a weak pull toward a hand-placed starting design, so each point keeps its
  meaning along the body. The front fender keys are then set by hand (OVERRIDES in the
  fitter): the fit rounds those corners off, and they carry much of the character.
- **Creases (`loft.ts` skin, `creases` option).** Grid columns are allocated per outline
  segment, so the floor edge and shoulder are always grid lines; vertices on them take each
  cell's own normal, so the fold is crisp and everything else is smooth.
- **Openings under separate pieces (`levelC.ts`).** The cockpit is cut under a swept chrome
  lip (an elliptical tube resting on the deck). Each scoop is a slanted slot cut under a
  body-colour lip with a recessed dark pocket behind it. Each headlight sits in a chrome duct
  under a bezel with the lamp at its floor. Tail lamps are thin bars proud of the rear panel.
  Grid vertices near each cut snap onto it, and the lip covers what is left of the staircase.
- **Rear.** End plates follow the hull's fin line instead of sitting at a fixed x.

Numbers (`compare.ts --part body --detail 0`, and `measure.ts`):

| version | numbers | gzip B | triangles d0/d1/d2 | build ms | mean / p95 / max mm | IoU mean / min |
| --- | --- | --- | --- | --- | --- | --- |
| round 1 Level C (grid) | 375 | 3,299 | 5,972 / 1,132 / 316 | 26 to 62 | 12.2 / 43.5 / 133.5 | 0.950 / 0.925 |
| round 2 Level C (designed hull) | 193 | 5,880 | 7,056 / 1,368 / 384 | 52 | 22.9 / 70.9 / 134.8 | 0.938 / 0.915 |
| cage250 (for comparison) | 3,402 | 6,992 | 3,696 / 924 / 924 | 8 | 4.5 / 12.9 / 31.2 | 0.984 / 0.979 |

Round 2 sits further from the sculpt in millimetres, by design: it trades closeness for a
fair surface. Of its 193 numbers, 120 are the hull (12 key positions and 9 tracks of 12
values) and 73 are features; every one is a named handle (floor height, floor width, width,
belt line, fender line and height, deck dip, crown; cockpit, scoop, lamp, wing and plate
sizes and positions). None is a fit coefficient without a meaning.

Build time is dominated by placing the headlight ducts and scoops on the hull
(`HullQuery.front` and `side` re-sample the outline on every call); caching the outline per
z would bring it near the cage's.

## Round 3: volume, speed, the editor and new vehicles (16 to 17 November 2026, night)

### Body

- **Wheel arches and flank** (`hull.ts` `Arches`): smooth bulges over each axle (fender
  and widest point together) and along the flank between the arches. Three amounts, fitted
  with the keys; positions and lengths are design handles.
- **Front fenders fitted, no longer hand set** (`fitHull.ts`): reference samples at each
  slice's outer upper corner are weighted up to 7 times, and the shoulder may sit within a few
  millimetres of the widest point, so the flared fender tips come out of the fit.
- **Rear panel** (`design.ts` `rearPanel`): the hull is left open at the tail and closed by a
  flat rim, a recess under the deck lip and its floor, with the tail lamp bars on the floor.
- **Headlight ducts on the parts' lens** (`DUCT_LAMP` from `parts/sockets.ts`): the duct is cut
  along the lens's own axis, under a planar chrome bezel fitted through where the rim meets
  the nose, and the parts seat their lens inside it.
- **Creases** fold only away from the nose and tail tips, where columns converge.
- **Speed**: the skin now writes indexed geometry directly (no weld pass), and outline
  queries are cached per station.

| version | numbers | gzip B | triangles d0/d1/d2 | build ms | mean / p95 / max mm | IoU mean / min |
| --- | --- | --- | --- | --- | --- | --- |
| round 2 | 193 | 5,880 | 7,056 / 1,368 / 384 | 52 | 22.9 / 70.9 / 134.8 | 0.938 / 0.915 |
| round 3 | 202 | 7,522 | 4,880 / 1,456 / 384 | 7.5 | 20.8 / 60.1 / 134.6 | 0.938 / 0.922 |

The gzip figure now includes the parts' sockets module, imported for the lens frame; the game
ships that module anyway. The whole buggy on this body is 11,034 triangles in 6 draws at
near detail. The referee reports 14 inconsistently wound edges (the thin tail bar tips and two
snapped cells at the nose and tail), out of about 7,000.

### Editor (`editor.ts`, exhibit `src/dev/vehicleLab/exhibits/loftEditor.ts`)

23 handles in six groups: Stance (nose length, tail length, width, floor height), Hull lines
(deck, fender, crown, belt, tumblehome, nose drop, tail kick, front and rear arches, flanks),
Cockpit (opening length and width), Scoops (size, lean, position), Lamps (duct size, tail
lamp length), Wing (height, span, chord). All at 0 builds Level C exactly (checked: 0 mm).
Share code: 25 characters (a version character and one per handle).

`editorCheck.ts` checks every range end, all at minimum, all at maximum, the presets and 100
random seeds for: finite geometry; no outline fold; shock tops inside the hull; no body point
inside a tyre; the eye 0.25 m from the body; the deck ahead of the cockpit at least 6.5 cm
below the eye; the parts' duct lens finding the nose. Result: 53 of 53 and 100 of 100.

Two couplings make every setting valid rather than shrinking every range: height changes
scale each section toward its floor when lowering (so the small nose sections cannot fold),
and the deck ahead of the cockpit is capped at the driver's sightline (0.725 m).

Regeneration per edit: Node 4.4 ms median; desktop Chrome (headless) 4.7 ms median for the
body, 38 ms median for the whole generated buggy. No phone was measured.

### Presets, and what held them back

Streamliner, rock crawler and wedge are handle values only. They keep the buggy's wheels,
arms, shocks, lamp lenses, canopy and driver's eye, which held them back:

- **Driver's sightline**: the crawler cannot raise its deck ahead of the cockpit, so it grows
  tall walls round a low cockpit and reads as a tub.
- **Lamp lenses**: the parts place the headlight lens (and a small side lamp) at fixed
  points. A dropped or stretched nose leaves them proud of the body (streamliner, wedge).
- **Wheelbase and track**: fixed, so the streamliner is long only in its overhangs and the
  wedge is wide only in its body.
- **Shock tops**: the body may not narrow past them (width and front arch minimums).
