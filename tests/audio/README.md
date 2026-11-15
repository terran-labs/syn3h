Current wind choice: generated camera and weather wind only, per the owner on 15 November
2026. The recorded wind is no longer fetched or connected. Music, laser and materialize
recordings remain. The lifecycle check verifies those loading boundaries.

Current shell integration and browser checks are documented in [the UI handoff](../ui/README.md). The notes below describe the initial audio delivery.

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

`impact` expects speed lost in metres per second: contacts at or below 2 are silent, and 20 reaches full strength. Network contacts ring the local hull; landings use the terrain surface beneath the vehicle. A fixed-step detector also hears sudden velocity changes during grounded local driving, suppressing duplicate contact and landing sounds. Remote interpolation does not drive that detector. Zorb mode, pause and the lobby suppress impacts. All impacts are synthesized by `src/audio/Impacts.ts`. These three sounds are synthesised (`src/audio/Cues.ts`); `audio.play('materialize', position, { seconds })` stretches the building swoosh to a spawn hold. Spawn audio plays when Play unlocks audio. All audio mix parameters have client scope. The generated score is the only music, in the lobby and in play; there is no track choice. `audio.setMuted(boolean)` controls the master bus, `audio.outputLevel` reads the final mix in dBFS for checks, and `audio.errors` reports failures without stopping the game.

The engine bridge uses the player's speed and drive input. Airborne detection currently uses terrain clearance above two metres because the shared Vehicle interface has no wheel contacts. Replace that fallback with the buggy's contact state during integration if available. Audio assets and keyboard/gamepad mappings remain unchanged. The only change outside assigned audio/UI/asset/test files is an additive `Input.external` field and input merging, plus enforcing its existing `suspended` flag in `poll()`. There is no index.html change.

## Verification

No audio file ships (owner's rule, 15 November 2026). The generated score starts with the
first gesture, with tag notes, convoy, terrain and weather layers enabled by default; their
switches and the lighter instrument mode remain independent. A choice saved by an older
build under `syn3h.musicTrack` is removed on start. The lobby holds the score's quiet state
and is lifted 6 dB there. Wind uses the generated camera/weather voice only.

`tests/audio/generated-only.mjs` (game on `SYN3H_URL`) is the browser proof: zero audio-file
requests, audible lobby and play levels, the three synthesised sounds, cleanup, and stall
behaviour. `tools/check-shipped-assets.mjs` is the release check for shipped audio and
unrequired bitmaps; `tests/ops/shipped-assets.test.ts` covers it.

`tests/audio/score-game.mjs <origin>` checks these defaults, restored choices, switching,
mute and lighter mode in the real browser. Run all checks through `tools/heavy.sh`.

From this worktree, run `npx tsc --noEmit`, `npx vitest run`, and start Vite with `npx vite --port 5187 --strictPort`. In another terminal run `node tests/audio/browser.mjs`. Stop Vite afterwards.

The browser smoke dynamically imports the initializer into the existing running scene, so it does not need a composition-root edit. It verifies name persistence, invite copying, suspended input, keyboard driving, gamepad and touch input composition, mouse fire, real multi-touch drive/fire, cancellation and blur cleanup, wings, brakes, audio unlock and decode, streamed track changes and old-deck shutdown, mute, and teardown. It also renders the real engine graph offline and checks for silence and clipping.

Generated screenshots, a JSON report and a six-second engine WAV are in `tests/audio/artifacts/` and excluded from commits. Desktop and phone screenshots are visually reviewed. The audio render measures headroom; it does not establish subjective listening quality. Physical-phone Safari playback and listening on speakers remain unverified.

## Vehicle and world mix

The engine graphs are synthesised; `provenance.md` records where the audio comes
from. The tag beam, tagged, materialize and wind
sounds are synthesised too; no recording and no package audio ships.

- Syn3h buggy: a rising electric turbine tone over tyre roar, with a restrained
  high squeal as grounded wheels slip.
- Classic buggy: a lower, rougher harmonic motor with uneven rolling noise.
- Jet: a steady hover hum blends into filtered rushing air under flight throttle.
- Hovercraft: a pulsing fan drone gains a broad whoosh close to the ground.
- Tank: a low harmonic diesel pulse with faster track clatter as speed rises.
- Wings: a soft energy hum with rising deploy and falling retract sweeps.
- Landings: short low thumps scale with touchdown speed.
- Lava: low bubbling near liquid surfaces and optional vents; entry adds a
  falling splash tone and filtered sizzle.
- Wind: generated noise with a blended loop boundary, rises with
  speed, altitude and airborne state.
- Game: ascending capture, beating contested, descending lost, four-note win,
  short countdown ticks, tag chirp, join/leave tones and quiet panel clicks.

The shell wires the local vehicle and terrain automatically. A respawn caller
should use the existing initializer's `setPlayer(next)` to change both UI and audio.
Map dots lack input and wheel state. Supply live bot and remote Vehicle instances:

```ts
audio.setVehicles(() => [...bots.vehicles, ...remoteVehicles])
```

This getter is sampled five times per second. Return stable Vehicle objects, not
new wrappers on every call. Only the nearest four within 350 metres get positional
voices. Departing voices fade and disconnect. Camera orientation drives HRTF
panning; inverse rolloff reduces distant vehicles. There is one additional local
voice. `terrain.vents?.()` is optional and accepts `{ x, y, z }` entries; existing
liquid queries handle sea, caldera and rivers without it.

`audio.cue(name, position?)` accepts capture, contested, lost, win, tick, tag, join,
leave, click, deploy, retract and lava. Match transitions, countdown ticks and
networking status events are already wired in Shell. Do not also call these cues
from networking unless you remove the corresponding shell trigger.

Music defaults to 22%, engine to 24%, with separate master, effects, ground,
wind, world, remote and game/UI controls. All are client parameters. A fast 20:1
compressor and bounded output curve protect the master. Mute fades the shared
master to zero. No AudioContext or synthesis nodes are created until unlock.

`voices.mjs` renders nine-second WAVs for each family under `artifacts/`: two
seconds idle, two loaded/slipping, two flying, one idle, then a fade to silence.
It records peak, RMS, maximum sample step and final sample. These are unmastered
voice measurements, not a physical speaker listening assessment. Audition the
WAVs on the demo speakers before choosing room volume.

`lifecycle.mjs` runs five real minutes with replacement vehicles, a nearest-four
fleet, repeated game cues and mute changes. Chrome WebAudio node events and forced
collection check that the actual graph stays bounded; diagnostics check that all
voices and nodes are released on disposal. `cues-browser.mjs` checks transition
triggers, deduplication, sliders and the muted master gain. Both write JSON evidence.

`cue-render.mjs` writes `game-cues.wav`, with each named cue two seconds apart in
this order: capture, contested, lost, win, tick, tag, join, leave, click, deploy,
retract, lava. `vehicle-events.mjs` verifies a single deploy/retract, touchdown
and lava-entry trigger despite repeated frames.

Measured unmastered voice peaks: Syn3h buggy 0.272, classic buggy 0.366, jet 0.462,
hovercraft 0.457, tank 0.433. RMS spans 0.042 to 0.071. Each starts at zero and
ends at zero; the generated noise loop boundary changes by at most 0.0053 between
adjacent samples. The cue sampler peaks at 0.622. These figures check electrical
headroom and discontinuities; they do not certify perceived loudness or speaker tone.

The phone mix panel was reviewed at 390 by 844. All category sliders and mute are
reachable by scrolling. Speaker audition is still a separate acceptance check;
`artifacts/listen.html` provides local audio controls for the rendered WAVs.

Lifecycle evidence: `artifacts/final-lifecycle-note.md` records the final five-minute
run and a corrected Chrome destination-node spelling assertion. `teardown.json`
contains the subsequent cleanup check. The earlier retained-handle report is
preserved as `lifecycle-before-cleanup.json`. Touchdown events are sampled on fixed
physics steps so a low frame rate cannot hide the landing pulse.

Run `tools/heavy.sh node tests/audio/run-impacts-gate.mjs` to render the production impact paths and all nine voices, exercise the lab controls, and run the driving smoke test. The runner owns and closes a temporary dev server and room server.
