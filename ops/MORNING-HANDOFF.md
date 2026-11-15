# Morning handoff draft

Prepared during the 15 November overnight run. This is a working draft, not the 8am
report. Recheck production, integration and lane evidence before delivering it.
Evidence snapshot: 3:38am Pacific. Release 5 is accepted publicly; aircraft evasion
and the conditional performance, diagnostics and transparent-water work remain unfinished.

## Public build

Release 4 was accepted at https://www.syn3h.com/ as `da5a89c`, version `v26.11.1500`,
Worker `ef3e2f23-e868-41d6-9894-4b09e9b57db2`. Independent log review confirms
exact entry assets, worker and primary-domain multiplayer, and all eight public
Chrome/WebKit vehicle checks with no page errors. The acceptance marker matches.
Its notes and curated three-image showcase are published on GitHub. All four attachment
URLs and the README GIF link verify. Release 5 is now accepted live as
`5e38ef6`, version `v26.11.1501`, Worker `e9f20f19-4194-40c2-8e6b-a8becb6190a0`.
Worker and primary-site multiplayer, exact assets and all eight Chrome/WebKit vehicle
checks pass with no page errors. The acceptance marker matches the Worker identity.
Future deployment supervisors must now select release 5 as their rollback target.
Release 5 showcase capture continues after acceptance and cannot invalidate it.

The first attempt failed its primary-site bot-roster check and restored verified
release 2. Unique-room diagnostics passed on the unchanged frozen build before this
successful retry. That success does not prove the cause of the previous failure.
Earlier release 3 score-display and resource-loading failures remain unexplained.

The next release must verify exact frozen HTML and entry assets, normal gameplay on
the primary public domain, and the combined browser cases. Exact asset and primary-domain
gameplay checks now run before the release script records success.
Occupied lobbies no longer block deployment. Failed public checks still require rollback.

## What has reached integration

The integrator reports trunk and main pushed at `da5a89c`, tagged `m16-default-on`.
The exact combined suite log confirms typecheck and all 1,143 tests across 146 files pass.
These release 4 checks are historical evidence for that exact build.

- Terrain detail, river fords, aerial perspective and ground cover run on normal entry.
- Custom maps refresh from slider snapshots; player lights show aggregate presence.
- Generated-only wind, score layers, all four gear tools, water effects and same-player
  reconnect default on. Stored explicit off choices and quality tiers remain intact.
- Jet Mk2, buggy tyres and distance models, procedural hovercraft materials and
  transparent plain-tier canopies are integrated.
- The right rail, Exit world, internally scrolling panels, contextual tooltips and
  bottom-left minimap vignette are integrated. Music-selector keyboard leakage and
  Escape state inconsistencies found in review are corrected.
- Stable lighting and screen-space GI are integrated. GI does not account for offscreen
  geometry and is not a claim of full global illumination.
- Water correction preserves wing skim speed and the approved Zorb ride height, while
  restoring submerged motor damping through truthful contact state.
- Jet safety correction uses the actual principal inertia frame and bounds descent
  tilt. Independent source review, 26 pilot tests and 27 five-minute jet drives pass,
  with original gains and safety bounds unchanged.

The combined race/rejoin gate passes on the newer interface after fixing a removed
leader-body read. It covers a staged eligible encounter, countdown, an actual bot finish,
guest display, host dropout, rejoin and host transfer with no page errors. Natural race
frequency remains unmeasured: earlier idle runs never met the nearby-bot prerequisite.

Earlier combined checks cover four interface viewports, both rendering backends and
all eight vehicle/browser combinations. The frozen copy passed direct and simulated-latency dry runs, three consecutive
multiplayer checks, eight fresh-room vehicle checks and the solo seam check. Its
two-player seam gate now passes all 17 checks on a verified dry route. The earlier wet
fixture put both cars almost sixty metres underwater, preventing contact. The newly
introduced route-selection cap was revised from 0.3 to 0.5 per sampled axis after
review; original gameplay assertions stayed intact. This proves steady-state dry
crossing and contact, not rough-terrain or sea coverage. Earlier intermittent startup
staleness remains unexplained.
Its identity is `20261115-021120-da5a89c`, version `v26.11.1500`.
The deploy wrapper must preserve those artifacts without rebuilding between acceptance
and deployment. Public acceptance is not established by source tests or a dry run.

The kernel-lock limiter uses three shared slots, one job per lane and at most two test
workers. The sentinel has resumed from the passing candidate baseline, per the integrator.

## Release 5 visual batch

The eight reviewed dependency picks are integrated at `5e38ef6`, tagged
`m17-clouds-moons`, and frozen as `20261115-032406-5e38ef6`. Typecheck, all 1,156 tests
in 150 files and the production build pass. Combined saved-world, rendering and
four-viewport layout checks pass. The initially partial logo was captured too early;
the settled capture shows the complete wordmark. An earlier browser-wrapper cleanup
permission error is retained in the record; its temporary services were confirmed gone.

The frozen release gate exited successfully after three multiplayer runs, simulated
latency, eight vehicle/browser checks, both renderers, solo and two-player seams, and
matching all 338 manifest files. Seven interruption tests pass on the final deployment
supervisor. Public acceptance subsequently passed on the same frozen build at 3:38am Pacific.

- Procedural cloud volumes `35c0167`: lane reports typecheck, 16 tests, both-backend
  cloud cases, wrap/weather/reflection invariants, normal entry and HTTPS smoke passing.
  Lower tiers retain fallback clouds. Physical iPad cost remains unmeasured.
- Saved-world moons `873e408`: lane reports typecheck, 122 UI tests, Chrome/WebKit
  direct-entry and storage/permission cases, final smoke and independent UX seam review.
  Saves are local bookmarks, not new rooms. Room authority can override restored settings;
  the interface reports that outcome. Cross-tab storage is best effort, not transactional.

- Temporal antialiasing `8edddad`: final both-backend motion, camera reset, reflection,
  normal-entry and driving evidence passes bounded independent review. Actual vehicle
  body and instanced-wheel motion are covered. Water, grass and particles reject history
  to avoid ghosting; physical-device performance remains unmeasured.
- Touch minimap clearance `b30fe51`: source review and tablet screenshot confirm the
  map clears the joystick. Four layout checks pass per UX; desktop rules are unchanged.
  No dedicated jet or physical-device run is claimed.

## Work still underway
- Hovercraft and jet Pester evasion remain unfinished. The bounded overlay experiment
  converted none of eight caught cases into escapes; its draft is excluded from integration
  and needs a different reviewed design. The completed response-envelope report covers
  99 runs and found two escapes but also two harmful conversions. Independent Weapons
  review accepts the research only; no aircraft avoidance implementation is accepted.
  One escape cleared the catch radius by only 7.8 centimetres. The integrator has
  stopped further runtime changes and constant sweeps. Reopening requires an observable
  side-or-no-op rule and warning-time feasibility bound, fresh unseen scenarios with
  perturbation margins, no new catches in previously safe cases, and route recovery.
  The current report establishes none of those selection guarantees. This technical
  blocker does not complete the assignment or clear the owner's follow-on condition.
  Wheeled bots already evade Pesters; all four gear
  tools have combined browser evidence.
- **Water transparency from above is unimplemented:** the sea/river material is opaque.
  Shallow colouring does not reveal submerged objects or ground. Transparent falling
  sheets do not satisfy this requirement. Two-client wave visuals and real-mobile cost
  remain unverified.
- Release 5 notes are generated and full showcase capture follows acceptance. The obsolete lobby
  readiness check is fixed, and a single capture from the exact frozen build passes
  with the complete logo and planets visible. Artifact failures remain nonfatal after
  gameplay acceptance; publication still requires content and image review.

The later performance, diagnostics and cursor-UX queue remains pending until current
assignments finish. It includes the FPS history panel, hardware and rendering failure
information, one low-FPS recommendation control and adjustable tiers. Reuse the current
owner-authorized minimap and rail work rather than implementing them twice. Connection
diagnostics in that rail are not the requested FPS, hardware and failure diagnostics.
An existing F3 panel already exposes FPS, frame timing, physics cost and draw counts;
reuse it and the current quality governor. The history chart and recommendation control
remain missing. Both wave and still-water fallback materials need transparency work.

## Fifteen-minute owner viewing list

Use the final accepted build selected at 8am, not an unverified preview address.

1. Three minutes: enter normally on the Mac, capture the cursor, drive and press Escape.
   Check that controls and the minimap leave the road visible.
2. Four minutes: join the same room from a real phone over mobile data using the QR code.
   Confirm movement, gear interaction and return after briefly backgrounding the phone.
3. Three minutes: inspect shallow water from above and below, then change rendering tier.
   Check visibility, responsiveness and whether the tier controls are understandable.
4. Two minutes: listen on the demo speakers. Judge generated wind, recorded music,
   engines and gear cues; automated audio lifecycle tests cannot judge the mix.
5. Three minutes: inspect the tank and hovercraft studies and name any direction worth
   refining. No production replacement is selected merely because a study passed tests.

Real-device feedback is separate from implementation permission. Default-on work
continues under the owner's instruction without waiting for another approval to enable it.

## Noon delivery

The requested handoff is the public address and repository:

- https://www.syn3h.com/
- https://github.com/terran-labs/syn3h

Before delivery, replace this draft's snapshot with current production identity,
accepted checks, remaining visible limitations and any unresolved owner choices.
