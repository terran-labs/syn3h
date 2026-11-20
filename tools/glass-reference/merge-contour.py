"""Compare registered 3x dark grid crops. Report both facing contours in points."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=float)


def facing_contour(image, midpoint):
    # The reference tile repeats every 12 points vertically. Use each capture's
    # own uncovered rows to avoid interpreting video colour offsets as glass.
    height = image.shape[0]
    background = image[36 + np.arange(height) % 36]
    signal = np.abs(image - background).mean(axis=2)
    mask = Image.fromarray(np.uint8(signal > 22) * 255)
    mask = mask.filter(ImageFilter.MedianFilter(3))
    filled = np.asarray(mask) > 0
    # At each x this pair intersects a vertical line in a single interval.
    # Fill interior holes where the refracted grating matches the bare tile.
    for x in range(round((midpoint - 16) * 3), round((midpoint + 16) * 3)):
        rows = np.flatnonzero(filled[150:330, x]) + 150
        if rows.size:
            filled[rows[0]:rows[-1] + 1, x] = True
    inner = np.asarray(Image.fromarray(filled).convert("L").filter(ImageFilter.MinFilter(3))) > 0
    y, x = np.nonzero(filled & ~inner)
    keep = (abs(x / 3 - midpoint) <= 12) & (abs(y / 3 - 80) < 30)
    return np.column_stack((x[keep], y[keep])) / 3


def measure(apple, ours, gap):
    midpoint = 142 - gap / 2
    a = facing_contour(apple, midpoint)
    b = facing_contour(ours, midpoint)
    distances = np.linalg.norm(a[:, None] - b, axis=2)
    symmetric = np.r_[distances.min(axis=0), distances.min(axis=1)]
    neck = abs(apple - ours)[171:309, round((midpoint - 8)*3):round((midpoint + 8)*3)]
    return [symmetric.mean(), np.percentile(symmetric, 95), symmetric.max(),
            neck.mean(), np.percentile(neck.max(axis=2), 95), neck.max()]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("gaps", type=int, nargs="+")
    args = parser.parse_args()
    print("gap backend contour mean/p95/peak (pt) neck RGB mean/max-channel p95/peak")
    for gap in args.gaps:
        apple = rgb(args.directory / f"native-merge-{gap}.png")
        for backend in ("webgpu", "webgl"):
            ours = rgb(args.directory / f"{backend}-merge-{gap}.png")
            print(gap, backend, *(round(v, 2) for v in measure(apple, ours, gap)))
