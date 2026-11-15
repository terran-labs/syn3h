# Orchestrator state

Last verified: 2026-11-15 01:52 PST. Demo deadline: Sunday noon Pacific.

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

Release 2 remains the last verified public build: bc8cb48, Worker
747d2041-ba63-403a-818f-77834ae9951a. Explicit rollback target is release-2.
Release 3 was attempted and rolled back twice. First public scoring snapshots failed;
no scoring regression was demonstrated and the cause remains unproven. Retry failed with
resource 404s before initialization. Rollback network checks passed. Never infer production
from the newest release tag or TSV row.

Evidence: /tmp/astra-release3-domain.log, /tmp/astra-release3-retry.log,
/tmp/astra-release3-retry-rollback2.log and /tmp/astra-public2-diagnostic.log.
R3 frozen41743f6 includes the speed cap,904tests,dryrun,net3,vehicle8 and both seam checks.
R4 frozen c72b0cb has975tests including one targeted timeout rerun,dryrun,net3,vehicle8,
solo seam and multiplayer wrap checks. Both are preserved fallback candidates; neither
validates the newer normal-entry build. A deliberate new frozen candidate is required.

Release automation now checks exact identity, HTML and linked entry JS/CSS before gameplay,
and checks the primary www domain before recording success. Runtime lazy assets still need
browser acceptance. Notes/showcase failures stay nonfatal after acceptance; no automatic
publication. Actual showcase capture and calendar reconciliation remain owed.

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
and queued waiters drained. The current root source remains that accepted baseline.

Unaccepted combined candidate c736963 is on fast: new Buggy and Jet models, Water66fdf14
plus correction c28eafb and legacy test setup24d121b, stable Post19cc879, GI7e4303e,
UX3873abc, and Hover/Tank lab studies. Typecheck passes; full suite1124pass/1fail.
The remaining failure is ice jet bot safety (9.94 seconds inverted, bound below3), assigned
to Bots against this exact source. Water wing/Zorb tests now pass unchanged bounds.
Evidence: /tmp/astra-defaults-combined-suite.log. Final combined browser checks are running
in /tmp/astra-defaults-browser.log. Earlier91b73c3 passed60 lab tests and8 tick-bound vehicle
runs, which do not validate the later candidate. No new release is frozen or public.

Race lifecycle passes on fda6438 plus getter correction: staged eligible encounter,
automatic countdown/result, guest controls, held host return and expiry/takeover.
Natural idle-spawn100s runs had no nearby ground bot within60m and no race proposal.
Evidence: /tmp/syn3h-astra-races-encounter-v7.log. New UX Exit world selector needs combined
coverage. Presence0780403 includes canonical serverd247487 and validated UI; pending root
integration. Saved-seed moons remain contract work. Temporal AA, volumetric clouds, aerial
Pester evasion and above-water transparency remain unfinished. GI is in the unaccepted batch.

## Operations

All heavy jobs use absolute /Users/vtn/dev/Syn3h/tools/heavy.sh: kernel-lock v2,
strict three slots, one job per lane, maximum two test workers. Migration barrier completed,
all14 lanes cleared; no current hold. Root sentinel is paused until this batch is accepted,
then resume the existing script, now using the absolute helper for tests and smoke.
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
