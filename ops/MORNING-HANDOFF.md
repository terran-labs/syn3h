# Morning handoff draft

Prepared during the 15 November overnight run. This is a working draft, not the 8am
report. Recheck production, integration and lane evidence before delivering it.
Evidence snapshot: 2:35am Pacific. Production identity below was last checked directly
at 2:28am; it is not a fresh deployment verdict.

## Public build

The latest direct metadata check still identifies release 2, `bc8cb48`, at
https://www.syn3h.com/. Release 3 failed public checks and was rolled back. Its local
tests do not establish public acceptance. The first failure concerned score display;
the retry failed resource loading. Neither cause has been conclusively established.

The next release must verify exact frozen HTML and entry assets, normal gameplay on
the primary public domain, and the combined browser cases. Exact asset and primary-domain
gameplay checks now run before the release script records success.
Occupied lobbies no longer block deployment. Failed public checks still require rollback.

## What has reached integration

The integrator reports trunk and main pushed at `da5a89c`, tagged `m16-default-on`.
The exact combined suite log confirms typecheck and all 1,143 tests across 146 files pass.
This candidate is closed to new features while release checks run.

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
two-player seam run failed stale-replica and ram assertions, so acceptance remains open.
The wet fixture and new sinking behavior need diagnosis; no assertion limits were relaxed.
Its identity is `20261115-021120-da5a89c`, version `v26.11.1500`.
The deploy wrapper must preserve those artifacts without rebuilding between acceptance
and deployment. Public acceptance is not established by source tests or a dry run.

The kernel-lock limiter uses three shared slots, one job per lane and at most two test
workers. The sentinel has resumed from the passing candidate baseline, per the integrator.

## Ready for the next batch

These handoffs are excluded from the closed release candidate and are not public:

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
  and needs a different reviewed design. Wheeled bots already evade Pesters; all four gear
  tools have combined browser evidence.
- **Water transparency from above is unimplemented:** the sea/river material is opaque.
  Shallow colouring does not reveal submerged objects or ground. Transparent falling
  sheets do not satisfy this requirement. Two-client wave visuals and real-mobile cost
  remain unverified.
- Showcase capture remains owed. Release notes and capture failures must not turn a
  successful gameplay deployment into a failed release.

The later performance, diagnostics and cursor-UX queue remains pending until current
assignments finish. It includes the FPS history panel, hardware and rendering failure
information, one low-FPS recommendation control and adjustable tiers. Reuse the current
owner-authorized minimap and rail work rather than implementing them twice. Connection
diagnostics in that rail are not the requested FPS, hardware and failure diagnostics.

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
