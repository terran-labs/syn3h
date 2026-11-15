# Hovercraft glide correction

The Syn3h asset still uses the Mars Explorer controller as its reference because no Syn3h hovercraft controller survived in the checked repositories. `hover.assist = 0` selects that controller, with corrected Unity damping order and terrain liquid lookup. `hover.assist = 1` is the default demo adaptation.

## Diagnosis

`Hovercraft/Components/Hovercraft.js` lines 14-18 explicitly set mass 50, COM y -.3 and inertia (15,15,15). Lines 22-30 use drag 1.5 above 5 m/s and 100 below it. At a .02 s step, the latter erases all velocity in one step. That abrupt stop is original behavior, not Rapier damping.

Lines 32-49 use one world-down ray, body-up spring lift and a normal velocity change capped at 10 m/s. The port's mass-scaled impulse correctly represents VelocityChange; replacing it merely because it is an impulse would be wrong. The source ray cannot anticipate a nose or spoiler crossing a crest. Body-up lift also adds horizontal acceleration when tilted.

Lines 54-60 always add throttle pitch torque, with no angle limit (the intended limit is commented out). Above the 30 m probe range, angular drag falls from 4 to .5. Persistent pitch off jumps is therefore faithful. The previous port also damped the old velocity before adding forces; PhysX applies drag after force integration. The corrected source mode uses the existing `UnityBody` helper without modifying it.

The original collider is 2 x 1 x 3 at y .4. The Syn3h GLB extends x +/-1.2593, y .0167..1.0196, z -1.6346..1.5155. The collider misses the spoiler edges and nose. Inertia 15 on every axis is a deliberate old script override, not a shape-derived inertia tensor for this hull. The old global liquid plane was also wrong for the generated lake, rivers and sea.

## Demo adaptation

* Four footprint samples support a critically damped world-up spring. It targets `hover.clearance = 2.5` m and includes gravity compensation. Damping follows the vertical speed of the terrain beneath a moving craft, so climbing does not consume the spring clearance. Lift cannot turn into sideways thrust when banked.
* Forward thrust remains the source 220 N default, projected onto the horizontal heading. Lateral damping and slight coast drag make the craft glide without unlimited acceleration.
* Pitch follows gentle terrain slopes. Pitch and roll are damped in the air, with a 12-degree target bank into turns. `hover.stability = 8` controls this assistance.
* `hover.brakeTime = 1` means 90% horizontal speed loss in one second. Brakes do not cancel falling velocity.
* The assisted cuboid encloses the Syn3h mesh. Its inertia derives from that cuboid; the lower COM helps stability. Source mode restores the original collider, COM and inertia when changed live.
* A conservative hull-envelope guard handles narrow crests missed between support points. Its .4 m safety margin covers spacing between samples. It corrects body penetration after physics and checks the interpolated rendered pose separately, since two clear poses can interpolate through a ridge. This is a restrained positional safety net, not recovered source physics. `clearanceCorrections` counts activations for diagnostics.
* All support and safety samples use the larger of terrain and `terrain.liquidHeightAt`. Lava and water share support behavior. The island currently exposes lava only; water uses the same surface contract and is covered with a synthetic raised-liquid test.

Turning assistance off disables the new spring, banking, braking, collider and clearance guard together. Original height, force, repel and thrust parameters remain available.

## Reproduction

`tests/vehicles2/hover-capture.mjs` extends the drive-capture harness with slope/lava/sea landmarks, launch velocity, assist selection and per-step/per-render hull telemetry. It leaves the shared capture tool unchanged. It writes a contact sheet, ordinary drive trace, and a hull trace. The hull trace samples a conservative box enclosing the visible mesh; negative clearance means penetration. The independent headless island test samples a different grid at both physics and interpolated poses for 1,000 steps on each seed.

The QA route holds W, holds A from 7 to 8.5 seconds, and D from 12 to 13.5 seconds. The surface route traverses a volcano slope, drops 25 m, crosses the crater lake, brakes, and crosses the sea. The dune route uses the existing effects-hovercraft-noon scenario. Compare modes on the same island seed, rather than comparing screenshots of different terrain versions.

Jet recovery uses an 80 m/s collision into the volcano, switches to hover with R held, then ditches into the sea with downward velocity and repeats hover recovery. The separate forward-flight scenario runs 75 seconds of wall time and records simulation time, so a slow browser cannot silently turn it into a shorter test. No jet physics changes are needed if these checks recover successfully.

## Verified results

On the island, the source-mode surface route records one negative hull sample on seed 1 (minimum -.017 m) and eleven on seed 42 (minimum -.560 m). The final assisted QA, dune and surface routes record **zero negative samples out of 7,153 physics/rendered samples**, with a minimum .39965 m. The QA route itself did not reproduce penetration in source mode, but the slope/drop route did. This distinction matters: the original QA screenshot is not claimed to have been reproduced at an identical pose.

The assisted QA routes needed zero clearance corrections on seed 1 and ten on seed 42. The deliberately severe slope/drop/lake/sea routes still use the safety guard (102 and 159 corrections); it is not claimed that the support spring alone prevents every collision. The sustained planar-climb regression passes without frequent guard use.

All 225 tests pass with two workers, including 11 hovercraft tests. Typecheck passes. Every final capture has zero browser errors. Screenshot roots are `/tmp/syn3h-vehicles2/`:

| Case | Before/source mode | After/assisted |
| --- | --- | --- |
| QA seed 1 | `island-hover-qa-1-mode0/contact-sheet.png` | `island-hover-qa-1-mode1/contact-sheet.png` |
| QA seed 42 | `island-hover-qa-42-mode0/contact-sheet.png` | `island-hover-qa-42-mode1/contact-sheet.png` |
| Slope/drop/lake/sea seed 1 | `island-hover-surfaces-1-mode0/contact-sheet.png` | `island-hover-surfaces-1-mode1/contact-sheet.png` |
| Slope/drop/lake/sea seed 42 | `island-hover-surfaces-42-mode0/contact-sheet.png` | `island-hover-surfaces-42-mode1/contact-sheet.png` |
| Dunes | Earlier terrain: `hover-dune-before-1/contact-sheet.png`, `hover-dune-before-42/contact-sheet.png` | Island: `island-hover-dune-1/contact-sheet.png`, `island-hover-dune-42/contact-sheet.png` |

The dune before/after worlds differ, so use the same-world QA and surface sheets for direct comparison. Raw hull counts are in `hover-clearance-summary.json` beside those directories. Headless checks use the current island collider and a different sampling grid on both seeds.

The jet's `island-jet-minute/contact-sheet.png` covers 65.4 simulation seconds in forward-flight mode, including crashes and existing boundary respawns. `island-jet-recovery/contact-sheet.png` shows the deliberate volcano collision and sea ditch. Switching to hover and holding R recovered both; the sea ditch reached -20.3 m and rose above the surface within five seconds of selecting hover. No jet physics was changed. The sea is currently lava; this verifies vehicle recovery rather than introducing damage rules.
