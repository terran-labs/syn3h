# Release showcase

`tools/showcase.mjs` captures the pictures on the README and the release pages from a frozen
release build, at the top of what the game can draw, and can publish them to that release.
It is a separate step from `tools/release.sh`: a release never waits for it and never fails
because of it.

## The one command

After a release is published and verified, on a machine with a real GPU and no release
running. A full run took 9.5 minutes on the M2 Max with the machine quiet and 19 minutes
under heavy load; it holds one heavy slot throughout, and the Chrome window uses 2 to 3.5
CPU cores and up to about 7.5 GB of memory.

```sh
/Users/vtn/dev/Syn3h/tools/heavy.sh node tools/showcase.mjs --version v26.11.1608 --publish
```

It finds the frozen build of that version (`release-notes/history.tsv` gives the commit,
`../Syn3h-stable/releases.tsv` the frozen copy), serves it with `tools/serve-stable.mjs`,
captures every shot, encodes the files, uploads them to the GitHub release of that version
with `gh release upload --clobber`, and rewrites the README block between the
`showcase:start` and `showcase:end` markers. The README change is left uncommitted: review
the pictures in `captures/<version>/` and `git diff README.md`, then commit it.

Without `--publish` it captures and encodes only. `--publish-only` publishes an earlier
capture of that version without capturing again. `--only lobby,jet-tiny-world` captures a
subset, `--preview` takes a quick 1280 x 720 look while composing (it refuses to publish),
`--dir` or `--url` names the build to capture instead.

A build without the `hud.mode` interface setting skips every gameplay shot (the lobby still
runs): without it, an automated window shows the free-cursor panels, not the driving view.

## How a frame is made

- **Headed Chrome on the real GPU** (WebGPU, Metal), one browser, one shot at a time, each in
  a fresh context and a fresh room with a fixed seed.
- **Cinematic quality, fixed.** `gfx.quality` 5 with `gfx.auto` off, so automatic relief
  never lowers it; every effect the level owns is on. The sky clock is stopped
  (`sun.dayLength` 0) at the shot's hour, and the idle autopilot is off.
- **3840 x 2160.** A 1920 x 1080 window at device pixel ratio 2. The interface is laid out
  at 1920 x 1080 and drawn at twice the density, like a player's high-density display.
- **A virtual 60 fps clock.** `requestAnimationFrame` and `performance.now` are driven by the
  tool one frame of exactly 1/60 s at a time, and each frame waits for the GPU. The game, its
  physics and its renderer run unchanged; only the pacing is the tool's. A frame that takes
  200 ms on a busy machine still shows the world as a 60 fps player sees it, and clips play
  back smoothly.
- **Settled before the shutter.** Before each still the tool waits for shader compilation to
  stop and for a run of 45 quiet frames (at least 120), so terrain, shadows, clouds and
  temporal smoothing have converged. The arrival controls card, a passing notice, is
  allowed to fade first.
- **Lossless, then encoded.** Stills are saved as PNG from the screen, then encoded: a
  full-size JPEG (libjpeg-turbo quality 93, 4:4:4) and a 1600 px wide WebP for the README.
  Clips are 60 fps JPEG frames encoded to an H.264 MP4 at 1920 px and a 640 px, 30 fps
  animated WebP for the README (640 px, shown at 420).
- **The interface a player sees.** Gameplay shots use `hud.mode` 1, Driving: exactly the
  view shown while the cursor is captured (one shared decision in `src/ui/Shell.ts`).
  Shots without the interface use `hud.mode` 2, Hidden, the game's own setting, and are
  extras, never the lead picture. No CSS is injected and nothing is painted or composited.
- **Staging is disclosed.** Each shot's `staging` text says what the tool placed: starting
  positions, a starting speed, the camera. From then on the game plays: physics, bots,
  weather and the vehicles' own controls. The README caption says so.

## What GitHub can show

Release asset URLs are served directly to the browser (not through GitHub's image proxy),
as `application/octet-stream`; browsers sniff the type for an `<img>`, which is how the
current GIF displays. So JPEG, WebP and animated WebP all display in a README. A video
plays inline only when uploaded through the web editor as an attachment; a `<video>` or
link to a release asset MP4 is stripped or shown as a link. So the README shows animated
WebP and each one links to its MP4.

## The shots

The list is `SHOTS` in `tools/lib/showcase-scenes.mjs`; the staging is `STAGES` in
`tools/showcase.mjs`. Each shot answers one of the owner's reference pictures (private;
never commit or publish them).

| Shot | Picture | Reference |
| --- | --- | --- |
| `lobby` | The galaxy lobby and wordmark | |
| `canyon-convoy` | Buggy in the Badlands at golden hour, convoy and jet beyond | 3 |
| `volcano-fleet` | Mixed fleet under the volcano at dusk (not in the README yet: the fleet sits too far off) | 1 |
| `wings-glide` | Force-field wings open off a Badlands ridge in the late sun | 4 |
| `jet-tiny-world` | Jet banking high over the curve of a tiny world | 6 |
| `headlights-night` | Headlights on rough ground at night with company | 5 |
| `swamp-river` | Tracks on the green slopes of the Methane Swamp | 2 |
| `lava-night` | The lava sea at night under the headlights | 5 |
| `lagoon-hovercraft` | Hovercraft on the lagoon toward the islands (not in the README yet: companions too small) | 2 |
| `jet-tiny-world-clean` | The tiny world with the interface hidden (extra) | 6 |
| `clip-dive` | From the galaxy lobby down into a world | |
| `clip-wings` | Off a ridge and into a glide | 4 |
| `clip-jet` | The jet pitching down to the curve of the world | 6 |
| `clip-lava` | Along the lava shore at night | 5 |

## What a shot must show

The owner's bar, from his seven references:

- A clear primary vehicle with a complete, readable silhouette; readable wheels and body.
- A near, middle and far story: foreground vehicle, companions at a readable distance (10 to
  40 m, never clipping the camera), terrain or sky behind.
- Understandable scale, companions separated from the background, controlled highlights
  with visible dark detail; bloom must not erase body shape.
- The tiny curved world seen from a banking jet, with the whole jet and recognisable terrain.
- Headlights revealing ground at night without crushing the body to black.
- The translucent glider wing with its complete outline.
- A varied planet with water and tracks leading the eye.

A frame that passes the tool's checks (pose reached, not black or flat) is only a
candidate: look at every picture at full size and at README width before publishing. A
scene that cannot be captured honestly is dropped, not faked.

## Tests

```sh
node --test tools/showcase.test.mjs
```

They check that a black or blank frame is rejected, that every shot can be opened, that
gameplay uses the driving interface, that the manifest names what was captured and
skipped, that the README block names its version and links each picture to its original,
and that a version resolves to its frozen build.
