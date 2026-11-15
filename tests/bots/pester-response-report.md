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


## Proposed observation follow-up contract

Status: source prepared for independent review, not executed. Original report and results above remain unchanged. This follow-up uses the same 99 cases, case order, constants, actions, safety refusals, production controllers and stepping. The previously held-out cases are now observed cases, not fresh validation data. Only the two measurement files change.

All positions, ranges, clearances and lateral separations use metres; velocities and closing speed use metres per second; times and remaining lifetime use seconds. Coordinates are world Cartesian XYZ with Y up. The fixture explicitly uses wrap size zero. Differences are direct Cartesian subtraction; there is no nearest-image or seam evidence.

At each existing 5 Hz observation, sample inside the Mind's pilot wrapper after `Pesters.fixedUpdate(dt)` and before altered pilot control, vehicle forces, Rapier stepping and post-physics. All fields are read at that synchronous program boundary. This preserves the original operator order: the orb has advanced one fixed step relative to the vehicle state at the start of that iteration. The trace time is the existing iteration time, while actual shot age is read separately and can be one step ahead. Do not interpret this as continuous-time simultaneous integration.

Own velocity comes directly from the current Rapier `linvel()`. Orb velocity comes from production `Pesters.list()`, including its floor-clamp handling. No future sample or finite difference is used. Actual age and spawn-time lifetime are read without mutation from the test's source orb because the public list omits lifetime; remaining life is max(0, life minus age). Popped or absent shots have no invented position, velocity or remaining life. Their observation is marked caught, expired or no-live-shot. Mode records the existing vehicle input's special flag at the boundary, before the next drive call; the ordinary goal is recorded separately.

The shared decision record is the first observation at or after the unchanged 0.6-second reaction interval for all three actions, even when a shot was caught before reaction. It is captured before alteration or safety refusal. The harness requires exact equality of that record across none/left/right and preserves the original before-reaction equality check. It is not proof that an altered goal was accepted or a physical response occurred.

Relative position is orb minus own position, and relative velocity is orb minus own velocity. Range is their 3D distance, catch clearance is range minus the unchanged catch radius, and positive closing speed is minus dot(relative position, relative velocity) divided by range. Terrain clearance is separately labelled. A constant-velocity closest-time estimate is minus dot(relative position, relative velocity) divided by squared relative speed; its offset uses only those current vectors. Zero relative speed and coincident positions produce explicit unavailable fields where their formulas are undefined. Negative closest times and estimates beyond remaining lifetime are labelled, not silently clamped or treated as feasible interception. This estimate ignores homing acceleration and is not a catch oracle or safe-side policy.

Signed orb lateral separation uses the own vehicle's instantaneous horizontal travel-right axis, (-vz, 0, vx) normalized. Zero horizontal speed makes that axis undefined; after shot removal, relative separation remains unavailable through route return. A separate retrospective paired-lateral-response series measures arc vehicle minus no-op vehicle on the fixed no-op travel-right axis captured at the shared decision. That series continues through the full return window. It uses baseline outcome data and must never be a policy input. Scenario names, actions, catch outcomes and this paired series remain outside observation records.

The proposed single run writes only to a new directory, default `/tmp/syn3h-pester-observations-v1`. Creation fails if that directory already exists, preserving both original evidence and previous follow-up attempts. After review clearance, one typecheck plus fixed measurement job is authorized through the absolute heavy runner, with two test workers. A failure is reported without an automatic rerun. Production aircraft evasion remains unaccepted; any later design still needs fresh held-out cases and perturbation margins.


## Observation follow-up execution result

The single authorized job on `13f2d071778aadf5fc0c3a9b8fbe81080d49ba4e` exited 1 during type checking. TypeScript reported `TS2339` at test line 187: property `ownVelocity` does not exist on type `never`. The decision variable is assigned inside the pilot callback; its inferred returned type does not retain that callback assignment. This is a harness typing failure, not a physics or outcome result.

The measurement command was conditional on successful type checking and never started. No new output directory or results file was created, so no comparison of old outcome fields or observation analysis is possible. The original 99-run evidence remains preserved. No harness correction, tuning or retry was performed. A typing correction and another run require renewed authorization.

Command: `/Users/vtn/dev/Syn3h/tools/heavy.sh sh -c 'npm run typecheck && npx vitest run tests/bots/pester-response.test.ts --maxWorkers=2'`. Log: `/tmp/syn3h-pester-observations-v1.log`. Intended output: `/tmp/syn3h-pester-observations-v1/results.json` (not created).
