# Aircraft response to Pesters

Broad moving arcs can produce escapes, but choosing a side remains unsafe: two tested catches became escapes and two previously safe encounters became catches. This measurement does not support enabling aircraft evasion. No production files, pilot tuning or weapon settings changed; rejected draft `16df9a6` is excluded.

## Source and method

Measured source: `8ec98f75888bdfdb40b5391269131766c30d0768`, based on validated pilot `fae37e8`. Type checking and the measurement test pass. That means the experiment completed and its setup checks held, not that an evasion policy passed acceptance.

There are 99 runs: three vehicle modes, eleven cases, and three actions (no maneuver, left, right). Each mode has four representative cases, four cases declared as held out before execution, and wall, water and edge fixtures. Angles, distances, boldness and forward-flight warmup times are fixed in the test. No parameters were tuned after these results.

Every run uses the real Mind and pilot, vehicle forces and Rapier, plus production `Pesters.spawn/fixedUpdate`. Speed 24, agility 1.6, radius 2.4 and lifetime 8 remain unchanged. Catch detection, target-height offset, floor clamp and expiry come from production code. Shots begin at a declared position and direction; this does not test muzzle selection or networking.

A test-only pilot wrapper retains the Mind's activity and ordinary goals. After a 0.6-second reaction delay observed at 5 Hz, it offers a moving aim point with a sinusoidal heading offset, peaking at 25 degrees during four seconds. Forward lookahead stays at least 260m and beyond the speed-dependent hover-return distance. Special mode, turn guards, altitude and requested speed remain with the ordinary controllers. Terrain/footprint and current/requested-speed continuation checks can refuse the altered goal. Catch or source expiry ends the maneuver. Eight additional seconds measure return to ordinary goals.

## Outcomes outside the safety fixtures

Each row has eight baseline cases and sixteen paired arc runs. A baseline case is compared separately with each side.

| Mode | Baseline caught / safe | Catch becomes escape | Safe becomes caught |
| --- | --- | --- | --- |
| Hovering jet | 6 / 2 | 1 of 12 opportunities | 1 of 4 opportunities |
| Forward jet | 1 / 7 | 0 of 2 | 0 of 14 |
| Hovercraft | 6 / 2 | 1 of 12 | 1 of 4 |

Both escapes occurred in held-out cases. A hovering jet's right arc changed separation from a 2.269m catch to a 2.478m escape, only 7.8cm beyond the catch radius. A hovercraft's left arc changed a 2.301m catch to a 3.589m escape. The harmful conversions were a hovering jet on the short oblique approach and a hovercraft on the representative right crossing.

Representative head-on catches were unchanged: hovering jet 1.58s, hovercraft 1.74s. Forward jets escaped the 60m head-on case without a maneuver. At 12m warning distance, catches occurred at 0.16s for forward jets and 0.26s for the other modes, before reaction. No reaction bypass was used.

## Executed response and return

These response ranges use completed four-second arcs outside the safety fixtures; delay is measured from maneuver activation, after reaction.

| Mode | Starting speed across cases | Delay to 5-degree travel-direction change | Peak direction change | Lowest speed relative to paired baseline during arc |
| --- | --- | --- | --- | --- |
| Hovering jet | 12.12 to 13.00m/s | 1.56 to 1.60s | 26.57 to 28.11 degrees | 97.90% |
| Forward jet | 27.02 to 38.37m/s | 1.52 to 2.54s | 10.63 to 13.71 degrees | 99.69% |
| Hovercraft | 8.59 to 13.36m/s | 0.84s | 25.77 to 25.79 degrees | 97.70% |

All forward-jet runs retained flight for the full eight-second shot window. No run recorded a flip. Minimum clearance across the experiment was 11.90m for hovering jets, 21.01m for forward jets and 2.50m for hovercraft. Right arcs were refused in the wall and edge fixtures; level water remained traversable. These are measured fixture results, not general terrain-safety proof.

Every run restored the exact ordinary pilot goal and retained the original Mind activity and destination. Physical return was incomplete in some runs: maximum cross-track offset after the eight-second return window was 8.01m, 29.28m and 12.81m respectively outside safety fixtures. Restoring a goal is not the same as regaining the original path immediately.

## Limits and next decision

This is an offline response envelope, not a runtime predictor or policy. There is no side-selection rule, wind, network delay, wrapping, moving obstacle, irregular planet terrain or rendered acceptance. A catch is terminal for weapon scoring; its bump impulse is not applied, so post-catch motion is controller-response evidence only. Held-out cases were declared in advance but still constitute a small deterministic sample.

The results establish limited escape feasibility and substantial response delay. They do not establish a safe default action. Any subsequent design needs review of side selection, available warning time and preservation of baseline-safe outcomes; production integration remains unauthorized by this report.

Evidence: `/tmp/syn3h-pester-response/results.json` contains all per-step sampled goals, positions, speed, mode, outcomes and case definitions. Run log: `/tmp/syn3h-pester-response.log`.

Reproduce from this checkout:

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh sh -c 'npm run typecheck && npx vitest run tests/bots/pester-response.test.ts --maxWorkers=2'
```
