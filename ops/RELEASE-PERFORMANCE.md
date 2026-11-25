# Frame cost in release notes

Frame cost is reported for reference. Releases proceed regardless of the result or whether a measurement is available.

After a release is accepted, measure its frozen build on a quiet machine (load under about 8):

```sh
tools/heavy.sh node tools/quality-frame-cost.mjs <frozen-checkout>
```

In the **next release’s notes**, put the six-level table under `### Performance` with the subheading `#### Frame cost, measured on <version>`. Use the measured build’s version. If there was no quiet run, write `Frame cost: not measured for <version>` under `### Performance`. Published notes are final.

## Method

Desktop Chrome measures all six presets on one page per backend at 1280 × 720, DPR 1.
Alpine seed 4 stays at 23:00 so other vehicles can cast headlight pools. Four mixed bots
are parked with their drivers paused. The tool applies each preset directly on its
local page and waits 60 frames for it to settle. It interleaves presets, then reverses
the order. Manual transition veils and their asynchronous preparation are outside
the measurement.

Each row covers 96 frames. Script time covers the game's callback through render submission.
GPU tail is the remaining wait for the WebGPU queue or a one-pixel WebGL readback,
including driver overhead. Total p50 and p95 use the sum per frame. Separate samples
measure the native GPU span from first through last pass on WebGPU or with an elapsed
query on WebGL 2 when supported.

Two night runs on v26.11.2405 differed by 2.2 ms at Low and 2.8 ms at Cinematic in WebGPU total p50. A shift larger than about 3 ms in the same row is worth a second look under comparable conditions.
