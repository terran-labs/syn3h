# Exact frozen collector and first calibration plan

Status: source plan only, awaiting review. No collector implementation, browser, server,
build, test or benchmark was started for this plan. Synthetic report tests do not
establish that the collector can observe or reproduce these workloads.

## Artifact prerequisite

The inspected accepted baseline is
`/Users/vtn/dev/Syn3h-stable/20261115-185356-214c3c96`.
Its existing `dist/build.json` names `v26.11.1518` and full commit
`214c3c9672b91571ea370fd80b13c85f1fcb4b6d`. That is a metadata observation,
not a computed or accepted artifact hash.

Coordinator `frozenIdentity` currently enumerates dist, server, shared and wrangler.toml,
excluding source maps and dist/.assetsignore. It is insufficient for the executable
Worker closure. Frozen server/worker.ts imports src/modes/params; server/room.ts imports
src/net/shove, terrain settings and weapon/mode parameter modules. Wrangler consumes
these files when bundling. The snapshot also has a mutable node_modules symlink.
Deployment filtering in .assetsignore affects what is served, so its exclusion needs
resolution as well. The coordinator independently confirmed these blockers.

Preferred prerequisite: coordinator freezes the actual Worker bundle, effective asset
manifest/filtering and toolchain identity, then deploys without rebundling. Record
Wrangler/workerd/Node versions and executable hashes and all effective configuration.
Whether an original accepted Worker bundle is retained for 1518 remains unverified.
Reconstructing one now is not automatically proof of the deployed Worker bytes.
The coordinator must resolve that provenance gap explicitly before acceptance.

The adapter will consume the reviewed identity function and exact frozen roots, hash
before and after collection, and refuse mutation. It will not build, promote, carry
versions, resolve a mutable current symlink, or substitute a checkout. Frozen source
may explain behavior; it must not replace the client bundle. No hash placeholder is
acceptable. Any local Worker runtime difference from Cloudflare remains disclosed.

## Proposed files and responsibilities

After approval, add only files under tools/performance-release and its documentation:

- collector.mjs: bounded serial process orchestration, browser observation and artifacts.
- browser-observer.mjs: injected observation and fixture actions using existing handles.
- collector tests: synthetic protocol, timing and teardown tests before any browser slot.
- immutable fixture JSON and its source method notes, selected after a bounded preflight.

Reuse the existing pure pacing/summary helpers. Do not run the old performance-check
entry point: it starts a development Vite server, dynamically imports
/src/world/planets.ts and records callback-time timestamps that do not match frameMs.
No edits to shared helpers, production entry points, release tooling or physics order.
Coordinator owns frozen serving identity, publication and exception authorization.

## Feasible access in the existing production client

Source review and reading the minified frozen dist/assets/index-Bb0aBZfo.js confirm
an unconditional Object.assign(window, {syn3h: ...}) before game.start. The handles
include planets, game, terrain, player getter, params, shell, bots and camera.
The bundle retains setCinematicPose and the quality.frame call. Runtime presence and
semantics still require preflight; missing handles stop collection, not a source fallback.

A pre-module Playwright init script can intercept the syn3h assignment, attach observation
and call existing interfaces without rewriting any downloaded response. Use query
planet/seed/vehicle, exposed planets.applyPlanet where needed, params.set and existing
quality methods. Never import /src or execute source-map content. Capture script URLs
and reject unexpected application modules or injected replacement game code.

Per-frame samples come from wrapping quality.frame while preserving this, arguments,
return and exceptions. Game.frame sets game.last to its start-time performance.now,
then computes frameMs from the previous last, then calls quality.frame after rendering.
Read that existing start timestamp and original frameMs together. Do not stamp the
sample with a later performance.now or synthesize timestamps by cumulative addition.
The private TypeScript field is a version-sensitive observation dependency: preflight
must confirm its availability and interval consistency in the frozen artifact.
If absent, stop and propose a separately reviewed observation method.

Do not remove systems, replace the scene, disable materialization, patch render order,
or strip effects. Only the documented fixture controls change gameplay parameters.
No tracing, screenshots or response-body hashing inside a steady interval. Record
observer overhead around the wrapper and disclose that this does not measure all
browser-protocol or instrumentation perturbation. GPU execution time stays unavailable.

## Source and resource observation

Before measured navigation, fetch index, build.json and application resource bodies
from the isolated frozen endpoint. Retain URL/status/headers and decoded body SHA-256
and compare to approved frozen files. Record the Worker/runtime identity and endpoint
mapping separately: build.json alone cannot authenticate the executable Worker.

During navigation retain actual request/response records, redirects, response failures,
cache/service-worker flags and resource URLs. Disable service workers for the fixture.
Verify actual loaded application response bodies against the same manifest, outside
steady observation; retain byte digests and reject unexplained resources, source URLs,
redirected builds and wrong WebSocket origins. Audio/media intentionally loaded by the
fixture must be included in the resource inventory, not silently discarded. A frozen
server-side file hash cannot by itself prove which bytes a browser consumed.

Archive the request inventory and observation logs with the raw run. Their hashes must
be included in the run payload through a reviewed observation-evidence schema extension;
current scalar booleans alone do not carry this proof. Hashes establish integrity,
not an independently authenticated observation. The collector implementation and
endpoint mapping are therefore reviewed dependencies.

## Conditions and scene postconditions

Use one designated visible desktop Chromium/WebGPU runner initially, fixed viewport,
DPR and actual backing size, High level 3 with auto disabled and all effective settings
recorded. Record host OS/hardware, executable/browser version, adapter/backend, power
mode and display refresh target. Reject renderer fallback, hidden pages, quality drift,
console/page/renderer errors or changing drawing-buffer size. Do not infer refresh rate
from measured game FPS. Mobile emulation cannot establish physical-phone performance.

Set quality through the existing persisted quality schema before initial application
startup, then verify effective settings at the earliest exposed handle and throughout.
If startup cannot be pinned on this frozen version, label startup separately rather
than claiming startup ran at the later steady tier. Disable Daydream explicitly for
controlled driving; record that parameter and all nondefault fixture settings. Clear
resume state and prior room state. Keep full materialization and descent behavior.

Proposed compact scenes:

| Scene | Actions and observed checks |
| --- | --- |
| Lobby | Galaxy remains visible with the normal world behind it; record idle-tour transitions and time since lobby entry. Fixed requested recipe/seed and zero bots. No stripped scene or paused renderer. |
| Drive | Buggy on a recorded dry start pose, volcanic recipe and seed 49731; recorded elapsed-time input trace for 60 seconds. Verify movement, final pose range, mode, input and safe route, rather than assuming throttle produced motion. |
| Mixed bots | Same controlled drive with exactly four recorded vehicle kinds. Verify local ownership, identities and count every sample; unexpected culling, replacement or recovery invalidates the fixture parity claim. |
| Water | Archipelago recipe, seed 49731, a frozen dry viewpoint followed by 30 seconds of staged above/below camera poses. Verify actual liquid kind, signed camera depth and transition times. Label staged camera crossing, not natural driving. |

Clock/weather controls, exact start poses, mixed kinds, input trace and pose envelopes
must be selected in preflight and frozen before calibration. Do not monkey-patch
Date.now/performance.now to manufacture repeatability. If the frozen client cannot
expose a repeatable clock control, document the actual clock dependence and obtain a
fixture decision before accepting parity. Do not select routes from candidate outcomes.

An actual two-client room is required when network/entity changes warrant it. That is a
separate allocation: observe both real clients and verify neither hidden client pauses.
One active game page is the initial four-scene plan. The manifest must not imply that a
second client was tested merely because the room server was running.

## Raw time and control semantics

Keep original page timeOrigin, monotonic timestamps, UTC anchor and navigation IDs.
Map each navigation's monotonic time into the run's origin without changing deltas;
keep the mapping in evidence and reject wall-clock jumps or ambiguous mappings.
A run encompasses its cold entry, warm entry, setup and observation; phase clocks use
that run origin even if the page time origin changes on reload.

At a phase boundary, the callback that arms the phase is the left boundary, not its
first sample. The next complete callback interval is the first sample. Stop on the
callback crossing the requested duration, including its whole interval; that callback
is the phase end. Each frameMs must match successive original game.last timestamps.
Use the documented 0.002 ms sample rounding allowance only. Never trim long frames,
interpolate missing samples or relabel incomplete data as a shorter passing run.

Before each run, use an otherwise blank visible page with all game pages closed.
Record initial callback time, every consecutive requestAnimationFrame gap, final time,
monotonic duration and corresponding UTC endpoints. Run at least three seconds and
apply both coverage checks and judgePacing. Then close the control page and begin the
run. After collecting the run, close all game pages before the after control. No other
scene, control or benchmark may overlap the full before/run/after envelope.
Both controls are mandatory; failure retains the attempt and stops acceptance.

## Startup and bytes

Cold means a fresh isolated browser profile/context with empty HTTP cache, storage and
service-worker state, verified by network cache flags and full application body transfer.
It does not mean a physically cold GPU driver or OS disk cache. Warm means the second
navigation in the same profile with the specified cache policy; retain the observed
cache hits rather than assuming warming succeeded. Do not reuse another build's cache.

Start timing at the recorded navigation start. Use actual UI entry with deterministic
immediate Play after readiness; retain the Play event time. Usable play requires shell
playing, the local room connected, input unsuspended, no materializing/kinematic hold,
a rendered frame and a successful bounded input response. Retain each predicate's time
and identity. First draw alone is insufficient. Report navigation-to-usable-play and
archive navigation-to-Play and Play-to-usable-play components to expose harness delay.
Lobby steady observation needs a documented return-to-lobby/reset sequence after these
startup observations, with lobby age recorded.

Transfer bytes mean the sum of actual encoded application resource bodies through the
usable-play milestone on the cold navigation, with request inventory, content encoding
and cache provenance. Keep response headers/decoded size and deployment manifest totals
separate. CDP Network/Performance entries must agree or mark bytes unavailable; a body
hash is of decoded content and is not a wire-size measurement. Local HTTP startup and
transfer results are not CDN, wide-area-network or phone measurements. If compression
is absent locally, state that explicitly and do not label the result gzip bytes.

## Bounded first allocation proposal

1. Coordinator resolves frozen Worker/toolchain/asset-filter identity and approves this
   plan and observation schema. Then authorize adapter source implementation and pure
   tests separately; no collection is implicit in either approval.
2. Request one serial preflight slot, capped at ten minutes, using only accepted 1518:
   resource identity, visible blank controls, hook/timestamp checks, actual backend,
   scene access and one short observed workload. Failure stops without retrying a full
   matrix. Archive the failed attempt. Do not treat it as calibration or performance.
3. Review and freeze fixture, collector and environment identities from that preflight.
   Request one serial A/A slot capped at 45 minutes: three alternating pairs for each
   of four scenes, six runs per scene, all on exactly the same accepted artifact.
   Steady observations total 24 minutes, warmups two minutes, controls 2.4 minutes and
   water transitions three minutes, plus startup/setup/teardown. The cap may be too
   short if startup is slow; incomplete collection remains nonpassing and requests a
   new allocation, not a shorter fixture or silent retry. Stop on invalid controls.
4. Preserve all attempts. Derive per-run A/A differences and variability; propose
   practical absolute/relative tolerances for coordinator review with no candidate
   measurements yet. No production tolerance numbers are chosen by this plan.
5. Only after policy approval/freeze and another allocation compare the prior accepted
   artifact with the exact frozen candidate in AB/BA/AB order under the same fixture.
   No rebuild after measurement. First baseline values have no invented earlier delta.

## Process closure and blockers

Launch only owned process groups from exact immutable roots, under one absolute heavy
wrapper. Use bounded startup and collection deadlines and try/finally for every path.
Record server/browser/child PIDs, start times, selected ports and runtime executable
identity; close pages/context/browser, terminate only owned descendants, wait for exit,
and verify recorded ports have no owned listeners. Preserve unexpected survivors and
report them immediately. No global browser kill, shared server reuse or detached waiter.
Reject an occupied port rather than killing its owner. The next lane receives explicit
closure evidence, not merely the parent process exiting.

Current blockers are concrete:

- Coordinator must resolve complete executable artifact identity and 1518 Worker provenance.
- Collector source and observation-evidence schema need review and implementation approval.
- Runtime preflight must prove the frozen hooks, scene/clock controls, first/end timing,
  cache/transfer semantics and actual usable-play predicates.
- A genuinely serial visible-browser slot with valid blank controls must be allocated.
- Real A/A calibration and numerical policy approval precede any candidate benchmark.
- GitHub chart rendering and byte-verified publication remain coordinator acceptance.

No blocker is cured by a synthetic comparator pass or by filling in a hash from memory.
