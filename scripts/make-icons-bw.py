#!/usr/bin/env python3
"""Regenerate Sonivex Studio icons in pure black & white (driver-rings motif)."""
from PIL import Image, ImageDraw
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
S = 512
SS = 4  # supersample
W = S * SS

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# rounded near-black background
bg = (10, 10, 10, 255)
rad = 100 * SS
d.rounded_rectangle([0, 0, W - 1, W - 1], radius=rad, fill=bg)

# subtle vertical luminance ramp (still pure grayscale)
ramp = Image.new("L", (1, W))
for y in range(W):
    ramp.putpixel((0, y), int(10 + 14 * (1 - y / W)))
ramp = ramp.resize((W, W))
base = Image.new("RGBA", (W, W), (255, 255, 255, 0))
base.putalpha(ramp)
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=rad, fill=255)
img.paste(Image.new("RGBA", (W, W), (255, 255, 255, 255)), (0, 0), Image.composite(ramp, Image.new("L", (W, W), 0), mask).point(lambda v: 0))
# simpler: skip the ramp if it complicates — keep flat bg (already drawn)

cx = cy = W / 2
def ring(r, width, shade):
    v = int(shade * 255)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(v, v, v, 255), width=width)

# driver rings motif (matches splash + top bar logo)
ring(205 * SS // 2, 14 * SS // 2, 0.98)   # outer surround ring
ring(150 * SS // 2, 12 * SS // 2, 0.62)   # cone ring
ring(88  * SS // 2, 12 * SS // 2, 0.98)   # dust cap ring
# center dust-cap dot
dr = 17 * SS // 2
d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=(240, 240, 240, 255))
# four flange bolts
import math
for i in range(4):
    a = math.pi / 4 + i * math.pi / 2
    bx = cx + math.cos(a) * 185 * SS // 2
    by = cy + math.sin(a) * 185 * SS // 2
    br = 9 * SS // 2
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(190, 190, 190, 255))

out = img.resize((S, S), Image.LANCZOS)
out.save(ROOT / "build/icon.png")

# ICO with standard sizes
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
out.save(ROOT / "build/icon.ico", sizes=ico_sizes)

# docs icon (Pages favicon / og:image)
docs_assets = ROOT / "docs/assets"
docs_assets.mkdir(parents=True, exist_ok=True)
out.save(docs_assets / "icon.png")

print("icons regenerated: build/icon.png, build/icon.ico, docs/assets/icon.png")
