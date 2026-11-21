# Gameplay glass GPU budget

The timestamp guard measures the horizontal and vertical blur draws. Both disappear when glass sheds. The final composite runs in both modes. Copy diagnostics reports the measured pair as “glass-only GPU time (two blur passes)”.

A two-second eligible window must meet both conditions before it can start a GPU trial:

1. The 90th percentile frame interval exceeds 1.25 times the quality governor’s current target interval.
2. At least two fresh blur readings arrived, and each reached the greater of 2.0 ms and 8% of the actual mean frame interval.

The earlier 5 ms threshold was chosen to clear the desktop calibration spread. It would also suppress a trial for a struggling phone spending 4 ms on blur. The relative threshold uses the 8% improvement required to keep glass shed. The 2 ms floor is provisional. A gain below 8% restores glass after the five-second minimum and retires that trigger for the drive. Devices without usable timestamps retain the uneven-frame trial.

For a 60 FPS quality target, the twelve medians below predict these decisions if those costs persist through the window. At steady 60 FPS none qualifies. At steady 40 FPS, all six desktop cells and none of the six phone cells qualify. At steady 30 FPS the threshold is 2.67 ms: only the desktop WebGPU card and the desktop WebGL 2 sixteen-button and card cases qualify. With a 30 FPS target, steady 30 FPS qualifies in none of the twelve cases. The calibration used a paused scene and did not measure live frame pacing for each cell.

## Mac calibration

Chrome on an Apple M2 Max, High preset, fixed Alpine scene, with a one-to-one ratio of CSS points to drawing-buffer pixels. Each cell gives the median of six block medians and their range. Each block tested all three layouts, covering all six orders across the series. Each measured pair alternated the plain and glass draws. Load is the one-minute Mac load average. The phone-sized buffer measures the Mac GPU; the iPhone remains unmeasured.

| Buffer | Backend | Surfaces | Two blur draws (ms) | Composite increase (ms) | Total increase (ms) | Load |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 390 × 844 | WebGPU | 8 buttons | 1.38 (1.09 to 1.56) | 0.22 (0.13 to 0.25) | 1.56 (1.40 to 1.81) | 7.5 to 8.9 |
| 390 × 844 | WebGPU | 16 buttons | 1.30 (0.94 to 1.53) | 0.33 (0.14 to 0.50) | 1.50 (1.08 to 2.22) | 7.5 to 8.9 |
| 390 × 844 | WebGPU | Me card + 7 buttons | 1.38 (0.97 to 1.44) | 0.24 (0.10 to 0.31) | 1.57 (1.29 to 1.70) | 7.5 to 8.4 |
| 390 × 844 | WebGL 2 | 8 buttons | 0.72 (0.42 to 0.96) | 0.05 (-0.20 to 0.19) | 0.78 (0.06 to 1.18) | 5.5 to 9.0 |
| 390 × 844 | WebGL 2 | 16 buttons | 0.96 (0.40 to 1.60) | 0.25 (-0.21 to 0.29) | 1.25 (0.12 to 1.96) | 5.9 to 8.4 |
| 390 × 844 | WebGL 2 | Me card + 7 buttons | 0.81 (0.56 to 1.00) | -0.05 (-0.25 to 0.24) | 0.88 (0.28 to 1.12) | 5.5 to 8.4 |
| 1440 × 900 | WebGPU | 8 buttons | 2.52 (1.54 to 4.16) | -0.71 (-0.89 to 0.72) | 1.43 (-0.06 to 5.24) | 9.1 to 9.8 |
| 1440 × 900 | WebGPU | 16 buttons | 2.46 (1.58 to 3.95) | 0.37 (-1.02 to 1.36) | 2.55 (0.55 to 5.49) | 9.1 to 9.7 |
| 1440 × 900 | WebGPU | Me card + 7 buttons | 3.20 (2.69 to 3.95) | 0.28 (-0.23 to 0.50) | 3.49 (1.60 to 4.66) | 8.7 to 9.8 |
| 1440 × 900 | WebGL 2 | 8 buttons | 2.21 (1.13 to 3.40) | -0.38 (-0.99 to 0.57) | 1.41 (0.05 to 4.31) | 6.2 to 6.7 |
| 1440 × 900 | WebGL 2 | 16 buttons | 2.96 (1.23 to 4.21) | 0.29 (-1.04 to 1.44) | 2.86 (0.32 to 6.11) | 6.4 to 6.7 |
| 1440 × 900 | WebGL 2 | Me card + 7 buttons | 2.75 (1.23 to 4.13) | -0.10 (-0.84 to 0.94) | 2.70 (0.58 to 4.85) | 6.1 to 6.9 |

The composite increase is the difference between the glass and plain final draws. Total increase adds the two blur draws to that difference for each paired sample before taking medians. All six desktop composite ranges contain zero. A single sample under the entry cover would give a poor baseline for a drive through a changing scene. The runtime guard therefore uses only the directly measured blur draws. Its number covers part of the incremental cost of glass.

Frost width changes sample spacing while keeping the tap count fixed. Showing more buttons adds work to the final composite. Neither adjustment increases the number of blur draws or the dimensions of their targets.

## Earlier drive verification with the fixed threshold

At 390 × 844, the buggy travelled 432 metres during an 18-second drive with eight surfaces. Glass stayed on. The two passes took a median of 1.06 ms. At 32 occupied slots and maximum frost width they took 1.21 ms and also stayed on. The one-minute load was 8.6 at entry.

For the overload check, the benchmark enlarged only the two real blur targets from 98 × 211 to 4096 × 4096. The guard saw 15.06 ms and shed at 37.2 seconds. It restored glass at 42.3 seconds after the before-and-after mean went from 72.4 to 83.4 ms per frame. All three phases recorded zero graph, node or pipeline builds. The larger targets are a diagnostic workload.
