# Real vehicle and local deployment QA

The bot chase captures use the default Syn3h buggy with networking disabled. The capture tool now presses Play and gives its local bot manager ownership before sending input. Production networking checks exercise the real BotManager rather than importing Vite modules.

Bot changes are covered by twelve tests: real buggy and placeholder contact, steering handedness, target selection, remote ownership, recovery, dry-shore steering, count changes, and optional road navigation. Uphill road guidance reads current road arrays rather than caching arrays across regeneration. Bots still use no wings.

Captures inspected:

- `/tmp/syn3h-bots-real-stationary-after/contact-sheet.png`: six bots ram a stationary player, producing 11 m/s player motion at the four-second sample.
- `/tmp/syn3h-bots-real-moving-after/contact-sheet.png`: bots approach within 3.6 m at four seconds and 4.6 m at twenty seconds while the player drives.
- `/tmp/syn3h-bots-real-climb/contact-sheet.png`: bots ram the player on the volcano road near elevation 63 m. The scripted player overshoots a later bend; this does not prove summit completion.

All three captures had zero console or page errors. Automatic quality reduction changed six bots to four during the runs. Short collision piles still occur; timed flipped/stuck recovery is covered by tests, not a claim that collisions never jam.

## Repeatable sweep

`node tools/vehicle-qa.mjs [base URL] [output directory]` runs four vehicles, three seeds and two requested quality levels. Each case has a fresh browser context, a settled spawn sample, twenty seconds of timed input, 100 ms telemetry samples and three screenshots. Actual graphics levels and elapsed simulation time remain in the trace. The quality controller may downgrade during a run; headless rendering can also advance less than twenty seconds of simulation during twenty seconds of wall time.

The checks require no console/page errors, wheels on ground or spawn clearance within five metres, movement of at least three metres, finite positions and speed, speed below 500 m/s, position within four terrain widths, and no ground penetration deeper than five metres. These broad bounds detect catastrophic instability, not good vehicle handling. Jet input holds thrust; wheeled vehicles and hovercraft accelerate with short left/right turns.

Verified sweep output: `/tmp/syn3h-vehicle-qa/results.json`. Each row covers seeds 1, 42 and 2024 at requested levels 0 and 2.

| Vehicle | Clean load | Grounded spawn | Moves | Finite, no fall-through | Peak speed |
| --- | --- | --- | --- | --- | --- |
| Syn3h buggy | 6/6 | 6/6 | 6/6 | 6/6 | 47.3 m/s |
| Classic buggy | 6/6 | 6/6 | 6/6 | 6/6 | 47.7 m/s |
| Jet | 6/6 | 6/6 | 6/6 | 6/6 | 31.3 m/s |
| Hovercraft | 6/6 | 6/6 | 6/6 | 6/6 | 43.7 m/s |

All 24 cases completed with zero console/page errors. All twelve requested level-2 cases automatically dropped to level 1. Twenty wall-clock seconds covered 15.96 to 18.18 simulation seconds under this headless workload. This is not sustained level-2 or physical-phone validation. The jet remained in its default hover mode, climbing under R thrust; forward flight is outside this sweep.

Contact sheets: `/tmp/syn3h-vehicle-qa/{buggy,buggy-classic,jet,hovercraft}-contact-sheet.png`.

Visual findings for the vehicle builders:

1. Classic buggy rolls onto its roof after the high-speed steering inputs, and remains inverted in the twenty-second frame. Reproduction query: `/?autoplay=1&vehicle=buggy-classic&seed=42`, requested quality 2. Hold W throughout, hold A from 7 to 8.5 seconds, then D from 12 to 13.5 seconds. Evidence: `buggy-classic-seed42-gfx2-20000.png` in the sweep directory. This passes the catastrophic-stability check but is a handling/recovery concern.
2. Hovercraft hull visibly intersects the steep slope at twenty seconds. Reproduction query: `/?autoplay=1&vehicle=hovercraft&seed=1`, quality 0, same steering timeline. Evidence: `hovercraft-seed1-gfx0-20000.png`. The body remains finite and above the sampled heightfield; this is visual contact clearance, not a fall through the world.
3. Quality automatically falls from 2 to 1 in every level-2 case. Reproduction: any listed query, select graphics 2 and run the sweep. This is the intended low-frame-rate response, but it prevents a claim of sustained high-quality rendering on this headless machine.

## Local Cloudflare rehearsal

Commands executed in the FX worktree:

```sh
npm run build
npx wrangler dev --local --ip 127.0.0.1 --port 8789
node tools/net-smoke.mjs http://127.0.0.1:8789/
```

This is a loopback test endpoint, not a shareable preview. No login, deployment or external publication was performed.

The production build passed. The main JavaScript is 5,586.70 kB, 2,015.30 kB gzip. Dist contains 35 files totalling 27,928,171 bytes; its largest file is the 11,445,839-byte source map. Each file is below Cloudflare's [25 MiB static asset limit](https://developers.cloudflare.com/workers/platform/limits/), and the count is below the free-plan 20,000-file limit. The local Worker bundle is 33,854 bytes, 9,412 bytes gzip; the large client bundle is a static asset, not the Worker script.

Wrangler returned 200 for HTML and JavaScript with correct content types, 426 for an ordinary request to `/ws`, and 101 for WebSocket upgrades. Production clients select same-origin `wss:` on HTTPS. The configuration routes `/ws` to the Worker before assets and binds the SQLite Durable Object with its migration. Rapier uses the compat package's inlined WASM, so this build has no separate WASM response needing a MIME header. The production browser initialized physics successfully without cross-origin isolation headers.

All 22 multiplayer smoke checks passed, including the real manager's host/non-host ownership, bot replication, a laser hit on a host-owned bot, seed regeneration and a late joiner. No console or page errors occurred. Evidence: `/tmp/syn3h-wrangler-net-smoke.log`, `/tmp/syn3h-wrangler-rehearsal.log`, `/tmp/syn3h-rehearsal-build.log` and inspected `/tmp/syn3h-net-smoke.png`.

No Cloudflare packaging or routing blocker appeared in this rehearsal. Account quotas, remote Durable Object migration and real HTTPS deployment were not exercised. The networking owner should still review managed-bot body lifetime when local count or quality changes while a remote controller retains a reference; the basic smoke case does not cover that transition.
