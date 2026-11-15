# Hot effects under night exposure

The shared hot-effect helper uses Terrain Lab's lava curve: above daytime exposure,
brightness is divided by `0.8 * exposureRatio + 0.2`. This limits the extra exposure boost
to 25 percent, while preserving manual daytime exposure. Standalone model viewers without
the live sky keep their existing node brightness.

Applied to cooling coats, wing fields, model emissive surfaces, shared instanced lamps,
and additive trails, exhaust and impact sparks. The small paint silhouette fill remains
separate. Headlight spots retain their road illumination; the night audit shows a readable
pool ahead. No particles, lights or submissions were added.

Inspected evidence:

- Before: `/tmp/syn3h-vehicles2/exposure-before/23-hot.png`.
- Final hot coat: `/tmp/syn3h-vehicles2/exposure-final/12-hot.png` and `23-hot.png`.
- Wings, lamps, headlight pool, exhaust and beam: `/tmp/syn3h-vehicles2/hot-effects-audit/`.
- Measurements: noon exposure 0.324, night exposure 2.292. Hot and cold vehicle views
  each use 48 draws at both times. All capture pages report zero errors.

The separately owned tag beam remains bright white-green at night. Its owner should use
`hotExposureDim(game.renderer.toneMappingExposure)` on its three original colour constants,
not cumulatively on each frame's colour. The constants in Lasers.ts are (0.9, 4, 1.4),
(0.25, 1.6, 0.45), and (0.1, 0.75, 0.25). Shared muzzle and impact sparks are covered here.
Jet.ts also owns an additive nozzle material with colour (3, 3, 4); its lead can use the same
helper. The shared exhaust particles are compensated; the nozzle itself is outside this fence.

Gate: typecheck passed; 148 lane tests passed, including exposure compensation and gentle
water beach checks. Three additional lava-to-ground handover tests pass for Syn3h buggy,
classic buggy and tank. Smoke passed at 44 mph with zero errors. Heavy jobs used the shared
gate and ran at most one Chrome in this lane.
