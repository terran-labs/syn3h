# Orchestrator state

Last verified: 2026-11-15 03:44 PST. Demo deadline: Sunday noon Pacific.

## Authority

Continue authorized overnight releases without owner review. Occupancy is never a release
gate. Keep exact frozen-build validation and immediate rollback after failed public checks.
Only the Orchestrator integrates and deploys; merge in the fast worktree, then fast-forward
trunk. Completed features default on through normal entry, preserving explicit off values,
quality tiers and mutually exclusive choices. Stored room values have no provenance and stay.

Generated wind only; original music and laser stay. SpaceStation starts unless an explicit
saved track overrides it. Daydream is five minutes. Jet adopts smooth Hexring Mk2; buggy
uses smooth procedural tread. Tank round six rejected, ten new studies authorized; no tank
or hovercraft production study has been selected. Smooth near-camera ground stays deferred.
Finish existing assignments before conditional performance/UX follow-ons. The owner's newer
fine-line UI/lobby redesign is directly authorized and underway in UX, independently of that
condition. Water transparency from above is unimplemented, not an accepted water capability.

## Production

Release 5 is accepted live at https://www.syn3h.com/ as of 03:38 PST:
version v26.11.1501, source 5e38ef6, Worker e9f20f19-4194-40c2-8e6b-a8becb6190a0,
frozen copy 20261115-032406-5e38ef6. Worker and primary multiplayer, exact assets and
all eight public vehicle checks passed with no page errors. Acceptance marker and log:
/tmp/astra-release5-accepted and /tmp/astra-release5-publish.log.
Release 4 remains a tested fallback. Release 5 is now the target for any future rollback.
The current pinned release-5 supervisor restores release-4 and must be revised before reuse.
The deployment supervisor exited successfully after capturing all eight showcase scenes.
The reviewed five-scene GIF and stills are published with the release notes; all six
attachment URLs pass. Original captures are preserved, including excluded weak frames.

The first release-4 attempt failed the primary site's default-bot wait and rolled back to
release-2; both rollback addresses passed. The test used a repeating room namespace.
Unique timestamp/random rooms now prevent fixture reuse; the earlier cause is unproven.
All waits and assertions were retained. Preserved evidence: /tmp/astra-release4-attempt1.
Release 3 was attempted and rolled back twice. Never infer acceptance from tags alone.
The release-4 rollback history is retained as evidence, not the current rollback selection.

Release automation checks exact identity, HTML and entry assets, then primary gameplay
and the eight-vehicle matrix before recording acceptance. Notes and captures are nonfatal
post-acceptance artifacts. Release 4 retains its reviewed three-scene showcase. Release 5
adds the settled lobby and gliding wings to the curated selection; the obsolete lobby
capture selector is fixed with historical card behavior preserved.

## Integrated evidence and current queue

Trunk065b71b includes terrain/weather defaults, Custom map and fidelity, vegetation,
hovercraft procedural materials, transparent tier0 canopy, tyre geometry fix, all gear
and water defaults, rejoin, generated-only wind, recorded music default, brand and UX polish.
Combined gear/water/server tests265pass; UI/audio/routing127pass; normal-entry two-browser
gear and eight Chrome/WebKit vehicle drives pass. The prior gear failure hit stale8787;
HTTP now uses the configured same-origin proxy and the browser asserts its endpoint.
Evidence: /tmp/astra-corrected-integration.log, /tmp/astra-gearwater-integration.log.

Trunk fda6438 integrated canonical races, main/UI hooks, mixed bots, animated lobby logo
and the terrain import-cycle fix. Limiter rollout 752a16c followed after all old wrappers
and queued waiters drained. These are included in the current accepted source below.

Current accepted source is da5a89c, tagged m16-default-on and pushed to trunk.
It includes the new Buggy and Jet models, corrected water contact/wing/Zorb support,
stable lighting and half-resolution GI, the fine-line UX redesign, aggregate player lights,
and Hover/Tank lab studies. Typecheck and all 1,143 tests across 146 files pass.
Evidence: /tmp/astra-defaults-final-suite.log.

The jet pilot now transforms angular acceleration through the actual principal inertia
frame and bounds its final descent lean. Original gains and safety assertions remain.
Combined race testing also found and fixed a removed-leader physics read. The corrected
combined browser run passes automatic countdown, actual winner, guest restrictions,
Exit world eligibility, host drop/rejoin and expiry/takeover with no errors.
Evidence: /tmp/astra-combined-races-fixed.log. This stages an eligible nearby encounter;
idle-spawn discovery is not guaranteed. Presence passes combined live endpoint checks.

Frozen validation passed: full suite 1,143 tests, direct and 150 ms latency network,
three consecutive network runs, eight vehicles, WebGPU/WebGL entry and solo seams.
The dry two-player seam fixture passed all 17 checks, including actual far-side contact,
tag transfer and shove. It uses supported dry terrain, bounded readiness and unchanged
original gameplay assertions. Earlier intermittent startup stale states remain unexplained;
the dry steady-state result does not prove wet or rough-terrain behavior.
Evidence: /tmp/syn3h-frozen-wrap-grade05.log and .json. Tooling fixes are on fast1b2cc25.

The next batch is integrated from integration/next-visuals after typecheck, all 1,156 tests
across 150 files and a production build passed. Combined WebGPU/WebGL entry, four touch
and desktop layouts, and saved-world browser checks pass. The browser wrapper failed
only at cleanup with EPERM; all owned ports were verified closed. The settled logo is complete.
Evidence: /tmp/astra-next-visuals-full-gate.log and /tmp/astra-next-visuals-browser.log.
Cloud volumes, temporal antialiasing, saved moons and touch clearance passed the new
frozen and public checks and are live in release 5.
Temporal rejects history on procedural position/sprite materials, including water/grass;
GI is screen-space, clouds have no ground shadows, real-device performance is unmeasured.

Aircraft Pester evasion16df9a6 remains rejected. Research7ec2630 completed99 measurements
and independent Weapons review, with two escapes and two harmful catches. No safe side
selection or forward-flight benefit established. No further runtime implementation approved.
Ground dodge and all-bot gear remain delivered. Water transparency remains unimplemented;
smooth near-camera terrain remains deferred and tank/hover study selection remains open.

## Operations

All heavy jobs use absolute /Users/vtn/dev/Syn3h/tools/heavy.sh: kernel-lock v2,
strict three slots, one job per lane, maximum two test workers. Migration barrier completed,
all14 lanes cleared; no current hold. The existing root sentinel resumed with da5a89c as its baseline and uses the absolute
helper for tests and smoke on subsequent trunk changes.
Do not restart old wrappers or bypass the limiter. Current browser job and peer completion
notifications are active. Existing continuation heartbeat remains in place.

Preview configuration edits must validate a complete temp sibling then atomically rename.
No direct truncating writes. Use scoped broker operations and fresh HTTPS plus rendered
verification, not stale receipts or bare all-service status. Post32791 recovered through its
owner; UX32796 and sharedlab32795 have lane verification. Load paseo-preview before sharing.
Five-minute continuation heartbeat3ac4c3a6 remains the existing supervision arrangement.

Phone QR join, current-device driving and actual listening remain owner feedback checks,
not release permission gates. Historical lane identities follow; thread messages supersede
this snapshot. Do not retry exhausted Claude profiles.

| Lane | Agent id | Worktree and branch | Dev port | Doing now |
|---|---|---|---|---|
| Foreman | c5dc3811-9bca-4a79-9c81-bcdfdf66908d | `/Users/vtn/dev/.vorteo/worktrees/2jg65r8u/foreman`, `ops/foreman` | none | See handoffs and current thread checklist. |
| Terrain Lab | 39e2a688-346b-4874-be02-46a7fe6f13ee | `.../2jg65r8u/terrain-lab`, `feat/terrain-lab` | 5191 | See handoffs and current thread checklist. |
| Vehicles, shared code (Codex 1) | 8b09a27b-c89d-46b1-9e52-0951e4bd020f | `/Users/vtn/dev/Syn3h-wt/vehicles2`, `feat/vehicles2` | 5185 | See handoffs and current thread checklist. |
| Bots, Performance, QA (Codex 2) | 1e6bdac4-cef1-44c7-9768-1eae4b85ef3d | `/Users/vtn/dev/Syn3h-wt/fx`, `feat/fx` | 5186 | See handoffs and current thread checklist. |
| UX and sound (Codex 3) | ba7d0154-b4d0-4b69-9008-805456c9fdde | `/Users/vtn/dev/Syn3h-wt/audio`, `feat/audio` | 5187 | See handoffs and current thread checklist. |
| Multiplayer | 1aea4dff-9b45-4b17-ba36-116438350f17 | `/Users/vtn/dev/Syn3h-wt/net`, `feat/net` | 5183, room 8791 | See handoffs and current thread checklist. |
| Syn3h buggy | 12abdd19-b672-40d7-938a-be2ab2339315 | `.../2jg65r8u/veh-buggy`, `veh/buggy` | 5201 | See handoffs and current thread checklist. |
| Jet | e73e5ed4-a32d-468e-a2cc-cfda3c196288 | `.../2jg65r8u/veh-jet`, `veh/jet` | 5202 | See handoffs and current thread checklist. |
| Hovercraft | 43191a2c-f8f5-4da4-b147-423a10dff345 | `.../2jg65r8u/veh-hovercraft`, `veh/hovercraft` | 5203 | See handoffs and current thread checklist. |
| Classic buggy | 25c9c763-6966-410d-a9f9-0714245088d6 | `.../2jg65r8u/veh-classic-buggy`, `veh/classic-buggy` | 5204 | See handoffs and current thread checklist. |
| Tank | 1e12b353-8e53-4aaa-8784-7d148ebf9c28 | `.../2jg65r8u/veh-tank`, `veh/tank` | 5205 | See handoffs and current thread checklist. |
