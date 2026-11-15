# Island bot QA, November 14

The four-bot summit gate fails. Two bots climbed from 15 m to 227 m without recovery; two left the road and remained immobile after returning to their pads. Do not call this a completed summit chase.

Source: `9ecb5a2` plus the accompanying bot changes. One headed Chrome, Metal, 960 x 540, graphics level 1, seed 42, four bots, positional audio enabled. The run started at 5:31:29 PM Pacific, after the host process incident. The interrupted 5:29 run is discarded. All heavy jobs use `tools/heavy.sh`.

| Check | Result | Evidence |
| --- | --- | --- |
| Pad pursuit and contact | Pass | At least one sampled Rapier contact; tag ownership transferred to a bot. |
| Four bots follow the spiral to the summit | Fail | Two climbed to 226.7 and 227.4 m in 189.9 simulated seconds. Two left the road and repeatedly returned to pads. |
| Hill contention | Pass after explicit placement | Contested in 24 samples over 24.4 simulated seconds, with one sampled contact. This does not prove bots reached the rim unassisted. |
| Lake return | Pass for identity and dry return | Bot-4 remained visible, kept its identity, and increased recovery count from 15 to 16. |
| Sea return | Pass for identity and dry return | The same bot remained visible and increased recovery count from 16 to 17. |
| Drive again after pad return | Fail | Some bots rest near ground +0.085 m with four grounded wheels and active throttle while the chassis stays still. Vehicles owns the teleport defect. |
| Console and page errors | Pass | Empty error list for the completed run. |

Artifacts: `/tmp/syn3h-island-curvature/trace.json` and `/tmp/syn3h-island-curvature/contact-sheet.png`. The sheet was inspected. Its chase camera follows the first bot, so it clearly shows that bot failing, not the two leaders' climb. The full trace records all four bots.

The climbing player is a scripted target moving along the public road centreline at 11 m/s. Bots use their real physics and inputs. Fresh bot count updates settle before placement, avoiding delayed room echoes replacing positioned bots. The hill phase explicitly places everyone on the rim, and each liquid phase teleports one bot into liquid. These are controlled QA scenarios, not a claim that a person drove the climb. The run uses the older floating vehicle implementation; the Vehicles and Multiplayer sticky-lava changes still need an integrated rerun.

Changes connect approach roads, the foot ring, spiral and summit using public road nodes and height-aware junctions. Road steering uses a gentle curvature command and a 10 m/s budget. Bots try to crawl out of liquid for the recovery interval, then the manager teleports the same vehicle to dry ground. No effects, bodies or names are recreated during recovery. Unit tests cover connected roads, stacked rings, regeneration and preserved recovery identity.

The warmed audio regression runs four active bot voices for 25 seconds, removes and replaces four bots in one turn, then checks continued physics, body and effects counts, and console errors. The original audio failure is fixed on trunk. `tools/bot-removal-smoke.mjs` also runs the standard smoke gate after closing its first browser.

Remote positional audio is already integrated: `connection.audibleVehicles()` in `src/net/index.ts` returns remote players, replicas and owned bots; `src/main.ts` calls `audio.setVehicles(() => connection.audibleVehicles())`. No extra getter or composition-root edit is required.

Next: merge the Vehicles teleport and sticky-lava fixes, repeat this scenario with at least 240 seconds for the climb, and require all four bots to reach the rim and drive after recovery. There is no bot-manager workaround for the vehicle defect.

Final delivery gate: merged `build/weekend` at `e59e3c0` into `52f7486` before the final browser began. All 33 bot/core tests and TypeScript pass. The warmed audio run has four active remote voices, advances tick 1080 to 1132 after same-turn replacement, retains five bodies and five effects attachments, and reports no errors. Standard smoke prints `SMOKE OK`. Logs: `/tmp/syn3h-island-merged-gate.log` and `/tmp/syn3h-island-smoke-final.log`. The internal test servers closed and port 5186 has no listener. The newer trunk merge is covered by these gates, but the full island capture remains on the explicitly recorded earlier source.
