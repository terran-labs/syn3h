"""Compare a registered 328 by 160 point reference and candidate (Pillow, NumPy)."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("reference", type=Path)
parser.add_argument("candidate", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
reference = Image.open(args.reference).convert("RGB")
candidate = Image.open(args.candidate).convert("RGB")
scale = reference.width / 328
if candidate.size != reference.size or reference.height != 160 * scale:
    parser.error("Both images must have the same registered dimensions")

diff = np.abs(np.asarray(reference, dtype=np.int16) - np.asarray(candidate, dtype=np.int16))
y, x = np.mgrid[:reference.height, :reference.width]
x, y = (x + 0.5) / scale, (y + 0.5) / scale
regions = {
    "Circle": np.hypot(x - 80, y - 80) <= 30,
    "Pill": np.hypot(np.maximum(np.abs(x - 212) - 46, 0), y - 80) <= 24,
}
# Keep Apple's image on the left at full capture resolution.
board = Image.new("RGB", (reference.width * 3, reference.height + 32), "#1e2227")
draw = ImageDraw.Draw(board)
for i, (label, im) in enumerate([
    ("Apple native", reference),
    (args.candidate.stem, candidate),
    ("Absolute RGB difference (4x gain)", Image.fromarray((diff * 4).clip(0, 255).astype(np.uint8))),
]):
    board.paste(im, (i * reference.width, 32))
    draw.text((i * reference.width + 8, 10), label, fill="white")
board.save(args.output)
for name, mask in regions.items():
    print(f"{name}  MAE {diff[mask].mean():.2f}  p95 {np.percentile(diff[mask], 95):.0f}")
print(f"Top registration strip MAE {diff[y < 8].mean():.3f}")
