# Shoreline camera clearance

Fixed against trunk `e523278`. Camera collision now uses the higher of terrain and a finite liquid surface, plus the existing clearance. A submerged arm is lifted before collision sampling so the liquid plane does not collapse the follow distance toward the vehicle. Existing chase rotation easing remains intact.

Cinematic poses retain their requested horizontal position, look target, easing and FOV behavior. Their desired height includes liquid, and a final clamp keeps the interpolated position above the surface. Unit tests cover submerged arms, dry terrain precedence, absent liquid, cinematic easing and return to chase mode.

Exact reproduction: volcanic seed 1, buggy, noon; teleport to `(-508.902333, -0.4, -761.626165)` with heading `3.730641276`, zero velocity, forward without steering, then brake once terrain under the vehicle exceeds 0.5 m and lava depth is zero.

| Check | Result |
| --- | --- |
| Original lane report | 694 of 1,008 samples below liquid |
| Final fixed capture | 0 of 1,003 samples below liquid |
| Existing 0.5 m clearance | Zero violations |
| Vehicle exits the shallows | Pass |
| Console and page errors | Zero |
| Bot and core tests | 38 pass |
| TypeScript | Pass |
| Standard browser smoke | SMOKE OK |

The first fixed run independently recorded 0 of 1,004 samples below liquid or clearance. Its largest camera-height change between physics samples after shoreline exit was 0.028 m; teleport reset is excluded from that settling measurement.

Evidence: `/tmp/syn3h-camera-liquid-final/trace.json`, inspected `shore-1000.png`, intermediate `shore-250.png` and `shore-500.png`, and `smoke.png`. Logs: `/tmp/syn3h-camera-liquid-tests.log`, `/tmp/syn3h-camera-liquid-types.log`, `/tmp/syn3h-camera-liquid-final.log`. The capture owns and closes its Vite and room servers and runs its two browsers sequentially. Port 5186 has no listener after completion.

```sh
tools/heavy.sh npx vitest run tests/bots tests/core --maxWorkers=2
tools/heavy.sh npm run typecheck
tools/heavy.sh node tools/camera-liquid-smoke.mjs /tmp/syn3h-camera-liquid-final
```
