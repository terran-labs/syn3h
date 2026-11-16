# Pure timing helpers: source handoff

Source prepared, tests not executed. The five named helpers live in
`tools/performance-release/timing-semantics.mjs`, with exact interfaces in the adjacent
`.d.ts`. Every helper returns qualified:false and promotion:blocked. No collector,
application change, operational eligibility path or new artifact kind is introduced.

## Explicit profile binding

A clocks artifact's payload.records uses ClockRecords, including:

```ts
runtimeRef: { kind: 'runtime'; sha256: string }
```

The identical reference must appear in that clocks artifact's existing references
array. It resolves to a runtime artifact owned by the same run. That runtime artifact's
payload.records contains:

```ts
{
  clockProfileId: string,
  runtimePolicySha256: string,
  clockEnvironment: { [key: string]: string }
}
```

The separately supplied expectedRuntimePolicySha256 must equal both the canonical
runtime-policy hash and the runtime record's claimed policy hash. Select the named
profile from runtimePolicy.executablesAndConfiguration.clockProfiles. Its environment
must exactly equal the runtime record's clockEnvironment; its hostClockId must match
ClockRecords. Observation authenticity and executable/environment observation remain
separate runtime semantic prerequisites. Full v2 graph validation still runs first.

Each reviewed profile has schemaVersion:1, hostClockId, environment,
monotonicRelation (`unit-offset` or `unavailable`), epochRelation (`constant-offset` or
`unavailable`) and exactly six source entries: hostMonotonic, hostEpoch, pageMonotonic,
pageEpoch, timeOrigin and raf. Each source is explicitly unavailable, or contains
mode:bounded, finite ordered errorLoMs/errorHiMs, evidenceSha256 and evidenceDescription.
A bounded observation v encloses [v + errorLoMs, v + errorHiMs]. No default Date.now
rounding exists. The policy review, not this helper, establishes that these bounds and
clock relationships are justified for the actual runtime/privacy configuration.

## What the helpers do

- validateClockMappings checks bindings and original bracket order, intersects outward
  offset enclosures, retains uncertainty and returns unavailable mappings when unsupported.
  UTC inconsistencies do not automatically discard independently supported monotonic maps.
- deriveFramePhases requires unique contiguous original game.frames, matching observed
  game.last subtraction and metricFrameMs, unique ordered phase boundaries and the first
  inclusive duration-crossing sample. Hidden/paused callback flags and in-phase event
  lists both invalidate observations. Original long intervals remain present.
- derivePacingControls derives gaps from original contiguous animation-frame timestamps,
  checks first crossing and visibility/events, and invokes the existing blank pacing judge.
  UTC results are absent without qualified page and host epoch mappings.
- validateSerialIntervals uses complete endpoint intervals, never midpoint ordering.
  Before/run/after order, global envelopes, pair order and UTC freeze order remain distinct.
- deriveFrameMetrics returns observed arithmetic summaries using existing pure helpers.
  Startup and transfer values are not inferred or supplied by this stage.

Arithmetic validity is not physical accuracy. A coarse clock can satisfy
metricFrameMs = game.last - previous game.last exactly. If its outward uncertainty
cannot establish positive physical intervals, physicalAvailable is false, even though
observed-clock-arithmetic-only summaries can be inspected. They are not a performance
acceptance result. Unavailable epoch mapping cannot pass UTC freeze ordering.

The retained 0.002 ms allowance is solely the existing serialization consistency rule;
it does not assert any real browser clock has that resolution. Full source-clock bounds
are used separately for physical intervals. No production tolerance is selected here.

## Still unsupported

Resource identity and inventory, startup predicates, cache/transfer semantics, actual
condition/quality/actor snapshots, runtime authenticity and owned process closure remain
required separate semantic stages. Successful timing helpers do not remove any of those
blockers or bypass the existing v2 unsupported guard. Historical v1 rendering cannot
be used to gain promotion. Final artifact/config path and real collection remain held.

## Prepared adversarial tests and proposed command

Tests cover profile tampering and same-run references, absent epoch bounds, drift and
wrong timeOrigin/navigation, truncation versus nearest-rounding enclosures, long frames,
coarse arithmetic without physical precision, sequence holes, contradictory frameMs,
first-crossing and boundary errors, hidden/paused flags plus event-only reset, pacing
sequences, uncertain serial overlap, unavailable UTC freeze and always-blocked results.
No tests or typecheck ran. Source must be reviewed before an execution allocation.

Proposed later pure command:

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh node --test --test-concurrency=2 tools/performance-release/index.test.mjs tools/performance-release/observation-v2.test.mjs tools/performance-release/timing-semantics.test.mjs
```
