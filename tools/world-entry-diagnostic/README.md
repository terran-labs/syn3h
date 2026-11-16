# Frozen 1518 world-entry diagnostic

Prepared source only. No execution, performance result or optimization is claimed.
This is a bounded incident trace, not the held release benchmark framework.

## Allocation requested

One Chrome browser, one page, three sequential entries. Execution budget 300 seconds,
then up to 15 seconds for cleanup and the absence receipt. No retry after failure.
The limiter's queue wait is outside that budget; start only on explicit allocation,
not as a queued waiter during a release hold. No local ports or servers are created.

From this worktree, after clearance:

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh python3 tools/world-entry-diagnostic/deadline.py /tmp/syn3h-entry-1518-observer-01
```

That command uses unmodified runtime methods. It records 1 ms CPU sampling profiles,
raw animation callbacks, original Game clocks/counters and performance observers.
Chrome profiling has overhead; the result is attribution evidence, not a frame-rate
benchmark. A fresh browser context starts without site storage or browser HTTP cache;
driver, OS and CDN caches are not cleared.

The cases are a different recipe from the initial lobby, a switch to another recipe,
then a return to the first recipe in the same page. They use actual galaxy click handlers.
Each case includes five seconds after landing. Normal recipe selection chooses a new
seed; record it rather than claiming these are identical seeded paired measurements.
Preserve default quality and automatic quality changes. Capture the actual backend.
If bootstrap, hooks, a case or provenance fails, stop rather than falling back to dev.

## Optional explicit phase instrumentation

For a separately approved instrumented run, append `--phases` and use a fresh output
directory. This wraps existing synchronous functions, preserves arguments, receiver,
return values and exceptions, and records their entry/exit clocks. It wraps total
regeneration, generation, lake updates, existing mesh updates, collider insertion/removal,
volcanics, trees, ground cover and each existing regeneration listener in the same order.
The page closes afterward, removing all instrumentation. This is runtime instrumentation,
not a read-only observer; do not mix its durations with observer-only measurements.

The total regenerate span includes all work. Its unassigned residual includes collider
height-array preparation and newly constructed mesh grids; do not label that residual as
GPU work. Existing terrain pass timings supply layout, shape, roads, lava, vents and forest
breakdown. Nested spans overlap, so do not sum them as independent elapsed times.
Newly registered listeners and replacement mesh objects are not individually wrapped.
CPU profile attribution supplements those gaps. No extra browser run is implicitly cleared.

## Provenance and attribution

The URL pins `v=26.11.1518`. Verify the document version header and exact decoded HTML
bytes against the archived dist directory. Verify every observed same-origin JavaScript,
CSS and WASM response body against its archived path and SHA-256. Require the known main
bundle. A mismatch invalidates the run even if the game appears normal. The archive build
metadata must name full commit 214c3c9672b91571ea370fd80b13c85f1fcb4b6d.

This pins the client, not the current production room Worker. Use a unique diagnostic room
with no other intentional clients; room latency remains an observed confound, not historical
1518 backend evidence. No source, Vite, rewritten bundle or locally reconstructed Worker is
substituted. Playwright comes from the existing root installation; no dependency installation.

Keep raw CPU profiles with original bundle URLs and line/column coordinates. Use only the
archived matching `index-Bb0aBZfo.js.map` for offline attribution, after recording both bundle
and map hashes. Do not fetch a newer map or import application source into the browser.
Source maps need no public publication. The first handoff can retain unmapped locations if
offline symbolication is not yet verified. Function-name samples estimate CPU cost; they do
not provide exact function wall durations or GPU timing. Long-frame API availability and
pipeline-counter gaps must be reported, not filled with guessed values.

## Outputs and closure

Each case writes raw frame/phase records, a CPU profile and one screenshot. The report says
`captured-not-analyzed` until reviewed. Preserve console, response hashes, failures and any
partial outputs. Report total transition time separately from the maximum raw Game interval,
CPU phase costs, connection wait and first-use pipeline events. Do not turn intentional
transition animation time into a claimed freeze duration. Screenshot completion does not
prove input responsiveness.

The supervisor accounts for observed descendant PID/start identities and direct Popen
handles. It checks each identity immediately before signalling that individual process;
it does not signal process groups or infer ownership from process names. Execution ends
at 300 seconds, with cleanup inspections and waits bounded by the earlier of fifteen
seconds after cleanup starts or 315 seconds from runner start.

An incomplete `closure.json` is written before cleanup inspection. Inspection failures
remain recorded even if later inspections succeed. Each cleanup action is independently
guarded so a failed scan does not skip the remaining best-effort actions or receipt.
Zombies remain survivors until actually absent. Missing evidence, inspection errors or
remaining owned identities prevent closure certification and release of the slot.

Closure covers only observed descendants and direct handles, not a child that escaped
between observations. The harness starts no application server and reserves no listening
port. It performs no endpoint-absence probe, so the receipt is not evidence that all
browser-created or host endpoints are absent. No service restart, shared preview change
or production telemetry is performed.

Review checkpoints: frozen-resource proof; all three cases and their actual conditions;
CPU versus GPU uncertainty; instrumentation overhead; exact owned-process absence.
