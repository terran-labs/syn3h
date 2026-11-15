# Morning handoff draft

Prepared during the 15 November overnight run. This is a working draft, not the 8am
report. Recheck production, integration and lane evidence before delivering it.

## Public build

The latest direct metadata check still identifies release 2, `bc8cb48`, at
https://www.syn3h.com/. Release 3 failed public checks and was rolled back. Its local
tests do not establish public acceptance. The first failure concerned score display;
the retry failed resource loading. Neither cause has been conclusively established.

The next release must verify exact frozen HTML and entry assets, normal gameplay on
the primary public domain, and the combined browser cases. The asset check is prepared
in the integration branch; primary-domain release wiring is still being completed.
Occupied lobbies no longer block deployment. Failed public checks still require rollback.

## What has reached integration

At trunk `3e18b00`, inspected from the live checkout:

- Rich terrain and river fords default on.
- Aerial perspective defaults on.
- Custom planet maps refresh from slider snapshots and reject stale worker results.
- Procedural ground cover, original-hovercraft procedural materials, transparent
  plain-tier canopies and corrected instanced tyre relief are landed.

These are integration facts, not claims that those changes are public. Exact lane
revisions and remaining checks are in `DEFAULTS-AUDIT.md`.

## Tested handoffs still requiring combined acceptance

- Jet Mk2: lead reports 314 vehicle tests, browser checks and game smoke passing.
- Gear: lead reports 222 tests and ordinary-entry two-browser checks passing. Bots
  use all four tools; Pester evasion currently covers wheeled bots only.
- Reconnect: default-on change has unit and local Cloudflare runtime evidence,
  including explicit and stored opt-outs. Public acceptance remains open.
- Map fidelity: sea depth and snow threshold corrections have 19 passing tests.
  The map still approximates terrain noise, slope and remote islets.

The combined multiplayer check must include host dropout and return with bots, gear
and races active. Holding host identity clears server bots, so isolated reconnect
tests alone do not establish the complete player experience.

## Work still underway

- Water defaults, wakes, spray and falling sheets need their final combined visual,
  controller and resource-cost checks. Transparency from above remains an explicit
  acceptance requirement.
- Post Effects is finishing stable lighting. Temporal motion vectors have a known
  defect; volumetric clouds and GI remain authorized unfinished work.
- UX is validating generated-only wind and normal-entry behavior, enabling existing
  score layers while preserving recorded music choice, and completing race display.
- Bots still have flight stability and aerial Pester evasion work.
- Showcase capture remains owed. Release notes and capture failures must not turn a
  successful gameplay deployment into a failed release.

The later performance, diagnostics and cursor-UX queue remains pending until current
assignments finish. It includes the FPS history panel, hardware and rendering failure
information, one low-FPS recommendation control, adjustable tiers and minimap vignettes.

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
