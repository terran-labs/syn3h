# Orchestrator state

Last verified: 2026-11-15 00:48 PST. Demo deadline: Sunday noon Pacific.

## Authority

Continue authorized overnight releases without owner review. Lobby occupancy is never a
deployment gate, per the owner's direct answer. Keep frozen-build validation and immediate
rollback after a failed public check. Only the Orchestrator integrates and deploys.
Finish existing lane assignments before the new conditional performance and UX queue.

Owner decisions: generated wind only; original music and laser stay. Jet adopts Hex ring
Mark 2 with smooth aerodynamic surfaces. Buggy uses smooth procedural tread. Tank round
six was rejected; ten distinct six-tread exploration studies are authorized. Automatic bot
races and all bot gear are authorized. Smooth near-camera ground remains deferred.

## Production and release evidence

Release 2 is restored: bc8cb48, Worker747d2041-ba63-403a-818f-77834ae9951a.
Rollback network check passed in `/tmp/astra-release3-retry-rollback2.log`.
Release 3 is NOT accepted. Its first deployment failed public hill-scoring snapshots.
The scoring audit found no demonstrated scoring regression, but the cause remains unproven.
The second immutable restore failed loading with two resource404s before game initialization.
Rollback followed. Detailed resource URL logging is now in the check tool.

R3 exact source41743f6 includes the trusted-speed cap17aa00e. Frozen build:
`/Users/vtn/dev/Syn3h-stable/20261115-003203-41743f6`.
904 tests, dry run, three network checks and eight Chrome/WebKit vehicle drives pass.
`/tmp/astra-release3-wrap.log` also passes two-player crossing, replication, ram, shove
and beam across the seam. Original public failure: `/tmp/astra-release3-domain.log`.
Retry: `/tmp/astra-release3-retry.log`. Deployment records include the attempted R3;
never infer current production from the latest release tag or TSV row.

R4 frozen candidate c72b0cb:
`/Users/vtn/dev/Syn3h-stable/20261115-002920-c72b0cb`.
975 tests pass across the full run and one targeted timeout rerun at lower load.
Dry run and eight vehicle/browser drives pass. Three network runs and both seam checks
are underway. No later lane work is included; preserve this candidate until explicit recut.
Calendar history and actual showcase capture remain to reconcile after release acceptance.

## Integration and testing

Integrate in `/Users/vtn/dev/Syn3h-wt/fast`; fast-forward the live checkout only after
review, typecheck and relevant tests. Trunk includes cockpit flags, Pester security fixes,
direct planet drop with failure cleanup, keyboard/gamepad galaxy navigation, release hooks,
and improved scoring diagnostics. None of the later handoffs is accepted merely because
its lane finished. Release hooks must not publish notes automatically or block deployment.

The temporary lane testing hold is lifted. Use trunk4cbebdd tools/heavy.sh, or invoke
`/Users/vtn/dev/Syn3h/tools/heavy.sh` directly. Every heavy job takes one of three shared
slots, even at low load. One job per lane, maximum two test workers during resumption.
No lane bypass or slot override. Do not restart redundant previews or kill by process name.

## Pending handoffs and ownership

- Lobby Custom map: sanitized overrides, cache and stale replies; final browser gate owed.
  Terrain fidelity corrections follow its accepted planetMap patch, never concurrently.
- Multiplayer owns server/protocol and race helper; Weapons owns current gear client wiring.
  Multiplayer takes race composition after explicit transfer of src/net/index.ts.
- UX owns generated wind, brand cleanup, help, glass/focus and race display; final gates owed.
- Bots owns ford safety, gear decisions and automatic race state; final gates owed.
- Jet Mk2, hovercraft procedural materials, buggy tread, vegetation, water and post effects
  remain lane drafts awaiting their gates and integration review.
- Phone QR join, vehicle feel and actual listening remain owner acceptance checks.
- Five-minute continuation heartbeat3ac4c3a6 preserves release supervision.

## Previews and lane topology

Load the paseo-preview skill before preview operations. Use only managed Tailscale HTTPS
links after verification. The Foreman is checking current health. Game and dashboard are
broker scripts in workspace `wks_cfcb37521a420b78`. Do not resurrect obsolete tailnet
outage diagnoses: the late-night disappearance was caused by machine overload.

Historical lane identities below remain useful for recovery; their old activity claims
have been removed. Owner resumed the active lanes on available Codex profiles. Do not retry exhausted Claude profiles.

| Lane | Agent id | Worktree and branch | Dev port | Doing now |
|---|---|---|---|---|
| Foreman | c5dc3811-9bca-4a79-9c81-bcdfdf66908d | `/Users/vtn/dev/.vorteo/worktrees/2jg65r8u/foreman`, `ops/foreman` | none | Recovery pending; see current status above. |
| Terrain Lab | 39e2a688-346b-4874-be02-46a7fe6f13ee | `.../2jg65r8u/terrain-lab`, `feat/terrain-lab` | 5191 | Recovery pending; see current status above. |
| Vehicles, shared code (Codex 1) | 8b09a27b-c89d-46b1-9e52-0951e4bd020f | `/Users/vtn/dev/Syn3h-wt/vehicles2`, `feat/vehicles2` | 5185 | Recovery pending; see current status above. |
| Bots, Performance, QA (Codex 2) | 1e6bdac4-cef1-44c7-9768-1eae4b85ef3d | `/Users/vtn/dev/Syn3h-wt/fx`, `feat/fx` | 5186 | Recovery pending; see current status above. |
| UX and sound (Codex 3) | ba7d0154-b4d0-4b69-9008-805456c9fdde | `/Users/vtn/dev/Syn3h-wt/audio`, `feat/audio` | 5187 | Recovery pending; see current status above. |
| Multiplayer | 1aea4dff-9b45-4b17-ba36-116438350f17 | `/Users/vtn/dev/Syn3h-wt/net`, `feat/net` | 5183, room 8791 | Recovery pending; see current status above. |
| Syn3h buggy | 12abdd19-b672-40d7-938a-be2ab2339315 | `.../2jg65r8u/veh-buggy`, `veh/buggy` | 5201 | Recovery pending; see current status above. |
| Jet | e73e5ed4-a32d-468e-a2cc-cfda3c196288 | `.../2jg65r8u/veh-jet`, `veh/jet` | 5202 | Recovery pending; see current status above. |
| Hovercraft | 43191a2c-f8f5-4da4-b147-423a10dff345 | `.../2jg65r8u/veh-hovercraft`, `veh/hovercraft` | 5203 | Recovery pending; see current status above. |
| Classic buggy | 25c9c763-6966-410d-a9f9-0714245088d6 | `.../2jg65r8u/veh-classic-buggy`, `veh/classic-buggy` | 5204 | Recovery pending; see current status above. |
| Tank | 1e12b353-8e53-4aaa-8784-7d148ebf9c28 | `.../2jg65r8u/veh-tank`, `veh/tank` | 5205 | Recovery pending; see current status above. |
