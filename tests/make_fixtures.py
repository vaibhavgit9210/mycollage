# Synthetic test photos: gradient + circle grid + colored corner markers + a letter, so
# crops, flips and swaps are easy to see in screenshots. Plus one transparent PNG.
# usage: python3 make_fixtures.py <out-dir>   (needs Pillow)
import math, os, sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
specs = [
    ('a-sunset-4x3.jpg', 2400, 1800, ((255, 120, 60), (90, 30, 120))),
    ('b-forest-3x4.jpg', 1500, 2000, ((30, 120, 70), (200, 230, 120))),
    ('c-sea-1x1.jpg', 1600, 1600, ((20, 80, 180), (120, 220, 255))),
    ('d-pano-16x9.jpg', 3840, 2160, ((240, 200, 80), (200, 60, 60))),
    ('e-tall-9x16.jpg', 1080, 1920, ((60, 60, 70), (240, 240, 250))),
    ('f-rose-3x2.jpg', 3000, 2000, ((230, 90, 140), (250, 220, 200))),
]
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 160)
except Exception:
    font = ImageFont.load_default()
for name, w, h, (c1, c2) in specs:
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3)))
    step = min(w, h) // 6
    for gx in range(0, w + step, step):
        for gy in range(0, h + step, step):
            r = step // 5
            d.ellipse([gx - r, gy - r, gx + r, gy + r], outline=(255, 255, 255), width=max(3, w // 600))
    m = min(w, h) // 8
    for x, y, col in [(0, 0, (255, 0, 0)), (w - m, 0, (0, 255, 0)), (0, h - m, (0, 0, 255)), (w - m, h - m, (255, 255, 0))]:
        d.rectangle([x, y, x + m, y + m], fill=col)
    label = name.split('-')[0].upper()
    d.text(((w - d.textlength(label, font=font)) / 2, h / 2 - 90), label, fill=(255, 255, 255), font=font, stroke_width=6, stroke_fill=(0, 0, 0))
    im.save(os.path.join(out, name), quality=90)
st = Image.new('RGBA', (1200, 1200), (0, 0, 0, 0))
pts = [(600 + (560 if i % 2 == 0 else 240) * math.cos(math.pi / 2 + i * math.pi / 5),
        600 - (560 if i % 2 == 0 else 240) * math.sin(math.pi / 2 + i * math.pi / 5)) for i in range(10)]
ImageDraw.Draw(st).polygon(pts, fill=(255, 210, 40, 255), outline=(120, 70, 0, 255))
st.save(os.path.join(out, 'g-star-alpha.png'))
