# Force field wings lift buggies out of liquid

Both buggies now get a shared, mass-independent escape field after opening wings while
immersed. It replaces sticky drag and the water wing lift, levels the vehicle, and clears
stuck. Vertical and horizontal field speeds are capped at 6 m/s. The field rises toward
10 m above the entry liquid surface, or 3 m above the bank under it, whichever is higher.
It stays active until wings close. Wings opened away from liquid retain ordinary flight.
Closed-wing lava crawl and water floating/paddling are unchanged. Hovercraft, jet and tank
do not activate this field. Lava coating still heats and cools normally; water adds no heat.

World parameter: `liquid.wingLift`, Liquid group, default 18 m/s², range 0 to 40, step 1.
It sets the acceleration toward the field's desired climb rate. Zero disables this escape
assist and restores the prior liquid behaviour, including the water wing lift.

The field keeps its climb rate separately because both flight controllers can redirect
vertical velocity into forward motion. It also caps horizontal speed to prevent that
conversion accumulating unwanted acceleration. A hard altitude cutoff was rejected after
captures showed it could hand a stalled buggy back to flight before it cleared a wild bank.
The final version holds height until the player closes the wings over land.

## HUD contract

Read `player.canLiftOut` for the hint **Space: wings to lift out**. It is true exactly when:

- Kind is buggy, buggy-syn3h or buggy-classic.
- Wings are currently closed.
- `liquid.wingLift` is greater than zero.
- The lower chassis is immersed: a finite lava/water surface exists and body y is less
  than surface plus 0.25 m.

The getter reads persistent state from the last fixed step, with no Rapier access. It
clears on deployment, leaving the liquid or teleporting. It includes slow stuck lava and
floating water; it does not require stuck to be true in water.

## Verified captures

`/tmp/syn3h-vehicles2/wing-escape-held/contact-sheet.png` was inspected. Full per-step
telemetry and initial conditions are in `trace.json` beside it. All four runs have zero
browser errors, finish with four grounded wheels, wings closed and stuck false.

| World and vehicle | Climb to 1 m above liquid | Dry touchdown | Peak height above sea | Final heat |
| --- | --- | --- | --- | --- |
| Volcanic seed 1, Syn3h | 0.38 s | 7.12 s | 10.000 m | 0.633 |
| Volcanic seed 1, classic | 0.38 s | 5.90 s | 9.998 m | 0.703 |
| Alpine seed 7, Syn3h | 0.38 s | 9.04 s | 10.000 m | 0 |
| Alpine seed 7, classic | 0.36 s | 7.26 s | 10.000 m | 0 |

Times are simulation time after opening wings. The capture drives toward land, closes wings
once ground exceeds 5 m, and applies brakes only at touchdown. Earlier captures applied
the classic's strong brake drag while airborne, which can arrest its descent; that was a
capture-control problem, not used as successful proof.

Lava start: (-176.1666, -0.45, -885.6491), heading 3.337942194 radians, bed -6.279 m.
Both vehicles begin stuck with no wheel contact, and canLiftOut true. The shore rises
0.642 m per metre. Alpine start: (-359.3397, -0.45, -867.5229), heading 3.534291735 radians,
bed -5.668 m. Its shore rises 0.468 m per metre, exceeding the requested 0.4 threshold.

Reproduce with the committed `tests/vehicles2/wing-escape-capture.mjs` through tools/heavy.sh.
The script runs one Chrome and four sequential pages. Use KIND=buggy or KIND=buggy-classic
for a bounded follow-up. Earlier wing-escape capture directories record rejected cutoff
and landing-controller attempts; wing-escape-held is the final evidence.

## Gate and ownership

Typecheck passed. All 156 vehicle tests across 23 files passed, including real-Rapier
escape, height holding, speed bounds, cooling, HUD availability, teleport reset and the
disabled setting. Existing closed-wing and non-buggy liquid tests remain green.
Only lava.ts and Vehicle.ts changed in runtime code. Syn3hBuggy.ts and ClassicBuggy.ts
were not edited. The previous handover report also corrects an inaccurate statement:
UnityBody.flush submits forces, so resetForces really does replace controller forces.

Browser smoke printed SMOKE OK at 43 mph with zero errors; screenshot is
`/tmp/syn3h-vehicles2/wing-escape-smoke.png`. All heavy jobs used tools/heavy.sh.
