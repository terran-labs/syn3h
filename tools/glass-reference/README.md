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

The two-control merge trial runs at `tools/glass-reference/merge.html` in the development server. Load the bare reference crop and enter a gap in points. The circle moves toward the fixed pill. Both belong to the same marked DOM container. The `separate` query flag draws the independent controls for the timing baseline, `webgl` selects WebGL 2 and `light` selects the light material. The trial defaults to dark Regular. Its merge shader is specific to the facing caps in this reference chart.

The in-game Brake pilot requires both `glass=inline` and `glassPress=brake`. The touch controller owns the brake input and its held class. The pilot changes the painted dimensions and DOM label only while the shader owns the control.
