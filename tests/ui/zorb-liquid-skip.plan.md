# Actual-app Zorb validation proposal

Prepared source only on the focused-test candidate a6bd0f6f. No browser, server, tests, build or network request is authorized by this document. Only the new fixture and this adjacent plan are added; product code and original tests remain unchanged.

Use the existing reviewed input Gate003 supervisor, not a new process manager. The external proposal copies run-03.py from /tmp/ux-about-input-current-launcher, retaining its 590-second absolute deadline, 510-second work boundary, owned PID/start checks, explicit room server, sanitized environment, exact configuration checks, dynamic cleanup, port checks and preexisting-8787 noninterference receipt. Adapt only worktree/source pins, fixture paths and reserved loopback ports. No shared preview or broker change. This is internal automated validation, not an owner-facing preview.

## Stages and budget

One installed Chrome process, two fresh isolated contexts, real app entry through the actual Archipelago and Volcanic planet buttons, then normal vehicle dropdown selection and X activation. Request WebGPU using the existing Chrome flags, without claiming the backend merely from flags. Record the actual app quality state. Pin High level 3 and automation off, and disable Daydream to prevent idle control changes. These are explicitly reported diagnostic settings; they are not default-settings or performance evidence.

For each world:

1. All four vehicles: controlled shallow entry at 30 m/s and 3 m/s inward relative normal velocity, existing defaults for skip speed/angle/restitution. Observe twelve seconds of normal application stepping per vehicle and require at least three skips. Record every contact, speed, XYZ spin, sampled normal, liquid height/kind/depth/flow and phase vertical speed, tick/time, input, impact and hop counters. Require no manual hops and separation of skip times consistent with the existing .02-second cooldown. No new speed-loss tolerance is invented: measured speed/spin changes require review against wave, controller and flow context.
2. Buggy slow and steep entries: controlled starts at (tangent,inward) speeds (3,1) and (8,20), five seconds each. Require no skips/hops and finite motion. Save the final samples for settling/float review. The fixture does not call five seconds proof of stable flotation or impose a new settling tolerance.
3. Buggy manual hop: controlled near-surface placement followed by native Space input, five seconds. Require exactly one hop and no simultaneous skip in the observed hop step. Real audio cue/pulse methods continue running; wrappers record and forward once with original this, arguments, return and exception behavior.
4. Buggy shoreline: search the actual terrain for a gentle dry-to-liquid approach; place at rest on the dry side, then native W for six seconds. Require input delivery and observed transition from dry to the expected liquid. No injected driving velocity or synthetic terrain. The initial relocation remains a placement diagnostic, not proof the user drove from spawn to the shore.

Planned coverage totals sixteen cases, approximately 138 seconds of observation dwell plus startup, entry, switching, growth, source capture and screenshots. Wall time is unmeasured. The browser script has a 480-second total boundary, reserving its last thirty seconds for closure. The supervisor still enforces its existing outer bound. Promise races do not cancel the underlying browser/filesystem operations; supervisor cleanup remains authoritative. Slow startup, missing suitable terrain or insufficient simulated progress fails/incompletes the run without a substitute fixture, retry, relaxed assertion or claim of complete coverage.

Normal updates advance the terrain and network wave clocks. No private float call, world.step, fixedUpdate, postPhysics, game.frame or wave clock mutation is used. Read-only system observers sample after controllers and after physics. A fixed anchor's liquid height must change in at least one water case, separately from movement through spatial waves. Surface derivatives retain their existing phase-only limitation. Lava uses its actual surface selection; no artificial waves are added.

## Contacts, chatter and visuals

Each sample records actual surface neighbors at the production .25 m sampling offset. Deep repeated-contact placement requires a real liquid corridor, sufficient depth and near-horizontal surface. The fixture does not alter liquidKindAt, liquidHeightAt, normals or terrain geometry. Local sampled normal calculations are observations, not replacements for the production contact solver.

The exact source retains .01 m separation and .02 s cooldown. Contact tick/time and distance spacings, pulse/hop counters, landed/impact state and existing cue/impact/zorbPulse invocation logs expose rapid repeat contacts. No new splash or audio is created. Method invocations are not listening evidence; screenshots/video are not automatically judged pleasant. Visual and audio chatter, spinning appearance, wave contact alignment and real-device feel remain human review requirements after capture. No green release acceptance follows merely from captureComplete.

Start/end screenshots for each case and context video are saved in the allocated external evidence directory. End captures require the vehicle centre to project inside the camera frustum. This does not prove it is unobscured or aesthetically framed. Review the actual images before accepting visual behavior. Audio output is not recorded in this slice.

## Provenance and failure evidence

The launcher pins clean HEAD, fixture/config/room source bytes and dependency paths/hashes, rejects dotenv and unsafe inherited environment, proves listener ownership before requests and records explicit room/Vite PID/start identities. The room begins empty. The fixture waits for the actual app client to connect as host. Browser WebSocket origins must remain on the owned same-origin proxy; external HTTP requests are rejected.

Actual browser response bodies for the document and required modules are saved and hashed. Required TypeScript module inline source maps must contain the exact checkout text. CDP scriptParsed records must exist for each required module in both contexts, and the app must advance physics. Parsed modules alone are not proof every code branch executed. Cache/service-worker and HMR observations reject stale source. No dev/source substitution is presented as exact production-artifact validation.

Partial report and active observations persist throughout each dwell; each completed case gets its own JSON. Failed assertions retain the original failure and stop further cases. Context/browser producers close before dynamically draining pending response-body work and recomputing final source/error checks. Cleanup errors remain nonpassing. The external supervisor accounts only for observed descendants and direct handles, not universal containment.

## Proposed invocation after review and allocation

The external launcher proposal lives at /tmp/zorb-app-launcher/run.py with its adaptation diff, reviewed source copy and pinned-source receipt. It accepts the installed absolute Node path and a fresh evidence directory, matching the existing supervisor interface:

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh python3 /tmp/zorb-app-launcher/run.py /opt/homebrew/bin/node /tmp/zorb-app-browser-001
```

No installation or dependency modification is part of this proposal. Existing matching dependencies must resolve before allocation. The proposed reserved ports must be free; occupied ports cause failure without killing or adopting another server. No runtime has checked their availability yet.

Remaining acceptance after this slice: independent screenshot/video review, actual listening or clearly disclosed audio gap, all vehicle/real liquid feel and chatter assessment, and coordinator integration/release checks. This fixture is not a frame-rate or performance benchmark.

## Source review corrections

The native vehicle select is scoped to the Me card (`data-section="you"`). The fixture scrolls the real header/select into view and opens the card if needed. Returning to driving searches a grid within the actual game canvas's clipped rectangle for a point whose hit-tested element is that canvas, checks it again after moving the pointer, then clicks natively and verifies canvas pointer lock. It fails if no exposed point exists; it neither dismisses an overlay by script nor substitutes a hardcoded screen coordinate.

Each world separately requires its actual main-frame navigation response, with matching requested/response URL, navigation request and main-frame identity, status 200, HTML content type and nonempty saved bytes. The HTML must contain the application entry script and match an independently fetched response from the owned isolated server. Final closure checks require this document receipt independently of parsed/module source receipts. The comparison request is corroboration, not a replacement for the browser's actual document bytes. Redirects, missing bodies or mismatches remain failures.

Every case now carries an explicit behavioral summary, also refreshed for partial cases: tangent/world speed ranges, XYZ spin and magnitude, sampled gap/normal velocity ranges, contact-by-contact before/after speed and spin, spacing, observed/final stuck state, and a final twenty-sample settling window with its actual simulation duration. This window describes evidence; its length is not an acceptance threshold. Adjacent contact samples include controller and world evolution and are not presented as an isolated float impulse measurement.

`captureComplete` means only that the required observations and capture checks completed. `productAccepted` remains false and disposition remains `review-required`, even when three contacts or finite/no-skip checks pass. A reviewer must assess speed loss, spin, stable support, non-stuck motion, chatter and visual/audio evidence. No numeric speed-loss or settling tolerance has been added. Missing cases and original assertion failures still stop the run and retain incomplete evidence.
