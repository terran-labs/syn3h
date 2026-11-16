# Clock, frame and blank-control semantic stage

Source plan only, based on the approved v2 graph envelope at 2296a134. No runtime,
validator, test, collector or fixture is implemented by this document. Weather retains
the sole execution slot. Promotion stays blocked until every required observation kind
has approved semantic validation; this stage alone cannot produce eligible evidence.

## Actual source semantics

Read-only inspection of accepted 1518 source establishes:

- Game.start and Game.resume assign last = performance.now. Resume resets the physics
  accumulator, so a phase spanning pause/resume does not have an uninterrupted clock.
- At entry to Game.frame, now = performance.now, frames increments, frameMs = now - last,
  and last = now. Physics uses a separately clamped frameDt, at most 0.25 seconds.
  The raw frameMs is not clamped; use it, not simulated time, FPS smoothing or physicsDt.
- Game calls quality.frame(metrics, view === 'playing') after updates/rendering and
  assigns metrics.frameMs from that original interval. It calls it even when the
  covered lobby throttles world draws. These are game-loop intervals, not proof of
  individually presented GPU frames. Cached drawCalls is not presentation evidence.
- Quality.frame can update presets/governor state. Its governor discards intervals over
  one second for its own decisions. A collector must snapshot the original metrics
  and effective quality before invoking the original method, preserving long intervals,
  then retain post-call quality separately. It must not use governor windows as raw data.

At the existing frozen syn3h exposure, an observer may read game.last and game.frames
inside a preserving wrapper around quality.frame. Their availability is a versioned
runtime preflight requirement, not guaranteed by TypeScript access modifiers. Record
callback entry/exit performance.now separately. Never substitute either for game.last.
No production /src import, source replacement, fake clock or changed loop order.

## Typed records inside approved graph artifacts

All records below occupy artifact.payload.records; artifact.payload.runId remains the
owner. Inter-artifact dependencies are declared in artifact.references and checked
against the same run. This plan introduces no alternate graph or implicit dependencies.

```ts
type PageKey = { pageId: string; navigationId: string };
type Interval = { lo: number; hi: number }; // finite milliseconds, inclusive
interface ClockRecords {
  schemaVersion: 1;
  hostClockId: string; // one host monotonic domain for the entire serial collection
  runOriginHostMs: number;
  runEndHostMs: number;
  hostEpochAnchors: Array<{
    hostBeforeMs: number; utcMs: number; hostAfterMs: number;
  }>;
  pages: Array<PageKey & {
    timeOriginMs: number;
    anchors: Array<{
      hostSendMs: number; pageBeforeMs: number; dateNowMs: number;
      pageAfterMs: number; hostReceiveMs: number;
    }>;
  }>;
}
interface FrameObservation {
  sequence: number; // original game.frames, never a filtered collector index
  gameLastMs: number;
  metricFrameMs: number;
  callbackEntryMs: number; callbackExitMs: number;
  gameTick: number; hidden: boolean; paused: boolean;
  targetBudgetMs: number;
  qualityBeforeSnapshotId: string; qualityAfterSnapshotId: string;
  conditionSnapshotId: string;
}
interface FrameRecords extends PageKey {
  schemaVersion: 1;
  callbacks: FrameObservation[]; // complete ordered capture, including boundaries
  phases: Array<{
    kind: 'warmup' | 'steady' | 'transition'; requestedDurationMs: number;
    boundarySequence: number; finalSequence: number;
  }>;
  events: Array<{ atMs: number;
    kind: 'pause' | 'resume' | 'hidden' | 'visible' | 'clock-reset' |
      'page-error' | 'console-error' | 'renderer-error'; detail: string }>;
  overflow: boolean; droppedCallbacks: number;
}
interface Control extends PageKey {
  boundarySequence: number;
  callbacks: Array<{ sequence: number; rafTimestampMs: number;
    observedNowMs: number; hidden: boolean }>;
  finalSequence: number;
  events: Array<{ atMs: number; kind: 'hidden' | 'visible' | 'page-error' }>;
}
interface PacingRecords {
  schemaVersion: 1; before: Control; after: Control;
}
```

FrameRecords identifies one navigation for the measured phases. Cold/warm startup can
involve other navigations, but a measured phase cannot span navigation. Its clock record
must exist and cover it. Multiple measured navigations require a future explicit schema
extension rather than merging timelines under one page key.

## Clock mappings and uncertainty

Use original host monotonic timestamps around a request/reply that samples page clocks.
For each anchor, pageBefore and pageAfter bracket Date.now in one page evaluation;
hostSend and hostReceive bracket that evaluation. All endpoints must be finite and
ordered. Require anchors bracketing all observations in each page navigation, and host
UTC anchors bracketing the entire run plus controls. Duplicate page/navigation keys or
mixing hostClockId domains fail. No arbitrary synchronization error allowance is added.

Clock observations need reviewed resolution and quantization evidence, not an assumption
that an integer means nearest-millisecond rounding. Record a clock-profile artifact
bound to runtime/browser version, privacy settings, clock source, units and observation
method. For each source (host monotonic, host epoch, page performance.now, animation-frame
timestamp, page Date.now and performance.timeOrigin), that profile must supply a supported
outward observation interval function Q(value) = [lower, upper], or explicitly unavailable.
The interval includes source quantization, documented coarsening/jitter and serialization
uncertainty. Preflight samples can falsify a bound; observing a small minimum increment
alone cannot prove a maximum error or eliminate privacy jitter. A bound needs a reviewed
implementation guarantee and matching configuration, with supporting preflight evidence.

For example, a *proven* truncation-to-q scheme requires an outward interval covering
[value, value + q]; a *proven* nearest-q scheme requires [value - q/2, value + q/2].
These are conditional mathematical examples, not claims about Date.now. A coarsened or
jittered implementation requires its own justified enclosure. Unknown quantization,
resolution or clock rate means the affected mapping is unavailable. Do not choose a
larger arbitrary tolerance until a dataset happens to pass.

For supported clocks with a reviewed constant-rate relation, derive page-to-host offsets
from outward endpoint intervals. For an anchor, a conservative enclosure is:

```
[Q(hostSendMs).lo - Q(pageBeforeMs).hi,
 Q(hostReceiveMs).hi - Q(pageAfterMs).lo]
```

Intersect enclosures across bracketing anchors. Reject an empty intersection, missing
bracketing anchors or observations inconsistent with the reviewed clock model. Preserve
the whole surviving interval. A constant unit-rate relation is itself a reviewed
prerequisite, not something a fitted offset proves; drift or an unsupported relation
requires a new reviewed model or unavailable mapping, never a convenient fitted skew.

For host epoch anchors the outward UTC-minus-host offset interval is:

```
[Q(utcMs).lo - Q(hostAfterMs).hi,
 Q(utcMs).hi - Q(hostBeforeMs).lo]
```

The analogous page-to-UTC interval is:

```
[Q(dateNowMs).lo - Q(pageAfterMs).hi,
 Q(dateNowMs).hi - Q(pageBeforeMs).lo]
```

Intersect the host epoch intervals only under the supported constant-offset model.
Check page epoch intervals against both the outward timeOrigin interval and the
composed page-to-host plus host-to-UTC intervals. Empty intersections, epoch drift,
wall-clock steps or mismatched profiles invalidate epoch mapping. Until preflight and
review establish supported enclosures, epoch mapping is explicitly unavailable. No
qualified UTC run boundaries, UTC freeze-order claim or complete run acceptance follows
from unqualified Date.now/timeOrigin values. Retain raw values as diagnostic evidence.

Map a supported page event interval Q(p) to the host using interval addition, then
subtract the outward run-origin host interval to obtain its run-relative interval.
Preserve operands and uncertainty. A midpoint may populate a compatibility/display
scalar only after a mapping is qualified; it never proves order. Existing raw phase
intervals and sequences within one monotonic domain can be validated independently of
epoch mapping when that monotonic clock profile supports the required precision.
Cross-page monotonic ordering may likewise use a qualified page-to-host mapping without
UTC. It must be reported as monotonic ordering only, not invented epoch evidence.

The earlier 0.002 ms allowance describes the proposed collector's independent decimal
serialization, not browser clock resolution or a Date.now guarantee. It cannot absorb
unknown clock quantization. Source precision must support the frame consistency test,
or the relevant timing result remains unavailable. Do not relax the existing frame
comparison to accommodate unsupported clock precision in this planning stage.

For order/nonoverlap, use full outward intervals: latest possible end must be no later
than earliest possible start. If uncertainty prevents proving separation, mark timing
inconclusive/unqualified, not serial by midpoint. Policy freeze uses UTC in the current
contract, so unavailable epoch mapping keeps that check blocked even when monotonic
phase durations are valid. No performance threshold or blanket timing waiver is added.

## Frame phases and first/last boundaries

The callbacks list records each original game.frames sequence once, strictly increasing
by one, with strictly increasing game.last. The phase boundarySequence identifies an
actual preceding callback whose original game.last is the left boundary. That callback
is not part of the phase's samples. Every subsequent callback through finalSequence is
included. At least one full interval is required; no endpoint cropping or interpolation.

For each included callback, compare metricFrameMs to its gameLastMs minus the preceding
callback's original gameLastMs within 0.002 ms. The preceding timestamp is obtained
from the preceding observation; the collector cannot attest to an overwritten prior
Game.last value by inventing an extra field. Require callback entry >= gameLast,
callback exit >= entry, and next callback start >= prior callback exit, subject only
to serialization rounding. Snapshot mutation after the wrapper is not allowed.

The final callback must be the first whose original gameLast minus boundary gameLast
reaches requestedDurationMs. The previous included endpoint must still be below the
requested duration. Preserve the entire crossing interval, including stalls over one
second. Its endpoint supplies phase end exactly. Adjacent phases may share the boundary
callback, but no included interval may belong to two phases. Any gap between phases
is recorded setup time, not silently counted as steady work.

Derive Frame.at from mapped original gameLast, Frame.frameMs from metricFrameMs,
hidden from original observation and targetBudgetMs from the recorded target.
Validate target later against the approved conditions semantics; until then it is a
cross-stage dependency. Reject pauses/resumes/hidden events within a phase, sequence
holes, repeated samples, overflow, dropped callbacks, errors and ambiguous navigation.
Warmup is never silently merged into steady observations.

## Blank pacing and serial envelopes

Each blank control records the initial animation-frame callback as boundarySequence.
Its rafTimestampMs is the left boundary. Derive each gap from the next callback's
rafTimestampMs, preserving every callback until finalSequence. observedNowMs must be
no earlier than the callback timestamp; it is an observation timestamp, not a gap source.
All sequences are contiguous. The final callback is the first reaching the approved
control duration, at least the existing three-second control minimum. Derive actual
duration, gaps and UTC endpoints from original callbacks and their clock mapping.

Apply existing judgePacing to those derived gaps, not supplied gaps. Compare the
submitted Run control fields with derived values; reject contradictions, short controls,
missing final callbacks, hidden/error events and inflated gap lists. No new FPS threshold
is introduced. A control cannot straddle navigation or share callbacks with the run.

Require before.latestEnd <= run.earliestStart and run.latestEnd <= after.earliestStart.
The full before-to-after envelope is exclusive across every scene on the same host;
check all A/A runs globally and all comparison runs globally, with policy freeze between
the two collections. Check the original pair/AB ordering separately. Equality at a
boundary is allowed only when interval uncertainty proves it, not after rounding away
an overlap. Page/process closure semantics must later prove game pages were absent
throughout blank controls; timestamp validity alone cannot establish a blank machine.

## Small reusable pure validators

Proposed files remain in tools/performance-release; no implementation yet:

1. `validateClockMappings(clockRecords)` returns issues plus page-to-host and host-to-UTC
   interval maps, or no map when invalid. Shared by frame, control and later startup work.
2. `deriveFramePhases(frameRecords, clockMaps, fixtureDurations)` returns original-source
   phase samples and coverage records. It never changes the evidence or drops a frame.
3. `derivePacingControls(pacingRecords, clockMaps, requestedDuration)` returns observed
   controls and existing judgePacing results with source indices.
4. `validateSerialIntervals(allDerivedRuns)` checks conservative envelopes, pair order
   and freeze ordering; it does not equate uncontested timestamps with low machine load.
5. `deriveFrameMetrics(phases)` reuses summarizeFrames for median/p99/stalls/max and the
   existing p95 rule. Compare derived values with submitted phase data before any later
   comparison. A/A noise and release tolerances continue using approved existing logic.

Functions return `{issues, derived}` with derived absent when the relevant validation
fails. An orchestrating semantic-stage result records which checks passed but always
retains qualified:false and promotion:blocked while other required semantics are absent.
No v2-to-v1 conversion may be used to obtain an eligible result. Historical v1 renderer
compatibility stays separate from operational promotion.

Startup times and transfer bytes cannot be derived by this stage. Leave them explicitly
unsupported, not zero, inferred from first draw, or copied as trusted values from Run.
Likewise do not compute a complete release decision from qualified frame metrics alone.

## Prepared-case plan, no tests run

- Valid original clocks/frames/controls derive exactly reproducible phases and metrics.
- Offset callback-completion times do not change frame intervals; substituting those
  times for original game.last is detected by interval/sequence consistency.
- A long raw interval survives despite the governor's one-second filtering policy.
- Resume resets, hidden intervals, missing/duplicate sequences, altered metricFrameMs,
  first-interval cropping, non-first duration crossing and missing final callback fail.
- Wrong navigation/timeOrigin, backwards anchors, empty offset intersections or epoch
  jumps fail. Wide but consistent anchors that cannot prove separation remain unqualified.
- Integer epoch values with no reviewed quantization profile keep UTC unavailable.
  Truncated values must not pass using nearest-rounding bounds; nearest-rounded values
  use their reviewed outward profile, not a hardcoded Date.now assumption.
- Coarsened timestamps and privacy jitter outside a claimed profile invalidate it;
  repeated timestamps cannot be repaired by inventing finer-grained samples.
- A wall-clock step or slow epoch drift can invalidate UTC while same-domain monotonic
  intervals remain valid. Neither those intervals nor midpoint ordering may bypass
  the unavailable UTC policy-freeze check.
- A measured minimum clock increment without supported maximum-error evidence does
  not qualify an epoch profile. Missing or mismatched runtime/privacy profile blocks it.
- Mutate supplied phase times or summary metrics without changing original callbacks:
  reject rather than trusting apparently improved values.
- Contradictory pacing gaps, clipped control endpoints, overlapping controls/scenes,
  cross-run borrowed callbacks and unordered AB pairs fail.
- Conservative global interval checks catch overlaps hidden by midpoint ordering.
- Correct frame and pacing semantics with missing resource/startup/condition/closure
  validation still yield blocked promotion and no complete measurement pass.

## Remaining dependencies

Resource inventories and actual response hashes, complete allowed inventory versus
required fetched subset, cache and transfer feasibility, observed startup predicates,
conditions/target/actor parity, collector/runtime/deployment identity and owned-process
closure all remain independent required semantic stages. Their current structural hashes
are insufficient. Final coordinator artifact/config path, collector source approval,
preflight allocation, real calibration and numerical policy review remain held.

This plan does not authorize tests or a collector. The next step is source-plan review
and, only if approved, a separately bounded pure-validator implementation assignment.
