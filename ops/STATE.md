# Orchestrator state

Last verified: 2026-11-15 00:19 PST. Demo deadline: Sunday 15 November at noon Pacific.
This record replaces the obsolete Saturday evening freezes and release holds.

## Current authority and ownership

The owner authorized overnight releases without reviewing each one and removed earlier
cutoffs. Each release still needs frozen-build checks and immediate rollback if public checks fail.
At 00:31 PST the owner explicitly removed the occupied-lobby hold and said to keep
deployments rolling. Do not wait for lobby occupancy to clear or ask again. Integration and deployment belong to this
Orchestrator alone. The Foreman coordinates owner decisions and lane recovery.

The owner switched this thread to Astra after Claude exhausted its weekly quota and said
to proceed. Do not retry exhausted Claude profiles. Existing recordings supplied by the
owner stay, except wind: the owner explicitly chose generated wind only through the Foreman at
00:33 PST. UX owns the scoped playback change; music and laser originals stay.
The smooth near-camera ground request remains deferred: the owner said to backlog it,
not start it now. Tank round six is a design study awaiting the owner's choice.

## Production and release 3

Production remains release 2, commit bc8cb48, Worker version
747d2041-ba63-403a-818f-77834ae9951a. Release records are in
`/Users/vtn/dev/Syn3h-stable/releases.tsv`.

Release 3 is on branch `release/3` in `/Users/vtn/dev/Syn3h-wt/release3`,
commit 41743f6, tag m15.1-release3. Frozen candidate:
`/Users/vtn/dev/Syn3h-stable/20261114-235941-41743f6`.
The working tree was clean at recovery. The final dry run passed direct and 150 ms
latency checks: `/tmp/syn3h-dryrun-r3.log`. Three corrected network checks passed in
`/tmp/release3-final-net-smoke-r3tmp-{1,2,3}.log`. Earlier similarly named logs contain
superseded failures. A fresh full suite passed 904 tests in `/tmp/release3-astra-tests.log`.
Fresh Chrome and iPad-sized WebKit driving checks passed all four vehicles with zero
errors; results and captures: `/tmp/astra-release3-matrix`. Three fresh consecutive
network checks passed against this exact frozen copy in `/tmp/astra-release3-net-*.log`.
The earlier lobby captures and seam result were recovered and inspected.

Release 3 includes the trusted-speed security patch as 17aa00e, equivalent to trunk
b056c5c for the features on this branch. It caps speed allowance at 100 m/s for beam
origin and boost, cord hook origin, ram reach and shove speed memory. It also includes
the Bungee reach checks, 0.6 m plant cap, ten-world galaxy, recorded music default and
five-minute Daydream. Yoink, Big Red and Pesters are absent.

At recovery the public lobby had one person; the owner subsequently waived that hold.
Use `node tools/production-occupied.mjs https://www.syn3h.com` from release3:
its protocol version matches release 2. Public release 2 has no aggregate status endpoint;
the fallback sees the named lobby only. Unknown named rooms are a limitation.
The owner answered the question. Five-minute release follow-up heartbeat `3ac4c3a6`
replaces occupancy supervision.

Before shipping: finish evidence verification, notify Foreman,
then run `tools/release.sh 3 "release note"` from release3 with the existing Cloudflare
credential in the environment. Never print the credential. Touch only Worker `syn3h`.
After deployment check the public domain, network test, every vehicle and WebKit.
On failure use `tools/rollback.sh release-2` immediately; do not rely on the default
previous-release selection if deployment failed before writing the release record.

## Trunk and integration

Integration: `/Users/vtn/dev/Syn3h`, branch `build/weekend`; recovery HEAD 4604749.
Never merge in this checkout because the preview serves it. Use the clean integration
worktree `/Users/vtn/dev/Syn3h-wt/fast`, review diffs, typecheck and test, then fast-forward
trunk. Keep `main` and the public origin synchronized after accepted landings.

The sentinel is running as PID 70500 from `/tmp/syn3h-research/tools/sentinel.sh`.
Its last recovered verdict at 00:10 was 970 tests and SMOKE OK for 4604749.
Log: `/tmp/syn3h-sentinel.log`. Heavy jobs use `tools/heavy.sh`: low priority,
three workers maximum by default, five slots above load 8. Never use name-based kills.

Trunk has the inspector closed initially, minimap in its corner, worn tracks outside
alpine, denser fog, generated wind alongside the recording, shared sea/wind clock,
new tag gear off by default and the continuous galaxy descent. Release 3 predates
those changes. Water and post effects remain opt-in.

## Outstanding integration work

- Buggy bb797ba and jet 409a315 cockpit flags reviewed and merged in the integration
  worktree. Typecheck and 47 camera, generated-jet and operations tests passed.
- Lobby dfd47d0 adds tap-to-drop and a camera blend. Review is in progress; the Lobby
  lane is checking repeat-drop state and exception cleanup before integration.
- Pesters review found an unbounded speed allowance at launch and reusable live shot IDs.
  Regression tests reproduced both; fixes passed all 183 network and gear tests.
  This affects trunk only. Release 3 has no Pesters.
- Release calendar labels, notes drafts and showcase hooks passed a dry run at 4273b06
  including direct and delayed network checks. Three failure-path tests prove notes,
  capture or tag failures do not fail an already live release. No notes are auto-published.
  The dashboard headline is refreshed. The morning brief still needs the final release state.
- Reconcile remaining handoffs with the Foreman. Do not infer acceptance from idle agents.
- Phone QR join, vehicle feel and actual listening remain owner acceptance checks.

## Previews and lane topology

Load the paseo-preview skill before preview operations. Use only managed Tailscale HTTPS
links after verification. The Foreman is checking current health. Game and dashboard are
broker scripts in workspace `wks_cfcb37521a420b78`. Do not resurrect obsolete tailnet
outage diagnoses: the late-night disappearance was caused by machine overload.

Historical lane identities below remain useful for recovery; their old activity claims
have been removed. Foreman is recovering current assignments. Vehicles, UX, QA,
Multiplayer and vehicle leads were quota-error at recovery. Do not restart them blindly.

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
