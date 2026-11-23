# Shared vehicle submission budget

Measured on the island with headless system Chrome/WebGPU, against shared code at e7f75ea. Eight visible Mira buggies now add 88 main-pass submissions nearby or 80 at low detail, down from 216. The live desktop BotManager run added 82 submissions including shadows, down from 449. Mobile quality caps the actual bot population at four: those added 22, down from 54.

## Per-instance comparison

The local vehicle and a remote copy at 8 m use identical detail. Counts include attached lamps before batching; after batching all vehicle lamps share one scene draw already present in the hidden-instance baseline. Therefore the 320-triangle near-detail reduction is shared lamp accounting, not removed vehicle geometry.

| Kind | Before draws / triangles / materials | After near | After remote at 80 m |
| --- | --- | --- | --- |
| Mira buggy | 27 / 14271 / 15 | 11 / 13951 / 8 | 10 / 5054 / 7 |
| Classic buggy | 23 / 25955 / 12 | 7 / 25635 / 4 | 6 / 6780 / 3 |
| Jet | 17 / 1478 / 6 | 13 / 1158 / 4 | 13 / 1002 / 4 |
| Hovercraft | 11 / 724 / 7 | 6 / 404 / 5 | 6 / 384 / 5 |
| Tank | 18 / 7302 / 16 | 14 / 6982 / 14 | 14 / 538 / 14 |

Local detail never drops with camera distance. Remote detail drops beyond 60 m on desktop and 30 m on mobile/safe. Remote shadows stop at 20 m on desktop and are off on mobile/safe. Local shadows retain their original settings.

## Implementation and limits

Static leaves with plain opaque standard materials share a TSL material with per-surface paint, emissive colour, roughness and metalness. Colour uniforms retain each original material's Color object, preserving per-vehicle body/accent changes. Mapped and physical materials only merge when they already share the same material. Animated parents, glass and wing layers remain separate. Reflected transforms retain front-face winding.

Mira distant wheels use the GLB's Wheel Template Simple and RimSimple meshes. Classic wheels and other static bodies use generated distant geometry with quantized positions and collapsed triangles removed. No classic simple wheel or jet Landing Gear Simple exists in the current GLBs. Gear transforms remain untouched. Axles use four instances in one draw per buggy; distant axles disappear. Whole-vehicle instancing is unnecessary to reach the budget and would complicate independently animated wheels, gear and player colours.

Effects retain the capped shared dust, energy, sparks and ribbon buffers. Head/tail lamps now use one shared instanced draw for up to 128 vehicles; remote vehicles add no lights or effect draws. Local headlight behavior is unchanged in this change.

## Evidence and reproduction

- Per-kind and eight-instance JSON: `/tmp/syn3h-vehicles2/draw-{before,after}/profile.json`.
- Inspected game screenshots: `/tmp/syn3h-vehicles2/draw-{before,after}/{buggy,buggy-classic,jet,hovercraft,tank}-close.png`.
- Inspected viewer screenshots: `/tmp/syn3h-vehicles2/draw-{before,after}/skins.png` and `mira-skin-close.png`. Close-up geometry, paint and chrome match; animated wing flow phases differ.
- Live runs: `/tmp/syn3h-vehicles2/draw-live-{before,after}.json`. Desktop scene medians: 143 to 592 draws before; 104 to 186 after. Mobile: 97 to 151 before; 82 to 104 after.
- Desktop renderer CPU medians were 8.4/10.8 ms before and 1.8/2.9 ms after for zero/eight bots. Shared-host load was severe and variable, so these are observations, not an isolated speedup claim. Mobile CPU samples were noisier. No GPU timing or physical-phone FPS claim.

Run the lane Vite config on port 5185, then wrap each Chrome job in `tools/heavy.sh`: `node tests/vehicles2/draw-profile.mjs <output-directory>` and `node tests/vehicles2/draw-live.mjs <output-json>`. The baseline config accepts `MIRA_VEHICLE_BASELINE` pointing to a temporary tree containing the four original shared files exported with git show: Vehicle.ts, LoadedBuggySkin.ts, VehicleModel.ts and effects/index.ts. It does not overwrite the worktree.

The bot quality/removal transition exposed a cached audio voice reading a removed Rapier body. The first stack is GameAudio.readVehicle calling body.linvel, not the detail callbacks. Baseline passed once; current code reproduced the timing-sensitive failure. Shared detail lifecycle has a real-Rapier eight-body regression test. The audio fix from cd0fe52 is merged. Three repeated eight-bot removals now pass with zero errors and advancing ticks (160 to 179, 275 to 332, 470 to 534), recorded in `/tmp/syn3h-vehicles2/draw-transition-fixed.json`. Typecheck and 110 lane tests pass after integration.
