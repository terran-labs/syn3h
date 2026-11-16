# Release performance evidence v1

This is a proposed source contract. No benchmark has run, no thresholds have been
calibrated, and no performance improvement is claimed.

The exact JSON shapes and exported pure API are in
[contract.d.ts](../../tools/performance-release/contract.d.ts). The implementation entry
point will be `tools/performance-release/index.mjs`. It imports only the pure
`summarizeFrames` and `judgePacing` helpers from the existing performance checker.
It never starts a browser, build, server or process.

## Trusted boundary

The coordinator calls `compareEvidence(input, expected)` with independently known full
40-character commits, artifact SHA-256 hashes, previous accepted baseline, required
scenes and reviewed policy hash. Hashes are lowercase hexadecimal. Every timestamp is
an ISO UTC timestamp. Unknown schema versions and malformed fields are invalid.
Evidence cannot approve its own policy, select its own baseline or grant an exception.
`validateEvidence` returns all structural and qualification issues;
`compareEvidence` calls it itself and recomputes every metric and decision from frames.
A submitted status or aggregate is ignored. Exceptions remain separate coordinator
records and never change a report's decision.

`renderPerformance(report, {version, assetBaseUrl})` returns exactly one Markdown
Performance section for both notes and PRs. The version must equal the report candidate.
The release gate must render the freshly recomputed report, not a supplied report JSON.
The caller adds the required attribution at the start of the complete external body.
The asset base must be immutable HTTPS storage; the coordinator verifies uploads and
HTTP success before publication. The renderer itself performs no network requests.

## Compact matrix and sequence

Use desktop High (3), automatic quality disabled, fixed settings, identical environment
and workload fingerprints for both builds. Scenes are lobby, fixed drive, four mixed
bots and staged water crossing. Include an actual two-client scene for network or
entity changes. Additional affected configurations form separate comparison series.
A staged water crossing is labelled as such, not described as a natural drive.

For each scene use at least three complete pairs in order AB, BA, AB, alternating for
additional pairs. Pair indices start at zero; position records actual order. Require
chronological, nonoverlapping runs within a scene. Keep all attempted runs, including
failed attempts. Do not silently select the best three. A failed attempt makes this
submitted series nonpassing; a rerun is a separately retained series.

Each run records at least five seconds of warmup and 60 seconds of steady observation.
Water additionally records 30 seconds of transitions. Other scenes may record an
explicit transition phase, compared only when present on both sides in every pair.
Startup observations are separate from warm frame observation: cold cache entry and
warm entry both end at usable play, under a named collector method. First draw alone
is not usable play. Record transferred bytes from the frozen artifact manifest and
network encoding method, not development-server source size.

Blank-page controls before and after every run must each last at least three seconds
and pass the existing `judgePacing` against 1000 / refreshHz. Historical headless runs
with blank-page intervals of 67 to 133 ms are invalid baselines. Passing blank controls
still does not establish physical-phone performance or GPU execution time.

## Qualification

All runs must match expected source and artifact identities and exact scene conditions.
Fixture and collector hashes must match the trusted gate. Quality must stay fixed,
errors must be empty, overflow false, and pages visible. Validate positive finite frame
intervals and strictly increasing frame timestamps, the declared target interval,
complete phase markers and requested phase duration. Frame coverage must agree with
phase elapsed duration within one maximum observed frame interval; first and last
samples must reach the phase boundaries within that same interval. This retains long
frames instead of filtering them. Missing phases, null startup/bytes, missing pair
members, drift and truncation are explicit issues, never zeros.

The collector must establish actual source, completeness, visibility and usable play;
its assertions are evidence from a reviewed collector, not cryptographic proof of the
physical environment. Store original raw files with content hashes. The release gate
checks those files against the submitted hashes; the pure API cannot read remote files.
Instrumentation overhead is either measured or explicitly disclosed as unmeasured.
Unsupported CPU/GPU timings are omitted, never inferred from frame intervals.

## Metrics and decisions

Recompute per-run median, p95, p99, count of intervals above twice the target interval,
and maximum interval from raw frames, retaining intervals above one second. Summarize
across runs using medians, with paired differences retained. Startup and bytes compare
once per run, in the steady comparison rows; transition rows contain frame metrics only.
Percent change is null when the baseline is zero. Counts include their sample duration.
No correlated-frame significance test is used.

Policy cell keys are `scene/phase`, for example `drive/steady`. Every applicable metric
requires a reviewed tolerance entry. Relative tolerance is a fraction, not a percentage.
The tolerance is the maximum of the absolute floor, baseline median times relative
floor, and the calibrated baseline spread times noise multiplier. Baseline spread is
the range of run-level values in the archived A/A calibration, in the metric's units.
The policy hash binds these numeric thresholds and the calibration hash. Freeze it
before any candidate measurement starts; reject a later frozen timestamp.

A regression requires the median paired delta above tolerance and at least two thirds
of pairs above tolerance, rounded up. Improvement uses the symmetric negative rule.
Exactly equal paired values are unchanged. Other observations are inconclusive,
including apparent deltas within measured noise. Opposing repeatable metric changes
produce mixed status; any regressed metric blocks promotion even if the median improves.
Invalid or missing evidence is not measured and blocks promotion. Inconclusive evidence
also blocks ordinary performance acceptance. No automatic waiver is available.

## Artifacts

All generated names are content addressed:

- `report-<evidenceSha256>.json`
- `chart-<evidenceSha256>.svg`
- `raw-<rawSha256>.json` for each original run file
- `fixture-<fixtureSha256>.json`
- `calibration-<calibrationSha256>.json`

The report hash refers to canonical input evidence, not to recursively hashing its own
filename. The chart uses separate consistent zero-based axes for median and p99 across
all scenes, milliseconds and lower-is-better labels, plus descriptive alt text. Numeric
tables retain exact report values with deterministic display rounding and percent
changes. Invalid comparisons render reasons instead of empty or zero bars. SVG is an
archived documentation image, never a gameplay asset. Verify GitHub image rendering
at publication; the numeric table remains readable without images.

## First baseline allocation

1. Reserve a quiet runner explicitly. Verify accepted 1518 full commit
   `214c3c9672b91571ea370fd80b13c85f1fcb4b6d` and record its actual frozen artifact hash.
   Do not substitute the current source tree or a development Vite server.
2. Verify collector/source preflight, pacing, fixture and scene postconditions. Run
   three alternating A/A pairs per required scene with startup and raw evidence.
   Estimate the requested warm observation budget as six minutes per scene, plus
   warmup, startup, controls and water transitions. This is a budget, not a completion ETA.
3. Derive variability, propose absolute and relative floors, and obtain policy review.
   Archive calibration and freeze policy before collecting any candidate observations.
4. Once allocated, collect three alternating accepted-baseline/candidate pairs under
   the same conditions. If conditions change, rerun both builds in a new series.
5. Validate and generate artifacts, then let the coordinator exercise upload and the
   same notes/PR section. The first real baseline has no invented historical delta.

Fixture tests will cover wrong source, mismatched conditions, unreviewed or late policy,
missing/truncated pairs, hidden/invalid pacing, known regression, noisy inconclusive
results, transition tails, zero baselines and chart/table agreement. Tests remain unrun
until explicit allocation. The existing runner requires an exact-artifact collection
adapter before this plan can be executed; this report module is not that adapter.
