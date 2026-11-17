# Buggy shape rig (R&D)

Named, live-editable shape parameters for the cage buggy body (cage250), with the sculpted
features kept rigid: the rig behind a future in-game vehicle editor. Run-time code is in
`src/vehicles/buggygen/shape/`; the lab exhibit is `src/dev/vehicleLab/exhibits/buggyShape.ts`
(`vehicle-lab.html?vehicle=buggy-shape`, whole buggy; `&body=1` for the body alone).

```sh
npx tsx tools/buggy-fit/shape/check.ts          # default equals the shipped body, rigidity, codes, seeds, timings, bytes, extremes
npx tsx tools/buggy-fit/shape/presets.ts        # share code and lab query per preset
npx tsx tools/buggy-fit/shape/spec.ts final /tmp/spec.json      # sheet spec (or baseline)
node tools/buggy-fit/shape/lab-sheet.mjs http://127.0.0.1:5297/ /tmp/out /tmp/spec.json   # through tools/heavy.sh
node tools/buggy-fit/shape/browser-time.mjs http://127.0.0.1:5297/                       # through tools/heavy.sh
```

The blocking invariants are in `tests/vehicles2/buggyShape.test.ts`.

## How it works

1. **Field** (`handles.ts`): each handle is a smooth displacement field (smoothstep or bump
   falloffs along z, height or distance from the centre line) over the half cage's control
   points, before the cage lane's subdivision. Creases are topology, so they stay crisp.
   Points on the mirror plane stay on it.
2. **Rigid features** (`features.ts`, `rig.ts`): the headlight ducts, side scoops, hood scoop,
   tail lamp bars and cockpit rim are found in the cage by face role and position. Each takes
   the rotation and translation that best follow the field over its own points (Horn's
   quaternion fit), plus one uniform scale where a handle sizes it (`lampSize`, `scoopSize`,
   `cockpitSize`). Features on the mirror plane (hood scoop, cockpit) may only pitch, rise
   and slide. The paint around each feature blends from its rigid motion into the field over
   10 to 20 cm, so all the strain goes into plain paint.
3. **Parts** (`parts.ts`): built once against the shipped body, then moved. Canopy and tub
   ride with the cockpit rim; the duct lenses with the duct; the side lamp and the swellings
   rigidly by the best fit to the field, then along the body normal to their shipped depth;
   the skid plate by the field point by point. Wheels, arms, shocks, shock tops and wings do
   not move. `Syn3hBuggySkin` takes them through an optional `parts` hook on its body source.

The default shape returns the shipped cage and calls `buildParts` unchanged, so it builds the
shipped buggy bit for bit.

## Handles

Each has a full range (reachable by hand, to show where the rig stops) and, for some, a
narrower `safe` range that random seeds draw from. See `HANDLES` for the numbers.

## Where it breaks (check.ts and the lab, 17 November 2026)

- **Lowering the deck** (`height` below about -0.21, the streamliner): the rear shock tops come
  through the deck. The suspension towers set a floor for the deck.
- **Raising the body** (`rideHeight` above about 0.06): the shock tops drop out of the body.
- **Narrowing** (`width` below 0, `noseWidth`/`tailWidth` below about -0.15, negative flares):
  the arm roots and swellings show. Narrowing needs the track to narrow too.
- **Widening past about 0.15** with flares: the body enters the tyre envelope.
- **Spoiler height above about 0.3**, **deck crown above about 0.12**: the cage folds.
- **Looks**: the hood scoop is rigid, so a strong deck crown leaves a dent around it; a short
  nose with a tall deck (crawler) makes a slab face; tall spoilers turn the plates into fins
  that dominate the silhouette. The mid and far detail bodies (`distantBuggyBody`) do not
  follow the shape at all.

The checks find folds and collisions, not ugliness. Look at the sheets before trusting a range.
