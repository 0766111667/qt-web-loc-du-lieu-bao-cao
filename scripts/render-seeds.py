"""Render chữ số 0-9 bằng các font có sẵn ở cỡ nhỏ (cao 9-13 px, giống chữ trong bảng Excel) thành ảnh PNG.
Dùng khi muốn tạo lại src/core/seeds.json:
    python3 scripts/render-seeds.py /tmp/seed && npm run seeds -- /tmp/seed
Cần: Pillow, numpy và các font Carlito, Liberation Sans, DejaVu Sans."""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/seed"
os.makedirs(out, exist_ok=True)
fonts = {
    "carlito": "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
    "carlitob": "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
    "lib": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "libb": "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "dejavu": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
}
n = 0
for name, path in fonts.items():
    if not os.path.exists(path):
        continue
    for size in range(10, 24):
        f = ImageFont.truetype(path, size)
        ims, hs = {}, []
        for d in "0123456789":
            im = Image.new("L", (40, 40), 255)
            ImageDraw.Draw(im).text((8, 8), d, font=f, fill=0)
            ys = np.where((np.array(im) < 128).any(axis=1))[0]
            hs.append(ys.max() - ys.min() + 1 if len(ys) else 0)
            ims[d] = im
        if not 9 <= max(hs) <= 13:
            continue
        for d, im in ims.items():
            im.save(f"{out}/{name}{size}_{d}.png")
            n += 1
print("đã render", n, "ảnh vào", out)
