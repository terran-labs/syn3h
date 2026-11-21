"""Generate flat fields and phase-shifted gratings for local native captures."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

# Render at the reference phone's backing scale. The native image starts eight
# points left of the crop, so x=0 in the generated phase is also x=0 in the crop.
y, x = np.mgrid[:480, :1032]
x, y = (x + .5) / 3 - 8, (y + .5) / 3

def save(name, values):
    Image.fromarray(np.uint8(np.clip(np.rint(values), 0, 255))).convert("RGB").save(args.output / f"{name}.png")

for value in (0, 31, 64, 96, 128, 160, 192, 223, 255):
    save(f"gray{value}", np.full(x.shape, value))
for axis, position in (("x", x), ("y", y)):
    for period in (12, 32, 96):
        for phase in range(4):
            save(f"{axis}{period}p{phase}", 128 + 60 * np.cos(2 * np.pi * position / period + phase * np.pi / 2))
