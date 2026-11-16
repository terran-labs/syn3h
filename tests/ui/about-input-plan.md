# First four actual-app input slices: source handoff

Prepared against composition 36364211. This fixture is unrun. Only syntax checking
is authorized so far. No product source, room server or game behavior is replaced.

Files: about-input.mjs and about-input-observers.mjs. Chrome only. The former plan's
remaining matrix is NOT implemented: no synthetic gamepad, repeated visibility,
pre-network lifecycle, gear-selection cord matrix or remote/projectile survival.
Expanded in-play About itself does not exist and is not certified by these tests.

Implemented source cases:

1. Actual TAG with synthetic touch up/cancel after Thunder ready and rendered ready
   hint, then native Chrome mouse on TAG as a positive release control.
2. Actual host-bot Yoink acquisition, rendered holding state, up/cancel outcomes and
   visible secondary Fling with no second fling on the original TAG gesture end.
3. Native KeyL across pause/resume in touch-capable Chrome; desktop native canvas
   mouse across first Escape unlock and second Escape pause, then keyboard resume
   without mouseup. Record both stages separately; only fresh up/down may rearm.
4. Synthetic TAG plus native KeyL overlap. Both must be held before cancel; partial
   cancel preserves charge, final intentional release fires, final cancel does not.

Instrumentation preserves method originals, this, arguments and return values.
Existing BigRed sent/fizzled counters plus actual NetClient.fire red-kind calls are
asserted. No cue inference or direct release/cancel calls stand in for the action.
Event snapshots are queued from actual target end handlers, native keyup or after
actual Shell pause/resume/unlock handler methods. First normal fixed-step entry and
postPhysics snapshots are recorded without manually ticking systems. Observers are
restored in finally before browser close; partial traces survive failures.

Yoink holdTime is unchanged and recorded. The actual bot is positioned only before
acquisition, with drive/fire disabled through existing parameters. Three real
physics ticks and visual/body proximity are required before the hold. Acquisition
identity and game-time timestamp are observed; actual held target and at least a
half-second hold-window margin are required before release/cancel, and rechecked
at the actual Fling click event. No teleport/freeze occurs during a hold.

Future invocation, only after coordinator allocation:

    SYN3H_URL=http://127.0.0.1:<allocated-vite>/ \
    UX_SOURCE_SHA=<full-committed-fixture-candidate-head> \
    UX_EVIDENCE_DIR=<new-evidence-directory> \
    UX_LAUNCH_MANIFEST=<supervisor-generated-manifest.json> \
    node tests/ui/about-input.mjs

The external approved supervisor must use absolute trunk heavy.sh and enforce a
bounded total run including shutdown. The fixture has a 480-second total deadline (450 seconds work, 30 reserved for cleanup),
bounded fetch/navigation/wait/launch/close operations and no retry. A dedicated
room server is needed; the fixture launches none. Vite must have
SYN3H_NO_ROOM_SERVER=1 and explicit SYN3H_ROOM_PORT matching the dedicated port,
never the existing 8787 server. Launcher manifest fields: head, origin, roomPort,
roomPid, roomStart, vitePid, viteStart and env including those variables and any
VITE_SERVER_URL. Supervisor must independently verify those owned identities and
record final listener/connect/process closure; this file does not claim to prove
launcher PID identities merely by reading the manifest.

Provenance requires clean full HEAD, fetched raw source/config bytes and runtime
TS transformed-source maps equal to checkout, before and after. The actual room
WebSocket destination and room are checked against the launcher configuration.
All runtime settings and target setup are reported separately from tested gestures.

Native mouse/key events are distinct from injected touch PointerEvents. The latter
exercise actual event handlers but cannot prove physical-device capture behavior.
Synthetic pointer capture failures are handled by existing product code, not a
fixture patch. Pointer-lock denial fails the desktop case rather than substituting
fake lock state. No arbitrary reorder or full modal safety claim is permitted.

## Source correction awaiting review and execution

Each full cancellation has a unique transaction ID. BigRed cancellation, Yoink
cancellation and Input inhibition must occur in that exact invocation and order,
finish before its return, and leave suspension unchanged until the modal acts.
Pause records require a cancellation transaction; they cannot borrow later calls.
Every case records the event-turn microtask, first normal fixed-step entry and
exit. Negative fire checks and partial-holder eligibility cover all three points.
A pending paused record cannot be replaced: only its explicit resume can join it,
with unchanged paused tick and both records linked to the same resumed step.

Yoink evidence includes actual local NetClient.send kind/target, not bot sends or
release-method calls. Acquisition time clears on null/drop/fling and resets on
grab/reacquisition. Positive release and Fling must send one fling for the actual
target; cancellation must send a drop and no fling.

The deterministic recipe is Alpine, seed 1518, Medium quality (2), automatic
quality off, noon (12), day length 0. The world link establishes the recipe before
entry; normal registry settings are recorded and asserted after entry and at the
end. Bot staging stays outside the held interval. Native KeyL tests run in the
touch-capable Chrome context; native canvas mouse and Escape use a separate
non-touch desktop context. Neither is physical touch or gamepad evidence.

Browser response listeners record actual document and runtime module body hashes,
including the observer. Critical modules must be present. Actual response bytes
must match fresh isolated-server responses; TS source maps and observer text bind
them to checkout. CDP disables cache and rejects cache/service-worker responses;
HMR updates/reloads/prunes and timestamp modules fail. Clean checkout and raw
config/source checks remain separate. The browser provenance mechanism is source
prepared only, including its Vite format assumptions. A dedicated launcher still
needs independent review and allocation. No runtime, preflight or server has run.

## Final evidence closure

Response jobs are drained from live queues, not one Promise.all snapshot. The
fixture tracks relevant requests until finished or failed, requires two stable
queue checks, and repeats validation after final provenance and observer teardown.
Response, HMR and page-error listeners remain installed until browser disconnect.
The final capture boundary requires every observed page closed, no relevant
requests outstanding, and all dynamically added response jobs settled. A drain
has a ten-second bound within the absolute deadline. Timeout is incomplete
capture, never success. All response and page failures are checked again there.

Cleanup retains the original assertion or timeout as the thrown failure. Separate
cleanup errors and a partial receipt explain any later failure; receipt-write
failure emits a partial JSON receipt to stderr. Browser close and receipt writing
share the absolute deadline. The supervisor remains responsible for terminating
observed owned processes if fixture cleanup cannot complete.

## Proposed dedicated launcher ownership plan, not implemented

Reuse the reviewed secondary-DOM supervisor's deadline, strict process snapshots,
PID/start identity checks, direct child handles, sticky inspection failures and
partial closure receipts. Preserve its original and corrected evidence. Prepare
any adaptation separately for review before executing it; this plan grants no slot.

1. Run one supervisor through absolute /Users/vtn/dev/Syn3h/tools/heavy.sh. Proposed
   total budget: 590 seconds, child work stopped by 510 seconds, remainder reserved
   for closure. Every subprocess, readiness fetch, connection probe, sleep and reap
   uses the remaining absolute budget. First unexpected failure stops work; no
   retries, port substitution, installation, build or additional test suite.
2. Use a clean isolated checkout containing the reviewed fixture at its exact full
   commit. Record HEAD, clean status, wrapper/fixture hashes and dependency identity.
   Do not serve an integration tree with unrelated edits. Evidence stays outside
   the checkout. Check Node and installed executables without installing anything.
3. Propose Vite port 5331 and dedicated room port 54671, subject to coordinator
   allocation. Neither may be 8787. Before launch, require no listener and refused
   IPv4/IPv6 connections for both allocated ports; TIME_WAIT is separate evidence,
   not a listener. An occupied or indeterminate port fails without killing it.
   Inspect existing 8787 ownership read-only, without connecting or signaling.
4. Launch the explicit room child from that checkout using its installed tsx and
   server/dev.ts with PORT=54671. Launch Vite with strict port 5331. Enforce
   SYN3H_NO_ROOM_SERVER=1 for every child and SYN3H_ROOM_PORT=54671 for Vite;
   clear inherited VITE_SERVER_URL so the client uses the reviewed same-origin
   proxy. Record effective environment, executable paths, PID/start identities and
   logs in the launcher manifest. Room readiness uses its actual /status response;
   Vite readiness verifies its own listener identity and served source.
5. Monitor both direct child exit states, logs and observed descendants. The old
   wrapper forbids every server/dev.ts descendant; adapt that rule only to allow
   the explicit room child's recorded identity/descendant lineage. Any plugin-
   spawned second server, unexpected port, child failure or malformed inspection
   fails. Never infer ownership from a process name alone. Supervise the fixture's
   installed Chrome child and its descendants without starting another browser.
6. Launch only about-input.mjs with the exact manifest and a new evidence directory.
   The fixture verifies actual browser bytes and room WebSocket identity. It does
   not substitute for the supervisor's independent listener/PID/start checks.
7. On every exit, preserve the first failure and persist a partial receipt before
   cleanup. Refresh PID/start identity immediately before each signal. Clean only
   observed owned identities or verified direct handles; never guess descendants
   or signal an unrelated process. Failed scans stay unknown and cannot certify
   closure. Reap direct children, then require both allocated ports to have no
   listener and refused IPv4/IPv6 connections, and all observed identities gone.
   Record 8787 read-only again to demonstrate no interference. Include signal
   receipts, remaining identities, port evidence, original failure, cleanup errors
   and elapsed budget. Only exit zero plus complete fixture and supervisor receipts
   permits review of these four Chrome slices, not full modal acceptance.

Observed descendants remain the explicit ownership limit. No general process
manager, new worker, runtime product change or launcher implementation is included.

## HTML source and response receipts correction

Gate001 failed before Chrome at the HTML raw-export assertion; no gameplay cases ran.
Installed Vite 8.3.8 dispatches explicit import queries through module transforms,
whereas plain `index.html?raw` reaches HTML middleware. Request `index.html?raw&import`
for exact checkout-source equality. Retain HTML in the source inventory and retain
separate actual browser document bytes, served comparison, TS source-map input checks,
observer identity and cache/service-worker/HMR rejection. A Node refetch is not proof
of what Chrome received.

Before response assertions, save a unique partial response receipt with request/final
URL, status and only content-type, content-length and ETag headers. Persist before
body reading, then record body length, SHA-256 and the first 4096 bytes as diagnostic
UTF-8 text with a truncation flag; a failed read records its error instead. Each
write/read is bounded by the existing deadline. Receipt-write errors remain fatal,
while the original read or assertion error retains priority. Per-response files avoid
concurrent callbacks overwriting evidence. No cookies, authorization or full header
dumps are collected. This is fixture-only source preparation, not a retry or acceptance
of the failed gate.
