# Glass reference captures

The iOS harness draws SwiftUI Regular or Clear on a circle 60 points across and a pill 140 by 48 points. Both sit over the same bundled image. The capture script records the bare image and two independent launches of the material in each appearance. It targets a named simulator already booted for the trial. Supply its actual screen scale. Captures stay outside the game.

From the shader checkout, with Xcode and FFmpeg installed, run:

```sh
tools/heavy.sh tools/glass-reference/capture.sh "$device" "$backgrounds" "$output" regular 3
```

Supply PNG backgrounds with aspect ratio 344 to 160. The centred 328 by 160 point crop discards eight points on either side. When comparing another renderer, feed it the captured bare crop without rescaling. Use the bare crop for checking registration too.

With Pillow and NumPy installed, this command writes Apple on the left, the candidate in the middle and an absolute difference at four times gain on the right. It reports mean absolute RGB error in eight-bit levels for each shape, its centre, its folds and its edge. The edge spans two points inside and three outside. The 95th percentile uses the largest channel error at each pixel, and the peak is the largest single-channel error across the region. The top eight points check background registration. Run it again with the repeat capture as the candidate to measure the reference's own variability.

```sh
python tools/glass-reference/compare.py "$output/grid-light-rest.png" "$candidate" "$pair"
```

Use `arcs.py` with the same arguments to inspect both diagonal arcs at six times the captured pixel resolution.

Generate neutral fields and phase-shifted gratings with `calibration.py`. Their encoded phase identifies sampled background positions, and their contrast measures the spatial frequency response. `response.py` reads the centres of both shapes for both appearances from files named after the chart and appearance.

The browser demo is the Vite entry at `src/liquid-glass/demo/index.html`. It generates its initial grid locally and accepts a reference background through the file picker. The `webgl` query flag exercises the WebGL backend.

The two-control merge trial runs at `tools/glass-reference/merge.html` in the development server. Load the bare reference crop and enter a gap in points. The circle moves toward the fixed pill. Both belong to the same marked DOM container. The `separate` query flag draws the independent controls for the timing baseline, `webgl` selects WebGL 2 and `light` selects the light material. The trial defaults to dark Regular.

The in-game Brake pilot requires both `glass=inline` and `glassPress=brake`. The touch controller owns the brake input and its held class. The pilot changes the painted dimensions and DOM label only while the shader owns the control.

For the Zorb and Brake merge pilot, open the game with `?glass=inline&glassPress=brake&glassMerge=zorb-brake`. The two visible actions must share a `data-glass-container` ancestor and a horizontal centreline. Their hit targets remain independent, and Flip takes Brake’s place outside the pair. The circle and capsule reference page and the game use the same shader.

Use `glassMerge=zorb-brake-pressed` to enable the bridge only during a press. At zero strength the renderer skips the merged surface and draws the two individual controls. Both settings are opt-in.

For the native pair recording, launch the simulator harness with `-button-pair -diameter 56 -gap 8` for landscape or `-button-pair -diameter 62 -gap 12` for portrait. The stock glass buttons share a container with 18 pt spacing. The upper-left marker turns red on contact. At 8 pt the buttons rest joined and separate briefly during release. At 12 pt they rest apart and join during the press.
