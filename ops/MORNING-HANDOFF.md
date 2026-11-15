# Morning handoff draft

Prepared during the 15 November overnight run. This is a working draft, not the 8am
report. Recheck production, integration and lane evidence before delivering it.
Evidence snapshot: 1:44am Pacific. Production identity below was last checked directly
at 1:28am; it is not a fresh deployment verdict.

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

At trunk `752a16c`, inspected from the live checkout:

- Rich terrain and river fords default on.
- Aerial perspective defaults on.
- Custom planet maps refresh from slider snapshots and reject stale worker results.
- Procedural ground cover, original-hovercraft procedural materials, transparent
  plain-tier canopies and corrected instanced tyre relief are landed.
- Generated-only wind, score layers, default-on water switches, all four gear tools
  and same-player reconnect are landed. Stored explicit off choices remain intact.
- Canonical race networking, display and normal-play hooks are landed. Host/guest,
  reconnect and lobby-return acceptance remain separate checks.
- The job limiter now holds inherited kernel locks. Old wrappers drained before
  rollout; lanes use the absolute trunk helper with three shared slots and two workers.

These are integration facts, not claims that those changes are public. Exact lane
revisions and remaining checks are in `DEFAULTS-AUDIT.md`.

## Tested handoffs still requiring combined acceptance

- Jet Mk2: lead reports 314 vehicle tests, browser checks and game smoke passing.
- Water correction `c28eafb`: typecheck, 70 regression tests and paired diagnostics
  pass; independent Vehicles review found no blocking issue. Wing skims retain about
  31.6 m/s, Zorb ride height matches the approved original, and submerged motor damping
  receives real contact state. Combine with the five legacy fixture corrections.
- Stable Post Effects `19cc879`: lane reports typecheck, 30 focused tests, both
  rendering backends and HTTPS smoke passing. This excludes unfinished renderer work.
- Presence `d247487`: 193 network tests, build and dev/Cloudflare runtime checks pass.
  Independent source review confirms aggregate privacy and expiry. Lobby UI acceptance
  and production verification remain open.
- Buggy procedural tyres and distance models have lane rendering and driving evidence.
  A guarded six-contact ram test passes; it is not rough-terrain or performance proof.

The combined multiplayer check must include host dropout and return with bots, gear
and races active. Holding host identity clears server bots, so isolated reconnect
tests alone do not establish the complete player experience.

## Work still underway

- Water wakes, spray and falling sheets have lane visual checks. Their combined source
  gate must include the physics correction above. **Transparency from above is
  unimplemented:** the sea/river material is opaque; shallow colouring does not reveal
  submerged objects or ground. Two-client wave visuals and real-mobile cost are unverified.
- Stable lighting is ready for combined acceptance. Temporal motion vectors have a known
  defect; volumetric clouds and GI remain authorized unfinished work.
- The separately authorized UX redesign adds the right rail, Exit world, internal
  panel scrolling, contextual tooltips and a bottom-left minimap vignette. Source review
  found music-selector keys leaking into driving and inconsistent Escape state; both
  are corrected in the lane, with final keyboard/touch/cursor validation underway.
- Bots still have host/guest race acceptance and aerial Pester evasion work. Wheeled
  bots already evade Pesters; all four gear tools have combined browser evidence.
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
