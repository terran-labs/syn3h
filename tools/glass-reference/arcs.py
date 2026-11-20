"""Inspect the two diagonal arcs at six times the captured pixel resolution."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("reference", type=Path)
parser.add_argument("candidate", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
native, ours = [Image.open(path).convert("RGB") for path in (args.reference, args.candidate)]
if native.size != ours.size or native.width * 160 != native.height * 328:
    parser.error("Supply two matching registered reference crops")
scale = native.width / 328
delta = np.abs(np.asarray(native, dtype=np.int16) - np.asarray(ours, dtype=np.int16))
difference = Image.fromarray((delta * 4).clip(0, 255).astype(np.uint8))
half = round(7 * scale)
tile = half * 12
sheet = Image.new("RGB", (tile * 3, (tile + 26) * 4), "#222831")
draw = ImageDraw.Draw(sheet)
y, x = np.mgrid[:native.height, :native.width]
x, y = (x + .5) / scale, (y + .5) / scale
for i, (name, cx, spine, radius) in enumerate([("Circle", 80, 0, 30), ("Pill", 212, 46, 24)]):
    depth = radius - np.hypot(np.maximum(np.abs(x-cx) - spine, 0), y-80)
    for label, lower, upper in [("inner", 0, 2), ("outer", -3, 0), ("combined", -3, 2)]:
        band = delta[(depth >= lower) & (depth < upper)]
        print(f"{name} {label}: RGB MAE {band.mean():.2f}, pixel max-channel p95 {np.percentile(band.max(axis=1),95):.0f}, peak {band.max()}")
    for j, sign in enumerate((-1, 1)):
        xpos = round(scale * (cx + sign * (spine + radius / np.sqrt(2))))
        ypos = round(scale * (80 + sign * radius / np.sqrt(2)))
        box = (xpos-half, ypos-half, xpos+half, ypos+half)
        top = (i*2+j)*(tile+26)
        for k, (image, label) in enumerate([(native,"Apple"), (ours,"Syn3h"), (difference,"Difference ×4")]):
            draw.text((k*tile+4, top+5), f"{label}   {name}   {'upper left' if sign < 0 else 'lower right'}", fill="white")
            sheet.paste(image.crop(box).resize((tile,tile), Image.Resampling.NEAREST), (k*tile, top+26))
sheet.save(args.output)
