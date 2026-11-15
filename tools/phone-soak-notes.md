Phone emulation, stopped under host contention
=============================================

Two five-minute runs completed. The coordinator stopped the remaining cases when machine load reached roughly 69. These are stability observations on a heavily contested Apple M2 Max, not phone frame-rate predictions.

| Case | CPU throttle | Interactive | Quality | Frame median / p95 | JS heap first / last |
|---|---:|---:|---|---|---|
| iPhone-class, 390 x 844, DPR 3 | 4x | 5.98 s | 1 to 0 | 8.6 / 25.2 ms | 93.7 / 102.6 MiB |
| Android-class, 412 x 915, DPR 3 | 6x | 19.07 s | 1 to 0 | 21.6 / 210.0 ms | 89.7 / 83.0 MiB |

Both loaded the lobby, accepted a name, joined a room through its URL, unlocked audio, exercised wings, brake, fire and menu controls, and drove through actual touch events. Both switched to King of the Hill with the bot count set to four. The quality cap reduced the actual population to two after the automatic downgrade. This client was the first participant in each fresh room and therefore its host, not a guest sharing a room with another human.

No page or console errors occurred in the completed runs. The load flag cleared after initialization and remained clear. That flag detects interrupted loading; it would not detect an operating-system kill after the game was already running. The session resume save is separate.

Native audio node counts ended at 69 and 99, compared with 56 and 49 initially. Counts rose when nearby bot engines or one-shots started and fell again, including 291 to 43 during the iPhone run. This short observation does not establish long-term freedom from leaks. JS heap likewise fluctuated with garbage collection rather than increasing steadily.

Renderer texture allocation estimates stayed near 8.0 MiB on the iPhone viewport and 8.6 MiB on Android. WebGPU allocation instrumentation estimated about 27.4 and 30.2 MiB of live texture storage, including renderer targets. Neither value is total GPU memory: driver allocations, compositor surfaces, pipeline caches and operating-system accounting are excluded. CPU throttling and a mobile user agent do not emulate a phone GPU, memory pressure, thermal behavior, Safari or an iOS tab-kill threshold. The 4 GB device-memory hint was simulated.

Controls were inside the portrait viewport and received actual touch input. Landscape was visibly broken at 844 x 390: the minimap sits under WINGS, BRAKE and FIRE; the regular HUD overlaps the joystick; the hill panel covers the vehicle. Hit testing still reached the controls, but the visual overlap is substantial. Portrait also spends much of the upper screen on two score panels. Requested from UX: touch-aware short-height rules in `src/ui/shell.css`, reserved thumb zones, a relocated or hidden minimap, and compact hill and regular score displays. The coordinator routed that request.

No quality defaults were changed on this evidence. Both classifiers initially selected level one; the adaptive fallback did what it was designed to do under contention. Lowering defaults based on the overloaded host would confuse a scheduling problem with mobile hardware performance.

Scope and artifacts
-------------------

- Completed raw data: `/tmp/syn3h-phone-soak/iphone-auto-4x.json` and `android-auto-6x.json`.
- Summary and log: `/tmp/syn3h-phone-soak/report.json` and `/tmp/syn3h-phone-soak.log`.
- Inspected layout evidence: `/tmp/syn3h-phone-soak/iphone-auto-4x-landscape.png` and the portrait screenshots in the same directory.
- Before the timed runs, short harness checks exercised forced-safe and WebGL fallback for 20 seconds, plus a 30-second WebGL repeat, with no page errors. They are probes, not soaks: `/tmp/syn3h-phone-probe/summary.json`.
- Forced-safe and WebGL five-minute soaks and the fifteen-minute growth check were cancelled. A failed third-case entry reflects deliberate browser closure at the case boundary, not a game crash.
- The HTTP development client used fresh rooms on the shared port-8787 room server, not the random-port server started by the original harness. The harness now explicitly sets its server URL. Client rendering and memory measurements remain local, but this was not an isolated networking benchmark.
- Initial source was `ae16596`. The heavy-job wrapper merge arrived late in the Android case; manual reload kept the running game in place, but CSS hot-updated. The phone screenshots are evidence of the observed layout, not a frozen benchmark of that later merge.
- Before the soak: typecheck, 28 bot/core tests and the standard smoke gate passed. No full suite was run. All future heavy checks use `tools/heavy.sh`.
