#!/usr/bin/env python3
"""Generate Sonivex Studio icon: dark rounded square, cyan speaker cone rings."""
from PIL import Image, ImageDraw, ImageFilter
import math

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# background: rounded square with vertical gradient (dark graphite)
grad = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    r = int(14 + 8 * t); g = int(17 + 10 * t); b = int(23 + 14 * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))

mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([16, 16, S - 16, S - 16], radius=210, fill=255)
img.paste(grad, (0, 0), mask)

# subtle inner glow at top
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gdw = ImageDraw.Draw(glow)
gdw.ellipse([S*0.1, -S*0.35, S*0.9, S*0.45], fill=(34, 211, 238, 34))
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.alpha_composite(img, glow)
d = ImageDraw.Draw(img)

cx, cy = S / 2, S / 2

def ring(radius, width, color, alpha=255):
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
              outline=color + (alpha,), width=width)

# outer bezel
ring(430, 26, (30, 38, 48))
ring(404, 10, (14, 116, 144), 200)
# cone rings
ring(330, 22, (34, 211, 238), 235)
ring(252, 16, (34, 211, 238), 180)
ring(180, 14, (103, 232, 249), 200)
# dust cap
d.ellipse([cx - 108, cy - 108, cx + 108, cy + 108], fill=(12, 20, 26, 255))
ring(108, 10, (103, 232, 249), 255)
d.ellipse([cx - 52, cy - 52, cx + 52, cy + 52], fill=(34, 211, 238, 255))

# radial spokes between rings (subtle)
for i in range(12):
    a = i * math.pi / 6
    x1 = cx + 120 * math.cos(a); y1 = cy + 120 * math.sin(a)
    x2 = cx + 330 * math.cos(a); y2 = cy + 330 * math.sin(a)
    d.line([x1, y1, x2, y2], fill=(34, 211, 238, 26), width=8)

# glow pass
glow2 = img.filter(ImageFilter.GaussianBlur(24))
final = Image.alpha_composite(glow2, img)

# downscale for crispness
final = final.resize((512, 512), Image.LANCZOS)
final.save('/home/z/my-project/sonivex-studio/build/icon.png')

# multi-size ICO
ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
final.save('/home/z/my-project/sonivex-studio/build/icon.ico', sizes=ico_sizes)
print('icons written:', 'build/icon.png', 'build/icon.ico')
