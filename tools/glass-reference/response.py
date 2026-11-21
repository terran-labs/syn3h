"""Read centre transfer and contrast transmission from native calibration captures."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("captures", type=Path)
args = parser.parse_args()

def read(stem):
    return np.asarray(Image.open(args.captures / f"{stem}.png").convert("RGB"), dtype=float).mean(axis=2)

for theme in ("light", "dark"):
    print(theme)
    for value in (0, 31, 64, 96, 128, 160, 192, 223, 255):
        image = read(f"gray{value}-{theme}")
        print(f"background {value:3d}   circle {np.median(image[231:249,231:249]):5.1f}   pill {np.median(image[231:249,627:645]):5.1f}")
    for period in (12, 32, 96):
        phases = [read(f"x{period}p{p}-{theme}") for p in range(4)]
        contrast = np.hypot(phases[0] - phases[2], phases[3] - phases[1]) / 2
        background = np.median(contrast[12:24, 84:900])
        for center in (240, 636):
            response = np.median(contrast[231:249, center-9:center+9]) / background
            print(f"{period:2d} pt period, centre at x={center / 3:g} pt: contrast transfer {response:.3f}")
