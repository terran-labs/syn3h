# Syn3h UI integration

The reconstruction and its historical limits are documented in
`docs/architecture/syn3h-ui.md`. The default lobby uses the verified Syn3h logo,
Lato Thin and Roboto Thin, a slow starfield and the recovered two-second depth/fade
screen transition. The empty historical idle clip is represented by a settled logo
glow, not an invented pulse. Space Station replaces the unlicensed-in-this-checkout
Kai Engel track; legacy music is optional. Title music fades over ten seconds when
entering the world and returns when opening the menu.

## Composition root

Keep the existing `initGameShell(game, player, terrain)` call and `shell.onPlay = join`.
After constructing the existing `ParamPanel`, add:

```ts
shell.setParamPanel(panel)
```

For automated startup, replace `if (query.has('autoplay')) join()` with:

```ts
if (query.has('autoplay')) shell.play()
```

The browser will still require a real user gesture for audible playback. Calling
`join()` alone leaves the start screen and suspended driving input in place.

The shell API now includes `vehicleKind`, `bodyColor`, `accentColor`, `openMenu()`,
`closeMenu()`, `showPanel(id)`, `activePanel`, `menuOpen` and `setParamPanel(panel)`.
It preserves `playerName`, `room`, `onPlay`, `play()`, `setStatus(lines)` and `setSpeed`.
Room and name lock on entering the world so editing the form cannot silently diverge
from the connected room. Selection defaults to the Syn3h buggy; Classic remains available.

The coordinator has wired saved kinds and colours into the vehicle factory and networking.
The chooser supports Syn3h Buggy, Classic, Hovercraft and Jet. `?vehicle=...` overrides
the spawned vehicle; help and touch controls follow the actual spawned kind.

Vehicle controls appear in the lobby and for 8.5 seconds on spawn, H or ?. Jet touch
controls add independent thrust up and down buttons; opposite holds cancel and releasing
one preserves the other. The vehicle GLB previews for Jet and Hovercraft show original
materials; the colour controls still save the colours applied by the actual vehicles.

The loading cover mounts during module evaluation, before engine initialization. It
listens for `syn3h:loading` with `{ phase, progress, elapsedMs }`, where progress is 0 to 1.
Missing progress displays an indeterminate bar. The Shell constructor ends startup
loading. `shell.setLoadingMessages(string[])` replaces the new browser-edition message list;
for messages before Shell exists, use `bootLoading?.setMessages(messages)` from
`./ui/LoadingScreen`. Synchronous terrain generation still blocks animation while it
runs; the UI cannot render intermediate progress until that code yields.

The minimap installs automatically from the existing initializer and tracks the local
player. For remote vehicles or bots, supply world coordinates and radians about +Y:

```ts
shell.setMapEntities([{ x, z, heading, color: '#49e6ff', self: false }])
```

Call this from the existing networking/scene update with the current entity list.
It copies supplied records and adds the local marker unless a supplied record has
`self: true`. Terrain pixels regenerate through `terrain.onRegenerate`; marker updates
are limited to ten per second. No external entity list has been wired here.

A reload-free respawn is deliberately left to the composition root. The UI now exposes:

```ts
const { shell, audio, setPlayer } = initGameShell(game, player, terrain)
// After the composition root has created the replacement vehicle:
setPlayer(nextPlayer)
```

This rebinds the audio bridge, local map marker and vehicle help. A safe pre-join
`respawn(kind)` also needs a mutable `player`, removal/disposal of the old player,
construction and colouring of the replacement, `camera.setVehicle(nextPlayer)`, and
recreation of BotManager because it and its brains retain the old player. Terrain
regeneration and debug HUD closures must refer to the mutable binding. Start networking
only after that swap. An in-session swap additionally needs networking support for its
bounds guard, tag marker, laser owner and replicated kind; changing only `ctx.player`
is insufficient. This branch leaves the coordinator's reload fallback intact.

`Shell` reads host state from `window.syn3hNet`, guards world edits at the event handler,
and disables advanced world bindings while locked. The bots control appears only when
`params.get('bots.count')` exists. No networking or parameter data format changed.
The host lock control changes server state only for a host. Score rows are parsed from
the existing text format; other lines remain text. Repeated status updates do not
repeat join/tag toasts.

## Validation

Run from this worktree:

```sh
npx tsc --noEmit
SYN3H_NO_ROOM_SERVER=1 npx vitest run
SYN3H_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://127.0.0.1:8797 npx vite --port 5187 --strictPort
```

Start an isolated room server with `PORT=8797 npx tsx server/dev.ts`, then run
`node tests/ui/browser.mjs`. The skip flag prevents the Vite plugin from trying
to start a second room server on the shared host. The browser uses an isolated room
per run against that isolated development room server. Stop both processes
when done. `node tests/audio/browser.mjs` forwards to this current shell smoke test.

The smoke captures every panel at desktop and 390 by 844 phone sizes, both vehicle
skins, host and guest lock states, the HUD and the in-game menu. It exercises saved
choices, live preview colours, music/mute/volume, seed regeneration, sky controls,
late-registered bots, score styling, invitation copying, Escape, multi-touch and
input suspension. Generated evidence lives under `tests/ui/artifacts/` and is ignored
by git. Historical reference screenshots are still needed for an exact visual match;
physical Safari playback and hardware listening are not established by headless Chrome.

The additional `node tests/ui/flight-loading-map.mjs` check holds GPU startup to
capture both loading states, dispatches progress events, checks H and ? help, verifies
terrain map regeneration and exercises simultaneous jet banking and both thrust buttons.
Its screenshots include desktop and phone loading covers and jet HUD layouts.

## Names, sharing and hill mode

Recovery paths and the historical search are in `name-recovery.md`. The replacement
vocabulary and 40 short loading messages are new writing, not recovered text.
Names are deterministic for a seed and kind. They are display labels, not unique IDs.
Use a stable bot identity shared by clients, rather than a client's array position:

```ts
import { generateName } from './ui/data/names' // main.ts; use ../ui/data/names from bots
bot.name = generateName(`${worldSeed.value}:${botId}`, 'bot')
const worldName = generateName(worldSeed.value, 'world')
```

The lobby installs a generated player name when no saved name exists and persists its
random seed locally. Existing saved names win. LoadingScreen uses the new data file
with the recovered five-second rotation; `shell.setLoadingMessages` still overrides it.

The match display accepts authoritative state independently of `setStatus(lines)`:

```ts
shell.setMatchState({
  mode: 'koth', // 'tag' hides the hill presentation; null clears it too
  holderName: 'Nolitek', // string | null
  holderIsYou: false,
  contested: false,
  scores: [{ name: 'Nolitek', score: 24, you: false }],
  target: 60,
  winner: null, // winning display name; clear on a new round
})
```

`score` and `target` are seconds held. The UI derives time remaining, never runs match
logic or advances scores itself. It shows the top three and your row if outside those
three. Capture, contest and win announcements trigger on state transitions, not every
snapshot. Send the new round's cleared state before scores begin again. Names are
inserted as text. `MatchState` is exported from `src/ui/MatchHud.ts`.

The Multiplayer panel discovers `game.mode` at runtime. Until registered it hides the
selector. The UI encoding is numeric `0 = Tag`, `1 = King of the Hill`, matching
the current numeric parameter registry. Changes honor `canEditWorld` and host locks.
The mode builder must register and sync that parameter; this UI does not create it.

`index.html` includes metadata and points to `/brand/share.png` (1200 by 630), favicon,
touch icons and `/brand/manifest.webmanifest`. No public deployment origin was supplied,
so share image paths are root-relative. Before public announcement, replace both image
meta values with the deployed absolute HTTPS URL and add `og:url` for that origin.
Do this in served HTML, not a JavaScript update, because card crawlers may not run JS.
No preview hostname is hardcoded. The manifest does not claim offline support.

`tests/ui/share-assets.mjs` reproduces the starfield artwork and icons with the supplied
logo in a browser canvas. Credits use installed Three.js, Rapier, Marked and ws licence
files. Tweakpane's distributed header states MIT and its full notice is from
https://github.com/cocopon/tweakpane/blob/main/LICENSE.txt. Lato and Roboto attribution
was read directly from the shipped fonts' name tables. OFL copies came from
https://github.com/google/fonts/blob/main/ofl/lato/OFL.txt and
https://github.com/google/fonts/blob/main/ofl/barlow/OFL.txt. The About panel links the
local notices; audio provenance remains in `public/audio/README.md`.

Run `node tests/ui/fans-hill.mjs` for generated and saved names, loading rotation,
metadata/assets, credits, late mode registration, host lock and all four hill states
at desktop and 390 by 844 phone sizes. Screenshots and its JSON report are under
`tests/ui/artifacts/`.

## Game jam presentation

After `shell.setTerrain(terrain)`, wire the cinematic camera and bot list:

```ts
shell.setAttractCamera(camera, () => bots.vehicles)
```

The shell also discovers the existing `window.syn3h` camera as a fallback. Attract
mode starts after 20 seconds without lobby input, or immediately with `?attract=1`.
It alternates volcano, road and bot shots. The first key or touch restores the
lobby without activating its underlying controls. Camera parameters stay intact.

J toggles the full-screen invite. The invite contains only the current origin and
`?room=NAME`, so autoplay and attract flags do not travel with it. The Multiplayer
panel and menu include the same QR and copy action. `shell.setPlayerCount(count)`
can provide an explicit human count; otherwise `setStatus` reads the networking
player map and excludes bots. P toggles presentation sizing; Settings has the same
control. Developer status lines remain available outside presentation mode.

The match API now accepts optional `winnerColor: string` (a CSS colour) and
`nextRoundIn: number` (remaining seconds from the server). A newly reported winner
gets a six-second countdown when no authoritative countdown is supplied. Repeated
identical snapshots do not restart it. At zero the banner waits for the server to
clear the winner; the UI never starts rounds itself.

The QR encoder uses UTF-8 byte mode, error correction M and versions 1 through 10.
It supports 213 bytes; longer invites retain the copyable link and explain the QR
limit. The 88 fixed matrix hashes in `qr-vectors.json` cover every mask and every
supported version, generated with Nayuki's independent Python reference using
`QrSegment.make_bytes`, `QrCode.Ecc.MEDIUM`, forced masks and `boostecl=False`.
The MIT notice is shipped under `public/brand/licenses/qr.txt`.

`node tests/ui/projector.mjs` checks desktop and 320 by 844 touch flows, all three
camera shots, idle wakeup, long names, 16 score rows, invite clipboard contents,
presentation mode and the round countdown. It writes screenshots and a JSON report
to `tests/ui/artifacts/`. On macOS, independently decode the rendered screenshot:

```sh
swift tests/ui/decode-qr.swift tests/ui/artifacts/projector-qr.png
swift tests/ui/decode-qr.swift tests/ui/artifacts/narrow-qr.png
```

## First impression

The first five seconds after Play are checked by `node tests/ui/first-impression.mjs <label>`
against the lane dev server. It asserts, at 1280 by 720, 1920 by 1080 and a 390 by 844
touch screen, that the controls card shows, never overlaps the vehicle in the chase camera,
leaves on first input (or after five seconds), and that H reopens and closes the full list.
It then photographs pad 0 and the summit rim at the hours given, for choosing lighting.
`--az=335` tries a sun azimuth; `--record` captures a build that fails the assertions.

Defaults chosen with it: 16:30 with the sun azimuth at 335 degrees, clock paused. From pad
0 the sun is low on the right and slightly behind the camera, so the near flank is lit from
the side and the glare is out of frame. At azimuth 20 the same hour left that face in
shadow under a white sky. The 'Mars day' preset uses the same hour.

A room's shared sliders belong to whoever is in it. A fresh room takes the first player's
values; a room that already has someone in it hands its own values to everyone who joins.
The dev room server forgets a room only when its last connection closes, so one forgotten
tab holding `lobby` at night makes every later visitor start at night whatever the defaults
say. New defaults reach a room only once it has emptied or its host moves the slider.

The short card is `quickHelp` in `VehicleHelp.ts`. `shell.showHelp()` still opens the full
list; `shell.showHelp(false)` is the short card used after Play and after a vehicle change.

