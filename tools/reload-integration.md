Playable channels and reload recovery
====================================

Stable server
-------------

Merge the worker commit, then promote a new snapshot. Older snapshots omit `src/`, which `server/room.ts` imports. The corrected promoter includes it and safely encodes the build note.

From the integration checkout, the preview broker command is:

```sh
exec node tools/serve-stable.mjs --dir ../Syn3h-stable/current --port "$PASEO_PORT"
```

The process resolves `current` once. Promoting does not change a running server. Restart the stable preview explicitly to select the new snapshot. The room simulation and static client share one port; `/ws` uses the snapshot's Room implementation and tsx dependency. This Node adapter does not emulate Cloudflare Durable Object persistence. Rooms are in memory and disappear when their last connection leaves or the process restarts.

Verification: all 29 checks in `tools/net-smoke.mjs` passed against a temporary copy of the existing snapshot, with missing source restored from that snapshot's exact commit. No live snapshot or broker configuration was changed. `node --test tools/serve-stable.check.mjs` verifies pinning, MIME, cache headers, HEAD and path containment.

Player recovery
---------------

`src/core/resume.ts` exports `prepareResume`, `ResumeSession`, and `RESUME_KEY`. The session saves every 1.5 simulated seconds and on visibility/page-hide events. Storage failure is harmless. Saves expire after ten minutes and belong to one browser tab. No held throttle or fire input is replayed.

`tools/resume-integration.mjs` contains exact, checked replacements for the current `src/main.ts`. It is a test helper, not a runtime dependency. The browser smoke applies those replacements through an in-memory Vite transform; main.ts remains untouched. To inspect the proposed main in a temporary file:

```sh
node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; import {integrateResume} from "./tools/resume-integration.mjs"; writeFileSync("/tmp/syn3h-main-with-resume.ts",integrateResume(readFileSync("src/main.ts","utf8")))'
diff -u src/main.ts /tmp/syn3h-main-with-resume.ts
```

The changes are:

1. Import `prepareResume`, `ResumeSession`, `RESUME_KEY`, and the existing `saveVehicleChoice` helper.
2. After parsing the query and applying its seed, call `const saved = prepareResume(query)` before creating terrain. If there is a saved room and no explicit room query, set that room in the query and URL using `history.replaceState`. This lets the lobby and networking use the same room.
3. Initialize the vehicle choice from `saved.kind` and `saved.colors` when available, then save that choice before constructing the shell. An explicit different URL vehicle wins.
4. Clear `RESUME_KEY` in the lobby's intentional vehicle-change reload branch. A deliberate choice must not be undone by recovery.
5. Change `startNetworking(...)` to `const connection = startNetworking(...)`. Immediately after it, inside the Play callback, add:

```ts
game.add(new ResumeSession({
  game, terrain, player,
  room: shell.room || query.get('room') || 'lobby',
  saved, network: connection,
}))
```

Recovery waits for the network welcome because it applies the server's world and spawn slot. It then rechecks room, seed and vehicle, rejects positions below ground, in liquid or outside the terrain, and falls back to the assigned spawn pad. Existing room settings remain authoritative; saved host edits are applied before hello only. With networking omitted from the options, recovery runs immediately for offline play. With networking supplied but unavailable, recovery waits for welcome and does not overwrite the pending save.

The public vehicle API exposes the wings command, not the internal animation fraction. Recovery restores that command and the wings flag; the vehicle resumes its normal wing animation. Camera mode is restored, not the orbit's transient mouse angle.

Manual updates on the live channel
---------------------------------

In `vite.config.ts`, add:

```ts
import { manualReload } from './tools/manual-reload.mjs'
```

Then change the plugins line to:

```ts
plugins: [roomServer(), manualReload()],
```

Retain the existing HMR host/protocol configuration. `hmr: false` would lose CSS updates. `vite:beforeFullReload` is not cancellable, and suppressing only server full-reload messages misses client reconnection and error reloads.

The plugin replaces the three automatic reload calls in Vite 8.3.8's development client with a notice event. CSS and accepted JavaScript modules keep normal HMR; material source changes request manual reload. Clicking the notice performs the actual refresh. Production builds do not include the plugin or notice. This deliberately depends on the installed Vite client: the transform fails clearly if its reload-site count changes. Re-run the smoke tests when upgrading Vite. No installed dependency files are modified.

Validation
----------

```sh
node --test tools/serve-stable.check.mjs tools/manual-reload.check.mjs
SYN3H_NO_ROOM_SERVER=1 npx vitest run tests/core/resume.test.ts
node tools/reload-smoke.mjs /tmp/syn3h-stable-verify
node tools/manual-reload-smoke.mjs
npx tsc --noEmit
```

The two browser checks own port 5186 while running and close their servers afterwards. The first needs a complete stable snapshot supplied as its argument. Verified: real multiplayer refresh restores pose, wing command, colors, camera and host gravity; full-reload event preserves the game; notice click refreshes; CSS and accepted JS update; material updates wait; server restart preserves the page. Both browser checks reported zero page errors. Inspected screenshot: `/tmp/syn3h-resume-notice.png`. Logs: `/tmp/syn3h-reload-smoke.log` and `/tmp/syn3h-manual-reload-smoke.log`.
