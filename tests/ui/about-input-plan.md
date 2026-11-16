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
bounded total run including shutdown. The fixture has a 480-second work deadline,
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
