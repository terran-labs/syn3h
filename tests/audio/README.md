# Audio and shell handoff

The modules work with the placeholder vehicle and terrain. Nothing changes in `src/main.ts` until the coordinator integrates them.

Add this import:

```ts
import { initGameShell } from './ui/Shell'
```

After creating the player and chase camera, before networking and `ParamPanel`:

```ts
const { shell, audio } = initGameShell(game, player, terrain)
shell.onPlay = () => { player.name = shell.playerName }
```

Change the existing networking room and status callback to:

```ts
room: shell.room,
setStatus: (lines) => { netStatus = lines; shell.setStatus(lines) },
```

If networking sends player identity on join, move the existing `startNetworking(...)` call into `shell.onPlay` after assigning `player.name`. The existing networking placeholder has no name argument. The shell reads the room from the URL, defaults to `lobby`, and keeps it stable. It stores the player name locally on Play.

The shell supplies its own speed/status HUD and hides the old `#hud` while mounted. The existing old HUD update can be removed during integration. The scene continues running behind the start screen, but driving input is suspended until Play.

Audio calls for weapon and collision owners:

```ts
audio.play('laserShot', position)
audio.play('laserHit', position)
audio.impact(impactSpeed, position)
```

`impact` expects a nonnegative speed-like strength, reaches full gain at 20 and clamps above that. Spawn audio plays when Play unlocks audio and decoding finishes. All audio mix parameters have client scope. `audio.setTrack('Classic' | 'Ambient' | 'Carefree')` crossfades streamed tracks; `audio.setMuted(boolean)` controls the master bus. `audio.errors` reports failed assets without stopping the game.

The engine bridge uses the player's speed and drive input. Airborne detection currently uses terrain clearance above two metres because the shared Vehicle interface has no wheel contacts. Replace that fallback with the buggy's contact state during integration if available. Audio assets and keyboard/gamepad mappings remain unchanged. The only change outside assigned audio/UI/asset/test files is an additive `Input.external` field and input merging, plus enforcing its existing `suspended` flag in `poll()`. There is no index.html change.

## Verification

From this worktree, run `npx tsc --noEmit`, `npx vitest run`, and start Vite with `npx vite --port 5187 --strictPort`. In another terminal run `node tests/audio/browser.mjs`. Stop Vite afterwards.

The browser smoke dynamically imports the initializer into the existing running scene, so it does not need a composition-root edit. It verifies name persistence, invite copying, suspended input, keyboard driving, gamepad and touch input composition, mouse fire, real multi-touch drive/fire, cancellation and blur cleanup, wings, brakes, audio unlock and decode, streamed track changes and old-deck shutdown, mute, and teardown. It also renders the real engine graph offline and checks for silence and clipping.

Generated screenshots, a JSON report and a six-second engine WAV are in `tests/audio/artifacts/` and excluded from commits. Desktop and phone screenshots are visually reviewed. The audio render measures headroom; it does not establish subjective listening quality. Physical-phone Safari playback and listening on speakers remain unverified.
