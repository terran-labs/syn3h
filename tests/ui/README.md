# Mira UI integration

The default lobby uses the Mira logo, Lato Thin and Roboto Thin, a slow starfield
and a two-second depth/fade screen transition. At idle the logo glow is settled, with
no pulse. Title music fades over ten seconds when
entering the world and returns when opening the menu.

## Composition root

Keep the existing `initGameShell(game, player, terrain)` call and `shell.onPlay = join`.
After constructing the existing `ParamPanel`, add:

```ts
shell.setParamPanel(panel)
```

For automated startup, replace `if (query.has('autoplay')) join()` with:

```ts
if (query.has('autoplay')) shell.play(false, true)
```

The browser will still require a real user gesture for audible playback. Calling
`join()` alone leaves the start screen and suspended driving input in place.

The shell API now includes `vehicleKind`, `bodyColor`, `accentColor`, `openMenu()`,
`closeMenu()`, `showPanel(id)`, `activePanel`, `menuOpen` and `setParamPanel(panel)`.
It preserves `playerName`, `room`, `onPlay`, `play()`, `setStatus(lines)` and `setSpeed`.
Room and name lock on entering the world so editing the form cannot silently diverge
from the connected room. Selection defaults to the Mira buggy; Classic remains available.

The coordinator has wired saved kinds and colours into the vehicle factory and networking.
The chooser supports Mira Buggy, Classic, Hovercraft and Jet. `?vehicle=...` overrides
the spawned vehicle; help and touch controls follow the actual spawned kind.

Vehicle controls appear in the lobby and for 8.5 seconds on spawn, H or ?. Jet touch
controls add independent thrust up and down buttons; opposite holds cancel and releasing
one preserves the other. The vehicle GLB previews for Jet and Hovercraft show their own
materials; the colour controls still save the colours applied by the actual vehicles.

The loading cover mounts during module evaluation, before engine initialization. It
listens for `mira:loading` with `{ phase, progress, elapsedMs }`, where progress is 0 to 1.
The Shell constructor ends startup
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

`Shell` reads host state from `window.miraNet`, guards world edits at the event handler,
and disables advanced world bindings while locked. The bots control appears only when
`params.get('bots.count')` exists. No networking or parameter data format changed.
The host lock control changes server state only for a host. Score rows are parsed from
the existing text format; other lines remain text. Repeated status updates do not
repeat join/tag toasts.

## Validation

Run from this worktree:

```sh
npx tsc --noEmit
MIRA_NO_ROOM_SERVER=1 npx vitest run
MIRA_NO_ROOM_SERVER=1 VITE_SERVER_URL=ws://127.0.0.1:8797 npx vite --port 5187 --strictPort
```

Start an isolated room server with `PORT=8797 npx tsx server/dev.ts` before running a
browser check against it. The skip flag prevents the Vite plugin from trying to start a
second room server on the shared host. Stop both processes when done. (The old shell smoke,
`browser.mjs`, was removed on 16 November 2026: it drove lobby panels that no longer exist.)

The smoke captures every panel at desktop and 390 by 844 phone sizes, both vehicle
skins, host and guest lock states, the HUD and the in-game menu. It exercises saved
choices, live preview colours, music/mute/volume, seed regeneration, sky controls,
late-registered bots, score styling, invitation copying, Escape, multi-touch and
input suspension. Generated evidence lives under `tests/ui/artifacts/` and is ignored
by git. Physical Safari playback and hardware listening are not established by headless Chrome.

## Names, sharing and hill mode

The name vocabulary and the loading lines are newly written; see
`name-recovery.md`.
Names are deterministic for a seed and kind. They are display labels, not unique IDs.
Use a stable bot identity shared by clients, rather than a client's array position:

```ts
import { generateName } from './ui/data/names' // main.ts; use ../ui/data/names from bots
bot.name = generateName(`${worldSeed.value}:${botId}`, 'bot')
const worldName = generateName(worldSeed.value, 'world')
```

The lobby installs a generated player name when no saved name exists and persists its
random seed locally. Existing saved names win. LoadingScreen rotates the loading lines
from `src/ui/data/loadingMessages.ts`; `shell.setLoadingMessages` still overrides them.

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

`index.html` includes metadata and points to `/brand/mira-share.png` (1200 by 630), favicon,
touch icons and `/brand/mira-manifest.webmanifest`, all on https://mira.cc. The files at the
old names (`share.png`, `favicon.svg`, `manifest.webmanifest` and the icons) keep the
Syn3h bytes that frozen versions load from the same address.
Do this in served HTML, not a JavaScript update, because card crawlers may not run JS.
The share card tags name the public release address, https://syn3h.af-4e7.workers.dev, because
crawlers need full addresses; `tests/ui/share.test.ts` keeps them on one https origin. Change
all three if the address changes. The manifest does not claim offline support.

`tests/ui/share-assets.mjs` reproduces the starfield artwork and icons with the supplied
logo in a browser canvas. Credits use installed Three.js, Rapier, Marked and ws licence
files. Tweakpane's distributed header states MIT and its full notice is from
https://github.com/cocopon/tweakpane/blob/main/LICENSE.txt. Lato and Roboto attribution
was read directly from the shipped fonts' name tables. OFL copies came from
https://github.com/google/fonts/blob/main/ofl/lato/OFL.txt and
https://github.com/google/fonts/blob/main/ofl/barlow/OFL.txt. The About panel links the
local notices; audio provenance remains in `public/audio/README.md`.

## Game jam presentation

After `shell.setTerrain(terrain)`, wire the cinematic camera and bot list:

```ts
shell.setAttractCamera(camera, () => bots.vehicles)
```

The shell also discovers the existing `window.mira` camera as a fallback. Attract
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

`node tests/ui/projector.mjs` checks desktop and 320 by 844 touch flows: long names, 16 score rows, invite clipboard contents,
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

## Phones

There are two phone layouts, chosen by shape and pointer and not by width alone: portrait
(any screen up to 700 px wide) and landscape (a touch screen under 500 px tall). A phone on
its side is 844 px wide, so the old width-only breakpoint gave it the desktop layout.

- Portrait: speed top left, menu row and minimap top right over sky, messages under the
  HUD, the controls line above the thumb stick.
- Landscape: HUD top left above the stick, minimap top right above the action buttons,
  messages along the bottom between the thumbs.
- King of the Hill on either: one strip (holder, time to win, top three and you) replaces
  both the score rows and the large hill card. The Players button still lists everyone.
- The Menu button shows only its icon on phones. Below 350 px the Create shortcut is
  dropped; it is still in the menu.

`tools/heavy.sh node tests/ui/phone-layout.mjs <label>` walks the lobby, vehicle panel,
buggy and jet in game, hill held, contested and won, the join QR view and the menu at
390 by 844 and 844 by 390 with touch. In every in-game state it measures the stick, each
action button, minimap, HUD, strip, menu row, controls card, toast, announcement and the
vehicle's place on screen, and fails if any two overlap. Match states are fixtures, so it
needs only the lane dev server.

## Art direction: Dark Star

On 14 November 2026 the owner chose the Dark Star theme of the new terranlabs.com for
Mira. Source: /Users/vtn/dev/terranlabs.com at 68c1e06.

- Colours and type: Dark Star's tokens (`--s3-*` and the few `--theme-*` names that site's
  CSS reads) and its two families, Barlow and Barlow Condensed, served from `public/fonts`
  under the SIL Open Font License.
- Buttons: that site's glass button, `.liquid-glass`, copied verbatim into `shell.css`
  between two marker comments, with its pointer-facing rim (`Shell.glass`, a port of
  GlassShine.tsx). `Shell.glass` gives every button the class; the quiet text links are
  not glass. `.is-primary` is the accent-filled variant. Frost is dropped on the in-play
  menu row and thumb buttons and at graphics level 0, because it re-blurs the moving world
  every frame.
- Sky: the galaxy (see "The galaxy lobby") carries that site's sun, shafts, lens streak,
  ghosts and stars, from PlanetGL.tsx. The earlier `Starfield.ts` background went with the
  panel lobby on 14 November.
- Panel: a sheet of frosted glass with Dark Star's 18 px radius and hairline border.
- Loading: that site's veil, see "The loading veil".
- Logo: still the Mira wordmark as one vector path, lit in Dark Star's blue.

The owner's reference captures stay in the git-ignored `tests/ui/artifacts/reference/`. (The
script that captured the old panel lobby beside them, lobby-reference.mjs, went with that lobby.)

## Wording

No player-visible text may speak of death, violence or weapons (owner's rule, 14 November
2026). Lava is sticky and makes things glow; vehicles are indestructible; the beam game is
"tag beams" and its verb is "tag". `tests/ui/wording.test.ts` scans every readable string,
HTML text node and label attribute in `src/ui` and `src/audio`, 4500 generated names, the
loading messages, `index.html` and the manifest, and fails on a banned word. Identifiers,
file names, parameter ids and protocol markers are unchanged: the touch button's action is
still `fire` and the clips are still `LaserShot.mp3`, but the button reads TAG.

Going into lava plays a low gulp with one rising bubble; going into water plays a splash.
Settings has "Reset world to defaults": the first press asks, a second within four seconds
does it, for everyone in the room when connected.

## Planets

Worlds are chosen in the galaxy: one world per recipe in `src/world/planets.ts` plus
Custom. The planet cards went on 14 November by the owner's choice; the Worlds panel keeps
the world's name and story, its seed and the bots.

- Picking another kind calls `applyPlanet(id)`, so the shared sliders carry it to the room.
  The kind in play is not re-rolled. Arriving at a world leads to the name form.
- Custom opens the Advanced panel limited to World, Sky, Sun, Weather, Terrain and Lava.
- The label of the world in play shows `planetName(seed)`. Invite links and QR codes carry
  `world=<encodeWorld()>` as well as the room.
- When the host has locked the world, or a guest came by an invite naming one, the other
  labels dim and arriving at another world is refused, with a notice.


## Phones: a guest's first run, and the lowest graphics level

The audience arrives by QR code on phones, so `phone-layout.mjs` also plays that arrival at
390 by 844 and 844 by 390 with touch and the CPU throttled four times: open
`?room=...&world=alpine.90210`, look round the lobby, enter the world, drive. It fails if
the guest lands on any other world, is offered another before joining, waits more than a
second for a tap to be answered while the planets are painted, sees the galaxy fall
under eight frames a second, finds a panel or the QR code wider or taller than the
screen, or if the lobby keeps a graphics context once the game is on screen.

What makes that hold:

- Planet maps are painted in a worker (`planets/planetMapWorker.ts`), one at a time.
- Play releases the galaxy's context and worker at once; the menu makes new ones. iOS
  allows only a few live WebGL contexts.
- The galaxy does not draw in a hidden tab.
- At `gfx.level` 0 the galaxy is held still: the worlds stop in their orbits and a frame
  is drawn only while something moves (a drag, a flight, the dive).
- A guest who arrives by a link that names a world sees that world only, with the other
  kinds, Custom and the seed controls disabled, until they are in the room. There the
  host's lock decides.
- On a short, wide screen the QR view puts the code on the left at full height.

Measured on this Mac in headless Chrome at four times throttle: lobby usable in about one
second, taps answered in 0.3 to 0.65 seconds, starfield 11 to 13 frames a second with the
game rendering underneath (with the old starfield lobby). Those are emulation figures, not
a phone's. With the galaxy and its nine planets, at a load average of 5 to 8 (15
November, 12am): lobby usable in 1.7 to 1.9 s, taps answered in 0.3 to 0.6 s, the galaxy
at 10 frames a second on the open lobby. Its frame rate is measured on the galaxy itself,
since behind a panel it stops on purpose.


## Hints for a player who seems stuck

`PlayHints.ts` watches the player's vehicle and returns one line when they appear stuck;
the shell shows it in the controls card with a lit edge, and on touch the button it names
pulses. It has no DOM in it, so `tests/ui/hints.test.ts` covers the rules directly.

The jet: throttle is R and F (`src/core/Input.ts`); W only tips the nose and does nothing
on the ground. Every jet controls text leads with "Hold R to lift off" (touch: "Hold THR +
to lift off"). After two seconds of pushing W or the stick on a parked jet with no
throttle, the hint says so again, at most three times, twelve seconds apart, and never
once the throttle has been used. `tools/heavy.sh node tests/ui/jet-hint.mjs` plays it on a
desktop and a landscape phone and checks that following the hint lifts the jet.

## The loading veil

The loading screen is the one from terranlabs.com, brought over verbatim at the owner's
request: a dark world seen edge on, light travelling round its limb behind a small sun as
things arrive, a moon in a slow outer orbit. Its markup, styles and the script that eases
`--boot-progress` are in `index.html`, not the bundle, so it is up from the first paint.
The source is that site's `BootGate.tsx`, `lib/boot.ts`, the `.boot-*` rules in
`src/index.css` and the bootstrap script in its layout. It reads three variables,
`--theme-bg-root`, `--theme-text-primary` and `--theme-heading-accent`, set to Mira's
space colour, ink and blue.

`LoadingScreen.ts` is Mira's version of that site's BootGate: the bundle arriving takes
the light to 45 percent, the game's loading phases take it to 92, and when the world is
ready the lap completes and the veil lifts. Differences from the original, all for a game
that takes longer to start than a web page: the veil may stay up to 45 seconds (not 8),
the no-script failsafe waits 60 (not 12), the lap is completed at the moment of lifting
because a busy phone draws too few frames for the easing to get there, and the veil lifts
at once on a script error, a rejected promise or the page's failure message.

The veil's status line shows dry loading lines, rotated by index.html from the first
paint and then by LoadingScreen, which prefers a pool for the current phase when a phase
lasts long enough to show one. That line is aria-hidden; screen readers hear the plain
phase once per phase from the `.mira-loading` live region.
`tools/heavy.sh node tests/ui/boot-veil.mjs` checks the veil from first paint to lift, and
that a startup failure is never hidden behind it. `tests/ui/loading-lines.mjs <url>` checks
the rotation over a slow link and the longest line at 320 px.

## Touch tablets

An iPad on its side (1194 by 834) has the thumb controls on a desktop-sized screen. There
the minimap sits top right under the menu, clear of the action buttons, and announcements
sit between the hill panel and the vehicle. `phone-layout.mjs` now walks the same layout
states on an "iPad Pro 11 landscape" in WebKit (build 2388), where the game takes its
WebGL path.

The same hints carry the wings: while a buggy sits in lava or water with its wings closed
(`Vehicle.canLiftOut`), the card says "Space: wings to lift out", or "WINGS: lift out" on
touch with that button pulsing; again every nine seconds, five times at most. Zorb mode
(X) has a ZORB thumb button that calls `input.toggleZorb()` and a line in every controls
text. `jet-hint.mjs` checks the wings hint in the volcano's lava lake and the ZORB button.

## The galaxy lobby

The lobby is a place: in place of the index panel the worlds orbit a sun in 3D
(`galaxy/Galaxy.ts`). Drag empty space to swing the view, pinch or scroll to move in and
out, tap a world or its label to fly to it. Arriving makes it the world (through
`pickPlanet`, so the host lock and the invited-guest rule hold) and opens the name form;
Back returns to the whole system. Every other panel opens over it as glass. The owner
asked for this to replace the panel lobby on 14 November 2026.

- One fragment shader traces the sun and the spheres: no meshes, libraries or
  images. Each world is lit from where the sun is, wears its real map from
  `paintPlanetMap`, shows settlement lights on its night side, and cuts a shadow through
  the sun's shafts. The sun, shafts, flare and stars are terranlabs.com's.
- Many worlds: every planet recipe appears, up to `GALAXY_MAX` (12) bodies with Custom. Up
  to four orbits at the original spacing; more worlds share them, spread evenly round each,
  so ten keep the size four had. Each world wears a small map (512 by 256, about 40 ms to
  paint on this Mac) from one texture array; the world being flown to is repainted at
  1024 by 512 (about 130 ms) for the close view and the dive. Held upright, a phone looks
  down more steeply so the orbits use its height.
- Labels (`galaxy/labels.ts`) try under, over, right and left of their world and take the
  first spot clear of other labels, other worlds, the wordmark and the links; the world in
  play is placed first and always named. One with no room fades (its world still answers a
  tap); labels of worlds off the screen are not pinned to its edge; while flying to a world
  only its label stays.
- The custom planet is a world still forming: plates of crust drifting on magma. Arriving
  at it opens the sliders that shape a world.
- Flying to a world, the camera swings to its sunlit side a little off the sun, and the
  world turns on its axis to bring its island (map longitude 0, latitude 0, where the game
  spawns) to face the camera, so the dive falls onto the island. Behind an open panel the
  galaxy dims (35 percent, 70 behind the name form) and stops drawing: WebKit's frost is
  weak, and nothing behind glass needs to move.
- A tap on a world is the drop (the owner's instruction, 15 November): no name form, no
  panel, one motion from the solar system into the follow camera. The galaxy flies a timed
  path (not per-frame easing, so a slow frame cannot make it lurch) across the system, round
  to the lit side and down into the air, drawing every frame with a radial motion blur pass
  in proportion to how fast the view is closing. Under the light the world is built and the
  room joined, where a hitch cannot be seen; the game appears through the rushing light,
  its camera falling from 520 m with the field of view easing to the follow camera's, and
  `ChaseCamera.clearCinematicPose(0.8)` blends into the follow camera. Custom still flies
  to its world and opens its sliders. `drop.mjs` records every frame gap from tap to ground.
- The descent holds in the light until the room has answered (up to 5 s), since a slow
  join can rebuild the world and move the spawn point; the camera path is taken after
  that. A returning player (`localStorage` `mira.descents`) gets a quicker dive and a
  1.4 s fall; a tap, click or key during the descent lands at once.
- The descent: Enter World from the name form dives toward the chosen world until its air
  fills the view, then the game's camera comes down from 520 m above the spawn point to its
  place behind the vehicle while the blur clears (`Shell.descent`, using the camera's
  cinematic pose hook). The room is joined at the start of the fall. Called from code, with
  `?autoplay=1`, or with reduced motion asked for, entry is immediate.
- Grade, in the same shader: highlights rolled off, a vignette, fine film grain, and for
  the dive, streaks rushing outward and the brightness of air.
- The quality ladder (`quality/ladder.ts`, terranlabs.com's, logic unchanged) watches frame
  gaps and sheds, in order: twinkle and drifting cloud; flare, ghosts, grain, the worlds'
  shadows and frost on glass; noise octaves and night lights; then render scale 0.86, 0.73,
  0.6. It has no imports, so the game's renderer can call it and share the one state.
- There is no other lobby (the owner's choice, 14 November). At `gfx.level` 0, and with
  reduced motion, the galaxy is held still and draws only while something moves. Without
  WebGL 2 the index says the browser cannot run Mira; the game cannot draw there either.
  If WebGL 2 exists but the galaxy's shader will not start, its world names stay as a row
  of buttons (`.galaxy-flat`) so a visitor can still choose and play.

Known gaps: no keyboard way to swing the view (the labels and links are all reachable by
keyboard); frame cost unmeasured on real devices; the game measures its own frame rate
while the lobby is on screen, so a slow lobby can lower `gfx.level` before play starts.
`tools/heavy.sh node tests/ui/galaxy.mjs` checks the galaxy, the custom world and the
descent on desktop and phone, the still mode, the row of names and the missing-WebGL 2
notice; `galaxy-crowd.mjs` rehearses ten
worlds (`?worlds=10`, development builds only) at desktop, phone portrait and landscape and
in WebKit at iPad size. All take `MIRA_URL`. Its GPU timings on this Mac (median ms per
frame, four worlds then ten): desktop 2.7 and 3.0, portrait 1.9 and 2.6, landscape 1.9 and
2.0; labels shown with ten worlds: 10, 6 and 7. Comparisons, not a phone's figures.

## The page never zooms

The owner's iPad occasionally zoomed the page, which puts the controls out of reach. Every
route is closed, all in `index.html` so it holds before any script loads:

- the viewport says `minimum-scale=1, maximum-scale=1, user-scalable=no`;
- `html { touch-action: manipulation }` removes double-tap zoom;
- Safari ignores the viewport for pinches, so its `gesturestart`, `gesturechange` and
  `gestureend` events, any two-finger `touchmove` and `dblclick` are cancelled;
- on touch screens every `input`, `select` and `textarea` is at least 16px, because Safari
  zooms in when a smaller field is focused (the Advanced sliders' number fields were);
- if the page is found scaled anyway, the viewport is restated once nothing is being typed,
  which makes Safari reset its scale.

The galaxy's own pinch uses pointer events on its canvas and is unaffected.
`tools/heavy.sh node tests/ui/no-zoom.mjs` checks this in WebKit at iPad and iPhone sizes.
It cannot pinch a real screen. Zoom is an accessibility aid, so this is a deliberate trade
for a game whose controls are fixed to the screen edges.

The Vehicle panel carries the paint sliders (`paint.*`, client scope) built from the
registry, with a link to all sliders for vehicle shading.

## Cursor capture

On a desktop the first click in play captures the cursor (pointer lock) and sends no beam.
From then on moving the mouse swings the camera round the vehicle (`ChaseCamera` already
reads a locked pointer), a click sends a tag beam, and right-click still switches cockpit
and chase. Escape releases the cursor, which the browser does itself, so the first Escape
releases and the next opens the menu; opening the menu any other way releases it too.
Touch devices never capture. `tools/heavy.sh node tests/ui/cursor.mjs` checks all of it.
Aiming a beam where the camera looks is the Weapons lane's.

## World inspector and focus display

`src/ui/inspector/`: the Create button opens five frosted cards (World, Sky & weather, Game,
Vehicles, You). Each card is an accordion of groups; every registered property is a row with
its guardrails and a detail pane. Copy world and Paste world move the shared values as JSON
(`{ "mira": "world", "version": 1, "values": { id: value } }`); pasted numbers are clamped
to their limits and personal settings are left out unless the You section is pasted.

While the cursor is captured the cards, HUD and minimap fade out and the focus display fades
in. Three settings in You, Interface choose the look: Focus display (Arc, Horizon,
Telemetry), Reticle (Dot, Ring, Bracket) and Glass (Clear, Frosted, Deep).

On touch the cards start closed, and while open the minimap and drive controls step aside.

Checks (dev servers on 5187 and 8797):

- `npx vitest run tests/ui/inspector.test.ts`: tree, limits, JSON round trip, clamping.
- `node tests/ui/inspector.mjs`: Chrome; the pointer lock fade, the three focus looks and
  suspended input hiding the focus display. Screenshots in `artifacts/inspector/`.

Known limits: about 35 of the 218 properties have a written description, the rest show
their limits only; switching vehicle reloads the page and respawns you.

## Gear chip and Bungee controls

While the host allows more than one kind of gear, a chip under the speed reads
"Gear: Tag beam" or "Gear: Bungee"; tapping it or pressing T switches. The help card gains
the gear lines. On touch, LET OUT (holds V) and LET GO show only while a cord is attached.
Cues `bungeeLaunch`, `bungeeAttach` and `bungeeRelease` exist in `src/audio/Cues.ts`; the
Bungee's `cue` hook in `src/net/index.ts` calls `audio.cue(name, at)`.

The chip has since given way to the gear drum in the HUD's left column. Check:
`MIRA_URL=<game> node tests/ui/gear-wired.mjs` (the drum and the Zorb row, desktop and both
phone orientations) and `node tests/ui/hud-column.mjs` (the column's layout and accessories).

## November 15 UX follow-up

The inspector uses a cooler tint and less saturation over warm skies. Safari's dark backing
and the safe graphics fallback now outrank all three glass weights. `node tests/ui/glass.mjs`
checks those styles in Chrome and WebKit without loading a world.

The existing center dot remains available for all gear. Suspended input hides the focus
display even if pointer capture remains active; `inspector.mjs` checks that transition.
Brand export commands, output sizes and failure behavior are in `tools/brand/README.md`.

`galaxy-controls.mjs` checks arrow-key rotation, plus/minus zoom, standard gamepad
stick movement, D-pad world selection and A-button entry. It also verifies that an
open panel blocks these controls. The gamepad is simulated through `getGamepads`;
physical controller mapping still needs a device check. Tab and Enter use the world's
normal button focus and activation.

## Custom planet preview

Choosing Custom starts a live map of the current sanitized world settings. Slider changes
queue a repaint after 120 ms without changes. The worker receives the snapshot, its values
form part of the cache identity, and obsolete responses are discarded. The last uploaded
map remains visible until its replacement arrives. Leaving and reopening the galaxy keeps
the latest snapshot.

`customMap.test.ts` checks unchanged recipe behavior, zero overrides, recipe immutability,
sanitized terrain settings, cache refresh and stale responses. `custom-planet.mjs` checks
Custom entry and updated map uploads in Chrome and WebKit.

The map is an approximation of the island on a globe, not an exact view of the whole
wrapping world. Existing painter limits include shoreline shading based on absolute
height rather than height above sea level, and a snow threshold that differs from the
terrain renderer. Terrain owns those corrections; this change only supplies live settings.

## Animated lobby logo

Ordinary lobby entry uses the existing LogoRenderer inside Galaxy's WebGL2 context.
It shares the galaxy clock and render scale, uses the existing particle budgets, and
settles immediately for reduced motion, the safe tier or an open panel. The SVG retains
its layout and accessible name, and becomes visible if the renderer fails or the context
is lost. Leaving the lobby disposes the logo's GL resources; context restoration rebuilds
the renderer. No branding assets or logo design changed.

`lobby-logo.mjs` checks shared context identity, animation, panel settling, reduced motion,
safe particle count, context restoration, teardown and reopening in Chrome and WebKit.
The galaxy caps its shared loop at 30 fps outside a drop, below the logo's desktop ceiling.

## Exploration interface

The in-game right-edge Interface tab opens the configuration rail. Exit world at its top
returns to the solar system; Escape opens or closes the rail without returning to the lobby.
Players, music, gear and the optional connection diagnostics live under Players & session.
The old upper-left HUD is hidden. Speed and ground clearance use the exploration readouts;
the minimap stays centred on the player at bottom left, with a generated radial vignette.
On phones it sits above the driving thumb control.

Section headers remain in view while expanded bodies share the available height and scroll
internally. Desktop descriptions float to the left of the control. Narrow phones put the
same tooltip above the control; tapping the tooltip or elsewhere dismisses it. Touch editing
hides driving overlays and transient toasts so they cannot obscure the rail.

`tests/ui/exploration.mjs` checks desktop Chrome and iPad, phone and landscape WebKit. It
covers header visibility, internal body space, tooltip placement, optional diagnostics,
Escape behavior and Exit world. `UX_VIEW=desktop|ipad|phone|landscape` selects one viewport.
Run through the currently approved absolute heavy-job wrapper. Lobby drop, Custom planet,
animated logo and cursor checks remain part of the regression gate after integration.

## Recipe population lights

The lobby polls the public aggregate `/presence` feed every 30 seconds while visible,
with one request in flight and a ten-second request timeout. It stops on tab hiding,
play, descent, the join overlay and attract mode. Counts expire 90 seconds after the
oldest report, independently of the polling schedule. Failed, invalid or stale data
shows “Population unknown”; a fresh empty response means zero connected players.

Lights represent connected humans across rooms using a recipe, including spectators.
They do not represent bots or joinable room identities. At most twelve lights are drawn
per planet; the label gives the exact “N connected across M rooms” total. Custom has no
population of its own. Planet taps retain the existing room and direct descent.

`presence.test.ts` covers payload validation, report freshness, cancellation and polling.
`presence.mjs` supplies controlled public responses to check labels, display state,
play/reopen behavior and unchanged room routing. It does not validate the server endpoint.

`presence-live.mjs` starts an isolated, temporary Vite proxy and room server, connects
humans in two separate Alpine rooms, and checks normal-entry counts in Chrome and WebKit.
It uses the real same-origin endpoint and saves captures under `artifacts/presence`.
Run every browser check through the absolute trunk heavy-job helper.

## Saved-world moons

Save current world in the World card stores a complete world snapshot on this device.
Guests may save while editing is locked. The Worlds panel lists local saves with separate
Delete buttons; deletion changes neither the running world nor its room. Twelve saves
are allowed, with no silent eviction. Identical snapshots reuse the existing bookmark;
the same seed with different settings creates another bookmark.

Generated moons follow their recipe planets, with 44-pixel button targets. Crowded moons
remain reachable through the Worlds list. A moon or list entry drops directly, preserving
room selection and checking permission against all saved settings, including the seed.
An existing room can replace local settings on welcome; a message reports that outcome.
Worlds are snapshots of settings, not room invitations or guaranteed terrain across game
updates. Removed settings are ignored with a notice; new settings use current defaults.

The saved flight temporarily borrows its recipe planet slot. Its descriptor is restored
and obsolete map results rejected on success or failure. Custom's descriptor and retained
maps are preserved; its live snapshot updates resume when the Custom editor is reopened.
No extra GPU context, texture assets, protocol changes or shared parameter edits are used.

`savedWorlds.test.ts` covers strict storage validation, defaults, deduplication, limits,
false/zero, deletion and failed writes. `saved-target.test.ts` checks cache/descriptor
restoration and late worker results. `saved-worlds.mjs` uses an ephemeral real room server
and same-origin proxy to check Chrome restore/reload/failure and phone WebKit authority,
locked guests, deletion and keyboard entry. Captures are in `artifacts/saved-worlds`.

## Follow-on performance interface

`Shell.configurePerformance(source)` binds the existing quality controller through the
read-only `PerformanceSource` contract. Bind controller methods in the composition root;
there is no optional-method fallback. Reconfiguration releases the old subscription and
Shell disposal releases the current one. Core owns F3 visibility, history, eligibility,
Ignore persistence and the Lower action. The panel owns presentation only, with an SVG
chart capped at 120 supplied samples and no timer, animation loop or GPU context.

The Performance button is in the ordinary configuration rail. Native-control key presses
stay within the interface; key releases reach gameplay cleanup. Missing hardware fields
say Unavailable and browser memory is labeled as an estimate. Recommendations show only
during unlocked play so their actions cannot consume captured driving clicks.

Run `/Users/vtn/dev/Syn3h/tools/heavy.sh node tools/browser-checks.mjs follow-on` for this
check. The runner starts a dev server and its room server on free ports for it, and stops them.

The four-view browser fixture uses normal galaxy entry, then injects a controlled telemetry
supplier to test layout, history bounds, visible labels, action delegation, subscription
replacement and repeated mount/dispose. It also tests held-key release after focus changes,
capture, Escape, rejected pointer-lock fallback and returning through Exit world. This is
presentation evidence, not proof of real low-FPS eligibility or controller integration.
The subsequent exploration gate checks touch map clearance and existing rail behavior.

On the shared host, fixture initial render measurements were 0.20 ms in Chrome and 8 ms
in WebKit (coarse timer resolution). These are not physical-device measurements or a
steady-state performance comparison. The Performance lane owns matched scene benchmarks;
the integrator owns ordinary-entry controller wiring and the final combined gate.
