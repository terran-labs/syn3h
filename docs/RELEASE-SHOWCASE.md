# Release showcase stills and GIF

`tools/showcase.mjs` captures a fixed set of scenes from a frozen production build and
assembles them into a looping GIF for the GitHub README. Each run writes, per release:

- one PNG per scene, 1280 x 720, named `<scene>.png`
- `syn3h-showcase.gif`, 832 x 468, looping forever, with exactly one frame per still. The
  hold (1.5 seconds by default) is that frame's delay, and each frame has its own palette.
  832 pixels is the widest GitHub shows an image in a README, so a wider GIF only adds bytes.
- `manifest.json`: version, commit, build id, the byte size and SHA-256 of every file, the
  scenes captured, and the scenes skipped with the reason

It is a slideshow of stills, not a recording of play. The files go to GitHub release
storage, not into the repository.

## Run it

```sh
SYN3H_HEAVY_SLOTS=8 tools/heavy.sh node tools/showcase.mjs \
  --dir ../Syn3h-stable/20261114-200625-bc8cb48 --version v26.11.1401 --port 5348
```

The tool starts `tools/serve-stable.mjs` on the frozen copy, so the client and the room
server are the build being released, and stops that server when it finishes. Output goes to
`/tmp/syn3h-showcase/<version>/` unless `--out` names another root. The version folder is
cleared at the start of every run.

Without `--only` a run captures the eight scenes published with the first releases.
`king-of-the-hill` and `other-world` are captured only when named in `--only`.

Other options: `--url` uses a server that is already running instead of `--dir`; `--only
lobby,jet-flight` captures a subset while working on staging (the GIF then holds only those);
`--headless` runs Chrome headless with the GPU flags from `tools/smoke.mjs`; `--hold` changes
the seconds per still. ffmpeg is read from `/opt/homebrew/bin/ffmpeg` or `$FFMPEG`.

Chrome runs headed by default, with WebGPU and the Metal backend. Frame rate does not matter
for stills, so a busy machine slows a run but does not spoil it. A full run of ten scenes
takes about two and a half minutes.

## Rebuild the GIF without capturing

```sh
node tools/showcase.mjs --rebuild-gif --version v26.11.1413 --out /tmp/syn3h-showcase
```

This reads `manifest.json` and the stills already in `<out>/<version>/` and writes a new
GIF and manifest. It starts no server and no browser. Use it after removing a still that
failed review, or to change `--hold`. A still deleted from the folder is dropped from the
GIF. With `--only`, the other stills are listed in the manifest as left out, and a later
rebuild without `--only` puts them back.

## The scenes

In GIF order. The first eight are the default run. Each opens in a fresh browser context and a fresh room with a fixed seed.

| Scene | What it shows | How it is staged |
| --- | --- | --- |
| `lobby` | The Syn3h logo and the planet cards | The lobby with the room name, QR code and invite link hidden |
| `buggy-volcano` | The Syn3h buggy on the road, volcano ahead, golden hour | Volcanic seed 7 at 17:36, driving from the pad along the summit road |
| `wings-glide` | Wings open in the air | Desert seed 11, launched above a dune with forward speed, wings opened |
| `bots-pursuit` | Five bots chasing the player | Bots lined up behind the player on the plain, chase steering running, camera ahead looking back |
| `tag-beam` | A tag beam connecting two vehicles | A second browser joins the same room and parks ahead; the player sends slow tag beams at it; side view |
| `jet-flight` | The jet above the island | The jet placed 230 m up, nose toward the volcano, throttle (R) held |
| `hovercraft-lava` | The hovercraft over lava | On the lava sea heading toward the island |
| `lava-night` | Lava and headlights at night | 22:30 on a gentle beach of the lava sea, parked facing the lava |
| `king-of-the-hill` (only with `--only`) | The rim with the match card | The room switched to King of the Hill, parked on the rim until the card shows 6 seconds held |
| `other-world` (only with `--only`) | The alpine planet | Alpine seed 11, driving from the pad with the normal chase camera |

The scene list and every pure helper live in `tools/lib/showcase-scenes.mjs`. The staging,
which runs in the page through `window.syn3h`, lives in `tools/showcase.mjs`.

## What makes a frame acceptable

A still is written only when both checks pass. Each scene gets three attempts.

1. **The pose check.** Each scene states what must be true in the game when the frame is
   taken: wings open and at least 4 m up, four bots within 40 m, at least three tag beams in
   flight, the jet at least 40 m above ground, the hovercraft over lava, the night buggy
   upright with lava ahead, and so on.
2. **The colour check.** The PNG is decoded with ffmpeg and measured. It fails if the mean
   luma is below 12 (6 for the lobby, which is deep space behind a lit logo), if the luma
   deviation is below 10, if more than 85% of pixels fall in one colour bucket, or if it has
   fewer than 12 colour buckets. The measurements are in the manifest.

The tool hides the controls card, the diagnostic panels, the speed and score panel, the
minimap, the menu buttons, name tags and toasts. The King of the Hill match card stays, since
it is the point of that scene.

These checks catch black, flat and failed frames. They cannot tell a good shot from a dull
one, so a person still looks at every still before publishing.

## Builds without a feature

A scene whose build lacks something it needs is skipped and listed in the manifest with the
reason, rather than failing the run. Each scene lists its needs (`requires` in the scene
list): a registry parameter, a vehicle, a planet, the room connection, or the external camera
pose. A pose check that never passes also skips the scene, with the last measurement.

## Proposed hook in tools/release.sh

Not applied: `tools/release.sh` belongs to the release lane. After the public smoke test
passes, a release could capture its showcase from the frozen copy it just deployed:

```sh
# --- Showcase -------------------------------------------------------------------------------
# Stills and the README GIF from the frozen copy. A failure here does not undo the release.
SHOWCASE_VERSION="${SHOWCASE_VERSION:-}"   # the calendar version, once release.sh computes one
if [ -n "$SHOWCASE_VERSION" ]; then
  node tools/showcase.mjs --dir "$DEST" --version "$SHOWCASE_VERSION" --port "$((PORT + 1))" \
    > "$LOG-showcase.log" 2>&1 || echo "Warning: showcase capture failed (see $LOG-showcase.log)"
fi
```

`release.sh` already holds a heavy slot for its whole run, so this line must not be wrapped
in `tools/heavy.sh` again. Uploading the files to the GitHub release and pointing the README
at `releases/latest/download/syn3h-showcase.gif` are separate steps for whoever publishes.

## Tests

```sh
node --test tools/showcase.test.mjs
```

These cover the scene list, the default eight, room names and URLs, feature skipping, the
frame statistics and limits, the GIF arguments, the manifest and the argument parser. When
ffmpeg is installed, one test also builds GIFs from 1, 2 and 8 generated stills and checks
that the frame count equals the still count and each frame is held for the hold. The browser staging is checked by running the tool and looking at the
stills.
