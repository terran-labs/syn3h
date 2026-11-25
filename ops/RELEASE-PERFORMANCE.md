Superseded on 15 November 2026: the owner made performance evidence non-blocking. Releases may ship with an honest 'not measured' Performance section.

# Performance evidence for every production release

Owner requirement, 15 November 2026: establish successive-release benchmarks, track
regressions, and include a designated Performance section with a simple graphic in every
future production release note and release pull request description. Applies after
v26.11.1518. Historic releases do not acquire invented retrospective measurements.

## Six-level table for release notes

Run `tools/heavy.sh node tools/quality-frame-cost.mjs <frozen-checkout>` in a quiet
slot and paste its table into the release notes. It serves the frozen build locally.
Desktop Chrome measures all six presets on one page per backend at 1280 × 720, DPR 1.
Alpine seed 4 stays at 23:00 so other vehicles can cast headlight pools. Four mixed bots
are parked with their drivers paused. The tool applies each preset directly on its
local page and waits 60 frames for it to settle. It interleaves presets, then reverses
the order. Manual transition veils and their asynchronous preparation are outside
the measurement.

Each row covers 96 frames. Script time covers the game's callback through render submission.
GPU tail is the remaining wait for the WebGPU queue or a one-pixel WebGL readback,
including driver overhead. Total p50 and p95 use the sum per frame. Separate samples
measure the native GPU span from first through last pass on WebGPU or with an elapsed
query on WebGL 2 when supported. These observations carry no release threshold.

## Comparison contract

Use the previous accepted production build and the exact frozen candidate. Establish the
first baseline from accepted v26.11.1518. Record full commits, artifact hashes, fixture and
collector versions, browser version/backend, hardware/OS, viewport/backing resolution,
DPR, refresh target, quality settings, seed, camera, clock, actor count and input trace.
Keep automation from changing measured quality. A change to any comparison condition
starts a new series unless both builds are rerun with the new condition.

Candidate baseline workload proposal for the Performance owner to finalize: lobby,
fixed driving scene, mixed vehicles, and water crossing at High on the designated desktop
runner. Include an actual two-client room when network or entity changes can affect cost.
Extend to affected tiers/backends/scenes when changes warrant it. This compact release
suite does not replace broader performance/device validation. Mobile emulation is not
physical-phone evidence.

Use at least three paired warm runs, alternate build order, and retain per-run results.
Separate cold entry, shader warmup, steady play and transitions. Record median and p95/p99
frame time, stalls above twice the target frame interval, maximum stall, startup time to
usable play and shipped transfer bytes. Include CPU submission/physics and GPU timing
only when the measurement method supports them; unavailable is not zero. Measure the
instrumentation cost or clearly disclose it.

The current performance runner has blank-page pacing controls before and after each
scene. Preserve them. Previously withdrawn headless timing figures are not baselines.
Invalid pacing, hidden pages, wrong source, quality drift, renderer errors or truncated
data invalidate the affected comparison. Retain raw evidence and give the reason;
never turn an invalid run into a zero or an improvement.

## Regression decisions

Performance owner proposes and documents absolute and relative tolerance per metric
from baseline variability before evaluating the candidate. Treat timing deltas within
observed noise as inconclusive. Compare run-level measurements rather than pretending
every correlated frame is an independent experiment. Keep tail latency and transition
stalls visible even when the median improves.

A repeatable regression beyond the agreed tolerance blocks normal promotion until
fixed or explicitly accepted with its scene, size and reason recorded. A failed or
unavailable benchmark cannot be labelled a performance pass. Report the limitation and
obtain an explicit release exception if delivery must proceed without valid measurements.
No automatic performance waiver is introduced by this document.

## Public Performance section

Every new production note and release PR must include:

- Candidate and baseline versions, with the comparison status: improved, unchanged,
  regressed, mixed, inconclusive or not measured.
- A small chart of paired median and p99 frame times by scene, with units and “lower is
  better,” alongside the numeric values and percent changes. Use one consistent axis
  per metric and no inverted improvement-only display.
- Startup and transfer-size changes in a compact table; include stall counts and tested
  sample duration. Separate cold and warm startup.
- A short environment/quality line, run count and measurement limitations.
- Links to immutable raw results, the fixture, and the archived chart or summary.
- Any accepted regression or missing measurement and the concrete reason.

Recommend a generated PNG chart for GitHub rendering, with descriptive alt text and a
Markdown table that works without images. This is a documentation asset, never fetched
by ordinary gameplay. Show a small recent-release trend once comparable history exists;
the first baseline gets real values without a fabricated previous-build delta.

Use the same canonical report to generate release notes and PR content. If this release
process publishes directly without a PR, the release notes still carry the section; do
not create empty PRs just to duplicate it. All external bodies retain the required
“(AI Generated)” attribution. Never promise the game got faster unless the evidence says so.

## Delivery and enforcement

Orchestrator owns release template, publication validation, immutable evidence uploads
and integration. Performance owns the bounded benchmark harness/report and method review.
Agree exact file fences before concurrent edits. Existing solo-slot holds remain active.

Required implementation checks: new production notes missing Performance fail validation;
historical notes remain renderable; wrong-build or incompatible fixture evidence is
rejected; missing/invalid data render an explicit non-pass state; chart/table agree with
raw numbers; a known synthetic regression is detected; release and PR render the same
report; linked assets return successfully before publication becomes Latest.

The first paired baseline run and an end-to-end publication check remain pending. This
document sets the requirement; it does not establish measured performance or enforcement.
