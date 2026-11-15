# Smoke room isolation and missing-bot diagnostics

The reviewed unique-room fixture passed one authorized browser run against the exact frozen candidate. Failure-snapshot execution remains untested because that run passed.

## Preserved baseline

`tools/net-smoke.mjs` was copied from the corrected integration worktree before editing. Baseline file blob: `5d450de8a4bc460dee7c6afaafdb3321da88fcaa`; latest baseline file commit: `e2552ba52b37d00467d992043ce0f39e3b28396f`. Normal-default bot checks, human roster filtering, subsequent bot isolation, scoring waits and all other existing assertions remain unchanged.

## Bounded changes

Room identity is now `smoke` plus the full decimal timestamp and a random 48-bit hex suffix. Current names are 31 characters, lowercase and normalization-safe; an explicit guard rejects names longer than 32 characters. The base URL and room are logged before launch.

On an assertion failure, exception or page error, all created clients receive parallel diagnostic snapshots with a five-second limit. Snapshots include requested bot count, host-owned bot count, replicated bot roster, host/local identities, playing/suspension, simulation tick/time, FPS/graphics/backend, network counters/socket state/clock and startup timing. Guest-owned bot count zero is normal; the replicated roster distinguishes missing replication. No reconnect secrets are serialized. A unique room-named JSON file and a `NET SMOKE FAILURE DIAGNOSTICS` console line preserve the data. That prefix survives the current domain wrapper's output filter. Browser cleanup still follows diagnostics.

## Existing evidence and limits

The publish log reports workers.dev smoke passing, then www timing out at the ten-second bot-existence wait in the external fixture. Exact frozen assets were verified before both checks. The existing domain wrapper filters output to failures and NET SMOKE lines; it did not retain the failed room ID or effective bot setting. Its common diagnostic log was subsequently replaced by the rollback check.

The old room namespace used the timestamp modulo 100,000. It repeats every 100 seconds, but a collision requires the same millisecond remainder; repeated runs do not automatically collide. The smoke fixture changes shared bot settings, so reuse could inherit those settings while a prior room remains live or held. There is no recovered failed-room identity proving that happened here. Room collision remains an inference, not the established cause. The new snapshots distinguish persisted bot count zero from a nonzero request with failed host creation or guest replication.

Syntax and whitespace checks pass. No running external harness or frozen artifact was edited.

## Frozen validation

Tested fixture: `4f73d4bb31506f975119272c33aa55c867afb758`. Frozen candidate: `da5a89c9712314100c117f7cabb7ff173b0517b8`. Build identity, HTML and both entry assets matched before the test. One run through the absolute heavy helper passed all 34 checks and exited zero.

Unique room: `smoke1794740391165-7f01b4f929f1`. Requested bots were four on both clients; host-owned count was four, guest-owned count zero, and both replicated rosters contained the same four bots. Default bots, movement, replication, contacts, tags, bot-hit authority, late join, hill scoring and lava recovery passed. No page errors. Lobby presence requests aborted on hiding the Lobby were logged but were not page errors.

Full log: `/tmp/syn3h-frozen-smoke-4f73d4b.log`. Runtime log: `/tmp/syn3h-frozen-smoke-4f73d4b-runtime.log`. The ephemeral runtime used temporary configuration/storage outside the immutable candidate; owned cleanup completed and port 18940 had no listener. No public deployment or managed preview restart occurred.

The failure-only snapshot branch did not execute, so optional accessor values are not runtime verified. This pass validates the unique-room fixture against the frozen build, not the hypothesized cause of the earlier public failure.
