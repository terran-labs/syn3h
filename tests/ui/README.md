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

Vehicle integration still belongs to the vehicle builder. Read these values inside
`join`, before connecting:

```ts
const selected = {
  kind: shell.vehicleKind,
  bodyColor: shell.bodyColor,
  accentColor: shell.accentColor,
}
```

Pass `selected` to the builder's skin/colour setter once that API exists. In the
currently merged vehicle implementation, `createVehicle` ignores the kind and `Vehicle`
has no skin/colour setter. Do not claim that an invented setter works. If initial
construction needs saved preferences before the shell exists, import
`readVehicleChoice` from `./ui/VehicleChoice` and use its typed return value. A different
selection made in this session still needs to be applied at Play.

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
