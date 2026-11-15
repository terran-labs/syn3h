# Startup review: the 32 second black screen

Bots, Performance and QA lane, branch `feat/fx-startup`, Saturday 14 November 2026.

## Finding

**The preview link makes the iPad download about 28 MB of uncompressed JavaScript in 151
requests before a single line of the game runs.** Half of that is source maps the Vite dev
server inlines as base64 into every module. Production (www.syn3h.com) sends about 2 MB
(brotli) in 11 to 13 requests and reaches its first draw in 1.4 to 2.9 seconds cold here.

Shaping the local dev server to 100 ms round trip and 10 Mbit/s reproduces most of the wait:
first draw at 22.4 seconds, 98 percent of it in "fetch and run modules", with every later
phase (physics, renderer, terrain, shaders, lobby) together under 0.6 seconds. 28 MB at 10
Mbit/s is 22.3 seconds by arithmetic; 32.6 seconds corresponds to about 7 Mbit/s of
effective throughput between the iPad and the preview host, which is plausible for a
tailnet hop, especially through a relay.

Confidence: **high that the dev server's payload is the largest cost on any slow link, and
that production does not share it; medium that it explains the owner's 32 seconds**, because
the iPad's actual throughput to the preview host is unmeasured. The second candidate is
first-time shader compilation in Safari: on this Mac, WebKit's first render after a shader
change took 2.4 seconds (WebGPU) and 2.8 seconds (WebGL); a run with cached shaders took 0.2.
An iPad might be a few times slower than an M2 Max at that, which is seconds, not half a
minute. CPU work (terrain, physics, lobby) at 6x CPU throttling costs about 3 seconds in total.
Round trip count is not the cause: the preview host speaks HTTP/2, so the 151 requests
overlap; at 100 ms a warm reload, which revalidates every source module, takes 5.9 seconds.

## What settles it on the iPad

One reading. After this branch reaches the preview server, open the preview link with
`?diag=1` on the iPad. The overlay now has a `startup` block, one line per phase with its
start and duration. If `fetch and run modules up to Game.ts` holds most of the 32 seconds,
it is the download. If `frame 1 render call` does, it is Safari compiling shaders.

Without this branch, two loads in a row answer it too: the dev server marks its large
dependency files immutable, so a second load skips 25 of the 28 MB. If the second load's
`firstDrawSubmittedMs` falls from 32 seconds to a few, it was the download. Loading
https://www.syn3h.com/?diag=1 on the same iPad gives the production number directly.

## The cheapest fix for the demo

**Demo from a production build, not the dev server.** No code change: either
https://www.syn3h.com/ (release 1) or a frozen trunk build served with
`tools/serve-stable.mjs` through the preview broker. That is the Orchestrator's call.
Note that `tools/serve-stable.mjs` does not compress; the build is 5.8 MB of JavaScript
uncompressed (2.1 MB gzip), still a fifth of the dev payload. Adding gzip there would make
it match Cloudflare.

If the dev server must stay the demo link, a compression middleware in `vite.config.ts`
(Orchestrator's file) would cut the six largest dependency files from 23 MB to about 6.8 MB
by gzip -6 measurement; that is an estimate from file sizes, not a measured load. I tried
`optimizeDeps.rolldownOptions.output.sourcemap: false` to drop the inline maps and it did
not take effect in a quick test; I did not pursue it.

## Measurements

All on this M2 Max under shared load; load average is the one minute figure. Chrome is the
system Chrome, headless, WebGPU. Each configuration: cold runs in fresh contexts, then one
warm reload. Viewport is 1194 x 834 at device scale 2 (iPad Pro landscape). Times are
milliseconds from navigation start to the first frame with draw calls
(`firstDrawSubmittedMs`, the overlay's figure).

| Configuration | Load | Cold first draw | Warm | Requests | Transferred cold |
|---|---:|---:|---:|---:|---:|
| Dev, Chrome, no throttling | 11.6 to 15.9 | 517, 535 | 475 | 151 | 27.9 MB |
| Dev, Chrome, CPU 4x | 16.2 to 16.7 | 2502, 2661 | 1842 | 151 | 27.9 MB |
| Dev, Chrome, CPU 6x | 15.3 | 3165, 4022 | 2529 | 151 | 27.9 MB |
| Dev, Chrome, 100 ms, 10 Mbit/s | 11.9 | 22354 | 5922 | 151 | 27.9 MB |
| Prod build, Chrome, CPU 4x | 14.1 to 14.9 | 1956, 2002 | 1456 | 13 | 3.5 MB |
| Prod build, Chrome, CPU 6x | 13.6 to 13.9 | 2639, 3203 | 1848 | 13 | 3.5 MB |
| Prod build, Chrome, 100 ms, 10 Mbit/s | 11.8 | 2515 | 489 | 13 | 3.5 MB |
| Dev, WebKit 2388 | 11.7 | 2963 (shaders uncached), 756 | 610 | 151 | 27.8 MB |
| Prod build, WebKit | 12.1 | 811, 748 | 527 | 13 | 3.5 MB |
| Dev, WebKit, `?webgl=1` | 12.8 | 3387 (shaders uncached) | | 151 | 27.8 MB |
| www.syn3h.com, Chrome | 10.6 to 11.2 | 1567, 1395 | 2389 | 11 | 2.7 MB |
| www.syn3h.com, Chrome, 100 ms, 10 Mbit/s | 10.2 | 2541 | 852 | 7 | 2.4 MB |
| www.syn3h.com, WebKit | 10.4 | 2857 | 634 | 13 | 3.0 MB |

The local production build is served by `tools/startup-serve.mjs` with gzip; its 3.5 MB
includes audio and images that www.syn3h.com fetches later or caches differently. The www
warm Chrome figure (2389) is one run under load and slower than its cold runs; treat it as
noise.

Largest dev responses: Rapier 10.2 MB (4.4 MB of it an inline source map), three core 4.1
MB, three WebGPU 3.7 MB, three TSL 2.9 MB, three module 1.1 MB, Tweakpane 0.8 MB.

### Phase tables

Phase names are what `window.syn3hStartup` records. "Build until add N" is the time from the
previous mark to main's Nth `game.add`, so add 1 contains terrain generation (the terrain
adds its first system before main attaches it to quality), add 9 is the Shell and lobby,
and add 12 is the rest of the lobby wiring. Production names of classes are minified.

Dev, Chrome, CPU 6x, cold, median of 2 (load 15.3), first draw 3165:

| Phase | Starts | Takes | Share |
|---|---:|---:|---:|
| fetch and run modules up to Game.ts | 0 | 468 | 15% |
| run remaining modules to main() | 468 | 24 | 1% |
| quality initialise (WebGPU adapter probe) | 497 | 73 | 2% |
| physics init (Rapier WASM) | 570 | 93 | 3% |
| renderer.init (adapter, device, context) | 680 | 7 | 0% |
| build until add 1 (terrain generation) | 687 | 854 | 27% |
| build until add 2: Volcanics | 1542 | 51 | 2% |
| build until add 5: Syn3hBuggy | 1630 | 60 | 2% |
| build until add 9: Shell (lobby) | 1712 | 156 | 5% |
| build until add 12 (lobby wiring) | 1880 | 112 | 4% |
| frame 1 systems update | 2301 | 200 | 6% |
| frame 1 render call (shader and pipeline compile) | 2501 | 665 | 21% |
| frame 1 render end to GPU work done | 3165 | 158 | 5% |

Dev, Chrome, 100 ms round trip, 10 Mbit/s, cold (load 11.9), first draw 22354:

| Phase | Starts | Takes | Share |
|---|---:|---:|---:|
| fetch and run modules up to Game.ts | 0 | 21833 | 98% |
| quality initialise, physics, renderer.init | 21837 | 37 | 0% |
| build until add 1 (terrain generation) | 21874 | 155 | 1% |
| rest of world and lobby build | 22029 | 135 | 1% |
| frame 1 systems update | 22176 | 39 | 0% |
| frame 1 render call | 22215 | 139 | 1% |

Prod build, Chrome, CPU 6x, cold, median of 2 (load 13.6), first draw 2639: modules 352,
physics 143, terrain 742 (28%), lobby 138, frame 1 render 454 (17%).

Dev, WebKit, first cold run (load 11.7), first draw 2963: modules 218, terrain 164, frame 1
render call 2367 (80%). Second cold run 756 with render 211: WebKit kept the compiled
shaders. 29 render pipelines, 25 vertex and 28 fragment shaders after three frames (Chrome
compiles 21 by then).

## What the player sees during the wait

The loading veil from `index.html` covers the first paint: a near black screen
(#020308) with a 5.5 rem ring in the centre and a blue arc creeping round it
(`/tmp/startup-shots/dev-slow/dev-chrome-rtt100-10mbps-cold0-8000ms.png`). Nothing is
written on it. While the 28 MB downloads, no game code runs, so the arc moves only by the
bootstrap script's slow creep toward 92 percent; LoadingScreen raises it to 45 percent only
once the bundle has arrived and run. On an iPad at arm's length a small dim ring on black
reads as a black screen. The lobby appears when the Shell is built, a few hundred
milliseconds before the first game frame
(`/tmp/startup-shots/dev-slow/dev-chrome-rtt100-10mbps-cold0-first-frame.png`). It is not
genuinely black and it is up from the first paint; it just says nothing and barely moves.

For the UX lane, if they want it: a line of text on the veil after five seconds ("Loading
28 MB over a slow link" or simply "Still loading") would turn "is it broken" into "it is
slow". That is in `index.html` and `src/ui/LoadingScreen.ts`, not this lane's files.

## The "iPad canvas size mismatch"

`tools/safari-diagnostics-review.md` does not describe a mismatch as a fault. It records a
1024 x 1366 backing at renderer pixel ratio 1 against a device pixel ratio of 2. That is
deliberate: the mobile graphics budget in `src/core/quality.ts` caps the pixel ratio at 1,
so the iPad renders a quarter of its native pixels and the browser scales up. It is real,
it is intended, and it is part of why the owner sees 61 fps. Not a bug.

## Instrumentation added

- `src/core/diagnostics.ts`: `recordStartupPhase`, `timeStartup`, `readNavigationTiming`
  and `formatStartup`. Every phase is a `performance.measure` named `syn3h:<phase>` and a row
  in `window.syn3hStartup`. Always on; a few object writes per phase. The `?diag=1` overlay
  shows a `startup` block.
- `src/core/Game.ts`: brackets module loading, quality, physics, renderer init, each world
  build step (through `game.add` and `quality.attachTerrain`, so `main.ts` is unchanged),
  the wait for the first animation frame, and the first three frames' update and render
  calls apart. Counts pipelines after each of those frames and records when the GPU and the
  next animation frame confirm frame 1.
- `tools/startup-profile.mjs`: cold and warm loads in Chrome (CDP CPU and network
  throttling) or WebKit, prints the phase table, request count, bytes and largest
  responses, and can take screenshots at 0.5 to 32 seconds.
- `tools/startup-serve.mjs`: a gzip static server for a local production build.
- `tests/core/startup-timing.test.ts`.

Finer phases inside `main.ts` would need marks there. Not needed for the conclusion; if the
Orchestrator wants them, wrap `createTerrain`, `createEnvironment`, `createVehicle` and
`initGameShell` in `timeStartup` from `./core/diagnostics`.

## Still unproven on real hardware

- The iPad's throughput to the preview host. Everything above is a shaped link on a Mac.
- Safari's shader compile time on the iPad's GPU. WebKit on macOS uses the same Metal
  compiler family, but not the same chip or driver.
- Whether iPadOS Safari keeps compiled shaders between visits the way macOS WebKit did here.
