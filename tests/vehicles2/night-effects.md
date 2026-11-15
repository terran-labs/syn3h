# Night headlights and tyre effects

The 23:00 island capture confirms a visible headlight pool on the road, standing and moving, and readable tyre edges. The light points along vehicle -Z. Terrain uses MeshStandardNodeMaterial and already receives spot lights. The weak beam came from 80 candela with inverse-square falloff and an aim point too low, not a reversed vehicle frame or an unlit terrain shader.

The revised local beam uses 1600 candela, or 1800 for the jet, and aims farther down the road. Its range and cone remain 50 m and 60 degrees. A small night-only paint fill and edge term keeps the vehicle silhouette readable without extra lights or submissions. World exposure and sky reflections are unchanged. Transparent cockpits are excluded.

Evidence:

- Before: `/tmp/syn3h-vehicles2/night-before/standing.png` and `moving.png`.
- After: `/tmp/syn3h-vehicles2/night-after/standing.png` and `moving.png`.
- Light positions, aim, intensity, exposure and browser errors: each directory's `evidence.json`.
- Moving after capture reached 53 mph; the smoke gate reached 41 mph. The night capture shows a visible road pool in the chase view; the smoke gate verifies normal daytime driving.
- The baseline precedes the latest UI and terrain merge, so surrounding UI and summit lighting differ. Vehicle lighting changes are the local spotlight and material fill described above.

The tyre update does not require weaker thresholds. Effects use speed and grounded contact for rolling tracks and dust, while slip controls intensity and plume size. In the first run, grounded zero-slip samples increased tracks from 88 to 92 and particles from 133 to 137. A hard turn produced 84 additional track quads and 84 particles, but rolled the buggy, so it is not a useful visual comparison. The slower follow-up uses a test-only 12 m/s speed cap and gentle steering to inspect contact effects, not to tune vehicle physics.

Run the lane Vite config and isolated room server, then `tools/heavy.sh node tests/vehicles2/night-lighting.mjs <output-directory>` and `tools/heavy.sh node tests/vehicles2/tyre-effects.mjs <output-directory>`. Both use one Chrome, close it on completion, and isolate room traffic. All 112 lane tests, typecheck and the standard smoke gate pass. Smoke evidence: `/tmp/syn3h-vehicles2/night-smoke.png`.

The gentle follow-up has zero browser errors. Straight driving recorded 21 grounded zero-slip samples, four additional track quads and nine dust particles. Turning recorded 16 grounded zero-slip samples, 26 additional quads and 116 particles. Maximum slip was .32 and .43 m/s respectively. Inspected screenshots and telemetry: `/tmp/syn3h-vehicles2/tyre-effects-gentle/{grip,turn}.png` and `samples.json`.
