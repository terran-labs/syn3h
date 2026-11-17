# Buggy shape handles (R&D)

Named, live-editable shape parameters for the cage buggy body (rd/buggygen-cage's cage250):
the proof of concept for an in-game vehicle editor. Run-time code is in
`src/vehicles/buggygen/shape/`; the lab exhibit is `src/dev/vehicleLab/exhibits/buggyShape.ts`.

```sh
npx tsx tools/buggy-fit/shape/check.ts          # default equals cage250, codes, seeds, timings, extremes, headroom
npx tsx tools/buggy-fit/shape/presets.ts        # lab-shot arguments for the screenshot set
node tools/buggy-fit/shape/browser-time.mjs http://127.0.0.1:5297/   # through tools/heavy.sh
```

## How it works

`deform()` moves the half cage's control points before the cage lane's Loop subdivision. Each
handle is a smooth displacement field: a smoothstep or bump falloff along Z, height or
distance from the centre line, so the cage moves in broad regions and the subdivided surface
stays fair. Creases are part of the cage's topology, so they stay crisp. Points on the mirror
plane stay on it. All handles at 0 reproduce cage250 exactly (checked: 0 mm difference).

## Handles

| id | label | range | unit |
| --- | --- | --- | --- |
| noseLength | Nose length | -0.15 to 0.25 | m, stretch ahead of the front axle |
| noseDroop | Nose droop | -0.08 to 0.14 | m, top of the nose down |
| tailLength | Tail length | -0.12 to 0.2 | m, stretch behind the rear axle |
| tailHeight | Tail height | -0.08 to 0.14 | m, deck rising toward the tail |
| width | Width | 0 to 0.1 | fraction |
| height | Height | -0.1 to 0.12 | fraction of deck height; the sides stay |
| cockpitLength | Cockpit length | -0.12 to 0.18 | fraction |
| cockpitWidth | Cockpit width | -0.1 to 0.12 | fraction |
| frontFlare | Front fender flare | -0.02 to 0.12 | m outward |
| rearFlare | Rear fender flare | -0.02 to 0.12 | m outward |
| haunchHeight | Haunch height | -0.05 to 0.14 | m |
| spoilerHeight | Spoiler height | -0.07 to 0.25 | m |
| spoilerRake | Spoiler rake | -8 to 14 | degrees, trailing edge up |
| scoopSize | Scoop size | -0.2 to 0.2 | fraction |
| belly | Belly clearance | -0.03 to 0.05 | m, floor between the axles |

## Constraints

Nothing mechanical moves. Nose and tail length stretch only beyond the axle lines, so the
wheelbase, axle mounts (LoadedBuggySkin axleMounts(.55, .15, 1.2)) and shock tops (the glb
Shock node's extras) stay valid. `check.ts` tests, for every handle at each end, all handles
at their minimum, all at their maximum, and 60 random seeds:

- no subdivided face turns over against the fitted body (a fold);
- all four shock tops stay inside the body;
- the body covers the sockets at least as well as the fitted body (5% slack, since the
  sockets poke through by design where the arms attach);
- the driver's eye (0, 0.8, 0) keeps 0.25 m clearance (PATTERN.md rule 3);
- no body point enters a tyre envelope (radius 0.45 m about each rest hub, x 0.88 to 1.32).

Ranges were cut where these failed: width cannot go negative (narrowing exposes the sockets),
height only lifts the deck (lifting the sides exposed the shock tops), scoop size is held to
plus or minus 0.2 (beyond it the scoop rim folds), belly to 0.05 m.

Handles that would need the mechanical layout to move with them: overall length and
wheelbase (not offered; nose and tail length are the stand-ins), track width (width stops at
0.1, and narrowing at all needs the axle mounts and shock tops to come inward), ride height
(height leaves the sides alone for this reason), and fender flares past about 0.12 m look
right only if the track widens with them.

## Not a guarantee of looks

The checks find folds and collisions, not ugliness. See the screenshots before trusting a
range.
