# Buggy fix acceptance and capture-tool checks

Source: `5fd0178`, including the self-righting and teleport reset fix. Headed Chrome on Metal, 960 x 540, one browser at a time through `tools/heavy.sh`. Four bots, graphics level 1 and positional audio enabled. The player follows a scripted road target; bots use real physics. These are repeatable controller checks, not human driving claims.

| Case | Result |
| --- | --- |
| Volcanic, seed 42, summit pursuit | Pass: four bots reached the summit target in 198 to 208 simulated seconds, with zero brain recoveries and no runtime errors. |
| Lake return | Pass: the same visible bot returned to dry ground and drove at 16.9 m/s afterward. Networking returned it before its brain recovery timer. |
| Sea return | Pass: the same visible bot returned to dry ground and drove at 6.0 m/s afterward. |
| Alpine, seed 7, full road | Three of four reached the target in 230 to 235 simulated seconds. The fourth reached summit height, flipped near the last bend beside traffic, self-righted, then steered off the outer edge. No runtime errors. |
| Desert, seed 7, full road | Pass: all four reached the target in 197 to 237 simulated seconds with zero brain recoveries and no runtime errors. Some rolled and self-righted. |

The alpine road is demonstrably climbable. Bot 5's final failure is visible in the trace: at simulation 253 seconds it flips about 4.2 m from the centre of an 11 m road, with another vehicle nearby. It is upright again by 254 seconds, then oscillates and leaves the edge at 261 seconds. This supports a steering and traffic recovery problem. The trace cannot uniquely assign the initial flip to vehicle contact or the road edge. The earlier keyboard-autopilot failure alone does not prove a terrain defect.

Artifacts, each with `trace.json` and an inspected `contact-sheet.png`:

- `/tmp/syn3h-island-stack`: clean volcanic acceptance run.
- `/tmp/syn3h-road-alpine`: full alpine climb, also `road.json` with public road geometry.
- `/tmp/syn3h-road-desert`: full desert climb, also `road.json`.

The first rerun, `/tmp/syn3h-island-fixed`, is discarded as an acceptance result. Editing the Vite reload plugin during that run restarted its server at 5:43:34 PM Pacific, coinciding with bots disappearing and Rapier errors. This is a separate restart observation, not evidence against the buggy fix; the original first-error stack was not recorded. Subsequent captures kept the running game source and configuration unchanged. The harness now retains error stacks and stops at the first runtime error.

Bot labels use “Bots use tag beams” and “Tag beam interval”; parameter identifiers are unchanged. A registry scan covers every bot label and group.

The capture tool resolves sea, lava lake, summit and pad positions through the Terrain interface. The existing hover scenario's `slope` and `lava` names also resolve explicitly. Unknown names fail before browser launch; unavailable terrain features and non-finite coordinates fail before teleport; non-finite vehicle traces fail instead of becoming JSON nulls. Unit tests cover invalid names and positions, pad/summit/lake/sea resolution and absent features.

The manual reload notice is in the bottom-right corner, with safe-area padding. Its browser check passes CSS HMR, accepted JavaScript HMR, manual material reload and server restart without replacing the page. The position assertion and inspected `/tmp/syn3h-reload-bottom-corner.png` confirm the new location.

Commands for reproduction:

```sh
tools/heavy.sh node tools/island-bot-qa.mjs /tmp/syn3h-island-stack
PLANET=alpine SEED=7 ROAD_ONLY=1 tools/heavy.sh node tools/island-bot-qa.mjs /tmp/syn3h-road-alpine
PLANET=desert SEED=7 ROAD_ONLY=1 tools/heavy.sh node tools/island-bot-qa.mjs /tmp/syn3h-road-desert
tools/heavy.sh node tools/manual-reload-smoke.mjs
tools/heavy.sh npx vitest run tests/bots tests/core --maxWorkers=2
tools/heavy.sh npm run typecheck
```

Alpine isolation replay: one bot, seed 7, starting at 90 percent of the same road, reached the summit in 20.3 simulated seconds. Before arrival its maximum centreline distance was 2.54 m and minimum upright dot was 0.976, with zero recoveries and errors. `/tmp/syn3h-alpine-solo/trace.json` and its inspected contact sheet record the run. This strengthens the driver/traffic diagnosis; it does not reconstruct the exact contact that caused the earlier group-run flip.

```sh
PLANET=alpine SEED=7 ROAD_ONLY=1 BOTS=1 ROAD_START=0.90 CLIMB_SECONDS=60 tools/heavy.sh node tools/island-bot-qa.mjs /tmp/syn3h-alpine-solo
```

The repaired hover scenario passes: 17 finite frames, four resolved teleports and no console/page errors. The lake resolves to `(0, 218.67, 0)` and the sea to `(962.56, 2, 0)` on volcanic seed 42. `/tmp/syn3h-hover-landmarks/hovercraft-trace.json` and its inspected contact sheet show the actual surfaces. The misspelled landmark `seaa` exits with status 1 before Chrome starts. This replaces the previous NaN false pass.

```sh
tools/heavy.sh node tools/drive-capture.mjs --url 'http://127.0.0.1:5186/?planet=volcanic&seed=42' --vehicle hovercraft --scenario tools/scenarios/hover-surfaces.json --out /tmp/syn3h-hover-landmarks
```

Final gates: 36 bot/core tests pass, TypeScript passes, manual-reload browser checks pass, and standard smoke prints `SMOKE OK`. Logs are `/tmp/syn3h-fx-acceptance-tests.log`, `/tmp/syn3h-fx-acceptance-types.log`, `/tmp/syn3h-reload-bottom.log` and `/tmp/syn3h-hover-gate.log`. All owned test servers closed; port 5186 has no listener. Native checklist and journal MCP access remains unavailable after the host restart, so this report preserves the task outcomes and the handoff is delivered through the local CLI.
