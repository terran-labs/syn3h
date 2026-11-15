# Box arm geometry

The approved smooth tyre is generated at runtime from the lab study's profile. It keeps the
1.04 m diameter, 0.49 m width and chrome ring; the shared tyre role supplies the tread.
Four tyres share one instanced draw. The inner wheel wing uses the imported model's lighter
RimSimple mesh and retains its steering, motor glow and sparks.

The imported Box arm body and physics stay unchanged. The distant models are authored
lofts with the broad fenders, centre stripe, raised rear spoiler and the imported model's
flight-wing outline. They do not use quantized copies of the near model. Mid wheels and suspension
continue moving; the far silhouette fixes the wheels at their nominal positions.

| Detail | Distance for remote vehicles | Triangles | Draws at rest |
| --- | --- | ---: | ---: |
| Near | Up to 30 m | 10,971 | 5 |
| Mid | 30 to 120 m | 1,520 | 3 |
| Far | Beyond 120 m | 464 | 1 |

The player's vehicle stays at near detail. Switching uses the shared five-metre hysteresis.
Motor glow adds one draw nearby. Deployed flight wings share one geometry with two material
passes, so flight uses up to eight draws including motor glow. The lab offers all three
levels and initializes shading from the game's device classification and shading caps.

The focused tests load the real GLBs, check total geometry budgets, wheel placement, detail
switches and the imported model's deployed wing bounds. Separate generator checks cover tyre size
and outward tread normals. Browser checks must include normal game startup, steering and
spinning tyres, the cockpit at desktop and plain shading, and deployed wings.

These are geometry and draw-count measurements, not frame-rate guarantees. The imported
GLB still supplies other parts, so this change does not remove its download. The generated
tyre adds no bitmap or separate model request.
