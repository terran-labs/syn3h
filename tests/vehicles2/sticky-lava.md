# Indestructible vehicles in lava and water

Lava response belongs to the shared Vehicle fixed step, after each kind's controller. This prevents old wheel, wing and engine forces from skipping across lava. Linear and angular drag grow with immersion. A heavily damped vertical target holds the vehicle partly submerged, and limited throttle plus slow steering permits crawling toward shallow ground. Nothing destroys, damages or respawns a vehicle because it entered liquid.

World parameters in the Lava group:

| Parameter | Default | Meaning |
| --- | --- | --- |
| lava.viscosity | 6 | Damping strength, increasing with depth |
| lava.sinkDepth | .45 m | Resting body-origin depth below the surface |
| lava.crawlPower | 3 m/s² | Available horizontal acceleration while immersed |
| lava.coolingTime | 20 s | Linear cooling duration after leaving lava |

The base exposes `lavaDepth`, `stuck` and `liquidState`. `stuck` means body depth at least 65% of the resting depth and horizontal speed under 1.5 m/s. It is a condition for UI/game rules, not damage. A hovering vehicle is unaffected while its lower chassis remains above the surface. The hovercraft's existing assist remains unchanged and can keep it clear of liquid.

`liquidKindAt` distinguishes water from lava. If the method is absent, liquid is treated as lava. Null means no liquid at that location. Both buggies retain their existing water float and paddle path, including the historical `buggy.lavaFloat` parameter ID for compatibility; its displayed label now says water. Other kinds receive shared buoyancy and paddling in water. Water produces no heat, depth or sticky state, and immersion quenches any remaining lava coating.

The old `applyLava` helper looks up the body's registered terrain and only applies its legacy forces in water. No Syn3hBuggy.ts change is needed to suppress legacy lava buoyancy. Its `inLiquid` flag is maintained for submerged lava after the class controller returns. The lead can update its old floating comments separately. No individual vehicle class is edited here.

Heat is an emissive coating on existing materials, with a wet-plane mask in vehicle coordinates so the hotter band follows the car as it turns. It reaches full heat while immersed and cools after exit. The mask approximates the deepest wetted plane; it is not a full thermal simulation of repeated tumbling. Paint colour references and existing maps are preserved when standard materials become node materials. There are no added meshes, lights or draw calls, and no explosion effect. Existing landing dust and small sparks remain.

## Verified results

After merging build/weekend through e59e3c0, typecheck and all 126 vehicle-lane tests pass. The standard smoke gate prints SMOKE OK at 40 mph with zero errors (`/tmp/syn3h-vehicles2/sticky-smoke.png`). Real Rapier tests cover all five kinds settling and crawling, hover vehicles remaining free above the surface, water buoyancy and quenching, twenty-second cooling, and material paint references without extra meshes.

Volcanic seed 1 at noon and 23:00:

- Fast sea entry begins at 30 m/s, slows smoothly to .375 m/s and settles at .450 m body-origin depth.
- Crawl entry begins at 1 m/s and reaches the same stable depth and crawl speed.
- A drop from the lake rim reaches .853 m transient depth, then settles at .451 m.
- Crawling out reaches dry ground in seven simulated seconds, clears stuck, and retains cooling heat. The capture applies brakes after reaching dry ground so it does not drive into another inlet.
- Zero browser errors. Same-pose cold/hot scene submissions are 90/90 by day and 89/89 at night.

Alpine seed 7 uses water throughout sea entry. The buggy floats around the surface and paddles at about 8 m/s, with heat 0, lavaDepth 0 and stuck false. The extra water exit attempt turns back into open water under the retained legacy paddle controller; it is not claimed as a verified water escape. No water behavior was retuned.

Evidence inspected:

- `/tmp/syn3h-vehicles2/sticky-lava-verified/contact-sheet.png` and `trace.json`: fast/slow sea entry, lake drop and escape at noon/night.
- `/tmp/syn3h-vehicles2/sticky-water-alpine/contact-sheet.png` and `trace.json`: Alpine sea entry and float/paddle behavior.
- `/tmp/syn3h-vehicles2/sticky-glow/{12,23}-{hot,cold}.png`: close-up coating comparison after actual immersion and a test teleport to a dry inspection pad. Hot/cold renders both use 39 submissions in this framing.

The chase camera can remain below the shore or liquid plane during the final escape frames, obscuring the car despite its dry physical position. The dedicated inspection images show the coating clearly. Camera behavior is outside this lane and has been reported rather than hidden.

The first shallow-inlet route did not immerse the car; it was rejected and replaced with a deep-sea approach. The corrected capture interrupted by the 17:30 host process incident was discarded. The evidence above was produced after restarting the isolated lane servers.

Run each browser harness through `tools/heavy.sh`: `node tests/vehicles2/sticky-capture.mjs <output> volcanic`, then the same command with `alpine`, and `node tests/vehicles2/lava-glow-capture.mjs <output>`. The harness samples simulation ticks and does not alter vehicle physics. It uses test teleports to begin each bounded journey, supplied entry velocity, keyboard-equivalent throttle and the explicit dry-ground brake described above.

